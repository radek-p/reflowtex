// SPDX-License-Identifier: AGPL-3.0-or-later
// What the report page reads: each test's result.json, beside its build, and
// build/report.json, the list of them all.
//
// A test's status: `pass`; `fail`; `known` – fails, as its case's known mark
// expects; `fixed` – has a known mark and passes (the suite fails until the
// mark is taken off); `error` – the build or the comparison stopped.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export type Status = 'pass' | 'fail' | 'known' | 'fixed' | 'error';

export interface Result {
  id: string; case: string; extra: number; status: Status; problems: string[];
  /** when it ran (ISO) */
  at: string;
  /** the case's ceilings: tolerance, rule_tolerance, rules_missing; and the target */
  tolerance: number; rule_tolerance?: number; rules_missing?: number; target: number; known?: string;
  /** worst glyph and rule offset (pt) */
  worst?: [number, number | null];
  hsize_pt?: number;
  /** relative to build/: the width's folder (pageless.pdf, vector/) and the page's */
  dir: string; page?: string;
}

export function writeResult(dir: string, r: Omit<Result, 'at' | 'dir'>, build: string): void {
  writeFileSync(join(dir, 'result.json'), JSON.stringify({ ...r, at: new Date().toISOString(), dir: relative(build, dir).split(sep).join('/') }, null, 1));
}

/** build/report.json: every result there is, from this run or an earlier one,
 *  in case order (`order`: the case names, as the suite lists them). */
export function writeIndex(build: string, order: string[]): Result[] {
  const results: Result[] = [];
  for (const c of existsSync(build) ? readdirSync(build) : []) {
    const caseDir = join(build, c);
    let widths: string[];
    try { widths = readdirSync(caseDir).filter(w => /^w[+-]?\d+$/.test(w)); } catch { continue; }
    for (const w of widths) {
      const f = join(caseDir, w, 'result.json');
      if (existsSync(f)) results.push(JSON.parse(readFileSync(f, 'utf8')));
    }
  }
  const rank = (r: Result) => { const i = order.indexOf(r.case); return i < 0 ? order.length : i; };
  // within a case: own width, then narrower, then wider – as the tests run
  const byWidth = (e: number) => (e === 0 ? 0 : e < 0 ? 1 : 2);
  results.sort((a, b) => rank(a) - rank(b) || a.case.localeCompare(b.case) || byWidth(a.extra) - byWidth(b.extra));
  writeFileSync(join(build, 'report.json'), JSON.stringify({ written: new Date().toISOString(), results }, null, 1));
  return results;
}
