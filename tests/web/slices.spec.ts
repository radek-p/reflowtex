// SPDX-License-Identifier: AGPL-3.0-or-later
// Sliced layout (runtime/slices.ts): a re-break lays out at once only what is
// on the screen, and the rest in slices of idle time, nearest first. What
// matters most: once the slices are done, the block is exactly what a
// synchronous layout gives – every line break, height, size and glyph
// position – whatever happened meanwhile (another width, an unmount, the
// reader scrolling); the reader's line stays put; the events and
// inspect.idle() report the end once; and no task is long.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type WebPage } from './fixtures.ts';
import { REPO, idle, names } from './web.ts';
import { serveDirectory } from '../../tools/lib/static-server.ts';

/** Helpers in the page: __fp(el, glyphs) a block's layout as one string per
 *  segment (where its lines break, its heights, its elements' sizes and
 *  offsets, and with `glyphs` a hash of every drawn element's position);
 *  __paintAll() draws every block whole, as for print; __copy(mode, width)
 *  mounts a fresh copy of the page's first block. */
async function helpers(page: WebPage) {
  await page.evaluate(() => {
    const w = window as any;
    const fnv = (s: string) => {
      let h = 0x811c9dc5;
      for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
      return (h >>> 0).toString(16);
    };
    const KEEP = ['x', 'y', 'dx', 'dy', 'transform', 'width', 'height', 'd', 'x1', 'x2', 'y1', 'y2', 'points',
                  'font-size', 'font-family', 'viewBox', 'textLength'];
    const drawn = (svg: Element) => fnv([...svg.querySelectorAll('*')].map(e =>
      e.tagName + ' ' + KEEP.map(a => e.getAttribute(a) ?? '').join(' ') + (e.children.length ? '' : ' ' + e.textContent)).join('|'));
    const segs = (cache: any, glyphs: boolean, top0: number): string[] => cache.layout.laid.map((L: any, i: number) => {
      const s = cache.dom.segs[i];
      if (s.sub) return `stream ${s.gap.style.height} [${segs(s.sub, glyphs, top0).join('; ')}]`;
      const lines = (L.lines || []).map((ln: any) => ln.nodes.length).join(',');
      const parts = [L.pending ? 'P' : L.deferred ? 'D' : 'R', L.H, lines, (L.baselineYs || []).join(','),
                     s.svg && s.svg.getAttribute('width'), s.svg && s.svg.getAttribute('height'), s.svg && s.svg.getAttribute('viewBox'),
                     s.gap.style.height, '@' + Math.round((s.box.getBoundingClientRect().top - top0) * 64) / 64];
      if (glyphs && s.svg) parts.push(drawn(s.svg));
      return parts.join(' ');
    });
    w.__fp = (el: HTMLElement, glyphs = false) => {
      const cache = reflowtex.inspect.state(el).cache;
      return segs(cache, glyphs, cache.dom.root.getBoundingClientRect().top);
    };
    w.__paintAll = () => window.dispatchEvent(new Event('beforeprint'));
    w.__copy = async (layout: string, width: number, after?: Element) => {
      const src = document.querySelector('.latex-block[data-nodelist-b64]') as HTMLElement;
      const el = document.createElement('div');
      el.className = 'latex-block';
      el.style.width = width + 'px';
      el.dataset.nodelistB64 = src.dataset.nodelistB64!;
      (after || document.body.lastElementChild!).after(el);
      return reflowtex.host.mount(el, { layout });
    };
    // Events of every block, by kind.
    w.__events = { layoutstart: 0, layoutslice: 0, layoutcomplete: 0 };
    for (const k of Object.keys(w.__events)) document.addEventListener('reflowtex:' + k, () => { w.__events[k]++; });
  });
}

/** Two strings arrays equal, or the first few differences. `apart`: the two
 *  are different blocks, at different places on the page. Firefox snaps a
 *  box's position to its layout unit (1/60 px) on the page, not in the block,
 *  so the same offset within two blocks can come out one unit apart; there,
 *  and only in a box's offset (`@…`), two units are allowed. Every size,
 *  break, baseline and glyph is still compared exactly. */
