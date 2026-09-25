// SPDX-License-Identifier: AGPL-3.0-or-later
// Small parts the views share: icons, buttons, tables, menus, the clipboard.
import { html, useLayoutEffect, useRef } from '../vendor/preact.js';
import { menu, refs, say } from './store.js';

// ── Icons ──────────────────────────────────────────────────────────────────────
// Drawn like Chrome DevTools' (16px on a 20px grid).
const Svg = ({ size = 16, children }) =>
    html`<svg viewBox="0 0 20 20" width=${size} height=${size} aria-hidden="true">${children}</svg>`;
const stroke = { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 };
// Chrome's "Select an element in the page": a box, and the pointer going in.
export const IconPick = () => html`<${Svg}>
    <path d="M8.5 16.5h-4a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4" ...${stroke}/>
    <path d="M10 10l8 3.1-3.3 1.4-1.4 3.4z" fill="currentColor"/><//>`;
export const IconClose = () => html`<${Svg}><path d="M5 5l10 10M15 5L5 15" ...${stroke} stroke-linecap="round"/><//>`;
export const IconCheck = () => html`<${Svg} size=${14}>
    <path d="M4.5 10.5l3.5 3.5 7.5-8" ...${stroke} stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><//>`;
export const Caret = () => html`<svg viewBox="0 0 8 8" width="8" height="8" aria-hidden="true">
    <path d="M1 2.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>`;
// Chrome's "Dock side": a window, with the panel's place filled in.
const DOCK_FILL = {
    float: html`<rect x="6" y="7" width="8" height="6" rx="1" fill="currentColor"/>`,
    left: html`<rect x="3" y="4" width="5.5" height="12" fill="currentColor"/>`,
    bottom: html`<rect x="3" y="10" width="14" height="6" fill="currentColor"/>`,
    right: html`<rect x="11.5" y="4" width="5.5" height="12" fill="currentColor"/>`,
};
export const IconDock = ({ side }) => html`<${Svg}>
    <rect x="2.5" y="3.5" width="15" height="13" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/>
    ${DOCK_FILL[side]}<//>`;

// ── Buttons and tables ─────────────────────────────────────────────────────────
// A toolbar button: an icon, 28px, its title its name.
export const IconButton = ({ class: cls = '', title, children, ...rest }) =>
    html`<button type="button" class=${'ib ' + cls} title=${title} aria-label=${title} ...${rest}>${children}</button>`;
// A button in a details pane's heading.
export const Action = ({ title, onClick, children }) =>
    html`<button type="button" class="copy" title=${title} onClick=${onClick}>${children}</button>`;
export const Table = ({ rows }) => html`<table><tbody>
    ${rows.map(([k, v], i) => html`<tr key=${i}><td>${k}</td><td>${v}</td></tr>`)}
</tbody></table>`;
export const Muted = ({ children }) => html`<p class="muted">${children}</p>`;
// A details pane's heading: a title, and its buttons.
export const Head = ({ title, children }) =>
    html`<div class="dhead"><h2>${title}</h2><div class="actions">${children}</div></div>`;

// ── Menus ──────────────────────────────────────────────────────────────────────
// One menu is open at a time (the `menu` signal); the panel draws it. A
// toolbar button toggles its menu: a second click closes it – and since the
// press that closed it (a press outside the menu) is that click's own, a
// click just after a close does not open it again.
let closed = null;
export function closeMenu() {
    const m = menu.value;
    if (!m) return;
    menu.value = null;
    closed = { anchor: m.anchor, at: performance.now() };
}
export function toggleMenu(kind, anchor) {
    const m = menu.value;
    if (m && m.anchor === anchor) { closeMenu(); return; }                // (from the keyboard)
    if (closed && closed.anchor === anchor && performance.now() - closed.at < 400) { closed = null; return; }
    menu.value = { kind, anchor };
}
export const menuOpen = kind => !!menu.value && menu.value.kind === kind;

// A menu's frame: inside the panel, clear of its edges – under its button
// (right-aligned for one in the toolbar's corner) or at a point (a right
// click). It takes focus as it opens; the arrow keys go from item to item,
// Esc closes it and gives focus back.
export function MenuBox({ label, children }) {
    const box = useRef(null);
    const m = menu.value;
    useLayoutEffect(() => {
        const el = box.current, rr = refs.root.getBoundingClientRect(), mw = el.offsetWidth, mh = el.offsetHeight;
        let x, y;
        if (m.anchor) {
            const ar = m.anchor.getBoundingClientRect();
            x = m.anchor.closest('.corner') ? ar.right - rr.left - mw : ar.left - rr.left;
            y = ar.bottom - rr.top + 2;
        } else { x = m.x - rr.left; y = Math.min(m.y - rr.top, rr.height - mh - 4); }
        el.style.left = Math.max(4, Math.min(x, rr.width - mw - 4)) + 'px';
        el.style.top = Math.max(4, y) + 'px';
        const first = el.querySelector('[aria-checked="true"], [aria-pressed="true"], button');
        if (first) first.focus({ preventScroll: true });
    }, [m]);
    const onKeyDown = e => {
        const items = [...box.current.querySelectorAll('button')], i = items.indexOf(e.composedPath()[0]);
        if (e.key === 'Escape') {
            e.stopPropagation();
            const back = m.anchor || refs.tree;
            closeMenu();
            if (back) back.focus({ preventScroll: true });
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') items[(i + 1) % items.length].focus();
        else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') items[(i - 1 + items.length) % items.length].focus();
        else return;
        e.preventDefault();
    };
    return html`<div class="menu" role="menu" aria-label=${label} ref=${box} onKeyDown=${onKeyDown}>${children}</div>`;
}

// ── The clipboard ──────────────────────────────────────────────────────────────
export async function copyText(text, what) {
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; }
    catch {                                         // no async clipboard (not a secure page): the old way
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.cssText = 'position:fixed;opacity:0';
        refs.root.appendChild(ta); ta.select();
        try { ok = document.execCommand('copy'); } catch { ok = false; }
        ta.remove();
    }
    const lines = text.split('\n').length;
    say(ok ? `copied ${lines} line${lines === 1 ? '' : 's'} of ${what}` : 'could not copy', 2000);
}
