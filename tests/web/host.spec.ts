// SPDX-License-Identifier: AGPL-3.0-or-later
// The host API (window.reflowtex.host, src/viewer/src/host/types.ts):
// instances, parts and surfaces, block kinds, actions, frames, the blocks'
// lifecycle and the popover – used without the companion.
import { test, expect, type WebPage } from './fixtures.ts';

const settle = (page: WebPage, ms = 250) => page.waitForTimeout(ms);
const worst = (a: number[], b: number[]) => Math.max(...a.map((x, i) => Math.abs(x - b[i])));

// The baselines of the first block's lines, from its top, px: every drawn
// glyph's baseline, deduplicated.
const baselines = (page: WebPage) => page.evaluate(() => {
  const b = reflowtex.host.blocks()[0].el, top = b.getBoundingClientRect().top;
  const ys = [...b.querySelectorAll('svg text tspan')].map((t: any) => {
    const p = t.ownerSVGElement.createSVGPoint(); p.y = parseFloat(t.getAttribute('y'));
    return Math.round((p.matrixTransform(t.getScreenCTM()).y - top) * 100) / 100; });
  return [...new Set(ys)].sort((a, b) => a - b);
});

const defineCallout = (page: WebPage) => page.evaluate(() => {
  window.__renders = 0; window.__undos = 0;
  window.__undefine = reflowtex.host.define('callout', {
    render(instance: any, host: any) {
      window.__renders++;
      const d = document.createElement('div'); d.className = 'mine';
      host.el.append(d);
      window.__surface = instance.part('body').mount(d);
      window.__host = host;
      return () => { window.__undos++; };
    },
  });
});

// ── Instances, parts, surfaces ───────────────────────────────────────────────

test('instance tree', async ({ openPage }) => {
  const page = await openPage('host');
  const r = await page.evaluate(() => {
    const host = reflowtex.host, [b] = host.blocks();
    const show = (i: any): any => ({ id: i.id, kind: i.kind, placement: i.placement, attrs: { ...i.attrs },
      classes: [...i.presentation.classes], props: { ...i.presentation.properties },
      parts: [...i.parts.keys()], parent: i.parent && i.parent.kind, children: i.children.map(show) });
    return { version: host.version, blocks: host.blocks().length, key: b.key, roots: b.roots.map(show) };
  });
  expect(r.version).toBe(1);
  expect(r.blocks).toBe(2);
  const roots = Object.fromEntries(r.roots.map((i: any) => [i.kind, i]));
  const acc = roots.accordion;
  expect(acc.placement).toBe('block');
  expect(acc.attrs.initial).toBe('collapsed');
  expect(acc.children.map((c: any) => c.kind)).toEqual(['pane', 'pane']);
  expect(acc.children.map((c: any) => c.attrs.name)).toEqual(['collapsed', 'expanded']);
  expect(acc.children[1].children.map((c: any) => [c.kind, c.placement, c.parent])).toEqual([['footnote', 'detached', 'pane']]);
  expect(roots.text.placement).toBe('text');
  expect(roots.text.attrs).toEqual({ name: 'clock' });
  expect(roots.popover.placement).toBe('inline');
  expect(roots.popover.attrs).toEqual({ name: 'popover:1', key: '1' });
  expect(roots.popover.parts.sort(), "the widget's asides are its parts").toEqual(['popover-label', 'popover-note']);
  expect(roots.marginpar.placement).toBe('detached');
  expect(roots.marginpar.attrs).toEqual({ place: 'margin' });
  expect(roots.callout.classes).toEqual(['fancy', 'big']);
  expect(roots.callout.props).toEqual({ '--x-accent': 'red' });
  expect(roots.callout.attrs).toEqual({ tone: 'warm' });
  expect(roots.callout.parts).toEqual(['body']);
  const ids = [...r.roots.map((i: any) => i.id), ...acc.children.map((x: any) => x.id)];
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.every((i: string) => i.startsWith(r.key + '/'))).toBe(true);
});