const UNIT = 1 / 60;
function same(a: string[], b: string[], what: string, apart: string | false = false) {
  const tol = apart === 'firefox' ? 2 * UNIT + 1e-9 : 0;
  const close = (x: string, y: string) => {
    if (x === y) return true;
    if (!tol) return false;
    const p = x.split(' '), q = y.split(' ');
    return p.length === q.length && p.every((t, k) => t === q[k] ||
      (t.startsWith('@') && q[k].startsWith('@') && Math.abs(parseFloat(t.slice(1)) - parseFloat(q[k].slice(1))) <= tol));
  };
  const diff: string[] = [];
  for (let i = 0; i < Math.max(a.length, b.length) && diff.length < 4; i++)
    if (!close(a[i], b[i])) diff.push(`segment ${i}:\n    sliced ${a[i]}\n    sync   ${b[i]}`);
  expect(diff, what).toEqual([]);
}

// ── Sliced against synchronous, on every page the tests have ────────────────

/** A page opened sliced (the default) or with data-latex-layout="sync" on
 *  <html>; every block taken through `widths` (narrowing, so that no width
 *  is answered from the cache of two others), its layout after each, and
 *  after the last its drawing whole. */
async function across(open: (url: string, o: any) => Promise<WebPage>, url: string, sync: boolean, widths: number[]) {
  const route: [string, (r: any) => unknown] = ['**/*', async (r: any) => {
    const u = r.request().url();
    if (u.endsWith('/latex-viewer.js')) return r.fulfill({ path: join(REPO, 'src/viewer/latex-viewer.js'), contentType: 'text/javascript' });
    if (sync && r.request().resourceType() === 'document') {
      const res = await r.fetch();
      return r.fulfill({ response: res, body: (await res.text()).replace('<html', '<html data-latex-layout="sync"') });
    }
    return r.continue();
  }];
  const page: WebPage = await open(url, { width: 1100, height: 800, route });
  await helpers(page);
  const out: string[][] = [];
  for (const w of widths) {
    await page.evaluate(w => { for (const b of reflowtex.inspect.blocks() as HTMLElement[]) if (!b.dataset.latexWidth) b.style.width = w + 'px'; }, w);
    await idle(page);
    out.push(await page.evaluate(() => (reflowtex.inspect.blocks() as HTMLElement[]).flatMap((b, k) => (window as any).__fp(b).map((s: string) => `${k} ${s}`))));
  }
  await page.evaluate(() => (window as any).__paintAll());
  await idle(page);
  out.push(await page.evaluate(() => (reflowtex.inspect.blocks() as HTMLElement[]).flatMap((b, k) => (window as any).__fp(b, true).map((s: string) => `${k} ${s}`))));
  const mode = await page.evaluate(() => (reflowtex.inspect.blocks() as HTMLElement[]).map(b => b.closest('[data-latex-layout]')?.getAttribute('data-latex-layout') ?? 'sliced'));
  await page.context().close();
  return { out, mode };
}

const EXTRA = ['demo-site', 'display-model-smoke', 'testmath-site'].filter(d => existsSync(join(REPO, 'build', d, 'index.html')));

