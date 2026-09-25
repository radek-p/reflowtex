// SPDX-License-Identifier: AGPL-3.0-or-later
// The Boxes view: the tree of blocks, segments, lines, boxes and glue as the
// agent reports them, and the selected node's details.
//
// The rows are keyed by node id, so when the text reflows (a resize, or a
// width that changes on its own) only the rows whose numbers changed are
// touched: no flicker, and a press on a row lands on the row it began on.
import { html, signal, computed, useLayoutEffect, useRef } from '../vendor/preact.js';
import { call, got, MISSING } from './bridge.js';
import { refs, menu, COPY_KEY } from './store.js';
import { Table, Action, Head, Muted, MenuBox, IconPick, closeMenu, copyText } from './ui.js';
import { showGlyph } from './resources.js';

// ── The model ──────────────────────────────────────────────────────────────────
const nodes = new Map();          // id → { s: the agent's summary, kids: [id] | null, open }
let roots = [];
const version = signal(0);        // bumped whenever `nodes` or `roots` change
const bump = () => { version.value++; };
const empty = signal(null);       // why there is no tree: 'viewer' | 'none' | null
export const selected = signal(null);
const details = signal(null);     // { id, d }: the selected node's details (d null: gone)
let scrollTo = null;              // a row to bring into view once it is drawn

const remember = list => list.map(s => {
    const n = nodes.get(s.id);
    if (n) n.s = s; else nodes.set(s.id, { s, kids: null, open: false });
    return s.id;
});
async function loadKids(id) { nodes.get(id).kids = remember(await call('children', id) || []); }

// The blocks again, and every open branch below them: after a reflow, or
// when blocks come or go.
export async function refresh() {
    const list = await call('blocks');
    if (list === MISSING) { roots = []; nodes.clear(); empty.value = 'viewer'; bump(); return; }
    empty.value = list.length ? null : 'none';
    roots = remember(list);
    const walk = async ids => {
        for (const id of ids) {
            const n = nodes.get(id);
            if (n && n.open && n.s.hasChildren) { await loadKids(id); await walk(n.kids); }
            else if (n) n.kids = null;
        }
    };
    await walk(roots);
    bump();
    if (selected.value != null) loadDetails(selected.value);
}
export async function toggle(id, open) {
    const n = nodes.get(id);
    if (!n || !n.s.hasChildren) return;
    open = open ?? !n.open;
    if (open && !n.kids) await loadKids(id);
    n.open = open;
    bump();
}
// `scroll`: the row into view; `page: false` leaves the page where it is,
// even if the node is off screen.
export async function select(id, { scroll = true, page = true } = {}) {
    selected.value = id;
    if (scroll) scrollTo = id;
    await call('select', id, { scroll: page });
    loadDetails(id);
}
// Expand along a path (block → … → node) and select its end.
export async function reveal(path, { openLast = false, page = true } = {}) {
    if (!path || !path.length) return;
    if (!roots.includes(path[0])) await refresh();
    for (const id of openLast ? path : path.slice(0, -1)) {
        const n = nodes.get(id);
        if (!n) return;
        if (n.s.hasChildren) { if (!n.kids) await loadKids(id); n.open = true; }
    }
    bump();
    await select(path[path.length - 1], { page });
}
async function loadDetails(id) {
    const d = await call('details', id);
    if (selected.value === id) details.value = { id, d: got(d) ? d : null };
}
export function forgetSelection() { selected.value = null; details.value = null; }
export async function copyXml(id) {
    if (id == null) return;
    const text = await call('xml', id);
    if (typeof text === 'string') copyText(text, 'XML');
}

// ── The rows ───────────────────────────────────────────────────────────────────
// The open tree, flattened: one entry per row. Consecutive plain glyphs – a
// word, as TeX set it, between its kerns and glue – share one row, letter by
// letter; each letter is still a node of its own to hover and select. A
// hyphenation point (a discretionary with nothing to show unbroken) sits
// among them as a marked chip; any other discretionary – an explicit dash, a
// ligature – ends the run.
const rows = computed(() => {
    version.value;
    const out = [];
    const plainGlyph = id => { const n = nodes.get(id); return n && n.s.type === 'glyph' && !n.s.hasChildren; };
    const hyphen = id => { const n = nodes.get(id); return n && n.s.point === true; };
    const emit = (id, depth) => {
        const n = nodes.get(id);
        if (!n) return;
        out.push({ key: id, id, n, depth });
        if (n.open && n.kids) emitKids(n.kids, depth + 1);
    };
    const emitKids = (kids, depth) => {
        for (let i = 0; i < kids.length;) {
            let j = i, letters = 0;
            while (j < kids.length && (plainGlyph(kids[j]) || hyphen(kids[j]))) { if (plainGlyph(kids[j])) letters++; j++; }
            if (j - i >= 2 && letters >= 1) { out.push({ key: 'run' + kids[i], ids: kids.slice(i, j), depth }); i = j; }
            else emit(kids[i++], depth);
        }
    };
    for (const r of roots) emit(r, 0);
    return out;
});
// Every selectable thing in row order: a node row, or one letter of a run.
const order = computed(() => rows.value.flatMap((item, row) =>
    item.ids ? item.ids.map((id, k) => ({ id, row, k, run: item.ids })) : [{ id: item.id, row }]));
