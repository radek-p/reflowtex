// SPDX-License-Identifier: AGPL-3.0-or-later
// Reflow TeX inspector – the page-side half (see README.md).
//
// Runs in the inspected page, where it installs window.__rtxInspector: the
// floating panel (inspector.js) loads it as a script, and any other tool – a
// browser devtools panel, a test – may evaluate it there. Everything a panel
// shows comes from here as plain JSON; everything drawn on the page (the
// overlay) is drawn from here. It reads the viewer through window.reflowtex.inspect – the viewer's
// own geometry, replayed without touching the DOM – and never changes what
// the viewer drew.
//
// The file's value, when evaluated as a script, is the result of installing: 'ok', or 'no-api' when the page has no inspectable viewer yet.
// window.__rtxInspectorInstall() tries again.
window.__rtxInspectorInstall = () => {
const AGENT = 2;
const prev = window.__rtxInspector;
if (prev && prev.agent === AGENT) return 'ok';
const I = window.reflowtex && window.reflowtex.inspect;
// No viewer yet (or one that predates the inspection API): install nothing,
// so the panel can try again later.
if (!I) return 'no-api';
// Another copy (an older version, another tool's) gives way: its outlines go.
if (prev) try { prev.cancelPick(); prev.clear(); } catch { /* not ours to fix */ }

// ── Ids ────────────────────────────────────────────────────────────────────────
// The panel refers to everything by number. Blocks and nodes are keyed by
// object identity (node objects live as long as the block). Segments and
// lines are keyed by position – "block 1, segment 3, line 2" – and resolved
// afresh on every use, because a reflow makes new line objects but the
// panel's expanded rows should survive it.
let nextId = 1;
const byObj = new WeakMap(), byKey = new Map(), entries = new Map();
function register(obj, key, make) {
    let id = obj ? byObj.get(obj) : byKey.get(key);
    if (id === undefined) {
        id = nextId++;
        if (obj) byObj.set(obj, id); else byKey.set(key, id);
        entries.set(id, make());
    }
    return id;
}
const blockId = el => register(el, null, () => ({ kind: 'block', el }));
// A segment: `cachePath` is [] for the block's own cache, [k, …] for the
// nested cache of stream segment k (and so on down).
const segId = (bid, cachePath, i) => register(null, `s${bid}/${cachePath.join('.')}/${i}`,
    () => ({ kind: 'seg', block: bid, cachePath, i }));
const lineId = (sid, j) => register(null, `l${sid}/${j}`, () => ({ kind: 'line', seg: sid, j }));
function nodeId(n, sid, parent) {
    const id = register(n, null, () => ({ kind: 'node', n }));
    const e = entries.get(id);
    if (sid !== undefined) { e.seg = sid; e.parent = parent; }
    return id;
}

// ── Resolving ──────────────────────────────────────────────────────────────────
function cacheOf(seg) {
    const b = entries.get(seg.block);
    let cache = I.state(b.el).cache;
    for (const k of seg.cachePath) cache = cache && cache.dom && cache.dom.segs[k] && cache.dom.segs[k].sub;
    return cache;
}
function segParts(sid) {
    const seg = entries.get(sid), cache = cacheOf(seg);
    const el = entries.get(seg.block).el;
    const laid = cache && cache.layout && cache.layout.laid[seg.i];
    const s = cache && cache.dom && cache.dom.segs[seg.i];
    return { seg, cache, el, laid, s };
}

// ── Geometry ───────────────────────────────────────────────────────────────────
// One replay of a segment gives every node's pen position and advance; the
// box extents come from the nodes themselves. Memoised until the next paint.
const geomMemo = new Map();
function geometry(sid) {
    const { seg, cache, el, laid, s } = segParts(sid);
    if (!laid || !s || !s.svg) return null;
    const memo = geomMemo.get(sid);
    if (memo && memo.paints === I.paints && memo.laid === laid) return memo;
    const at = new Map(), parent = new Map(), lines = [];
    const link = (list, p) => {
        for (const c of list || []) {
            parent.set(c, p);
            link(c.children, c); link(c.replace, c);
            if (c.leader) parent.set(c.leader, c);
        }
    };
    const ok = I.replay(el, seg.i, {
        line(j, line, x0, y) { lines.push({ line, j, x0, y }); link(line.nodes, line); },
        node(n, x, y, w) { at.set(n, { x, y, w }); },
        vnode(n, x, top, h) { at.set(n, { x, top, h, vertical: true }); },
    }, cache);
    if (!ok) return null;
    const g = { paints: I.paints, laid, svg: s.svg, at, parent, lines, metrics: cache.metrics || [] };
    for (const L of lines) {                      // a line's extent: its nodes'
        let h = 0, d = 0, x1 = L.x0;
        for (const n of L.line.nodes) {
            const e = extentOf(g, n);
            if (e) { h = Math.max(h, e.h); d = Math.max(d, e.d); }
            const p = at.get(n);
            if (p && !p.vertical) x1 = Math.max(x1, p.x + p.w);
        }
        Object.assign(L, { h, d, x1 });
    }
    geomMemo.set(sid, g);
    return g;
}

const SP = () => I.spToPx;
const RUNNING = -1073741824;
// Height and depth (svg units, above/below the pen's baseline) of a node that
// has its own; null for glue, kerns and the like, which take their parent's.
function extentOf(g, n) {
    const k = SP();
    switch (n.type) {
        case 'glyph': {
            const m = n.metrics ? g.metrics[n.metrics - 1] || {} : n;
            return { h: (m.height || 0) * k, d: (m.depth || 0) * k };
        }
        case 'hlist': case 'vlist': {
            const sh = n.shift || 0;                  // down, in an hlist
            return { h: ((n.height || 0) - sh) * k, d: ((n.depth || 0) + sh) * k };
        }
        case 'rule':
            if (n.height === RUNNING || n.depth === RUNNING) return null;
            return { h: (n.height || 0) * k, d: (n.depth || 0) * k };
        case 'picture': case 'widget':
            return { h: (n.height || 0) * k, d: (n.depth || 0) * k };
    }
    return null;
}
// A node's rectangle in svg units, or null if it was not drawn on this layout.
function rectOf(g, n) {
    const p = g.at.get(n);
    if (!p) {
        const L = g.lines.find(L => L.line === n);
        return L ? { x: L.x0, y: L.y - L.h, w: L.x1 - L.x0, h: L.h + L.d, base: L.y } : null;
    }
    const k = SP(), par = g.parent.get(n);
    if (p.vertical) {
        let w = (n.type === 'hlist' || n.type === 'vlist' || (n.type === 'rule' && n.width !== RUNNING))
            ? (n.width || 0) * k : (par && par.width || 0) * k;
        return { x: p.x + (n.shift || 0) * k, y: p.top, w, h: p.h, base: n.type === 'hlist' ? p.top + (n.height || 0) * k : null };
    }
    let e = extentOf(g, n);
    if (!e) {                                      // take the enclosing box's
        if (par && par.nodes) { const L = g.lines.find(L => L.line === par); e = L ? { h: L.h, d: L.d } : { h: 0, d: 0 }; }
        else if (par) {
            const pp = g.at.get(par);
            if (pp && pp.vertical) { const pr = rectOf(g, par); e = { h: pr.base - pr.y, d: pr.y + pr.h - pr.base }; }
            else e = { h: (par.height || 0) * k, d: (par.depth || 0) * k };
        } else e = { h: 0, d: 0 };
    }
    return { x: p.x, y: p.y - e.h, w: p.w, h: e.h + e.d, base: p.y };
}
// svg units → viewport pixels
function toScreen(svg, r) {
    const m = svg.getScreenCTM();
    if (!m) return null;
    const x1 = m.a * r.x + m.c * r.y + m.e, y1 = m.b * r.x + m.d * r.y + m.f;
    const x2 = m.a * (r.x + r.w) + m.c * (r.y + r.h) + m.e, y2 = m.b * (r.x + r.w) + m.d * (r.y + r.h) + m.f;
    const out = { left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
    if (r.base != null) out.base = m.b * r.x + m.d * r.base + m.f;
    return out;
}
function screenRectOf(id) {
    const e = entries.get(id);
    if (!e) return null;
    if (e.kind === 'vgap' || e.kind === 'vpar') { const g = gapInfo(id); return g && g.band; }
    if (e.kind === 'vpart') return partRect(id);
    if (e.kind === 'block') { const r = e.el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; }
    if (e.kind === 'seg') {
        const { s } = segParts(id);
        const box = s && (s.svg || s.box);
        if (!box) return null;
        const r = box.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height };
    }
    if (e.kind === 'line') {
        const g = geometry(e.seg); const L = g && g.lines[e.j];
        return L ? toScreen(g.svg, { x: L.x0, y: L.y - L.h, w: L.x1 - L.x0, h: L.h + L.d, base: L.y }) : null;
    }
    const g = e.seg && geometry(e.seg);
    const r = g && rectOf(g, e.n);
    return r ? toScreen(g.svg, r) : null;
}

// ── Describing ─────────────────────────────────────────────────────────────────
// A line's badness as TeX rates it: 100·r³ of its glue ratio r (capped at
// 10000), 0 on a line set with infinite glue (the last of a paragraph); an
// overfull line, shrunk past its shrink, is flagged. And TeX's fitness class.
function badnessOf(lrp) {
    if (!lrp || lrp.fillOrder) return { b: 0, fit: 'decent' };
    const r = lrp.ratio || 0;
    if (r < -1) return { b: 10000, fit: 'overfull', overfull: true };
    const b = Math.min(10000, Math.round(100 * Math.abs(r) ** 3));
    return { b, fit: b <= 12 ? 'decent' : r > 0 ? (b >= 100 ? 'very loose' : 'loose') : 'tight' };
}
const pt = sp => (sp / 65536).toFixed(2).replace(/\.?0+$/, '') + 'pt';
const ORDER = ['', 'fil', 'fill', 'filll'];
const GLUE_SUB = { 0: '', 1: 'lineskip', 2: 'baselineskip', 3: 'parskip', 4: 'abovedisplayskip',
    5: 'belowdisplayskip', 6: 'abovedisplayshortskip', 7: 'belowdisplayshortskip', 8: 'leftskip',
    9: 'rightskip', 10: 'topskip', 11: 'splittopskip', 12: 'tabskip', 13: 'spaceskip', 14: 'xspaceskip',
    15: 'parfillskip', 16: 'mathskip', 17: 'thinmuskip', 18: 'medmuskip', 19: 'thickmuskip',
    98: 'conditionalmathskip', 99: 'muglue', 100: 'leaders', 101: 'cleaders', 102: 'xleaders', 103: 'gleaders' };
const KERN_SUB = { 0: 'font', 1: 'user', 2: 'accent', 3: 'italic correction' };
const glueSpec = n => pt(n.width || 0)
    + (n.stretch ? ` plus ${n.stretch_order ? (n.stretch / 65536).toFixed(2) + ORDER[n.stretch_order] : pt(n.stretch)}` : '')
    + (n.shrink ? ` minus ${n.shrink_order ? (n.shrink / 65536).toFixed(2) + ORDER[n.shrink_order] : pt(n.shrink)}` : '');
function setWidth(e) {
    const g = e.seg && geometry(e.seg), p = g && g.at.get(e.n);
    if (!p) return null;
    return (p.vertical ? p.h : p.w) / SP();
}
function childLists(n) {
    if (n.type === 'disc' || n.type === 'wdisc') return n.replace || [];
    if (n.children && n.children.length) return n.children;
    if (n.leader) return [n.leader];
    return [];
}
function summary(id) {
    const e = entries.get(id);
    const out = { id, kind: e.kind, hasChildren: false, label: '', note: '' };
    if (e.kind === 'vgap' || e.kind === 'vpar') { gapSummary(id, out); return out; }
    if (e.kind === 'vpart') { partSummary(id, out); return out; }
    if (e.kind === 'block') {
        const st = I.state(e.el);
        out.type = 'block';
        out.label = `block ${I.blocks().indexOf(e.el) + 1}` + (e.el.id ? ` #${e.el.id}` : '');
        // (private-use code points – unencoded math glyphs – would show as boxes)
        const text = (e.el.textContent || '').replace(/[\uE000-\uF8FF\u{F0000}-\u{10FFFF}]/gu, '').replace(/\s+/g, ' ').trim();
        out.note = `${Math.round(st.lastWidth)}pt wide` + (text ? ` · “${text.slice(0, 40)}${text.length > 40 ? '…' : ''}”` : '');
        out.hasChildren = true;
    } else if (e.kind === 'seg') {
        const { laid, s } = segParts(id);
        const kind = laid && laid.seg ? laid.seg.kind : '?';
        out.type = kind === 'stream' ? 'stream' : kind === 'display' ? 'display' : 'text';
        out.label = kind === 'stream' ? `stream (${laid.seg.stream.kind || 'plain'})`
                  : kind === 'display' ? (laid.seg.isAlign ? 'display (align)' : 'display')
                  : laid && laid.seg && laid.seg.isFigure ? 'figure' : 'text';
        if (kind === 'stream') { out.hasChildren = !!(s && s.sub && s.sub.layout); }
        else if (!laid || laid.deferred) out.note = 'not laid out yet – scroll to it';
        else { out.note = `${laid.lines.length} line(s)`; out.hasChildren = laid.lines.length > 0; }
    } else if (e.kind === 'line') {
        const g = geometry(e.seg), L = g && g.lines[e.j];
        out.type = 'line';
        out.label = `line ${e.j + 1}`;
        if (L) {
            const { laid } = segParts(e.seg), lrp = laid.lrp[e.j];
            const r = lrp.fillOrder ? lrp.fillRatio : lrp.ratio;
            const bad = badnessOf(lrp);
            out.note = `${L.line.nodes.length} nodes · glue ${r >= 0 ? '+' : ''}${(+r).toFixed(3)}${lrp.fillOrder ? ' ' + ORDER[lrp.fillOrder] : ''}` + (lrp.er ? ` · expansion ${(lrp.er * 100).toFixed(1)}%` : '')
                + (laid.seg.kind === 'display' ? '' : ` · badness ${bad.overfull ? 'overfull' : bad.b}`);
            out.hasChildren = L.line.nodes.length > 0;
        }
    } else {
        const n = e.n, sw = setWidth(e);
        out.type = n.type;
        out.hasChildren = childLists(n).length > 0;
        switch (n.type) {
            case 'glyph': {
                // A private-use code point (an unencoded math glyph) draws as
                // nothing in the panel's font: show the number instead.
                const pua = n.text === undefined && ((n.char >= 0xE000 && n.char <= 0xF8FF) || n.char >= 0xF0000);
                const ch = n.text !== undefined ? n.text
                         : pua ? 'U+' + n.char.toString(16).toUpperCase() : String.fromCodePoint(n.char || 32);
                const m = n.metrics ? (I.state(entries.get(entries.get(e.seg).block).el).cache.metrics || [])[n.metrics - 1] : n;
                out.label = `‘${ch}’`;
                out.note = `font ${n.font} · ${pt(m && m.width || 0)}`;
                break;
            }
            case 'glue':
                out.label = 'glue' + (GLUE_SUB[n.subtype] ? ` \\${GLUE_SUB[n.subtype]}` : '');
                out.note = glueSpec(n) + (sw != null && Math.abs(sw - (n.width || 0)) > 1 ? ` → ${pt(sw)}` : '');
                break;
            case 'kern': out.label = `kern${KERN_SUB[n.subtype] ? ' (' + KERN_SUB[n.subtype] + ')' : ''}`; out.note = pt(n.kern || 0); break;
            case 'penalty': out.label = 'penalty'; out.note = String(n.penalty ?? 0); break;
            case 'math': out.label = 'math'; out.note = n.surround ? 'surround ' + pt(n.surround) : ''; break;
            case 'disc': case 'wdisc': out.label = n.type === 'wdisc' ? 'discretionary (widget)' : 'discretionary';
                out.note = `pre ${(n.pre || []).length} · post ${(n.post || []).length} · replace ${(n.replace || []).length}`;
                // A plain hyphenation point – nothing shown unbroken – which a
                // panel may set among the letters around it.
                out.point = !(n.replace || []).length;
                break;
            case 'hlist': case 'vlist': {
                out.label = n.type === 'hlist' ? 'hbox' : 'vbox';
                const sign = n.glue_sign === 1 ? '+' : n.glue_sign === 2 ? '−' : '';
                out.note = `${pt(n.width || 0)} × ${pt(n.height || 0)} + ${pt(n.depth || 0)}`
                    + (n.shift ? ` · shift ${pt(n.shift)}` : '')
                    + (sign && n.glue_set ? ` · glue ${sign}${(+n.glue_set).toFixed(3)}${ORDER[n.glue_order || 0]}` : '')
                    + (n.anchor ? ' · anchor' : '');
                break;
            }
            case 'rule': out.label = 'rule';
                out.note = [n.width, n.height, n.depth].map(v => v === RUNNING ? '*' : pt(v || 0)).join(' × '); break;
            case 'picture': out.label = 'picture'; out.note = `${pt(n.width || 0)} × ${pt(n.height || 0)} + ${pt(n.depth || 0)}`; break;
            case 'widget': out.label = 'widget'; out.note = n.ctx ? n.ctx.name : ''; break;
            case 'transform': out.label = 'transform'; out.note = `[${[n.m_a ?? 1, n.m_b ?? 0, n.m_c ?? 0, n.m_d ?? 1].map(v => +(+v).toFixed(3)).join(' ')}]`; break;
            default: out.label = n.type || 'node';
        }
        out.drawn = sw != null;
    }
    return out;
}

// The panel's detail view: every scalar field, dimensions also in pt.
const DIM = new Set(['width', 'height', 'depth', 'stretch', 'shrink', 'kern', 'shift', 'surround']);
function details(id) {
    const e = entries.get(id);
    if (!e) return null;
    const sum = summary(id), rows = [];
    if (e.kind === 'vgap' || e.kind === 'vpar' || e.kind === 'vpart') {
        gapDetails(id, rows);
    } else if (e.kind === 'node') {
        for (const [k, v] of Object.entries(e.n)) {
            if (k.startsWith('_') || v === undefined || typeof v === 'object' || typeof v === 'function') continue;
            rows.push([k, DIM.has(k) && typeof v === 'number' && v !== RUNNING ? `${v} sp (${pt(v)})` : String(v)]);
        }
        if (e.n.metrics) {
            const m = (I.state(entries.get(entries.get(e.seg).block).el).cache.metrics || [])[e.n.metrics - 1];
            if (m) rows.push(['metrics → w×h+d', `${pt(m.width || 0)} × ${pt(m.height || 0)} + ${pt(m.depth || 0)}`]);
        }
        const sw = setWidth(e);
        if (sw != null) rows.push([e.n.type === 'glue' || e.n.type === 'kern' ? 'set to' : 'advance', pt(sw)]);
        else rows.push(['drawn', 'no (not on the current layout)']);
    } else if (e.kind === 'line') {
        const { laid } = segParts(e.seg), lrp = laid && laid.lrp[e.j];
        if (lrp) {
            const bad = badnessOf(lrp);
            rows.push(['badness', bad.overfull ? 'overfull' : String(bad.b)], ['fitness', bad.fit]);
            for (const [k, v] of Object.entries(lrp)) rows.push([k, typeof v === 'number' ? String(+v.toFixed(5)) : String(v)]);
        }
    } else if (e.kind === 'block') {
        const st = I.state(e.el);
        rows.push(['width', `${st.lastWidth.toFixed(1)}pt`], ['align', String(st.lastAlign)],
                  ['paragraphs', String(st.doc.paragraphs.length)], ['fonts', String(st.doc.fonts.length)]);
    }
    const r = screenRectOf(id);
    if (r) rows.push(['on screen', `${r.width.toFixed(1)} × ${r.height.toFixed(1)} px at (${r.left.toFixed(0)}, ${r.top.toFixed(0)})`]);
    return { summary: sum, rows };
}

function children(id) {
    const e = entries.get(id);
    if (!e) return [];
    if (e.kind === 'block') return segmentRows(id, [], I.state(e.el).cache);
    if (e.kind === 'vgap' || e.kind === 'vpar') {
        const g = gapInfo(id);
        return g ? g.parts.map((_, k) => summary(partId(id, k))) : [];
    }
    if (e.kind === 'vpart') return [];
    if (e.kind === 'seg') {
        const { laid, s } = segParts(id);
        if (laid && laid.seg && laid.seg.kind === 'stream') {
            const sub = s && s.sub;
            return sub && sub.layout ? segmentRows(e.block, [...e.cachePath, e.i], sub) : [];
        }
        if (!laid || !laid.lines) return [];
        // the lines, with the vertical space between two paragraphs before
        // the first line of the second
        const starts = new Set((laid.itemStarts || []).slice(1));
        const out = [];
        laid.lines.forEach((_, j) => {
            if (starts.has(j)) out.push(summary(parGapId(id, laid.itemStarts.indexOf(j))));
            out.push(summary(lineId(id, j)));
        });
        return out;
    }
    if (e.kind === 'line') {
        const g = geometry(e.seg), L = g && g.lines[e.j];
        return L ? L.line.nodes.map(n => summary(nodeId(n, e.seg, id))) : [];
    }
    return childLists(e.n).map(n => summary(nodeId(n, e.seg, id)));
}

// From a node to the chain of ids the panel expands to show it.
function pathOf(n, sid) {
    const g = geometry(sid), chain = [];
    let cur = n;
    while (cur && !cur.nodes) { chain.unshift(cur); cur = g.parent.get(cur); }
    const L = cur && g.lines.find(L => L.line === cur);
    if (!L) return null;
    const lid = lineId(sid, L.j), ids = [lid];
    let parent = lid;
    for (const c of chain) { parent = nodeId(c, sid, parent); ids.push(parent); }
    const seg = entries.get(sid), segs = [];
    for (let k = 0; k <= seg.cachePath.length; k++)
        segs.push(k < seg.cachePath.length ? segId(seg.block, seg.cachePath.slice(0, k), seg.cachePath[k]) : sid);
    return [seg.block, ...segs, ...ids];
}

// Every segment of a block (streams' nested ones included) that has an svg.
function* segmentsOf(bid) {
    const el = entries.get(bid).el;
    function* walk(cache, cachePath) {
        if (!cache || !cache.dom) return;
        for (let i = 0; i < cache.dom.segs.length; i++) {
            const s = cache.dom.segs[i];
            if (s.sub) yield* walk(s.sub, [...cachePath, i]);
            else if (s.svg) yield segId(bid, cachePath, i);
        }
    }
    yield* walk(I.state(el).cache, []);
}


// ── Vertical space ─────────────────────────────────────────────────────────────
// What TeX put between two paragraphs, or around a heading or a display: the
// glue on its vertical list, shown as TeX's own items. A vertical space row
// holds the glue the document recorded (the vspace item's `glue`: an
// author's or a heading's skip, \parskip, a display skip) and the interline
// glue, \baselineskip or \lineskip, as it comes out for these lines at this
// width. On the page each is a band, stacked in that order.
//
// Two places hold one: before a segment (between blocks of text, displays,
// streams), and between two paragraphs within a run of text.
const gapId = (bid, cachePath, i) => register(null, `g${bid}/${cachePath.join('.')}/${i}`,
    () => ({ kind: 'vgap', block: bid, cachePath, i }));
const parGapId = (sid, k) => register(null, `p${sid}/${k}`, () => ({ kind: 'vpar', seg: sid, k }));
const partId = (gid, k) => register(null, `v${gid}/${k}`, () => ({ kind: 'vpart', gap: gid, k }));

const maxOf = (items, f) => (items || []).reduce((m, it) => Math.max(m, it[f]), 0);
// The interline glue between a depth above and a height below, and TeX's name
// for it: \baselineskip unless that would leave less than \lineskiplimit.
function interline(prevDepth, ascent, lm, px) {
    if (!lm) return { width: px / SP(), subtype: 2 };
    const b = lm.bskip - prevDepth - ascent;
    return { width: px / SP(), subtype: b >= lm.lskiplimit ? 2 : 1,
             rule: { baselineskip: lm.bskip / SP(), lineskip: lm.lskip / SP(), lineskiplimit: lm.lskiplimit / SP(),
                     depthAbove: prevDepth / SP(), heightBelow: ascent / SP() } };
}
// The parts of a gap, in TeX's order, each { n: a glue- or kern-like node,
// interline?: its rule }, and the gap's total and band (viewport px).
function gapInfo(id) {
    const e = entries.get(id);
    if (!e) return null;
    if (e.kind === 'vgap') {
        const b = entries.get(e.block);
        let cache = I.state(b.el).cache;
        for (const k of e.cachePath) cache = cache && cache.dom && cache.dom.segs[k] && cache.dom.segs[k].sub;
        const L = cache && cache.layout && cache.layout.laid[e.i], s = cache && cache.dom && cache.dom.segs[e.i];
        if (!L || !s || !s.gap) return null;
        const totalSp = (parseFloat(s.gap.style.height) || 0) / SP();
        const vs = L.seg.vspace;
        const parts = [];
        for (const g of (vs && vs.glue) || []) {
            if (g.type === 'glue' && (g.subtype === 1 || g.subtype === 2)) continue;   // redone below
            let n = g;
            // A display's above skip: the full or the short one, as chosen at this width.
            if (g.type === 'glue' && (g.subtype === 4 || g.subtype === 6) && L.seg.kind === 'display' && L.displayFull != null) {
                const it = L.seg.rows[0].item;
                n = { ...g, subtype: L.displayFull ? 4 : 6, width: L.displayFull ? it.display_above : it.display_above_short };
            }
            parts.push({ n });
        }
        const sum = parts.reduce((a, p) => a + (p.n.type === 'kern' ? p.n.kern || 0 : p.n.width || 0), 0);
        const rest = totalSp - sum;
        if (Math.abs(rest) > 655) {                       // more than 0.01pt left: the interline glue
            const prev = e.i > 0 && cache.layout.laid[e.i - 1];
            const il = interline(prev ? prev.lastDepth || 0 : 0, L.firstAscent || 0, L.firstMeta, rest * SP());
            parts.push({ n: { type: 'glue', subtype: il.subtype, width: rest }, interline: il.rule || {} });
        }
        const r = s.gap.getBoundingClientRect();
        return { totalSp, amount: vs ? vs.amount || 0 : null, parts,
                 band: { left: r.left, top: r.top, width: r.width, height: r.height } };
    }
    if (e.kind === 'vpar') {
        const { laid, s } = segParts(e.seg);
        if (!laid || !laid.itemStarts || !laid.profiles || !s || !s.svg) return null;
        const j = laid.itemStarts[e.k];
        if (!(j > 0) || j >= laid.lines.length) return null;
        const prevD = maxOf(laid.profiles[j - 1], 'd'), asc = maxOf(laid.profiles[j], 'h');
        const px = laid.baselineYs[j] - laid.baselineYs[j - 1] - prevD - asc;
        const vs = laid.seg.items[e.k] && laid.seg.items[e.k].vspace;
        const parts = ((vs && vs.glue) || []).map(n => ({ n }));
        const il = interline(prevD, asc, laid.meta && laid.meta[j], px);
        parts.push({ n: { type: 'glue', subtype: il.subtype, width: il.width }, interline: il.rule || {} });
        const top = laid.baselineYs[j - 1] + prevD;
        const band = toScreen(s.svg, { x: 0, y: top, w: s.svg.viewBox.baseVal.width || s.svg.getBoundingClientRect().width, h: px });
        return { totalSp: px / SP(), amount: vs ? vs.amount || 0 : null, parts, band };
    }
    return null;
}
// A part's band: its share of the gap's, in order from the top.
function partRect(id) {
    const e = entries.get(id), g = e && gapInfo(e.gap);
    if (!g || !g.band) return null;
    const scale = g.totalSp ? g.band.height / g.totalSp : 0;
    let y = g.band.top;
    for (let k = 0; k < g.parts.length; k++) {
        const n = g.parts[k].n, h = (n.type === 'kern' ? n.kern || 0 : n.width || 0) * scale;
        if (k === e.k) return { left: g.band.left, top: Math.min(y, y + h), width: g.band.width, height: Math.abs(h) };
        y += h;
    }
    return null;
}
// Where a gap is listed: before segment i (if there is space, or TeX's glue).
function gapBefore(bid, cachePath, cache, i) {
    const L = cache.layout.laid[i], s = cache.dom && cache.dom.segs[i];
    const px = s && s.gap ? parseFloat(s.gap.style.height) || 0 : 0;
    return (L && L.seg.vspace) || px > 0.05 ? gapId(bid, cachePath, i) : null;
}
function segmentRows(bid, cachePath, cache) {
    const out = [];
    (cache.layout ? cache.layout.laid : []).forEach((_, i) => {
        const g = gapBefore(bid, cachePath, cache, i);
        if (g) out.push(summary(g));
        out.push(summary(segId(bid, cachePath, i)));
    });
    return out;
}
const GAP_NAME = n => n.type === 'kern' ? 'kern' : n.subtype ? '\\' + GLUE_SUB[n.subtype] : 'skip';
function gapSummary(id, out) {
    const g = gapInfo(id);
    out.type = 'vspace';
    out.label = 'vertical space';
    if (!g) { out.note = 'not laid out yet'; return; }
    out.note = `${pt(g.totalSp)} · ${g.parts.map(p => GAP_NAME(p.n)).join(' + ') || 'glue'}`;
    out.hasChildren = g.parts.length > 0;
    out.drawn = true;
}
function partSummary(id, out) {
    const e = entries.get(id), g = gapInfo(e.gap), p = g && g.parts[e.k];
    if (!p) { out.type = 'glue'; out.label = 'glue'; out.note = 'gone'; return; }
    const n = p.n;
    out.type = n.type;
    out.drawn = true;
    if (n.type === 'kern') { out.label = 'kern'; out.note = pt(n.kern || 0); return; }
    out.label = 'glue ' + (n.subtype ? '\\' + GLUE_SUB[n.subtype] : '(skip)');
    out.note = p.interline ? `→ ${pt(n.width || 0)}` : glueSpec(n);
}
function gapDetails(id, rows) {
    const e = entries.get(id);
    if (e.kind === 'vpart') {
        const g = gapInfo(e.gap), p = g && g.parts[e.k];
        if (!p) return;
        const n = p.n;
        if (n.type === 'kern') rows.push(['kern', pt(n.kern || 0)]);
        else if (p.interline) {
            const r = p.interline;
            rows.push(['set to', pt(n.width || 0)]);
            if (r.baselineskip != null) rows.push(['\\baselineskip', pt(r.baselineskip)], ['depth above', pt(r.depthAbove)],
                ['height below', pt(r.heightBelow)], ['\\lineskiplimit', pt(r.lineskiplimit)], ['\\lineskip', pt(r.lineskip)]);
            rows.push(['rule', n.subtype === 2 ? '\\baselineskip − depth above − height below'
                                                : 'that would leave less than \\lineskiplimit: \\lineskip instead']);
        } else {
            rows.push(['glue', glueSpec(n)], ['kind', n.subtype ? '\\' + GLUE_SUB[n.subtype]
                : 'an explicit skip: \\vspace, \\vskip, \\addvspace, a heading\'s before or after skip']);
        }
        return;
    }
    const g = gapInfo(id);
    if (!g) return;
    rows.push(['total', pt(g.totalSp)]);
    if (g.amount != null) rows.push(['recorded by TeX', pt(g.amount)]);
}

// ── Overlay ────────────────────────────────────────────────────────────────────
const COLORS = {
    box: ['rgba(111,168,220,.30)', '#4a90d9'], glyph: ['rgba(111,168,220,.25)', '#4a90d9'],
    glue: ['rgba(147,196,125,.55)', '#5c9e3f'], kern: ['rgba(190,140,230,.55)', '#8e44ad'],
    math: ['rgba(246,178,107,.5)', '#d9822b'], penalty: ['rgba(224,102,102,.8)', '#c0392b'],
    line: ['rgba(255,229,153,.25)', '#c9a227'], other: ['rgba(160,160,160,.3)', '#888'],
};
const colorOf = t => COLORS[t === 'hlist' || t === 'vlist' || t === 'block' || t === 'text' || t === 'display' || t === 'stream' || t === 'picture' || t === 'widget' || t === 'rule' ? 'box'
    : t === 'glyph' ? 'glyph' : t === 'glue' || t === 'vspace' ? 'glue' : t === 'kern' ? 'kern' : t === 'math' ? 'math'
    : t === 'penalty' ? 'penalty' : t === 'line' ? 'line' : 'other'];

let layer = null, hovered = null, selected = null, picking = false, picked = null, pickHover = null;
function ensureLayer() {
    if (layer && layer.isConnected) return layer;
    layer = document.createElement('div');
    layer.setAttribute('data-rtx-inspector', '');
    // Anchored in the document at the scroll position it was drawn at (see
    // redraw), so the browser scrolls it with the text: a fixed layer redrawn
    // on scroll would trail the text by a frame.
    layer.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:2147483646';
    // Beneath a floating inspector panel, should it share our z-index (one
    // docked inside the page is not a child of <html>, and needs no care).
    const ui = [...document.documentElement.children].find(e => e.hasAttribute('data-rtx-ui'));
    document.documentElement.insertBefore(layer, ui || null);
    return layer;
}
function drawRect(r, type, { strong = false, label = null, children = false, below = false, outline = false } = {}) {
    if (!r) return;
    const [fill, stroke] = colorOf(type);
    const d = document.createElement('div');
    const w = Math.max(r.width, type === 'penalty' || r.width === 0 ? 2 : r.width);
    d.style.cssText = `position:absolute;box-sizing:border-box;left:${r.left - (r.width === 0 ? 1 : 0)}px;top:${r.top}px;width:${w}px;height:${Math.max(r.height, 1)}px;`
        + (children ? `outline:1px solid ${stroke};background:${fill.replace(/[\d.]+\)$/, '0.18)')}`
                    : `background:${outline ? 'transparent' : fill};outline:${strong ? 2 : 1}px solid ${stroke}`)
        + ((type === 'glue' || type === 'vspace') && !children ? ';background-image:repeating-linear-gradient(135deg,transparent 0 3px,rgba(255,255,255,.35) 3px 5px)' : '');
    layer.appendChild(d);
    if (r.base != null && !children && (type === 'box' || type === 'hlist' || type === 'vlist' || type === 'line' || type === 'glyph')) {
        const b = document.createElement('div');
        b.style.cssText = `position:absolute;left:${r.left}px;top:${r.base}px;width:${r.width}px;border-top:1px dashed ${stroke}`;
        layer.appendChild(b);
    }
    if (label) {
        const t = document.createElement('div');
        t.textContent = label;
        const above = !below && r.top > 24;
        t.style.cssText = `position:absolute;left:${Math.max(2, r.left)}px;top:${above ? r.top - 22 : r.top + r.height + 3}px;`
            + 'font:11px/1.5 ui-monospace,Menlo,monospace;background:#1f2430;color:#fff;padding:1px 6px;border-radius:3px;white-space:nowrap;max-width:60vw;overflow:hidden;text-overflow:ellipsis';
        layer.appendChild(t);
    }
}
function drawId(id, strong, below = false) {
    const s = summary(id);
    const r = screenRectOf(id);
    if (!r) return;
    // A selected box or line also shows what it is made of, one level down.
    if (strong && s.hasChildren && s.kind !== 'block' && s.type !== 'stream') {
        const kids = children(id);
        if (kids.length <= 400) for (const k of kids) drawRect(screenRectOf(k.id), k.type, { children: true });
    }
    if (r.base != null) drawBaseline(r, strong);
    // A block or segment is outlined only: filled, it would wash out what it holds.
    drawRect(r, s.type, { strong, below, outline: s.kind === 'block' || s.kind === 'seg', label: `${s.label}  ${s.note}`.trim() });
}
// A guide along the node's baseline, across the whole viewport: what else
// sits on it – the neighbouring words, a formula's axis, the next column –
// is then plain to see. Tagged just past the node's right edge.
function drawBaseline(r, strong) {
    const color = strong ? 'rgba(47,44,205,.75)' : 'rgba(47,44,205,.45)';
    const g = document.createElement('div');
    g.style.cssText = `position:absolute;left:0;width:${document.documentElement.clientWidth}px;top:${Math.round(r.base)}px;height:0;border-top:1px dashed ${color}`;
    layer.appendChild(g);
    const t = document.createElement('div');
    t.textContent = 'baseline';
    t.style.cssText = `position:absolute;left:${r.left + r.width + 6}px;top:${Math.round(r.base) - 13}px;`
        + `font:10px/1 ui-monospace,Menlo,monospace;color:${color};background:rgba(255,255,255,.8);padding:1px 3px;border-radius:2px`;
    layer.appendChild(t);
}
// ── Page-wide guides ───────────────────────────────────────────────────────────
// Options a panel can turn on: every line's baseline, and a bar past every
// line's end coloured by its badness. Drawn for the segments on screen.
const options = { baselines: false, badness: false };
const BAD_COLOR = bad => bad.overfull ? '#8e24aa' : bad.b <= 12 ? '#43a047' : bad.b < 100 ? '#f0a500' : '#e53935';
function drawGuides() {
    for (const el of I.blocks()) {
        const br = el.getBoundingClientRect();
        if (br.bottom < 0 || br.top > innerHeight) continue;
        const bid = blockId(el);
        for (const sid of segmentsOf(bid)) {
            const { s, laid } = segParts(sid);
            const sr = s.svg.getBoundingClientRect();
            if (sr.bottom < 0 || sr.top > innerHeight) continue;
            const g = geometry(sid);
            if (!g) continue;
            const text = laid.seg.kind !== 'display';
            for (const L of g.lines) {
                if (options.baselines) {
                    const q = toScreen(g.svg, { x: L.x0, y: L.y, w: L.x1 - L.x0, h: 0 });
                    if (q) {
                        const d = document.createElement('div');
                        d.style.cssText = `position:absolute;left:${q.left}px;top:${Math.round(q.top)}px;width:${q.width}px;height:0;border-top:1px solid rgba(47,44,205,.45)`;
                        layer.appendChild(d);
                    }
                }
                if (options.badness && text) {
                    const bad = badnessOf(laid.lrp[L.j]);
                    const q = toScreen(g.svg, { x: L.x1 + 3, y: L.y - L.h, w: 3, h: L.h + L.d });
                    if (q) {
                        const d = document.createElement('div');
                        d.style.cssText = `position:absolute;left:${q.left}px;top:${q.top}px;width:4px;height:${Math.max(q.height, 4)}px;border-radius:2px;background:${BAD_COLOR(bad)}`;
                        d.title = `badness ${bad.b}`;
                        layer.appendChild(d);
                    }
                }
            }
        }
    }
}
let guidesPaints = -1;

// Hovering something else, the selection steps back to a pale wash – no
// outline, label, children or baseline to compete with what is hovered.
// Several ids hovered at once (a panel's row of letters) are washed in
// gently, backgrounds only.
function redraw() {
    ensureLayer().replaceChildren();
    // Everything below is placed in viewport coordinates, inside a layer that
    // sits where the viewport's corner is now.
    layer.style.left = scrollX + 'px';
    layer.style.top = scrollY + 'px';
    if (options.baselines || options.badness) { drawGuides(); guidesPaints = I.paints; }
    const h = picking ? pickHover : hovered;
    const other = h != null && h !== selected;
    if (selected != null) { if (other) drawPale(selected); else drawId(selected, true); }
    if (Array.isArray(h)) for (const id of h) drawPale(id, 'rgba(111,168,220,.35)');
    else if (other) drawId(h, false);
}
function drawPale(id, color = 'rgba(47,44,205,.07)') {
    const r = screenRectOf(id);
    if (!r) return;
    const d = document.createElement('div');
    d.style.cssText = `position:absolute;left:${r.left}px;top:${r.top}px;width:${Math.max(r.width, 1)}px;height:${Math.max(r.height, 1)}px;`
        + `background:${color}`;
    layer.appendChild(d);
}
let raf = 0;
const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0;
    if (selected != null || hovered != null || pickHover != null || options.baselines || options.badness) redraw(); }); };
