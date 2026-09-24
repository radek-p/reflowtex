#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Font provisioning and cmap patching for the reflowtex pipeline.

The browser is served the same OTF files LuaTeX typeset with, so two things have
to happen for every font a compiled block references:

  * provision — copy the file into the output fonts directory. It is found first
    in an optional repo-local fonts dir (for fonts not installed into TeX), then
    via kpsewhich in the TeX installation.
  * patch — LuaTeX addresses some glyphs by codepoints the font's cmap does not
    map (GSUB variants, unencoded glyphs, and the Plane-16 rewrites the glyph
    normaliser adds; see transforms.normalise_glyph_addressing). A served font
    missing those entries would draw the wrong glyph or nothing, so the missing
    codepoint→glyph-index entries are added. A font that is actually modified is
    then served under a *renamed*, content-hashed filename (e.g.
    `NewCMMath-Regular.reflowtex-1a2b3c4d.otf`) — so it never masquerades as the
    upstream original (which many font licences require of a modified version),
    and a changed patch busts the browser cache. Unmodified fonts are served
    verbatim under their original name. patch() records the original→served map in
    `self.served`, which the viewer uses to build @font-face.

Both are idempotent: a font already present is not re-copied, patching only
touches files that are actually missing an entry, and the output is byte-
reproducible (fixed timestamp) so an unchanged font keeps a stable hash.

fonttools is required for patching and for the cmap lookups the normaliser uses;
without it, provisioning still works but glyphs the served font cannot address by
codepoint will be wrong. Install it with `pip install fonttools`.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

# Marker in the served filename of a font this pipeline modified (cmap-patched),
# so it never masquerades as the upstream original (GUST/OFL fonts ask that a
# modified version be renamed). The 8-hex content hash that follows it also busts
# the browser cache whenever the patched bytes change on a recompile.
MODIFIED_TAG = 'reflowtex'

try:
    from fontTools.ttLib import TTFont as _TTFont
except ImportError:
    _TTFont = None

import t1_convert as _t1_convert


