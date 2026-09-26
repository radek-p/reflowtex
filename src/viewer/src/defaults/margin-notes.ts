// SPDX-License-Identifier: AGPL-3.0-or-later
// ── Margin notes ────────────────────────────────────────────────────────────
// Detached instances with place=margin (\marginpar; \webaside[place=margin])
// go in the right margin, each with its first baseline on the baseline of the
// line its mark is on, in a layer inside the block, so they move with it; one
// close below another is pushed down. Where the window leaves less than
// MARGIN.min beside the block, the note is hidden and its mark becomes a
// small button (.latex-margin-mark) opening it in the footnote popover.
//
// What a note shows is the kind's, as for every placement (host.define): a
// kind the page defines is drawn by its render(instance, host), host.type
// 'margin', host.el the note at the margin's width (its parts mounted at
// 'container' width follow it); the line set on the mark's is the first
// line of its edge surface (host.setEdges; by default a surface of the body
// inside). Else the body is laid out there. A page styles notes by
// .latex-margin-note[data-kind=…], and may set the margin itself, on the
// block, in px: --latex-margin-width (the notes' width, taken as given – 0 for
// marks only) and --latex-margin-gap (from the text); else the margin is what
// the window leaves beside the block, up to MARGIN.max. Placed again after
// every layout, drawing and resize.
import { registerFootnoteSource } from './footnotes.js';
import { allData } from '../runtime/block-data.js';
import { blockOf } from '../host/host.ts';
import { kindDef, onKindChange } from '../host/kinds.ts';
import { surfacesOf, type SurfaceImpl } from '../host/surface.ts';
import type { Instance, KindDef, NoteHost, Surface } from '../host/types.ts';

export const MARGIN = { gap: 28, min: 150, max: 260 };   // px, by default

interface Item {
    note: HTMLElement; mark: HTMLButtonElement;
    width: number;
    def: KindDef | undefined | null;      // what drew it (null: not drawn yet)
    undo: (() => void) | null;
    surface: Surface | null;              // the default drawing's
    edges: { top?: Surface | null };      // the kind's choice (setEdges)
}

function marginHost(it: Item, instance: Instance, again: () => void): NoteHost {
    return {
        type: 'margin', el: it.note, instance,
        setEdges(e) { it.edges = { ...it.edges, ...e }; again(); },
    };
}

function undraw(it: Item) {
    if (it.undo) { try { it.undo(); } catch (e) { console.error('[latex-viewer] margin note:', e); } }
    it.surface?.dispose();
    it.undo = null; it.surface = null; it.edges = {};
    it.note.replaceChildren();
    it.def = null;
}

function draw(it: Item, instance: Instance, width: number, again: () => void) {
    const def = kindDef(instance.kind);
    if (it.def !== null && it.def !== def) undraw(it);     // defined, redefined or undefined since
    if (it.def === null) {
        it.def = def;
        if (def) {
            try {
                const u = def.render(instance, marginHost(it, instance, again));
                it.undo = typeof u === 'function' ? u : null;
                return;
            } catch (e) {
                console.error(`[latex-viewer] kind "${instance.kind}": render failed, drawn by default:`, e);
                it.note.replaceChildren();
            }
        }
        const body = instance.part('body');
        if (body && body.type === 'typeset') it.surface = body.mount(it.note, { width });
    } else if (it.surface && it.width !== width) {
        it.surface.setWidth(width);
    }
}

// The surface whose first line goes on the mark's line.
function edgeOf(it: Item, instance: Instance, blockEl: HTMLElement): Surface | null {
    if (it.edges.top !== undefined) return it.edges.top;
    if (it.surface) return it.surface;
    const body = instance.part('body');
    for (const s of surfacesOf(blockEl) as Iterable<SurfaceImpl>)
        if (s.part === body && it.note.contains(s.el)) return s;
    return null;
}

/** block.destroy: its notes undrawn and their layer gone. */
export function removeMarginNotes(data: any) {
    const M = data && data.margin;
    if (!M) return;
    for (const it of M.items.values()) undraw(it);
    M.layer.remove();
    data.margin = null;
}

export function placeMarginNotes(data: any) {
    const el: HTMLElement | undefined = data && data.el;
    if (!el || !el.isConnected) return;
    const block = blockOf(el);
    const notes = block ? block.instances({ placement: 'detached', place: 'margin' }) : [];
    if (!notes.length) return;
    const again = () => requestAnimationFrame(() => placeMarginNotes(data));
    const M = data.margin = data.margin || { layer: document.createElement('div'), items: new Map<string, Item>() };
    M.layer.className = 'latex-margin';
    if (M.layer.parentNode !== el) el.appendChild(M.layer);
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    const br = el.getBoundingClientRect(), k = br.width / el.offsetWidth || 1;   // CSS zoom above
    const cs = getComputedStyle(el), px = (v: string, d: number | null) => { const n = parseFloat(v); return isFinite(n) ? n : d; };
    const gap = px(cs.getPropertyValue('--latex-margin-gap'), MARGIN.gap)!;
    const set = px(cs.getPropertyValue('--latex-margin-width'), null);
    const room = set !== null ? set : (document.documentElement.clientWidth - br.right) / k - gap;
    const width = Math.floor(Math.min(set !== null ? set : MARGIN.max, room));
    const wide = set !== null ? width > 0 : room >= MARGIN.min;
    const placed: { note: HTMLElement; top: number }[] = [];
    for (const a of notes) {
        let it: Item | undefined = M.items.get(a.id);
        if (!it) {
            const note = document.createElement('div');
            note.className = 'latex-margin-note';
            note.dataset.kind = a.kind;
            const mark = document.createElement('button');
            mark.type = 'button';
            mark.className = 'latex-margin-mark';
            mark.textContent = '*';
            mark.setAttribute('aria-label', 'Note');
            registerFootnoteSource(mark, (a as any).stream);
            it = { note, mark, width: 0, def: null, undo: null, surface: null, edges: {} };
            M.items.set(a.id, it);
            M.layer.append(note, mark);
        }
        const at = a.anchor();
        it.note.hidden = !(wide && at);
        it.mark.hidden = !(!wide && at);
        if (!at) continue;
        const x = (at.left - br.left) / k, y = (at.top - br.top) / k;
        if (!wide) { it.mark.style.left = x + 'px'; it.mark.style.top = y + 'px'; continue; }
        it.note.style.left = el.offsetWidth + gap + 'px';
        it.note.style.width = width + 'px';
        draw(it, a, width, again);
        it.width = width;
        const edge = edgeOf(it, a, el);
        const baseline = edge && edge.el.isConnected
            ? (edge.el.getBoundingClientRect().top - it.note.getBoundingClientRect().top) / k + edge.metrics().firstBaseline
            : 0;
        placed.push({ note: it.note, top: y - baseline });
    }
    placed.sort((p, q) => p.top - q.top);
    let bottom = -Infinity, reach = 0;
    for (const p of placed) {
        const top = Math.max(p.top, bottom);
        p.note.style.top = top + 'px';
        bottom = top + p.note.offsetHeight + 8;
        reach = Math.max(reach, top + p.note.offsetHeight);
    }
    // Notes reaching below the block's text: room for them under it.
    el.style.paddingBottom = '';
    const over = reach - el.offsetHeight;
    el.style.paddingBottom = over > 0 ? Math.ceil(over) + 'px' : '';
}
window.addEventListener('resize', () => { for (const d of allData) if (d.margin) placeMarginNotes(d); });
// A kind (re)defined: the notes are drawn again by it (draw sees the change).
onKindChange(() => { for (const d of allData) if (d.margin) placeMarginNotes(d); });
