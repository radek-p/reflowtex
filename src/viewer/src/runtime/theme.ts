// SPDX-License-Identifier: AGPL-3.0-or-later
// The reader's colour theme (the README's Theming).
//
// A theme is a class on <html> (none for `default`) and data-theme, which the
// colour maps' rules key on (colour.ts) and a page's own CSS can too. The
// reader chooses a theme, or `system`: then one theme while the system is in
// light mode and another while it is dark – the two slots, `light` and `dark`.
// This is the one place the page's theme is set and kept: the companion's
// reading options, the inspector and a page's own switcher call it.
//
// On a page that asks for the reader's settings, the choice and the slots
// are remembered (localStorage), as the reader's other settings are; the page
// asks, and gives their first values, on <html>:
//
//   <html data-latex-theme-choice="system" data-latex-theme-light="default" data-latex-theme-dark="dark">
//
// or with reflowtex.rememberTheme(). Anywhere else nothing is read or
// written: a host keeps its own settings and calls setTheme, which only
// applies the theme. The viewer sets the page's theme only once asked (the
// attribute, or a call); a page that themes itself is left alone.
import { api } from './page.ts';
import { DEFAULT_THEME } from './builtin-colour-maps.ts';
import { mapThemes } from './colour.ts';

export const SYSTEM = 'system';
const KEYS = { choice: 'reflowtex-theme', light: 'reflowtex-theme-light', dark: 'reflowtex-theme-dark' } as const;
/** For a reader who has chosen nothing, on a page that gives nothing:
 *  TeX's colours unless the system is dark. */
const FIRST = { choice: SYSTEM, light: DEFAULT_THEME, dark: 'dark' } as const;

export interface ThemeState {
    /** A theme's name, or 'system'. */
    choice: string;
    /** The theme shown now. */
    theme: string;
    /** The themes used in the system mode while the system is light, and dark. */
    light: string;
    dark: string;
}

const load = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const save = (k: string, v: string): void => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } };
const root = () => document.documentElement;
const NAME = /^[\w-]+$/;
const valid = (t: string | null | undefined): t is string => typeof t === 'string' && NAME.test(t);
// whether the reader's settings are kept: the page asked
let remember = typeof document !== 'undefined' && root().hasAttribute('data-latex-theme-choice');
const first = (k: keyof typeof KEYS): string => {
    const v = (remember ? load(KEYS[k]) : null) ?? root().getAttribute(`data-latex-theme-${k}`);
    return valid(v) ? v : FIRST[k];
};

let managed = remember;
const state = { choice: first('choice'), light: first('light'), dark: first('dark') };
const darkSystem = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

/** The theme shown for a choice: the system's slot, or the theme itself. */
function shown(): string {
    if (state.choice !== SYSTEM) return state.choice;
    return darkSystem?.matches ? state.dark : state.light;
}

/** The themes a reader may choose from: default, the colour maps' themes. */
export function themes(): string[] { return mapThemes(); }

export function theme(): ThemeState { return { ...state, theme: managed ? shown() : pageTheme() }; }

/** The page's theme as <html> has it, whoever set it. */
function pageTheme(): string {
    const r = root(), a = r.getAttribute('data-theme');
    if (valid(a)) return a;
    return themes().find(t => t !== DEFAULT_THEME && r.classList.contains(t)) ?? DEFAULT_THEME;
}

function apply(): void {
    if (!managed) return;
    const r = root(), t = shown();
    for (const name of new Set([...themes(), state.light, state.dark, state.choice]))
        if (name !== t) r.classList.remove(name);
    if (t !== DEFAULT_THEME) r.classList.add(t);
    r.setAttribute('data-theme', t);
    document.dispatchEvent(new CustomEvent('reflowtex:theme', { detail: theme() }));
}

/** The reader's choice: a theme, or 'system'; remembered, and applied. */
export function setTheme(choice: string): void {
    if (!valid(choice)) throw new TypeError(`setTheme: a theme's name or 'system', not ${JSON.stringify(choice)}`);
    state.choice = choice;
    if (remember) save(KEYS.choice, choice);
    managed = true;
    apply();
}

/** The two themes of the system mode; remembered, and applied. */
export function setSystemThemes(slots: { light?: string; dark?: string }): void {
    for (const k of ['light', 'dark'] as const) {
        const t = slots[k];
        if (t === undefined) continue;
        if (!valid(t) || t === SYSTEM) throw new TypeError(`setSystemThemes: ${k} is a theme's name, not ${JSON.stringify(t)}`);
        state[k] = t;
        if (remember) save(KEYS[k], t);
    }
    managed = true;
    apply();
}

/** Keep the reader's settings on this page from now on (as
 *  data-latex-theme-choice asks at load): the ones remembered are read and
 *  applied, and every change is remembered. */
export function rememberTheme(): void {
    remember = true;
    for (const k of ['choice', 'light', 'dark'] as const) {
        const v = load(KEYS[k]);
        if (valid(v)) state[k] = v;
    }
    managed = true;
    apply();
}

darkSystem?.addEventListener('change', () => { if (state.choice === SYSTEM) apply(); });
apply();

api.theme = theme;
api.themes = themes;
api.setTheme = setTheme;
api.setSystemThemes = setSystemThemes;
api.rememberTheme = rememberTheme;
