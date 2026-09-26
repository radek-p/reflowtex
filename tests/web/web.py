# SPDX-License-Identifier: AGPL-3.0-or-later
"""The web tests' machinery: build the fixture pages, serve them.

Each fixture is pages/<name>/: LaTeX snippets (and a preamble.tex), built
into one page by the vanilla integration – what a site without a framework
gets – into build/<name>/. Then, as a site would, the page's own code is
added: pages/<name>/head.html before </head>, body.html before </body>;
and, if pages/<name>/companion exists, the companion package's browser side
(src/companion, with the Preact it imports) and an import map naming it
'reflowtex/companion'.
"""
import functools, http.server, shutil, subprocess, sys, threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
PAGES = HERE / 'pages'
BUILD = HERE / 'build'


def names() -> list[str]:
    return sorted(p.name for p in PAGES.iterdir() if p.is_dir())


@functools.lru_cache(maxsize=None)
def build(name: str) -> Path:
    """Build pages/<name> once per session; return its folder."""
    src, out = PAGES / name, BUILD / name
    shutil.rmtree(out, ignore_errors=True)
    r = subprocess.run(['node', REPO / 'integrations' / 'vanilla' / 'build.ts', src, '-o', out,
                        '--title', name], capture_output=True, text=True, cwd=REPO)
    (BUILD / f'{name}.log').write_text(r.stdout + r.stderr)
    if r.returncode != 0:
        raise RuntimeError(f'building {name} failed (see {BUILD / f"{name}.log"}):\n'
                           + '\n'.join((r.stdout + r.stderr).strip().splitlines()[-20:]))
    page = out / 'index.html'
    html = page.read_text()
    head = (src / 'head.html').read_text() if (src / 'head.html').exists() else ''
    if (src / 'companion').exists():
        comp = out / 'companion'
        comp.mkdir()
        for f in (REPO / 'src' / 'companion' / 'companion.js', REPO / 'src' / 'companion' / 'companion.css',
                  REPO / 'src' / 'inspector' / 'vendor' / 'preact.js'):
            shutil.copy(f, comp / f.name)
        head = ('<script type="importmap">{"imports": {"reflowtex/companion": "./companion/companion.js"}}</script>\n'
                '<link rel="stylesheet" href="companion/companion.css">\n') + head
    if head:
        html = html.replace('</head>', head + '</head>', 1)
    if (src / 'body.html').exists():
        html = html.replace('</body>', (src / 'body.html').read_text() + '</body>', 1)
    page.write_text(html)
    return out


@functools.lru_cache(maxsize=None)
def build_hugo() -> Path:
    """The Hugo fixture site (hugo-site/), as a Hugo user builds theirs: the
    integration's shortcode and viewer partial copied into layouts/,
    prebuild.ts, then hugo – with the site under a subpath, /hugo/, as a
    project site on GitHub Pages is. Served from build/hugo/."""
    src, out = BUILD / 'hugo-src', BUILD / 'hugo'
    shutil.rmtree(src, ignore_errors=True)
    shutil.rmtree(out, ignore_errors=True)
    shutil.copytree(HERE / 'hugo-site', src)
    integ = REPO / 'integrations' / 'hugo' / 'layouts'
    for rel in ('shortcodes/latex.html', 'partials/reflowtex-viewer.html'):
        (src / 'layouts' / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(integ / rel, src / 'layouts' / rel)
    log = BUILD / 'hugo.log'
    for cmd in (['node', REPO / 'integrations' / 'hugo' / 'prebuild.ts', src],
                ['hugo', '--source', src, '--destination', out, '--baseURL', '/hugo/']):
        r = subprocess.run([str(a) for a in cmd], capture_output=True, text=True, cwd=REPO)
        with log.open('a') as f:
            f.write(r.stdout + r.stderr)
        if r.returncode != 0:
            raise RuntimeError(f'{Path(cmd[1]).name} failed (see {log}):\n'
                               + '\n'.join((r.stdout + r.stderr).strip().splitlines()[-20:]))
    return out


class Server:
    """build/ over HTTP on a free port, in a thread."""
    def __init__(self):
        BUILD.mkdir(exist_ok=True)
        handler = functools.partial(Quiet, directory=str(BUILD))
        # A page asks for many fonts at once: more than the default backlog
        # of 5, which resets the rest.
        http.server.ThreadingHTTPServer.request_queue_size = 128
        self.httpd = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
        self.url = f'http://127.0.0.1:{self.httpd.server_address[1]}'
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def page_url(self, name: str) -> str:
        if name.startswith('hugo/'):           # a page of the Hugo site: hugo/<path>/
            build_hugo()
            return f'{self.url}/{name}'
        build(name)
        return f'{self.url}/{name}/index.html'

    def close(self):
        self.httpd.shutdown()


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


# ── In the page ─────────────────────────────────────────────────────────────
# Every block laid out and its visible lines drawn: each .latex-block holds an
# <svg> with glyphs.
READY = """() => {
  const blocks = [...document.querySelectorAll('.latex-block[data-nodelist-b64]')];
  return blocks.length > 0 && blocks.every(b => b.querySelector('svg text tspan'));
}"""

# A glyph's baseline in the window, from its own coordinates.
BASELINE_JS = """el => {
  const p = el.ownerSVGElement.createSVGPoint(); p.y = parseFloat(el.getAttribute('y'));
  return p.matrixTransform(el.getScreenCTM()).y;
}"""

# The distinct baselines of a block's text lines (rounded to 0.5 px).
LINES_JS = """block => {
  const ys = new Set();
  for (const t of block.querySelectorAll('svg text tspan')) {
    const p = t.ownerSVGElement.createSVGPoint(); p.y = parseFloat(t.getAttribute('y'));
    ys.add(Math.round(p.matrixTransform(t.getScreenCTM()).y * 2) / 2);
  }
  return [...ys].sort((a, b) => a - b);
}"""
