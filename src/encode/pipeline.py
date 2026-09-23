#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
r"""reflowtex build pipeline — framework-agnostic.

Turns a LaTeX snippet into the protobuf blob the browser viewer renders, and
provisions the fonts it needs. Integrations (vanilla, Hugo, Jekyll, …) drive this
class; it knows nothing about any of them.

    from pipeline import Pipeline
    pipe = Pipeline(build_root='build', fonts_dir='site/fonts')
    blob = pipe.compile(content=r'$e^{i\pi}+1=0$')     # bytes, ready to embed
    pipe.patch_fonts()                                 # after all blocks
    schema = pipe.schema_bytes()                       # embed alongside the blobs

One snippet → one `build/<key>/` directory holding input.tex, the lualatex run,
output.json and nodelist.pb, so a rebuild can skip unchanged snippets and the
intermediate artefacts are there to inspect when something looks wrong.

Requires: lualatex, Ghostscript (gs), dvisvgm, protoc on PATH; the Python packages in
requirements.txt (protobuf, fonttools).
"""

from __future__ import annotations

import base64
import hashlib
import json
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

SRC_ROOT     = Path(__file__).resolve().parent.parent      # reflowtex/src
EXTRACT_DIR  = SRC_ROOT / 'extract'
SCHEMA_DIR   = SRC_ROOT / 'schema'
ENCODE_DIR   = SRC_ROOT / 'encode'

DEFAULT_TEMPLATE   = EXTRACT_DIR / 'template.tex'
DEFAULT_SERIALIZER = EXTRACT_DIR / 'serializer.lua'
DEFAULT_PROTO      = SCHEMA_DIR / 'latex.proto'

# encode_pb / transforms / fonts import each other and latex_pb2 by bare name.
sys.path.insert(0, str(ENCODE_DIR))

PREAMBLE_MARK = '%%PREAMBLE%%'
CONTENT_MARK  = '%%CONTENT%%'
WIDTH_EXTRA_MARK = '%%WIDTH-EXTRA-SP%%'

# Wide display samples use an additive step, not 2x/3x multipliers: this keeps
# successive fits well-conditioned without approaching TeX's \maxdimen quickly.
DISPLAY_SAMPLE_STEP_SP = 128 * 65536
TEX_MAX_DIMEN_SP = 1073741823


# ── Viewer assets ────────────────────────────────────────────────────────────
VIEWER_DIR = Path(__file__).resolve().parent.parent / 'viewer'


def viewer_script() -> Path:
    """The latex-viewer.js file an integration should ship: the committed
    minified copy when it was generated from the current source, otherwise the
    source itself. The minified file's first line records the SHA-256 of the
    source it was built from (see `make minify-viewer`), so a stale copy is
    detected here rather than shipped — forgetting to regenerate it costs
    bytes, never correctness. Ship it under the name latex-viewer.js either
    way: the DOM contract, the fonts resolved relative to the script URL, and
    the ?v= cache-buster all key off that name."""
    src = VIEWER_DIR / 'latex-viewer.js'
    minified = VIEWER_DIR / 'latex-viewer.min.js'
    if minified.exists():
        import hashlib
        with minified.open('r', encoding='utf-8') as f:
            header = f.readline()
        want = hashlib.sha256(src.read_bytes()).hexdigest()
        if f'sha256 {want}' in header:
            return minified
        print('  viewer: latex-viewer.min.js is stale (source changed since it was '
              'generated) — shipping the unminified source; run `make minify-viewer`')
    return src


def content_key(content: str, preamble: str = '') -> str:
    """Stable 16-hex cache key for a (content, preamble) pair. Integrations that
    want incremental rebuilds can name each block's artefacts by this."""
    normalised = content.strip()
    if preamble:
        normalised = preamble + '\n===REFLOWTEX-PREAMBLE-BOUNDARY===\n' + normalised
    return hashlib.sha256(normalised.encode('utf-8')).hexdigest()[:16]