// The page's own scrolling carries the layer; a scroll box inside it (a wide
// display) moves what it holds, and needs a redraw.
addEventListener('scroll', e => { if (e.target !== document && e.target !== document.documentElement) schedule(); }, { passive: true, capture: true });
addEventListener('resize', schedule, { passive: true });

// ── Picking ────────────────────────────────────────────────────────────────────
// The node under a point: the smallest drawn rectangle containing it, over
// the segments whose <svg> contains it.
function nodeAt(x, y) {
    let best = null, bestArea = Infinity;
    for (const el of I.blocks()) {
        const br = el.getBoundingClientRect();
        if (x < br.left || x > br.right || y < br.top || y > br.bottom) continue;
        const bid = blockId(el);
        for (const sid of segmentsOf(bid)) {
            const { s } = segParts(sid);
            const sr = s.svg.getBoundingClientRect();
            if (x < sr.left - 2 || x > sr.right + 2 || y < sr.top || y > sr.bottom) continue;
            const g = geometry(sid);
            if (!g) continue;
            for (const n of g.at.keys()) {
                const r = rectOf(g, n); if (!r || r.w <= 0) continue;
                const q = toScreen(g.svg, r); if (!q) continue;
                if (x >= q.left && x <= q.left + q.width && y >= q.top && y <= q.top + q.height) {
                    const a = q.width * q.height;
                    if (a < bestArea) { bestArea = a; best = { n, sid }; }
                }
            }
            // Above or below the ink but within a line: the line's own node
            // under x (a glyph's box is shorter than the line), else the line.
            if (!best) for (const L of g.lines) {
                const q = toScreen(g.svg, { x: L.x0, y: L.y - L.h, w: L.x1 - L.x0, h: L.h + L.d });
                if (!q || y < q.top || y > q.top + q.height) continue;
                best = { line: L.j, sid };
                for (const n of L.line.nodes) {
                    const r = rectOf(g, n), qq = r && r.w > 0 && toScreen(g.svg, r);
                    if (qq && x >= qq.left && x <= qq.left + qq.width) { best = { n, sid }; break; }
                }
            }
        }
    }
    if (!best) return gapAt(x, y);
    if (best.line != null) return { id: lineId(best.sid, best.line), path: pathOfLine(best.sid, best.line) };
    const path = pathOf(best.n, best.sid);
    return path && { id: path[path.length - 1], path };
}
// Between the lines: a vertical space, and the part of it under the pointer.
function gapAt(x, y) {
    const inside = r => r && x >= r.left && x <= r.left + r.width && y >= r.top - 1 && y <= r.top + Math.max(r.height, 2) + 1;
    for (const el of I.blocks()) {
        const br = el.getBoundingClientRect();
        if (x < br.left || x > br.right || y < br.top || y > br.bottom) continue;
        const bid = blockId(el);
        for (const { gid, path } of gapsOf(bid)) {
            const g = gapInfo(gid);
            if (!g || !inside(g.band)) continue;
            for (let k = 0; k < g.parts.length; k++) {
                const pid = partId(gid, k);
                if (inside(partRect(pid)) && partRect(pid).height >= 1) return { id: pid, path: [...path, gid, pid] };
            }
            return { id: gid, path: [...path, gid] };
        }
    }
    return null;
}
// Every vertical space of a block, with the path of rows above it.
function* gapsOf(bid) {
    const el = entries.get(bid).el;
    function* walk(cache, cachePath, path) {
        if (!cache || !cache.dom || !cache.layout) return;
        for (let i = 0; i < cache.layout.laid.length; i++) {
            const g = gapBefore(bid, cachePath, cache, i);
            if (g) yield { gid: g, path };
            const s = cache.dom.segs[i], L = cache.layout.laid[i], sid = segId(bid, cachePath, i);
            if (s && s.sub) yield* walk(s.sub, [...cachePath, i], [...path, sid]);
            else if (L && L.itemStarts) for (let k = 1; k < L.itemStarts.length; k++) yield { gid: parGapId(sid, k), path: [...path, sid] };
        }
    }
    yield* walk(I.state(el).cache, [], [bid]);
}
function pathOfLine(sid, j) {
    const seg = entries.get(sid), segs = [];
    for (let k = 0; k < seg.cachePath.length; k++) segs.push(segId(seg.block, seg.cachePath.slice(0, k), seg.cachePath[k]));
    return [seg.block, ...segs, sid, lineId(sid, j)];
}
// An inspector's own UI on the page (marked data-rtx-ui) is not part of it.
const onUI = ev => !!(ev.target && ev.target.closest && ev.target.closest('[data-rtx-ui]'));
function onMove(ev) {
    if (onUI(ev)) { if (pickHover != null) { pickHover = null; redraw(); } return; }
    const hit = nodeAt(ev.clientX, ev.clientY);
    const id = hit ? hit.id : null;
    if (id !== pickHover) { pickHover = id; redraw(); }
}
function onClick(ev) {
    if (onUI(ev)) return;
    ev.preventDefault(); ev.stopPropagation();
    const hit = nodeAt(ev.clientX, ev.clientY);
    stopPick();
    if (hit) { selected = hit.id; picked = { id: hit.id, path: hit.path, seq: (picked ? picked.seq : 0) + 1 }; }
    redraw();
}
const swallow = ev => { if (onUI(ev)) return; ev.preventDefault(); ev.stopPropagation(); };
function onKey(ev) { if (ev.key === 'Escape') { stopPick(); redraw(); } }
function startPick() {
    if (picking) return;
    picking = true;
    addEventListener('mousemove', onMove, true);
    addEventListener('click', onClick, true);
    addEventListener('mousedown', swallow, true);
    addEventListener('mouseup', swallow, true);
    addEventListener('keydown', onKey, true);
    document.documentElement.style.cursor = 'crosshair';
}
function stopPick() {
    picking = false; pickHover = null;
    removeEventListener('mousemove', onMove, true);
    removeEventListener('click', onClick, true);
    removeEventListener('mousedown', swallow, true);
    removeEventListener('mouseup', swallow, true);
    removeEventListener('keydown', onKey, true);
    document.documentElement.style.cursor = '';
}

