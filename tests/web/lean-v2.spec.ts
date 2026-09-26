// SPDX-License-Identifier: AGPL-3.0-or-later
// leanproof and leantheorem drawn by the companion (src/companion/src/kinds/
// lean.tsx): switches, parts opening and closing with motion, side by side,
// the text around moving, the code, print, the space after a hidden proof.
import { test, expect, type WebPage } from './fixtures.ts';

const THM = '.latex-stream[data-kind="leantheorem"]', PRF = '.latex-stream[data-kind="leanproof"]';

const state = (page: WebPage, sel: string) => page.evaluate(s => {
  const w = document.querySelector(s)!, r = w.querySelector('.rtx-lean') as HTMLElement;
  const parts = Object.fromEntries([...w.querySelectorAll<HTMLElement>('.rtx-lean-part')].map(p => [p.dataset.part, p.dataset.state]));
  const b = w.querySelector('.rtx-lean-body') as HTMLElement;
  return { proof: 'proof' in r.dataset, lean: 'lean' in r.dataset, parts,
           pressed: [...w.querySelectorAll('.rtx-lean-switches button')].map(b => b.getAttribute('aria-pressed')),
           animating: 'animating' in b.dataset, height: b.getBoundingClientRect().height };
}, sel);

const press = (page: WebPage, sel: string, label: string) =>
  page.locator(`${sel} .rtx-lean-switches button`, { hasText: label }).click();

const lastLineY = (page: WebPage, block: number) => page.evaluate(n => {
  const b = document.querySelectorAll('.latex-block[data-nodelist-b64]')[n];
  const ts = [...b.querySelectorAll(':scope > div > div > svg text tspan')], t: any = ts[ts.length - 1];
  const p = t.ownerSVGElement.createSVGPoint(); p.y = parseFloat(t.getAttribute('y'));
  return p.matrixTransform(t.getScreenCTM()).y as number;
}, block);

test('drawn by the companion, with their defaults', async ({ openPage }) => {
  const page = await openPage('lean-v2');
  const t = await state(page, THM), p = await state(page, PRF);
  expect(t.parts, 'leantheorem: show=none').toEqual({ tex: 'closed', code: 'closed' });
  expect(t.pressed).toEqual(['false', 'false']);
  expect(p.parts, 'leanproof: show=proof').toEqual({ tex: 'open', code: 'closed' });
  expect(p.pressed).toEqual(['true', 'false']);
  expect(await page.locator(`${THM} .rtx-lean-switches.rtx-lean-hang`).count(), 'hanging under the theorem').toBe(1);
});

test('opening animates and moves the text after', async ({ openPage }) => {
  const page = await openPage('lean-v2');
  const y0 = await lastLineY(page, 0), h0 = (await state(page, THM)).height;
  await press(page, THM, 'Proof');
  await page.waitForTimeout(110);
  const mid = await state(page, THM);
  expect([mid.animating, mid.parts.tex, mid.pressed[0]]).toEqual([true, 'open', 'true']);
  await page.waitForTimeout(700);
  const end = await state(page, THM);
  expect(end.animating).toBe(false);
  expect(h0 <= mid.height && mid.height < end.height).toBe(true);
  expect(await lastLineY(page, 0), 'the text after the widget moved down').toBeGreaterThan(y0 + 20);
});

test('closing fades, then collapses', async ({ openPage }) => {
  const page = await openPage('lean-v2');
  await press(page, PRF, 'Proof');
  await page.waitForTimeout(60);
  let s = await state(page, PRF);
  expect([s.pressed[0], s.parts.tex], 'still drawn while it fades').toEqual(['false', 'open']);
  await page.waitForTimeout(800);
  s = await state(page, PRF);
  expect(s.parts.tex).toBe('closed');
  expect(s.animating).toBe(false);
  expect(s.height).toBeLessThan(2);
});

test('reduced motion cuts', async ({ openPage }) => {
  const page = await openPage('lean-v2', { reducedMotion: 'reduce' });
  await press(page, THM, 'Lean');
  await page.waitForTimeout(30);
  const s = await state(page, THM);
  expect(s.parts.code).toBe('open');
  expect(s.animating).toBe(false);
});

