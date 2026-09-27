// SPDX-License-Identifier: AGPL-3.0-or-later
// reflowtex.inspect.idle(): resolves once the viewer has nothing still to
// come (runtime/pending.js). The other tests wait for it after acting, so it
// must not resolve early; and it must resolve at all.
import { test, expect } from './fixtures.ts';
import { idle } from './web.ts';

// A resize is seen by a ResizeObserver in a frame, laid out in the next, and
// settled 150 ms later: idle() waits for all three.
test('waits for a reflow and its settling pass', async ({ openPage }) => {
  const page = await openPage('selection');
  const block = page.locator('.latex-block[data-nodelist-b64]').first();
  const h0 = await block.evaluate(b => b.getBoundingClientRect().height);
  expect(await page.evaluate(() => reflowtex.inspect.pending())).toEqual([]);
  await block.evaluate((b: HTMLElement) => {
    b.style.width = '260px';
    // what is still to come, frame by frame, until nothing is
    const seen = (window as any).__seen = new Set<string>();
    const look = () => { for (const n of reflowtex.inspect.pending()) seen.add(n); requestAnimationFrame(look); };
    requestAnimationFrame(look);
  });
  await idle(page);
  const r = await page.evaluate(() => ({ pending: reflowtex.inspect.pending(), seen: [...(window as any).__seen] }));
  expect(r.pending).toEqual([]);
  expect(r.seen).toEqual(expect.arrayContaining(['reflow', 'settle']));
  expect(await block.evaluate(b => b.getBoundingClientRect().height), 'laid out narrower').toBeGreaterThan(h0);
});

// The companion's panes and hints ease with Web Animations and CSS
// transitions: idle() waits for one to end, but not for one that never does.
test('waits for an animation to end, not for an endless one', async ({ openPage }) => {
  const page = await openPage('selection');
  const r = await page.evaluate(async () => {
    const el = document.body.appendChild(document.createElement('div'));
    const spin = el.animate([{ opacity: 1 }, { opacity: 0.5 }], { duration: 100, iterations: Infinity });
    const ease = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 300 });
    const named = reflowtex.inspect.pending().length;
    await reflowtex.inspect.idle();
    return { named, ease: ease.playState, spin: spin.playState };
  });
  expect(r.named, 'the finite one named').toBe(1);
  expect(r.ease).toBe('finished');
  expect(r.spin).toBe('running');
});

// A block added later (host.mount) is set up asynchronously: idle() waits
// for it to be drawn.
test('waits for a block set up later', async ({ openPage }) => {
  const page = await openPage('selection');
  const drawn = await page.evaluate(async () => {
    const src = document.querySelector('.latex-block[data-nodelist-b64]')!;
    const el = document.body.appendChild(src.cloneNode(false) as HTMLElement);   // its data, not yet drawn
    reflowtex.host.mount(el);                                                      // (not awaited)
    await reflowtex.inspect.idle();
    return el.querySelectorAll('svg text tspan').length;
  });
  expect(drawn).toBeGreaterThan(0);
});
