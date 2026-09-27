#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// What a screen reader is given on each page of the site, and what it misses.
//
// A screen reader (Orca, VoiceOver, NVDA) reads the browser's accessibility
// tree, not the drawing. For every docs page this takes Chromium's tree
// (DevTools protocol, the tree those readers are handed), walks it in reading
// order, and compares it with the words the viewer drew: a drawn word the
// tree never gives is text a reader skips; drawn words given out of order are
// read in the wrong place.
//
//     node website/tools/reading-audit.ts [--base http://localhost:1414/reflowtex/] [--page docs/…/] [--dump]
//
// --dump prints each page's reading order as the tree gives it.
import { parseArgs } from 'node:util';
import { chromium, type Page } from 'playwright';

const { values: o } = parseArgs({ options: {
  base: { type: 'string', default: 'http://localhost:1414/reflowtex/' },
  page: { type: 'string', multiple: true },
  dump: { type: 'boolean', default: false },
  width: { type: 'string', default: '1300' },
} });

interface AXNode { nodeId: string; ignored: boolean; role?: { value: string }; name?: { value: string };
  childIds?: string[]; backendDOMNodeId?: number; properties?: { name: string; value: { value: unknown } }[] }

/** The tree's text in reading order: each piece of text, and each formula as
 *  its name (its alttext, or MathML read as a whole). */
export async function readingOrder(page: Page): Promise<string[]> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Accessibility.enable');
  const { nodes } = await cdp.send('Accessibility.getFullAXTree') as { nodes: AXNode[] };
  const byId = new Map(nodes.map(n => [n.nodeId, n]));
  const out: string[] = [];
  const walk = (n: AXNode | undefined) => {
    if (!n) return;
    const role = n.role?.value;
    if (!n.ignored) {
      if (role === 'StaticText' || role === 'text') { if (n.name?.value) out.push(n.name.value); return; }
      if (role === 'math' || role === 'MathMLMath') {
        out.push(n.name?.value || mathText(n, byId));
        return;
      }
      if ((role === 'image' || role === 'img') && n.name?.value) out.push(`[image: ${n.name.value}]`);
    }
    for (const c of n.childIds ?? []) walk(byId.get(c));
  };
  walk(nodes[0]);
  await cdp.detach();
  return out;
}
const mathText = (n: AXNode, byId: Map<string, AXNode>): string => {
  const parts: string[] = [];
  const walk = (m: AXNode | undefined) => { if (!m) return; if (m.role?.value === 'StaticText' && m.name?.value) parts.push(m.name.value); for (const c of m.childIds ?? []) walk(byId.get(c)); };
  walk(n);
  return parts.join(' ');
};

/** The words the viewer drew, block by block, line by line: a line is a run
 *  of glyphs on one baseline, in text fonts (a formula's glyphs are read as
 *  MathML or its spoken form, not letter by letter). */
