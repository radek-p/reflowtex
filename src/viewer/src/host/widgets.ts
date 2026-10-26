// SPDX-License-Identifier: AGPL-3.0-or-later

import { SP_TO_PX } from '../engine/core.ts';
import { docData } from '../runtime/block-data.ts';
import { colorFill } from '../runtime/colour.ts';
import { inlineEnv, inlineOf, inlineVersion } from './inline.ts';
import type { Doc, FontTable, Slot, TexNode, WidgetInline, WidgetNode, WidgetPart, WidgetRun } from '../engine/model.ts';
import type { Box, InlineMetrics } from './types.ts';
import { report } from '../runtime/log.ts';

/** A measurement, whichever form it takes (InlineMetrics). */
type Metrics = Partial<Box> & {
    splits?: { first: Box & { overhang?: number }; second: Box & { overhang?: number }; penalty?: number }[];
    segments?: Box[];
    gaps?: { width?: number; penalty?: number }[];
    ends?: { left?: WidgetEnd; right?: WidgetEnd };
};
type WidgetEnd = { cap?: number; cut?: number; overhang?: number };
type Sp = (v: number | undefined) => number;

// ── Widgets (\webwidget) ───────────────────────────────────────────────────
// A \webwidget is an inline instance (host API, types.ts), drawn by the kind
// the page defines for it: host.define(kind, { measure, render }). measure
// (instance, env) says how big it is and where it may break, as a word has
// hyphenation points:
//
//   { width, height, depth }                       px, the whole widget
//   + splits: [{ first: {width, height, depth, overhang?}, second: {…},
//                penalty? }, …]                    each a way to break it once
//   or { segments: [{width, height, depth}], gaps: [{width, penalty}],
//        ends: { left: {cap, cut, overhang?}, right: {…} } }
//                                                  breakable at any gap
//
// The line breaker weighs every break, with its penalty (default 100, twice
// a hyphen's), against the rest of the paragraph, and render(instance,
// piece) then draws the part the chosen layout puts on each line: piece is
// 'whole', { split, piece: 'first' | 'second' }, or { from, to, left, right }
// ('cap' | 'cut'). env has the text's font size and colour, measure(html),
// and invalidate() – measure again and re-break when the content changes.
// The last measurement is kept per instance, for its font size and
// invalidation (a new one replaces it).
export const widgetMeasure = new Map<string, { key: string; m: InlineMetrics }>();       // instance.id → { key: `${fontPx}|${version}`, m }

// Size some HTML the way it sits in a line: its box against the baseline.
export function measureHTML(html: string | Node, fontPx: number): Box {
    const probe = document.createElement('div');
    probe.style.cssText = `position:absolute;left:-10000px;top:0;visibility:hidden;white-space:nowrap;font-size:${fontPx}px;line-height:normal`;
    const mark = document.createElement('span');
    mark.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    const body = document.createElement('span');
    body.style.cssText = 'display:inline-block;vertical-align:baseline';
    if (typeof html === 'string') body.innerHTML = html; else body.appendChild(html);
    probe.append(mark, body);
    document.body.appendChild(probe);
    // The widget's own boxes, not the wrapper's: the wrapper's line box is
    // as tall as a line of text at this size, which would count space above
    // the widget as its height and so draw it too high. (Text straight in
    // the HTML, with no element around it, falls back to the wrapper.)
    const base = mark.getBoundingClientRect().top;
    const rs = [...body.children].map(c => c.getBoundingClientRect());
    const r = rs.length ? { left: Math.min(...rs.map(x => x.left)), right: Math.max(...rs.map(x => x.right)),
                            top: Math.min(...rs.map(x => x.top)), bottom: Math.max(...rs.map(x => x.bottom)) }
                        : body.getBoundingClientRect();
    probe.remove();
    return { width: r.right - r.left, height: Math.max(0, base - r.top), depth: Math.max(0, r.bottom - base) };
}
export function widgetNodes(fontInfo: FontTable, slot: Slot, id: number, run: TexNode[], before: TexNode[], after: TexNode[],
                            doc: Doc): TexNode[] | null {
    const found = inlineOf(docData.get(doc)?.el, id);
    if (!found) return null;
    const { instance, def } = found;
    // The text's size and colour: the default's first glyph, else the nearest
    // glyph of the paragraph around it.
    const glyph = (ns: TexNode[]): TexNode | null => { for (const n of ns) { if (n.type === 'glyph') return n; if (n.type === 'disc') { const g = glyph(n.replace || []); if (g) return g; } } return null; };
    const t = glyph(run) || glyph([...before].reverse()) || glyph(after);
    const fi = t && fontInfo[String(t.font)];
    const fontPx = fi ? fi.size_px : 20;
    const version = inlineVersion(instance);
    const env = inlineEnv(instance, fontPx, t && t.color ? colorFill(t.color) : null);
    const inline: WidgetInline = { instance, def, env };
    const key = `${fontPx}|${version}`, kept = widgetMeasure.get(instance.id);
    let m: Metrics | null = kept && kept.key === key ? kept.m : null;
    if (!m) {
        try { m = def.measure!(instance, env); } catch (e) { report('error', 'kind-failed', `kind "${instance.kind}": measure failed`, { kind: instance.kind, error: e }); return null; }
        if (!m) return null;
        widgetMeasure.set(instance.id, { key, m: m as InlineMetrics });
    }
    const sp: Sp = v => Math.round((+v! || 0) / SP_TO_PX);
    const part = (dims: Partial<Box>, which: WidgetPart): WidgetNode => ({ type: 'widget', slot: id, part: which, inline, fontPx,
        color: t?.color, width: sp(dims.width), height: sp(dims.height), depth: sp(dims.depth),
        version });
    if (m.segments && m.segments.length) return widgetSegmentNodes(m, slot, id, inline, fontPx, t, version, sp);
    const whole = part(m, 'whole');
    if (!m.splits || !m.splits.length) return [whole];
    // A piece may reach past the margin by its `overhang` (px), as hanging
    // punctuation does: a negative kern after the first piece, which ends a
    // line, and before the second, which starts one, so the text is set to
    // the margin and the piece extends beyond it (a cut-edge mark on it can
    // then sit exactly on the margin).
    const hang = (o: { overhang?: number } | undefined): TexNode[] => o && +o.overhang! ? [{ type: 'kern', subtype: 1, kern: -sp(o.overhang) }] : [];
    return [{ type: 'wdisc', slot: id, replace: [whole],
              options: m.splits.map((s, i) => ({
                  penalty: s.penalty ?? 100,
                  pre:  [part(s.first,  { split: i, piece: 'first'  }), ...hang(s.first)],
                  post: [...hang(s.second), part(s.second, { split: i, piece: 'second' })] })) }];
}

