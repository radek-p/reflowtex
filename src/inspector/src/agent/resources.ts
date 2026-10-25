// SPDX-License-Identifier: AGPL-3.0-or-later

import { I, host, shown } from './context.ts';
import { blockId, entries, nodeRef, segId, sideId } from './ids.ts';
import { WHERE, popoverRoot, rootCache, rootsOf, segParts, segmentsOf, surfacesOf } from './resolve.ts';
import { geometry } from './geometry.ts';
import { kb, pt } from './format.ts';
import { screenRectOf } from './rects.ts';
import { textOfNodes } from './text.ts';
import { blockLabel, blocksLabel, census, citeEntries, clip, familyOf, fileOf, fontKeyIn, fontKeyOf } from './census.ts';
import { scrollIntoViewIfNeeded, viewBottom } from './overlay.ts';
import { fontOrigin, isPUA } from './fonts.ts';
import { blockOf, nodeOf } from './ids.ts';
import type { DetailRow, Resource, ResourceRow, Resources } from '../protocol.ts';
import type { Doc, DocFont, Mark, Stream, TexNode } from '../../../viewer/src/engine/model.ts';
import type { LayoutCache } from '../../../viewer/src/engine/layout/types.ts';
import type { Instance } from '../../../viewer/src/host/types.ts';

/** A resource key, read (parseKey): its category, and what it names. */
interface ParsedKey {
    cat: string;
    font?: string; cp?: number; num?: number; name?: string;
    /** In a block: its id and element, its number there, and its document. */
    bid?: number; el?: HTMLElement; k?: number; local?: string; doc?: Doc;
}

// ── Resources ──────────────────────────────────────────────────────────────────
// What the blocks draw with besides boxes and glue: fonts, pictures (a TikZ
// drawing or an included PDF page, SVG by now), streams (a footnote's body, a
// \begin{webstream} box), links, citations, anchors and \webtext slots.
// Listed for the whole page: a font file several blocks share is one font.
// Each has a key – 'font:FILE', 'glyph:CODEPOINT:FONTKEY', 'pic:BLOCK:N',
// 'stream:BLOCK:N', 'link:BLOCK:N', 'cite:N', 'anchor:BLOCK:N', 'slot:BLOCK:N'
// (BLOCK an id, N 1-based as in the document) – for uses(), which finds its
// nodes on the current layout.

// The characters of a stream, for a glimpse of it.
function streamText(doc: Doc, stream: Stream, depth = 0): string {
    const out: string[] = [];
    for (const it of stream.content || []) {
        if (it.kind === 'paragraph' && it.para) textOfNodes(doc.paragraphs[it.para - 1].nodes, out);
        else if (it.box) textOfNodes([it.box], out);
        else if (it.kind === 'stream' && it.stream && depth < 4) out.push(' ', streamText(doc, doc.streams[it.stream - 1], depth + 1), ' ');
        if (out.length && out[out.length - 1] !== ' ') out.push(' ');
    }
    return out.join('').replace(/[-\u{F0000}-\u{10FFFF}]/gu, '').replace(/\s+/g, ' ').trim();
}

