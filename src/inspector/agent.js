// SPDX-License-Identifier: AGPL-3.0-or-later
// Reflow TeX inspector – the page-side half (see README.md).
//
// Runs in the inspected page, where it installs window.__rtxInspector: the
// inspector's panel (panel/bridge.js) loads it as a script, and any other tool – a
// browser devtools panel, a test – may evaluate it there. Everything a panel
// shows comes from here as plain JSON; everything drawn on the page (the
// overlay) is drawn from here. It reads the viewer through window.reflowtex.inspect – the viewer's
// own geometry, replayed without touching the DOM – and never changes what
// the viewer drew.
//
// The file's value, when evaluated as a script, is the result of installing: 'ok', or 'no-api' when the page has no inspectable viewer yet.
// window.__rtxInspectorInstall() tries again.
window.__rtxInspectorInstall = () => {
const AGENT = 4;
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
// nested cache of stream segment k (and so on down). `root` is null for the
// block's flow, or a footnote's number for the body its popover laid out.
const segId = (bid, cachePath, i, root = null) => register(null, `s${bid}/${root ?? ''}/${cachePath.join('.')}/${i}`,
    () => ({ kind: 'seg', block: bid, cachePath, i, root }));
// A footnote's body, shown in the viewer's popover and never in the flow: a
// row of its own under its block, holding the popover's segments once it has
// been opened (and so laid out).
const sideId = (bid, root) => register(null, `f${bid}/${root}`, () => ({ kind: 'side', block: bid, root }));
const lineId = (sid, j) => register(null, `l${sid}/${j}`, () => ({ kind: 'line', seg: sid, j }));
// A display's nodes are copies made afresh at every width (see affineRows);
// they are keyed by the node they were made from, so a row stays the same row
// across reflows, and point at the latest copy.
function nodeId(n, sid, parent) {
    const id = register(n.affineSource || n, null, () => ({ kind: 'node', n }));
    const e = entries.get(id);
    e.n = n;
    if (sid !== undefined) { e.seg = sid; e.parent = parent; }
    return id;
}

// ── Resolving ──────────────────────────────────────────────────────────────────
// The layout cache a flow starts from: the block's, or a footnote popover's.
function rootCache(bid, root) {
    const st = I.state(entries.get(bid).el);
    if (!st) return null;
    return root == null ? st.cache : st.footnoteCaches && st.footnoteCaches.get(String(root));
}
function cacheOf(seg) {
    let cache = rootCache(seg.block, seg.root);
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
// svg units → viewport pixels. During a redraw, each svg's matrix is read once.
function toScreen(svg, r) {
    let m = ctms ? ctms.get(svg) : undefined;
    if (m === undefined) { m = svg.getScreenCTM(); if (ctms) ctms.set(svg, m); }
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
    if (e.kind === 'side') {
        const c = rootCache(e.block, e.root), el = c && c.dom && c.dom.root;
        if (!shown(el)) return null;
        const r = el.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height };
    }
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
// A display's geometry is compiled at several widths, and the fields that
// vary carry a rate (`width_rate`, …): the viewer evaluates each as
// v₀ + rate × (w − w₀) at the reader's measure w (w₀ the width TeX compiled
// at), a node copy per display, remembering its source (affineSource).
const AFFINE_FIELDS = ['width', 'height', 'depth', 'stretch', 'shrink', 'kern', 'shift',
                       'glue_set', 'surround', 'm_a', 'm_b', 'm_c', 'm_d'];
const affineFields = n => AFFINE_FIELDS.filter(f => n[`${f}_rate`] !== undefined);
const DIMENSIONLESS = new Set(['glue_set', 'm_a', 'm_b', 'm_c', 'm_d']);
function affineRows(e, rows) {
    const n = e.n, fields = affineFields(n);
    if (!fields.length) return;
    const { laid } = segParts(e.seg), m = laid && laid.affine;
    if (!m) return;
    const w0 = m.sourceWidthSp, src = n.affineSource || n;
    const frozen = m.evaluatedSp > m.targetSp + 1;
    rows.push(['width model', `evaluated at w = ${pt(m.evaluatedSp)}; TeX compiled it at w₀ = ${pt(w0)}`
        + (frozen ? ` – frozen: the column is ${pt(m.targetSp)}, but a gap between ink would close past ${pt(m.floorSp)}, so the display keeps this width and scrolls`
                  : '')]);
    const kinds = (m.kinds || []).map(k => k.get(src)).find(Boolean) || {};
    for (const f of fields) {
        const rate = n[`${f}_rate`], v0 = src[f] || 0, v = n[f] || 0;
        const fmt = x => DIMENSIONLESS.has(f) ? String(+x.toFixed(5)) : pt(x);
        // a dimension's rate is a pure number (sp per sp of width); a ratio's is per sp
        const r = DIMENSIONLESS.has(f) ? `${(+rate).toExponential(3)}/sp` : String(+(+rate).toFixed(5));
        rows.push([`${f} ↔`, `${fmt(v0)} + ${r} × (w − w₀) = ${fmt(v)}`]);
        if (kinds[f] !== undefined) rows.push([`${f} floor`, kinds[f]
            ? `ink on both sides: stops at the minimum space, ${pt(m.floorSp)} (the display then freezes)`
            : 'ink on one side only (centring, margins): may close to 0']);
        else if (n[`${f}_floor`]) rows.push([`${f} floor`, 'never negative in the compiled samples']);
    }
}
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
    if (e.kind === 'side') {
        const c = rootCache(e.block, e.root);
        out.type = 'stream';
        out.label = `footnote ${footnotesOf(entries.get(e.block).el).indexOf(e.root) + 1} (popover)`;
        if (!c || !c.layout) out.note = 'not laid out yet – open its popover';
        else {
            out.note = `${c.layout.laid.length} segment(s) · ${shown(c.dom && c.dom.root) ? 'open' : 'closed – as it was last shown'}`;
            out.hasChildren = c.layout.laid.length > 0;
        }
        return out;
    }
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
            const band = laid.seg.kind === 'display' && displayBand(id);
            if (band && Math.abs(band.widthSp - band.boxSp) > 655)
                out.note += ` · band ${pt(band.widthSp)}, box ${pt(band.boxSp)}`;
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
                    + (n.anchor ? ' · anchor' : '')
                    + ((n.width || 0) < 0 ? ' · backs up' : '');
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
        if (affineFields(n).length) out.affine = affineFields(n);   // width-dependent: marked in a panel
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
        // the width model first: it says why the values below are what they are
        const model = [];
        affineRows(e, model);
        rows.unshift(...model);
        const sw = setWidth(e);
        if (sw != null) rows.push([e.n.type === 'glue' || e.n.type === 'kern' ? 'set to' : 'advance', pt(sw)]);
        else rows.push(['drawn', 'no (not on the current layout)']);
    } else if (e.kind === 'line') {
        const { laid } = segParts(e.seg), lrp = laid && laid.lrp[e.j];
        const band = displayBand(id);
        if (band) rows.push(['display band', `${pt(band.widthSp)} wide; the row's box covers ${pt(band.boxSp)}`
            + (band.boxSp < band.widthSp - 655 ? ` – ${pt(band.widthSp - band.boxSp)} short, drawn dotted (an amsmath row backs up over its right margin in the tag column)` : '')]);
        if (lrp) {
            const bad = badnessOf(lrp);
            rows.push(['badness', bad.overfull ? 'overfull' : String(bad.b)], ['fitness', bad.fit]);
            for (const [k, v] of Object.entries(lrp)) rows.push([k, typeof v === 'number' ? String(+v.toFixed(5)) : String(v)]);
        }
    } else if (e.kind === 'block') {
        const st = I.state(e.el), d = st.doc;
        rows.push(['width', `${st.lastWidth.toFixed(1)}pt`], ['align', String(st.lastAlign)],
                  ['paragraphs', String(d.paragraphs.length)], ['fonts', String(d.fonts.length)],
                  ['pictures', String((d.pictures || []).length)], ['streams', String((d.streams || []).length)]);
    } else if (e.kind === 'side') {
        const c = rootCache(e.block, e.root), st = I.state(entries.get(e.block).el);
        const stream = st && st.doc.streams[e.root - 1];
        rows.push(['stream', `${e.root} of the block's ${st.doc.streams.length} (Document.streams)`],
                  ['kind', stream ? stream.kind : '?'],
                  ['shown', 'in the viewer\'s popover, from its marker; laid out when it opens, at the popover\'s width'],
                  ['laid out', c && c.layout ? `${c.layout.laid.length} segment(s)` : 'not yet']);
    }
    const r = screenRectOf(id);
    if (r) rows.push(['on screen', `${r.width.toFixed(1)} × ${r.height.toFixed(1)} px at (${r.left.toFixed(0)}, ${r.top.toFixed(0)})`]);
    // a glyph: its font and character, for a panel to show in the font's table
    let glyph = null;
    if (e.kind === 'node' && e.n.type === 'glyph' && e.n.text === undefined && e.seg != null) {
        const doc = I.state(entries.get(entries.get(e.seg).block).el).doc, fk = fontKeyIn(doc, e.n.font);
        if (fk) glyph = { key: 'font:' + fk, cp: e.n.char, font: fk.replace(/^tex /, '').replace(/\.otf$/i, '') };
    }
    return { summary: sum, rows, glyph };
}

