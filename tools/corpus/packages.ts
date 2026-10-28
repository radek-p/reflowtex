// SPDX-License-Identifier: AGPL-3.0-or-later
// The packages a paper loads, read off its source, and the few that set it
// apart in the set ("notable"), which the website lists beside it.
//
// Read off the source: \documentclass and every \usepackage and
// \RequirePackage in the main file and the files it \input's, \include's or
// \subfile's, in order, comments left out. A package whose .sty ships with the
// paper is its own (a venue's style, the authors' macros), not a package of
// TeX Live's, and is left out.
//
// Notable: the paper's class, then up to MAX_NOTABLE of its packages that
// fewer than RARE_SHARE of the set's papers load, rarest first (in the
// paper's own order among equals), leaving out UNIVERSAL: those nearly every
// paper loads or that only set up fonts and input.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';

export const MAX_NOTABLE = 4;
export const RARE_SHARE = 1 / 3;
export const UNIVERSAL = new Set(['amsmath', 'amssymb', 'amsthm', 'amsfonts', 'graphicx', 'graphics', 'hyperref', 'xcolor', 'color',
  'inputenc', 'fontenc', 'url', 'geometry', 'babel', 'lmodern', 'textcomp', 'ifthen', 'calc', 'xspace']);

export interface Loaded { class: string; packages: string[] }

/** \cmd[opt]{a,b} → [a, b], for each such command in the text (comments removed first). */
function args(text: string, cmd: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`\\\\${cmd}\\s*(?:\\[[^\\]]*\\]\\s*)*\\{([^}]*)\\}`, 'g');
  for (const m of text.matchAll(re)) for (const a of m[1].split(',')) { const s = a.trim(); if (s) out.push(s); }
  return out;
}
export const stripComments = (t: string): string => t.replace(/(^|[^\\])%.*$/gm, '$1');
/** Verbatim text (examples of LaTeX shown in the paper) taken out: what it shows is not loaded. */
export const stripVerbatim = (t: string): string => t
  .replace(/\\begin\{(verbatim\*?|Verbatim|lstlisting|minted|example|code|lscommand)\}[\s\S]*?\\end\{\1\}/g, '')
  .replace(/\\verb\*?([^a-zA-Z\s])[^\n]*?\1/g, '');
const PACKAGE = /^[A-Za-z][A-Za-z0-9._-]*$/;

function files(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else out.push(relative(dir, p).split(sep).join('/')); } };
  walk(dir);
  return out;
}

/** What the paper in `root` loads, starting from `main`. */
export function loaded(root: string, main: string): Loaded {
  const all = files(root);
  const shipped = new Set(all.filter(f => f.endsWith('.sty')).map(f => posix.basename(f, '.sty')));
  const seen = new Set<string>(), order: string[] = [];
  let cls = '';
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = stripVerbatim(stripComments(readFileSync(join(root, file), 'latin1')));
    if (!cls) cls = args(text, 'documentclass')[0] ?? '';
    // packages and inputs in the order they come
    const re = /\\(usepackage|RequirePackage|input|include|subfile)\b\s*(?:\[[^\]]*\]\s*)*\{([^}]*)\}/g;
    for (const m of text.matchAll(re)) {
      if (m[1] === 'usepackage' || m[1] === 'RequirePackage') {
        for (const a of m[2].split(',')) { const s = a.trim(); if (PACKAGE.test(s) && !order.includes(s)) order.push(s); }
        continue;
      }
      const name = m[2].trim().replace(/^\.\//, '');
      const rel = posix.normalize(posix.join(posix.dirname(file), name));
      for (const c of [name, `${name}.tex`, rel, `${rel}.tex`]) if (!c.startsWith('..') && existsSync(join(root, c)) && statSync(join(root, c)).isFile()) { visit(c); break; }
    }
  };
  visit(main);
  return { class: posix.basename(cls), packages: order.filter(p => !shipped.has(p) && !shipped.has(posix.basename(p))) };
}

/** For each paper, its class and its notable packages, the rarity counted over all the papers given. */
export function notable(papers: Map<string, Loaded>): Map<string, string[]> {
  const count = new Map<string, number>();
  for (const l of papers.values()) for (const p of new Set(l.packages)) count.set(p, (count.get(p) ?? 0) + 1);
  const limit = papers.size * RARE_SHARE;
  const out = new Map<string, string[]>();
  for (const [id, l] of papers) {
    const rare = l.packages.filter(p => !UNIVERSAL.has(p) && (count.get(p) ?? 0) < limit)
      .map((p, i) => ({ p, i, n: count.get(p) ?? 0 })).sort((a, b) => a.n - b.n || a.i - b.i).slice(0, MAX_NOTABLE).map(x => x.p);
    out.set(id, [l.class, ...rare].filter(Boolean));
  }
  return out;
}
