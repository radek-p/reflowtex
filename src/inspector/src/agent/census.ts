// SPDX-License-Identifier: AGPL-3.0-or-later
// What each document uses, counted once (memoised): glyphs by font and
// character, pictures, streams' markers and places, links, citations,
// anchors and slots; and labels for the blocks they are in.

import { I } from './context.ts';
import type { ContentItem, Doc, DocFont, GlyphMetrics, TexNode } from '../../../viewer/src/engine/model.ts';

/** How often a thing is used, and what its first use says. */
export interface Use { count: number; metrics?: GlyphMetrics | TexNode; box?: TexNode; where?: 'box' | 'point' }
/** A document's uses (census). `glyphs`: by font id, then character;
 *  `parents`: the stream each stream stands in (0: the flow). */
export interface Census {
    glyphs: Map<number, Map<number, Use>>;
    pictures: Map<number, Use>; markers: Map<number, Use>; links: Map<number, Use>; cites: Map<number, Use>;
    citeTargets: Map<number, Use>; anchors: Map<number, Use>; slots: Map<number, Use>;
    parents: Map<number, number>;
}
/** A bibliography entry the page ships (#lr-citations). */
export interface CiteEntry { authors?: unknown; title?: unknown; rest?: unknown; link?: { href?: string } }

// One walk over a document's nodes: what it uses, and how often.
const censusMemo = new WeakMap<Doc, Census>();
export function census(doc: Doc): Census {
    let c = censusMemo.get(doc);
    if (c) return c;
    const made: Census = c = { glyphs: new Map(), pictures: new Map(), markers: new Map(), links: new Map(), cites: new Map(),
          citeTargets: new Map(), anchors: new Map(), slots: new Map(), parents: new Map() };
    const bump = <K>(m: Map<K, Use>, k: K, first?: Partial<Use>) => { const v = m.get(k); if (v) v.count++; else m.set(k, { count: 1, ...first }); };
    const walk = (list: TexNode[] | undefined) => {
        for (const n of list || []) {
            if (n.type === 'glyph' && n.text === undefined) {
                let f = made.glyphs.get(n.font);
                if (!f) made.glyphs.set(n.font, f = new Map());
                bump(f, n.char!, { metrics: n.metrics ? (doc.glyph_metrics || [])[n.metrics - 1] : n });
            }
            if (n.type === 'picture' && n.picture) bump(made.pictures, n.picture, { box: n });
            if (n.stream) bump(made.markers, n.stream);
            if (n.link) bump(made.links, n.link);
            if (n.cite) bump(made.cites, n.cite);
            if (n.citetarget) bump(made.citeTargets, n.citetarget);
            if (n.slot) bump(made.slots, n.slot);
            if (n.anchor) bump(made.anchors, n.anchor, { where: 'box' });
            walk(n.children); walk(n.pre); walk(n.post); walk(n.replace);
            if (n.leader) walk([n.leader]);
        }
    };
    for (const p of doc.paragraphs || []) walk(p.nodes);
    // content items: a display's box, an anchor between items, a stream's place
    const items = (list: ContentItem[] | undefined, parent: number) => {
        for (const it of list || []) {
            if (it.box) walk([it.box]);
            if (it.kind === 'anchorpoint' && it.anchor) bump(made.anchors, it.anchor, { where: 'point' });
            if (it.kind === 'stream' && it.stream) made.parents.set(it.stream, parent);
        }
    };
    items(doc.content, 0);
    (doc.streams || []).forEach((s, k) => items(s.content, k + 1));
    censusMemo.set(doc, c);
    return c;
}
// A font's identity across blocks: its file, or (with no file to load) its TeX name.
export const fileOf = (f: DocFont): string | null => (f.filename && f.filename !== 'unknown' ? f.filename : null);
export const fontKeyOf = (f: DocFont): string => fileOf(f) || `tex ${f.name}`;
const fontKeysMemo = new WeakMap<Doc, Map<number | undefined, string>>();
export function fontKeyIn(doc: Doc, id: number): string | undefined {
    let m = fontKeysMemo.get(doc);
    if (!m) fontKeysMemo.set(doc, m = new Map((doc.fonts || []).map(f => [f.id, fontKeyOf(f)])));
    return m.get(id);
}
export const clip = (t: string, k: number): string => (t.length > k ? t.slice(0, k) + '…' : t);
export const blockLabel = (b: number): string => `block ${b}`;
// A set of blocks (numbers from 1) in a few words: "block 3", "blocks 1–4, 9",
// or "every block (28)" when it is all of them.
export function blocksLabel(nums: number[]): string {
    const b = [...new Set(nums)].sort((x, y) => x - y), all = I.blocks().length;
    if (!b.length) return 'no block';
    if (b.length === 1) return blockLabel(b[0]);
    if (b.length === all) return `every block (${all})`;
    const runs: [number, number][] = [];
    for (const n of b) { const r = runs[runs.length - 1]; if (r && n === r[1] + 1) r[1] = n; else runs.push([n, n]); }
    return 'blocks ' + runs.map(([a, z]) => a === z ? a : `${a}${z === a + 1 ? ', ' : '–'}${z}`).join(', ');
}
// Bibliography entries the page ships for its citation popovers (#lr-citations).
export function citeEntries(): Record<string, CiteEntry> {
    const raw = document.getElementById('lr-citations');
    if (!raw) return {};
    try { let d = JSON.parse(raw.textContent!); if (typeof d === 'string') d = JSON.parse(d); return d && typeof d === 'object' ? d : {}; }
    catch { return {}; }
}
