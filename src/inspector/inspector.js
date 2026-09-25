// SPDX-License-Identifier: AGPL-3.0-or-later
// Reflow TeX inspector – a floating panel that shows the boxes and glue
// behind the blocks on the page (see README.md).
//
// Include it after latex-viewer.js. It costs nothing until opened: the
// panel, its stylesheet and the page agent (agent.js, loaded from beside this
// file) are made on first use. Open it with Alt+Shift+I (⌥⇧I on a Mac), or
// from a page's own controls through window.reflowtex.inspector:
//
//   reflowtex.inspector.open(blockEl?, { dock }?)
//                                        open; with a block, show that block.
//                                        `dock` is where this page would have
//                                        it: 'left', 'right', 'bottom',
//                                        'float', or 'auto' (right, or bottom
//                                        in a portrait window). The reader's
//                                        own choice, once made, wins.
//                                        `scroll: false` leaves the page where
//                                        it is (opening as the page loads).
//   reflowtex.inspector.setDock(mode)    dock to an edge of the window, or float
//   reflowtex.inspector.close()
//   reflowtex.inspector.toggle()
//   reflowtex.inspector.dock(el, block?) put the panel inside el, open for
//                                        good
//   reflowtex.inspector.shortcut         the shortcut's label, for a tooltip
(() => {
const api = window.reflowtex = window.reflowtex || {};
if (api.inspector) return;

const SELF = document.currentScript && document.currentScript.src;
// A file beside this one, with this one's ?v= cache-buster.
function asset(name) {
    const u = new URL(name, SELF || location.href);
    if (SELF) u.search = new URL(SELF).search;
    return u.href;
}
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const SHORTCUT = IS_MAC ? '⌥⇧I' : 'Alt+Shift+I';
const STORE = 'reflowtex-inspector';

// ── The page agent ─────────────────────────────────────────────────────────────
// The agent this panel needs (agent.js's AGENT) or a newer one. An older one
// already in the page – installed by another copy of the panel, or served
// from a stale cache – is replaced: agent.js is loaded again, with a query of
// its own so no cache can hand back the old file.
const AGENT = 4;
let agentLoading = null, agentRetried = false;
function loadAgent() {
    const a = window.__rtxInspector;
    if (window.__rtxInspectorInstall && (!a || a.agent >= AGENT)) return Promise.resolve();
    if (a && agentRetried) return Promise.resolve();      // tried once: make do
    const fresh = !!window.__rtxInspectorInstall;
    return agentLoading = agentLoading || new Promise((resolve, reject) => {
        const s = document.createElement('script');
        const u = new URL(asset('agent.js'));
        if (fresh) { agentRetried = true; u.searchParams.set('agent', AGENT + '-' + Date.now()); }
        s.src = u.href;
        s.onload = () => { agentLoading = null; resolve(); };
        s.onerror = () => { agentLoading = null; reject(new Error('could not load the inspector agent')); };
        document.head.appendChild(s);
    });
}
const MISSING = Symbol('missing');
async function call(method, ...args) {
    await loadAgent();
    let a = window.__rtxInspector;
    if ((!a || a.agent < AGENT) && window.__rtxInspectorInstall() === 'ok') a = window.__rtxInspector;
    if (a && typeof a[method] !== 'function') {
        $.status.textContent = `the page's inspector agent is older than this panel (${a.agent}, needs ${AGENT}): reload the page`;
        return MISSING;
    }
    return a ? a[method](...args) : MISSING;
}

// ── The panel ──────────────────────────────────────────────────────────────────
// `docked`: inside a page's element (dock()). `edge`: docked to an edge of the
// window – 'left', 'right' or 'bottom' – or null while it floats.
let host = null, root = null, $ = null, isOpen = false, docked = false, edge = null, pollTimer = 0;
const h = (tag, props = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (k === 'class') el.className = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v);
    }
    el.append(...kids);
    return el;
};
// The toolbar's icons, drawn like Chrome DevTools' (16px on a 20px grid).
const icon = (body, size = 16) => `<svg viewBox="0 0 20 20" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`;
// Chrome's "Select an element in the page": a box, and the pointer going in.
const ICON_PICK = icon('<path d="M8.5 16.5h-4a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 10l8 3.1-3.3 1.4-1.4 3.4z" fill="currentColor"/>');
const ICON_CARET = '<svg viewBox="0 0 8 8" width="8" height="8" aria-hidden="true"><path d="M1 2.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
const ICON_CLOSE = icon('<path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>');
const ICON_CHECK = icon('<path d="M4.5 10.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>', 14);
// Chrome's "Dock side" icons: a window, with the panel's place filled in.
const dockIcon = fill => icon(`<rect x="2.5" y="3.5" width="15" height="13" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/>${fill}`);
const DOCK_ICONS = {
    float: dockIcon('<rect x="6" y="7" width="8" height="6" rx="1" fill="currentColor"/>'),
    left: dockIcon('<rect x="3" y="4" width="5.5" height="12" fill="currentColor"/>'),
    bottom: dockIcon('<rect x="3" y="10" width="14" height="6" fill="currentColor"/>'),
    right: dockIcon('<rect x="11.5" y="4" width="5.5" height="12" fill="currentColor"/>'),
};
const DOCK_TITLES = { float: 'Float over the page', left: 'Dock to left', bottom: 'Dock to bottom', right: 'Dock to right' };
// The page overlays, in the overlays menu: [key, label, what it draws].
const OVERLAYS = [
    ['baselines', 'Baselines', 'The baseline of every line'],
    ['badness', 'Badness', 'A bar past every line, coloured by its badness: green decent, amber loose or tight, red 100 or more, purple overfull'],
    ['springs', 'Springs', 'Every display glue whose width is recomputed for the reader\'s width, drawn as a spring'],
];

function build() {
    host = document.createElement('div');
    host.setAttribute('data-rtx-ui', '');
    // A stacking layer of its own, on top: above the page, and above the
    // agent's outlines (z-index one lower, and inserted before this).
    host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.appendChild(h('link', { rel: 'stylesheet', href: asset('inspector.css') }));
    // One row, like Chrome's: the page tools, the tabs, and – always in the
    // corner, however narrow the panel – its menu and the close button.
    const iconButton = (cls, svg, title, onclick, extra = {}) => {
        const b = h('button', { type: 'button', class: 'ib ' + cls, title, 'aria-label': title, onclick, ...extra });
        b.innerHTML = svg;
        return b;
    };
    const pick = iconButton('pick', ICON_PICK, 'Pick a box or glue in the page (Esc cancels)', togglePick);
    // A text dropdown, like the Console's "Default levels".
    const overlays = h('button', { type: 'button', class: 'ib text overlays', title: 'Page overlays: baselines, badness, springs',
                                   'aria-haspopup': 'menu', 'aria-expanded': 'false',
                                   onclick: e => toggleMenu(e.currentTarget, overlaysMenu) }, h('span', {}, 'Overlays'));
    overlays.insertAdjacentHTML('beforeend', ICON_CARET);
    // Two views: the tree of boxes and glue, and the resources they draw with.
    const tab = (v, label, title) => h('button', { type: 'button', role: 'tab', 'data-view': v, title, onclick: () => setView(v) }, h('span', {}, label));
    const tabs = h('span', { class: 'tabs', role: 'tablist' },
        tab('tree', 'Boxes', 'Blocks, lines, boxes and glue'),
        tab('res', 'Resources', 'Fonts and their glyphs, pictures, streams (footnotes, popovers), links, citations, anchors, slots'));
    const status = h('span', { class: 'status' });
    // Where it docks, in plain sight; folded into one button (the current
    // place, opening Chrome's "Dock side" menu) when the panel is too narrow.
    const docks = h('span', { class: 'docks', role: 'group', 'aria-label': 'Dock side' },
        h('span', { class: 'sep' }),
        ...['float', 'left', 'bottom', 'right'].map(m =>
            iconButton('', DOCK_ICONS[m], DOCK_TITLES[m], () => setDock(m), { 'data-dock': m, 'aria-pressed': 'false' })));
    const more = iconButton('more', DOCK_ICONS.float + ICON_CARET, 'Dock side',
                            e => toggleMenu(e.currentTarget, moreMenu), { 'aria-haspopup': 'menu', 'aria-expanded': 'false' });
    const close = iconButton('close', ICON_CLOSE, `Close (${SHORTCUT})`, () => closePanel());
    const bar = h('div', { class: 'bar' },
        h('span', { class: 'tools' }, pick, overlays, h('span', { class: 'sep' }), tabs),
        h('span', { class: 'fill' }), h('span', { class: 'corner' }, docks, more, close));
    // The bottom bar: what the outlines' colours mean, and what is going on.
    const foot = h('div', { class: 'foot' }, legend(), status);
    const tree = h('section', { class: 'tree', role: 'tree', tabindex: '0', 'aria-label': 'Boxes and glue' });
    const details = h('aside', { class: 'details' });
    const filter = h('input', { type: 'search', class: 'filter', placeholder: 'Filter', 'aria-label': 'Filter the resources', spellcheck: 'false' });
    const rbody = h('div', { class: 'rbody', role: 'listbox', tabindex: '0', 'aria-label': 'Resources' });
    // fonts by name, or by how many glyphs the page sets in each – remembered
    const fontSort = h('select', { class: 'fsort', 'aria-label': 'Order the fonts', title: 'Order the fonts' },
        h('option', { value: 'name' }, 'Fonts by name'), h('option', { value: 'uses' }, 'Fonts by use'));
    const rlist = h('section', { class: 'rlist' }, h('div', { class: 'rtools' }, filter, fontSort), rbody);
    const rdetails = h('aside', { class: 'details rdetails' });
    // Docked to an edge, the side facing the page is dragged to resize.
    const grip = h('div', { class: 'grip', 'aria-hidden': 'true' });
    root = h('div', { class: 'rtx', role: 'dialog', 'aria-label': 'Reflow TeX inspector' }, bar, h('div', { class: 'main' }, tree, details, rlist, rdetails), foot, grip);
    root.hidden = true;
    shadow.appendChild(root);
    document.documentElement.appendChild(host);
    // Clicks in the panel are the panel's: the page does not hear them, so a
    // popover it has pinned open (closed by a click elsewhere) stays open
    // while the panel inspects it.
    host.addEventListener('click', e => e.stopPropagation());
    $ = { pick, overlays, status, tree, details, bar, tabs, filter, fontSort, rbody, rdetails, grip, docks, more };
    root.addEventListener('pointermove', () => setShowSel(false));
    root.addEventListener('keydown', e => {
        if (NAV_KEYS.test(e.key) && e.composedPath().some(el => el === $.tree || el === $.rbody)) setShowSel(true);
    }, true);
    placeholder();
    wireTree();
    wireResources();
    wireMove();
    setView(loadView(), { quiet: true });
}