// An element (the Elements panel's $0) → the node it draws.
function fromElement(el) {
    if (!el || !el.closest) return null;
    const block = el.closest('[data-nodelist-b64]');
    if (!block || !I.state(block)) return null;
    const bid = blockId(block);
    for (const sid of segmentsOf(bid)) {
        const { cache } = segParts(sid);
        const g = geometry(sid);
        if (!g || !cache.dom) continue;
        for (let e = el; e && e !== block; e = e.parentNode) {
            for (const [n, drawn] of cache.dom.byNode) {
                if (drawn === e && g.at.has(n)) {
                    const path = pathOf(n, sid);
                    if (path) { selected = path[path.length - 1]; redraw(); return { id: selected, path }; }
                }
            }
        }
    }
    return null;
}
function elementOf(id) {
    const e = entries.get(id);
    if (!e) return null;
    if (e.kind === 'block') return e.el;
    if (e.kind === 'seg') { const { s } = segParts(id); return s && (s.svg || s.box); }
    const sid = e.seg;
    const { cache, s } = segParts(sid);
    if (e.kind === 'node') {
        const direct = cache.dom.byNode.get(e.n);
        if (direct) return direct;
    }
    return s && s.svg;
}

window.__rtxInspector = {
    agent: AGENT,
    // Page-wide guides: { baselines, badness }, either or both.
    setOptions(o) { Object.assign(options, o); redraw(); },
    status: () => ((options.baselines || options.badness) && guidesPaints !== I.paints && schedule(), {
        api: true, version: I.version, blocks: I.blocks().length, paints: I.paints, picking, picked: picked && { id: picked.id, path: picked.path, seq: picked.seq },
    }),
    blocks: () => I.blocks().map(el => summary(blockId(el))),
    children, details,
    hover(id) { hovered = id; redraw(); },          // an id, a list of ids, or null
    select(id) { selected = id; redraw(); scrollIntoViewIfNeeded(id); },
    clear() { hovered = selected = null; redraw(); },
    pick() { startPick(); return true; },
    cancelPick() { stopPick(); redraw(); },
    fromElement, elementOf,
    // The path to a block element (the panel's open(block)).
    blockPath: el => (I.state(el) ? [blockId(el)] : null),
};
function scrollIntoViewIfNeeded(id) {
    const r = id != null && screenRectOf(id);
    if (r && (r.top < 0 || r.top + r.height > innerHeight)) {
        scrollBy({ top: r.top - innerHeight / 3, behavior: 'instant' });
        schedule();
    }
}
return 'ok';
};
window.__rtxInspectorInstall();
