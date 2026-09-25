// SPDX-License-Identifier: AGPL-3.0-or-later
// The Resources view: what the blocks draw with. A list on one side – fonts,
// pictures, streams, links, citations, anchors, slots – and the one selected
// on the other (a font's side is a table of its glyphs: font.js). Hovering a
// resource (or a glyph) outlines its uses on the page, and Show in tree
// steps through them in the Boxes view.
import { html, signal, computed, useLayoutEffect, useRef } from '../vendor/preact.js';
import { call, got, MISSING } from './bridge.js';
import { refs, recall, keep, plain, say, IS_MAC } from './store.js';
import { Table, Action, Head, Muted, copyText } from './ui.js';
import { reveal, refresh } from './tree.js';
import { FontDetails } from './font.js';
import { setView } from './app.js';

const CATS = [['fonts', 'Fonts · originals'], ['modifiedFonts', 'Fonts · modified by Reflow TeX'], ['pictures', 'Pictures'],
              ['streams', 'Streams'], ['links', 'Links'], ['citations', 'Citations'], ['anchors', 'Anchors'], ['slots', 'Slots']];

export const resData = signal(null);           // the agent's list, by kind
export const resVersion = signal(0);           // bumped each time it is read again
export const resSel = signal(null);            // the selected resource's key
export const glyphSel = signal(null);          // the selected glyph of a font: { i, key }
export const wantGlyph = signal(null);         // a glyph asked for from elsewhere: { key, cp }
const detail = signal(null);                   // { key, d }: a resource's details (not a font's)
const filter = signal('');
const fontSort = signal(recall('fontsort', 'name', plain) === 'uses' ? 'uses' : 'name');
// Kinds folded away, remembered. While the filter has text, every kind with a
// match is open: a match is never hidden.
const collapsed = signal(new Set(recall('collapsed', [])));
const setCollapsed = set => { collapsed.value = set; keep('collapsed', [...set]); };

export async function loadResources() {
    const r = await call('resources');
    resData.value = got(r) ? r : null;
    resVersion.value++;
    const key = resSel.value;
    if (key && find(key)) { if (!key.startsWith('font:')) loadDetail(key); markUses(); }
    else { resSel.value = null; glyphSel.value = null; }
}
const find = key => resData.value && CATS.some(([c]) => resData.value[c].some(r => r.key === key));
export function forgetResources() { resSel.value = null; glyphSel.value = null; detail.value = null; }

export async function selectResource(key, { scroll = true } = {}) {
    resSel.value = key; glyphSel.value = null;
    if (scroll) scrollTo = key;
    if (!key.startsWith('font:')) loadDetail(key);
    markUses();
}
async function loadDetail(key) {
    const d = await call('resource', key);
    if (resSel.value === key) detail.value = { key, d: got(d) ? d : null };
}
// The selected resource's (or glyph's) uses, outlined on the page (while the
// list is walked with the keyboard: see the panel's selection rule).
export async function markUses() {
    const key = glyphSel.value ? glyphSel.value.key : resSel.value;
    const ids = key ? await call('uses', key) : [];
    await call('mark', ids === MISSING ? null : ids);
}
let hoverKey = null;
export async function hoverUses(key) {
    if (key === hoverKey) return;
    hoverKey = key;
    const ids = key ? await call('uses', key) : null;
    if (hoverKey === key) call('hover', got(ids) && ids.length ? ids : null);
}
// Show in tree: the next of a resource's uses, in the Boxes view.
const cursor = { key: null, k: -1 };
export async function showInTree(key) {
    const ids = await call('uses', key);
    if (!got(ids) || !ids.length) { say('none of it is drawn now'); return; }
    cursor.k = cursor.key === key ? (cursor.k + 1) % ids.length : 0;
    cursor.key = key;
    const path = await call('pathTo', ids[cursor.k]);
    if (!got(path)) return;
    setView('tree');
    await reveal(path);
    say(`use ${cursor.k + 1} of ${ids.length}`);
}
// A glyph in its font's table: Resources, the font selected (its kind opened
// if folded), and the glyph selected there once the table is read.
export async function showGlyph(key, cp) {
    wantGlyph.value = { key, cp };
    await (setView('res') || loadResources());         // (switching to Resources reads them)
    const cat = CATS.map(([c]) => c).find(c => resData.value && resData.value[c].some(r => r.key === key));
    if (cat && collapsed.value.has(cat)) { const s = new Set(collapsed.value); s.delete(cat); setCollapsed(s); }
    selectResource(key);
}
// A footnote's popover, opened by clicking its marker; the marker may have to
// be scrolled to and painted first.
async function openPopover(key) {
    for (let k = 0; k < 8; k++) {
        const r = await call('openPopover', key);
        if (r !== 'wait') { if (r !== 'ok') say('its marker is not drawn'); return r === 'ok'; }
        await new Promise(res => setTimeout(res, 150));
    }
    say('could not open it');
    return false;
}

