// SPDX-License-Identifier: AGPL-3.0-or-later
// The panel's shared state: signals that any part reads and writes. The
// components render from them; a change re-renders only what reads it.
// What the reader chooses is remembered per browser under STORE-*.
import { signal } from '../vendor/preact.js';
import type { Options } from '../protocol.ts';

const STORE = 'reflowtex-inspector';
const keyOf = (k: string | null | undefined): string => (k ? `${STORE}-${k}` : STORE);
export function recall<T>(k: string | null, fallback: T, parse: (s: string) => T = JSON.parse): T {
    try { const v = localStorage.getItem(keyOf(k)); return v == null ? fallback : parse(v); } catch { return fallback; }
}
export function keep<T>(k: string | null, v: T, str: (v: T) => string = JSON.stringify): void {
    try { localStorage.setItem(keyOf(k), str(v)); } catch { /* private mode: not remembered */ }
}
export const plain = <T>(v: T): T => v;                  // (for values stored as they are)

export const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const SHORTCUT = IS_MAC ? '⌥⇧I' : 'Alt+Shift+I';
export const COPY_KEY = IS_MAC ? '⌘C' : 'Ctrl+C';

// ── The panel ──────────────────────────────────────────────────────────────────
export const isOpen = signal(false);
export const view = signal<'tree' | 'res'>(recall<string>('view', 'tree', plain) === 'res' ? 'res' : 'tree');   // 'tree' | 'res'
export const dark = signal(false);
// the page overlays: { baselines, badness, springs, a11y }
export type Guides = Pick<Options, 'baselines' | 'badness' | 'springs' | 'a11y'>;
export const guides = signal<Guides>({ baselines: false, badness: false, springs: false, a11y: false, ...recall<Partial<Guides>>('guides', {}) });

// ── What the page's agent says ─────────────────────────────────────────────────
export const picking = signal(false);
export const blocks = signal<number | null>(null);            // how many; null before the first answer
export const noViewer = signal(false);

// ── The status line ────────────────────────────────────────────────────────────
// A message it shows for a moment instead of the block count.
export const flash = signal<string | null>(null);
let flashTimer = 0;
export function say(text: string, ms = 2500): void {
    flash.value = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { if (flash.value === text) flash.value = null; }, ms);
}

// ── The open menu ──────────────────────────────────────────────────────────────
// { kind: 'overlays' | 'dock' | 'row', anchor?: element, x?, y?, id? } or null
export interface Menu { kind: 'overlays' | 'dock' | 'row'; anchor?: HTMLElement; x?: number; y?: number; id?: number }
export const menu = signal<Menu | null>(null);

// Elements the panel's parts hand focus to (set by the components).
export const refs: { root: HTMLElement | null; tree: HTMLElement | null; rbody: HTMLElement | null } = { root: null, tree: null, rbody: null };