// ── The host API's things (the viewer's reflowtex.host) ─────────────────────
// Instances – what the companion package makes, and footnotes and margin
// notes – with their parts; the kinds the page defines; the marks
// (\webid, \webclass). Keys: inst:BLOCK:s3 (stream 3), w1 (widget of slot 1),
// t2 (text slot 2); kind:NAME; mark:BLOCK:N.
const instancesOf = (el: HTMLElement): Instance[] => { const h = host(), b = h && h.block && h.block(el); return b ? b.instances() : []; };
const instLocal = (inst: Instance): string => inst.id.slice(inst.id.lastIndexOf('/') + 1);
const instKey = (bid: number, inst: Instance): string => `inst:${bid}:${instLocal(inst)}`;
const definedKind = (kind: string): boolean => (I.kinds ? I.kinds() : []).some(k => k.kind === kind);
function instNote(inst: Instance): string {
    const attrs = Object.entries(inst.attrs).map(([k, v]) => `${k}=${v}`).join(', ');
    const parts = [...inst.parts.keys()].filter(r => r !== 'body');
    return [attrs && clip(attrs, 40), parts.length ? `parts ${parts.join(', ')}` : '',
            definedKind(inst.kind) ? 'drawn by the page' : 'drawn by default'].filter(Boolean).join(' · ');
}
// How many glyphs of a document carry each mark.
function markCounts(doc: Doc): Map<number, number> {
    const n = new Map<number, number>();
    const walkN = (ns: TexNode[] | undefined): void => { for (const x of ns || []) { if (x.mark) n.set(x.mark, (n.get(x.mark) || 0) + 1);
                                                     walkN(x.children); walkN(x.replace); } };
    for (const para of doc.paragraphs || []) walkN(para.nodes);
    return n;
}
const markLabel = (m: Mark): string => [m.id ? `#${m.id}` : '', ...(m.classes || '').split(/\s+/).filter(Boolean).map(c => `.${c}`)].join(' ') || '(empty)';