function children(id) {
    const e = entries.get(id);
    if (!e) return [];
    if (e.kind === 'block') return [...segmentRows(id, [], I.state(e.el).cache),
                                    ...footnotesOf(e.el).map(k => summary(sideId(id, k)))];
    if (e.kind === 'side') return segmentRows(e.block, [], rootCache(e.block, e.root), e.root);
    if (e.kind === 'vgap' || e.kind === 'vpar') {
        const g = gapInfo(id);
        return g ? g.parts.map((_, k) => summary(partId(id, k))) : [];
    }
    if (e.kind === 'vpart') return [];
    if (e.kind === 'seg') {
        const { laid, s } = segParts(id);
        if (laid && laid.seg && laid.seg.kind === 'stream') {
            const sub = s && s.sub;
            return sub && sub.layout ? segmentRows(e.block, [...e.cachePath, e.i], sub, e.root) : [];
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
    return [...segPath(sid), ...ids];
}
// The rows above a segment and the segment itself: its block, a popover's
// row, the streams it sits in.
function segPath(sid) {
    const seg = entries.get(sid), out = [seg.block];
    if (seg.root != null) out.push(sideId(seg.block, seg.root));
    for (let k = 0; k < seg.cachePath.length; k++) out.push(segId(seg.block, seg.cachePath.slice(0, k), seg.cachePath[k], seg.root));
    out.push(sid);
    return out;
}

// Every segment of a block (streams' nested ones included) that has an svg,
// and then those of its footnotes' popovers, if laid out.
function* segmentsOf(bid) {
    const el = entries.get(bid).el;
    function* walk(cache, cachePath, root) {
        if (!cache || !cache.dom) return;
        for (let i = 0; i < cache.dom.segs.length; i++) {
            const s = cache.dom.segs[i];
            if (s.sub) yield* walk(s.sub, [...cachePath, i], root);
            else if (s.svg) yield segId(bid, cachePath, i, root);
        }
    }
    yield* walk(I.state(el).cache, [], null);
    for (const k of footnotesOf(el)) yield* walk(rootCache(bid, k), [], k);
}
// The streams of a block's document that are footnotes: their numbers
// (1-based, into Document.streams).
function footnotesOf(el) {
    const st = I.state(el);
    return ((st && st.doc.streams) || []).flatMap((s, k) => (s.kind === 'footnote' ? [k + 1] : []));
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
const gapId = (bid, cachePath, i, root = null) => register(null, `g${bid}/${root ?? ''}/${cachePath.join('.')}/${i}`,
    () => ({ kind: 'vgap', block: bid, cachePath, i, root }));
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
        let cache = rootCache(e.block, e.root);
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
function gapBefore(bid, cachePath, cache, i, root = null) {
    const L = cache.layout.laid[i], s = cache.dom && cache.dom.segs[i];
    const px = s && s.gap ? parseFloat(s.gap.style.height) || 0 : 0;
    return (L && L.seg.vspace) || px > 0.05 ? gapId(bid, cachePath, i, root) : null;
}
function segmentRows(bid, cachePath, cache, root = null) {
    const out = [];
    (cache && cache.layout ? cache.layout.laid : []).forEach((_, i) => {
        const g = gapBefore(bid, cachePath, cache, i, root);
        if (g) out.push(summary(g));
        out.push(summary(segId(bid, cachePath, i, root)));
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

// ── As text ────────────────────────────────────────────────────────────────────
// A fragment – a node and everything in it, a line, a vertical space, a
// segment, a block – as compact XML: a run of glyphs in one font is one <t>,
// every other node one element, boxes nest. Dimensions in pt; a glue's `set`
// is the width it came out at here, where that differs from its natural one;
// a width-dependent field carries its rate (`w-rate`, per unit of width).
const num = sp => String(+(sp / 65536).toFixed(3));
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
    .replace(/[-]|[\u{F0000}-\u{10FFFF}]/gu, c => `&#x${c.codePointAt(0).toString(16).toUpperCase()};`);
const glyphText = n => n.text !== undefined ? n.text : String.fromCodePoint(n.char || 32);
function attrs(list) {
    return list.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => ` ${k}="${esc(String(v))}"`).join('');
}
const RATE_ATTR = { width: 'w', height: 'h', depth: 'd', stretch: 'plus', shrink: 'minus', kern: 'w', shift: 'shift',
                    glue_set: 'set-ratio', surround: 'surround' };
const rates = n => affineFields(n).filter(f => RATE_ATTR[f]).map(f => [`${RATE_ATTR[f]}-rate`, +(+n[`${f}_rate`]).toPrecision(4)]);
const spec = (v, order) => order ? `${+(v / 65536).toFixed(3)}${ORDER[order]}` : num(v);
function xmlNodes(list, at, ind, out) {
    for (let i = 0; i < list.length;) {
        const n = list[i];
        if (n.type === 'glyph') {                    // a run of plain glyphs in one font
            let j = i, s = '';
            while (j < list.length && list[j].type === 'glyph' && list[j].font === n.font && list[j].color === n.color
                   && !list[j].link && !list[j].slot) s += glyphText(list[j++]);
            if (j === i) { s = glyphText(n); j = i + 1; }
            out.push(`${ind}<t${attrs([['f', n.font], ['color', n.color]])}>${esc(s)}</t>`);
            i = j; continue;
        }
        xmlNode(n, at, ind, out);
        i++;
    }
}
function xmlNode(n, at, ind, out) {
    const p = at && at.get(n);
    const setW = p ? (p.vertical ? p.h : p.w) / SP() : null;
    const R = rates(n);
    switch (n.type) {
        case 'glue': {
            const name = GLUE_SUB[n.subtype];
            out.push(`${ind}<glue${attrs([['name', name], ['w', num(n.width || 0)],
                ['plus', n.stretch ? spec(n.stretch, n.stretch_order) : null], ['minus', n.shrink ? spec(n.shrink, n.shrink_order) : null],
                ['set', setW != null && Math.abs(setW - (n.width || 0)) > 1 ? num(setW) : null], ...R])}${n.leader ? '>' : '/>'}`);
            if (n.leader) { xmlNode(n.leader, at, ind + '  ', out); out.push(`${ind}</glue>`); }
            return;
        }
        case 'kern': out.push(`${ind}<kern${attrs([['w', num(n.kern || 0)], ['kind', KERN_SUB[n.subtype || 0]], ...R])}/>`); return;
        case 'penalty': out.push(`${ind}<penalty${attrs([['v', n.penalty ?? 0]])}/>`); return;
        case 'math': out.push(`${ind}<math ${n.subtype ? 'off' : 'on'}${attrs([['surround', n.surround ? num(n.surround) : null], ...R])}/>`); return;
        case 'rule': out.push(`${ind}<rule${attrs([['w', n.width === RUNNING ? '*' : num(n.width || 0)],
            ['h', n.height === RUNNING ? '*' : num(n.height || 0)], ['d', n.depth === RUNNING ? '*' : num(n.depth || 0)], ['color', n.color], ...R])}/>`); return;
        case 'picture': out.push(`${ind}<picture${attrs([['w', num(n.width || 0)], ['h', num(n.height || 0)], ['d', num(n.depth || 0)], ...R])}/>`); return;
        case 'widget': out.push(`${ind}<widget${attrs([['name', n.ctx && n.ctx.name], ['w', num(n.width || 0)]])}/>`); return;
        case 'disc': case 'wdisc': {
            const pre = n.pre || [], post = n.post || [], rep = n.replace || [];
            const plain = l => l.every(c => c.type === 'glyph');
            const a = [['penalty', n.penalty]];
            if (plain(pre) && plain(post) && plain(rep)) {    // letters only (a hyphenation point, a dash): one line
                out.push(`${ind}<disc${attrs([['pre', pre.map(glyphText).join('')], ['post', post.map(glyphText).join('')],
                                              ['replace', rep.map(glyphText).join('')], ...a])}/>`);
                return;
            }
            out.push(`${ind}<disc${attrs(a)}>`);
            for (const [k, l] of [['pre', pre], ['post', post], ['replace', rep]]) {
                if (!l.length) continue;
                out.push(`${ind}  <${k}>`); xmlNodes(l, at, ind + '    ', out); out.push(`${ind}  </${k}>`);
            }
            out.push(`${ind}</disc>`);
            return;
        }
        case 'hlist': case 'vlist': case 'transform': {
            const tag = n.type === 'hlist' ? 'hbox' : n.type === 'vlist' ? 'vbox' : 'transform';
            const sign = n.glue_sign === 1 ? '+' : n.glue_sign === 2 ? '-' : '';
            const a = n.type === 'transform'
                ? [['m', [n.m_a ?? 1, n.m_b ?? 0, n.m_c ?? 0, n.m_d ?? 1].map(v => +(+v).toFixed(4)).join(' ')]]
                : [['w', num(n.width || 0)], ['h', num(n.height || 0)], ['d', num(n.depth || 0)],
                   ['shift', n.shift ? num(n.shift) : null],
                   ['glue', sign && n.glue_set ? `${sign}${+(+n.glue_set).toFixed(4)}${ORDER[n.glue_order || 0]}` : null],
                   ['anchor', n.anchor || null]];
            const kids = n.children || [];
            if (!kids.length) { out.push(`${ind}<${tag}${attrs([...a, ...R])}/>`); return; }
            out.push(`${ind}<${tag}${attrs([...a, ...R])}>`);
            xmlNodes(kids, at, ind + '  ', out);
            out.push(`${ind}</${tag}>`);
            return;
        }
        default: out.push(`${ind}<${n.type || 'node'}/>`);
    }
}
// The same fragment as plain text: its characters, a space for a glue
// between them, a line break between lines (and around a display).
function textOfNodes(list, out) {
    for (const n of list || []) {
        if (n.type === 'glyph') out.push(glyphText(n));
        else if (n.type === 'glue') { if (out.length && out[out.length - 1] !== ' ') out.push(' '); }
        else if (n.type === 'disc' || n.type === 'wdisc') textOfNodes(n.replace, out);
        else if (n.children) textOfNodes(n.children, out);
    }
    return out;
}
function textOf(id) {
    const e = entries.get(id);
    if (!e) return '';
    if (e.kind === 'node') return textOfNodes([e.n], []).join('').trim();
    if (e.kind === 'line') {
        const g = geometry(e.seg), L = g && g.lines[e.j];
        return L ? textOfNodes(L.line.nodes, []).join('').trim() : '';
    }
    if (e.kind === 'vgap' || e.kind === 'vpar' || e.kind === 'vpart') return '';
    return children(id).map(c => textOf(c.id)).filter(Boolean).join('\n');
}
function xmlOf(id, ind = '', out = []) {
    const e = entries.get(id);
    if (!e) return out;
    const s = summary(id);
    if (e.kind === 'node') {
        const g = e.seg != null ? geometry(e.seg) : null;
        xmlNode(e.n, g && g.at, ind, out);
    } else if (e.kind === 'line') {
        const g = geometry(e.seg), L = g && g.lines[e.j];
        if (!L) return out;
        const { laid } = segParts(e.seg), lrp = laid.lrp[e.j], bad = badnessOf(lrp);
        const r = lrp.fillOrder ? lrp.fillRatio : lrp.ratio;
        out.push(`${ind}<line${attrs([['n', e.j + 1], ['glue', `${r >= 0 ? '+' : ''}${+(+r).toFixed(4)}${lrp.fillOrder ? ORDER[lrp.fillOrder] : ''}`],
            ['expansion', lrp.er ? +(lrp.er * 100).toFixed(2) + '%' : null],
            ['badness', laid.seg.kind === 'display' ? null : bad.overfull ? 'overfull' : bad.b]])}>`);
        xmlNodes(L.line.nodes, g.at, ind + '  ', out);
        out.push(`${ind}</line>`);
    } else if (e.kind === 'vpart') {
        const g = gapInfo(e.gap), p = g && g.parts[e.k];
        if (p) xmlNode(p.n, null, ind, out);
    } else {
        const tag = e.kind === 'block' ? 'block' : e.kind === 'side' ? 'footnote' : e.kind === 'seg' ? s.type : 'vspace';
        const a = e.kind === 'block' ? [['width', num(I.state(e.el).lastWidth * 65536)]]
                : e.kind === 'seg' ? [['kind', s.type === 'stream' ? s.label.replace(/^stream \((.*)\)$/, '$1') : null]]
                : e.kind === 'side' ? [['stream', e.root]]
                : [['total', gapInfo(id) ? num(gapInfo(id).totalSp) : null]];
        out.push(`${ind}<${tag}${attrs(a)}>`);
        for (const c of children(id)) xmlOf(c.id, ind + '  ', out);
        out.push(`${ind}</${tag}>`);
    }
    return out;
}

// ── A display's band ───────────────────────────────────────────────────────────
// The stretch of the column a display row occupies, [display_indent,
// display_indent + display_width] as evaluated at this width – which its box
// need not fill: an amsmath alignment ends every row with a tag column that
// opens with \kern-\tagshift@, backing the box up over the right margin, so
// the box stops a margin short even though the margin's \tabskip is there.
// For a display's line, or the row box on it; null for anything else.
function displayBand(id) {
    const e = entries.get(id);
    if (!e) return null;
    let sid, j;
    if (e.kind === 'line') { sid = e.seg; j = e.j; }
    else if (e.kind === 'node' && e.seg != null) {
        const g = geometry(e.seg);
        const L = g && g.lines.find(L => L.line.nodes[0] === e.n);
        if (!L) return null;
        sid = e.seg; j = L.j;
    } else return null;
    const { laid } = segParts(sid), g = geometry(sid);
    const item = laid && laid.affine && laid.affine.items && laid.affine.items[j];   // as evaluated at this width
    const L = g && g.lines[j];
    if (!item || !L || item.display_width == null) return null;
    const k = SP(), x = (item.display_indent || 0) * k;
    return { rect: toScreen(g.svg, { x, y: L.y - L.h, w: item.display_width * k, h: L.h + L.d }),
             widthSp: item.display_width, boxSp: (L.x1 - L.x0) / k };
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
let marked = [];                 // a resource's things, outlined until unmarked
// A redraw measures everything first and adds its drawing to the page once, at
// the end: adding each outline as it is measured would make the browser lay the
// page out again for every one (thousands, for a font's glyphs). `ink` is the
// drawing under way, `ctms` the svg matrices read for it.
let ink = null, ctms = null;
// A resource's uses and a hovered list are drawn only near the viewport (a
// screen above and below); scrolling further draws the rest.
let culled = false, culledAt = 0;          // (and the scroll position it was drawn at)
const near = r => r.top < 2 * innerHeight && r.top + r.height > -innerHeight;
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
    ink.appendChild(d);
    if (r.base != null && !children && (type === 'box' || type === 'hlist' || type === 'vlist' || type === 'line' || type === 'glyph')) {
        const b = document.createElement('div');
        b.style.cssText = `position:absolute;left:${r.left}px;top:${r.base}px;width:${r.width}px;border-top:1px dashed ${stroke}`;
        ink.appendChild(b);
    }
    if (label) {
        const t = document.createElement('div');
        t.textContent = label;
        const above = !below && r.top > 24;
        t.style.cssText = `position:absolute;left:${Math.max(2, r.left)}px;top:${above ? r.top - 22 : r.top + r.height + 3}px;`
            + 'font:11px/1.5 ui-monospace,Menlo,monospace;background:#1f2430;color:#fff;padding:1px 6px;border-radius:3px;white-space:nowrap;max-width:60vw;overflow:hidden;text-overflow:ellipsis';
        ink.appendChild(t);
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
    // A display row's box, continued dotted over the rest of its band.
    const band = displayBand(id);
    if (band && band.rect) {
        const b = band.rect, stroke = colorOf(s.type)[1];
        const piece = (left, right) => {
            if (right - left < 1) return;
            const d = document.createElement('div');
            d.style.cssText = `position:absolute;box-sizing:border-box;left:${left}px;top:${r.top}px;width:${right - left}px;height:${Math.max(r.height, 1)}px;`
                + `border:1px dotted ${stroke};opacity:.8`;
            ink.appendChild(d);
        };
        piece(b.left, r.left);
        piece(r.left + r.width, b.left + b.width);
    }
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
    ink.appendChild(g);
    const t = document.createElement('div');
    t.textContent = 'baseline';
    t.style.cssText = `position:absolute;left:${r.left + r.width + 6}px;top:${Math.round(r.base) - 13}px;`
        + `font:10px/1 ui-monospace,Menlo,monospace;color:${color};background:rgba(255,255,255,.8);padding:1px 3px;border-radius:2px`;
    ink.appendChild(t);
}
// ── Page-wide guides ───────────────────────────────────────────────────────────
// Options a panel can turn on: every line's baseline, and a bar past every
// line's end coloured by its badness. Drawn for the segments on screen.
// selection: whether the selected node (and a resource's marked uses) is
// drawn at all. A panel that outlines only what the pointer is over, as
// Chrome's does, turns it off and on again for keyboard navigation.
const options = { baselines: false, badness: false, springs: false, selection: true };
// A spring across a glue whose width the display model recomputes: a zigzag,
// one coil per 6px, along the middle of the glue's height.
function drawSpring(q) {
    if (!q || q.width < 2) return;
    const coils = Math.max(2, Math.round(q.width / 6)), amp = Math.min(3.5, Math.max(2, q.height / 5));
    const mid = amp + 1, pts = [`0,${mid}`];
    for (let i = 0; i < coils; i++) {
        const x0 = (i + 0.25) * q.width / coils, x1 = (i + 0.75) * q.width / coils;
        pts.push(`${x0.toFixed(1)},${(mid - amp).toFixed(1)}`, `${x1.toFixed(1)},${(mid + amp).toFixed(1)}`);
    }
    pts.push(`${q.width.toFixed(1)},${mid}`);
    const h = 2 * mid;
    const d = document.createElement('div');
    d.style.cssText = `position:absolute;left:${q.left}px;top:${q.top + q.height / 2 - mid}px;width:${q.width}px;height:${h}px`;
    d.innerHTML = `<svg width="${q.width}" height="${h}" viewBox="0 0 ${q.width} ${h}" style="display:block;overflow:visible">`
        + `<polyline points="${pts.join(' ')}" fill="none" stroke="#3f8f2a" stroke-width="1.3" stroke-linejoin="round"/></svg>`;
    ink.appendChild(d);
}
const BAD_COLOR = bad => bad.overfull ? '#8e24aa' : bad.b <= 12 ? '#43a047' : bad.b < 100 ? '#f0a500' : '#e53935';
function drawGuides() {
    for (const el of I.blocks()) {
        const br = el.getBoundingClientRect();
        if (br.bottom < 0 || br.top > innerHeight) continue;
        const bid = blockId(el);
        for (const sid of segmentsOf(bid)) {
            const { s, laid } = segParts(sid);
            if (!shown(s.svg)) continue;
            const sr = s.svg.getBoundingClientRect();
            if (sr.bottom < 0 || sr.top > innerHeight) continue;
            const g = geometry(sid);
            if (!g) continue;
            const text = laid.seg.kind !== 'display';
            if (options.springs && !text) {
                for (const n of g.at.keys()) {
                    if ((n.type === 'glue' || n.type === 'kern') && affineFields(n).some(f => f === 'width' || f === 'kern')) {
                        const r = rectOf(g, n);
                        if (r) drawSpring(toScreen(g.svg, r));
                    }
                }
            }
            for (const L of g.lines) {
                if (options.baselines) {
                    const q = toScreen(g.svg, { x: L.x0, y: L.y, w: L.x1 - L.x0, h: 0 });
                    if (q) {
                        const d = document.createElement('div');
                        d.style.cssText = `position:absolute;left:${q.left}px;top:${Math.round(q.top)}px;width:${q.width}px;height:0;border-top:1px solid rgba(47,44,205,.45)`;
                        ink.appendChild(d);
                    }
                }
                if (options.badness && text) {
                    const bad = badnessOf(laid.lrp[L.j]);
                    const q = toScreen(g.svg, { x: L.x1 + 3, y: L.y - L.h, w: 3, h: L.h + L.d });
                    if (q) {
                        const d = document.createElement('div');
                        d.style.cssText = `position:absolute;left:${q.left}px;top:${q.top}px;width:4px;height:${Math.max(q.height, 4)}px;border-radius:2px;background:${BAD_COLOR(bad)}`;
                        d.title = `badness ${bad.b}`;
                        ink.appendChild(d);
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
    ensureLayer();
    ink = document.createDocumentFragment(); ctms = new Map(); culled = false;
    try {
        if (options.baselines || options.badness || options.springs) { drawGuides(); guidesPaints = I.paints; }
        const sel = options.selection ? selected : null;
        if (options.selection) for (const id of marked) drawMark(id);
        const h = picking ? pickHover : hovered;
        const other = h != null && h !== sel;
        if (sel != null) { if (other) drawPale(sel); else drawId(sel, true); }
        if (Array.isArray(h)) for (const id of h) drawPale(id, 'rgba(111,168,220,.35)', true);
        // with no selection drawn, what is hovered is shown in full
        else if (other) drawId(h, !picking && sel == null);
    } finally {
        // Everything is placed in viewport coordinates, inside a layer that
        // sits where the viewport's corner is now.
        const drawing = ink;
        ink = ctms = null;
        layer.style.left = scrollX + 'px';
        layer.style.top = scrollY + 'px';
        layer.replaceChildren(drawing);
        culledAt = scrollY;
    }
}
// A resource's use: outlined in the inspector's accent, beneath the rest.
function drawMark(id) {
    const r = screenRectOf(id);
    if (!r) return;
    if (!near(r)) { culled = true; return; }
    const d = document.createElement('div');
    d.style.cssText = `position:absolute;box-sizing:border-box;left:${r.left - 1}px;top:${r.top - 1}px;width:${Math.max(r.width, 1) + 2}px;height:${Math.max(r.height, 1) + 2}px;`
        + 'background:rgba(47,44,205,.12);outline:1.5px solid rgba(47,44,205,.8);border-radius:1px';
    ink.appendChild(d);
}
function drawPale(id, color = 'rgba(47,44,205,.07)', cull = false) {
    const r = screenRectOf(id);
    if (!r) return;
    if (cull && !near(r)) { culled = true; return; }
    const d = document.createElement('div');
    d.style.cssText = `position:absolute;left:${r.left}px;top:${r.top}px;width:${Math.max(r.width, 1)}px;height:${Math.max(r.height, 1)}px;`
        + `background:${color}`;
    ink.appendChild(d);
}
let raf = 0;
const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0;
    if (selected != null || hovered != null || pickHover != null || marked.length || options.baselines || options.badness || options.springs) redraw(); }); };
// The page's own scrolling carries the layer; a scroll box inside it (a wide
// display) moves what it holds, and needs a redraw.
// The page's own scrolling only needs a redraw when something was left undrawn
// (see near), for the part of it now coming into view.
addEventListener('scroll', e => {
    if (e.target !== document && e.target !== document.documentElement) schedule();
    else if (culled && Math.abs(scrollY - culledAt) > innerHeight / 2) schedule();
}, { passive: true, capture: true });
addEventListener('resize', schedule, { passive: true });

// ── Picking ────────────────────────────────────────────────────────────────────
// The node under a point: the smallest drawn rectangle containing it, over
// the segments whose <svg> contains it.
function nodeAt(x, y) {
    let best = null, bestArea = Infinity;
    const pop = overPopover(x, y);
    for (const el of I.blocks()) {
        const br = el.getBoundingClientRect();
        const inBlock = !(x < br.left || x > br.right || y < br.top || y > br.bottom);
        if (!inBlock && !pop) continue;
        const bid = blockId(el);
        for (const sid of segmentsOf(bid)) {
            if (pop !== (entries.get(sid).root != null)) continue;
            const { s } = segParts(sid);
            if (!shown(s.svg)) continue;
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
    const pop = overPopover(x, y);
    for (const el of I.blocks()) {
        const br = el.getBoundingClientRect();
        if (!pop && (x < br.left || x > br.right || y < br.top || y > br.bottom)) continue;
        const bid = blockId(el);
        for (const { gid, path } of gapsOf(bid)) {
            if (pop !== (path.length > 1 && entries.get(path[1]).kind === 'side')) continue;
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
    function* walk(cache, cachePath, path, root) {
        if (!cache || !cache.dom || !cache.layout) return;
        for (let i = 0; i < cache.layout.laid.length; i++) {
            const g = gapBefore(bid, cachePath, cache, i, root);
            if (g) yield { gid: g, path };
            const s = cache.dom.segs[i], L = cache.layout.laid[i], sid = segId(bid, cachePath, i, root);
            if (s && s.sub) yield* walk(s.sub, [...cachePath, i], [...path, sid], root);
            else if (L && L.itemStarts) for (let k = 1; k < L.itemStarts.length; k++) yield { gid: parGapId(sid, k), path: [...path, sid] };
        }
    }
    yield* walk(I.state(el).cache, [], [bid], null);
    for (const k of footnotesOf(el)) yield* walk(rootCache(bid, k), [], [bid, sideId(bid, k)], k);
}
function pathOfLine(sid, j) {
    return [...segPath(sid), lineId(sid, j)];
}
// Over the viewer's footnote popover, open: it floats above the text, so what
// is under the pointer is in it.
function overPopover(x, y) {
    const pop = document.getElementById('latex-footnote-pop');
    if (!pop || !shown(pop)) return false;
    const r = pop.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
}
// On screen at all (not display: none, as a closed popover's body is).
const shown = el => !!(el && el.isConnected && el.getClientRects().length);
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
    if (e.kind === 'side') { const c = rootCache(e.block, e.root); return c && c.dom && c.dom.root; }
    const sid = e.seg;
    const { cache, s } = segParts(sid);
    if (e.kind === 'node') {
        const direct = cache.dom.byNode.get(e.n);
        if (direct) return direct;
    }
    return s && s.svg;
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

// One walk over a document's nodes: what it uses, and how often.
const censusMemo = new WeakMap();
function census(doc) {
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
const fileOf = f => (f.filename && f.filename !== 'unknown' ? f.filename : null);
const fontKeyOf = f => fileOf(f) || `tex ${f.name}`;
const fontKeysMemo = new WeakMap();
function fontKeyIn(doc, id) {
    let m = fontKeysMemo.get(doc);
    if (!m) fontKeysMemo.set(doc, m = new Map((doc.fonts || []).map(f => [f.id, fontKeyOf(f)])));
    return m.get(id);
}
// The characters of a stream, for a glimpse of it.
function streamText(doc, stream, depth = 0) {
    const out = [];
    for (const it of stream.content || []) {
        if (it.kind === 'paragraph' && it.para) textOfNodes(doc.paragraphs[it.para - 1].nodes, out);
        else if (it.box) textOfNodes([it.box], out);
        else if (it.kind === 'stream' && it.stream && depth < 4) out.push(' ', streamText(doc, doc.streams[it.stream - 1], depth + 1), ' ');
        if (out.length && out[out.length - 1] !== ' ') out.push(' ');
    }
    return out.join('').replace(/[-\u{F0000}-\u{10FFFF}]/gu, '').replace(/\s+/g, ' ').trim();
}
const clip = (t, k) => (t.length > k ? t.slice(0, k) + '…' : t);
const blockLabel = b => `block ${b}`;
// Bibliography entries the page ships for its citation popovers (#lr-citations).
function citeEntries() {
    const raw = document.getElementById('lr-citations');
    if (!raw) return {};
    try { let d = JSON.parse(raw.textContent); if (typeof d === 'string') d = JSON.parse(d); return d && typeof d === 'object' ? d : {}; }
    catch { return {}; }
}

function resources() {
    const fonts = new Map(), pictures = [], streams = [], links = [], cites = new Map(), anchors = [], slots = [];
    const bib = citeEntries();
    I.blocks().forEach((el, bi) => {
        const st = I.state(el);
        if (!st) return;
        const doc = st.doc, c = census(doc), bid = blockId(el), where = blockLabel(bi + 1);
        for (const f of doc.fonts || []) {
            const key = 'font:' + fontKeyOf(f);
            let r = fonts.get(key);
            if (!r) fonts.set(key, r = { key, cat: 'font', file: fileOf(f), family: st.fontInfo && st.fontInfo[f.id] ? st.fontInfo[f.id].family : null,
                                          names: new Set(), sizes: new Set(), blocks: new Set(), chars: new Set(), uses: 0 });
            r.names.add(f.name); r.sizes.add(f.size_sp); r.blocks.add(bi + 1);
            for (const [ch, u] of c.glyphs.get(f.id) || []) { r.chars.add(ch); r.uses += u.count; }
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
                note: `${where} · ${l.action ? 'a control' : l.url ? 'URL' : document.getElementById(l.label) ? 'label on this page' : 'label elsewhere, or unresolved'}`
                      + (u ? ` · ${u.count} glyph${u.count === 1 ? '' : 's'}` : '') });
        });
        for (const [m, what] of [[c.cites, 'uses'], [c.citeTargets, 'targets']]) for (const [num, u] of m) {
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
    });
    const range = set => { const b = [...set].sort((x, y) => x - y); return b.length === 1 ? blockLabel(b[0]) : b.length === I.blocks().length && b.length > 2 ? 'every block' : `blocks ${b.join(', ')}`; };
    const fontName = r => (r.file ? r.file.replace(/\.otf$/i, '') : [...r.names][0]) || '';
    const fontRows = [...fonts.values()].sort((a, b) => fontName(a).localeCompare(fontName(b), 'en', { numeric: true, sensitivity: 'base' })).map(r => {
        const origin = fontOrigin(r.file, r.family), pua = [...r.chars].filter(isPUA).length;
        return { key: r.key, cat: 'font', origin, label: r.file ? r.file.replace(/\.otf$/i, '') : [...r.names][0],
            note: (origin === 'converted' ? 'converted from Type 1 · ' : origin === 'patched' ? 'cmap patched · ' : '')
                  + `${[...r.sizes].sort((a, b) => a - b).map(pt).join(', ')} · ${r.chars.size} character${r.chars.size === 1 ? '' : 's'}`
                  + (origin && origin !== 'original' ? ` (${pua} private-use)` : '')
                  + `, ${r.uses} glyph${r.uses === 1 ? '' : 's'} · ${range(r.blocks)}` + (r.file ? '' : ' · no font file'),
            family: r.family, unresolved: !r.file, uses: r.uses };
    });
    return {
        // the fonts served as they are, and those the pipeline changed
        fonts: fontRows.filter(f => f.origin !== 'converted' && f.origin !== 'patched'),
        modifiedFonts: fontRows.filter(f => f.origin === 'converted' || f.origin === 'patched'),
        pictures, streams, links,
        citations: [...cites.values()].sort((a, b) => a.num - b.num).map(r => {
            const e = bib[r.num];
            return { key: r.key, cat: 'cite', label: `[${r.num}]`,
                     note: `${e && e.title ? clip(e.title, 50) + ' · ' : ''}${r.uses} glyph${r.uses === 1 ? '' : 's'}${r.targets ? ' · entry' : ''} · ${range(r.blocks)}` };
        }),
        anchors, slots,
    };
}
// How the pipeline served a font (see src/pipeline/fonts/fonts.ts): 'converted', a
// classic Type 1 font it rebuilt as OpenType (the document names the new file,
// NAME.reflowtex-HASH.otf); 'patched', an OpenType font whose cmap it extended
// with code points LuaTeX used – private-use ones among them – and serves
// renamed (only the page's font map, and so the @font-face rule, says so);
// 'original', served as it is; null with no file.
const MODIFIED_FILE = /\.reflowtex-[0-9a-f]{8}\.otf$/i;
const isPUA = cp => (cp >= 0xE000 && cp <= 0xF8FF) || cp >= 0xF0000;
function fontOrigin(file, family) {
    if (!file) return null;
    if (MODIFIED_FILE.test(file)) return 'converted';
    const url = family && fontUrl(family);
    return url && MODIFIED_FILE.test(decodeURIComponent(new URL(url).pathname)) ? 'patched' : 'original';
}
const kb = n => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`);

// Where a key's things are: its block (the element and id) and number.
function parseKey(key) {
    const i = key.indexOf(':'), cat = key.slice(0, i), rest = key.slice(i + 1);
    if (cat === 'font') return { cat, font: rest };
    if (cat === 'glyph') { const j = rest.indexOf(':'); return { cat, cp: +rest.slice(0, j), font: rest.slice(j + 1) }; }
    if (cat === 'cite') return { cat, num: +rest };
    const [b, k] = rest.split(':').map(Number), e = entries.get(b);
    return e && e.kind === 'block' ? { cat, bid: b, el: e.el, k, doc: I.state(e.el) && I.state(e.el).doc } : null;
}
// The node test for a key.
function matcher(key) {
    const p = parseKey(key);
    if (!p) return null;
    const docOf = bid => I.state(entries.get(bid).el).doc;
    switch (p.cat) {
        case 'font': return (n, bid) => n.type === 'glyph' && fontKeyIn(docOf(bid), n.font) === p.font;
        case 'glyph': return (n, bid) => n.type === 'glyph' && n.char === p.cp && n.text === undefined && fontKeyIn(docOf(bid), n.font) === p.font;
        case 'cite': return n => n.cite === p.num || n.citetarget === p.num;
        case 'pic': return (n, bid) => bid === p.bid && n.type === 'picture' && n.picture === p.k;
        case 'stream': return (n, bid) => bid === p.bid && n.stream === p.k;
        case 'link': return (n, bid) => bid === p.bid && n.link === p.k;
        case 'anchor': return (n, bid) => bid === p.bid && n.anchor === p.k;
        case 'slot': return (n, bid) => bid === p.bid && n.slot === p.k;
    }
    return null;
}
// Every node on the current layout, with its segment: one replay of each
// segment, until the next paint.
let drawnMemo = null;
function drawn() {
    if (drawnMemo && drawnMemo.paints === I.paints) return drawnMemo.list;
    const list = [];
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
// A node's id, found other than through the tree.
function nodeRef(n, sid) {
    const id = register(n.affineSource || n, null, () => ({ kind: 'node', n }));
    const e = entries.get(id);
    e.n = n; e.seg = sid;
    return id;
}
// Where a stream stands in the flow: the segments that hold it.
function streamSegs(bid, k) {
    const out = [];
    const walk = (cache, cachePath, root) => {
        if (!cache || !cache.layout) return;
        cache.layout.laid.forEach((L, i) => {
            if (L.seg.kind !== 'stream') return;
            if (L.seg.index === k) out.push(segId(bid, cachePath, i, root));
            const s = cache.dom && cache.dom.segs[i];
            if (s && s.sub) walk(s.sub, [...cachePath, i], root);
        });
    };
    walk(rootCache(bid, null), [], null);
    for (const f of footnotesOf(entries.get(bid).el)) walk(rootCache(bid, f), [], f);
    return out;
}
// The ids of a resource's things on the current layout, in reading order: a
// font's glyphs, a picture's boxes, a stream's segment or marker, a link's or
// citation's glyphs.
function uses(key, limit = Infinity) {
    const m = matcher(key);
    if (!m) return [];
    const p = parseKey(key), out = p.cat === 'stream' ? streamSegs(p.bid, p.k) : [];
    for (const d of drawn()) if (m(d.n, d.bid)) { out.push(nodeRef(d.n, d.sid)); if (out.length >= limit) break; }
    return out;
}
// The rows down to an id, for a panel to open.
function pathTo(id) {
    const e = entries.get(id);
    if (!e) return null;
    if (e.kind === 'node' && e.seg != null) return pathOf(e.n, e.seg);
    if (e.kind === 'seg') return segPath(id);
    if (e.kind === 'line') return pathOfLine(e.seg, e.j);
    if (e.kind === 'side') return [e.block, id];
    return [id];
}

// A resource in full: rows of what it is, and what a panel can show of it.
function resource(key) {
    const p = parseKey(key);
    if (!p) return null;
    const rows = [], out = { key, cat: p.cat, rows };
    const where = p.el ? blockLabel(I.blocks().indexOf(p.el) + 1) : null;
    const onPage = uses(key).length;
    if (p.cat === 'pic') {
        const pic = (p.doc.pictures || [])[p.k - 1], u = census(p.doc).pictures.get(p.k);
        if (!pic) return null;
        out.title = `picture ${p.k} · ${where}`;
        out.svg = { markup: pic.svg || '', vb_w: pic.vb_w || 0, vb_h: pic.vb_h || 0 };
        rows.push(['picture', `${p.k} of the block's ${p.doc.pictures.length} (Document.pictures)`]);
        if (u) rows.push(['box', `${pt(u.box.width || 0)} × ${pt(u.box.height || 0)} + ${pt(u.box.depth || 0)}`]);
        rows.push(['viewBox', `${+(+pic.vb_w).toFixed(2)} × ${+(+pic.vb_h).toFixed(2)} bp`], ['markup', `${kb((pic.svg || '').length)} of SVG`],
                  ['elements', String(((pic.svg || '').match(/<[a-zA-Z]/g) || []).length)],
                  ['in the document', u ? `${u.count} box${u.count === 1 ? '' : 'es'}` : 'unused']);
    } else if (p.cat === 'stream') {
        const s = (p.doc.streams || [])[p.k - 1];
        if (!s) return null;
        const c = census(p.doc), markers = c.markers.get(p.k), parent = c.parents.get(p.k);
        out.title = `${s.kind || 'stream'} ${p.k} · ${where}`;
        out.footnote = s.kind === 'footnote';
        out.flow = parent !== undefined;
        rows.push(['kind', s.kind || '(none)'], ['stream', `${p.k} of the block's ${p.doc.streams.length} (Document.streams)`]);
        if (markers) rows.push(['referenced by', `a marker of ${markers.count} glyph${markers.count === 1 ? '' : 's'}` + (out.footnote ? '; shown in the popover' : '')]);
        if (parent !== undefined) rows.push(['stands', parent === 0 ? 'in the block\'s flow' : `in stream ${parent} (${p.doc.streams[parent - 1].kind})`]);
        if (!markers && parent === undefined) rows.push(['referenced by', 'nothing']);
        for (const a of s.attrs || []) rows.push([`data-${a.key}`, a.value || '']);
        const kinds = {};
        for (const it of s.content || []) kinds[it.kind] = (kinds[it.kind] || 0) + 1;
        rows.push(['content', Object.entries(kinds).map(([k, v]) => `${v} ${k}${v === 1 ? '' : 's'}`).join(', ') || 'empty']);
        if (out.footnote) {
            const fc = rootCache(p.bid, p.k);
            rows.push(['popover', fc && fc.layout ? (shown(fc.dom && fc.dom.root) ? 'open' : 'closed; laid out when last shown') : 'never opened']);
            out.side = sideId(p.bid, p.k);
        }
        out.text = s.text ? s.text : streamText(p.doc, s);
        out.textIsCode = !!s.text;
    } else if (p.cat === 'link') {
        const l = (p.doc.links || [])[p.k - 1];
        if (!l) return null;
        out.title = `link ${p.k} · ${where}`;
        if (l.action) rows.push(['action', l.action], ['does', 'sends a reflowtex:action event; the enclosing stream kind that knows it acts']);
        else if (l.url) rows.push(['URL', l.url]);
        else {
            const t = document.getElementById(l.label);
            rows.push(['label', l.label], ['resolves', t ? 'on this page' : 'through the page\'s link map, or not at all']);
        }
        const u = census(p.doc).links.get(p.k);
        rows.push(['glyphs', String(u ? u.count : 0)]);
    } else if (p.cat === 'cite') {
        const e = citeEntries()[p.num];
        out.title = `citation [${p.num}]`;
        if (e) {
            if (e.authors) rows.push(['authors', String(e.authors)]);
            if (e.title) rows.push(['title', String(e.title)]);
            if (e.rest) rows.push(['details', String(e.rest)]);
            if (e.link && e.link.href) rows.push(['link', e.link.href]);
        } else rows.push(['entry', 'none in the page\'s #lr-citations: the popover stays inert']);
    } else if (p.cat === 'anchor') {
        const a = (p.doc.anchors || [])[p.k - 1], u = census(p.doc).anchors.get(p.k);
        out.title = `anchor ${a}`;
        rows.push(['label', a], ['placed', u ? (u.where === 'box' ? 'an empty box in a paragraph' : 'between two items of the flow') : 'nowhere'],
                  ['element', document.getElementById(a) ? `#${a} on this page` : 'none']);
    } else if (p.cat === 'slot') {
        const s = (p.doc.slots || [])[p.k - 1], u = census(p.doc).slots.get(p.k);
        out.title = `slot ${s.name || p.k}`;
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

// ── Font files ─────────────────────────────────────────────────────────────────
// A font's glyphs, read from the file the page loaded it from (the viewer's
// @font-face rule): each glyph's index, its name, the code points that map to
// it and its advance – and, from the documents, how often each character is
// used, at what sizes, with the metrics TeX gave it and its microtype codes.
function fontUrl(family) {
    for (const ss of document.styleSheets) {
        let rules;
        try { rules = ss.cssRules; } catch { continue; }
        for (const r of rules) {
            if (!(r instanceof CSSFontFaceRule)) continue;
            if (r.style.getPropertyValue('font-family').replace(/["']/g, '').trim() !== family) continue;
            const m = /url\(\s*["']?([^"')]+)/.exec(r.style.getPropertyValue('src'));
            if (m) return new URL(m[1], ss.href || document.baseURI).href;
        }
    }
    return null;
}
const fontStatus = family => { for (const f of document.fonts || []) if (f.family.replace(/["']/g, '') === family) return f.status; return null; };
const fontFiles = new Map();                     // url → a promise of the parsed file
function loadFontFile(url) {
    if (!fontFiles.has(url)) {
        const p = fetch(url).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); }).then(parseFont);
        p.catch(() => fontFiles.delete(url));    // may work another time
        fontFiles.set(url, p);
    }
    return fontFiles.get(url);
}
// The tables an OpenType file needs for a glyph list: cmap (format 4 or 12),
// maxp, head, hhea and hmtx, and CFF's charset for the names. (A TrueType
// file's names are in `post`, which is not read: the pipeline makes CFF.)
function parseFont(buf) {
    const v = new DataView(buf), u8 = o => v.getUint8(o), u16 = o => v.getUint16(o), u32 = o => v.getUint32(o);
    const sig = String.fromCharCode(u8(0), u8(1), u8(2), u8(3));
    if (sig === 'wOFF' || sig === 'wOF2') throw new Error('a WOFF file, which is not read here');
    const T = {};
    for (let i = 0, n = u16(4); i < n; i++) {
        const r = 12 + 16 * i;
        T[String.fromCharCode(u8(r), u8(r + 1), u8(r + 2), u8(r + 3))] = u32(r + 8);
    }
    const upem = T.head != null ? u16(T.head + 18) : 1000;
    const numGlyphs = T.maxp != null ? u16(T.maxp + 4) : 0;
    const numH = T.hhea != null ? u16(T.hhea + 34) : 0;
    const adv = new Array(numGlyphs);
    if (T.hmtx != null && numH) for (let g = 0; g < numGlyphs; g++) adv[g] = u16(T.hmtx + 4 * Math.min(g, numH - 1));
    // cmap: the best Unicode subtable – full repertoire (format 12) over BMP (format 4)
    const cps = Array.from({ length: numGlyphs }, () => []);
    if (T.cmap != null) {
        const subs = [];
        for (let i = 0, n = u16(T.cmap + 2); i < n; i++) {
            const r = T.cmap + 4 + 8 * i, plat = u16(r), enc = u16(r + 2), off = T.cmap + u32(r + 4);
            if (plat === 0 || (plat === 3 && (enc === 1 || enc === 10))) subs.push({ off, format: u16(off) });
        }
        const sub = subs.find(s => s.format === 12) || subs.find(s => s.format === 4);
        const map = (c, g) => { if (g > 0 && g < numGlyphs) cps[g].push(c); };
        if (sub && sub.format === 12) {
            for (let i = 0, n = u32(sub.off + 12); i < n; i++) {
                const r = sub.off + 16 + 12 * i, start = u32(r), end = u32(r + 4), g0 = u32(r + 8);
                for (let c = start; c <= end && c - start < 0x10000; c++) map(c, g0 + c - start);
            }
        } else if (sub) {
            const o = sub.off, seg2 = u16(o + 6), ends = o + 14, starts = ends + seg2 + 2, deltas = starts + seg2, ros = deltas + seg2;
            for (let i = 0; i < seg2 / 2; i++) {
                const end = u16(ends + 2 * i), start = u16(starts + 2 * i), delta = u16(deltas + 2 * i), ro = u16(ros + 2 * i);
                for (let c = start; c <= end && c !== 0xFFFF; c++) {
                    let g;
                    if (!ro) g = (c + delta) & 0xFFFF;
                    else { g = u16(ros + 2 * i + ro + 2 * (c - start)); if (g) g = (g + delta) & 0xFFFF; }
                    map(c, g);
                }
            }
        }
    }
    return { upem, numGlyphs, adv, cps, names: T['CFF '] != null ? cffNames(v, T['CFF '], numGlyphs) : null };
}
// Glyph names from a CFF table's charset (CFF1; a CID-keyed font's glyphs are
// named by CID).
function cffNames(v, base, numGlyphs) {
    try {
        const u8 = o => v.getUint8(o), u16 = o => v.getUint16(o);
        const off = (o, size) => { let x = 0; for (let i = 0; i < size; i++) x = x * 256 + u8(o + i); return x; };
        // an INDEX at o: its entries' [start, end) and where it ends
        const index = o => {
            const count = u16(o);
            if (!count) return { items: [], end: o + 2 };
            const os = u8(o + 2), data = o + 3 + (count + 1) * os - 1, items = [];
            for (let i = 0; i < count; i++) items.push([data + off(o + 3 + i * os, os), data + off(o + 3 + (i + 1) * os, os)]);
            return { items, end: data + off(o + 3 + count * os, os) };
        };
        const names = index(base + u8(base + 2)), top = index(names.end), strings = index(top.end);
        // the Top DICT: operators and their operands
        const dict = {};
        let [o, end] = top.items[0], ops = [];
        while (o < end) {
            const b0 = u8(o);
            if (b0 <= 21) { const op = b0 === 12 ? 1200 + u8(o + 1) : b0; o += b0 === 12 ? 2 : 1; dict[op] = ops; ops = []; }
            else if (b0 === 28) { ops.push(v.getInt16(o + 1)); o += 3; }
            else if (b0 === 29) { ops.push(v.getInt32(o + 1)); o += 5; }
            else if (b0 === 30) { o++; while (o < end) { const b = u8(o++); if ((b & 15) === 15 || (b >> 4) === 15) break; } ops.push(0); }
            else if (b0 <= 246) { ops.push(b0 - 139); o++; }
            else if (b0 <= 250) { ops.push((b0 - 247) * 256 + u8(o + 1) + 108); o += 2; }
            else { ops.push(-(b0 - 251) * 256 - u8(o + 1) - 108); o += 2; }
        }
        const cid = dict[1230] !== undefined, at = dict[15] ? dict[15][0] : 0;
        const str = sid => {
            if (cid) return `cid${sid}`;
            if (sid < CFF_STD.length) return CFF_STD[sid];
            const s = strings.items[sid - CFF_STD.length];
            return s ? String.fromCharCode(...new Uint8Array(v.buffer, v.byteOffset + s[0], s[1] - s[0])) : `sid${sid}`;
        };
        const out = ['.notdef'];
        if (at <= 2) { for (let g = 1; g < numGlyphs; g++) out.push(at === 0 ? str(g) : null); return out; }  // the predefined charsets: ISOAdobe (expert ones not named)
        const p = base + at, format = u8(p);
        let q = p + 1;
        if (format === 0) for (let g = 1; g < numGlyphs; g++, q += 2) out.push(str(u16(q)));
        else while (out.length < numGlyphs) {
            const first = u16(q), left = format === 1 ? u8(q + 2) : u16(q + 2);
            q += format === 1 ? 3 : 4;
            for (let i = 0; i <= left && out.length < numGlyphs; i++) out.push(str(first + i));
        }
        return out;
    } catch { return null; }
}
const CFF_STD = '.notdef space exclam quotedbl numbersign dollar percent ampersand quoteright parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore quoteleft a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde exclamdown cent sterling fraction yen florin section currency quotesingle quotedblleft guillemotleft guilsinglleft guilsinglright fi fl endash dagger daggerdbl periodcentered paragraph bullet quotesinglbase quotedblbase quotedblright guillemotright ellipsis perthousand questiondown grave acute circumflex tilde macron breve dotaccent dieresis ring cedilla hungarumlaut ogonek caron emdash AE ordfeminine Lslash Oslash OE ordmasculine ae dotlessi lslash oslash oe germandbls onesuperior logicalnot mu trademark Eth onehalf plusminus Thorn onequarter divide brokenbar degree thorn threequarters twosuperior registered minus eth multiply threesuperior copyright Aacute Acircumflex Adieresis Agrave Aring Atilde Ccedilla Eacute Ecircumflex Edieresis Egrave Iacute Icircumflex Idieresis Igrave Ntilde Oacute Ocircumflex Odieresis Ograve Otilde Scaron Uacute Ucircumflex Udieresis Ugrave Yacute Ydieresis Zcaron aacute acircumflex adieresis agrave aring atilde ccedilla eacute ecircumflex edieresis egrave iacute icircumflex idieresis igrave ntilde oacute ocircumflex odieresis ograve otilde scaron uacute ucircumflex udieresis ugrave yacute ydieresis zcaron exclamsmall Hungarumlautsmall dollaroldstyle dollarsuperior ampersandsmall Acutesmall parenleftsuperior parenrightsuperior twodotenleader onedotenleader zerooldstyle oneoldstyle twooldstyle threeoldstyle fouroldstyle fiveoldstyle sixoldstyle sevenoldstyle eightoldstyle nineoldstyle commasuperior threequartersemdash periodsuperior questionsmall asuperior bsuperior centsuperior dsuperior esuperior isuperior lsuperior msuperior nsuperior osuperior rsuperior ssuperior tsuperior ff ffi ffl parenleftinferior parenrightinferior Circumflexsmall hyphensuperior Gravesmall Asmall Bsmall Csmall Dsmall Esmall Fsmall Gsmall Hsmall Ismall Jsmall Ksmall Lsmall Msmall Nsmall Osmall Psmall Qsmall Rsmall Ssmall Tsmall Usmall Vsmall Wsmall Xsmall Ysmall Zsmall colonmonetary onefitted rupiah Tildesmall exclamdownsmall centoldstyle Lslashsmall Scaronsmall Zcaronsmall Dieresissmall Brevesmall Caronsmall Dotaccentsmall Macronsmall figuredash hypheninferior Ogoneksmall Ringsmall Cedillasmall questiondownsmall oneeighth threeeighths fiveeighths seveneighths onethird twothirds zerosuperior foursuperior fivesuperior sixsuperior sevensuperior eightsuperior ninesuperior zeroinferior oneinferior twoinferior threeinferior fourinferior fiveinferior sixinferior seveninferior eightinferior nineinferior centinferior dollarinferior periodinferior commainferior Agravesmall Aacutesmall Acircumflexsmall Atildesmall Adieresissmall Aringsmall AEsmall Ccedillasmall Egravesmall Eacutesmall Ecircumflexsmall Edieresissmall Igravesmall Iacutesmall Icircumflexsmall Idieresissmall Ethsmall Ntildesmall Ogravesmall Oacutesmall Ocircumflexsmall Otildesmall Odieresissmall OEsmall Oslashsmall Ugravesmall Uacutesmall Ucircumflexsmall Udieresissmall Yacutesmall Thornsmall Ydieresissmall 001.000 001.001 001.002 001.003 Black Bold Book Light Medium Regular Roman Semibold'.split(' ');

// A font's glyph table: every glyph of its file, and every character the
// documents use (one a file lacks among them, marked so).
async function fontGlyphs(fontKey) {
    const inst = [];                              // the fonts, in the blocks, that are this one
    for (const el of I.blocks()) {
        const st = I.state(el);
        if (st) for (const f of st.doc.fonts || []) if (fontKeyOf(f) === fontKey) inst.push({ st, f });
    }
    if (!inst.length) return null;
    const family = inst[0].st.fontInfo[inst[0].f.id] && inst[0].st.fontInfo[inst[0].f.id].family;
    const file = fileOf(inst[0].f);
    // what the documents use: per character, its count, sizes, metrics, codes
    const used = new Map();
    for (const { st, f } of inst) {
        const fi = st.fontInfo[f.id];
        for (const [ch, u] of census(st.doc).glyphs.get(f.id) || []) {
            let r = used.get(ch);
            if (!r) used.set(ch, r = { count: 0, tex: [], codes: null });
            r.count += u.count;
            const m = u.metrics || {};
            if (!r.tex.some(t => t[0] === f.size_sp)) r.tex.push([f.size_sp, m.width || 0, m.height || 0, m.depth || 0]);
            const cc = fi && fi.codes && fi.codes.get(ch);
            if (cc && !r.codes) r.codes = { lp: cc.lp || 0, rp: cc.rp || 0, ef: cc.ef ?? 1000 };
        }
    }
    const sizes = [...new Set(inst.map(i => i.f.size_sp))].sort((a, b) => a - b);
    const out = { key: fontKey, file, family, sizes, names: [...new Set(inst.map(i => i.f.name))],
                  status: family ? fontStatus(family) : null, url: family ? fontUrl(family) : null, cells: [] };
    const f0 = inst[0].f;
    out.micro = { quad: f0.quad || 0, expand: f0.expand_stretch || f0.expand_shrink
        ? `stretch ${f0.expand_stretch || 0}, shrink ${f0.expand_shrink || 0}, step ${f0.expand_step || 0}` : null,
        codes: (f0.codes || []).length };
    const cell = (gid, name, cps, adv) => {
        const u = cps.map(c => used.get(c)).filter(Boolean);
        return { gid, name, cps, adv, uses: u.reduce((a, r) => a + r.count, 0),
                 tex: u.length ? u[0].tex : null, codes: u.length ? u[0].codes : null };
    };
    let font = null;
    if (!file) out.error = 'no font file: TeX named a font the pipeline could not turn into OpenType, so the viewer draws its glyphs as boxes';
    else if (!out.url) out.error = 'no @font-face rule for it on this page';
    else try { font = await loadFontFile(out.url); } catch (e) { out.error = `could not read ${out.url}: ${e.message || e}`; }
    out.origin = fontOrigin(file, family);
    out.puaUsed = [...used.keys()].filter(isPUA).length;
    if (font) {
        out.upem = font.upem; out.numGlyphs = font.numGlyphs;
        out.puaInFile = font.cps.reduce((a, l) => a + l.filter(isPUA).length, 0);
        const mapped = new Set();
        for (let g = 0; g < font.numGlyphs; g++) {
            font.cps[g].forEach(c => mapped.add(c));
            out.cells.push(cell(g, font.names ? font.names[g] : null, font.cps[g], font.adv[g]));
        }
        for (const ch of [...used.keys()].sort((a, b) => a - b))  // used, but not in the file's cmap
            if (!mapped.has(ch)) out.cells.push({ ...cell(null, null, [ch], null), missing: true });
    } else {
        for (const ch of [...used.keys()].sort((a, b) => a - b)) out.cells.push(cell(null, null, [ch], null));
    }
    return out;
}

// Open a footnote's popover, as its marker does when clicked: 'ok', or
// 'wait' while the marker is off screen (scrolled to, it is painted soon).
function openPopover(key) {
    const p = parseKey(key);
    if (!p || p.cat !== 'stream') return 'none';
    const fc = rootCache(p.bid, p.k);
    if (fc && fc.dom && shown(fc.dom.root)) return 'ok';
    const id = uses(key).find(i => entries.get(i).kind === 'node');
    if (id == null) return 'none';
    const e = entries.get(id), { cache } = segParts(e.seg), el = cache.dom && cache.dom.byNode.get(e.n);
    const r = screenRectOf(id);
    if (!el || !el.isConnected || !r || r.top < 0 || r.top + r.height > viewBottom()) { scrollIntoViewIfNeeded(id); return 'wait'; }
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: r.left, clientY: r.top }));
    return 'ok';
}

window.__rtxInspector = {
    agent: AGENT,
    // Page-wide guides: { baselines, badness, springs }, any of them.
    setOptions(o) { Object.assign(options, o); redraw(); },
    // Draw the outlines again, for the layout as it is now (after a reflow).
    redraw() { redraw(); },
    // A fragment as XML (see "As text"): the node with this id and all it holds.
    xml: id => xmlOf(id).join('\n'),
    text: id => textOf(id),
    status: () => ((options.baselines || options.badness || options.springs) && guidesPaints !== I.paints && schedule(), {
        api: true, version: I.version, blocks: I.blocks().length, paints: I.paints, picking, picked: picked && { id: picked.id, path: picked.path, seq: picked.seq },
    }),
    blocks: () => I.blocks().map(el => summary(blockId(el))),
    children, details,
    hover(id) { hovered = id; redraw(); },          // an id, a list of ids, or null
    // (scroll: false – a selection given back, which stays where it is)
    select(id, { scroll = true } = {}) { selected = id; redraw(); if (scroll) scrollIntoViewIfNeeded(id); },
    clear() { hovered = selected = null; marked = []; redraw(); },
    pick() { startPick(); return true; },
    cancelPick() { stopPick(); redraw(); },
    fromElement, elementOf,
    // The path to a block element (the panel's open(block)).
    blockPath: el => (I.state(el) ? [blockId(el)] : null),
    // Resources (see "Resources"): the page's list; one in full; the ids of
    // its things on the current layout; a font's glyphs (a promise); the rows
    // down to an id; outlining a list of ids until told otherwise; opening a
    // footnote's popover.
    resources, resource, uses, fontGlyphs, pathTo,
    mark(ids) { marked = ids || []; redraw(); },
    openPopover,
};
// Where the page stops being visible: the window's bottom, or the top of an
// inspector docked there (which publishes its height as --rtx-dock-bottom).
const viewBottom = () => innerHeight - (parseFloat(document.documentElement.style.getPropertyValue('--rtx-dock-bottom')) || 0);
function scrollIntoViewIfNeeded(id) {
    const r = id != null && screenRectOf(id);
    if (r && (r.top < 0 || r.top + r.height > viewBottom())) {
        scrollBy({ top: r.top - viewBottom() / 3, behavior: 'instant' });
        schedule();
    }
}
return 'ok';
};
window.__rtxInspectorInstall();
