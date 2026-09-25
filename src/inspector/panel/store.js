// SPDX-License-Identifier: AGPL-3.0-or-later
// The panel's shared state: signals that any part reads and writes. The
// components render from them; a change re-renders only what reads it.
// What the reader chooses is remembered per browser under STORE-*.
import { signal } from '../vendor/preact.js';

const STORE = 'reflowtex-inspector';
const keyOf = k => (k ? `${STORE}-${k}` : STORE);
export function recall(k, fallback, parse = JSON.parse) {
    try { const v = localStorage.getItem(keyOf(k)); return v == null ? fallback : parse(v); } catch { return fallback; }
}
export function keep(k, v, str = JSON.stringify) {
    try { localStorage.setItem(keyOf(k), str(v)); } catch { /* private mode: not remembered */ }
}
export const plain = v => v;                  // (for values stored as they are)

export const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const SHORTCUT = IS_MAC ? '⌥⇧I' : 'Alt+Shift+I';
export const COPY_KEY = IS_MAC ? '⌘C' : 'Ctrl+C';

// ── The panel ──────────────────────────────────────────────────────────────────
export const isOpen = signal(false);
export const view = signal(recall('view', 'tree', plain) === 'res' ? 'res' : 'tree');   // 'tree' | 'res'
export const dark = signal(false);
// the page overlays: { baselines, badness, springs }
export const guides = signal({ baselines: false, badness: false, springs: false, ...recall('guides', {}) });

// ── What the page's agent says ─────────────────────────────────────────────────
export const picking = signal(false);
export const blocks = signal(null);            // how many; null before the first answer
export const noViewer = signal(false);

// ── The status line ────────────────────────────────────────────────────────────
// A message it shows for a moment instead of the block count.
export const flash = signal(null);
let flashTimer = 0;
export function say(text, ms = 2500) {
    flash.value = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { if (flash.value === text) flash.value = null; }, ms);
}

// ── The open menu ──────────────────────────────────────────────────────────────
// { kind: 'overlays' | 'dock' | 'row', anchor?: element, x?, y?, id? } or null
export const menu = signal(null);

// Elements the panel's parts hand focus to (set by the components).
export const refs = { root: null, tree: null, rbody: null };