test('data parts, parts not instances, queries', async ({ openPage }) => {
  const page = await openPage('host');
  const r = await page.evaluate(() => {
    const h = reflowtex.host, lean = h.instances('leanproof')[0], code = lean.part('code'), tex = lean.part('tex');
    return { text: code.data, type: code.type, tex: tex.type, kinds: lean.children.map((c: any) => c.kind),
             attrs: { ...lean.attrs }, q: h.instances({ kind: 'pane', name: 'expanded' }).length,
             detached: h.instances({ placement: 'detached' }).map((i: any) => i.kind).sort(), found: h.find(lean.id) === lean };
  });
  expect(r.type).toBe('data');
  expect(r.text).toContain('theorem foo : 1 = 1');
  expect(r.tex).toBe('typeset');
  expect(r.kinds, 'parts are not instances').not.toContain('leancode');
  expect(r.kinds).not.toContain('leantex');
  expect(r.attrs.decl).toBe('foo');
  expect(Object.keys(r.attrs).some(k => k.startsWith('rtx-')), 'the package keys stay out of attrs').toBe(false);
  expect(r.q).toBe(1);
  expect(r.found).toBe(true);
  expect(r.detached).toEqual(['footnote', 'marginpar']);
});

test('a surface follows its container', async ({ openPage }) => {
  const page = await openPage('host');
  await page.evaluate(() => {
    const part = reflowtex.host.instances('callout')[0].part('body');
    const el = document.createElement('div'); el.style.width = '300px'; document.body.append(el);
    window.__el = el; window.__changes = 0;
    window.__s = part.mount(el);
    window.__s.onChange(() => window.__changes++);
  });
  const first = await page.evaluate(() => ({ ...window.__s.metrics(), glyphs: window.__el.querySelectorAll('svg text tspan').length }));
  expect(Math.abs(first.width - 300)).toBeLessThan(0.5);
  expect(first.height > 0 && first.glyphs > 0 && first.firstBaseline > 0).toBe(true);
  await page.evaluate(() => { window.__el.style.width = '180px'; });
  await page.waitForFunction(() => window.__s.metrics().width < 181);
  const second = await page.evaluate(() => ({ ...window.__s.metrics(), changes: window.__changes }));
  expect(second.height, 'narrower, so taller').toBeGreaterThan(first.height);
  expect(second.changes).toBeGreaterThanOrEqual(1);
  await page.evaluate(() => { window.__s.dispose(); window.__el.style.width = '400px'; });
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => window.__el.childElementCount)).toBe(0);
  expect(await page.evaluate(() => window.__s.metrics().width), 'a disposed surface lays out no more').toBeLessThan(181);
});

test('natural, fixed, and several at once', async ({ openPage }) => {
  const page = await openPage('host');
  const r = await page.evaluate(() => {
    const part = reflowtex.host.instances('popover')[0].part('popover-label');
    const a = document.createElement('div'), b = document.createElement('div');
    document.body.append(a, b);
    const s1 = part.mount(a, { width: 'natural' }), s2 = part.mount(b, { width: 250 });
    return { natural: part.naturalWidth(), w1: s1.metrics().width, w2: s2.metrics().width,
             both: a.querySelectorAll('tspan').length > 0 && b.querySelectorAll('tspan').length > 0 };
  });
  expect(r.natural > 5 && r.natural < 100).toBe(true);
  expect(r.w1).toBe(r.natural);
  expect(r.w2).toBe(250);
  expect(r.both).toBe(true);
});

test('a hidden surface is painted when shown', async ({ openPage }) => {
  const page = await openPage('host');
  await page.evaluate(() => {
    const el = document.createElement('div'); el.style.cssText = 'width:300px;display:none';
    document.body.prepend(el); window.__el = el;
    reflowtex.host.instances('callout')[0].part('body').mount(el, { width: 300 });
  });
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__el.querySelectorAll('tspan').length), 'painted while hidden').toBe(0);
  await page.evaluate(() => { window.__el.style.display = 'block'; });
  await page.waitForFunction(() => window.__el.querySelectorAll('tspan').length > 0);
});

