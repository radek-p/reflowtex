// SPDX-License-Identifier: AGPL-3.0-or-later
// The inspector's panel: one toolbar row like Chrome DevTools' (the picker,
// the overlays, the Boxes and Resources tabs; the dock icons and the close
// button in the corner), the two views, and a bottom bar with the outlines'
// legend and the status. Loaded by inspector.js the first time it opens;
// mount() makes it and hands back what the page's API calls.
import { html, render, useLayoutEffect, useRef } from '../vendor/preact.js';
import { call, got, useAsset, assetUrl } from './bridge.js';
import { isOpen, view, dark, guides, picking, blocks, noViewer, flash, menu, refs, keep, plain, say, SHORTCUT } from './store.js';
import { IconButton, IconPick, IconClose, IconCheck, IconDock, Caret, MenuBox, toggleMenu, closeMenu, menuOpen } from './ui.js';
import { SIDES, SIDE_TITLES, side, embedded, panelStyle, setDock, applyDock, chosenDock, setPageDock, startMove, startSize, resized } from './dock.js';
import { Tree, Details, RowMenu, selected, refresh, reveal, forgetSelection } from './tree.js';
import { ResourceList, ResourceDetails, loadResources, markUses, resSel, forgetResources } from './resources.js';

const TABS = [['tree', 'Boxes', 'Blocks, lines, boxes and glue'],
              ['res', 'Resources', 'Fonts and their glyphs, pictures, streams (footnotes, popovers), links, citations, anchors, slots']];
// The page overlays, in the Overlays menu: [key, label, what it draws].
const OVERLAYS = [
    ['baselines', 'Baselines', 'The baseline of every line'],
    ['badness', 'Badness', 'A bar past every line, coloured by its badness: green decent, amber loose or tight, red 100 or more, purple overfull'],
    ['springs', 'Springs', 'Every display glue whose width is recomputed for the reader\'s width, drawn as a spring'],
];
const LEGEND = [['box, glyph', 'box'], ['glue', 'glue'], ['kern', 'kern'], ['math', 'math'], ['penalty', 'penalty'], ['line', 'line-c']];

// ── Views and overlays ─────────────────────────────────────────────────────────
// The Boxes view's selection leaves the page while Resources is shown –
// hovering a resource would otherwise dim and restore it at every move – and
// comes back with the tree. (Switching to Resources reads them again: the
// promise it answers.)
export function setView(v) {
    if (view.value === v) return null;
    view.value = v;
    keep('view', v, plain);
    const focus = el => requestAnimationFrame(() => el && el.focus({ preventScroll: true }));
    if (v === 'res') { call('select', null); focus(refs.rbody); return loadResources(); }
    call('mark', null);
    if (selected.value != null) call('select', selected.value, { scroll: false });
    focus(refs.tree);
    return null;
}
function setGuide(key, on) {
    guides.value = { ...guides.value, [key]: on };
    keep('guides', guides.value);
    applyGuides();
}
const applyGuides = () => call('setOptions', { ...guides.value });

// Like Chrome's: the page outlines what the pointer is over in the panel, and
// the selection only while it is walked with the keyboard – not while the
// pointer is over a menu, the details or anywhere else.
let showSel = null;
function setShowSel(on) {
    if (on === showSel) return;
    showSel = on;
    call('setOptions', { selection: on });
}
const NAV_KEYS = /^(Arrow(Up|Down|Left|Right)|Home|End|PageUp|PageDown)$/;