// Where the panel sits and how big it is: remembered per browser, clamped to
// the viewport. By default, the bottom right corner – above where a page
// tends to keep a floating button of its own.
function loadGeometry() {
    let g = null;
    try { g = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch { g = null; }
    const vw = innerWidth, vh = innerHeight;
    const w = Math.min(g && g.w || 620, vw - 16), ht = Math.min(g && g.h || Math.round(vh * 0.45), vh - 84);
    const x = g && g.x != null ? g.x : vw - w - 16, y = g && g.y != null ? g.y : Math.max(8, vh - ht - 76);
    place(x, y, w, ht);
}
function place(x, y, w, ht) {
    if (docked || edge) return;
    w = w ?? root.offsetWidth; ht = ht ?? root.offsetHeight;
    x = Math.max(8 - w + 80, Math.min(x, innerWidth - 80));   // keep a grip on screen
    y = Math.max(8, Math.min(y, innerHeight - 40));
    Object.assign(root.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: ht + 'px' });
}
function saveGeometry() {
    if (docked || edge) return;
    try {
        localStorage.setItem(STORE, JSON.stringify({ x: root.offsetLeft, y: root.offsetTop, w: root.offsetWidth, h: root.offsetHeight }));
    } catch { /* private mode: not remembered */ }
}
function wireMove() {
    let drag = null;
    $.bar.addEventListener('pointerdown', e => {
        if (docked || edge || e.button !== 0 || e.target.closest('button')) return;
        drag = { dx: e.clientX - root.offsetLeft, dy: e.clientY - root.offsetTop };
        $.bar.setPointerCapture(e.pointerId);
        e.preventDefault();
    });
    $.bar.addEventListener('pointermove', e => { if (drag) place(e.clientX - drag.dx, e.clientY - drag.dy); });
    const end = () => { if (drag) { drag = null; saveGeometry(); } };
    $.bar.addEventListener('pointerup', end);
    $.bar.addEventListener('pointercancel', end);
    // The native resize grip (CSS resize) – remember the size it leaves.
    let t = 0;
    new ResizeObserver(() => { if (!root.hidden) { clearTimeout(t); t = setTimeout(saveGeometry, 300); } }).observe(root);
    // Docked to an edge: the grip on the side facing the page sets the size.
    let sizing = false, want = null, frame = 0;
    $.grip.addEventListener('pointerdown', e => {
        if (!edge || e.button !== 0) return;
        sizing = true;
        $.grip.setPointerCapture(e.pointerId);
        e.preventDefault();
    });
    $.grip.addEventListener('pointermove', e => {
        if (!sizing) return;
        const vp = viewport();
        want = edge === 'left' ? e.clientX : edge === 'right' ? vp.w - e.clientX : vp.h - e.clientY;
        // one layout of the page per frame, however fast the pointer moves
        frame = frame || requestAnimationFrame(() => { frame = 0; if (edge) placeEdge(want); });
    });
    const endSizing = () => { if (sizing) { sizing = false; saveDockSize(); } };
    $.grip.addEventListener('pointerup', endSizing);
    $.grip.addEventListener('pointercancel', endSizing);
    // Turning a phone moves an 'auto' panel between the side and the bottom.
    addEventListener('resize', () => {
        if (!isOpen || docked) return;
        const m = chosenDock();
        if (m !== (edge || 'float')) applyDock(m);
        else if (edge) placeEdge();
        else place(root.offsetLeft, root.offsetTop);
    });
}

// ── Docked to an edge of the window ────────────────────────────────────────────
// The reader's choice of where the panel sits, remembered per browser; until
// they make one, the page's (open's `dock`), floating if it names none.
const DOCKS = ['left', 'bottom', 'right', 'float'];
let pageDock = 'float';
function chosenDock() {
    let m = null;
    try { m = localStorage.getItem(STORE + '-dock'); } catch { m = null; }
    if (!DOCKS.includes(m)) m = pageDock;
    if (m === 'auto') { const vp = viewport(); m = vp.w >= vp.h ? 'right' : 'bottom'; }
    return DOCKS.includes(m) ? m : 'float';
}
function setDock(mode) {
    if (!DOCKS.includes(mode)) return;
    try { localStorage.setItem(STORE + '-dock', mode); } catch { /* not remembered */ }
    if (isOpen && !docked) applyDock(mode);
}
function applyDock(mode) {
    edge = mode === 'float' ? null : mode;
    if (edge) root.dataset.edge = edge; else delete root.dataset.edge;
    for (const b of $.docks.querySelectorAll('[data-dock]')) b.setAttribute('aria-pressed', String(b.dataset.dock === mode));
    $.more.innerHTML = DOCK_ICONS[mode] + ICON_CARET;
    if (edge) { placeEdge(); return; }
    release();
    Object.assign(root.style, { right: '', bottom: '' });
    loadGeometry();
}
function loadDockSizes() {
    try { return JSON.parse(localStorage.getItem(STORE + '-docksize') || '{}') || {}; } catch { return {}; }
}
function saveDockSize() {
    const sizes = loadDockSizes();
    sizes[edge] = edge === 'bottom' ? root.offsetHeight : root.offsetWidth;
    try { localStorage.setItem(STORE + '-docksize', JSON.stringify(sizes)); } catch { /* not remembered */ }
}
// The window a docked panel is placed in, as position: fixed sees it: without
// the page's scroll bar, and unchanged by a phone zooming out to fit a page
// that is wider than the screen for a moment (innerWidth is not).
const viewport = () => ({ w: document.documentElement.clientWidth, h: document.documentElement.clientHeight });
// Width (left, right) or height (bottom): as asked, as remembered, or a third
// of the window or so – always leaving the page some room.
function dockSize(want) {
    const vp = viewport(), across = edge === 'bottom' ? vp.h : vp.w;
    const size = want ?? loadDockSizes()[edge]
        ?? (edge === 'bottom' ? Math.round(vp.h * 0.42) : Math.max(300, Math.min(460, Math.round(vp.w * 0.36))));
    const least = Math.min(edge === 'bottom' ? 120 : 260, across / 2);
    return Math.round(Math.max(least, Math.min(size, across - (edge === 'bottom' ? 120 : 240))));
}
function placeEdge(want) {
    const size = dockSize(want);
    const st = edge === 'bottom'
        ? { left: '0px', right: '0px', top: '', bottom: '0px', width: '', height: size + 'px' }
        : { left: edge === 'left' ? '0px' : '', right: edge === 'right' ? '0px' : '',
            top: '0px', bottom: '0px', width: size + 'px', height: '' };
    Object.assign(root.style, st);
    reserve(edge, size);
}
// The page keeps the rest of the window: <html> gets padding on the panel's
// side, so the page lays out in the room left (its blocks re-break to it) and
// its end scrolls clear of a bottom panel. The size is published as a CSS
// variable too – --rtx-dock-left, -right or -bottom – for what the page fixes
// to the window, such as a floating button.
const PAD = { left: 'paddingLeft', right: 'paddingRight', bottom: 'paddingBottom' };
let reserved = null;          // { side, before: <html>'s own inline padding there }
function reserve(side, size) {
    const de = document.documentElement;
    if (reserved && reserved.side !== side) release();
    if (!reserved) reserved = { side, before: de.style[PAD[side]] };
    de.style[PAD[side]] = size + 'px';
    de.style.setProperty('--rtx-dock-' + side, size + 'px');
}
function release() {
    if (!reserved) return;
    const de = document.documentElement;
    de.style[PAD[reserved.side]] = reserved.before;
    de.style.removeProperty('--rtx-dock-' + reserved.side);
    reserved = null;
}

