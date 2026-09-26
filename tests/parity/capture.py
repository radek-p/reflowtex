# SPDX-License-Identifier: AGPL-3.0-or-later
"""Record what the Python pipeline's pure steps are given and give back, for the
TypeScript parity tests (tests/parity/README.md). Temporary: it goes with the
Python.

    python3 tests/parity/capture.py <capture dir> <build script> [its arguments …]

Runs the build script (integrations/hugo/prebuild.py, integrations/vanilla/
build.py, examples/testmath/build.py) with the pipeline's modules wrapped.
Per block (<capture dir>/<key>/), numbered in call order:
  NNN-compile.json         a compile()/compile_batch() call's arguments and the
  NNN-compile_batch.json   pipeline's configuration (the first file of a block)
  NNN-lualatex.json        the serializer's own output of each LuaTeX run
  NNN-<function>.json      {args (as given), result, after (mutated args)} of
                           each display_model and transforms function called
  legacy-fonts.json        (<capture dir>/) each Type 1 conversion's result
  _site/NNN-patch_fonts.json  the build root, fonts directory and served map
                           of each patch_fonts call
"""
import copy, functools, json, runpy, sys, threading
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'src/encode'))
import display_model, fonts, pipeline, transforms          # noqa: E402

CAP = Path(sys.argv[1]).resolve()
CAP.mkdir(parents=True, exist_ok=True)
tls = threading.local()
lock = threading.Lock()
legacy: dict = {}


def snap(x):
    """A JSON-able deep copy (build dirs and Fonts objects become strings)."""
    if isinstance(x, (dict, list, str, int, float, bool)) or x is None:
        return json.loads(json.dumps(x))
    if isinstance(x, Path):
        return str(x)
    if isinstance(x, tuple):
        return [snap(v) for v in x]
    if isinstance(x, fonts.Fonts):
        return {'fonts_dir': str(x.output_dir)}
    return repr(x)


def record(name: str, payload: dict) -> None:
    key = getattr(tls, 'key', None) or '_nokey'
    d = CAP / key
    with lock:
        d.mkdir(exist_ok=True)
        n = len(list(d.glob('*.json')))
        (d / f'{n:03d}-{name}.json').write_text(json.dumps(payload))


def wrap(module, name: str, mutating: bool = False) -> None:
    orig = getattr(module, name)

    @functools.wraps(orig)
    def inner(*args, **kw):
        before = [snap(a) for a in args]
        probes = {}
        if name == 'wide_variants':                     # replayed from the record
            real = args[3]
            def probe(w):
                r = real(w)
                probes[str(w)] = snap(r)
                return r
            args = (*args[:3], probe)
        result = orig(*args, **kw)
        payload = {'args': before, 'result': snap(result)}
        if mutating:
            payload['after'] = [snap(a) for a in args]
        if probes:
            payload['probes'] = probes
        record(name, payload)
        return result
    setattr(module, name, inner)


for fn in ('wants_model', 'check_samples'):
    wrap(display_model, fn)
for fn in ('attach_model', 'anchor_model', 'wide_variants'):
    wrap(display_model, fn, mutating=True)
for fn in ('drop_unreferenced_paragraphs', 'convert_pictures', 'strip_unsupported_nodes',
           'normalise_legacy_font_addressing', 'normalise_glyph_addressing', 'batch_parts'):
    wrap(transforms, fn, mutating=True)

orig_compile_data = pipeline.Pipeline._compile_data


def compile_data(self, content, preamble='', key=None, passes=1, name=None):
    tls.key = key or pipeline.content_key(content, preamble)
    return orig_compile_data(self, content, preamble, key, passes, name)


pipeline.Pipeline._compile_data = compile_data


def config(self) -> dict:
    return {'template': str(self.template), 'serializer': str(self.serializer),
            'search_dirs': [str(d) for d in self.search_dirs], 'fonts_dir': str(self.fonts.output_dir),
            'local_fonts_dir': str(self.fonts.local_dir) if self.fonts.local_dir else None}


orig_compile = pipeline.Pipeline.compile


def compile_(self, content, preamble='', key=None, passes=1, name=None):
    k = key or pipeline.content_key(content, preamble)
    tls.key = k
    record('compile', {'content': content, 'preamble': preamble, 'key': key, 'passes': passes, 'name': name, **config(self)})
    return orig_compile(self, content, preamble, key, passes, name)


pipeline.Pipeline.compile = compile_
orig_batch = pipeline.Pipeline.compile_batch


def compile_batch(self, parts, preamble='', key=None, passes=1, name=None):
    joined = '\n'.join(f'\\reflowtexbatchpart{{{i}}}\n{p[1]}' for i, p in enumerate(parts, 1))
    tls.key = key or pipeline.content_key(joined, preamble)
    record('compile_batch', {'parts': [list(p) for p in parts], 'preamble': preamble, 'key': key, 'passes': passes,
                             'name': name, **config(self)})
    return orig_batch(self, parts, preamble, key, passes, name)


pipeline.Pipeline.compile_batch = compile_batch
orig_run = pipeline.Pipeline._run_lualatex


def run_lualatex(self, build_dir, label, passes=1):
    orig_run(self, build_dir, label, passes)
    record('lualatex', {'output': json.loads((Path(build_dir) / 'output.json').read_text()),
                        'build_dir': str(build_dir), 'passes': passes})


pipeline.Pipeline._run_lualatex = run_lualatex
orig_patch_fonts = pipeline.Pipeline.patch_fonts


def patch_fonts(self, output_jsons=None, subset=True):
    orig_patch_fonts(self, output_jsons, subset)
    tls.key = '_site'
    record('patch_fonts', {'build_root': str(self.build_root), 'fonts_dir': str(self.fonts.output_dir),
                           'local_dir': str(self.fonts.local_dir) if self.fonts.local_dir else None,
                           'subset': subset, 'served': dict(self.fonts.served),
                           'explicit': output_jsons is not None})


pipeline.Pipeline.patch_fonts = patch_fonts
orig_legacy = fonts.Fonts.legacy_otf


def legacy_otf(self, name):
    r = orig_legacy(self, name)
    with lock:
        legacy[name] = snap(r)
        (CAP / 'legacy-fonts.json').write_text(json.dumps(legacy))
    return r


fonts.Fonts.legacy_otf = legacy_otf

script = sys.argv[2]
sys.argv = [script, *sys.argv[3:]]
runpy.run_path(script, run_name='__main__')
