// SPDX-License-Identifier: AGPL-3.0-or-later
// Reflow TeX inspector – a floating panel that shows the boxes and glue
// behind the blocks on the page (see README.md).
//
// Include it after latex-viewer.js. It costs nothing until opened: the
// panel, its stylesheet and the page agent (agent.js, loaded from beside this
// file) are made on first use. Open it with Alt+Shift+I (⌥⇧I on a Mac), or
// from a page's own controls through window.reflowtex.inspector:
//
//   reflowtex.inspector.open(blockEl?)   open; with a block, show that block
//   reflowtex.inspector.close()
//   reflowtex.inspector.toggle()
//   reflowtex.inspector.dock(el, block?) put the panel inside el, open for
//                                        good (a page about the inspector)
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
let agentLoading = null;
function loadAgent() {
    if (window.__rtxInspectorInstall) return Promise.resolve();
    return agentLoading = agentLoading || new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = asset('agent.js');
        s.onload = resolve;
        s.onerror = () => { agentLoading = null; reject(new Error('could not load the inspector agent')); };
        document.head.appendChild(s);
    });
}
const MISSING = Symbol('missing');
async function call(method, ...args) {
    await loadAgent();
    let a = window.__rtxInspector;
    if (!a && window.__rtxInspectorInstall() === 'ok') a = window.__rtxInspector;
    return a ? a[method](...args) : MISSING;
}

