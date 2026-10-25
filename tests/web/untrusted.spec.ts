// SPDX-License-Identifier: AGPL-3.0-or-later
// A document's links and pictures never run script in the page
// (src/viewer/src/engine/safe.ts). pages/untrusted: \href to javascript: (two
// spellings) and data: addresses, which are no links at all, beside a web
// link, which is; and a picture whose SVG is given, in the page, what a
// document's raw specials could put there: a script, an event handler, an
// HTML island, a javascript: address, an animation that sets one.
import { test, expect } from './fixtures.ts';
import { idle } from './web.ts';

test('a javascript: or data: \\href is plain text; a web link stays a link', async ({ openPage }) => {
  const page = await openPage('untrusted');
  const hrefs = await page.evaluate(() => [...new Set([...document.querySelectorAll<SVGElement>('[data-link-href]')].map(e => e.dataset.linkHref))]);
  expect(hrefs).toEqual(['https://example.org/']);
  // the words of the javascript: link: pressing them does nothing
  const at = await page.evaluate(() => {
    // its glyphs drawn one by one: the run that spells 'script'
    const gs = [...document.querySelector('.latex-block')!.querySelectorAll('tspan')];
    const k = gs.findIndex((_, i) => gs.slice(i, i + 6).map(g => g.textContent).join('') === 'script');
    if (k < 0) return null;
    const r = gs[k + 2]!.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  expect(at, 'the link\'s word is drawn').not.toBeNull();
  const url = page.url();
  await page.mouse.click(at!.x, at!.y);
  await idle(page);
  expect(await page.evaluate(() => (window as unknown as { __ran?: unknown }).__ran)).toBeUndefined();
  expect(page.url()).toBe(url);
});

test('a picture\'s SVG is inserted without what could run', async ({ openPage }) => {
  const page = await openPage('untrusted');
  const report = await page.evaluate(async () => {
    const w = window as unknown as { __ran?: unknown; protobuf: any; reflowtex: { host: { mount(el: HTMLElement): Promise<unknown> } } };
    const b64 = (b: Uint8Array) => btoa(Array.from(b, c => String.fromCharCode(c)).join(''));
    const bytes = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
    const schema = new TextDecoder().decode(bytes(document.getElementById('latex-schema')!.dataset.schemaB64!));
    const T = w.protobuf.parse(schema, { keepCase: true }).root.lookupType('latex.Document');
    const src = [...document.querySelectorAll<HTMLElement>('.latex-block[data-nodelist-b64]')].find(b => b.querySelector('.latex-picture'))!;
    const msg = T.decode(bytes(src.dataset.nodelistB64!));
    msg.pictures[0].svg += "<script>window.__ran='script'</script>"
      + "<image width='1' height='1' href='data:image/png;base64,AAAA' onerror=\"window.__ran='onerror'\"/>"
      + "<svg onload=\"window.__ran='onload'\"><rect width='1' height='1'/></svg>"
      + "<foreignObject width='9' height='9'><img xmlns='http://www.w3.org/1999/xhtml' src='data:,x' onerror=\"window.__ran='html'\"/></foreignObject>"
      + "<a href=\"javascript:window.__ran='a'\"><rect id='hit' width='5' height='5'/></a>"
      + "<a><set attributeName='href' to=\"javascript:window.__ran='set'\"/><rect id='hit2' width='5' height='5'/></a>";
    const el = document.createElement('div');
    el.className = 'latex-block';
    el.dataset.nodelistB64 = b64(T.encode(msg).finish());
    document.body.prepend(el);
    await w.reflowtex.host.mount(el);
    const pic = el.querySelector('.latex-picture')!;
    (pic.querySelector('#hit') as SVGElement | null)?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 300));          // an image's error event, an svg's load event
    return {
      ran: w.__ran ?? null,
      drawn: pic.querySelectorAll('path, circle, use').length,
      left: [...pic.querySelectorAll('*')].flatMap(e => [...e.attributes].filter(a => /^on/i.test(a.name)
        || (/href$/i.test(a.name) && /^\s*javascript:/i.test(a.value))).map(a => `${e.localName} ${a.name}`)),
      elements: [...pic.querySelectorAll('script, foreignObject, set, img')].map(e => e.localName),
      image: pic.querySelector('image[href^="data:image/png"]') !== null,
    };
  });
  await idle(page);
  expect(report.ran).toBeNull();
  expect(report.drawn, 'the drawing itself is there').toBeGreaterThan(0);
  expect(report.left).toEqual([]);
  expect(report.elements).toEqual([]);
  expect(report.image, 'a data: image stays').toBe(true);
});
