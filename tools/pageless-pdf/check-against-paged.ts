#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Check a pageless strip against the same document paginated normally.
//
//     node tools/pageless-pdf/check-against-paged.ts <strip.pdf> <paged.pdf> [--tol 0.012] [--dump PAGE]
//
// Within one page of a \raggedbottom document, TeX places every line exactly
// as it would on an endless galley: only page breaks (discarded glue,
// \topskip) and the running head/foot differ. So every word's position
// relative to the first word of its page must agree between the paged PDF and
// the strip, to the backend's rounding. This walks each paged page's words
// (pdftotext -bbox), finds the same run of words in the strip, and reports the
// largest deviation of relative x/y offsets. Pages whose text straddles a
// chunk boundary of the strip check the stacking for free: a seam would show
// as a jump in dy from that word on.
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { pyRepr } from '../../src/pipeline/display-model.ts';

const WORD_RE = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)<\/word>/g;
type Word = [number, number, string];

/** [[x, y, text], …] per page; x/y = top-left of the word's box. */
export function words(pdf: string): Word[][] {
  const out = execFileSync('pdftotext', ['-bbox', pdf, '-'], { encoding: 'utf8', maxBuffer: 1 << 30 });
  return out.split('<page ').slice(1).map(chunk => [...chunk.matchAll(WORD_RE)].map(m => [Number(m[1]), Number(m[2]), m[5]] as Word));
}

const same = (a: string[], i: number, b: string[]) => b.every((t, k) => a[i + k] === t);
const pyFloat = (x: number) => (Object.is(x, -0) ? '-0.0' : Number.isInteger(x) ? x.toFixed(1) : String(x));
const round = (x: number, n: number) => Number(x.toFixed(n));
const signed = (x: number, n: number) => `${x >= 0 ? '+' : ''}${x.toFixed(n)}`;

/** Every page checked, in lines as printed; true when within `tol`. */
export function checkAgainstPaged(stripPdf: string, pagedPdf: string, tol = 0.012, dump: number | null = null,
                                  print: (s: string) => void = console.log): boolean {
  const stripPages = words(stripPdf);
  if (stripPages.length !== 1) throw new Error(`strip has ${stripPages.length} pages, expected 1`);
  const strip = stripPages[0], paged = words(pagedPdf), texts = strip.map(w => w[2]);
  let worst = 0, totalMatched = 0, pos = 0;                // pos: search cursor into the strip
  paged.forEach((page, k0) => {
    const k = k0 + 1;
    if (page.length < 6) { print(`page ${k}: ${page.length} words, skipped`); return; }
    // locate the page's opening words in the strip (skip a running head: try
    // each of the first dozen words as the anchor)
    let start: [number, number] | null = null;
    for (let a = 0; a < Math.min(12, page.length - 5) && !start; a++) {
      const probe = page.slice(a, a + 5).map(w => w[2]);
      for (let i = pos; i < texts.length - 5; i++) if (same(texts, i, probe)) { start = [a, i]; break; }
    }
    if (!start) { print(`page ${k}: opening words not found in the strip`); return; }
    let [a, i] = start;
    const [px0, py0] = page[a], [sx0, sy0] = strip[i];
    let matched = 0, worstPage = 0, reordered = 0, firstBad: string | null = null;
    let j = a;
    while (j < page.length && i < strip.length) {
      const inPlace = page[j][2] === strip[i][2] && Math.abs((strip[i][0] - sx0) - (page[j][0] - px0)) <= 1 &&
        Math.abs((strip[i][1] - sy0) - (page[j][1] - py0)) <= 1;
      if (!inPlace) {
        if (page[j][2] === strip[i][2]) reordered++;         // same text, elsewhere: a reordered formula word
        // pdftotext orders the words of a formula differently on the two pages
        // now and then: resync on a run of four equal words, the candidate
        // whose relative position is closest to where we are
        let best: [number, number, number] | null = null;
        for (let jj = j; jj < Math.min(j + 40, page.length - 4); jj++) {
          const probe = page.slice(jj, jj + 4).map(w => w[2]);
          for (let ii = i; ii < Math.min(i + 120, strip.length - 4); ii++) {
            if (!same(texts, ii, probe)) continue;
            const dev = Math.max(Math.abs((strip[ii][0] - sx0) - (page[jj][0] - px0)), Math.abs((strip[ii][1] - sy0) - (page[jj][1] - py0)));
            if (!best || dev < best[0]) best = [dev, jj, ii];
          }
          if (best && best[0] <= tol) break;
        }
        // a candidate that is not where the text should be is another
        // occurrence of the same words: stop the page rather than follow it
        if (!best || best[0] > 1) break;
        [, j, i] = best;
      }
      const dx = (strip[i][0] - sx0) - (page[j][0] - px0), dy = (strip[i][1] - sy0) - (page[j][1] - py0);
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      if (d > worstPage) worstPage = d;
      if (d > tol && firstBad === null)
        firstBad = `(${pyRepr(page[j][2])}, ${pyFloat(round(dx, 4))}, ${pyFloat(round(dy, 4))}, ${pyFloat(round(strip[i][1], 3))})`;
      if (dump === k)
        print(`   ${pyRepr(page[j][2]).padEnd(28)} paged y=${page[j][1].toFixed(3).padStart(9)}  strip y=${strip[i][1].toFixed(3).padStart(10)}  dx=${signed(dx, 4)} dy=${signed(dy, 4)}`);
      matched++; j++; i++;
    }
    print(`page ${k}: ${matched} words matched from word ${a}, ${page.length - j} left unmatched, ` +
      `${reordered} reordered, max deviation ${worstPage.toFixed(4)} bp` + (firstBad ? `  FIRST BAD: ${firstBad}` : ''));
    worst = Math.max(worst, worstPage);
    totalMatched += matched;
    pos = i;
  });
  print(`== ${totalMatched} words matched, worst deviation ${worst.toFixed(4)} bp, tolerance ${pyFloat(tol)} bp: ${worst <= tol ? 'OK' : 'MISMATCH'}`);
  return worst <= tol;
}

if (import.meta.main) {
  const { values: v, positionals: p } = parseArgs({ allowPositionals: true, options: {
    tol: { type: 'string', default: '0.012' },        // x quantisation of PDF text operators is 1/1000 em
    dump: { type: 'string' } } });                    // --dump N: print every word of page N
  if (p.length !== 2) { console.error('usage: check-against-paged.ts <strip.pdf> <paged.pdf> [--tol 0.012] [--dump PAGE]'); process.exit(2); }
  process.exit(checkAgainstPaged(p[0], p[1], Number(v.tol), v.dump === undefined ? null : Number(v.dump)) ? 0 : 1);
}
