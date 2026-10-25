// SPDX-License-Identifier: AGPL-3.0-or-later
// A block's drawing as data (host API: Block.document, layout, relayout,
// segments, Segment.walk; host.idle), what a host builds its own hit testing
// and caret on; and mount's promise: a block mounted into a hidden element is
// painted, with its faces, when host.mount resolves.
import { test, expect } from './fixtures.ts';
import { idle } from './web.ts';

type W = Window & typeof globalThis & { reflowtex: any };

test('segments and walk: the drawn lines and glyphs, in the svg\'s units, nodes of the block\'s document', async ({ openPage }) => {
  const page = await openPage('displays-streams');
  const r = await page.evaluate(() => {
    const w = window as W;
    const block = w.reflowtex.host.blocks()[0];
    const segs = block.segments();
    // every node of the document, by identity
    const all = new Set<object>();
    const add = (ns: any[] = []) => { for (const n of ns) { all.add(n); for (const k of ['children', 'replace', 'pre', 'post']) add(n[k]); } };
    for (const p of block.document.paragraphs) add(p.nodes);
    for (const it of block.document.content ?? []) if (it.box) add([it.box]);
    for (const st of block.document.streams ?? []) for (const it of st.content ?? []) if (it.box) add([it.box]);
    const walked = (s: any) => {
      const lines: number[] = [], glyphs: { n: any; x: number; y: number }[] = [];
      const ok = s.walk({ line: (_j: number, nodes: unknown[], _x: number, y: number) => { lines.push(nodes.length); void y; },
                          node: (n: any, x: number, y: number) => { if (n.type === 'glyph') glyphs.push({ n, x, y }); } });
      return { ok, lines, glyphs };
    };
    const text = segs.find((s: any) => s.kind === 'text' && s.painted);
    const t = walked(text);
    // the first glyph walked is the first glyph drawn in that svg, at the same place
    const first = text.svg.querySelector('tspan');
    const stream = segs.find((s: any) => s.kind === 'stream');
    const inner = stream ? stream.segments() : [];
    const iw = inner.length ? walked(inner[0]) : null;
    return {
      kinds: segs.map((s: any) => s.kind),
      svgs: segs.map((s: any) => s.svg === null ? null : s.svg instanceof SVGSVGElement && block.el.contains(s.svg)),
      sameDoc: block.document === w.reflowtex.inspect.state(block.el).doc && w.reflowtex.host.spToPx === w.reflowtex.inspect.spToPx,
      lines: t.lines.length, glyphs: t.glyphs.length, ok: t.ok,
      identity: t.glyphs.every(g => all.has(g.n)),
      chars: t.glyphs.every(g => typeof g.n.char === 'number' && typeof g.n.font === 'number'),
      firstAt: first ? [Math.abs(Number(first.getAttribute('x')) - t.glyphs[0]!.x) < 0.01, Math.abs(Number(first.getAttribute('y')) - t.glyphs[0]!.y) < 0.01] : null,
      streamSvg: stream ? stream.svg : 'none', streamWalk: stream ? stream.walk({}) : null,
      inner: inner.length, innerGlyphs: iw ? iw.glyphs.length : 0, innerIdentity: iw ? iw.glyphs.every(g => all.has(g.n)) : false,
    };
  });
  expect(r.kinds).toContain('stream');
  expect(r.kinds).toContain('display');
  expect(r.kinds).toContain('text');
  expect(r.svgs.every((s: boolean | null, i: number) => (r.kinds[i] === 'stream' ? s === null : s === true))).toBe(true);
  expect(r.sameDoc).toBe(true);
  expect(r.ok).toBe(true);
  expect(r.lines).toBeGreaterThan(0);
  expect(r.glyphs).toBeGreaterThan(5);
  expect(r.identity, 'walked nodes are the document\'s own objects').toBe(true);
  expect(r.chars).toBe(true);
  expect(r.firstAt).toEqual([true, true]);
  expect(r.streamSvg).toBeNull();
  expect(r.streamWalk).toBe(false);
  expect(r.inner).toBeGreaterThan(0);
  expect(r.innerGlyphs).toBeGreaterThan(0);
  expect(r.innerIdentity).toBe(true);
});

test('layout() follows the measure; relayout() lays out again', async ({ openPage }) => {
  const page = await openPage('displays-streams');
  const before = await page.evaluate(() => (window as W).reflowtex.host.blocks()[0].layout());
  expect(before.widthPt).toBeGreaterThan(0);
  expect(before.sourceWidthPt).toBeGreaterThan(0);
  expect(typeof before.align).toBe('string');
  await page.locator('.latex-block[data-nodelist-b64]').first().evaluate((b: HTMLElement) => { b.style.width = '300px'; });
  await idle(page);
  const after = await page.evaluate(() => (window as W).reflowtex.host.blocks()[0].layout());
  expect(after.widthPt).toBeLessThan(before.widthPt);
  expect(after.sourceWidthPt).toBe(before.sourceWidthPt);
  const laid = await page.evaluate(async () => {
    const w = window as W, b = w.reflowtex.host.blocks()[0];
    let n = 0;
    b.on('layout', () => { n++; });
    b.relayout();
    await w.reflowtex.host.idle();
    return n;
  });
  expect(laid).toBeGreaterThan(0);
});

test('mount resolves with the block painted, its faces loaded, in a hidden element', async ({ openPage }) => {
  const page = await openPage('displays-streams');
  const r = await page.evaluate(async () => {
    const w = window as W;
    const src = document.querySelector<HTMLElement>('.latex-block[data-nodelist-b64]')!;
    const el = document.createElement('div');
    el.className = 'latex-block';
    el.dataset.nodelistB64 = src.dataset.nodelistB64!;
    el.style.cssText = 'position: absolute; top: 0; left: 0; width: 600px; visibility: hidden';
    document.body.prepend(el);
    const b = await w.reflowtex.host.mount(el);
    const near = b.segments().filter((s: any) => s.svg && s.svg.getBoundingClientRect().top < innerHeight);
    return { near: near.length, painted: near.every((s: any) => s.painted), tspans: el.querySelectorAll('tspan').length,
      faces: [...document.fonts].every(f => f.status === 'loaded') };
  });
  expect(r.near).toBeGreaterThan(0);
  expect(r.painted).toBe(true);
  expect(r.tspans).toBeGreaterThan(0);
  expect(r.faces).toBe(true);
});