// ── The list ───────────────────────────────────────────────────────────────────
// Its kinds, each with the rows the filter leaves (fonts by name, or by how
// many glyphs the page sets in each).
const listing = computed(() => {
    const data = resData.value, q = filter.value.trim().toLowerCase(), shut = collapsed.value, byUse = fontSort.value === 'uses';
    if (!data) return null;
    return CATS.map(([cat, title]) => {
        const all = byUse && (cat === 'fonts' || cat === 'modifiedFonts') ? [...data[cat]].sort((a, b) => (b.uses || 0) - (a.uses || 0)) : data[cat];
        const rows = q ? all.filter(r => `${r.label} ${r.note}`.toLowerCase().includes(q)) : all;
        return { cat, title, all, rows, open: !!q || !shut.has(cat) };
    }).filter(k => k.rows.length);
});
const listKeys = computed(() => (listing.value || []).flatMap(k => (k.open ? k.rows.map(r => r.key) : [])));
// A heading's click opens or closes its kind; with ⌥/Alt, shows that kind
// only (or, if it is the only one open already, all of them).
function toggleCat(cat, only) {
    const shut = collapsed.value, present = (listing.value || []).map(k => k.cat);
    if (only) {
        const alone = !shut.has(cat) && present.every(c => c === cat || shut.has(c));
        setCollapsed(new Set(alone ? [] : present.filter(c => c !== cat)));
    } else {
        const s = new Set(shut);
        if (s.has(cat)) s.delete(cat); else s.add(cat);
        setCollapsed(s);
    }
}
let scrollTo = null;

function ResRow({ r, sel }) {
    return html`<div class=${`row rrow c-${r.cat}${r.key === sel ? ' sel' : ''}`} role="option" data-key=${r.key}>
        ${r.cat === 'font' && r.family && !r.unresolved && html`<span class="sample" aria-hidden="true" style=${`font-family:'${r.family}'`}>Ag</span>`}
        <span class="label">${r.label}</span><span class="note">${r.note}</span>
    </div>`;
}
export function ResourceList() {
    const body = useRef(null), kinds = listing.value, sel = resSel.value, q = filter.value.trim();
    useLayoutEffect(() => { refs.rbody = body.current; }, []);
    useLayoutEffect(() => {
        if (scrollTo == null) return;
        const row = body.current.querySelector(`[data-key="${CSS.escape(scrollTo)}"]`);
        scrollTo = null;
        if (row) row.scrollIntoView({ block: 'nearest' });
    });
    const onClick = e => {
        const head = e.target.closest('.rhead');
        if (head) { toggleCat(head.dataset.cat, e.altKey); return; }
        const r = e.target.closest('[data-key]');
        if (r) selectResource(r.dataset.key, { scroll: false });
    };
    // (over a heading, the hover stays as it was, like between glyphs)
    const onMouseMove = e => { const r = e.target.closest('[data-key]'); if (r) hoverUses(r.dataset.key); };
    const onKeyDown = e => {
        const keys = listKeys.value, i = keys.indexOf(resSel.value);
        if (e.key === 'ArrowDown' && i < keys.length - 1) selectResource(keys[i + 1]);
        else if (e.key === 'ArrowUp' && i > 0) selectResource(keys[i - 1]);
        else return;
        e.preventDefault();
    };
    const onFilterKey = e => {
        if (e.key === 'Escape' && filter.value) { e.stopPropagation(); filter.value = ''; }
        else if (e.key === 'ArrowDown') { e.preventDefault(); body.current.focus(); }
    };
    const onSort = e => { fontSort.value = e.currentTarget.value; keep('fontsort', fontSort.value, plain); };
    const alt = IS_MAC ? '⌥' : 'Alt+';
    return html`<section class="rlist">
        <div class="rtools">
            <input type="search" class="filter" placeholder="Filter" aria-label="Filter the resources" spellcheck="false"
                value=${filter.value} onInput=${e => { filter.value = e.currentTarget.value; }} onKeyDown=${onFilterKey}/>
            <select class="fsort" aria-label="Order the fonts" title="Order the fonts" value=${fontSort.value} onChange=${onSort}>
                <option value="name">Fonts by name</option><option value="uses">Fonts by use</option>
            </select>
        </div>
        <div class="rbody" role="listbox" tabindex="0" aria-label="Resources" ref=${body}
                onClick=${onClick} onMouseMove=${onMouseMove} onMouseLeave=${() => hoverUses(null)} onKeyDown=${onKeyDown}>
            ${!kinds ? html`<div class="empty">No inspectable Reflow TeX blocks on this page yet.</div>`
            : !kinds.length ? html`<div class="empty">${q ? 'Nothing matches.' : 'No resources.'}</div>`
            : kinds.map(k => html`
                <button type="button" class="rhead" key=${'h:' + k.cat} data-cat=${k.cat} aria-expanded=${String(k.open)}
                        title=${`${k.open ? 'Hide' : 'Show'} the ${k.title.toLowerCase()} (${alt}click: only these)`}>
                    <span class="twisty">${k.open ? '▾' : '▸'}</span><span class="name">${k.title}</span>
                    <span class="count">${q ? `${k.rows.length} of ${k.all.length}` : k.all.length}</span>
                </button>
                ${k.open && k.rows.map(r => html`<${ResRow} key=${r.key} r=${r} sel=${sel}/>`)}`)}
        </div>
    </section>`;
}