// ── The panel ──────────────────────────────────────────────────────────────────
let host = null, root = null, $ = null, isOpen = false, docked = false, pollTimer = 0;
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
const ICON_PICK = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M2 2h8v2H4v6H2zM7 7l7 3-3 1-1 3z" fill="currentColor"/></svg>';
const ICON_REFRESH = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2v3h-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function build() {
    host = document.createElement('div');
    host.setAttribute('data-rtx-ui', '');
    // A stacking layer of its own, on top: above the page, and above the
    // agent's outlines (z-index one lower, and inserted before this).
    host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647';
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.appendChild(h('link', { rel: 'stylesheet', href: asset('inspector.css') }));
    const pick = h('button', { type: 'button', title: 'Pick a box or glue in the page (Esc cancels)', onclick: togglePick });
    pick.innerHTML = ICON_PICK + ' Pick';
    const refreshBtn = h('button', { type: 'button', title: 'Reload the tree', 'aria-label': 'Refresh', onclick: () => refresh() });
    refreshBtn.innerHTML = ICON_REFRESH;
    // Page-wide guides, remembered like the panel's place.
    const guide = (key, label, title) => {
        const b = h('button', { type: 'button', class: 'toggle', title, 'aria-pressed': 'false',
                                onclick: () => setGuide(key, b.getAttribute('aria-pressed') !== 'true') }, label);
        b.dataset.guide = key;
        return b;
    };
    const baselines = guide('baselines', 'Baselines', 'Show the baseline of every line');
    const badness = guide('badness', 'Badness', 'A bar past every line, coloured by its badness: green decent, amber loose or tight, red 100 or more, purple overfull');
    const status = h('span', { class: 'status' });
    const close = h('button', { type: 'button', class: 'close', title: `Close (${SHORTCUT})`, 'aria-label': 'Close', onclick: () => closePanel() }, '×');
    const bar = h('div', { class: 'bar' }, h('span', { class: 'title' }, 'Inspector'), pick, refreshBtn, baselines, badness, status, close);
    const tree = h('section', { class: 'tree', role: 'tree', tabindex: '0', 'aria-label': 'Boxes and glue' });
    const details = h('aside', { class: 'details' });
    root = h('div', { class: 'rtx', role: 'dialog', 'aria-label': 'Reflow TeX inspector' }, bar, h('div', { class: 'main' }, tree, details));
    root.hidden = true;
    shadow.appendChild(root);
    document.documentElement.appendChild(host);
    $ = { pick, status, tree, details, bar };
    placeholder();
    wireTree();
    wireMove();
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
    if (docked) return;
    w = w ?? root.offsetWidth; ht = ht ?? root.offsetHeight;
    x = Math.max(8 - w + 80, Math.min(x, innerWidth - 80));   // keep a grip on screen
    y = Math.max(8, Math.min(y, innerHeight - 40));
    Object.assign(root.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: ht + 'px' });
}
function saveGeometry() {
    if (docked) return;
    try {
        localStorage.setItem(STORE, JSON.stringify({ x: root.offsetLeft, y: root.offsetTop, w: root.offsetWidth, h: root.offsetHeight }));
    } catch { /* private mode: not remembered */ }
}
function wireMove() {
    let drag = null;
    $.bar.addEventListener('pointerdown', e => {
        if (docked || e.button !== 0 || e.target.closest('button')) return;
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
    addEventListener('resize', () => { if (isOpen) place(root.offsetLeft, root.offsetTop); });
}

function loadGuides() {
    try { return JSON.parse(localStorage.getItem(STORE + '-guides') || '{}') || {}; } catch { return {}; }
}
async function setGuide(key, on) {
    const g = { baselines: false, badness: false, ...loadGuides(), [key]: on };
    try { localStorage.setItem(STORE + '-guides', JSON.stringify(g)); } catch { /* not remembered */ }
    await applyGuides(g);
}
async function applyGuides(g = loadGuides()) {
    for (const b of $.bar.querySelectorAll('[data-guide]')) b.setAttribute('aria-pressed', String(!!g[b.dataset.guide]));
    await call('setOptions', { baselines: !!g.baselines, badness: !!g.badness });
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
let roots = [], selected = null, lastPaints = null, lastPickSeq = 0, hoverId = null;

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
async function select(id, { scroll = true } = {}) {
    selected = id;
    for (const r of $.tree.querySelectorAll('[data-id].sel')) r.classList.remove('sel');
    const row = $.tree.querySelector(`[data-id="${id}"]`);
    if (row) { row.classList.add('sel'); if (scroll) row.scrollIntoView({ block: 'nearest' }); }
    await call('select', id);
    showDetails(id);
}
function placeholder() {
    $.details.replaceChildren(h('p', { class: 'muted' }, 'Select a row, or ', h('b', {}, 'Pick'),
        ' a box or glue in the page. ', h('kbd', {}, SHORTCUT), ' opens and closes this panel.'), legend());
}
async function showDetails(id) {
    const d = await call('details', id);
    if (!d || d === MISSING) { $.details.replaceChildren(h('p', { class: 'muted' }, 'Gone – the layout changed.')); return; }
    const t = h('table');
    for (const [k, v] of d.rows) { const tr = t.insertRow(); tr.insertCell().textContent = k; tr.insertCell().textContent = v; }
    $.details.replaceChildren(h('h2', {}, `${d.summary.label}  ${d.summary.note}`), t, legend());
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
// Expand along a path (block → … → node) and select its end.
async function reveal(path, { openLast = false } = {}) {
    if (!path || !path.length) return;
    if (!roots.includes(path[0])) await refresh();
    const upto = openLast ? path : path.slice(0, -1);
    for (const id of upto) {
        const n = nodes.get(id);
        if (!n) return;
        if (n.s.hasChildren) { if (!n.kids) await loadKids(id); n.open = true; }
    }
    render();
    await select(path[path.length - 1]);
}
function wireTree() {
    const t = $.tree;
    // A row, or one letter of a run: both carry data-id.
    t.addEventListener('click', e => {
        const row = e.target.closest('[data-id]');
        if (!row) return;
        const id = +row.dataset.id;
        if (e.target.classList.contains('twisty')) toggle(id); else select(id, { scroll: false });
    });
    t.addEventListener('dblclick', e => { const row = e.target.closest('[data-id]'); if (row) toggle(+row.dataset.id); });
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
    $.status.textContent = st.picking ? 'click in the page · Esc cancels' : `${st.blocks} block${st.blocks === 1 ? '' : 's'}`;
    if (st.picked && st.picked.seq !== lastPickSeq) { lastPickSeq = st.picked.seq; reveal(st.picked.path); }
    if (lastPaints !== null && st.paints !== lastPaints) refreshSoon();
    lastPaints = st.paints;
}
let refreshTimer = 0;
function refreshSoon() { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 250); }

// ── Opening and closing ────────────────────────────────────────────────────────
async function open(block) {
    if (!host) build();
    if (!isOpen) {
        // Last in the document, so nothing added since stacks above it.
        if (!docked && host !== document.documentElement.lastElementChild) document.documentElement.appendChild(host);
        root.hidden = false;
        isOpen = true;
        if (!docked) loadGeometry();
        syncTheme();
        pollTimer = setInterval(poll, 400);
        try { await refresh(); } catch (e) { $.status.textContent = String(e.message || e); return; }
        applyGuides();
        poll();
    }
    if (block) {
        // The block may still be initialising (fonts, first layout): wait a little.
        let path = null;
        for (let k = 0; k < 40 && !(path = await call('blockPath', block)); k++) await new Promise(r => setTimeout(r, 150));
        if (path && path !== MISSING) await reveal(path, { openLast: true });
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
    clearInterval(pollTimer);
    call('cancelPick'); call('clear'); call('setOptions', { baselines: false, badness: false });
    selected = null;
    placeholder();
}
const toggleOpen = () => (docked ? $.tree.focus() : isOpen ? closePanel() : open());

addEventListener('keydown', e => {
    if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyI') {
        e.preventDefault();
        toggleOpen();
    } else if (e.key === 'Escape' && isOpen && document.activeElement === host && !$.pick.classList.contains('on')) {
        // (while picking, Esc cancels the pick – the agent's)
        closePanel();
    }
}, true);

api.inspector = { open, close: closePanel, toggle: toggleOpen, dock, shortcut: SHORTCUT };
})();