test('identity survives relayout', async ({ openPage }) => {
  const page = await openPage('host');
  await page.evaluate(() => { window.__ids = reflowtex.host.instances().map((i: any) => i.id); window.__one = reflowtex.host.instances('callout')[0]; });
  await page.locator('.latex-block[data-nodelist-b64]').first().evaluate((b: HTMLElement) => { b.style.width = '320px'; });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => ({
    same: JSON.stringify(reflowtex.host.instances().map((i: any) => i.id)) === JSON.stringify(window.__ids),
    obj: reflowtex.host.instances('callout')[0] === window.__one }));
  expect(r).toEqual({ same: true, obj: true });
});

test('onBlock and the layout event', async ({ openPage }) => {
  const page = await openPage('host');
  const r = await page.evaluate(() => new Promise<any>(done => {
    const seen: string[] = []; reflowtex.host.onBlock((b: any) => seen.push(b.key));
    const b = reflowtex.host.blocks()[0];
    const off = b.on('layout', () => { off(); done({ seen, layout: true }); });
    b.el.style.width = '300px';
  }));
  expect(r.seen.length).toBe(2);
  expect(r.layout).toBe(true);
});

test('anchors', async ({ openPage }) => {
  const page = await openPage('host');
  const r = await page.evaluate(() => {
    const h = reflowtex.host, at = (k: string) => { const a = h.instances(k)[0].anchor(); return a && [a.x, a.y]; };
    return { margin: at('marginpar'), text: at('text'), block: at('accordion') };
  });
  expect(r.margin).not.toBeNull();
  expect(r.text).toBeNull();
  expect(r.block).toBeNull();
});

// ── Block kinds (host.define) ────────────────────────────────────────────────

test('a late define keeps TeX’s spacing', async ({ openPage }) => {
  const page = await openPage('host');
  const before = await baselines(page);
  await defineCallout(page);
  await settle(page);
  const r = await page.evaluate(() => ({ renders: window.__renders,
    mine: document.querySelectorAll('.latex-stream[data-kind="callout"] > .mine .latex-part').length,
    classes: document.querySelector('.latex-stream[data-kind="callout"]')!.className,
    tone: (document.querySelector('.latex-stream[data-kind="callout"]') as HTMLElement).dataset.tone }));
  expect(r.renders).toBe(1);
  expect(r.mine).toBe(1);
  expect(r.classes, 'the host keeps its parameters').toContain('fancy');
  expect(r.tone).toBe('warm');
  const after = await baselines(page);
  expect(after.length).toBe(before.length);
  expect(worst(before, after), 'a line moved when the page drew the callout').toBeLessThan(0.5);
});

test('rendered once across relayouts', async ({ openPage }) => {
  const page = await openPage('host');
  await defineCallout(page);
  await settle(page);
  await page.evaluate(() => { (document.querySelector('.latex-stream[data-kind="callout"]') as HTMLElement).dataset.tag = 'same'; });
  const block = page.locator('.latex-block[data-nodelist-b64]').first();
  for (const w of ['320px', '500px', '260px']) {
    await block.evaluate((b: HTMLElement, w) => { b.style.width = w; }, w);
    await settle(page, 300);
  }
  const r = await page.evaluate(() => ({ renders: window.__renders, undos: window.__undos,
    tag: (document.querySelector('.latex-stream[data-kind="callout"]') as HTMLElement).dataset.tag,
    width: window.__surface.metrics().width }));
  expect([r.renders, r.undos, r.tag]).toEqual([1, 0, 'same']);
  expect(r.width, 'the body follows the narrower column').toBeLessThan(262);
});

test('the content’s height moves what follows', async ({ openPage }) => {
  const page = await openPage('host');
  await defineCallout(page);
  await settle(page);
  const full = await baselines(page);
  await page.evaluate(() => { (document.querySelector('.mine') as HTMLElement).style.display = 'none'; });
  await settle(page);
  const hidden = await baselines(page);
  expect(hidden.at(-1)!, 'the text after the callout moved up').toBeLessThan(full.at(-1)! - 20);
  await page.evaluate(() => { (document.querySelector('.mine') as HTMLElement).style.display = ''; });
  await settle(page);
  expect(worst(full, await baselines(page))).toBeLessThan(0.5);
});