for (const name of [...names(), ...EXTRA.map(d => `build:${d}`)]) {
  test(`sliced equals synchronous at several widths: ${name}`, async ({ openPage, browser }) => {
    test.setTimeout(180000);
    let url = name, server: any = null, open = openPage as (url: string, o: any) => Promise<WebPage>;
    const errors: string[] = [];
    if (name.startsWith('build:')) {
      const s = await serveDirectory(join(REPO, "build", name.slice(6)));   // (a site may name its fonts from its root)
      server = s.server;
      url = `${s.url}/index.html`;
      // A whole site: its blocks below the first screens are not drawn yet,
      // which openPage waits for; every block laid out is enough here.
      open = async (u, { width, height, route }) => {
        const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
        await ctx.route(...(route as [string, any]));
        const p = Object.assign(await ctx.newPage(), { errors });
        p.on('pageerror', e => errors.push(`uncaught: ${e}`));
        p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        p.on('requestfailed', r => errors.push(`request failed: ${r.url()}`));
        await p.goto(u);
        await p.waitForFunction(() => (window as any).reflowtex?.inspect
          && reflowtex.inspect.blocks().length >= document.querySelectorAll("[data-nodelist-b64]").length);
        await idle(p);
        return p;
      };
    }
    try {
      const widths = [700, 520, 380, 300];
      const a = await across(open, url, false, widths);
      const b = await across(open, url, true, widths);
      expect(a.mode.every(m => m === 'sliced') && b.mode.every(m => m === 'sync')).toBe(true);
      a.out.forEach((o, k) => same(o, b.out[k], k < widths.length ? `at ${widths[k]} px` : 'drawn whole'));
      expect(errors).toEqual([]);
    } finally { server?.close(); }
  });
}

// ── The huge block ──────────────────────────────────────────────────────────

test('a fresh block, sliced, ends as the synchronous one, bit for bit, at each width', async ({ openPage, browserName }) => {
  test.setTimeout(180000);
  const page = await openPage('huge', { width: 1100, height: 800 });
  await helpers(page);
  await page.evaluate(async () => {
    const w = window as any;
    w.__S = await w.__copy('sliced', 500);
    w.__Y = await w.__copy('sync', 500);
  });
  // Mounted sliced, it had work left; mounted sync, none.
  expect(await page.evaluate(() => (window as any).__fp((window as any).__Y.el).some((s: string) => s.startsWith('P')))).toBe(false);
  await idle(page);
  for (const w of [500, 380, 620, 450]) {
    await page.evaluate(w => { const x = window as any; x.__S.el.style.width = w + 'px'; x.__Y.el.style.width = w + 'px'; }, w);
    await idle(page);
    const [s, y] = await page.evaluate(() => { const x = window as any; return [x.__fp(x.__S.el), x.__fp(x.__Y.el)]; });
    // (a width between two seen before may be answered from the cache: a
    // segment off the screen is then deferred, in either mode, by where it is)
    if (w !== 450) same(s, y, `at ${w} px`, browserName);
    expect(s.filter((x: string) => x.startsWith('P'))).toEqual([]);
  }
  // Everything drawn, and laid out once more with every segment real: identical.
  await page.evaluate(() => { const x = window as any; x.__paintAll(); });
  await idle(page);
  await page.evaluate(() => { const x = window as any; for (const b of [x.__S, x.__Y]) reflowtex.inspect.state(b.el).cache.relayout(); });
  await idle(page);
  const [s, y] = await page.evaluate(() => { const x = window as any; return [x.__fp(x.__S.el, true), x.__fp(x.__Y.el, true)]; });
  same(s, y, 'drawn whole', browserName);
});

