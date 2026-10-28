#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// A comparison read line by line, past vector-compare's window: where the
// browser's lines are against TeX's, and the paper's scores.
//
//     node tools/corpus/lines.ts <build dir>
//         writes <build dir>/vector/lines.json and prints the scores
//
// Each line the browser drew (glyphs sharing a baseline, from vector/dom.json)
// is paired with a line of the strip (MuPDF's glyph origins in pageless.pdf)
// whose glyphs sit at the same x positions (within 0.7 pt, vector-compare's
// window), by an order-preserving alignment of the two lists of lines
// (linematch.ts: pairs never cross, a change of dy costs, a line without a
// partner costs), so a short line never pairs with an identical one far away.
// Its dy (strip − browser) is how far the browser placed it from TeX. A step
// is where dy changes between consecutive matched lines by more than 0.05 pt.
// The scores (scores.ts) are made from the same alignment. lines.json is what
// the render report reads to compare by placement.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { traceStrip } from '../pageless-pdf/vector-compare.ts';
import { group, matchLines, type Line, type LineResult } from './linematch.ts';
import { absolute, scoresOf, type Absolute, type Scores } from './scores.ts';

interface DomGlyph { x: number; y: number; text: string }

/** The browser's glyphs (those with ink) and the strip's, in the strip's frame. */
function readGlyphs(build: string): { viewer: { x: number; y: number; text: string }[]; strip: [number, number][] } {
  const meta = JSON.parse(readFileSync(join(build, 'pageless.json'), 'utf8')) as { sp_per_pt: number; margin: number };
  const v = JSON.parse(readFileSync(join(build, 'vector', 'vector.json'), 'utf8')) as { margin_pt: number };
  const dom = JSON.parse(readFileSync(join(build, 'vector', 'dom.json'), 'utf8')) as { glyphs: DomGlyph[] };
  const shift = meta.margin / meta.sp_per_pt - v.margin_pt;
  const viewer = dom.glyphs.filter(g => g.text.trim()).map(g => ({ x: g.x + shift, y: g.y, text: g.text }));
  const strip = traceStrip(join(build, 'pageless.pdf')).glyphs.map(([x, y]) => [x, y] as [number, number]);
  return { viewer, strip };
}

/** The browser's lines and the strip's, in the strip's frame, and the absolute measure. */
export function readLines(build: string): { viewer: Line[]; strip: Line[]; absolute: Absolute } {
  const g = readGlyphs(build);
  return { viewer: group(g.viewer), strip: group(g.strip.map(([x, y]) => ({ x, y }))), absolute: absolute(g.viewer, g.strip) };
}

export interface LineSummary {
  viewer_lines: number; matched: number; viewer_unmatched: number; strip_unmatched: number; dy_at_end: number | null; steps: number;
  aligned: { glyphs_in_matched_lines: number; paired: number; beyond_0_092_across: number; worst_across: number; lines_with_glyph_beyond: number };
  largest_steps: LineResult['steps'];
}

/** The alignment, written to vector/lines.json; its summary and the scores. */
export function lineSummary(build: string): { r: LineResult; summary: LineSummary; scores: Scores } {
  const { viewer, strip, absolute: abs } = readLines(build);
  const r = matchLines(viewer, strip);
  writeFileSync(join(build, 'vector', 'lines.json'), JSON.stringify(r));
  const scores = scoresOf(viewer, strip, r, abs);
  const last = [...r.lines].reverse().find(l => l.dy !== null);
  // the glyphs of matched lines, once each line is moved to TeX's baseline
  const m = r.lines.filter(l => l.dy !== null);
  const aligned = { glyphs_in_matched_lines: m.reduce((a, l) => a + l.glyphs, 0), paired: m.reduce((a, l) => a + (l.paired ?? 0), 0),
    beyond_0_092_across: m.reduce((a, l) => a + (l.beyond ?? 0), 0), worst_across: m.reduce((a, l) => Math.max(a, l.max_dx ?? 0), 0),
    lines_with_glyph_beyond: m.filter(l => (l.beyond ?? 0) > 0).length };
  return { r, scores, summary: { viewer_lines: r.lines.length, matched: r.matched_lines, aligned, viewer_unmatched: r.unmatched_viewer,
    strip_unmatched: r.unmatched_strip, dy_at_end: last?.dy ?? null, steps: r.steps.length,
    largest_steps: [...r.steps].sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 10) } };
}

if (import.meta.main) {
  const build = process.argv[2];
  if (!build) { console.error('usage: lines.ts <build dir>'); process.exit(2); }
  const { r, scores } = lineSummary(build);
  const p = scores.placement, v = scores.vertical, pc = (x: number) => `${(100 * x).toFixed(2)} %`;
  console.log(`placement ${pc(p.share)} (${p.placed} of ${p.tex_glyphs}); vertical ${v.jumps} jumps of ${v.gaps} gaps, largest ${v.max_abs_pt} pt; ` +
    `absolute ${pc(scores.absolute.share)}; ${r.matched_lines} of ${r.lines.length} browser lines matched; ${r.unmatched_strip} TeX lines without a partner`);
}