class Fonts:
    """Resolves, copies, and patches the font files a document needs.

    output_dir     — where served fonts are written (and patched in place).
    local_dir      — optional dir of repo-shipped fonts searched before kpsewhich
                     (for faces deliberately not installed into the TeX tree).
    """

    def __init__(self, output_dir: Path, local_dir: Path | None = None):
        self.output_dir = Path(output_dir)
        self.local_dir = Path(local_dir) if local_dir else None
        # Blocks compile on a thread pool and all resolve glyphs through this
        # cache; the lock keeps two workers from parsing the same font at once
        # and racing on the dict. The work is small and happens once per font.
        self._cmap_cache: dict[str, dict | None] = {}
        self._cmap_lock = threading.Lock()
        # {original filename → served filename}, filled by patch(). A verbatim
        # font maps to itself; a modified one to its renamed, content-hashed file.
        self.served: dict[str, str] = {}
        # Classic 8-bit fonts converted to OTF, keyed by TeX name (e.g. 'cmsy10').
        # {name → (served_filename, {slot → target codepoint})} or None when a font
        # has no convertible outline. Filled lazily by legacy_otf() during the
        # transform pass; the files it writes must survive patch()'s stale sweep.
        self.converted: dict[str, tuple[str, dict[int, int]] | None] = {}
        self._convert_lock = threading.Lock()

    # ── provisioning ─────────────────────────────────────────────────────────
    @staticmethod
    def _copy_atomic(src, dst: Path) -> None:
        """Copy src to dst via a same-directory temp file + atomic rename.

        Blocks compile on a thread pool, and more than one can need the same
        font at once. A plain shutil.copy(src, dst) briefly exposes a
        partially-written dst; a racing thread's `dst.exists()` check can see
        that half-written file, decide provisioning is done, and hand it
        straight to fontTools, which chokes ("not enough data"). Writing to a
        temp name first and renaming into place means dst only ever appears
        once it's complete, so that race window doesn't exist."""
        fd, tmp = tempfile.mkstemp(dir=dst.parent, prefix=f'.{dst.name}.')
        try:
            with os.fdopen(fd, 'wb') as f:
                shutil.copyfileobj(open(src, 'rb'), f)
            os.replace(tmp, dst)
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise

    def provision(self, filenames) -> None:
        """Ensure every named font file exists in output_dir, copying it from the
        local dir or the TeX installation the first time it is needed."""
        self.output_dir.mkdir(parents=True, exist_ok=True)
        for fname in sorted(filenames):
            if not fname:
                continue
            dst = self.output_dir / fname
            if dst.exists():
                continue
            if self.local_dir and (self.local_dir / fname).exists():
                self._copy_atomic(self.local_dir / fname, dst)
                print(f'  font-provision: {fname} ← {self.local_dir / fname}')
                continue
            result = subprocess.run(['kpsewhich', fname], capture_output=True, text=True)
            src = result.stdout.strip()
            if result.returncode != 0 or not src:
                print(f'  font-provision: WARNING — {fname} not found via kpsewhich; '
                      f'the browser will fall back to a system font')
                continue
            self._copy_atomic(src, dst)
            print(f'  font-provision: {fname} ← {src}')

    # ── legacy Type1 → OTF conversion ────────────────────────────────────────
    def legacy_otf(self, name: str) -> tuple[str, dict[int, int]] | None:
        """Convert a classic Type1 font (by TeX name, e.g. 'cmsy10') to a served
        OTF and return (served_filename, {slot → target codepoint}), or None if it
        has no convertible outline (the caller then keeps the metric-box fallback).

        Cached per name — the same face recurs across sizes and blocks — and
        locked, since blocks convert on the compile thread pool. The written file
        is protected from patch()'s stale sweep via self.converted."""
        with self._convert_lock:
            if name in self.converted:
                return self.converted[name]
            self.converted[name] = _t1_convert.convert(name, self.output_dir)
            return self.converted[name]

    # ── cmap lookup (used by the glyph normaliser) ───────────────────────────
    def cmap_gid_lookup(self, filename: str):
        """codepoint → glyph index for a served font, or None if unavailable."""
        with self._cmap_lock:
            if filename in self._cmap_cache:
                return self._cmap_cache[filename]
            lookup = None
            font_path = self.output_dir / filename
            if _TTFont is not None and filename and font_path.exists():
                font = _TTFont(font_path)
                name_to_gid = font.getReverseGlyphMap()
                lookup = {}
                for t in font['cmap'].tables:
                    for cp, gname in t.cmap.items():
                        lookup.setdefault(cp, name_to_gid[gname])
            self._cmap_cache[filename] = lookup
            return lookup

    # ── patching ─────────────────────────────────────────────────────────────
    @staticmethod
    def _mark_internal_modified(font) -> None:
        """Append a marker to the font's own name records so a modified file does
        not identify itself as the upstream original (the @font-face family the
        browser uses is set separately, so this is for honesty, not rendering)."""
        try:
            for rec in font['name'].names:
                try:
                    s = rec.toUnicode()
                except Exception:                       # noqa: BLE001
                    continue
                if rec.nameID in (1, 4, 16):            # family, full, typographic family
                    rec.string = f'{s} (ReflowTeX patched)'
                elif rec.nameID == 6:                   # PostScript name — no spaces
                    rec.string = f'{s}-ReflowTeXPatched'
        except Exception:                               # noqa: BLE001
            pass

    def patch(self, requirements: dict[str, dict[int, int]]) -> None:
        """Add any missing cmap entries to the served fonts, renaming the ones
        actually modified. Fills self.served {original → served filename}.

        requirements maps {filename: {codepoint: glyph_index}} for every glyph
        that appears in any compiled block (see collect_glyph_requirements).
        """
        self.served = {}
        if not requirements:
            return
        self.provision(requirements.keys())
        # Drop renamed fonts from earlier builds; the current set is regenerated
        # below, so their old content hashes would otherwise pile up unreferenced.
        # Keep this build's converted legacy fonts: unlike cmap-patched fonts
        # (regenerated here from their original), a converted font is written
        # during the transform pass and never rebuilt by patch, so sweeping it
        # would leave a dangling reference. Such fonts are referenced by their
        # hashed name in `requirements` (the transform set it as the filename),
        # while patched fonts are referenced by their original name — so requiring
        # the tag in the requirement name selects exactly the converted ones.
        keep = {name for name in requirements if f'.{MODIFIED_TAG}-' in name}
        for stale in self.output_dir.glob(f'*.{MODIFIED_TAG}-*'):
            if stale.name not in keep:
                stale.unlink()

        if _TTFont is None:
            print('  font-patch: skipped (fonttools not installed — pip install fonttools)')
            self.served = {f: f for f in requirements}      # best effort: serve as-is
            return

        for filename, cp_gindex in requirements.items():
            font_path = self.output_dir / filename
            if not font_path.exists():
                self.served[filename] = filename            # provisioning failed; browser falls back
                continue

            # recalcTimestamp=False: keep the source font's head.modified instead
            # of stamping "now", so the patched output is byte-reproducible and its
            # content hash is stable across rebuilds when nothing actually changed.
            font = _TTFont(font_path, recalcTimestamp=False)
            glyph_order = font.getGlyphOrder()

            existing: dict[int, str] = {}
            for t in font['cmap'].tables:
                existing.update(t.cmap)

            missing_cp = {cp: gi for cp, gi in cp_gindex.items() if cp not in existing}
            if not missing_cp:
                self.served[filename] = filename            # verbatim
                print(f'  font-patch: {filename} already complete')
                continue

            # Non-BMP codepoints (U+10000+) require a format-12 table.
            non_bmp_missing = {cp: gi for cp, gi in missing_cp.items() if cp >= 0x10000}
            fmt12 = next(
                (t for t in font['cmap'].tables
                 if t.format == 12 and t.platformID == 3 and t.platEncID == 10),
                None,
            )
            if non_bmp_missing and fmt12 is None:
                self.served[filename] = filename
                print(f'  font-patch: {filename} has no format-12 cmap — '
                      f'cannot add {len(non_bmp_missing)} non-BMP entries, skipping')
                continue

            added = []
            for cp, gindex in sorted(missing_cp.items()):
                table = fmt12 if cp >= 0x10000 else next(
                    (t for t in font['cmap'].tables if t.format == 4), None)
                if table is None:
                    continue
                if gindex >= len(glyph_order):
                    print(f'  font-patch: {filename} glyph index {gindex} out of range — '
                          f'skipping U+{cp:05X}')
                    continue
                gname = glyph_order[gindex]
                table.cmap[cp] = gname
                existing[cp] = gname
                added.append((cp, gname))

            if not added:
                self.served[filename] = filename            # nothing changed → verbatim
                print(f'  font-patch: {filename} already complete')
                continue

            # Modified: mark it, save, then rename to a content-hashed file so it
            # never masquerades as the original and a changed patch busts caches.
            self._mark_internal_modified(font)
            font.save(font_path)
            digest = hashlib.sha256(font_path.read_bytes()).hexdigest()[:8]
            stem, ext = font_path.stem, font_path.suffix
            served = f'{stem}.{MODIFIED_TAG}-{digest}{ext}'
            font_path.replace(self.output_dir / served)     # remove the original-named copy
            self.served[filename] = served
            for cp, gname in added:
                print(f'  font-patch: {filename} + U+{cp:05X} → {gname}')
            print(f'  font-patch: {filename} → {served} ({len(added)} entr'
                  f'{"y" if len(added) == 1 else "ies"} added, renamed)')


    # ── verification ─────────────────────────────────────────────────────────
    def verify(self, requirements: dict[str, dict[int, int]]) -> None:
        """Fail the build if any glyph a block references cannot be drawn from
        the font that will be served for it.

        Every codepoint in `requirements` must have a cmap entry in its served
        font. A miss means the browser would render nothing for that glyph —
        silently, since @font-face has no per-glyph fallback — which is exactly
        the failure that should never reach a deployed page. (It happens, for
        instance, when LuaTeX resolved a font to a different build of the same
        face than the one kpsewhich serves: the glyph indices disagree, every
        glyph is PUA-rewritten, and the served font has none of the codes.)
        """
        if _TTFont is None or not requirements:
            return
        problems = []
        for filename, cp_gindex in requirements.items():
            if not cp_gindex:
                continue
            served = self.served.get(filename, filename)
            font_path = self.output_dir / served
            if not font_path.exists():
                problems.append(f'{filename}: not provisioned (nothing to serve)')
                continue
            cmap = set()
            for t in _TTFont(font_path)['cmap'].tables:
                cmap.update(t.cmap)
            missing = sorted(cp for cp in cp_gindex if cp not in cmap)
            if missing:
                sample = ', '.join(f'U+{cp:05X}' for cp in missing[:5])
                more = f' … (+{len(missing) - 5})' if len(missing) > 5 else ''
                problems.append(f'{filename} (served as {served}): {len(missing)} '
                                f'referenced codepoint(s) missing from its cmap: {sample}{more}')
        if problems:
            raise SystemExit('ERROR: served fonts cannot draw every glyph the blocks '
                             'reference — the page would render blanks:\n  '
                             + '\n  '.join(problems))