test('the events and inspect.idle() report the end of a layout once, and a sync block sends none', async ({ openPage }) => {
  const page = await openPage('huge', { width: 1100, height: 800 });
  await helpers(page);
  const r = await page.evaluate(async () => {
    const x = window as any;
    const B = reflowtex.host.blocks()[0];
    const seen: string[] = [];
    let slices = 0;
    B.on('layoutstart', () => seen.push('start'));
    B.on('layoutslice', ({ left }: { left: number }) => { slices++; if (left < 0) seen.push('negative'); });
    B.on('layoutcomplete', () => seen.push('complete'));
    let resolved = 0;
    B.el.style.width = '430px';
    // (the reflow comes in a frame, and is settled into slices after a pause)
    await new Promise(r => { B.el.addEventListener('reflowtex:layoutstart', r, { once: true }); });
    const done = B.layoutDone().then(() => { resolved++; });
    const midway = reflowtex.inspect.state(B.el).cache.layout.laid.filter((L: any) => L.pending).length;
    await reflowtex.inspect.idle();
    await done;
    const after = { pending: reflowtex.inspect.state(B.el).cache.layout.laid.filter((L: any) => L.pending).length,
                    state: reflowtex.inspect.slices() };
    // A sync block: laid out whole at once, no events.
    const Y = await x.__copy('sync', 430);
    const yPending = reflowtex.inspect.state(Y.el).cache.layout.laid.filter((L: any) => L.pending).length;
    await reflowtex.inspect.idle();
    return { seen, slices, resolved, midway, after: { pending: after.pending, queued: after.state.queued, runs: after.state.runs.length },
             yPending, events: x.__events, doneNow: await Promise.race([B.layoutDone().then(() => 'resolved'), new Promise(r => setTimeout(() => r('waiting'), 0))]) };
  });
  expect(r.midway).toBeGreaterThan(50);
  expect(r.seen).toEqual(['start', 'complete']);
  expect(r.slices).toBeGreaterThan(2);
  expect(r.resolved).toBe(1);
  expect(r.after).toEqual({ pending: 0, queued: 0, runs: 0 });
  expect(r.yPending).toBe(0);
  expect(r.events.layoutstart).toBe(1);
  expect(r.events.layoutcomplete).toBe(1);
  expect(r.doneNow).toBe('resolved');
});

test('a second width midway restarts the slices: one run, one width, nothing stale', async ({ openPage, browserName }) => {
  test.setTimeout(120000);
  const page = await openPage('huge', { width: 1100, height: 800 });
  await helpers(page);
  for (const how of ['resize', 'relayout']) {
    const r = await page.evaluate(async how => {
      const x = window as any;
      x.__events = { layoutstart: 0, layoutslice: 0, layoutcomplete: 0 };
      const B = reflowtex.host.blocks()[0], st = () => reflowtex.inspect.state(B.el);
      const to = (pt: number) => {
        if (how === 'resize') B.el.style.width = pt * 2 + 'px';
        else { B.el.dataset.latexWidth = String(pt); st().cache.relayout(); }
      };
      to(how === 'resize' ? 260 : 255);
      await new Promise(r => { B.el.addEventListener('reflowtex:layoutslice', r, { once: true }); });
      const left = st().cache.layout.laid.filter((L: any) => L.pending).length;
      to(how === 'resize' ? 190 : 185);
      await B.layoutDone();
      await reflowtex.inspect.idle();
      const want = how === 'resize' ? 190 : 185;
      const s = st();
      const wrong = s.cache.layout.laid.map((L: any, i: number) => {
        const seg = s.cache.dom.segs[i];
        if (L.pending) return `${i} pending`;
        if (seg.sub || L.deferred) return null;
        return seg.hc && seg.hc.exact.get(s.lastWidth) && seg.hc.exact.get(s.lastWidth).lines === L.lines ? null : `${i} not laid out at ${s.lastWidth}`;
      }).filter(Boolean);
      return { left, width: s.lastWidth, ctx: s.cache.layoutCtx.widthPt, want, wrong, events: x.__events, queued: reflowtex.inspect.slices().queued };
    }, how);
    expect(r.left, how).toBeGreaterThan(20);
    expect([r.width, r.ctx], how).toEqual([r.want, r.want]);
    expect(r.wrong, how).toEqual([]);
    expect(r.events.layoutcomplete, how).toBe(r.events.layoutstart);
    expect(r.queued, how).toBe(0);
  }
  // And the end state is the synchronous layout's at that width.
  const [s, y] = await page.evaluate(async () => {
    const x = window as any, B = reflowtex.host.blocks()[0];
    const Y = await x.__copy('sync', 370, B.el);
    Y.el.dataset.latexWidth = '185';
    reflowtex.inspect.state(Y.el).cache.relayout();
    await reflowtex.inspect.idle();
    x.__paintAll();
    await reflowtex.inspect.idle();
    for (const b of [B, Y]) reflowtex.inspect.state(b.el).cache.relayout();
    await reflowtex.inspect.idle();
    return [x.__fp(B.el, true), x.__fp(Y.el, true)];
  });
  same(s, y, 'after the interruptions', browserName);
});