function loadGuides() {
    try { return JSON.parse(localStorage.getItem(STORE + '-guides') || '{}') || {}; } catch { return {}; }
}
async function setGuide(key, on) {
    const g = { baselines: false, badness: false, springs: false, ...loadGuides(), [key]: on };
    try { localStorage.setItem(STORE + '-guides', JSON.stringify(g)); } catch { /* not remembered */ }
    await applyGuides(g);
}
async function applyGuides(g = loadGuides()) {
    $.overlays.classList.toggle('on', OVERLAYS.some(([k]) => g[k]));
    if (menu) for (const b of menu.querySelectorAll('[data-overlay]')) b.setAttribute('aria-checked', String(!!g[b.dataset.overlay]));
    await call('setOptions', { baselines: !!g.baselines, badness: !!g.badness, springs: !!g.springs });
}

// Dark when the page is: its background's luminance decides.
function syncTheme() {
    const bg = c => { const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(c); return m && (m[4] === undefined || +m[4] > 0) ? m : null; };
    const m = bg(getComputedStyle(document.body).backgroundColor) || bg(getComputedStyle(document.documentElement).backgroundColor);
    const dark = m ? (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) < 110 : matchMedia('(prefers-color-scheme: dark)').matches;
    root.classList.toggle('dark', dark);
}

// ── Tree ───────────────────────────────────────────────────────────────────────
const nodes = new Map();         // id → { s: summary, kids: [id] | null, open }
let roots = [], selected = null, lastPaints = null, lastPickSeq = 0, lastBlocks = null, hoverId = null;

function remember(list) {
    return list.map(s => {
        const n = nodes.get(s.id);
        if (n) n.s = s; else nodes.set(s.id, { s, kids: null, open: false });
        return s.id;
    });
}
async function loadKids(id) { nodes.get(id).kids = remember(await call('children', id) || []); }
async function toggle(id, open) {
    const n = nodes.get(id);
    if (!n || !n.s.hasChildren) return;
    open = open === undefined ? !n.open : open;
    if (open && !n.kids) await loadKids(id);
    n.open = open;
    render();
}
async function refresh() {
    const blocks = await call('blocks');
    if (blocks === MISSING) {
        roots = []; nodes.clear();
        $.tree.replaceChildren(h('div', { class: 'empty' },
            'No inspectable Reflow TeX blocks on this page yet. The viewer must have ',
            h('code', {}, 'reflowtex.inspect'), ' (see the viewer README, “Inspection”).'));
        return;
    }
    roots = remember(blocks);
    const walk = async ids => {                  // re-fetch every open branch
        for (const id of ids) {
            const n = nodes.get(id);
            if (n && n.open && n.s.hasChildren) { await loadKids(id); await walk(n.kids); }
            else if (n) n.kids = null;
        }
    };
    await walk(roots);
    render();
    if (selected != null) showDetails(selected);
}
function render() {
    const frag = document.createDocumentFragment();
    const emit = (id, depth) => {
        const n = nodes.get(id);
        if (!n) return;
        const row = h('div', { class: `row t-${n.s.type}` + (id === selected ? ' sel' : '') + (n.s.drawn === false ? ' undrawn' : ''),
                               role: 'treeitem', 'data-id': id },
            h('span', { class: 'twisty' }, n.s.hasChildren ? (n.open ? '▾' : '▸') : ''),
            h('span', { class: 'label' }, n.s.label),
            ...(n.s.affine ? [h('span', { class: 'affine', title: `Width-dependent: ${n.s.affine.join(', ')} recomputed for the reader's width – see the details` }, '↔')] : []),
            h('span', { class: 'note' }, n.s.note));
        if (n.s.hasChildren) row.setAttribute('aria-expanded', String(!!n.open));
        row.style.paddingLeft = `${4 + depth * 14}px`;
        frag.appendChild(row);
        if (n.open && n.kids) emitKids(n.kids, depth + 1);
    };
    // Consecutive plain glyphs – a word, as TeX set it, between its kerns and
    // glue – share one row, letter by letter; each letter is still a node of
    // its own to hover and select. A hyphenation point (a discretionary with
    // nothing to show unbroken) sits among them as a marked chip of its own;
    // any other discretionary – an explicit dash, a ligature – ends the run.
    const plainGlyph = id => { const n = nodes.get(id); return n && n.s.type === 'glyph' && !n.s.hasChildren; };
    const inlineDisc = id => { const n = nodes.get(id); return n && n.s.point === true; };
    const emitKids = (kids, depth) => {
        for (let i = 0; i < kids.length;) {
            let j = i, letters = 0;
            while (j < kids.length && (plainGlyph(kids[j]) || inlineDisc(kids[j]))) { if (plainGlyph(kids[j])) letters++; j++; }
            if (j - i >= 2 && letters >= 1) { emitRun(kids.slice(i, j), depth); i = j; }
            else { emit(kids[i], depth); i++; }
        }
    };
    const emitRun = (ids, depth) => {
        const fonts = new Set();
        let letters = 0;
        const chips = ids.map(id => {
            const s = nodes.get(id).s;
            const disc = s.point === true;
            const m = /^font (\S+)/.exec(s.note);
            if (m) fonts.add(m[1]);
            if (!disc) letters++;
            return h('span', { class: 'chip' + (disc ? ' disc' : '')
                                   + (id === selected ? ' sel' : '') + (s.drawn === false ? ' undrawn' : ''),
                               role: 'treeitem', 'data-id': id, title: `${s.label}  ${s.note}` },
                     disc ? '-' : s.label.replace(/^‘(.*)’$/su, '$1'));
        });
        const discs = ids.length - letters;
        const row = h('div', { class: 'row run t-glyph', role: 'group' },
            h('span', { class: 'twisty' }, ''),
            h('span', { class: 'chips' }, ...chips),
            h('span', { class: 'note' }, `${letters} glyph${letters === 1 ? '' : 's'}`
                + (discs ? ` · ${discs} hyphenation point${discs === 1 ? '' : 's'}` : '')
                + (fonts.size ? ` · font ${[...fonts].join(', ')}` : '')));
        row.style.paddingLeft = `${4 + depth * 14}px`;
        frag.appendChild(row);
    };
    for (const r of roots) emit(r, 0);
    if (!roots.length) frag.appendChild(h('div', { class: 'empty' }, 'No blocks on this page yet.'));
    $.tree.replaceChildren(frag);
}
// `page: false` leaves the page where it is, even if the node is off screen.
async function select(id, { scroll = true, page = true } = {}) {
    selected = id;
    for (const r of $.tree.querySelectorAll('[data-id].sel')) r.classList.remove('sel');
    const row = $.tree.querySelector(`[data-id="${id}"]`);
    if (row) { row.classList.add('sel'); if (scroll) row.scrollIntoView({ block: 'nearest' }); }
    await call('select', id, { scroll: page });
    showDetails(id);
}
function placeholder() {
    delete $.details.dataset.id;
    $.details.replaceChildren(h('p', { class: 'muted' }, 'Select a row, or ', h('b', {}, 'Pick'),
        ' a box or glue in the page. ', h('kbd', {}, SHORTCUT), ' opens and closes this panel.'));
}
async function showDetails(id) {
    const d = await call('details', id);
    if (!d || d === MISSING) { delete $.details.dataset.id; $.details.replaceChildren(h('p', { class: 'muted' }, 'Gone – the layout changed.')); return; }
    const t = h('table');
    for (const [k, v] of d.rows) { const tr = t.insertRow(); tr.insertCell().textContent = k; tr.insertCell().textContent = v; }
    const copy = h('button', { type: 'button', class: 'copy', title: `Copy this fragment – all it holds – as XML (${IS_MAC ? '⌘' : 'Ctrl+'}C in the tree)`,
                               onclick: () => copyXml(id) }, 'Copy XML');
    // The same node again (the layout moved): new values, the same buttons,
    // so a click on one is not lost to a refresh between press and release.
    const title = `${d.summary.label}  ${d.summary.note}`;
    if ($.details.dataset.id === String(id) && $.details.querySelector('table')) {
        $.details.querySelector('h2').textContent = title;
        $.details.querySelector('table').replaceWith(t);
        return;
    }
    const acts = h('div', { class: 'actions' }, copy);
    if (d.glyph) acts.prepend(h('button', { type: 'button', class: 'copy', title: `Show ${hex(d.glyph.cp)} in the glyph table of ${d.glyph.font} (Resources)`,
                                            onclick: () => showGlyph(d.glyph.key, d.glyph.cp) }, 'In its font'));
    $.details.dataset.id = id;
    $.details.replaceChildren(h('div', { class: 'dhead' }, h('h2', {}, title), acts), t);
}
function legend() {
    const l = h('div', { class: 'legend' });
    for (const [name, c] of [['box, glyph', 'box'], ['glue', 'glue'], ['kern', 'kern'], ['math', 'math'], ['penalty', 'penalty'], ['line', 'line-c']]) {
        const sw = h('span', { class: 'sw' });
        sw.style.borderColor = sw.style.background = `var(--${c})`;
        l.append(h('span', { class: 'key' }, sw, name));
    }
    return l;
}
// The selected fragment as XML, onto the clipboard.
async function copyXml(id) {
    if (id == null) return;
    const text = await call('xml', id);
    if (typeof text === 'string') copyText(text, 'XML');
}
async function copyText(text, what) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; }
    catch {                                         // no async clipboard (not a secure page): the old way
        const ta = h('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0';
        root.appendChild(ta); ta.select();
        try { ok = document.execCommand('copy'); } catch { ok = false; }
        ta.remove();
    }
    const lines = text.split('\n').length;
    flash = { text: ok ? `copied ${lines} line${lines === 1 ? '' : 's'} of ${what}` : 'could not copy', until: Date.now() + 2000 };
    $.status.textContent = flash.text;
}
let flash = null;             // a message the status line keeps for a moment

