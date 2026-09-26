# SPDX-License-Identifier: AGPL-3.0-or-later
"""The render tests' machinery: build a case, serve it, compare it.

A case at a width is three steps, each a tool in tools/pageless-pdf:

  1. pageless.py compiles the document to a pageless PDF – one page as tall
     as the document, every glyph where TeX put it – at the document's own
     width plus `extra` pt;
  2. site_from_run.py builds a viewer page from the run at the document's
     own width (once per case: every width is shown by the same page);
  3. vector_compare.py opens the page in Chromium with its column pinned to
     the PDF's width and matches each glyph the viewer drew with the PDF's.

Builds go to tests/render/build/<case>/ (ignored by git).
"""
import functools, hashlib, http.server, json, os, shutil, subprocess, sys, threading, tomllib
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
TOOLS = REPO / 'tools' / 'pageless-pdf'
BUILD = HERE / 'build'
PY = sys.executable
# Each test's worst offsets, kept on pytest's config for the summary
# (conftest.py): a list of (test id, case, (glyph, rule)).
WORST = pytest.StashKey[list]()


def cases() -> dict:
    """Every case with its settings: cases/*.tex, and cases.toml's sections."""
    conf = tomllib.loads((HERE / 'cases.toml').read_text())
    defaults = conf.pop('defaults', {})
    found = {p.stem: {} for p in sorted((HERE / 'cases').glob('*.tex'))}
    for name, extra in conf.items():
        found.setdefault(name, {}).update(extra)
    out = {}
    for name, extra in found.items():
        c = {**defaults, **extra, 'name': name}
        # the global target; `tolerance` is the case's own ceiling
        c['target'] = defaults['tolerance']
        c['file'] = REPO / c['file'] if 'file' in c else HERE / 'cases' / f'{name}.tex'
        if 'template' in c:
            c['template'] = REPO / c['template']
        out[name] = c
    return out


def run(cmd: list, log: Path) -> None:
    """Run a tool, its output into `log`; on failure, fail with its tail. The
    browser is tests/render's own Playwright (npm ci there), unless
    PLAYWRIGHT_DIR names another."""
    env = dict(os.environ)
    if 'PLAYWRIGHT_DIR' not in env and (HERE / 'node_modules' / 'playwright').exists():
        env['PLAYWRIGHT_DIR'] = str(HERE)
    r = subprocess.run([str(a) for a in cmd], capture_output=True, text=True, cwd=REPO, env=env)
    log.write_text(r.stdout + r.stderr)
    if r.returncode != 0:
        tail = '\n'.join((r.stdout + r.stderr).strip().splitlines()[-25:])
        raise RuntimeError(f'{Path(cmd[1]).name} failed (see {log}):\n{tail}')


def build_dir(case: dict, extra: int) -> Path:
    return BUILD / case['name'] / (f'w{extra:+d}' if extra else 'w0')


def pageless(case: dict, extra: int) -> Path:
    out = build_dir(case, extra)
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    cmd = [PY, TOOLS / 'pageless.py', case['file'], '-o', out, '--passes', case['passes'],
           f'--width-extra={extra}pt']
    if 'template' in case:
        cmd += ['--template', case['template']]
    run(cmd, out / 'pageless.log')
    return out


@functools.lru_cache(maxsize=None)
def site(name: str) -> Path:
    """The viewer page of a case, from its run at its own width (built once)."""
    case = cases()[name]
    base = build_dir(case, 0)
    if not (base / 'pageless.pdf').exists():
        pageless(case, 0)
    out = base / 'site'
    shutil.rmtree(out, ignore_errors=True)
    run([PY, TOOLS / 'site_from_run.py', base, out], base / 'site.log')
    return out


def compare(case: dict, extra: int, url_root: str) -> dict:
    """The PDF at this width against the case's page: vector.json."""
    strip = build_dir(case, extra) if extra else build_dir(case, 0)
    page = site(case['name'])
    if extra:
        pageless(case, extra)
    rel = page.relative_to(BUILD).as_posix()
    out = strip / 'vector'
    run([PY, TOOLS / 'vector_compare.py', strip, f'{url_root}/{rel}/index.html', '--out', out,
         '--line-tol', case['tolerance']], strip / 'compare.log')
    return json.loads((out / 'vector.json').read_text())


class Server:
    """build/ over HTTP on a free port, in a thread, for the session."""
    def __init__(self):
        BUILD.mkdir(exist_ok=True)
        handler = functools.partial(Quiet, directory=str(BUILD))
        self.httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
        self.url = f'http://127.0.0.1:{self.httpd.server_address[1]}'
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def close(self):
        self.httpd.shutdown()


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def worst(v: dict) -> tuple[float, float | None]:
    """The largest offset (pt, across or down) of a matched glyph, and of a
    matched rule (None when the browser drew no rules)."""
    g = max((max(abs(m['dx']), abs(m['dy'])) for m in v['matched']), default=0.0)
    rs = [max(abs(r['dx']), abs(r['dy'])) for r in v['rules'] if 'dx' in r]
    return g, (max(rs) if rs else None)


def problems(v: dict, tolerance: float, rule_tolerance: float | None = None) -> list[str]:
    """What is wrong in a comparison, in words; empty when it passes."""
    out = []
    g = v['glyphs']
    if not g['strip']:
        out.append('the PDF has no glyphs')
    if g['viewer'] != g['strip']:
        out.append(f"the browser drew {g['viewer']} glyphs, TeX {g['strip']}")
    if g['matched'] != g['viewer']:
        out.append(f"{g['viewer'] - g['matched']} of the browser's glyphs have no glyph in the PDF "
                   f"within {v['window_pt']} pt")
    worst = sorted(v['matched'], key=lambda m: -max(abs(m['dx']), abs(m['dy'])))
    off = [m for m in worst if max(abs(m['dx']), abs(m['dy'])) > tolerance]
    if off:
        sample = ', '.join(f"{m['text']!r} at y {m['y']} off by ({m['dx']:+.3f}, {m['dy']:+.3f})" for m in off[:5])
        out.append(f'{len(off)} glyphs off by more than {tolerance} pt: {sample}')
    unmatched_rules = [r for r in v['rules'] if r.get('unmatched')]
    if unmatched_rules:
        out.append(f'{len(unmatched_rules)} rules drawn by the browser are not in the PDF')
    rt = tolerance if rule_tolerance is None else rule_tolerance
    rules_off = sorted((r for r in v['rules'] if 'dx' in r and max(abs(r['dx']), abs(r['dy'])) > rt),
                       key=lambda r: -max(abs(r['dx']), abs(r['dy'])))
    if rules_off:
        sample = ', '.join(f"at y {r['y']} ({r['dx']:+.3f}, {r['dy']:+.3f})" for r in rules_off[:5])
        out.append(f'{len(rules_off)} rules off by more than {rt} pt: {sample}')
    return out
