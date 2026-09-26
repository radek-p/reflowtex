// SPDX-License-Identifier: AGPL-3.0-or-later
// The web tests' machinery: build the fixture pages, and what the tests
// measure in a page.
//
// Each fixture is pages/<name>/: LaTeX snippets (and a preamble.tex), built
// into one page by the vanilla integration – what a site without a framework
// gets – into build/<name>/. Then, as a site would, the page's own code is
// added: pages/<name>/head.html before </head>, body.html before </body>;
// and, if pages/<name>/companion exists, the companion package's browser side
// (installed by the vanilla build: src/companion, Preact bundled in) with an import map naming it
// 'reflowtex/companion'. A pages/<name>/build-args file gives the build more
// options (--a11y).
/// <reference lib="dom" />
import { execFile } from 'node:child_process';
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, '../..');
const PAGES = join(HERE, 'pages');
export const BUILD = join(HERE, 'build');

export const names = (): string[] => readdirSync(PAGES, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name).sort();

/** Run a command; its output goes to `log`; a failure says where to look. */
async function run(cmd: string, args: string[], log: string): Promise<void> {
  try {
    const { stdout, stderr } = await promisify(execFile)(cmd, args, { cwd: REPO, maxBuffer: 1 << 28 });
    appendFileSync(log, stdout + stderr);
  } catch (e) {
    const { stdout = '', stderr = '' } = e as { stdout?: string; stderr?: string };
    appendFileSync(log, stdout + stderr);
    throw new Error(`${basename(args[0] ?? cmd)} failed (see ${log}):\n${(stdout + stderr).trim().split('\n').slice(-20).join('\n')}`);
  }
}

/** Build pages/<name>; return its folder. */
export async function build(name: string): Promise<string> {
  const src = join(PAGES, name), out = join(BUILD, name), log = join(BUILD, `${name}.log`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(BUILD, { recursive: true });
  writeFileSync(log, '');
  // a page's build-args file: more options for the build (--a11y)
  const extra = existsSync(join(src, 'build-args')) ? readFileSync(join(src, 'build-args'), 'utf8').split(/\s+/).filter(Boolean) : [];
  await run('node', [join(REPO, 'integrations/vanilla/build.ts'), src, '-o', out, '--title', name, ...extra], log);
  const page = join(out, 'index.html');
  let html = readFileSync(page, 'utf8');
  let head = existsSync(join(src, 'head.html')) ? readFileSync(join(src, 'head.html'), 'utf8') : '';
  if (existsSync(join(src, 'companion'))) {
    // The vanilla build installs the companion's files (installViewer); the
    // page turns it on, as a site does.
    head = '<script type="importmap">{"imports": {"reflowtex/companion": "./companion/companion.js"}}</script>\n' +
      '<link rel="stylesheet" href="companion/companion.css">\n' + head;
  }
  // replaced by a function, so no $ in the page's own code is taken for a pattern
  if (head) html = html.replace('</head>', () => head + '</head>');
  if (existsSync(join(src, 'body.html'))) html = html.replace('</body>', () => readFileSync(join(src, 'body.html'), 'utf8') + '</body>');
  writeFileSync(page, html);
  return out;
}

/** The Hugo fixture site (hugo-site/), as a Hugo user builds theirs: the
 *  integration's shortcode and viewer partial copied into layouts/,
 *  prebuild.ts, then hugo – with the site under a subpath, /hugo/, as a
 *  project site on GitHub Pages is. Served from build/hugo/. */
export async function buildHugo(): Promise<string> {
  const src = join(BUILD, 'hugo-src'), out = join(BUILD, 'hugo'), log = join(BUILD, 'hugo.log');
  rmSync(src, { recursive: true, force: true });
  rmSync(out, { recursive: true, force: true });
  mkdirSync(BUILD, { recursive: true });
  writeFileSync(log, '');
  cpSync(join(HERE, 'hugo-site'), src, { recursive: true });
  for (const rel of ['shortcodes/latex.html', 'partials/reflowtex-viewer.html']) {
    mkdirSync(dirname(join(src, 'layouts', rel)), { recursive: true });
    copyFileSync(join(REPO, 'integrations/hugo/layouts', rel), join(src, 'layouts', rel));
  }
  await run('node', [join(REPO, 'integrations/hugo/prebuild.ts'), src], log);
  await run('hugo', ['--source', src, '--destination', out, '--baseURL', '/hugo/'], log);
  return out;
}

// ── In the page ─────────────────────────────────────────────────────────────

/** The viewer's API on window (see src/viewer). */
declare global { const reflowtex: any; interface Window { [k: string]: any } }

/** Every block laid out and its visible lines drawn: each .latex-block holds
 *  an <svg> with glyphs. */
export const READY = () => {
  const blocks = [...document.querySelectorAll('.latex-block[data-nodelist-b64]')];
  return blocks.length > 0 && blocks.every(b => b.querySelector('svg text tspan'));
};

/** The distinct baselines of a block's text lines (rounded to 0.5 px). */
export const LINES = (block: Element): number[] => {
  const ys = new Set<number>();
  for (const t of block.querySelectorAll('svg text tspan')) {
    const p = (t as SVGGraphicsElement).ownerSVGElement!.createSVGPoint(); p.y = parseFloat(t.getAttribute('y')!);
    ys.add(Math.round(p.matrixTransform((t as SVGGraphicsElement).getScreenCTM()!).y * 2) / 2);
  }
  return [...ys].sort((a, b) => a - b);
};