test('undefine draws by default again', async ({ openPage }) => {
  const page = await openPage('host');
  const before = await baselines(page);
  await defineCallout(page);
  await settle(page);
  await page.evaluate(() => window.__undefine());
  await settle(page);
  const r = await page.evaluate(() => ({ undos: window.__undos, mine: document.querySelectorAll('.mine').length,
    glyphs: document.querySelectorAll('.latex-stream[data-kind="callout"] tspan').length }));
  expect(r.undos).toBe(1);
  expect(r.mine).toBe(0);
  expect(r.glyphs).toBeGreaterThan(0);
  expect(worst(before, await baselines(page))).toBeLessThan(0.5);
});

test('a throwing renderer falls back', async ({ openPage }) => {
  const page = await openPage('host');
  await page.evaluate(() => reflowtex.host.define('callout', { render() { throw new Error('boom'); } }));
  await settle(page);
  expect(await page.evaluate(() => document.querySelectorAll('.latex-stream[data-kind="callout"] tspan').length), 'drawn by default').toBeGreaterThan(0);
  expect(page.errors.some(e => e.includes('render failed'))).toBe(true);
  page.errors.length = 0;
});

test('the edges decide the glue', async ({ openPage }) => {
  const page = await openPage('host');
  await defineCallout(page);
  await settle(page);
  const before = await baselines(page);
  // No line of text at either edge: no interline glue to the text around.
  await page.evaluate(() => window.__host.setEdges({ top: null, bottom: null }));
  await settle(page);
  expect(await baselines(page), 'the edges changed nothing').not.toEqual(before);
  await page.evaluate(() => window.__host.setEdges({ top: window.__surface, bottom: window.__surface }));
  await settle(page);
  expect(worst(before, await baselines(page))).toBeLessThan(0.5);
});

test('a frame keeps the glue where there is no explicit space', async ({ openPage }) => {
  // A framed edge drops TeX's glue only where the author left explicit
  // space; the callout has none, so framing it moves nothing.
  const page = await openPage('host');
  await defineCallout(page);
  await settle(page);
  const before = await baselines(page);
  await page.evaluate(() => window.__host.setFrame({ top: true, bottom: true }));
  await settle(page);
  expect(worst(before, await baselines(page))).toBeLessThan(0.5);
});

// ── Actions ──────────────────────────────────────────────────────────────────

test('defined before the viewer; an action goes up the instance tree', async ({ openPage }) => {
  const page = await openPage('host-defined');
  const r = await page.evaluate(() => ({ renders: window.__renders,
    marks: [...document.querySelectorAll('.latex-stream[data-kind="pane"] > .mine')].map(m => m.textContent) }));
  expect(r).toEqual({ renders: 2, marks: ['collapsed', 'expanded'] });
  await page.evaluate(() => { window.__got = [];
    const acc = reflowtex.host.instances('accordion')[0];
    acc.onAction('pane', (a: any) => { window.__got.push([a.arg, a.instance && a.instance.kind]); });
    document.addEventListener('reflowtex:action', (e: any) => window.__got.push(['dom', e.detail.handled])); });
  await page.locator('.latex-stream[data-kind="pane"] rect.latex-link-hit[data-link-action="pane:next"]').first().click({ force: true });
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__got)).toEqual([['next', 'pane'], ['dom', true]]);
  expect(await page.evaluate(() => window.__renders)).toBe(2);
});

test('an action passed outward, and one nobody handles', async ({ openPage }) => {
  const page = await openPage('host-defined');
  await page.evaluate(() => { window.__got = [];
    const acc = reflowtex.host.instances('accordion')[0], pane = reflowtex.host.instances('pane')[0];
    pane.onAction('pane', () => { window.__got.push('pane'); return false; });     // passes it on
    acc.onAction('pane', () => { window.__got.push('accordion'); });
    acc.onAction('other', () => { window.__got.push('never'); });
    document.addEventListener('reflowtex:action', (e: any) => window.__got.push(e.detail.verb + ':' + e.detail.handled)); });
  await page.locator('.latex-stream[data-kind="pane"] rect.latex-link-hit[data-link-action="pane:next"]').first().click({ force: true });
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__got)).toEqual(['pane', 'accordion', 'pane:true']);
});