// ── The panel ──────────────────────────────────────────────────────────────────
function Toolbar() {
    const g = guides.value, now = side.value;
    return html`<div class="bar" onPointerDown=${startMove}>
        <span class="tools">
            <${IconButton} class=${'pick' + (picking.value ? ' on' : '')} title="Pick a box or glue in the page (Esc cancels)" onClick=${togglePick}>
                <${IconPick}/><//>
            <button type="button" class=${'ib text overlays' + (OVERLAYS.some(([k]) => g[k]) ? ' on' : '')}
                    title="Page overlays: baselines, badness, springs" aria-haspopup="menu" aria-expanded=${String(menuOpen('overlays'))}
                    onClick=${e => toggleMenu('overlays', e.currentTarget)}><span>Overlays</span><${Caret}/></button>
            <span class="sep"></span>
            <span class="tabs" role="tablist">
                ${TABS.map(([v, label, title]) => html`<button type="button" role="tab" key=${v} data-view=${v} title=${title}
                    aria-selected=${String(view.value === v)} onClick=${() => setView(v)}><span>${label}</span></button>`)}
            </span>
        </span>
        <span class="fill"></span>
        <span class="corner">
            <span class="docks" role="group" aria-label="Dock side"><span class="sep"></span>
                ${SIDES.map(m => html`<${IconButton} key=${m} data-dock=${m} title=${SIDE_TITLES[m]} aria-pressed=${String(now === m)}
                    onClick=${() => setDock(m)}><${IconDock} side=${m}/><//>`)}
            </span>
            <${IconButton} class="more" title="Dock side" aria-haspopup="menu" aria-expanded=${String(menuOpen('dock'))}
                onClick=${e => toggleMenu('dock', e.currentTarget)}><${IconDock} side=${now}/><${Caret}/><//>
            <${IconButton} class="close" title=${`Close (${SHORTCUT})`} onClick=${close}><${IconClose}/><//>
        </span>
    </div>`;
}
// Chrome's checkmark menu (like the Console's levels): a click toggles, and
// the menu stays open for the next.
function OverlaysMenu() {
    const g = guides.value;
    return html`<${MenuBox} label="Page overlays">
        ${OVERLAYS.map(([key, label, title]) => html`<button type="button" role="menuitemcheckbox" key=${key} data-overlay=${key}
                title=${title} aria-checked=${String(!!g[key])} onClick=${() => setGuide(key, !g[key])}>
            <span class="check"><${IconCheck}/></span><span class="label">${label}</span></button>`)}
    <//>`;
}
// Chrome's "Dock side", for a panel too narrow to show the icons.
function DockMenu() {
    const now = side.value;
    return html`<${MenuBox} label="Dock side">
        <div class="mrow"><span class="label">Dock side</span>
            <span class="docks" role="group" aria-label="Dock side">
                ${SIDES.map(m => html`<${IconButton} key=${m} data-dock=${m} title=${SIDE_TITLES[m]} aria-pressed=${String(now === m)}
                    onClick=${() => { closeMenu(); setDock(m); }}><${IconDock} side=${m}/><//>`)}
            </span>
        </div>
    <//>`;
}
function Menus() {
    const m = menu.value;
    if (!m) return null;
    if (m.kind === 'overlays') return html`<${OverlaysMenu}/>`;
    if (m.kind === 'dock') return html`<${DockMenu}/>`;
    if (m.kind === 'row') return html`<${RowMenu} id=${m.id}/>`;
    return null;
}
// The bottom bar: what the outlines' colours mean, and what is going on.
function Foot() {
    const n = blocks.value;
    const status = picking.value ? 'click in the page · Esc cancels'
        : flash.value || (noViewer.value ? 'no inspectable viewer' : n == null ? '' : `${n} block${n === 1 ? '' : 's'}`);
    return html`<div class="foot">
        <div class="legend">${LEGEND.map(([name, c]) => html`<span class="key" key=${name}>
            <span class="sw" style=${`border-color:var(--${c});background:var(--${c})`}></span>${name}</span>`)}</div>
        <span class="status">${status}</span>
    </div>`;
}
function Panel() {
    const el = useRef(null), s = side.value, emb = embedded.value;
    useLayoutEffect(() => {
        refs.root = el.current;
        const ro = new ResizeObserver(() => resized(el.current));
        ro.observe(el.current);
        return () => ro.disconnect();
    }, []);
    // (a press outside the open menu closes it)
    const onPointerDownCapture = e => { if (menu.value && !e.target.closest('.menu')) closeMenu(); };
    const onKeyDownCapture = e => {
        if (NAV_KEYS.test(e.key) && e.composedPath().some(x => x === refs.tree || x === refs.rbody)) setShowSel(true);
    };
    // The style is bound to its signal: dragging the panel restyles it
    // without rendering anything else again.
    return html`<div ref=${el} role="dialog" aria-label="Reflow TeX inspector" hidden=${!isOpen.value}
            class=${'rtx' + (dark.value ? ' dark' : '') + (emb ? ' docked' : '')}
            data-view=${view.value} data-edge=${emb || s === 'float' ? undefined : s} style=${panelStyle}
            onPointerMove=${() => setShowSel(false)} onPointerDownCapture=${onPointerDownCapture} onKeyDownCapture=${onKeyDownCapture}>
        <${Toolbar}/>
        <div class="main"><${Tree}/><${Details}/><${ResourceList}/><${ResourceDetails}/></div>
        <${Foot}/>
        <div class="grip" aria-hidden="true" onPointerDown=${startSize}></div>
        <${Menus}/>
    </div>`;
}