export function resources(): Resources {
    interface FontUse { key: string; cat: string; font: DocFont; file: string | null; family: string | null; names: Set<string | undefined>;
                        sizes: Set<number>; blocks: Set<number>; chars: Set<number>; uses: number }
    interface CiteUse { key: string; cat: string; num: number; uses: number; targets: number; blocks: Set<number> }
    const fonts = new Map<string, FontUse>(), pictures: ResourceRow[] = [], streams: ResourceRow[] = [], links: ResourceRow[] = [];
    const cites = new Map<number, CiteUse>(), anchors: ResourceRow[] = [], slots: ResourceRow[] = [];
    const instances: ResourceRow[] = [], marks: ResourceRow[] = [], kindUse = new Map<string, number>();
    const bib = citeEntries();
    I.blocks().forEach((el, bi) => {
        const st = I.state(el);
        if (!st) return;
        const doc = st.doc, c = census(doc), bid = blockId(el), where = blockLabel(bi + 1);
        for (const f of doc.fonts || []) {
            const key = 'font:' + fontKeyOf(f);
            let r = fonts.get(key);
            if (!r) fonts.set(key, r = { key, cat: 'font', font: f, file: fileOf(f), family: familyOf(st.fontInfo && st.fontInfo[f.id!]),
                                          names: new Set(), sizes: new Set(), blocks: new Set(), chars: new Set(), uses: 0 });
            r.names.add(f.name); r.sizes.add(f.size_sp); r.blocks.add(bi + 1);
            for (const [ch, u] of c.glyphs.get(f.id!) || []) { r.chars.add(ch); r.uses += u.count; }
        }
        (doc.pictures || []).forEach((p, i) => {
            const u = c.pictures.get(i + 1), b = u && u.box;
            pictures.push({ key: `pic:${bid}:${i + 1}`, cat: 'picture', label: `picture ${i + 1}`,
                note: `${where}${b ? ` · ${pt(b.width || 0)} × ${pt(b.height || 0)} + ${pt(b.depth || 0)}` : ''} · ${kb((p.svg || '').length)}`
                      + (u ? (u.count > 1 ? ` · used ${u.count}×` : '') : ' · unused') });
        });
        (doc.streams || []).forEach((s, k) => {
            const markers = c.markers.get(k + 1), parent = c.parents.get(k + 1);
            const how = markers ? (s.kind === 'footnote' ? 'popover, from its marker' : 'from a marker') : parent === 0 ? 'in the flow'
                      : parent ? `in stream ${parent} (${doc.streams[parent - 1].kind})` : 'unreferenced';
            streams.push({ key: `stream:${bid}:${k + 1}`, cat: 'stream', label: `${s.kind || 'stream'} ${k + 1}`,
                note: `${where} · ${how} · ${clip(s.text ? s.text.trim() : streamText(doc, s), 60)}` });
        });
        (doc.links || []).forEach((l, i) => {
            const u = c.links.get(i + 1);
            links.push({ key: `link:${bid}:${i + 1}`, cat: 'link', label: l.action ? `action ${l.action}` : l.url ? l.url : `ref ${l.label}`,
                note: `${where} · ${l.action ? 'a control' : l.url ? 'URL' : document.getElementById(l.label!) ? 'label on this page' : 'label elsewhere, or unresolved'}`
                      + (u ? ` · ${u.count} glyph${u.count === 1 ? '' : 's'}` : '') });
        });
        for (const [m, what] of [[c.cites, 'uses'], [c.citeTargets, 'targets']] as const) for (const [num, u] of m) {
            let r = cites.get(num);
            if (!r) cites.set(num, r = { key: `cite:${num}`, cat: 'cite', num, uses: 0, targets: 0, blocks: new Set() });
            r[what] += u.count; r.blocks.add(bi + 1);
        }
        (doc.anchors || []).forEach((a, i) => {
            const u = c.anchors.get(i + 1);
            anchors.push({ key: `anchor:${bid}:${i + 1}`, cat: 'anchor', label: a,
                note: `${where} · ${u ? (u.where === 'box' ? 'in a paragraph' : 'between paragraphs') : 'unplaced'}` });
        });
        (doc.slots || []).forEach((s, i) => {
            const u = c.slots.get(i + 1);
            slots.push({ key: `slot:${bid}:${i + 1}`, cat: 'slot', label: s.name || `slot ${i + 1}`,
                note: `${where} · ${s.kind || 'text'}` + (u ? ` · ${u.count} node${u.count === 1 ? '' : 's'}` : '') });
        });
        for (const inst of instancesOf(el)) {
            instances.push({ key: instKey(bid, inst), cat: 'inst', label: `${inst.kind || 'plain'} (${inst.placement})`,
                             note: `${where} · ${instNote(inst)}` });
            kindUse.set(inst.kind, (kindUse.get(inst.kind) || 0) + 1);
        }
        const mc = markCounts(doc);
        (doc.marks || []).forEach((m, i) => {
            const k = mc.get(i + 1) || 0;
            marks.push({ key: `mark:${bid}:${i + 1}`, cat: 'mark', label: markLabel(m),
                         note: `${where} · ${k} glyph${k === 1 ? '' : 's'}` });
        });
    });
    const range = (set: Set<number>) => blocksLabel([...set]);
    const fontName = (r: FontUse) => (r.file ? r.file.replace(/\.otf$/i, '') : [...r.names][0]) || '';
    const fontRows = [...fonts.values()].sort((a, b) => fontName(a).localeCompare(fontName(b), 'en', { numeric: true, sensitivity: 'base' })).map(r => {
        const origin = fontOrigin(r.font, r.family), pua = [...r.chars].filter(isPUA).length;
        return { key: r.key, cat: 'font', origin, label: r.file ? r.file.replace(/\.otf$/i, '') : [...r.names][0]!,
            note: (origin === 'converted' ? 'converted from Type 1 · ' : origin === 'patched' ? 'cmap patched · ' : '')
                  + `${[...r.sizes].sort((a, b) => a - b).map(pt).join(', ')} · ${r.chars.size} character${r.chars.size === 1 ? '' : 's'}`
                  + (origin && origin !== 'original' ? ` (${pua} private-use)` : '')
                  + `, ${r.uses} glyph${r.uses === 1 ? '' : 's'} · ${range(r.blocks)}` + (r.file ? '' : ' · no font file'),
            family: r.family, uses: r.uses };
    });
    return {
        // the fonts served as they are, and those the pipeline changed
        fonts: fontRows.filter(f => f.origin !== 'converted' && f.origin !== 'patched'),
        modifiedFonts: fontRows.filter(f => f.origin === 'converted' || f.origin === 'patched'),
        pictures, streams, links,
        citations: [...cites.values()].sort((a, b) => a.num - b.num).map(r => {
            const e = bib[r.num];
            return { key: r.key, cat: 'cite', label: `[${r.num}]`,
                     note: `${e && e.title ? clip(e.title as string, 50) + ' · ' : ''}${r.uses} glyph${r.uses === 1 ? '' : 's'}${r.targets ? ' · entry' : ''} · ${range(r.blocks)}` };
        }),
        anchors, slots, instances, marks,
        kinds: (I.kinds ? I.kinds() : []).map(k => ({ key: `kind:${k.kind}`, cat: 'kind', label: k.kind,
            note: `${k.inline ? 'inline: measured and drawn in pieces' : 'blocks, margin notes, popovers'} · `
                  + `${kindUse.get(k.kind) || 0} instance${kindUse.get(k.kind) === 1 ? '' : 's'} on the page` })),
    };
}

