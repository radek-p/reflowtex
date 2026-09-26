// SPDX-License-Identifier: AGPL-3.0-or-later
// dvisvgm as the pipeline calls it, on a captured TikZ picture: three circled
// nodes labelled $a$, $b$, $c$ (fixtures/tikz-node-labels.pdf, page 1 of a
// build's input.pdf). With dvisvgm 3.4.4's collapse-groups the labels lost
// their group's transform and stood a picture height above their circles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DVISVGM_OPTIMIZE } from '../../src/pipeline/pictures.ts';

const FIXTURE = fileURLToPath(new URL('fixtures/tikz-node-labels.pdf', import.meta.url));

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const mul = ([a, b, c, d, e, f]: Matrix, [A, B, C, D, E, F]: Matrix): Matrix =>
  [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * F + e, b * E + d * F + f];

/** An SVG transform attribute as one matrix: translate, scale and matrix, the
 *  forms dvisvgm writes. */
function parseTransform(s: string): Matrix {
  let m = IDENTITY;
  for (const [, fn, args] of s.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const v = args.trim().split(/[\s,]+/).map(Number);
    if (fn === 'translate') m = mul(m, [1, 0, 0, 1, v[0], v[1] ?? 0]);
    else if (fn === 'scale') m = mul(m, [v[0], 0, 0, v[1] ?? v[0], 0, 0]);
    else if (fn === 'matrix') m = mul(m, v as Matrix);
    else throw new Error(`transform ${fn} not handled`);
  }
  return m;
}

/** Where each <use> (a glyph) lands, its groups' transforms applied. */
function glyphPositions(svg: string): [number, number][] {
  const stack: Matrix[] = [IDENTITY];
  const out: [number, number][] = [];
  for (const [tag] of svg.matchAll(/<\/?(?:g|use)\b[^>]*>/g)) {
    if (tag.startsWith('</')) { stack.pop(); continue; }
    const t = /transform='([^']*)'/.exec(tag);
    const m = t ? mul(stack.at(-1)!, parseTransform(t[1])) : stack.at(-1)!;
    if (tag.startsWith('<use')) {
      const x = Number(/\bx='([^']*)'/.exec(tag)?.[1] ?? 0), y = Number(/\by='([^']*)'/.exec(tag)?.[1] ?? 0);
      out.push([m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
    } else if (!tag.endsWith('/>')) stack.push(m);
  }
  return out;
}

const hasDvisvgm = (() => { try { execFileSync('dvisvgm', ['--version']); return true; } catch { return false; } })();

test('a TikZ node label stays inside its picture after dvisvgm', { skip: !hasDvisvgm && 'dvisvgm not installed' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'rtx-pictures-'));
  try {
    const out = join(dir, 'p.svg');
    execFileSync('dvisvgm', ['--pdf', '--page=1', '--no-fonts', DVISVGM_OPTIMIZE, `--tmpdir=${dir}`, `--output=${out}`, FIXTURE],
      { stdio: 'pipe' });
    const svg = readFileSync(out, 'utf8');
    const [, , w, h] = /viewBox='([^']*)'/.exec(svg)![1].split(' ').map(Number);
    const glyphs = glyphPositions(svg);
    assert.equal(glyphs.length, 3, 'the three labels');
    // Each label's baseline is below its circle's centre, within the picture:
    // the circles are 20 pt across, centred at y = 49.8 (a, b) and 10.1 (c).
    for (const [x, y] of glyphs) {
      assert.ok(x >= 0 && x <= w && y >= 0 && y <= h, `glyph at (${x.toFixed(2)}, ${y.toFixed(2)}) outside the ${w} × ${h} picture`);
    }
    const ys = glyphs.map(([, y]) => y).sort((p, q) => p - q);
    assert.ok(Math.abs(ys[0] - 12.3) < 1 && Math.abs(ys[2] - 53.3) < 1, `baselines ${ys.map(y => y.toFixed(2)).join(', ')}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
