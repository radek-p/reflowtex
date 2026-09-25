// SPDX-License-Identifier: AGPL-3.0-or-later
// Where the panel sits: floating over the page, docked to an edge of the
// window, or embedded in a page's element (dock()). The place and the sizes
// are signals; the panel's style follows them, and so does the room the
// page keeps for a docked panel.
import { signal, computed, effect } from '../vendor/preact.js';
import { isOpen, recall, keep, plain } from './store.js';

export const SIDES = ['float', 'left', 'bottom', 'right'];
export const SIDE_TITLES = { float: 'Float over the page', left: 'Dock to left', bottom: 'Dock to bottom', right: 'Dock to right' };

export const embedded = signal(false);         // inside a page's element, open for good
export const side = signal('float');           // where it is now
const geom = signal(null);                     // floating: { x, y, w, h }
const size = signal(0);                        // docked: its width, or its height at the bottom

// The window a docked panel is placed in, as position: fixed sees it: without
// the page's scroll bar, and unchanged by a phone zooming out to fit a page
// that is wider than the screen for a moment (innerWidth is not).
const viewport = () => ({ w: document.documentElement.clientWidth, h: document.documentElement.clientHeight });

// ── Choosing the place ─────────────────────────────────────────────────────────
// The reader's choice, remembered per browser; until they make one, the
// page's (open's `dock`), and floating if it names none. 'auto' is the right
// edge, or the bottom in a portrait window.
let pageDock = 'float';
export const setPageDock = where => { pageDock = where; };
export function chosenDock() {
    let m = recall('dock', null, plain);
    if (!SIDES.includes(m)) m = pageDock;
    if (m === 'auto') { const vp = viewport(); m = vp.w >= vp.h ? 'right' : 'bottom'; }
    return SIDES.includes(m) ? m : 'float';
}
export function setDock(mode) {
    if (!SIDES.includes(mode)) return;
    keep('dock', mode, plain);
    if (isOpen.value && !embedded.value) applyDock(mode);
}
export function applyDock(mode) {
    side.value = mode;
    if (mode === 'float') geom.value = floating(recall(null, null));
    else size.value = dockSize(mode);
}

// ── Floating ───────────────────────────────────────────────────────────────────
// Remembered, clamped to the window with a grip left on screen. By default,
// the bottom right corner – above where a page tends to keep a floating
// button of its own.
function floating(g) {
    const vw = innerWidth, vh = innerHeight;
    const w = Math.min(g && g.w || 620, vw - 16), h = Math.min(g && g.h || Math.round(vh * 0.45), vh - 84);
    const x = g && g.x != null ? g.x : vw - w - 16, y = g && g.y != null ? g.y : Math.max(8, vh - h - 76);
    return { w, h, x: Math.max(8 - w + 80, Math.min(x, vw - 80)), y: Math.max(8, Math.min(y, vh - 40)) };
}
const saveGeom = () => keep(null, geom.value);
// Dragged by the toolbar (not by its buttons).
export function startMove(e) {
    if (embedded.value || side.value !== 'float' || e.button !== 0 || e.target.closest('button')) return;
    const bar = e.currentTarget, g = geom.value, dx = e.clientX - g.x, dy = e.clientY - g.y;
    bar.setPointerCapture(e.pointerId);
    e.preventDefault();
    const move = ev => { geom.value = floating({ ...geom.value, x: ev.clientX - dx, y: ev.clientY - dy }); };
    const end = () => {
        bar.removeEventListener('pointermove', move);
        bar.removeEventListener('pointerup', end);
        bar.removeEventListener('pointercancel', end);
        saveGeom();
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
}
// The native resize grip (CSS resize): the size it leaves, remembered.
let saveTimer = 0;
export function resized(el) {
    const g = geom.value;
    if (side.value !== 'float' || embedded.value || !g || el.hidden) return;
    if (g.w === el.offsetWidth && g.h === el.offsetHeight) return;
    geom.value = { ...g, w: el.offsetWidth, h: el.offsetHeight };
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveGeom, 300);
}

