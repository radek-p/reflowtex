// SPDX-License-Identifier: AGPL-3.0-or-later

import { I, RUNNING, SP } from './context.ts';
import { entries } from './ids.ts';
import { segParts, surfaceOf } from './resolve.ts';
import { geometry } from './geometry.ts';
import { GLUE_SUB, KERN_SUB, ORDER, affineFields, badnessOf } from './format.ts';
import { gapInfo } from './vspace.ts';
import { children, summary } from './describe.ts';
import type { Pen } from './geometry.ts';
import type { TexNode } from '../../../viewer/src/engine/model.ts';

type Attr = [string, string | number | null | undefined];

// ── As text ────────────────────────────────────────────────────────────────────
// A fragment – a node and everything in it, a line, a vertical space, a
// segment, a block – as compact XML: a run of glyphs in one font is one <t>,
// every other node one element, boxes nest. Dimensions in pt; a glue's `set`
// is the width it came out at here, where that differs from its natural one;
// a width-dependent field carries its rate (`w-rate`, per unit of width).
export const num = (sp: number): string => String(+(sp / 65536).toFixed(3));
export const esc = (s: string): string => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as Record<string, string>)[c]!)
    .replace(/[-]|[\u{F0000}-\u{10FFFF}]/gu, c => `&#x${c.codePointAt(0)!.toString(16).toUpperCase()};`);
export const glyphText = (n: TexNode): string => n.text !== undefined ? n.text : String.fromCodePoint(n.char || 32);
export function attrs(list: Attr[]): string {
    return list.filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => ` ${k}="${esc(String(v))}"`).join('');
}
export const RATE_ATTR: Record<string, string> = { width: 'w', height: 'h', depth: 'd', stretch: 'plus', shrink: 'minus', kern: 'w', shift: 'shift',
                    glue_set: 'set-ratio', surround: 'surround' };
export const rates = (n: TexNode): Attr[] => affineFields(n).filter(f => RATE_ATTR[f]).map(f => [`${RATE_ATTR[f]}-rate`, +(+n[`${f}_rate`]!).toPrecision(4)]);
export const spec = (v: number, order: number | undefined): string => order ? `${+(v / 65536).toFixed(3)}${ORDER[order]}` : num(v);
export function xmlNodes(list: TexNode[], at: Map<TexNode, Pen> | null | undefined, ind: string, out: string[]): void {
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
export function xmlNode(n: TexNode, at: Map<TexNode, Pen> | null | undefined, ind: string, out: string[]): void {
    const p = at && at.get(n);
    const setW = p ? (p.vertical ? p.h : p.w) / SP() : null;
    const R = rates(n);
    switch (n.type) {
        case 'glue': {
            const name = GLUE_SUB[n.subtype!];
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
        case 'widget': out.push(`${ind}<widget${attrs([['name', n.inline && (n.inline.instance.attrs.name || n.inline.instance.kind)], ['w', num(n.width || 0)]])}/>`); return;
        case 'disc': case 'wdisc': {
            const pre = n.pre || [], post = n.post || [], rep = n.replace || [];
            const plain = (l: TexNode[]) => l.every(c => c.type === 'glyph');
            const a: Attr[] = [['penalty', n.penalty]];
            if (plain(pre) && plain(post) && plain(rep)) {    // letters only (a hyphenation point, a dash): one line
                out.push(`${ind}<disc${attrs([['pre', pre.map(glyphText).join('')], ['post', post.map(glyphText).join('')],
                                              ['replace', rep.map(glyphText).join('')], ...a])}/>`);
                return;
            }
            out.push(`${ind}<disc${attrs(a)}>`);
            for (const [k, l] of [['pre', pre], ['post', post], ['replace', rep]] as [string, TexNode[]][]) {
                if (!l.length) continue;
                out.push(`${ind}  <${k}>`); xmlNodes(l, at, ind + '    ', out); out.push(`${ind}  </${k}>`);
            }
            out.push(`${ind}</disc>`);
            return;
        }
        case 'hlist': case 'vlist': case 'transform': {
            const tag = n.type === 'hlist' ? 'hbox' : n.type === 'vlist' ? 'vbox' : 'transform';
            const sign = n.glue_sign === 1 ? '+' : n.glue_sign === 2 ? '-' : '';
            const a: Attr[] = n.type === 'transform'
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
export function textOfNodes(list: TexNode[] | undefined, out: string[]): string[] {
    for (const n of list || []) {
        if (n.type === 'glyph') out.push(glyphText(n));
        else if (n.type === 'glue') { if (out.length && out[out.length - 1] !== ' ') out.push(' '); }
        else if (n.type === 'disc' || n.type === 'wdisc') textOfNodes(n.replace, out);
        else if (n.children) textOfNodes(n.children, out);
    }
    return out;
}
export function textOf(id: number): string {
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
export function xmlOf(id: number, ind = '', out: string[] = []): string[] {
    const e = entries.get(id);
    if (!e) return out;
    const s = summary(id);
    if (e.kind === 'node') {
        const g = e.seg != null ? geometry(e.seg) : null;
        xmlNode(e.n, g && g.at, ind, out);
    } else if (e.kind === 'line') {
        const g = geometry(e.seg), L = g && g.lines[e.j];
        if (!L) return out;
        const laid = segParts(e.seg).laid!, lrp = laid.lrp![e.j], bad = badnessOf(lrp);
        const r = (lrp.fillOrder ? lrp.fillRatio : lrp.ratio)!;
        out.push(`${ind}<line${attrs([['n', e.j + 1], ['glue', `${r >= 0 ? '+' : ''}${+(+r).toFixed(4)}${lrp.fillOrder ? ORDER[lrp.fillOrder] : ''}`],
            ['expansion', lrp.er ? +(lrp.er * 100).toFixed(2) + '%' : null],
            ['badness', laid.seg.kind === 'display' ? null : bad.overfull ? 'overfull' : bad.b]])}>`);
        xmlNodes(L.line.nodes, g!.at, ind + '  ', out);
        out.push(`${ind}</line>`);
    } else if (e.kind === 'vpart') {
        const g = gapInfo(e.gap), p = g && g.parts[e.k];
        if (p) xmlNode(p.n, null, ind, out);
    } else {
        const tag = e.kind === 'block' ? 'block' : e.kind === 'side' ? 'surface' : e.kind === 'seg' ? s.type : 'vspace';
        const a: Attr[] = e.kind === 'block' ? [['width', num(I.state(e.el)!.lastWidth * 65536)]]
                : e.kind === 'seg' ? [['kind', s.type === 'stream' ? s.label.replace(/^stream \((.*)\)$/, '$1') : null]]
                : e.kind === 'side' ? ((sf): Attr[] => [['instance', sf && sf.instance], ['part', sf && sf.role]])(surfaceOf(e.block, e.root))
                : [['total', gapInfo(id) ? num(gapInfo(id)!.totalSp) : null]];
        out.push(`${ind}<${tag}${attrs(a)}>`);
        for (const c of children(id)) xmlOf(c.id, ind + '  ', out);
        out.push(`${ind}</${tag}>`);
    }
    return out;
}