class Pipeline:
    def __init__(self, build_root, fonts_dir, *,
                 local_fonts_dir=None,
                 template=DEFAULT_TEMPLATE,
                 serializer=DEFAULT_SERIALIZER,
                 proto=DEFAULT_PROTO):
        # Resolved to absolute: per-block build dirs are handed to subprocesses
        # (lualatex, dvisvgm) with cwd set, so a relative path would be
        # re-interpreted against the child's cwd and break.
        self.build_root = Path(build_root).resolve()
        self.template = Path(template)
        self.serializer = Path(serializer)
        self.proto = Path(proto)

        # Imported here (not at module load) so a clear error is raised if the
        # deps are missing, and after sys.path is set up above.
        import fonts as _fonts
        self._fonts_mod = _fonts
        self.fonts = _fonts.Fonts(Path(fonts_dir).resolve(),
                                  Path(local_fonts_dir).resolve() if local_fonts_dir else None)

        self._ensure_pb2()
        self._extra_fonts = list(sorted((local_fonts_dir and Path(local_fonts_dir).glob('*.otf')) or []))

    # ── schema ────────────────────────────────────────────────────────────────
    def _ensure_pb2(self):
        """Regenerate latex_pb2.py from the .proto when missing or stale, so the
        encoder is always in step with the schema of record."""
        pb2 = ENCODE_DIR / 'latex_pb2.py'
        if pb2.exists() and pb2.stat().st_mtime >= self.proto.stat().st_mtime:
            return
        try:
            subprocess.run(
                ['protoc', f'--proto_path={self.proto.parent}',
                 f'--python_out={ENCODE_DIR}', self.proto.name],
                check=True)
        except FileNotFoundError:
            sys.exit('protoc not found — install it (e.g. "apt-get install protobuf-compiler")')
        print(f'  protoc: regenerated {pb2.name}')

    def schema_bytes(self) -> bytes:
        """The .proto text the browser parses at runtime (embed it once per page)."""
        return self.proto.read_bytes()

    def schema_b64(self) -> str:
        return base64.b64encode(self.schema_bytes()).decode()

    # ── one snippet ─────────────────────────────────────────────────────────────
    def compile(self, content: str, preamble: str = '', key: str | None = None,
                passes: int = 1, name: str | None = None) -> bytes:
        """Compile one snippet → protobuf blob (bytes). Also writes build/<key>/
        (input.tex, output.json, nodelist.pb) and provisions its fonts.

        `name` is how the caller knows the snippet — a filename, a page and line —
        and is what progress lines and errors are labelled with, alongside the
        key (which is also the build directory's name). It never affects the
        build itself.

        passes>1 runs lualatex repeatedly in the same build dir so the .aux round-
        trip resolves \\ref/\\pageref/\\cite (a self-contained snippet needs only
        one; a document with cross-references needs two or three)."""
        import transforms
        import encode_pb

        key = key or content_key(content, preamble)
        label = f'{name} ({key})' if name else key
        build_dir = self.build_root / key
        build_dir.mkdir(parents=True, exist_ok=True)
        # A caller may have configured PGF externalisation with this conventional
        # prefix. The template disables it before content and captures finished
        # boxes instead, but creating the directory keeps such preambles valid.
        (build_dir / 'pics').mkdir(exist_ok=True)

        template_text = self.template.read_text()

        def write_input(width_extra_sp: int) -> None:
            tex = (template_text
                   .replace(PREAMBLE_MARK, preamble)
                   .replace(CONTENT_MARK, content)
                   .replace(WIDTH_EXTRA_MARK, str(width_extra_sp)))
            (build_dir / 'input.tex').write_text(tex, encoding='utf-8')

        # Always refresh: a stale serializer copy would silently produce output
        # missing newer features.
        shutil.copy(self.serializer, build_dir / 'serializer.lua')
        # Repo-local fonts sit next to input.tex so fontspec finds them by bare
        # filename — no absolute path baked into a preamble.
        for otf in self._extra_fonts:
            dst = build_dir / otf.name
            if not dst.exists() or dst.stat().st_mtime < otf.stat().st_mtime:
                shutil.copy(otf, dst)

        # A display-bearing snippet is compiled at an additive sequence of
        # widths. Keep a sliding three-sample window; a topology change or a
        # non-affine field rejects only its smallest width, then sampling moves
        # upward. Text-only snippets retain the ordinary single compilation.
        import display_model
        samples = []
        first_sample = None            # the document at its own width
        sample_index = 0
        while True:
            width_extra_sp = sample_index * DISPLAY_SAMPLE_STEP_SP
            write_input(width_extra_sp)
            self._run_lualatex(build_dir, label, passes if sample_index == 0 else 1)
            data = json.loads((build_dir / 'output.json').read_text())
            if not display_model.has_displays(data):
                break
            if first_sample is None:
                first_sample = data
            reported_width = int(data.get('source_width', 0))
            if reported_width <= 0:
                sys.exit(f'ERROR: display-bearing template {self.template} did not report '
                         f'a positive source width (is {WIDTH_EXTRA_MARK} and the '
                         f'Serializer.note_source_width hook missing?)')
            if samples and reported_width <= int(samples[-1].get('source_width', 0)):
                sys.exit(f'ERROR: display sample width did not increase for block {label}: '
                         f'{samples[-1].get("source_width")}, {reported_width}')
            samples.append(data)
            if len(samples) >= 3:
                ok, reason = display_model.check_samples(*samples[-3:])
                if ok:
                    widths = (f'{samples[-3]["source_width"] / 65536:g}, '
                              f'{samples[-2]["source_width"] / 65536:g}, '
                              f'{samples[-1]["source_width"] / 65536:g} pt')
                    if samples[-3] is first_sample:
                        data = display_model.attach_model(samples[-3], samples[-2], samples[-1])
                        print(f'  {label}: display model stable at {widths}')
                    else:
                        # The document's own width fell outside the affine law;
                        # it is still the width the page must match exactly.
                        data, fixed = display_model.anchor_model(first_sample, samples[-2], samples[-1])
                        print(f'  {label}: display model stable at {widths}, anchored at the document\'s '
                              f'{first_sample["source_width"] / 65536:g} pt'
                              + (f'; {fixed} display(s) of a different shape there stay fixed' if fixed else ''))
                    (build_dir / 'output.json').write_text(json.dumps(data))
                    break
                rejected = samples[-3]['source_width'] / 65536
                print(f'  {label}: rejected display sample at {rejected:g} pt: {reason}')
                samples = samples[-2:]
            if int(data.get('source_width', 0)) + DISPLAY_SAMPLE_STEP_SP >= TEX_MAX_DIMEN_SP:
                sys.exit(f'ERROR: no stable affine display topology before \\maxdimen '
                         f'for block {label}')
            sample_index += 1

        n_dropped   = transforms.drop_unreferenced_paragraphs(data)
        n_pictures  = transforms.convert_pictures(data, build_dir)
        n_stripped  = transforms.strip_unsupported_nodes(data)
        # Legacy fonts first: it sets 'unknown' fonts' filenames to the OTFs it
        # produces, so the glyph normaliser and the font provisioner that follow
        # see real files rather than warning on 'unknown'.
        n_legacy    = transforms.normalise_legacy_font_addressing(data, self.fonts)
        n_rewritten = transforms.normalise_glyph_addressing(data, self.fonts)
        if n_stripped or n_rewritten or n_pictures or n_legacy or n_dropped:
            (build_dir / 'output.json').write_text(json.dumps(data))
            bits = []
            if n_dropped:   bits.append(f'dropped {n_dropped} unreferenced paragraph(s)')
            if n_stripped:  bits.append(f'stripped {n_stripped} node(s)')
            if n_rewritten: bits.append(f'rewrote {n_rewritten} glyph(s) to PUA')
            if n_legacy:    bits.append(f'converted legacy fonts, {n_legacy} glyph(s) to PUA')
            if n_pictures:  bits.append(f'converted {n_pictures} picture(s)')
            print(f'  {label}: ' + ', '.join(bits))

        blob = encode_pb.build_document(data).SerializeToString()
        (build_dir / 'nodelist.pb').write_bytes(blob)
        return blob

    def _run_lualatex(self, build_dir: Path, label: str, passes: int = 1) -> None:
        # TikZ capture itself no longer invokes a sub-run. Keep shell escape for
        # compatibility with caller preambles that already relied on it. Repeated
        # passes reuse the build dir's .aux, so references resolve; the last
        # pass's output.json wins.
        output_json = build_dir / 'output.json'
        output_json.unlink(missing_ok=True)
        result = None
        for _ in range(max(1, passes)):
            result = subprocess.run(
                ['lualatex', '-shell-escape', '-interaction=nonstopmode', 'input.tex'],
                cwd=build_dir, capture_output=True, text=True)
        log = build_dir / 'input.log'
        if not output_json.exists():
            detail = log.read_text() if log.exists() else result.stdout + result.stderr
            sys.exit(f'ERROR: lualatex failed for block {label}:\n{detail[-3000:]}')

        # A TeX error is fatal even though nonstopmode carried on and produced a
        # node list, because what it produces is a *repaired* document rather than
        # the one that was written — it still compiles, still renders, and is
        # simply wrong. The only signal is this log line.
        errors = [l for l in log.read_text(encoding='utf-8', errors='replace').splitlines()
                  if l.startswith('! ')]
        if errors:
            uniq = list(dict.fromkeys(errors))
            sys.exit(f'ERROR: lualatex reported {len(errors)} error(s) for block {label} '
                     f'(nonstopmode continued, so the node list would be silently wrong):\n'
                     + '\n'.join(f'  {e}' for e in uniq[:10])
                     + f'\n  see {log}')

    # ── batch helpers ───────────────────────────────────────────────────────────
    def compile_many(self, snippets: list[tuple], jobs: int = 1) -> dict[str, bytes]:
        """Compile [(key, content, preamble[, name]), …] across a thread pool
        (lualatex releases the GIL). Returns {key: blob}. Raises on the first
        failure. `name` labels the snippet in output (see compile)."""
        if not snippets:
            return {}
        jobs = max(1, min(jobs, len(snippets)))
        results: dict[str, bytes] = {}

        def one(job):
            key, content, preamble, *rest = job
            return key, self.compile(content, preamble, key=key, name=rest[0] if rest else None)

        if jobs > 1:
            # Warm the shared luaotfload font cache with one block before fanning
            # out; on a cold cache every worker would rebuild it at once and race.
            first, *rest = snippets
            k, blob = one(first)
            results[k] = blob
        else:
            rest = snippets
        with ThreadPoolExecutor(max_workers=jobs) as pool:
            for k, blob in pool.map(one, rest):
                results[k] = blob
        return results

    def patch_fonts(self, output_jsons=None) -> None:
        """Add missing cmap entries to the served fonts. Call once after all
        snippets are compiled. Without an explicit list it scans build_root."""
        if output_jsons is None:
            output_jsons = []
            for d in sorted(self.build_root.glob('*/output.json')):
                output_jsons.append(json.loads(d.read_text()))
        reqs = self._fonts_mod.collect_glyph_requirements(output_jsons)
        self.fonts.patch(reqs)
        self.fonts.verify(reqs)

    def font_map(self) -> dict[str, str]:
        """{original filename → served filename} after patch_fonts(). The viewer
        loads a font by its original name (its identity) but fetches it from the
        served name, which for a modified font is renamed + content-hashed."""
        return dict(self.fonts.served)