// ── Docked to an edge ──────────────────────────────────────────────────────────
// Width (left, right) or height (bottom): as asked, as remembered, or a third
// of the window or so – always leaving the page some room. The left and the
// right share their width: moving the panel across keeps its size.
const slot = s => (s === 'bottom' ? 'bottom' : 'side');
const remembered = s => { const m = recall('docksize', {}); return s === 'bottom' ? m.bottom : m.side ?? m.right ?? m.left; };
function dockSize(s, want) {
    const vp = viewport(), across = s === 'bottom' ? vp.h : vp.w;
    const n = want ?? remembered(s)
        ?? (s === 'bottom' ? Math.round(vp.h * 0.42) : Math.max(300, Math.min(460, Math.round(vp.w * 0.36))));
    const least = Math.min(s === 'bottom' ? 120 : 260, across / 2);
    return Math.round(Math.max(least, Math.min(n, across - (s === 'bottom' ? 120 : 240))));
}
// The grip on the side facing the page sets the size: one layout of the page
// per frame, however fast the pointer moves.
export function startSize(e) {
    const s = side.value;
    if (s === 'float' || e.button !== 0) return;
    const grip = e.currentTarget;
    grip.setPointerCapture(e.pointerId);
    e.preventDefault();
    let want = null, frame = 0;
    const move = ev => {
        const vp = viewport();
        want = s === 'left' ? ev.clientX : s === 'right' ? vp.w - ev.clientX : vp.h - ev.clientY;
        frame = frame || requestAnimationFrame(() => { frame = 0; size.value = dockSize(s, want); });
    };
    const end = () => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', end);
        grip.removeEventListener('pointercancel', end);
        keep('docksize', { ...recall('docksize', {}), [slot(s)]: size.value });
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
}

// ── The panel's style, and the page's room ─────────────────────────────────────
export const panelStyle = computed(() => {
    if (embedded.value) return '';
    const s = side.value;
    if (s === 'float') { const g = geom.value; return g ? `left:${g.x}px;top:${g.y}px;width:${g.w}px;height:${g.h}px` : ''; }
    return s === 'bottom' ? `left:0;right:0;bottom:0;height:${size.value}px` : `top:0;bottom:0;${s}:0;width:${size.value}px`;
});
// The page keeps the rest of the window: <html> gets padding on the panel's
// side, so the page lays out in the room left (its blocks re-break to it) and
// its end scrolls clear of a bottom panel. The size is published as a CSS
// variable too – --rtx-dock-left, -right or -bottom – for what the page fixes
// to the window, such as a floating button.
const PAD = { left: 'paddingLeft', right: 'paddingRight', bottom: 'paddingBottom' };
let reserved = null;                           // { side, before: <html>'s own inline padding there }
function reserve(s, n) {
    const de = document.documentElement;
    if (reserved && reserved.side !== s) release();
    if (!reserved) reserved = { side: s, before: de.style[PAD[s]] };
    de.style[PAD[s]] = n + 'px';
    de.style.setProperty('--rtx-dock-' + s, n + 'px');
}
function release() {
    if (!reserved) return;
    const de = document.documentElement;
    de.style[PAD[reserved.side]] = reserved.before;
    de.style.removeProperty('--rtx-dock-' + reserved.side);
    reserved = null;
}
effect(() => {
    const s = side.value, n = size.value;
    if (isOpen.value && !embedded.value && s !== 'float') reserve(s, n);
    else release();
});

// Turning a phone moves an 'auto' panel between the side and the bottom; any
// other resize keeps it in the window.
addEventListener('resize', () => {
    if (!isOpen.value || embedded.value) return;
    const m = chosenDock();
    if (m !== side.value) applyDock(m);
    else if (m === 'float') { if (geom.value) geom.value = floating(geom.value); }
    else size.value = dockSize(m, size.value);
});