// The segments form: the widget's content as a row of segments, a break
// point between each two, and its ends measured closed ('cap') and cut
// ('cut'). It becomes what a hyphenated word is to TeX – boxes with a
// discretionary between each two, whose pre is the cut end of the line
// before, post the cut end of the line after, and replace the gap shown when
// unbroken – so it may break at any number of its points, one line after
// another. Each line's run of pieces is then drawn as one part
// (mergeWidgetRuns): { from, to, left: 'cap'|'cut', right: 'cap'|'cut' }.
export function widgetSegmentNodes(m: Metrics, slot: Slot, id: number, inline: WidgetInline, fontPx: number, t: TexNode | null,
                                   version: number, sp: Sp): TexNode[] {
    const segs = m.segments!, gaps = m.gaps || [];
    const H = Math.max(...segs.map(g => sp(g.height))), D = Math.max(...segs.map(g => sp(g.depth)));
    const run: WidgetRun = { slot: id, inline, fontPx, color: t?.color, version, merged: new Map(), height: H, depth: D };
    const piece = (role: WidgetNode['role'], w: number, seg: number): WidgetNode => ({ type: 'widget', run, role, seg, width: sp(w), height: H, depth: D });
    const ends = m.ends || {};
    const L: WidgetEnd = ends.left || {}, R: WidgetEnd = ends.right || {};
    const hang = (e: WidgetEnd): TexNode[] => e && +e.overhang! ? [{ type: 'kern', subtype: 1, kern: -sp(e.overhang) }] : [];
    const out: TexNode[] = [piece('capL', L.cap || 0, 0)];
    segs.forEach((g, i) => {
        out.push(piece('seg', g.width, i));
        if (i < segs.length - 1) {
            const gap: { width?: number; penalty?: number } = gaps[i] || {};
            out.push({ type: 'disc', penalty: gap.penalty ?? 100, slot: id,
                       replace: gap.width ? [piece('gap', gap.width, i)] : [],
                       pre:  [piece('cutR', R.cut || 0, i), ...hang(R)],
                       post: [...hang(L), piece('cutL', L.cut || 0, i + 1)] });
        }
    });
    out.push(piece('capR', R.cap || 0, segs.length - 1));
    return out;
}
// One line's consecutive pieces of a segments widget, as one part to draw.
// Kept per run and shape, so an unchanged part keeps its element across
// reflows.
export function mergeWidgetRuns(nodes: TexNode[]): TexNode[] {
    if (!nodes.some(n => (n.type === 'widget' && n.run) || (n.type === 'disc' && n.slot))) return nodes;
    // A break point the line did not break at is its replacement (the gap):
    // unfold it, so the pieces either side join into one part.
    nodes = nodes.flatMap(n => n.type === 'disc' && n.slot ? n.replace : [n]);
    const out: TexNode[] = [];
    for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (!(n.type === 'widget' && n.run)) { out.push(n); continue; }
        let j = i, w = 0;
        while (j < nodes.length && nodes[j].type === 'widget' && (nodes[j] as WidgetNode).run === n.run) { w += nodes[j].width!; j++; }
        const run = nodes.slice(i, j) as WidgetNode[], segs = run.filter(x => x.role === 'seg').map(x => x.seg);
        const part: WidgetPart = { from: segs.length ? Math.min(...segs as number[]) : run[0].seg!, to: segs.length ? Math.max(...segs as number[]) : run[0].seg!,
                       left: run[0].role === 'cutL' ? 'cut' : 'cap',
                       right: run[run.length - 1].role === 'cutR' ? 'cut' : 'cap' };
        const key = `${part.from}|${part.to}|${part.left}|${part.right}|${w}`;
        let merged = n.run.merged.get(key);
        if (!merged) {
            merged = { type: 'widget', slot: n.run.slot, part, inline: n.run.inline,
                       fontPx: n.run.fontPx, color: n.run.color, version: n.run.version,
                       width: w, height: n.run.height, depth: n.run.depth };
            n.run.merged.set(key, merged);
        }
        out.push(merged);
        i = j - 1;
    }
    return out;
}