const firstOf = item => (item.ids ? item.ids[0] : item.id);
const indent = depth => `padding-left:${4 + depth * 14}px`;

function Row({ item, sel }) {
    const { id, n, depth } = item, s = n.s;
    return html`<div class=${`row t-${s.type}${id === sel ? ' sel' : ''}${s.drawn === false ? ' undrawn' : ''}`}
            role="treeitem" data-id=${id} aria-expanded=${s.hasChildren ? String(!!n.open) : undefined} style=${indent(depth)}>
        <span class="twisty">${s.hasChildren ? (n.open ? '▾' : '▸') : ''}</span>
        <span class="label">${s.label}</span>
        ${s.affine && html`<span class="affine" title=${`Width-dependent: ${s.affine.join(', ')} recomputed for the reader's width – see the details`}>↔</span>`}
        <span class="note">${s.note}</span>
    </div>`;
}
function Run({ item, sel }) {
    const fonts = new Set();
    let letters = 0;
    const chips = item.ids.map(id => {
        const s = nodes.get(id).s, hyphen = s.point === true, m = /^font (\S+)/.exec(s.note);
        if (m) fonts.add(m[1]);
        if (!hyphen) letters++;
        return html`<span key=${id} class=${'chip' + (hyphen ? ' disc' : '') + (id === sel ? ' sel' : '') + (s.drawn === false ? ' undrawn' : '')}
                role="treeitem" data-id=${id} title=${`${s.label}  ${s.note}`}>${hyphen ? '-' : s.label.replace(/^‘(.*)’$/su, '$1')}</span>`;
    });
    const hyphens = item.ids.length - letters;
    return html`<div class="row run t-glyph" role="group" style=${indent(item.depth)}>
        <span class="twisty"></span><span class="chips">${chips}</span>
        <span class="note">${`${letters} glyph${letters === 1 ? '' : 's'}`
            + (hyphens ? ` · ${hyphens} hyphenation point${hyphens === 1 ? '' : 's'}` : '')
            + (fonts.size ? ` · font ${[...fonts].join(', ')}` : '')}</span>
    </div>`;
}

