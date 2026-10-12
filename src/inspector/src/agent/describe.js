// SPDX-License-Identifier: AGPL-3.0-or-later

import { I, RUNNING, SP, shown } from './context.js';
import { entries, lineId, nodeId, parGapId, partId, segId, sideId } from './ids.js';
import { WHERE, rootCache, rootsOf, segParts, surfaceOf } from './resolve.js';
import { geometry } from './geometry.js';
import { DIMENSIONLESS, GLUE_SUB, KERN_SUB, ORDER, affineFields, badnessOf, childLists, glueSpec, pt } from './format.js';
import { gapBefore, gapDetails, gapInfo, gapSummary, partSummary } from './vspace.js';
import { displayBand, screenRectOf } from './rects.js';
import { fontKeyIn } from './census.js';

export function affineRows(e, rows) {
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
export function setWidth(e) {
    const g = e.seg && geometry(e.seg), p = g && g.at.get(e.n);
    if (!p) return null;
    return (p.vertical ? p.h : p.w) / SP();
}
export function summary(id) {
    const e = entries.get(id);
    const out = { id, kind: e.kind, hasChildren: false, label: '', note: '' };
    if (e.kind === 'vgap' || e.kind === 'vpar') { gapSummary(id, out); return out; }
    if (e.kind === 'vpart') { partSummary(id, out); return out; }
    if (e.kind === 'side') {
        const c = rootCache(e.block, e.root), sf = surfaceOf(e.block, e.root);
        out.type = 'stream';
        out.label = sf ? `${sf.kind} · ${sf.role} (${WHERE[sf.where] || sf.where})` : 'surface (gone)';
        if (!c || !c.layout) out.note = 'not laid out';
        else {
            out.note = `${c.layout.laid.length} segment(s) · ${shown(c.dom && c.dom.root) ? 'shown' : 'hidden – as it was last laid out'}`;
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
            case 'widget': out.label = 'widget'; out.note = n.inline ? (n.inline.instance.attrs.name || n.inline.instance.kind) : ''; break;
            case 'transform': out.label = 'transform'; out.note = `[${[n.m_a ?? 1, n.m_b ?? 0, n.m_c ?? 0, n.m_d ?? 1].map(v => +(+v).toFixed(3)).join(' ')}]`; break;
            default: out.label = n.type || 'node';
        }
        out.drawn = sw != null;
        if (affineFields(n).length) out.affine = affineFields(n);   // width-dependent: marked in a panel
    }
    return out;
}

// The panel's detail view: every scalar field, dimensions also in pt.
export const DIM = new Set(['width', 'height', 'depth', 'stretch', 'shrink', 'kern', 'shift', 'surround']);
export function details(id) {
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
        const c = rootCache(e.block, e.root), sf = surfaceOf(e.block, e.root);
        rows.push(['instance', sf ? `${sf.instance} (${sf.kind})` : '?'],
                  ['part', sf ? sf.role : '?'],
                  ['shown', sf ? WHERE[sf.where] || sf.where : '?'],
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

export function children(id) {
    const e = entries.get(id);
    if (!e) return [];
    if (e.kind === 'block') return [...segmentRows(id, [], I.state(e.el).cache),
                                    ...rootsOf(e.el).map(k => summary(sideId(id, k)))];
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
export function segmentRows(bid, cachePath, cache, root = null) {
    const out = [];
    (cache && cache.layout ? cache.layout.laid : []).forEach((_, i) => {
        const g = gapBefore(bid, cachePath, cache, i, root);
        if (g) out.push(summary(g));
        out.push(summary(segId(bid, cachePath, i, root)));
    });
    return out;
}
