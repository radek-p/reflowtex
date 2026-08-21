#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Transforms applied to a serializer output.json before it is encoded.

Three passes, each returning a count of what it changed:

  * strip_unsupported_nodes   — drop nodes the schema/renderer do not model.
  * normalise_glyph_addressing — rewrite glyphs the served font cannot address by
                                 their Unicode codepoint to a private-use code.
  * convert_pictures          — turn TikZ and included PDF pictures into inline SVG.

None of these depend on any framework; they operate on the parsed dict and (for
fonts) a Fonts instance from fonts.py.
"""

import re
import subprocess
import sys
import tempfile
import unicodedata
from pathlib import Path

from fonts import fonts_of


def _all_content_items(data: dict):
    """Yield main-flow and separately stored footnote items."""
    yield from data.get('content', [])
    for footnote in data.get('footnotes', []):
        yield from footnote.get('content', [])


# ── Unsupported nodes ────────────────────────────────────────────────────────
# Node types the schema (schema/latex.proto) can encode. Anything else (e.g.
# 'whatsit' nodes from xcolor's colour-stack markers, 'local_par' markers) is
# zero-width, carries no rendering meaning, and is dropped before encoding.
SUPPORTED_NODE_TYPES = {'glyph', 'glue', 'kern', 'rule', 'hlist', 'vlist',
                        'disc', 'penalty', 'math', 'picture', 'transform'}

# LEADER_NOTE: leader glue (\cleaders and friends) hangs a single box off the
# glue node, which TeX tiles across the glue's set width. It is a node like any
# other -- it holds glyphs that need PUA rewriting and font provisioning -- but
# it is reached through 'leader' rather than a child list, so every walk below
# has to descend into it explicitly. Miss it and the glyphs in every extensible
# arrow go unpatched.


def strip_unsupported_nodes(data: dict) -> int:
    stripped = 0

    def walk(nodes: list) -> list:
        nonlocal stripped
        kept = []
        for n in nodes:
            if n.get('type') not in SUPPORTED_NODE_TYPES:
                stripped += 1
                continue
            for k in ('children', 'replace', 'pre', 'post', 'nobreak'):
                if k in n:
                    n[k] = walk(n[k])
            if 'leader' in n:                     # a single node (see LEADER_NOTE)
                kept_leader = walk([n['leader']])
                if kept_leader:
                    n['leader'] = kept_leader[0]
                else:
                    del n['leader']
            kept.append(n)
        return kept

    for para in data.get('paragraphs', []):
        para['nodes'] = walk(para.get('nodes', []))
    for item in _all_content_items(data):
        if 'box' in item:
            item['box']['children'] = walk(item['box'].get('children', []))
    return stripped


# ── Glyph addressing ─────────────────────────────────────────────────────────
# A glyph node is rewritten to a private-use codepoint (Plane 16, 0x100000 +
# glyph index) whenever rendering it by its Unicode codepoint would not reliably
# reproduce the glyph LuaTeX actually typeset:
#
#  * the glyph is a GSUB substitution result (e.g. ssty script-size variants in
#    fractions/scripts, size variants of delimiters) — the served font's cmap
#    maps the codepoint to a *different* glyph, and relying on the browser to
#    re-apply font features is exactly the cross-browser lottery this pipeline
#    exists to avoid;
#  * the codepoint is a combining mark (math accents like \hat, \vec) — Safari
#    refuses to let an isolated mark's ink hang left of the text-run origin,
#    shifting it; PUA codepoints carry no combining semantics;
#  * the codepoint has no cmap entry at all (LuaTeX assigns Plane-15 codes to
#    unencoded variant glyphs).
#
# Plane 16 avoids colliding with LuaTeX's own Plane-15 assignments. The font
# patcher picks the rewritten codepoints up and adds the matching cmap entries to
# the served fonts automatically.
PUA_BASE = 0x100000


def normalise_glyph_addressing(data: dict, fonts) -> int:
    """Rewrite glyphs the served font cannot address by codepoint to PUA codes.

    `fonts` is a fonts.Fonts instance: it is asked to provision the referenced
    fonts (so the cmap can be inspected) and for the codepoint→gid lookup.
    """
    font_files = {fid: info['filename'] for fid, info in fonts_of(data).items()}
    fonts.provision(set(font_files.values()))
    rewritten = 0

    def needs_pua(cp: int, gi: int, lookup) -> bool:
        if cp >= PUA_BASE:                        # already normalised
            return False
        if cp < 0xF0000 and unicodedata.category(chr(cp)) in ('Mn', 'Mc', 'Me'):
            return True                           # combining mark
        if lookup is None:                        # font unavailable — marks only
            return False
        return lookup.get(cp) != gi               # substituted or unencoded glyph

    def walk(nodes):
        nonlocal rewritten
        for n in nodes:
            if n.get('type') == 'glyph':
                cp, gi = n.get('char'), n.get('gindex')
                if cp is not None and gi is not None:
                    lookup = fonts.cmap_gid_lookup(font_files.get(str(n.get('font', '')), ''))
                    if needs_pua(cp, gi, lookup):
                        n['char'] = PUA_BASE + gi
                        rewritten += 1
            for k in ('children', 'replace', 'pre', 'post', 'nobreak'):
                if k in n:
                    walk(n[k])
            if 'leader' in n:
                walk([n['leader']])

    for para in data.get('paragraphs', []):
        walk(para.get('nodes', []))
    # Display boxes carry their own glyphs (and are the heaviest users of ssty
    # script variants, which is exactly what PUA addressing exists for).
    for item in _all_content_items(data):
        if 'box' in item:
            walk(item['box'].get('children', []))
    return rewritten


# ── Legacy 8-bit fonts: convert to OTF and address via PUA ───────────────────
# Classic Type1 TeX fonts (cmsy10, cmmi10, the AMS symbol faces, …) have no
# OpenType form, so the serializer records filename 'unknown' and the viewer draws
# each glyph's metric box. Their outlines ship with TeX, though, so we convert each
# to a served OTF (see t1_convert) and rewrite its glyph nodes' 8-bit slot numbers
# to the private-use codepoints the converted font's cmap maps — the same PUA trick
# as normalise_glyph_addressing, keyed on the slot instead of a glyph index (these
# fonts carry no gindex). A font with no convertible outline is left as-is: its
# filename stays 'unknown' and the viewer keeps drawing metric boxes.


def normalise_legacy_font_addressing(data: dict, fonts) -> int:
    """Convert 'unknown' Type1 fonts to OTFs and rewrite their glyphs to PUA codes.

    `fonts` is a fonts.Fonts instance; it does the (cached) conversion and owns the
    written files. Returns the number of glyph nodes rewritten.
    """
    rewrite: dict[str, dict[int, int]] = {}    # font id → {slot → target codepoint}
    for fid, info in fonts_of(data).items():
        if info.get('filename') not in (None, 'unknown'):
            continue
        res = fonts.legacy_otf(info.get('name'))
        if not res:
            continue                            # no outline → keep metric boxes
        served, addressing = res
        info['filename'] = served               # so encode/viewer fetch the OTF
        rewrite[str(fid)] = addressing
    if not rewrite:
        return 0

    rewritten = 0

    def walk(nodes):
        nonlocal rewritten
        for n in nodes:
            if n.get('type') == 'glyph':
                addressing = rewrite.get(str(n.get('font')))
                if addressing is not None:
                    ch = n.get('char')
                    # Rewrite only slots the OTF actually addresses (0..255); an
                    # unencoded one is left as-is (it renders as nothing rather than
                    # a wrong glyph). The pass never runs twice on a font — once its
                    # filename is set above it is skipped — so no anti-re-entry guard
                    # on the codepoint is needed, which is good because a slot can now
                    # map to a real codepoint below 256.
                    if ch is not None and ch in addressing:
                        n['char'] = addressing[ch]
                        rewritten += 1
            for k in ('children', 'replace', 'pre', 'post', 'nobreak'):
                if k in n:
                    walk(n[k])
            if 'leader' in n:
                walk([n['leader']])

    for para in data.get('paragraphs', []):
        walk(para.get('nodes', []))
    for item in _all_content_items(data):
        if 'box' in item:
            walk(item['box'].get('children', []))
    return rewritten


# ── Pictures: TikZ and included PDFs → inline SVG ────────────────────────────
# Each picture keeps TeX's box metrics (so it behaves as an ordinary box
# anywhere) and gains an SVG payload the browser can draw. Two rewrites make the
# payload safe to inline:
#
#  * ids — dvisvgm names glyph paths "g1-4855" and refers to them with <use>.
#    Those names restart per file, so two pictures on one page would collide and
#    silently draw each other's glyphs. Every id gets a per-picture prefix.
#  * colours — rewritten to CSS custom properties so a theme can recolour
#    drawings exactly as it recolours text. Black is special: it is the default
#    text colour and dvisvgm often omits fill for it (SVG's initial fill is
#    black), so the renderer sets the inherited fill on the wrapping <g> rather
#    than rewriting each path.

SVG_ID_RE    = re.compile(r"\bid='([^']+)'")
SVG_USE_RE   = re.compile(r"(xlink:href|href)='#([^']+)'")
# dvisvgm shortens colours to 3-digit hex under --optimize (#f00, not #ff0000),
# so both forms must be recognised or the rewrite silently does nothing and the
# drawing stays un-themed. Non-hex values (none, currentColor) are left alone.
SVG_COLOR_RE = re.compile(r"\b(fill|stroke)='#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})'")
SVG_ROOT_RE  = re.compile(r"<svg\b[^>]*\bviewBox='([\d.eE+-]+) ([\d.eE+-]+) ([\d.eE+-]+) ([\d.eE+-]+)'[^>]*>(.*)</svg>",
                          re.DOTALL)
SVG_PAGE_RECT_RE = re.compile(
    r"<path d='M0 0H([\d.eE+-]+)V([\d.eE+-]+)H0V0Z?'"
    r"(?: fill='#(?:fff|ffffff)')?/>\s*")


def _rewrite_picture_svg(svg: str, prefix: str, *, strip_page_background: bool = False
                         ) -> tuple[str, float, float]:
    m = SVG_ROOT_RE.search(svg)
    if not m:
        raise RuntimeError('dvisvgm output has no <svg viewBox=...> root')
    vb_w, vb_h = float(m.group(3)), float(m.group(4))
    inner = m.group(5)

    # Figma exports an opaque white page rectangle. ICC normalisation below
    # makes it explicit white; the fallback for older/raw dvisvgm output has no
    # fill at all. Ordinary included PDFs are artwork on the host page, so drop
    # either form only when its geometry is exactly the complete viewBox. Do not
    # require it to be the first child: clipped PDFs put <defs> before the page
    # group. TikZ captures are excluded because their full-size rectangle may be
    # intentional content.
    if strip_page_background:
        for bg in SVG_PAGE_RECT_RE.finditer(inner):
            if (abs(float(bg.group(1)) - vb_w) < 1e-6
                    and abs(float(bg.group(2)) - vb_h) < 1e-6):
                inner = inner[:bg.start()] + inner[bg.end():]
                break

    ids = set(SVG_ID_RE.findall(inner))
    if ids:
        inner = SVG_ID_RE.sub(lambda mm: f"id='{prefix}{mm.group(1)}'", inner)
        inner = SVG_USE_RE.sub(
            lambda mm: f"{mm.group(1)}='#{prefix}{mm.group(2)}'"
                       if mm.group(2) in ids else mm.group(0),
            inner)

    def colour(mm):
        attr, digits = mm.group(1), mm.group(2).lower()
        if len(digits) == 3:                       # #f00 → #ff0000
            digits = ''.join(c * 2 for c in digits)
        hex6 = f'#{digits}'
        fallback = 'currentColor' if hex6 == '#000000' else hex6
        return f"{attr}='var(--latex-color-{digits}, {fallback})'"

    inner = SVG_COLOR_RE.sub(colour, inner)
    return inner.strip(), vb_w, vb_h


def convert_pictures(data: dict, build_dir: Path) -> int:
    """Turn every picture node's PDF page into inline SVG, indexed per document."""
    pictures = data.setdefault('pictures', [])
    by_source: dict[tuple[str, int, bool, bool], int] = {}
    rgb_pdfs: dict[Path, Path] = {}
    converted = 0

    # dvisvgm 3.4 drops every ICC `scn` fill in PDFs exported by Figma, not just
    # the white canvas: coloured and pale-grey shapes silently become the SVG
    # default black. Ghostscript rewrites those paints to ordinary DeviceRGB,
    # which dvisvgm preserves. Keep one normalised copy per source PDF for this
    # document; several pages commonly come from the same Figma export.
    pdf_tmp = tempfile.TemporaryDirectory(prefix='picture-pdf-')

    def normalise_included_pdf(pdf: Path) -> Path:
        if pdf not in rgb_pdfs:
            normalised = Path(pdf_tmp.name) / f'source-{len(rgb_pdfs) + 1}.pdf'
            r = subprocess.run(
                ['gs', '-q', '-dSAFER', '-dNOPAUSE', '-dBATCH',
                 '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.7',
                 '-sColorConversionStrategy=RGB',
                 '-dProcessColorModel=/DeviceRGB', '-dUseCIEColor=false',
                 f'-sOutputFile={normalised}', str(pdf)],
                cwd=build_dir, capture_output=True, text=True)
            if r.returncode != 0 or not normalised.exists():
                sys.exit(f'ERROR: Ghostscript failed while normalising colours in {pdf}:\n'
                         f'{r.stderr[-2000:]}')
            rgb_pdfs[pdf] = normalised
        return rgb_pdfs[pdf]

    def walk(nodes: list) -> None:
        nonlocal converted
        for n in nodes:
            if n.get('type') == 'picture':
                src = n.pop('file', None)
                page = int(n.pop('page', 1) or 1)
                externalized = bool(n.pop('externalized', False))
                generated = bool(n.pop('generated', False))
                if not src:
                    sys.exit(f'ERROR: picture node in {build_dir.name} has no source file — '
                             f'the template image hook did not record it')
                source_key = (src, page, externalized, generated)
                if source_key not in by_source:
                    if generated:
                        pdf = build_dir / src
                        out = build_dir / f'captured-picture-{page}.svg'
                    elif externalized:
                        pdf = build_dir / f'{src}.pdf'
                        out = build_dir / f'{src}.svg'
                    else:
                        # src is whatever kpse.find_file returned inside the
                        # LuaTeX process (serializer.lua's note_graphic) — kpathsea
                        # doesn't necessarily absolutise its answer, so a relative
                        # TEXINPUTS entry comes back as a path relative to *that
                        # process's* cwd (build_dir, per _run_lualatex). This
                        # transform runs later, as plain Python, with no reason to
                        # share that cwd — so a relative src must still be resolved
                        # against build_dir, not wherever this happens to run from.
                        pdf = Path(src) if Path(src).is_absolute() else build_dir / src
                        out = build_dir / f'included-{len(pictures) + 1}.svg'
                    if not pdf.exists():
                        sys.exit(f'ERROR: picture source {pdf} is missing')
                    if pdf.suffix.lower() != '.pdf':
                        sys.exit(f'ERROR: picture source {pdf} is not a PDF; '
                                 f'only PDF includegraphics is supported')
                    conversion_pdf = (pdf if externalized or generated
                                      else normalise_included_pdf(pdf))
                    # --tmpdir is required for correctness, not tidiness: dvisvgm's
                    # temporary files are not namespaced per process, so concurrent
                    # conversions (blocks compile on a thread pool) collide and some
                    # silently emit an SVG with every glyph missing. It exits 0 and
                    # writes valid SVG, so nothing downstream can tell — the picture
                    # just loses all its labels. A private tmpdir avoids it.
                    with tempfile.TemporaryDirectory(prefix='dvisvgm-') as tmpdir:
                        r = subprocess.run(
                            ['dvisvgm', '--pdf', f'--page={page}', '--no-fonts', '--optimize=all',
                             f'--tmpdir={tmpdir}', f'--output={out}', str(conversion_pdf)],
                            cwd=build_dir, capture_output=True, text=True)
                    if not out.exists():
                        sys.exit(f'ERROR: dvisvgm failed on {pdf}:\n{r.stderr[-2000:]}')
                    inner, vb_w, vb_h = _rewrite_picture_svg(
                        out.read_text(encoding='utf-8'), f'p{len(pictures)+1}-',
                        strip_page_background=not externalized and not generated)
                    pictures.append({'svg': inner, 'vb_w': vb_w, 'vb_h': vb_h})
                    by_source[source_key] = len(pictures)      # 1-based
                    converted += 1
                n['picture'] = by_source[source_key]
            for k in ('children', 'replace', 'pre', 'post', 'nobreak'):
                if k in n:
                    walk(n[k])
            if 'leader' in n:
                walk([n['leader']])

    for para in data.get('paragraphs', []):
        walk(para.get('nodes', []))
    for item in _all_content_items(data):
        if 'box' in item:
            walk(item['box'].get('children', []))
    pdf_tmp.cleanup()
    return converted