// ── Following the page ─────────────────────────────────────────────────────────
// Dark when the page is: its background's luminance decides.
function syncTheme() {
    const bg = c => { const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(c); return m && (m[4] === undefined || +m[4] > 0) ? m : null; };
    const m = bg(getComputedStyle(document.body).backgroundColor) || bg(getComputedStyle(document.documentElement).backgroundColor);
    dark.value = m ? (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) < 110 : matchMedia('(prefers-color-scheme: dark)').matches;
}
async function togglePick() {
    const st = await call('status');
    if (!got(st)) return;
    await call(st.picking ? 'cancelPick' : 'pick');
    poll();
}
// A pick made in the page, blocks that come or go, and the page's theme are
// noticed by polling while the panel is open.
let pollTimer = 0, lastPickSeq = 0;
async function poll() {
    if (!isOpen.value) return;
    syncTheme();
    const st = await call('status');
    noViewer.value = !got(st);
    if (!got(st)) { picking.value = false; return; }
    picking.value = st.picking;
    // Blocks that start (or go) after the panel opened: the tree, and the
    // resources they bring, follow without being asked.
    if (blocks.value !== null && st.blocks !== blocks.value) { followReflow(); if (view.value === 'res') loadResources(); }
    blocks.value = st.blocks;
    if (st.picked && st.picked.seq !== lastPickSeq) { lastPickSeq = st.picked.seq; setView('tree'); reveal(st.picked.path); }
}
// A reflow – the window resized, a width that changes on its own – repaints
// the viewer's segments; the paint counter says so. Checked every frame while
// the panel is open, so the rows, the details and the outlines follow the
// text as it moves. One refresh at a time; one more if the layout moved
// meanwhile.
let lastPaints = null, refreshing = false, again = false;
function watchPaints() {
    if (!isOpen.value) return;
    const p = window.reflowtex && window.reflowtex.inspect && window.reflowtex.inspect.paints;
    if (p !== undefined && p !== lastPaints) {
        const first = lastPaints === null;
        lastPaints = p;
        if (!first) followReflow();
    }
    requestAnimationFrame(watchPaints);
}
async function followReflow() {
    if (refreshing) { again = true; return; }
    refreshing = true;
    try {
        do { again = false; await refresh(); if (view.value === 'res' && resSel.value) await markUses(); await call('redraw'); } while (again);
    } finally { refreshing = false; }
}

// ── Opening and closing ────────────────────────────────────────────────────────
let host = null;
async function open(block, { dock: where, scroll = true } = {}) {
    if (where) setPageDock(where);
    if (!isOpen.value) {
        // Last in the document, so nothing added since stacks above it.
        if (!embedded.value && host !== document.documentElement.lastElementChild) document.documentElement.appendChild(host);
        if (!embedded.value) applyDock(chosenDock());
        isOpen.value = true;
        syncTheme();
        pollTimer = setInterval(poll, 400);
        showSel = null; setShowSel(false);
        blocks.value = null;
        try { await refresh(); } catch (e) { say(String(e.message || e), 10000); return; }
        if (view.value === 'res') loadResources();
        applyGuides();
        lastPaints = null;
        requestAnimationFrame(watchPaints);
        poll();
    }
    if (block) {
        setView('tree');
        // The block may still be initialising (fonts, first layout): wait a little.
        let path = null;
        for (let k = 0; k < 40 && !(path = await call('blockPath', block)); k++) await new Promise(r => setTimeout(r, 150));
        if (got(path)) await reveal(path, { openLast: true, page: scroll });
    }
    if (!embedded.value) requestAnimationFrame(() => refs.tree && refs.tree.focus({ preventScroll: true }));
}
function close() {
    if (!isOpen.value || embedded.value) return;
    isOpen.value = false;
    clearInterval(pollTimer);
    closeMenu();
    call('cancelPick'); call('clear'); call('setOptions', { baselines: false, badness: false, springs: false });
    forgetSelection();
    forgetResources();
}
const toggle = () => (embedded.value ? refs.tree && refs.tree.focus() : isOpen.value ? close() : open());
// Part of the page rather than over it: inside `container`, filling it, open
// for good – no dragging, no closing, and the shortcut only focuses it.
async function embed(container, block) {
    embedded.value = true;
    // Its own stacking layer within the page, above the outlines it draws.
    host.style.cssText = 'display:block;position:relative;z-index:2147483647;width:100%;height:100%';
    container.appendChild(host);
    await open(block);
}

// ── Making it ──────────────────────────────────────────────────────────────────
export function mount({ asset }) {
    useAsset(asset);
    host = document.createElement('div');
    host.setAttribute('data-rtx-ui', '');
    // A stacking layer of its own, on top: above the page, and above the
    // agent's outlines (z-index one lower, and inserted before this).
    host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647';
    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = assetUrl('inspector.css');
    const into = document.createElement('div');
    into.style.display = 'contents';
    shadow.append(style, into);
    document.documentElement.appendChild(host);
    // Clicks in the panel are the panel's: the page does not hear them, so a
    // popover it has pinned open (closed by a click elsewhere) stays open
    // while the panel inspects it.
    host.addEventListener('click', e => e.stopPropagation());
    // Esc, with the focus in the panel, closes it – but not while picking
    // (the agent's Esc cancels the pick), with a menu open, or in a search
    // field (where it clears the field).
    addEventListener('keydown', e => {
        if (e.key === 'Escape' && isOpen.value && document.activeElement === host && !picking.value && !menu.value
            && !(e.composedPath()[0] instanceof HTMLInputElement)) close();
    }, true);
    render(html`<${Panel}/>`, into);
    return { open, close, toggle, setDock, dock: embed };
}