def fonts_of(data: dict) -> dict:
    """The font map of an output.json, tolerating the empty-table ambiguity.

    serializer.lua's JSON encoder cannot tell an empty map from an empty array,
    so a block whose capture contains no glyphs at all serialises as "fonts":[]
    rather than {}. Such a block renders as nothing, but it must not abort the
    build for every other block.
    """
    fonts = data.get('fonts', {})
    return fonts if isinstance(fonts, dict) else {}


def collect_glyph_requirements(output_jsons) -> dict[str, dict[int, int]]:
    """Scan compiled output.json data → {filename: {codepoint: glyph_index}}.

    output_jsons is an iterable of already-parsed output.json dicts. Returns the
    full set of glyphs that appear anywhere, which are the entries every served
    font must be able to address.
    """
    requirements: dict[str, dict[int, int]] = {}

    def walk(nodes, font_map):
        for n in nodes:
            if n.get('type') == 'glyph':
                cp = n.get('char')
                gindex = n.get('gindex')
                fname = font_map.get(str(n.get('font', '')))
                if fname and cp is not None and gindex is not None:
                    requirements.setdefault(fname, {})[cp] = gindex
            for key in ('children', 'replace', 'pre', 'post', 'nobreak'):
                if key in n:
                    walk(n[key], font_map)
            if 'leader' in n:
                walk([n['leader']], font_map)

    for data in output_jsons:
        font_map = {fid: info['filename'] for fid, info in fonts_of(data).items()}
        for fname in font_map.values():
            requirements.setdefault(fname, {})
        for para in data.get('paragraphs', []):
            walk(para.get('nodes', []), font_map)
        for item in data.get('content', []):
            if 'box' in item:
                walk(item['box'].get('children', []), font_map)
        for stream in data.get('streams', []):
            for item in stream.get('content', []):
                if 'box' in item:
                    walk(item['box'].get('children', []), font_map)

    return requirements