test('unmounting midway leaves no slices, errors or references behind', async ({ openPage, browserName }) => {
  const page = await openPage('huge', { width: 1100, height: 800 });
  await helpers(page);
  const r = await page.evaluate(async () => {
    const x = window as any;
    x.__refs = [];
    let done = 0;
    for (let k = 0; k < 6; k++) {
      const B = await x.__copy('sliced', 480 - k * 20);
      const s = reflowtex.inspect.state(B.el);
      x.__refs.push(new WeakRef(s), new WeakRef(s.cache.dom.root));
      B.layoutDone().then(() => { done++; });
      if (k % 2) await new Promise(r => { B.el.addEventListener('reflowtex:layoutslice', r, { once: true }); setTimeout(r, 1000); });
      B.unmount();
      B.el.remove();
    }
    await reflowtex.inspect.idle();
    // (the last block drawn stays referenced until another is drawn, sliced
    // or not: one more, drawn whole and unmounted)
    { const E = await x.__copy('sync', 300); E.unmount(); E.el.remove(); await reflowtex.inspect.idle(); }
    return { done, state: reflowtex.inspect.slices(), blocks: reflowtex.host.blocks().length };
  });
  expect(r.done).toBe(6);
  expect([r.state.queued, r.state.runs.length, r.blocks]).toEqual([0, 0, 1]);
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.collectGarbage');
    expect(await page.evaluate(() => (window as any).__refs.map((w: WeakRef<object>, i: number) => w.deref() ? i : -1).filter((i: number) => i >= 0))).toEqual([]);
  }
});

test('a host keeping its reading line sees it stay within a pixel through the slices', async ({ openPage, browserName }) => {
  const page = await openPage('huge', { width: 1100, height: 800 });
  await helpers(page);
  for (const own of [true, false]) {
    // Without a host's own keeping, the browser's scroll anchoring holds it
    // (WebKit has none: there, only a host's keeping is tested).
    if (!own && browserName === 'webkit') continue;
    const r = await page.evaluate(async ([own, w]) => {
      const B = reflowtex.host.blocks()[0];
      const segs = reflowtex.inspect.state(B.el).cache.dom.segs;
      window.scrollTo(0, document.documentElement.scrollHeight * 0.45);
      await reflowtex.inspect.idle();
      // the reading line: the first segment box below the window's middle
      const box = segs.map((s: any) => s.box).find((b: HTMLElement) => b.getBoundingClientRect().top > innerHeight / 2) as HTMLElement;
      // where it stands once the lines on the screen are broken again, when
      // the slices begin (a host keeping it own holds it from the start)
      let at = box.getBoundingClientRect().top;
      let worst = 0, checks = 0, started = false;
      B.el.addEventListener('reflowtex:layoutstart', () => { started = true; if (!own) at = box.getBoundingClientRect().top; }, { once: true });
      const keep = () => {
        if (own) { const d = box.getBoundingClientRect().top - at; if (d) window.scrollBy(0, d); }
        if (started || own) worst = Math.max(worst, Math.abs(box.getBoundingClientRect().top - at));
        checks++;
      };
      if (own) for (const e of [document.documentElement, document.body]) e.style.overflowAnchor = 'none';
      const evs = ['reflowtex:layout', 'reflowtex:layoutslice', 'reflowtex:layoutcomplete'];
      for (const e of evs) document.addEventListener(e, keep);
      let looking = true;
      // and after every frame is drawn (the browser's anchoring has acted)
      const look = () => {
        if (!looking) return;
        if (started) worst = Math.max(worst, Math.abs(box.getBoundingClientRect().top - at));
        requestAnimationFrame(() => setTimeout(look, 0));
      };
      look();
      B.el.style.width = w + 'px';
      await new Promise(r => { B.el.addEventListener('reflowtex:layoutstart', r, { once: true }); });
      await B.layoutDone();
      await reflowtex.inspect.idle();
      looking = false;
      for (const e of evs) document.removeEventListener(e, keep);
      for (const e of [document.documentElement, document.body]) e.style.overflowAnchor = '';
      return { worst, checks, end: Math.abs(box.getBoundingClientRect().top - at) };
    }, [own, own ? 430 : 610] as const);
    expect(r.checks, `own ${own}`).toBeGreaterThan(2);
    expect(r.worst, `own ${own}`).toBeLessThanOrEqual(1);
    expect(r.end, `own ${own}`).toBeLessThanOrEqual(1);
  }
});