// Expand along a path (block → … → node) and select its end.
async function reveal(path, { openLast = false, page = true } = {}) {
    if (!path || !path.length) return;
    if (!roots.includes(path[0])) await refresh();
    const upto = openLast ? path : path.slice(0, -1);
    for (const id of upto) {
        const n = nodes.get(id);
        if (!n) return;
        if (n.s.hasChildren) { if (!n.kids) await loadKids(id); n.open = true; }
    }
    render();
    await select(path[path.length - 1], { page });
}
// ── The context menu ───────────────────────────────────────────────────────────
// A right-click on a row (or a letter of a run) selects it and offers to copy
// it. The panel's own menu, so it can say what it copies; the page's is left
// alone everywhere else.
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
let menu = null, menuAnchor = null, menuClosed = null;
function closeMenu() {
    if (!menu) return;
    menu.remove(); menu = null;
    if (menuAnchor) { menuAnchor.setAttribute('aria-expanded', 'false'); menuClosed = { anchor: menuAnchor, at: performance.now() }; }
    menuAnchor = null;
}
// A toolbar button's menu, under it and inside the panel. A second click on
// the button closes it (the pointerdown that closed it is that click's own).
function toggleMenu(anchor, make) {
    if (menu && menuAnchor === anchor) { closeMenu(); return; }            // (from the keyboard)
    if (menuClosed && menuClosed.anchor === anchor && performance.now() - menuClosed.at < 400) { menuClosed = null; return; }
    closeMenu();
    menu = make();
    menuAnchor = anchor;
    anchor.setAttribute('aria-expanded', 'true');
    root.appendChild(menu);
    const rr = root.getBoundingClientRect(), ar = anchor.getBoundingClientRect(), mw = menu.offsetWidth;
    // left-aligned with its button, or right-aligned in the corner
    const x = anchor.closest('.corner') ? ar.right - rr.left - mw : ar.left - rr.left;
    menu.style.left = Math.max(4, Math.min(x, rr.width - mw - 4)) + 'px';
    menu.style.top = (ar.bottom - rr.top + 2) + 'px';
    const first = menu.querySelector('[aria-checked="true"], [aria-pressed="true"], button');
    if (first) first.focus();
}
// Chrome's checkmark menu (like the Console's levels): a click toggles, and
// the menu stays open for the next.
function overlaysMenu() {
    const g = loadGuides();
    return h('div', { class: 'menu', role: 'menu', 'aria-label': 'Page overlays' },
        ...OVERLAYS.map(([key, label, title]) => {
            const b = h('button', { type: 'button', role: 'menuitemcheckbox', 'data-overlay': key, title,
                                    'aria-checked': String(!!g[key]),
                                    onclick: () => setGuide(key, b.getAttribute('aria-checked') !== 'true') });
            const check = h('span', { class: 'check' });
            check.innerHTML = ICON_CHECK;
            b.append(check, h('span', { class: 'label' }, label));
            return b;
        }));
}
// Chrome's "Dock side" and its four places, for a panel too narrow to show them.
function moreMenu() {
    const now = edge || 'float';
    return h('div', { class: 'menu', role: 'menu', 'aria-label': 'Inspector options' },
        h('div', { class: 'mrow' }, h('span', { class: 'label' }, 'Dock side'),
            h('span', { class: 'docks', role: 'group', 'aria-label': 'Dock side' },
                ...['float', 'left', 'bottom', 'right'].map(m => {
                    const b = h('button', { type: 'button', class: 'ib', 'data-dock': m, title: DOCK_TITLES[m], 'aria-label': DOCK_TITLES[m],
                                            'aria-pressed': String(m === now), onclick: () => { closeMenu(); setDock(m); } });
                    b.innerHTML = DOCK_ICONS[m];
                    return b;
                }))));
}
async function openMenu(id, x, y) {
    closeMenu();
    await select(id, { scroll: false });
    const s = nodes.get(id) && nodes.get(id).s;
    const item = (label, hint, act) => h('button', { type: 'button', role: 'menuitem',
        onclick: async () => { closeMenu(); await act(); $.tree.focus({ preventScroll: true }); } },
        h('span', {}, label), h('span', { class: 'hint' }, hint));
    menu = h('div', { class: 'menu', role: 'menu' },
        item('Copy XML', `${IS_MAC ? '⌘' : 'Ctrl+'}C`, () => copyXml(id)),
        item('Copy text', 'the characters', async () => { const t = await call('text', id); copyText(typeof t === 'string' ? t : '', 'text'); }),
        item('Copy row', s ? s.label : '', () => copyText(s ? `${s.label}  ${s.note}`.trim() : '', 'the row')));
    root.appendChild(menu);
    // inside the panel, clear of its edges
    const rr = root.getBoundingClientRect(), mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = Math.max(4, Math.min(x - rr.left, rr.width - mw - 4)) + 'px';
    menu.style.top = Math.max(4, Math.min(y - rr.top, rr.height - mh - 4)) + 'px';
    menu.querySelector('button').focus();
}

function wireTree() {
    const t = $.tree;
    t.addEventListener('contextmenu', e => {
        const el = e.target.closest('[data-id]');
        if (!el) return;
        e.preventDefault();
        openMenu(+el.dataset.id, e.clientX, e.clientY);
    });
    root.addEventListener('pointerdown', e => { if (menu && !menu.contains(e.target)) closeMenu(); }, true);
    root.addEventListener('keydown', e => {
        if (!menu) return;
        const items = [...menu.querySelectorAll('button')], i = items.indexOf(e.composedPath()[0]);
        if (e.key === 'Escape') { e.stopPropagation(); const a = menuAnchor; closeMenu(); (a || $.tree).focus({ preventScroll: true }); }
        else if (e.key === 'ArrowDown') items[(i + 1) % items.length].focus();
        else if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length].focus();
        else return;
        e.preventDefault();
    });
    t.addEventListener('scroll', closeMenu, { passive: true });
    // A row, or one letter of a run: both carry data-id.
    // On the press, not the click: while the text reflows (a width that
    // changes on its own, say) the rows are made afresh every frame, and a
    // click – press and release on one element – would fall on a row that is
    // gone. A second press in quick succession opens or closes, like a
    // double click.
    t.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        const row = e.target.closest('[data-id]');
        if (!row) return;
        const id = +row.dataset.id;
        if (e.target.classList.contains('twisty') || e.detail === 2) toggle(id); else select(id, { scroll: false });
    });
    // A letter hovers that glyph; the rest of a run's row, all of its letters.
    t.addEventListener('mousemove', e => {
        const el = e.target.closest('[data-id]'), run = !el && e.target.closest('.row.run');
        const id = el ? +el.dataset.id : run ? [...run.querySelectorAll('[data-id]')].map(c => +c.dataset.id) : null;
        const key = JSON.stringify(id);
        if (key !== hoverId) { hoverId = key; call('hover', id); }
    });
    t.addEventListener('mouseleave', () => { hoverId = null; call('hover', null); });
    // Up and Down go row by row (a run of letters is one row); Right and Left
    // open and close, and within a run step from letter to letter.
    t.addEventListener('keydown', e => {
        if ((e.metaKey || e.ctrlKey) && e.key === 'c' && selected != null) { e.preventDefault(); copyXml(selected); return; }
        if ((e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) && selected != null) {
            e.preventDefault();
            const el = t.querySelector(`[data-id="${selected}"]`), r = el && el.getBoundingClientRect();
            if (r) openMenu(selected, r.left + 24, r.bottom);
            return;
        }
        const items = [...t.querySelectorAll('[data-id]')], ids = items.map(r => +r.dataset.id), i = ids.indexOf(selected);
        const rowOf = el => el.closest('.row'), me = items[i], myRow = me && rowOf(me);
        const inRun = me && me.classList.contains('chip');
        if (e.key === 'ArrowDown') {
            let k = i + 1;
            while (k < items.length && myRow && rowOf(items[k]) === myRow) k++;
            if (k < items.length) select(ids[k]);
        } else if (e.key === 'ArrowUp' && i > 0) {
            let k = i - 1;
            while (k > 0 && myRow && rowOf(items[k]) === myRow) k--;
            const r = rowOf(items[k]);               // into a run: its first letter
            if (r.classList.contains('run')) k = items.indexOf(r.querySelector('[data-id]'));
            select(ids[k]);
        } else if (e.key === 'ArrowRight' && selected != null) {
            if (inRun) { if (me.nextElementSibling) select(ids[i + 1]); }
            else toggle(selected, true);
        } else if (e.key === 'ArrowLeft' && selected != null) {
            const n = nodes.get(selected);
            if (inRun && me.previousElementSibling) select(ids[i - 1]);
            else if (n && n.open) toggle(selected, false);
            else {                                   // to the parent row
                const depth = r => parseInt(r.style.paddingLeft);
                for (let k = i - 1; k >= 0; k--) if (depth(rowOf(items[k])) < depth(myRow)) { select(ids[k]); break; }
            }
        } else return;
        e.preventDefault();
    });
}