const geometry = (page: WebPage, sel: string) => page.evaluate(s => {
  const w = document.querySelector(s)!;
  const [a, b] = ['tex', 'code'].map(k => w.querySelector(`.rtx-lean-part[data-part="${k}"]`)!.getBoundingClientRect());
  return { sameTop: Math.abs(a.top - b.top) < 1, sameHeight: Math.abs(a.height - b.height) < 1, beside: b.left > a.right, below: b.top >= a.bottom };
}, sel);

test('side by side when wide', async ({ openPage }) => {
  const page = await openPage('lean-v2', { width: 1400 });
  await press(page, THM, 'Proof');
  await press(page, THM, 'Lean');
  await page.waitForTimeout(900);
  const g = await geometry(page, THM);
  expect([g.sameTop, g.sameHeight, g.beside]).toEqual([true, true, true]);
  expect(await overflow(page, THM), 'the proof broken to its column, not under the code').toBe(0);
});

// How far the TeX part's glyphs reach past its right edge (0: none do).
const overflow = (page: WebPage, sel: string) => page.evaluate(s => {
  const part = document.querySelector(s + ' .rtx-lean-part[data-part="tex"]')!, right = part.getBoundingClientRect().right;
  return Math.max(0, ...[...part.querySelectorAll('tspan')].map(t => Math.round(t.getBoundingClientRect().right - right)));
}, sel);

test('stacked when narrow', async ({ openPage }) => {
  const page = await openPage('lean-v2', { width: 600 });
  await press(page, PRF, 'Lean');
  await page.waitForTimeout(900);
  expect((await geometry(page, PRF)).below).toBe(true);
});

test('the code', async ({ openPage }) => {
  const page = await openPage('lean-v2');
  await press(page, THM, 'Lean');
  await page.waitForTimeout(700);
  const r = await page.evaluate(s => { const c = document.querySelector(s + ' .rtx-lean-code')!;
    return { head: c.querySelector('.rtx-lean-head a')?.getAttribute('href'),
             kw: [...c.querySelectorAll('.lean-kw')].map(e => e.textContent).slice(0, 3),
             comment: c.querySelector('.lean-com')?.textContent, text: c.querySelector('code')!.textContent! }; }, THM);
  expect(r.head).toBe('https://example.org/sum_odd');
  expect(r.kw[0]).toBe('theorem');
  expect(r.comment).toBe('-- the last term');
  expect(r.text, 'indentation kept').toContain('    ∑ i ∈ Finset.range n');
});

test('the choice survives relayout', async ({ openPage }) => {
  const page = await openPage('lean-v2');
  await press(page, THM, 'Lean');
  await page.waitForTimeout(700);
  await page.locator('.latex-block[data-nodelist-b64]').first().evaluate((b: HTMLElement) => { b.style.width = '360px'; });
  await page.waitForTimeout(400);
  expect((await state(page, THM)).parts).toEqual({ tex: 'closed', code: 'open' });
});

test('print shows every part', async ({ openPage }) => {
  const page = await openPage('lean-v2');
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.waitForTimeout(100);
  const r = await page.evaluate(() => ({
    parts: [...document.querySelectorAll('.rtx-lean-part')].map(p => getComputedStyle(p).display !== 'none'),
    switches: [...document.querySelectorAll('.rtx-lean-switches')].map(s => getComputedStyle(s).display) }));
  expect(r.parts.every(Boolean)).toBe(true);
  expect([...new Set(r.switches)]).toEqual(['none']);
});

test('the space after a hidden proof is taken back', async ({ openPage }) => {
  // TeX's space after the widget is the space after the proof; while the
  // proof is hidden the widget gives back the difference (host.spacing(),
  // the proof part's spaceBefore).
  const page = await openPage('lean-v2');
  const margin = () => page.evaluate(s => parseFloat((document.querySelector(s) as HTMLElement).style.marginBottom) || 0, THM);
  const closed = await margin();
  await press(page, THM, 'Proof');
  await page.waitForTimeout(800);
  expect(closed).toBeLessThan(-2);
  expect(await margin()).toBe(0);
});