// ── Boxed theorems: nested frames ────────────────────────────────────────────

const frames = (page: WebPage) => page.evaluate(() =>
  [...document.querySelectorAll('.latex-stream[data-kind="theorem"], .latex-stream[data-kind="proof"]')].map(b => {
    const r = b.getBoundingClientRect();
    let depth = 0;
    for (let e = b.parentElement; e; e = e.parentElement)
      if (e.matches('.latex-stream[data-kind="theorem"], .latex-stream[data-kind="proof"]')) depth++;
    return { depth, left: r.left, right: r.right };
  }));

test('nested boxes: end edges flush, start edges stepped', async ({ openPage }) => {
  const page = await openPage('boxes');
  const fs = await frames(page);
  const proof = fs.filter(f => f.depth === 0)[1];          // the outer proof (after the theorem)
  const inner = fs.filter(f => f.depth >= 1);
  expect(inner.length).toBe(2);                             // the claim, and its proof
  for (const f of inner) {
    expect(Math.abs(f.right - proof.right), 'a nested box stops short of the right edge').toBeLessThan(0.5);
    expect(f.left, 'a nested box is not set in on the left').toBeGreaterThan(proof.left + 5);
  }
});

test('nested boxes mirror right to left', async ({ openPage }) => {
  const page = await openPage('boxes');
  await page.evaluate(() => { document.documentElement.dir = 'rtl'; });
  await page.waitForTimeout(400);
  const fs = await frames(page);
  const proof = fs.filter(f => f.depth === 0)[1];
  for (const f of fs.filter(f => f.depth >= 1)) {
    expect(Math.abs(f.left - proof.left), 'right to left: the end (left) edges stand flush').toBeLessThan(0.5);
    expect(f.right, 'right to left: set in at the start (right)').toBeLessThan(proof.right - 5);
  }
});

// ── Blocks added later, and taken away; the popover ──────────────────────────

test('mount later, destroy, mount again', async ({ openPage }) => {
  const page = await openPage('host');
  const r = await page.evaluate(async () => {
    const src = document.querySelector('[data-nodelist-b64]') as HTMLElement;
    const el = document.createElement('div');
    el.className = 'latex-block'; el.dataset.nodelistB64 = src.dataset.nodelistB64;
    document.body.append(el);
    const h = reflowtex.host, before = h.blocks().length;
    const b = await h.mount(el);
    const drawn = { blocks: h.blocks().length, callouts: b.instances('callout').length,
                    glyphs: el.querySelectorAll('svg text tspan').length, same: (await h.mount(el)) === b };
    const surface = b.instances('callout')[0].part('body').mount(document.body.appendChild(document.createElement('div')));
    b.destroy();
    const gone = { blocks: h.blocks().length, children: el.childElementCount, found: h.block(el) === undefined,
                   surface: surface.el.childElementCount };
    const again = await h.mount(el);
    return { before, drawn, gone, again: again.instances('callout').length, back: h.blocks().length };
  });
  expect(r.drawn.blocks).toBe(r.before + 1);
  expect(r.drawn.callouts).toBe(1);
  expect(r.drawn.glyphs).toBeGreaterThan(0);
  expect(r.drawn.same, 'mounting twice renders once').toBe(true);
  expect(r.gone).toEqual({ blocks: r.before, children: 0, found: true, surface: 0 });
  expect(r.again).toBe(1);
  expect(r.back).toBe(r.before + 1);
});

test('the popover drawn by its kind', async ({ openPage }) => {
  const page = await openPage('host');
  await page.evaluate(() => { window.__undone = 0;
    reflowtex.host.define('footnote', { render(i: any, h: any) {
      h.el.innerHTML = '<p class="mine">' + h.type + ' ' + i.kind + '</p>';
      return () => { window.__undone++; }; } }); });
  await page.locator('[data-footnote]').first().click();
  await page.waitForSelector('#latex-footnote-pop .mine');
  expect(await page.locator('#latex-footnote-pop .mine').innerText()).toBe('popover footnote');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__undone)).toBe(1);
});