test('on the screen at once, near it in slices: the first visit far down, and a re-break', async ({ openPage }) => {
  const page = await openPage('huge', { width: 1100, height: 800 });
  const r = await page.evaluate(async () => {
    const st = reflowtex.inspect.state(reflowtex.host.blocks()[0].el);
    const segs = st.cache.dom.segs;
    const on = () => segs.filter((s: any) => { const b = s.svg && s.svg.getBoundingClientRect(); return b && b.bottom > 0 && b.top < innerHeight; });
    const unpaintedOnScreen = () => on().filter((s: any) => !s.painted || s.dirty).length;
    const near = () => segs.filter((s: any) => { const b = s.svg && s.svg.getBoundingClientRect(); return b && b.bottom > -innerHeight && b.top < 2 * innerHeight; });
    window.scrollTo(0, document.documentElement.scrollHeight * 0.7);
    // two frames for the observer to report
    const frames: number[] = [];
    for (let k = 0; k < 3; k++) { await new Promise(r => requestAnimationFrame(r)); frames.push(unpaintedOnScreen()); }
    const queuedSoon = reflowtex.inspect.slices().queued;
    await reflowtex.inspect.idle();
    return { frames, queuedSoon, nearUnpainted: near().filter((s: any) => !s.painted || s.dirty).length, onScreen: on().length };
  });
  expect(r.onScreen).toBeGreaterThan(3);
  expect(r.frames[2]).toBe(0);              // what is on the screen is drawn within two frames
  expect(r.nearUnpainted).toBe(0);          // and, once idle, what is near it
});

test('sync where asked: data-latex-layout, host.setLayout, flushLayout, print', async ({ openPage }) => {
  const page = await openPage('huge', { width: 1100, height: 800 });
  await helpers(page);
  const r = await page.evaluate(async () => {
    const x = window as any;
    const pend = (b: any) => reflowtex.inspect.state(b.el).cache.layout.laid.filter((L: any) => L.pending).length;
    const out: Record<string, unknown> = { mode: reflowtex.host.layout() };
    // the attribute on the element
    const src = document.querySelector('.latex-block[data-nodelist-b64]') as HTMLElement;
    const el = document.body.appendChild(Object.assign(document.createElement('div'), { className: 'latex-block' }));
    el.dataset.nodelistB64 = src.dataset.nodelistB64!;
    el.dataset.latexLayout = 'sync';
    el.style.width = '400px';
    const A = await reflowtex.host.mount(el);
    out.attr = pend(A);
    A.unmount(); el.remove();
    // flushLayout: everything now
    const S = await x.__copy('sliced', 420);
    out.before = pend(S) > 0;
    S.flushLayout();
    out.flushed = pend(S);
    out.queuedAfterFlush = reflowtex.inspect.slices().runs.filter((r: any) => r.block === S.el).length;
    // the host's default
    reflowtex.host.setLayout('sync');
    const T = await x.__copy(undefined as any, 410);
    out.hostSync = pend(T);
    reflowtex.host.setLayout('sliced');
    // print: laid out and painted whole first
    const P = await x.__copy('sliced', 380);
    out.printBefore = pend(P) > 0;
    x.__paintAll();
    const st = reflowtex.inspect.state(P.el);
    out.printPending = pend(P);
    out.printUnpainted = st.cache.dom.segs.filter((s: any) => s.svg && (!s.painted || s.dirty)).length;
    try { reflowtex.host.setLayout('later' as any); out.bad = 'accepted'; } catch (e) { out.bad = 'refused'; }
    await reflowtex.inspect.idle();
    return out;
  });
  expect(r).toEqual({ mode: 'sliced', attr: 0, before: true, flushed: 0, queuedAfterFlush: 0, hostSync: 0,
                      printBefore: true, printPending: 0, printUnpainted: 0, bad: 'refused' });
});