// ── Resources ──────────────────────────────────────────────────────────────────
// The second view: what the blocks draw with. A list on one side – fonts,
// pictures, streams, links, citations, anchors, slots – and the one selected
// on the other; a font's side is a table of its glyphs. Hovering a resource
// (or a glyph) outlines its uses on the page, selecting one keeps them
// outlined, and Show in tree steps through them in the Boxes view.
let view = 'tree', resData = null, resSel = null, glyphSel = null, hoverKey = null;
const cursor = { key: null, k: -1 };            // Show in tree: the use shown last
const CATS = [['fonts', 'Fonts · originals'], ['modifiedFonts', 'Fonts · modified by Reflow TeX'], ['pictures', 'Pictures'], ['streams', 'Streams'], ['links', 'Links'],
              ['citations', 'Citations'], ['anchors', 'Anchors'], ['slots', 'Slots']];

function loadView() { try { return localStorage.getItem(STORE + '-view') === 'res' ? 'res' : 'tree'; } catch { return 'tree'; } }
function setView(v, { quiet = false } = {}) {
    if (view === v && !quiet) return;
    view = v;
    root.dataset.view = v;
    for (const b of $.tabs.children) b.setAttribute('aria-selected', String(b.dataset.view === v));
    try { localStorage.setItem(STORE + '-view', v); } catch { /* not remembered */ }
    if (quiet) return;
    // The Boxes view's selection leaves the page while Resources is shown –
    // hovering a resource would otherwise dim and restore it at every move –
    // and comes back with the tree.
    if (v === 'res') { call('select', null); $.rbody.focus({ preventScroll: true }); return loadResources(); }
    else { call('mark', null); if (selected != null) call('select', selected, { scroll: false }); $.tree.focus({ preventScroll: true }); }
}
// A glyph in its font's table: Resources, the font selected (its kind of
// resource opened if collapsed), the glyph selected in the table (see showFont).
let pendingGlyph = null;
async function showGlyph(key, cp) {
    resSel = key; glyphSel = null; pendingGlyph = { key, cp };
    if (view === 'res') await loadResources(); else await setView('res');
    const cat = CATS.map(([c]) => c).find(c => resData && resData[c].some(r => r.key === key)), shut = loadCollapsed();
    if (cat && shut.has(cat)) { shut.delete(cat); setCollapsed(shut); }
    const row = $.rbody.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (row) row.scrollIntoView({ block: 'nearest' });
}
async function loadResources() {
    const r = await call('resources');
    resData = r === MISSING ? null : r;
    renderResList();
    if (resSel && findRes(resSel)) { showResource(resSel); markUses(); }
    else { resSel = null; resPlaceholder(); }
}
const findRes = key => resData && CATS.some(([c]) => resData[c].some(r => r.key === key));
function resPlaceholder() {
    $.rdetails.replaceChildren(h('p', { class: 'muted' }, 'Select a resource. Hovering one outlines where the page uses it.'));
}
// Collapsed kinds of resource, remembered like the panel's place. While the
// filter has text, every kind with a match is open: a match is never hidden.
function loadCollapsed() {
    try { return new Set(JSON.parse(localStorage.getItem(STORE + '-collapsed') || '[]')); } catch { return new Set(); }
}
function setCollapsed(set) {
    try { localStorage.setItem(STORE + '-collapsed', JSON.stringify([...set])); } catch { /* not remembered */ }
    renderResList();
}
// A heading's click opens or closes its kind; with ⌥/Alt, shows that kind only
// (or, if it is the only one open already, all of them).
function toggleCat(cat, only) {
    const shut = loadCollapsed(), present = CATS.map(([c]) => c).filter(c => resData && resData[c].length);
    if (only) {
        const alone = !shut.has(cat) && present.every(c => c === cat || shut.has(c));
        setCollapsed(new Set(alone ? [] : present.filter(c => c !== cat)));
    } else {
        if (shut.has(cat)) shut.delete(cat); else shut.add(cat);
        setCollapsed(shut);
    }
}
function loadFontSort() { try { return localStorage.getItem(STORE + '-fontsort') === 'uses' ? 'uses' : 'name'; } catch { return 'name'; } }
function renderResList() {
    const q = $.filter.value.trim().toLowerCase(), frag = document.createDocumentFragment(), shut = loadCollapsed();
    const byUse = loadFontSort() === 'uses';
    $.fontSort.value = byUse ? 'uses' : 'name';
    if (!resData) { $.rbody.replaceChildren(h('div', { class: 'empty' }, 'No inspectable Reflow TeX blocks on this page yet.')); return; }
    for (const [cat, title] of CATS) {
        // (the agent lists fonts by name; most glyphs set first, on request)
        const all = byUse && (cat === 'fonts' || cat === 'modifiedFonts') ? [...resData[cat]].sort((a, b) => (b.uses || 0) - (a.uses || 0)) : resData[cat];
        const rows = q ? all.filter(r => `${r.label} ${r.note}`.toLowerCase().includes(q)) : all;
        if (!rows.length) continue;
        const open = q || !shut.has(cat);
        frag.appendChild(h('button', { type: 'button', class: 'rhead', 'data-cat': cat, 'aria-expanded': String(!!open),
                                       title: `${open ? 'Hide' : 'Show'} the ${title.toLowerCase()} (${IS_MAC ? '⌥' : 'Alt+'}click: only these)` },
            h('span', { class: 'twisty' }, open ? '▾' : '▸'), h('span', { class: 'name' }, title),
            h('span', { class: 'count' }, q ? `${rows.length} of ${all.length}` : String(all.length))));
        if (!open) continue;
        for (const r of rows) {
            const row = h('div', { class: `row rrow c-${r.cat}` + (r.key === resSel ? ' sel' : ''), role: 'option', 'data-key': r.key },
                h('span', { class: 'label' }, r.label), h('span', { class: 'note' }, r.note));
            if (r.cat === 'font' && r.family && !r.unresolved) {
                const sample = h('span', { class: 'sample', 'aria-hidden': 'true' }, 'Ag');
                sample.style.fontFamily = `'${r.family}'`;
                row.insertBefore(sample, row.firstChild);
            }
            frag.appendChild(row);
        }
    }
    if (!frag.childNodes.length) frag.appendChild(h('div', { class: 'empty' }, q ? 'Nothing matches.' : 'No resources.'));
    $.rbody.replaceChildren(frag);
}
async function selectResource(key, { scroll = true } = {}) {
    resSel = key; glyphSel = null;
    for (const r of $.rbody.querySelectorAll('.rrow.sel')) r.classList.remove('sel');
    const row = $.rbody.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (row) { row.classList.add('sel'); if (scroll) row.scrollIntoView({ block: 'nearest' }); }
    await Promise.all([markUses(), showResource(key)]);
}
// The selected resource's (or glyph's) uses, outlined on the page.
async function markUses() {
    const key = glyphSel ? glyphSel.key : resSel;
    const ids = key ? await call('uses', key) : [];
    await call('mark', ids === MISSING ? null : ids);
}
async function hoverUses(key) {
    if (key === hoverKey) return;
    hoverKey = key;
    const ids = key ? await call('uses', key) : null;
    if (hoverKey === key) call('hover', ids && ids !== MISSING && ids.length ? ids : null);
}
// Show in tree: the next of a resource's uses, in the Boxes view.
async function showInTree(key) {
    const ids = await call('uses', key);
    if (!ids || ids === MISSING || !ids.length) { say('none of it is drawn now'); return; }
    cursor.k = cursor.key === key ? (cursor.k + 1) % ids.length : 0;
    cursor.key = key;
    const path = await call('pathTo', ids[cursor.k]);
    if (!path || path === MISSING) return;
    setView('tree');
    await reveal(path);
    say(`use ${cursor.k + 1} of ${ids.length}`);
}
function say(text) { flash = { text, until: Date.now() + 2500 }; $.status.textContent = text; }
const table = rows => {
    const t = h('table');
    for (const [k, v] of rows) { const tr = t.insertRow(); tr.insertCell().textContent = k; tr.insertCell().textContent = v; }
    return t;
};
const action = (label, title, onclick) => h('button', { type: 'button', class: 'copy', title, onclick }, label);

