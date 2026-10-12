// SPDX-License-Identifier: AGPL-3.0-or-later
// What each document uses, counted once (memoised): glyphs by font and
// character, pictures, streams' markers and places, links, citations,
// anchors and slots; and labels for the blocks they are in.

import { I } from './context.js';

// One walk over a document's nodes: what it uses, and how often.
export const censusMemo = new WeakMap();
export function census(doc) {
    let c = censusMemo.get(doc);
    if (c) return c;
    c = { glyphs: new Map(), pictures: new Map(), markers: new Map(), links: new Map(), cites: new Map(),
          citeTargets: new Map(), anchors: new Map(), slots: new Map(), parents: new Map() };
    const bump = (m, k, first) => { const v = m.get(k); if (v) v.count++; else m.set(k, { count: 1, ...first }); };
    const walk = list => {
        for (const n of list || []) {
            if (n.type === 'glyph' && n.text === undefined) {
                let f = c.glyphs.get(n.font);
                if (!f) c.glyphs.set(n.font, f = new Map());
                bump(f, n.char, { metrics: n.metrics ? (doc.glyph_metrics || [])[n.metrics - 1] : n });
            }
            if (n.type === 'picture' && n.picture) bump(c.pictures, n.picture, { box: n });
            if (n.stream) bump(c.markers, n.stream);
            if (n.link) bump(c.links, n.link);
            if (n.cite) bump(c.cites, n.cite);
            if (n.citetarget) bump(c.citeTargets, n.citetarget);
            if (n.slot) bump(c.slots, n.slot);
            if (n.anchor) bump(c.anchors, n.anchor, { where: 'box' });
            walk(n.children); walk(n.pre); walk(n.post); walk(n.replace);
            if (n.leader) walk([n.leader]);
        }
    };
    for (const p of doc.paragraphs || []) walk(p.nodes);
    // content items: a display's box, an anchor between items, a stream's place
    const items = (list, parent) => {
        for (const it of list || []) {
            if (it.box) walk([it.box]);
            if (it.kind === 'anchorpoint' && it.anchor) bump(c.anchors, it.anchor, { where: 'point' });
            if (it.kind === 'stream' && it.stream) c.parents.set(it.stream, parent);
        }
    };
    items(doc.content, 0);
    (doc.streams || []).forEach((s, k) => items(s.content, k + 1));
    censusMemo.set(doc, c);
    return c;
}
// A font's identity across blocks: its file, or (with no file to load) its TeX name.
export const fileOf = f => (f.filename && f.filename !== 'unknown' ? f.filename : null);
export const fontKeyOf = f => fileOf(f) || `tex ${f.name}`;
export const fontKeysMemo = new WeakMap();
export function fontKeyIn(doc, id) {
    let m = fontKeysMemo.get(doc);
    if (!m) fontKeysMemo.set(doc, m = new Map((doc.fonts || []).map(f => [f.id, fontKeyOf(f)])));
    return m.get(id);
}
export const clip = (t, k) => (t.length > k ? t.slice(0, k) + '…' : t);
export const blockLabel = b => `block ${b}`;
// A set of blocks (numbers from 1) in a few words: "block 3", "blocks 1–4, 9",
// or "every block (28)" when it is all of them.
export function blocksLabel(nums) {
    const b = [...new Set(nums)].sort((x, y) => x - y), all = I.blocks().length;
    if (!b.length) return 'no block';
    if (b.length === 1) return blockLabel(b[0]);
    if (b.length === all) return `every block (${all})`;
    const runs = [];
    for (const n of b) { const r = runs[runs.length - 1]; if (r && n === r[1] + 1) r[1] = n; else runs.push([n, n]); }
    return 'blocks ' + runs.map(([a, z]) => a === z ? a : `${a}${z === a + 1 ? ', ' : '–'}${z}`).join(', ');
}
// Bibliography entries the page ships for its citation popovers (#lr-citations).
export function citeEntries() {
    const raw = document.getElementById('lr-citations');
    if (!raw) return {};
    try { let d = JSON.parse(raw.textContent); if (typeof d === 'string') d = JSON.parse(d); return d && typeof d === 'object' ? d : {}; }
    catch { return {}; }
}