async function drawnLines(page: Page): Promise<{ block: number; text: string }[]> {
  return page.evaluate(() => {
    const MATH_FONT = /^(cm(mi|sy|ex|bsy|mib)|msam|msbm|eufm|rsfs|stmary|lmmath|latinmodern-math)/i;
    const lines: { block: number; text: string }[] = [];
    document.querySelectorAll('.latex-block[data-nodelist-b64]').forEach((block, bi) => {
      const rows = new Map<number, { x: number; r: number; size: number; ch: string; brk?: string | null }[]>();
      for (const t of block.querySelectorAll('svg text tspan, svg text')) {
        if (t.localName === 'text' && t.querySelector('tspan')) continue;
        const fam = (t.getAttribute('font-family') || t.closest('text')?.getAttribute('font-family') || '').replace(/['"]/g, '');
        if (MATH_FONT.test(fam)) continue;
        const r = (t as SVGGraphicsElement).getBoundingClientRect();
        if (!r.width && !r.height) continue;                          // not drawn (a collapsed part)
        // not seen: a pane the accordion hides (inert, transparent)
        if (t.closest('[inert]') || !(t as Element).checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
        const y = Math.round((r.bottom + scrollY) / 3);
        const row = rows.get(y) ?? rows.set(y, []).get(y)!;
        row.push({ x: r.left, r: r.right, size: r.height, ch: t.textContent || '', brk: t.getAttribute('data-break') });
      }
      // a word broken at a line's end (the painter marks the line break's
      // hyphen data-break; "keep" is the author's): whole, on its first line
      let carry = '';
      const blockLines: { block: number; text: string }[] = [];
      for (const [, row] of [...rows].sort((a, b) => a[0] - b[0])) {
        row.sort((a, b) => a.x - b.x);
        if (carry && blockLines.length) {
          const first = row.findIndex(g => !g.ch.trim());
          const head = row.splice(0, first < 0 ? row.length : first).map(g => g.ch).join('');
          blockLines[blockLines.length - 1].text += head;
        }
        carry = '';
        const last = row[row.length - 1];
        if (last && last.brk !== null && last.brk !== undefined) { if (last.brk !== 'keep') row.pop(); carry = 'x'; }
        // glyphs are placed one by one: a word space is a gap between them
        let text = '';
        row.forEach((g, k) => { if (k && g.x - row[k - 1].r > 0.15 * g.size) text += ' '; text += g.ch; });
        blockLines.push({ block: bi, text });
      }
      lines.push(...blockLines);
    });
    return lines;
  });
}

const words = (s: string) => (s.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(w => w.length >= 3);

async function audit(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  // every block drawn: the viewer paints a block when it is scrolled to
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); } scrollTo(0, 0); });
  await page.waitForTimeout(800);
  // An example's LaTeX and code blocks say the drawn words too, as source:
  // not what the drawing says to a reader, so not counted.
  await page.evaluate(() => document.querySelectorAll('.latex-example-source, pre, code').forEach(e => e.setAttribute('aria-hidden', 'true')));
  const read = await readingOrder(page);
  const drawn = await drawnLines(page);
  const heard = words(read.join(' '));
  // each drawn word, found in what is read after the last one found
  const missing: string[] = [], lostWords: string[] = [];
  let at = 0, total = 0, found = 0, outOfOrder = 0;
  const pool = new Map<string, number>();
  for (const w of heard) pool.set(w, (pool.get(w) ?? 0) + 1);
  for (const line of drawn) {
    const ws = words(line.text);
    const lost = ws.filter(w => !pool.get(w));
    lostWords.push(...lost);
    for (const w of ws) {
      total++;
      if (!pool.get(w)) continue;
      found++;
      const i = heard.indexOf(w, at);
      if (i >= 0) at = i + 1; else outOfOrder++;
    }
    if (ws.length && lost.length / ws.length > 0.5) missing.push(line.text.trim());
  }
  return { read, drawn, total, found, outOfOrder, missing, lostWords };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(o.width), height: 900 } });
let pages = o.page ?? [];
if (!pages.length) {
  await page.goto(new URL('about/', o.base).href);
  pages = [...new Set(await page.$$eval('.docs-sidebar a[href]', as => as.map(a => (a as HTMLAnchorElement).href)))];
}
for (const p of pages) {
  const url = new URL(p, o.base).href;
  const r = await audit(page, url);
  const pct = r.total ? Math.round(100 * r.found / r.total) : 100;
  console.log(`\n${url.replace(o.base, '/')}  words read ${r.found}/${r.total} (${pct}%), out of order ${r.outOfOrder}`);
  for (const m of r.missing) console.log(`  SKIPPED  ${m.slice(0, 110)}`);
  if (r.lostWords.length) console.log(`  words not read: ${r.lostWords.slice(0, 20).join(' ')}`);
  if (o.dump) for (const t of r.read) console.log(`    | ${t.slice(0, 120)}`);
}
await browser.close();