// Where a key's things are: its block (the element and id) and number.
function parseKey(key: string): ParsedKey | null {
    const i = key.indexOf(':'), cat = key.slice(0, i), rest = key.slice(i + 1);
    if (cat === 'font') return { cat, font: rest };
    if (cat === 'glyph') { const j = rest.indexOf(':'); return { cat, cp: +rest.slice(0, j), font: rest.slice(j + 1) }; }
    if (cat === 'cite') return { cat, num: +rest };
    if (cat === 'kind') return { cat, name: rest };
    const [bs, ks] = rest.split(':'), b = Number(bs), e = entries.get(b);
    // (an instance's is its id in the block: local)
    return e && e.kind === 'block' ? { cat, bid: b, el: e.el, k: Number(ks), local: ks, doc: I.state(e.el) && I.state(e.el)!.doc } : null;
}
// The node test for a key.
function matcher(key: string): ((n: TexNode, bid: number) => boolean) | null {
    const p = parseKey(key);
    if (!p) return null;
    const docOf = (bid: number) => I.state(blockOf(bid).el)!.doc;
    switch (p.cat) {
        case 'font': return (n: TexNode, bid: number) => n.type === 'glyph' && fontKeyIn(docOf(bid), n.font) === p.font;
        case 'glyph': return (n: TexNode, bid: number) => n.type === 'glyph' && n.char === p.cp && n.text === undefined && fontKeyIn(docOf(bid), n.font) === p.font;
        case 'cite': return (n: TexNode) => n.cite === p.num || n.citetarget === p.num;
        case 'pic': return (n: TexNode, bid: number) => bid === p.bid && n.type === 'picture' && n.picture === p.k;
        case 'stream': return (n: TexNode, bid: number) => bid === p.bid && n.stream === p.k;
        case 'link': return (n: TexNode, bid: number) => bid === p.bid && n.link === p.k;
        case 'anchor': return (n: TexNode, bid: number) => bid === p.bid && n.anchor === p.k;
        case 'slot': return (n: TexNode, bid: number) => bid === p.bid && n.slot === p.k;
        case 'mark': return (n: TexNode, bid: number) => bid === p.bid && n.mark === p.k;
    }
    return null;
}
// Every node on the current layout, with its segment: one replay of each
// segment, until the next paint.
let drawnMemo: { paints: number; list: { n: TexNode; sid: number; bid: number }[] } | null = null;
function drawn(): { n: TexNode; sid: number; bid: number }[] {
    if (drawnMemo && drawnMemo.paints === I.paints) return drawnMemo.list;
    const list: { n: TexNode; sid: number; bid: number }[] = [];
    for (const el of I.blocks()) {
        if (!I.state(el)) continue;
        const bid = blockId(el);
        for (const sid of segmentsOf(bid)) {
            const g = geometry(sid);
            if (g) for (const n of g.at.keys()) list.push({ n, sid, bid });
        }
    }
    drawnMemo = { paints: I.paints, list };
    return list;
}
// Where a stream stands in the flow: the segments that hold it.
function streamSegs(bid: number, k: number): number[] {
    const out: number[] = [];
    const walk = (cache: LayoutCache | null | undefined, cachePath: number[], root: string | null) => {
        if (!cache || !cache.layout) return;
        cache.layout.laid.forEach((L, i) => {
            if (L.seg.kind !== 'stream') return;
            if (L.seg.index === k) out.push(segId(bid, cachePath, i, root));
            const s = cache.dom && cache.dom.segs[i];
            if (s && s.sub) walk(s.sub, [...cachePath, i], root);
        });
    };
    walk(rootCache(bid, null), [], null);
    for (const f of rootsOf(blockOf(bid).el)) walk(rootCache(bid, f), [], f);
    return out;
}
// The ids of a resource's things on the current layout, in reading order: a
// font's glyphs, a picture's boxes, a stream's segment or marker, a link's or
// citation's glyphs.
export function uses(key: string, limit = Infinity): number[] {
    // An instance's uses are those of its stream (its segments, its marker)
    // or its slot; a kind's, those of its instances.
    const [cat, b, local] = key.split(':');
    if (cat === 'inst') return uses(local[0] === 's' ? `stream:${b}:${local.slice(1)}` : `slot:${b}:${local.slice(1)}`, limit);
    if (cat === 'kind') {
        const out: number[] = [];
        for (const el of I.blocks()) for (const inst of instancesOf(el))
            if (inst.kind === b && out.length < limit) out.push(...uses(instKey(blockId(el), inst), limit - out.length));
        return out;
    }
    const m = matcher(key);
    if (!m) return [];
    const p = parseKey(key)!, out = p.cat === 'stream' ? streamSegs(p.bid!, p.k!) : [];
    for (const d of drawn()) if (m(d.n, d.bid)) { out.push(nodeRef(d.n, d.sid)); if (out.length >= limit) break; }
    return out;
}
// A resource in full: rows of what it is, and what a panel can show of it.
export function resource(key: string): Resource | null {
    const p = parseKey(key);
    if (!p) return null;
    const rows: DetailRow[] = [], out: Resource = { key, cat: p.cat, rows };
    const doc = p.doc!, k = p.k!;
    const where = p.el ? blockLabel(I.blocks().indexOf(p.el) + 1) : null;
    const onPage = uses(key).length;
    if (p.cat === 'inst') {
        const h = host(), b = h && h.block(p.el!), inst = b && b.find(`${b.key}/${p.local}`);
        if (!inst) return null;
        out.title = `${inst.kind || 'plain'} · ${where}`;
        rows.push(['id', inst.id], ['kind', inst.kind || '(none)'], ['placement', inst.placement]);
        for (const [k, v] of Object.entries(inst.attrs)) rows.push([`${k}=`, v]);
        if (inst.presentation.classes.length) rows.push(['classes', inst.presentation.classes.join(' ')]);
        for (const [k, v] of Object.entries(inst.presentation.properties)) rows.push([k, v]);
        for (const [role, part] of inst.parts) rows.push([`part ${role}`, part.type === 'data' ? `data, ${part.data.length} characters`
            : `typeset${part.spaceBefore ? `, ${part.spaceBefore.toFixed(1)} px of TeX's space before it` : ''}`]);
        rows.push(['parent', inst.parent ? `${inst.parent.kind} (${inst.parent.id})` : 'none: the block\'s own text'],
                  ['children', inst.children.map(c => c.kind).join(', ') || 'none'],
                  ['drawn by', definedKind(inst.kind) ? 'the page (host.define)' : 'the viewer, by default']);
        if (inst.spaceBefore) rows.push(['space before', `${inst.spaceBefore.toFixed(1)} px`]);
        const shownAt = surfacesOf(p.el!).filter(sf => sf.instance === inst.id).map(sf => `${sf.role} ${WHERE[sf.where] || sf.where}`);
        if (shownAt.length) rows.push(['surfaces', shownAt.join('; ')]);
        const a = inst.anchor();
        rows.push(['anchor', a ? `(${a.x.toFixed(0)}, ${a.y.toFixed(0)}) on screen` : 'none drawn']);
        const data = [...inst.parts.values()].find(pt => pt.type === 'data');
        if (data) { out.text = data.data; out.textIsCode = true; }
        rows.push(['on the page', `${onPage} use${onPage === 1 ? '' : 's'}`]);
        return out;
    }
    if (p.cat === 'kind') {
        const def = (I.kinds ? I.kinds() : []).find(k => k.kind === p.name);
        out.title = `kind ${p.name}`;
        rows.push(['defined', def ? 'by the page (host.define)' : 'no'], ['measures', def && def.inline ? 'yes: an inline kind' : 'no']);
        const by: Record<string, number> = {};
        for (const el of I.blocks()) for (const inst of instancesOf(el)) if (inst.kind === p.name) by[inst.placement] = (by[inst.placement] || 0) + 1;
        for (const [pl, n] of Object.entries(by)) rows.push([`${pl} instances`, String(n)]);
        return out;
    }
    if (p.cat === 'mark') {
        const m = (doc.marks || [])[k - 1];
        if (!m) return null;
        const count = markCounts(doc).get(k) || 0, h = host(), handle = m.id && h && h.mark ? h.mark(m.id) : null;
        out.title = `${markLabel(m)} · ${where}`;
        rows.push(['mark', `${k} of the block's ${doc.marks.length} (Document.marks)`], ['id', m.id || '(none)'],
                  ['classes', m.classes || '(none)'], ['glyphs', String(count)]);
        if (handle) rows.push(['drawn now', `${handle.elements().length} glyph element(s) on ${handle.rects().length} line(s)`]);
        return out;
    }
    if (p.cat === 'pic') {
        const pic = (doc.pictures || [])[k - 1], u = census(doc).pictures.get(k);
        if (!pic) return null;
        out.title = `picture ${k} · ${where}`;
        out.svg = { markup: pic.svg || '', vb_w: pic.vb_w || 0, vb_h: pic.vb_h || 0 };
        rows.push(['picture', `${k} of the block's ${doc.pictures.length} (Document.pictures)`]);
        if (u) rows.push(['box', `${pt(u.box!.width || 0)} × ${pt(u.box!.height || 0)} + ${pt(u.box!.depth || 0)}`]);
        rows.push(['viewBox', `${+(+pic.vb_w).toFixed(2)} × ${+(+pic.vb_h).toFixed(2)} bp`], ['markup', `${kb((pic.svg || '').length)} of SVG`],
                  ['elements', String(((pic.svg || '').match(/<[a-zA-Z]/g) || []).length)],
                  ['in the document', u ? `${u.count} box${u.count === 1 ? '' : 'es'}` : 'unused']);
    } else if (p.cat === 'stream') {
        const s = (doc.streams || [])[k - 1];
        if (!s) return null;
        const c = census(doc), markers = c.markers.get(k), parent = c.parents.get(k);
        out.title = `${s.kind || 'stream'} ${k} · ${where}`;
        out.footnote = s.kind === 'footnote';
        out.flow = parent !== undefined;
        rows.push(['kind', s.kind || '(none)'], ['stream', `${k} of the block's ${doc.streams.length} (Document.streams)`]);
        if (markers) rows.push(['referenced by', `a marker of ${markers.count} glyph${markers.count === 1 ? '' : 's'}` + (out.footnote ? '; shown in the popover' : '')]);
        if (parent !== undefined) rows.push(['stands', parent === 0 ? 'in the block\'s flow' : `in stream ${parent} (${doc.streams[parent - 1].kind})`]);
        if (!markers && parent === undefined) rows.push(['referenced by', 'nothing']);
        for (const a of s.attrs || []) rows.push([`data-${a.key}`, a.value || '']);
        const kinds: Record<string, number> = {};
        for (const it of s.content || []) kinds[it.kind] = (kinds[it.kind] || 0) + 1;
        rows.push(['content', Object.entries(kinds).map(([k, v]) => `${v} ${k}${v === 1 ? '' : 's'}`).join(', ') || 'empty']);
        if (out.footnote) {
            const root = popoverRoot(p.bid!, k), fc = root && rootCache(p.bid!, root);
            rows.push(['popover', fc && fc.layout ? (shown(fc.dom && fc.dom.root) ? 'open' : 'laid out, not shown') : 'not open']);
            if (root) out.side = sideId(p.bid!, root);
        }
        out.text = s.text ? s.text : streamText(doc, s);
        out.textIsCode = !!s.text;
    } else if (p.cat === 'link') {
        const l = (doc.links || [])[k - 1];
        if (!l) return null;
        out.title = `link ${k} · ${where}`;
        if (l.action) rows.push(['action', l.action], ['does', 'sends a reflowtex:action event; the enclosing stream kind that knows it acts']);
        else if (l.url) rows.push(['URL', l.url]);
        else {
            const t = document.getElementById(l.label!);
            rows.push(['label', l.label!], ['resolves', t ? 'on this page' : 'through the page\'s link map, or not at all']);
        }
        const u = census(doc).links.get(k);
        rows.push(['glyphs', String(u ? u.count : 0)]);
    } else if (p.cat === 'cite') {
        const e = citeEntries()[p.num!];
        out.title = `citation [${p.num}]`;
        if (e) {
            if (e.authors) rows.push(['authors', String(e.authors)]);
            if (e.title) rows.push(['title', String(e.title)]);
            if (e.rest) rows.push(['details', String(e.rest)]);
            if (e.link && e.link.href) rows.push(['link', e.link.href]);
        } else rows.push(['entry', 'none in the page\'s #lr-citations: the popover stays inert']);
    } else if (p.cat === 'anchor') {
        const a = (doc.anchors || [])[k - 1], u = census(doc).anchors.get(k);
        out.title = `anchor ${a}`;
        rows.push(['label', a], ['placed', u ? (u.where === 'box' ? 'an empty box in a paragraph' : 'between two items of the flow') : 'nowhere'],
                  ['element', document.getElementById(a) ? `#${a} on this page` : 'none']);
    } else if (p.cat === 'slot') {
        const s = (doc.slots || [])[k - 1], u = census(doc).slots.get(k);
        out.title = `slot ${s.name || k}`;
        rows.push(['name', s.name || ''], ['kind', s.kind || 'text']);
        if (s.space) rows.push(['interword glue', `${pt(s.space)} plus ${pt(s.stretch || 0)} minus ${pt(s.shrink || 0)}`]);
        rows.push(['nodes', String(u ? u.count : 0)]);
    } else if (p.cat === 'font') {
        out.title = p.font;
    }
    if (where) rows.push(['block', where]);
    rows.push(['on the page now', `${onPage} drawn`]);
    return out;
}
// Open a footnote's popover, as its marker does when clicked: 'ok', or
// 'wait' while the marker is off screen (scrolled to, it is painted soon).
export function openPopover(key: string): 'ok' | 'wait' | 'none' {
    const p = parseKey(key);
    if (!p || p.cat !== 'stream') return 'none';
    const root = popoverRoot(p.bid!, p.k!), fc = root && rootCache(p.bid!, root);
    if (fc && fc.dom && shown(fc.dom.root)) return 'ok';
    const id = uses(key).find(i => entries.get(i)!.kind === 'node');
    if (id == null) return 'none';
    const e = nodeOf(id), { cache } = segParts(e.seg!), el = cache!.dom && cache!.dom.byNode.get(e.n);
    const r = screenRectOf(id);
    if (!el || !el.isConnected || !r || r.top < 0 || r.top + r.height > viewBottom()) { scrollIntoViewIfNeeded(id); return 'wait'; }
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: r.left, clientY: r.top }));
    return 'ok';
}