// ── The selected resource ──────────────────────────────────────────────────────
export function ResourceDetails() {
    const key = resSel.value;
    let body;
    if (!key) body = html`<${Muted}>Select a resource. Hovering one outlines where the page uses it.<//>`;
    else if (key.startsWith('font:')) body = html`<${FontDetails} key=${key} fontKey=${key}/>`;
    else {
        const x = detail.value;
        body = !x || x.key !== key ? null : !x.d ? html`<${Muted}>Gone – the page changed.<//>` : html`<${Resource} rkey=${key} d=${x.d}/>`;
    }
    return html`<aside class=${'details rdetails' + (key && key.startsWith('font:') ? ' font' : '')}>${body}</aside>`;
}
function Resource({ rkey, d }) {
    // The drawing, scaled to the panel; its colours are the page's custom
    // properties, with their fallbacks here.
    const svg = d.svg && `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${d.svg.vb_w} ${d.svg.vb_h}" fill="currentColor">${d.svg.markup}</svg>`;
    const svgFile = d.svg && `<svg xmlns="http://www.w3.org/2000/svg" width="${d.svg.vb_w}pt" height="${d.svg.vb_h}pt" viewBox="0 0 ${d.svg.vb_w} ${d.svg.vb_h}">${d.svg.markup}</svg>`;
    const itsBoxes = async () => {
        await openPopover(rkey);
        const path = await call('pathTo', d.side);
        if (got(path)) { setView('tree'); await refresh(); await reveal(path, { openLast: true }); }
    };
    return html`
        <${Head} title=${d.title}>
            <${Action} title="Select its next use in the Boxes view" onClick=${() => showInTree(rkey)}>Show in tree<//>
            ${svg && html`<${Action} title="Copy the drawing as an SVG file" onClick=${() => copyText(svgFile, 'SVG')}>Copy SVG<//>`}
            ${d.footnote && html`
                <${Action} title="Open the footnote as its marker does, pinned" onClick=${() => openPopover(rkey)}>Open popover<//>
                <${Action} title="Show the popover's boxes and glue in the Boxes view" onClick=${itsBoxes}>Its boxes<//>`}
            ${d.text && html`<${Action} title="Copy the stream's text" onClick=${() => copyText(d.text, 'text')}>Copy text<//>`}
        <//>
        ${svg && html`<div class="preview" dangerouslySetInnerHTML=${{ __html: svg }}></div>`}
        <${Table} rows=${d.rows}/>
        ${d.text && html`<h3>${d.textIsCode ? 'Source' : 'Text'}</h3><pre class=${d.textIsCode ? 'code' : 'text'}>${d.text}</pre>`}`;
}