async function showResource(key) {
    if (key.startsWith('font:')) return showFont(key);
    const d = await call('resource', key);
    if (resSel !== key) return;
    if (!d || d === MISSING) { $.rdetails.replaceChildren(h('p', { class: 'muted' }, 'Gone – the page changed.')); return; }
    const acts = h('div', { class: 'actions' },
        action('Show in tree', 'Select its next use in the Boxes view', () => showInTree(key)));
    const parts = [h('div', { class: 'dhead' }, h('h2', {}, d.title), acts)];
    if (d.svg) {
        // The drawing, scaled to the panel; its colours are the page's custom
        // properties, with their fallbacks here.
        const fig = h('div', { class: 'preview' });
        fig.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${d.svg.vb_w} ${d.svg.vb_h}" fill="currentColor">${d.svg.markup}</svg>`;
        parts.push(fig);
        acts.append(action('Copy SVG', 'Copy the drawing as an SVG file', () => copyText(
            `<svg xmlns="http://www.w3.org/2000/svg" width="${d.svg.vb_w}pt" height="${d.svg.vb_h}pt" viewBox="0 0 ${d.svg.vb_w} ${d.svg.vb_h}">${d.svg.markup}</svg>`, 'SVG')));
    }
    if (d.footnote) {
        acts.append(action('Open popover', 'Open the footnote as its marker does, pinned', () => openPopover(key)),
                    action('Its boxes', 'Show the popover\'s boxes and glue in the Boxes view', async () => {
                        await openPopover(key);
                        const path = await call('pathTo', d.side);
                        if (path && path !== MISSING) { setView('tree'); await refresh(); await reveal(path, { openLast: true }); }
                    }));
    }
    parts.push(table(d.rows));
    if (d.text) {
        parts.push(h('h3', {}, d.textIsCode ? 'Source' : 'Text'), h('pre', { class: d.textIsCode ? 'code' : 'text' }, d.text));
        acts.append(action('Copy text', 'Copy the stream\'s text', () => copyText(d.text, 'text')));
    }
    $.rdetails.replaceChildren(...parts);
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

// ── A font ─────────────────────────────────────────────────────────────────────
const hex = cp => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
const isPUA = cp => (cp >= 0xE000 && cp <= 0xF8FF) || cp >= 0xF0000;
const ptOf = sp => +(sp / 65536).toFixed(3) + 'pt';
let fontData = null;
async function showFont(key) {
    $.rdetails.replaceChildren(h('p', { class: 'muted' }, 'Reading the font file…'));
    const d = await call('fontGlyphs', key.slice(5));
    if (resSel !== key) return;
    // (its ink is measured in the loaded face; the page may not have needed it yet)
    if (d && d !== MISSING && d.family) {
        try { await document.fonts.load(`16px '${d.family}'`, String.fromCodePoint(...(d.cells.find(c => c.cps.length) || { cps: [65] }).cps.slice(0, 1))); } catch { /* measured as it is */ }
        if (resSel !== key) return;
    }
    if (!d || d === MISSING) { $.rdetails.replaceChildren(h('p', { class: 'muted' }, 'Gone – the page changed.')); return; }
    fontData = d;
    const used = d.cells.filter(c => c.uses).length;
    const rows = [['file', d.file || '(none)'], ['TeX font', d.names.join(', ')], ['sizes', d.sizes.map(ptOf).join(', ')]];
    if (d.origin) rows.push(['served', d.origin === 'converted' ? 'converted: a classic Type 1 font the pipeline rebuilt as OpenType'
        : d.origin === 'patched' ? 'patched: the pipeline added cmap entries for code points LuaTeX used, and serves it renamed'
        : 'unmodified, as TeX had it']);
    if (d.origin === 'converted' || d.origin === 'patched' || d.puaUsed)
        rows.push(['private use', (d.puaInFile != null ? `${d.puaInFile} code point${d.puaInFile === 1 ? '' : 's'} in the file, ` : '')
            + `${d.puaUsed} used – a glyph the font gives no code point of its own (a variant, a size of a delimiter) gets one`]);
    if (d.family) rows.push(['CSS family', `'${d.family}'` + (d.status ? ` – ${d.status}` : '')]);
    if (d.url) rows.push(['loaded from', d.url]);
    if (d.numGlyphs != null) rows.push(['glyphs', `${d.numGlyphs} in the file, ${d.upem} units per em`]);
    rows.push(['used', `${used} glyph${used === 1 ? '' : 's'}, ${d.cells.reduce((a, c) => a + c.uses, 0)} times`]);
    if (d.micro.quad) rows.push(['quad', ptOf(d.micro.quad)]);
    if (d.micro.expand || d.micro.codes) rows.push(['microtype', [d.micro.expand && `expansion ${d.micro.expand}`,
        d.micro.codes && `codes for ${d.micro.codes} character${d.micro.codes === 1 ? '' : 's'}`].filter(Boolean).join('; ')]);
    if (d.error) rows.push(['glyph table', d.error]);
    const search = h('input', { type: 'search', class: 'gsearch', spellcheck: 'false', 'aria-label': 'Search the glyphs',
                                placeholder: 'A, →, U+2192, 0x41, 65, #12 (glyph index), a name…' });
    const which = h('select', { 'aria-label': 'Which glyphs' },
        h('option', { value: 'all' }, 'All glyphs'), h('option', { value: 'used' }, 'Used here'), h('option', { value: 'unused' }, 'Not used'), h('option', { value: 'pua' }, 'Private use'));
    const count = h('span', { class: 'gcount muted' });
    const info = h('div', { class: 'ginfo' });
    const grid = h('div', { class: 'grid', role: 'grid', 'aria-label': 'Glyphs' });
    const update = () => renderGrid(grid, count, search.value, which.value);
    search.addEventListener('input', update);
    which.addEventListener('change', update);
    search.addEventListener('keydown', e => { if (e.key === 'Escape' && search.value) { search.value = ''; update(); } });
    grid.addEventListener('click', e => { const c = e.target.closest('.cell'); if (c) selectGlyph(+c.dataset.i, info, grid); });
    // Between two cells (the grid's gaps) the hover stays as it was: it
    // changes on the next glyph, and clears when the pointer leaves the grid.
    grid.addEventListener('mousemove', e => { const c = e.target.closest('.cell'); if (c) hoverUses(glyphKey(fontData.cells[+c.dataset.i])); });
    grid.addEventListener('mouseleave', () => hoverUses(null));
    const res = resData && [...resData.fonts, ...resData.modifiedFonts].find(r => r.key === key);
    // one asked for from elsewhere (a glyph's "In its font"): selected, in view
    const want = pendingGlyph && pendingGlyph.key === key ? pendingGlyph.cp : null;
    pendingGlyph = null;
    if (want != null) queueMicrotask(() => {
        const i = fontData.cells.findIndex(c => c.cps.includes(want));
        if (i < 0) return;
        selectGlyph(i, info, grid);
        const el = grid.querySelector(`[data-i="${i}"]`);
        if (el) el.scrollIntoView({ block: 'center' });
    });
    $.rdetails.replaceChildren(
        h('div', { class: 'dhead' }, h('h2', {}, res ? res.label : key.slice(5)),
          h('div', { class: 'actions' }, action('Show in tree', 'Select its next glyph in the Boxes view', () => showInTree(key)))),
        table(rows), h('div', { class: 'gbar' }, search, which, count), info, grid);
    update();
}
const glyphKey = c => (c && c.uses ? `glyph:${c.cps.find(cp => cp != null)}:${fontData.key}` : null);
// The glyphs a search asks for: a character; a code point (U+2192, 0x2192);
// a number, as a glyph index or a decimal code point; #12, a glyph index; or
// part of a glyph's name. Every reading that applies counts.
function glyphTest(q) {
    q = q.trim();
    if (!q) return null;
    const tests = [];
    let m;
    if ((m = /^(?:u\+?|0x|\\u\{?)([0-9a-f]{1,6})\}?$/i.exec(q))) { const cp = parseInt(m[1], 16); tests.push(c => c.cps.includes(cp)); }
    else if ((m = /^(?:#|gid\s*:?\s*)(\d+)$/i.exec(q))) { const g = +m[1]; tests.push(c => c.gid === g); }
    else if (/^\d+$/.test(q)) { const n = +q; tests.push(c => c.gid === n || c.cps.includes(n)); }
    const chars = [...q];
    if (chars.length === 1 || !/[\p{L}\p{N}]/u.test(q)) { const cps = chars.map(ch => ch.codePointAt(0)); tests.push(c => c.cps.some(cp => cps.includes(cp))); }
    const lq = q.toLowerCase();
    tests.push(c => !!c.name && c.name.toLowerCase().includes(lq));
    return c => tests.some(t => t(c));
}
function renderGrid(grid, count, q, which) {
    const test = glyphTest(q), d = fontData, frag = document.createDocumentFragment();
    // by code point; then the glyphs with none (by index), which the viewer
    // cannot draw; then characters the file lacks
    const rank = c => (c.missing ? 2 : c.cps.length ? 0 : 1), first = c => (c.cps.length ? Math.min(...c.cps) : c.gid);
    const order = d.cells.map((c, i) => i).sort((a, b) => rank(d.cells[a]) - rank(d.cells[b]) || first(d.cells[a]) - first(d.cells[b]));
    let n = 0;
    order.forEach(i => {
        const c = d.cells[i];
        if (which === 'used' && !c.uses) return;
        if (which === 'unused' && c.uses) return;
        if (which === 'pua' && !c.cps.some(isPUA)) return;
        if (test && !test(c)) return;
        n++;
        const cp = c.cps[0];
        const g = h('span', { class: 'g' });
        if (cp != null) g.appendChild(cellGlyph(cp, d.family));
        const cell = h('button', { type: 'button', class: 'cell' + (c.uses ? ' used' : '') + (c.missing ? ' missing' : '') + (cp == null ? ' unmapped' : '')
                                       + (glyphSel && glyphSel.i === i ? ' sel' : ''), 'data-i': i,
                                   title: [cp != null ? c.cps.map(hex).join(' ') : 'no code point', c.name, c.gid != null ? `#${c.gid}` : 'not in the file',
                                           c.uses ? `used ${c.uses}×` : ''].filter(Boolean).join(' · ') },
            g, h('span', { class: 'cap' }, cp != null ? cp.toString(16).toUpperCase().padStart(4, '0') : `#${c.gid}`));
        if (c.uses) cell.appendChild(h('span', { class: 'uses' }, String(c.uses)));
        frag.appendChild(cell);
    });
    grid.replaceChildren(frag);
    count.textContent = `${n} of ${d.cells.length}`;
}
async function selectGlyph(i, info, grid) {
    const c = fontData.cells[i], d = fontData;
    glyphSel = { i, key: glyphKey(c) };
    for (const el of grid.querySelectorAll('.cell.sel')) el.classList.remove('sel');
    const el = grid.querySelector(`[data-i="${i}"]`);
    if (el) el.classList.add('sel');
    const rows = [];
    if (c.gid != null) rows.push(['glyph index', `#${c.gid}`]);
    if (c.name) rows.push(['name', c.name]);
    rows.push(['code point' + (c.cps.length > 1 ? 's' : ''), c.cps.length
        ? c.cps.map(cp => hex(cp) + (isPUA(cp) ? ' (private use: the pipeline gave the glyph a code point of its own)' : '')).join(', ') : 'none: the viewer cannot draw it']);
    if (c.missing) rows.push(['in the file', 'no – the document uses it, but the font\'s cmap has no such character']);
    if (c.adv != null) rows.push(['advance', `${c.adv} units` + (d.upem ? ` = ${d.sizes.map(sz => ptOf(c.adv / d.upem * sz)).join(', ')}` : '')]);
    for (const [sz, w, ht, dp] of c.tex || []) rows.push([`TeX at ${ptOf(sz)}`, `${ptOf(w)} × ${ptOf(ht)} + ${ptOf(dp)}`]);
    if (c.codes) rows.push(['microtype', `\\lpcode ${c.codes.lp}, \\rpcode ${c.codes.rp}, \\efcode ${c.codes.ef}`]);
    const oh = c.cps.length ? overhang(c, d) : null;
    if (oh) rows.push([`ink at ${ptOf(c.tex ? c.tex[0][0] : d.sizes[0])}`, oh]);
    rows.push(['used', c.uses ? `${c.uses} time${c.uses === 1 ? '' : 's'} in the documents` : 'not in these documents']);
    const big = glyphFigure(c, d);
    const acts = h('div', { class: 'actions' });
    if (glyphSel.key) {
        const ids = await call('uses', glyphSel.key);
        const k = ids && ids !== MISSING ? ids.length : 0;
        rows.push(['on the page now', `${k} drawn`]);
        if (k) acts.append(action('Show in tree', 'Select its next use in the Boxes view', () => showInTree(glyphSel.key)));
    }
    if (c.cps.length) acts.append(action('Copy', 'Copy the character', () => copyText(String.fromCodePoint(c.cps[0]), 'the character')));
    info.replaceChildren(h('div', { class: 'gtop' }, big, acts), table(rows));
    markUses();
}

// A glyph's ink, as the browser draws it: its extent about the pen's origin on
// the baseline, in ems – l and r across (l negative to the left of the
// origin), a above the baseline and d below. From the canvas's text metrics,
// which measure the glyph's outline in the loaded font. Null for no font.
const inkMemo = new Map();
let inkCtx = null;
function inkOf(family, cp) {
    if (!family || cp == null) return null;
    const k = family + ' ' + cp;
    if (inkMemo.has(k)) return inkMemo.get(k);
    inkCtx = inkCtx || document.createElement('canvas').getContext('2d');
    inkCtx.font = `100px '${family}'`;
    const m = inkCtx.measureText(String.fromCodePoint(cp));
    const ink = { l: -m.actualBoundingBoxLeft / 100, r: m.actualBoundingBoxRight / 100,
                  a: m.actualBoundingBoxAscent / 100, d: m.actualBoundingBoxDescent / 100 };
    const out = ink.r > ink.l && ink.a + ink.d > 0 ? ink : null;   // a space has none
    inkMemo.set(k, out);
    return out;
}
const svgNS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, a) => { const e = document.createElementNS(svgNS, tag); for (const [x, y] of Object.entries(a)) e.setAttribute(x, y); return e; };
// A table cell's glyph: at one size for all, on a common baseline – unless
// its ink would not fit, when it is shrunk to fit and centred.
function cellGlyph(cp, family) {
    const W = 40, H = 32, BASE = 22, top = 23;        // px; the baseline 23px down
    const ink = inkOf(family, cp);
    let F = BASE, x0 = -W / 2 + (ink ? (ink.l + ink.r) / 2 * BASE : BASE * 0.3), y0 = -top;
    if (ink) {
        const fits = ink.a * BASE <= top - 1 && ink.d * BASE <= H - top - 1 && (ink.r - ink.l) * BASE <= W - 2;
        if (!fits) {
            F = BASE * Math.min(1, (W - 4) / ((ink.r - ink.l) * BASE), (H - 4) / ((ink.a + ink.d) * BASE));
            x0 = (ink.l + ink.r) / 2 * F - W / 2;
            y0 = (ink.d - ink.a) / 2 * F - H / 2;
        }
    }
    const svg = svgEl('svg', { width: W, height: H, viewBox: `${x0.toFixed(2)} ${y0.toFixed(2)} ${W} ${H}`, 'aria-hidden': 'true' });
    const t = svgEl('text', { x: 0, y: 0, 'font-size': F.toFixed(2), fill: 'currentColor' });
    if (family) t.setAttribute('font-family', `'${family}'`);
    t.textContent = String.fromCodePoint(cp);
    svg.appendChild(t);
    return svg;
}
// A glyph drawn large: its ink whole, the box TeX gave it (dashed, for a
// glyph the documents use) and the baseline.
function glyphFigure(c, d) {
    if (!c.cps.length) return h('span', { class: 'big muted' }, 'no code point to draw it by');
    const em = (c.tex ? c.tex[0][0] : d.sizes[0] || 655360) / 65536;              // pt
    const adv = c.adv != null && d.upem ? c.adv / d.upem * em : null;
    const [w, ht, dp] = c.tex ? c.tex[0].slice(1).map(v => v / 65536) : [adv ?? em / 2, 0, 0];
    const ink = inkOf(d.family, c.cps[0]);
    let x0 = 0, x1 = w, y0 = -ht, y1 = dp;
    if (ink) { x0 = Math.min(x0, ink.l * em); x1 = Math.max(x1, ink.r * em); y0 = Math.min(y0, -ink.a * em); y1 = Math.max(y1, ink.d * em); }
    if (y1 - y0 < em * 0.05) { y0 = -em * 0.7; y1 = em * 0.2; }
    const pad = em * 0.15, W = x1 - x0 + 2 * pad, H = y1 - y0 + 2 * pad;
    const k = Math.min(120 / H, 260 / W, 8);   // px per pt
    const svg = svgEl('svg', { class: 'big', width: (W * k).toFixed(1), height: (H * k).toFixed(1), viewBox: `${x0 - pad} ${y0 - pad} ${W} ${H}` });
    const line = { 'vector-effect': 'non-scaling-stroke', fill: 'none', 'stroke-width': '1' };
    svg.append(svgEl('line', { ...line, x1: x0 - pad, x2: x1 + pad, y1: 0, y2: 0, class: 'base' }));
    if (c.tex) svg.append(svgEl('rect', { ...line, x: 0, y: -ht, width: Math.max(w, 0), height: ht + dp, class: 'tbox', 'stroke-dasharray': '3 2' }));
    const t = svgEl('text', { x: 0, y: 0, 'font-size': em, fill: 'currentColor' });
    if (d.family) t.setAttribute('font-family', `'${d.family}'`);
    t.textContent = String.fromCodePoint(c.cps[0]);
    svg.appendChild(t);
    const title = svgEl('title', {});
    title.textContent = c.tex ? `TeX's box: ${ptOf(c.tex[0][1])} × ${ptOf(c.tex[0][2])} + ${ptOf(c.tex[0][3])}, and the baseline` : 'the baseline (TeX gave it no box: the documents do not use it)';
    svg.appendChild(title);
    return svg;
}
// Where a glyph's ink goes past the box TeX gave it, at its first size.
function overhang(c, d) {
    const ink = inkOf(d.family, c.cps[0]);
    if (!ink) return null;
    const em = (c.tex ? c.tex[0][0] : d.sizes[0] || 655360) / 65536, pt = v => +v.toFixed(2) + 'pt';
    const out = [`${pt(ink.l * em)} to ${pt(ink.r * em)} across, ${pt(ink.a * em)} up, ${pt(ink.d * em)} down`];
    if (c.tex) {
        const [w, ht, dp] = c.tex[0].slice(1).map(v => v / 65536), past = [];
        const add = (v, side) => { if (v > 0.01) past.push(`${pt(v)} ${side}`); };
        add(-ink.l * em, 'left'); add(ink.r * em - w, 'right'); add(ink.a * em - ht, 'above'); add(ink.d * em - dp, 'below');
        out.push(past.length ? `past TeX's box: ${past.join(', ')}` : 'within TeX\'s box');
    }
    return out.join('; ');
}

function wireResources() {
    const b = $.rbody;
    $.filter.addEventListener('input', renderResList);
    $.fontSort.addEventListener('change', () => {
        try { localStorage.setItem(STORE + '-fontsort', $.fontSort.value); } catch { /* not remembered */ }
        renderResList();
    });
    $.filter.addEventListener('keydown', e => {
        if (e.key === 'Escape' && $.filter.value) { $.filter.value = ''; renderResList(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); b.focus(); }
    });
    b.addEventListener('click', e => {
        const head = e.target.closest('.rhead');
        if (head) { toggleCat(head.dataset.cat, e.altKey); return; }
        const r = e.target.closest('[data-key]');
        if (r) selectResource(r.dataset.key, { scroll: false });
    });
    // (over a heading, the hover stays as it was, like between glyphs)
    b.addEventListener('mousemove', e => { const r = e.target.closest('[data-key]'); if (r) hoverUses(r.dataset.key); });
    b.addEventListener('mouseleave', () => hoverUses(null));
    b.addEventListener('keydown', e => {
        const keys = [...b.querySelectorAll('[data-key]')].map(r => r.dataset.key), i = keys.indexOf(resSel);
        if (e.key === 'ArrowDown' && i < keys.length - 1) selectResource(keys[i + 1]);
        else if (e.key === 'ArrowUp' && i > 0) selectResource(keys[i - 1]);
        else return;
        e.preventDefault();
    });
}

// ── Picking and polling ────────────────────────────────────────────────────────
async function togglePick() {
    const st = await call('status');
    if (st === MISSING) return;
    await call(st.picking ? 'cancelPick' : 'pick');
    poll();
}
// A pick made in the page, and reflows (a resize re-breaks the lines), are
// noticed by polling while the panel is open.
async function poll() {
    if (!isOpen) return;
    syncTheme();
    const st = await call('status');
    if (st === MISSING) { $.status.textContent = 'no inspectable viewer'; $.pick.classList.remove('on'); return; }
    $.pick.classList.toggle('on', st.picking);
    // Blocks that start (or go) after the panel opened: the tree, and the
    // resources they bring, follow without being asked.
    if (st.blocks !== lastBlocks) {
        const first = lastBlocks === null;
        lastBlocks = st.blocks;
        if (!first) { followReflow(); if (view === 'res') loadResources(); }
    }
    $.status.textContent = st.picking ? 'click in the page · Esc cancels'
        : flash && Date.now() < flash.until ? flash.text : `${st.blocks} block${st.blocks === 1 ? '' : 's'}`;
    if (st.picked && st.picked.seq !== lastPickSeq) { lastPickSeq = st.picked.seq; setView('tree'); reveal(st.picked.path); }
}
// A reflow – the window resized, an example's width dragged – repaints the
// viewer's segments; the paint counter says so. Checked every frame while the
// panel is open, so the rows, the details and the outlines follow the text as
// it moves. One refresh at a time; one more if the layout moved meanwhile.
let refreshing = false, again = false;
function watchPaints() {
    if (!isOpen) return;
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
        do { again = false; await refresh(); if (view === 'res' && resSel) await markUses(); await call('redraw'); } while (again);
    } finally { refreshing = false; }
}

// ── Opening and closing ────────────────────────────────────────────────────────
async function open(block, { dock: where, scroll = true } = {}) {
    if (where) pageDock = where;
    if (!host) build();
    if (!isOpen) {
        // Last in the document, so nothing added since stacks above it.
        if (!docked && host !== document.documentElement.lastElementChild) document.documentElement.appendChild(host);
        root.hidden = false;
        isOpen = true;
        if (!docked) applyDock(chosenDock());
        syncTheme();
        pollTimer = setInterval(poll, 400);
        showSel = null; setShowSel(false);
        try { await refresh(); } catch (e) { $.status.textContent = String(e.message || e); return; }
        if (view === 'res') loadResources();
        applyGuides();
        lastPaints = null; lastBlocks = null;
        requestAnimationFrame(watchPaints);
        poll();
    }
    if (block) {
        setView('tree');
        // The block may still be initialising (fonts, first layout): wait a little.
        let path = null;
        for (let k = 0; k < 40 && !(path = await call('blockPath', block)); k++) await new Promise(r => setTimeout(r, 150));
        if (path && path !== MISSING) await reveal(path, { openLast: true, page: scroll });
    }
    if (!docked) $.tree.focus({ preventScroll: true });
}
// Part of the page rather than floating over it: inside `container`, filling
// it, open for good – no dragging, no closing, and the shortcut only focuses it.
async function dock(container, block) {
    if (!host) build();
    docked = true;
    root.classList.add('docked');
    // Its own stacking layer within the page, above the outlines it draws.
    host.style.cssText = 'display:block;position:relative;z-index:2147483647;width:100%;height:100%';
    container.appendChild(host);
    await open(block);
}
function closePanel() {
    if (!isOpen || docked) return;
    isOpen = false;
    root.hidden = true;
    release();
    clearInterval(pollTimer);
    call('cancelPick'); call('clear'); call('setOptions', { baselines: false, badness: false, springs: false });
    selected = null;
    placeholder();
    resSel = null; glyphSel = null;
}
const toggleOpen = () => (docked ? $.tree.focus() : isOpen ? closePanel() : open());

addEventListener('keydown', e => {
    if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyI') {
        e.preventDefault();
        toggleOpen();
    } else if (e.key === 'Escape' && isOpen && document.activeElement === host && !$.pick.classList.contains('on') && !menu
               && !(e.composedPath()[0] instanceof HTMLInputElement)) {
        // (while picking, Esc cancels the pick – the agent's; in a search
        // field, it clears the field)
        closePanel();
    }
}, true);

api.inspector = { open, close: closePanel, toggle: toggleOpen, setDock, dock, shortcut: SHORTCUT };
})();