// Timing (@timing: in projects of their own, after every other test, see
// playwright.config.ts): these two run one after the other, never beside each other.
test.describe('timing @timing', () => {
test.describe.configure({ mode: 'serial' });

test('no long task in a re-break of the huge block, nor on a first visit far down', async ({ openPage, browserName }) => {
  test.setTimeout(120000);
  const page = await openPage('huge', { width: 1100, height: 800 });
  // (a machine busy with other tests stretches every task: the best of five)
  let r: any;
  for (let attempt = 0; attempt < 5; attempt++) {
    r = await page.evaluate(async attempt => {
      const B = reflowtex.host.blocks()[0];
      window.scrollTo(0, 0);
      await reflowtex.inspect.idle();
      reflowtex.inspect.slices(true);
      const long: number[] = [];
      let po: PerformanceObserver | null = null;
      try { po = new PerformanceObserver(l => { for (const e of l.getEntries()) long.push(Math.round(e.duration)); }); po.observe({ type: 'longtask' }); }
      catch { po = null; }
      for (const w of [520, 400, 640, 460]) { B.el.style.width = w + attempt * 6 + 'px'; await reflowtex.inspect.idle(); }
      window.scrollTo(0, document.documentElement.scrollHeight * (0.5 + attempt * 0.05));
      await reflowtex.inspect.idle();
      B.el.style.width = 560 + attempt * 6 + 'px';
      await reflowtex.inspect.idle();
      window.scrollTo(0, document.documentElement.scrollHeight * (0.8 + attempt * 0.05));
      await reflowtex.inspect.idle();
      po?.disconnect();
      const s = reflowtex.inspect.slices();
      return { long, observed: !!po, slices: s.slices, longest: Math.round(s.longest), finish: Math.round(s.finish) };
    }, attempt);
    if (r.longest < 50 && !r.long.length) break;
  }
  test.info().annotations.push({ type: 'long tasks', description: `${browserName}: ${JSON.stringify(r)}` });
  expect(r.slices).toBeGreaterThan(10);
  // Each slice keeps to its budget, give or take one segment's layout.
  expect(r.longest, JSON.stringify(r)).toBeLessThan(50);
  // Where the browser reports long tasks (Chromium), none.
  if (r.observed) expect(r.long, JSON.stringify(r)).toEqual([]);
});

// ── A stress test ───────────────────────────────────────────────────────────

test('stress: random widths and scrolling during the slices, every end checked against sync', async ({ openPage }) => {
  test.setTimeout(600000);
  const page = await openPage('huge', { width: 1100, height: 800 });
  await helpers(page);
  const ITER = 300;
  const r = await page.evaluate(async (ITER) => {
    const x = window as any;
    let seed = 12345;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const WIDTHS = [280, 330, 390, 440, 500, 560, 610, 680, 740];
    const B = reflowtex.host.blocks()[0], st = () => reflowtex.inspect.state(B.el);
    // A segment's key: P pending; R its height and line breaks, laid out;
    // D its height, deferred (off the screen, from its cache); S a stream.
    const key = (L: any, s: any) => L.pending ? 'P' : s && s.sub ? 'S'
      : L.deferred ? 'D' + L.H : 'R' + JSON.stringify([L.H, (L.lines || []).map((l: any) => l.nodes.length).join(',')]);
    // The synchronous layout at each width, from a fresh block.
    const refs: Record<number, string[]> = {};
    const ref = async (w: number) => {
      if (!refs[w]) {
        const Y = await x.__copy('sync', w);
        const c = reflowtex.inspect.state(Y.el).cache;
        refs[w] = c.layout.laid.map((L: any, i: number) => key(L, c.dom.segs[i]));
        Y.unmount(); Y.el.remove();
      }
    };
    // (the keys are compared in Node, not here: in WebKit, once in a few
    // runs, the page's own comparison of equal keys, some 100,000 calls in,
    // came out unequal)
    const ends: { it: number, w: number, keys: string[] }[] = [], fps: { it: number, before: string[], after: string[] }[] = [];
    const problems: string[] = [];
    let starts = 0, completes = 0;
    B.on('layoutstart', () => starts++);
    B.on('layoutcomplete', () => completes++);
    for (let it = 0; it < ITER; it++) {
      const steps = 1 + Math.floor(rnd() * 3);
      let w = 0;
      for (let k = 0; k < steps; k++) {
        w = WIDTHS[Math.floor(rnd() * WIDTHS.length)];
        const how = rnd();
        if (how < 0.6) B.el.style.width = w + 'px';
        else { B.el.style.width = w + 'px'; st().cache.relayout(); }
        if (rnd() < 0.5) window.scrollTo(0, rnd() * document.documentElement.scrollHeight);
        const wait = rnd();
        if (wait < 0.3) await new Promise(r => requestAnimationFrame(r));
        else if (wait < 0.6) await new Promise(r => setTimeout(r, rnd() * 60));
        else if (wait < 0.8) await new Promise(r => { const t = setTimeout(r, 300); B.el.addEventListener('reflowtex:layoutslice', () => { clearTimeout(t); r(0); }, { once: true }); });
      }
      await reflowtex.inspect.idle();
      const s = st();
      if (s.lastWidth !== w / 2) problems.push(`${it}: width ${s.lastWidth}, not ${w / 2}`);
      if (reflowtex.inspect.slices().queued || reflowtex.inspect.slices().runs.length) problems.push(`${it}: slices left`);
      ends.push({ it, w, keys: s.cache.layout.laid.map((L: any, i: number) => key(L, s.cache.dom.segs[i])) });
      await ref(w);
      // A synchronous layout of the block as it is now changes nothing.
      if (it % 10 === 0) {
        const before = x.__fp(B.el);
        reflowtex.host.setLayout('sync');
        s.cache.relayout();
        reflowtex.host.setLayout('sliced');
        fps.push({ it, before, after: x.__fp(B.el) });
        await reflowtex.inspect.idle();
      }
    }
    return { problems, starts, completes, ends, refs, fps };
  }, ITER);
  const problems = [...r.problems];
  for (const { it, w, keys } of r.ends) {
    const want = r.refs[w];
    keys.forEach((k, i) => {
      if (problems.length > 20) return;
      if (k === 'P') problems.push(`${it}: segment ${i} pending`);
      else if (k[0] === 'R' && k !== want[i]) problems.push(`${it}: segment ${i} at ${w}: ${k} vs ${want[i]}`);
      // (a deferred segment's height against the synchronous one's, whichever it is)
      else if (k[0] === 'D' && Number(k.slice(1)) !== (want[i][0] === 'D' ? Number(want[i].slice(1)) : JSON.parse(want[i].slice(1))[0]))
        problems.push(`${it}: deferred segment ${i} at ${w}: ${k} vs ${want[i]}`);
    });
  }
  for (const { it, before, after } of r.fps) {
    const d = before.findIndex((v, i) => v !== after[i]);
    if (d >= 0) problems.push(`${it}: a sync relayout changed segment ${d}: ${before[d]} → ${after[d]}`);
  }
  expect(problems).toEqual([]);
  expect(r.ends.length).toBe(ITER);
  expect(r.completes).toBe(r.starts);
  expect(r.starts).toBeGreaterThan(ITER / 3);
});
});