// ── The tree ───────────────────────────────────────────────────────────────────
let hoverKey = null;
export function Tree() {
    const el = useRef(null), sel = selected.value;
    useLayoutEffect(() => { refs.tree = el.current; }, []);
    useLayoutEffect(() => {                   // a selection made from elsewhere, in view
        if (scrollTo == null) return;
        const row = el.current.querySelector(`[data-id="${scrollTo}"]`);
        scrollTo = null;
        if (row) row.scrollIntoView({ block: 'nearest' });
    });
    const rowEl = id => el.current.querySelector(`[data-id="${id}"]`);
    // A press selects (a second in quick succession, or one on the twisty,
    // opens or closes), like Chrome's Elements tree.
    const onMouseDown = e => {
        if (e.button !== 0) return;
        const r = e.target.closest('[data-id]');
        if (!r) return;
        const id = +r.dataset.id;
        if (e.target.classList.contains('twisty') || e.detail === 2) toggle(id); else select(id, { scroll: false });
    };
    // A letter hovers that glyph; the rest of a run's row, all its letters.
    const onMouseMove = e => {
        const one = e.target.closest('[data-id]'), run = !one && e.target.closest('.row.run');
        const id = one ? +one.dataset.id : run ? [...run.querySelectorAll('[data-id]')].map(c => +c.dataset.id) : null;
        const key = JSON.stringify(id);
        if (key !== hoverKey) { hoverKey = key; call('hover', id); }
    };
    const onMouseLeave = () => { hoverKey = null; call('hover', null); };
    // A right click selects the row and offers to copy it: the panel's own
    // menu, so it can say what it copies.
    const onContextMenu = e => {
        const r = e.target.closest('[data-id]');
        if (!r) return;
        e.preventDefault();
        const id = +r.dataset.id;
        select(id, { scroll: false });
        menu.value = { kind: 'row', id, x: e.clientX, y: e.clientY };
    };
    // Up and Down go row by row (a run of letters is one row); Right and Left
    // open and close, and within a run step from letter to letter.
    const onKeyDown = e => {
        const id = selected.value;
        if ((e.metaKey || e.ctrlKey) && e.key === 'c' && id != null) { e.preventDefault(); copyXml(id); return; }
        if ((e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) && id != null) {
            e.preventDefault();
            const r = rowEl(id), b = r && r.getBoundingClientRect();
            if (b) menu.value = { kind: 'row', id, x: b.left + 24, y: b.bottom };
            return;
        }
        const list = order.value, items = rows.value, me = list.find(o => o.id === id);
        if (e.key === 'ArrowDown') {
            const next = list.find(o => !me || o.row > me.row);
            if (next) select(next.id);
        } else if (e.key === 'ArrowUp') {
            if (me && me.row > 0) select(firstOf(items[me.row - 1]));
        } else if (e.key === 'ArrowRight' && me) {
            if (me.run) { if (me.k < me.run.length - 1) select(me.run[me.k + 1]); }
            else toggle(id, true);
        } else if (e.key === 'ArrowLeft' && me) {
            const n = nodes.get(id);
            if (me.run && me.k > 0) select(me.run[me.k - 1]);
            else if (!me.run && n && n.open) toggle(id, false);
            else {                                         // to the parent row
                const depth = items[me.row].depth;
                for (let r = me.row - 1; r >= 0; r--) if (items[r].depth < depth) { select(firstOf(items[r])); break; }
            }
        } else return;
        e.preventDefault();
    };
    const why = empty.value;
    return html`<section class="tree" role="tree" tabindex="0" aria-label="Boxes and glue" ref=${el}
            onMouseDown=${onMouseDown} onMouseMove=${onMouseMove} onMouseLeave=${onMouseLeave}
            onContextMenu=${onContextMenu} onKeyDown=${onKeyDown} onScroll=${closeMenu}>
        ${why === 'viewer' ? html`<div class="empty">No inspectable Reflow TeX blocks on this page yet. The viewer must
                have <code>reflowtex.inspect</code> (see the viewer README, “Inspection”).</div>`
        : why === 'none' ? html`<div class="empty">No blocks on this page yet.</div>`
        : rows.value.map(item => item.ids
            ? html`<${Run} key=${item.key} item=${item} sel=${sel}/>`
            : html`<${Row} key=${item.key} item=${item} sel=${sel}/>`)}
    </section>`;
}

// ── The details ────────────────────────────────────────────────────────────────
// The same node again after a reflow: new values in the same table, the same
// buttons – a click on one is not lost to a refresh between press and release.
export function Details() {
    const x = details.value;
    if (selected.value == null || !x) return html`<aside class="details">
        <${Muted}>Select a row, or pick a box or glue in the page with <${IconPick}/>.<//></aside>`;
    const { id, d } = x;
    if (!d) return html`<aside class="details"><${Muted}>Gone – the layout changed.<//></aside>`;
    return html`<aside class="details">
        <${Head} title=${`${d.summary.label}  ${d.summary.note}`}>
            ${d.glyph && html`<${Action} title=${`Show it in the glyph table of ${d.glyph.font} (Resources)`}
                onClick=${() => showGlyph(d.glyph.key, d.glyph.cp)}>In its font<//>`}
            <${Action} title=${`Copy this fragment – all it holds – as XML (${COPY_KEY} in the tree)`} onClick=${() => copyXml(id)}>Copy XML<//>
        <//>
        <${Table} rows=${d.rows}/>
    </aside>`;
}

// ── The row menu ───────────────────────────────────────────────────────────────
export function RowMenu({ id }) {
    const s = nodes.get(id) && nodes.get(id).s;
    const item = (label, hint, act) => html`<button type="button" role="menuitem"
            onClick=${async () => { closeMenu(); await act(); refs.tree.focus({ preventScroll: true }); }}>
        <span>${label}</span><span class="hint">${hint}</span></button>`;
    return html`<${MenuBox} label="Copy">
        ${item('Copy XML', COPY_KEY, () => copyXml(id))}
        ${item('Copy text', 'the characters', async () => { const t = await call('text', id); copyText(typeof t === 'string' ? t : '', 'text'); })}
        ${item('Copy row', s ? s.label : '', () => copyText(s ? `${s.label}  ${s.note}`.trim() : '', 'the row'))}
    <//>`;
}
