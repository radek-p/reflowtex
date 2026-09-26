// SPDX-License-Identifier: AGPL-3.0-or-later
// Every glyph the browser draws, against TeX's (see README.md).
//
//     make test-render            # everything but the slow cases
//     make test-render-all        # testmath too (REFLOWTEX_RENDER_ALL=1)
//     node --test --test-name-pattern displays tests/render/render.test.ts   # one case
import { test, after } from 'node:test';
import { allCases, buildDir, compare, problems, serve, worst, type Case } from './render.ts';

const ALL = process.env.REFLOWTEX_RENDER_ALL === '1';
const cases = allCases();
const { url, server } = await serve();
/** each test's worst offsets, for the summary: [test, case, [glyph, rule], TeX's rules not drawn] */
const rows: [string, Case, [number, number | null], number][] = [];

for (const c of cases.values()) {
  for (const extra of c.widths) {
    const id = `${c.name}@${extra ? `${extra > 0 ? '+' : ''}${extra}pt` : 'own'}`;
    test(id, { skip: c.slow && !ALL ? 'slow (make test-render-all)' : false }, async () => {
      const v = await compare(c, extra, url);
      rows.push([id, c, worst(v), v.rules_missing.length]);
      const found = problems(v, c.tolerance, c.rule_tolerance, c.rules_missing ?? 0);
      const report = `${buildDir(c, extra)}/vector/vector.json`;
      if (c.known) {
        // strict: once it passes, the suite fails until the mark is taken off
        if (!found.length) throw new Error(`${c.name} passes now: take its known mark off in cases.ts ("${c.known}")`);
        return;
      }
      if (found.length) throw new Error(`${c.name} at ${v.hsize_pt} pt:\n  ${found.join('\n  ')}\n  report: ${report}`);
    });
  }
}

// Each test's worst glyph and rule against its ceilings and the target, and
// TeX's rules it did not draw: a test doing better than its ceilings says to
// lower them.
after(() => {
  server.close();
  if (!rows.length) return;
  const lines = ['render: worst offsets (pt)',
    `${'test'.padEnd(28)} ${'glyph'.padStart(7)} ${'ceiling'.padStart(8)} ${'rule'.padStart(7)} ${'ceiling'.padStart(8)}   target ${rows[0][1].target}`];
  const lower = new Map<string, string>();
  for (const [id, c, [g, r], miss] of [...rows].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const rt = c.rule_tolerance ?? c.tolerance;
    const note = miss ? `${miss} of TeX's rules not drawn` : g <= c.target && (r === null || r <= c.target) ? 'meets target' : '';
    // a case's ceilings are its worst over all its widths
    const byCase = rows.filter(x => x[1].name === c.name);
    if (byCase.length === c.widths.length) {
      const cg = Math.max(...byCase.map(x => x[2][0]));
      const rr = byCase.map(x => x[2][1]).filter((x): x is number => x !== null);
      const cr = rr.length ? Math.max(...rr) : null;
      const cm = Math.max(...byCase.map(x => x[3]));
      if (cg < c.tolerance || (cr !== null && cr < rt) || cm < (c.rules_missing ?? 0))
        lower.set(c.name, `tolerance: ${cg.toFixed(3)}` + (cr !== null ? `, rule_tolerance: ${cr.toFixed(3)}` : '') + (c.rules_missing ? `, rules_missing: ${cm}` : ''));
    }
    lines.push(`${id.padEnd(28)} ${g.toFixed(3).padStart(7)} ${c.tolerance.toFixed(3).padStart(8)} ${(r === null ? '' : r.toFixed(3)).padStart(7)} ` +
      `${(r === null ? '' : rt.toFixed(3)).padStart(8)}   ${note}`);
  }
  for (const [name, s] of [...lower].sort()) lines.push(`${name} does better than its ceilings: lower them in cases.ts to ${s}`);
  console.log(`\n${lines.join('\n')}`);
});
