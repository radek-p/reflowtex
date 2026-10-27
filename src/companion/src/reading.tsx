// SPDX-License-Identifier: AGPL-3.0-or-later
// Reading options: the reader's colour theme, text size and column width,
// and the controls for them.
//
//   reading                      the state, as signals, with setters: applied
//                                to the page and remembered (localStorage)
//   <ReadingOptions width inspect themes />
//                                the controls, as rows (a panel's content, or
//                                a card of their own)
//   <ReadingButton … />          a round "Aa" button in the corner opening
//                                them in a panel
//
// Declared in HTML, without a script of one's own:
//   <div data-rtx="reading-button" data-width="true"></div>
//   <div data-rtx="reading-options" data-inspect="false"></div>
// (the companion draws every [data-rtx] element when it loads: mount.ts).
//
// How the page follows the state, so its CSS can: the theme is a class on
// <html> (none for default) and data-theme, set by the viewer, which keeps
// the reader's choice – a theme, or the system mode with its two themes
// (reflowtex.setTheme, its README's Theming); the text size is --rtx-zoom on
// <html> (1 = 100%); the width is data-width on <html>. Every change but the
// theme also sends a window resize, so the viewer lays the text out again.
// For no flash before the module has loaded, a page sets the saved state
// itself first, from the same localStorage keys (the website's head.html
// does).
import { signal, useSignal, type Signal } from '@preact/signals';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';

const KEYS = { theme: 'reflowtex-theme', themeLight: 'reflowtex-theme-light', themeDark: 'reflowtex-theme-dark', zoom: 'reflowtex-zoom', width: 'reflowtex-width', selection: 'reflowtex-selection',
    math: 'reflowtex-a11y-math' };
const ZOOM = { min: 0.5, max: 3, step: 1.1 };

export interface Theme { name: string; label?: string }
export const THEMES: Theme[] = [{ name: 'default' }, { name: 'light' }, { name: 'dark' }, { name: 'sepia' }, { name: 'contrast' }];
/** The choice that follows the system: one theme while it is light, another while it is dark. */
export const SYSTEM = 'system';
export const WIDTHS = ['auto', 'narrow', 'normal', 'wide'];
/** How selected text looks: the browser's own highlight, or the viewer's
 *  even bands (data-latex-selection on <html>; the viewer's host/selection.ts). */
export const SELECTIONS = [{ name: 'native', label: 'Browser' }, { name: 'bands', label: 'Even' }];
// How a screen reader is given formulas, on a page with the accessible layer:
// the viewer's reflowtex.setAccessibleMath, which remembers it.
export const MATH_MODES = [{ name: 'mathml', label: 'MathML' }, { name: 'spoken', label: 'Spoken text' }];

const load = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const save = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const html = () => document.documentElement;
const resize = () => window.dispatchEvent(new Event('resize'));

// The viewer's, when the page has it: it keeps the theme (and says when it
// changes: reflowtex:theme).
const viewerTheme = () => window.reflowtex?.theme?.();
function initialTheme(): string {
    return viewerTheme()?.theme || html().getAttribute('data-theme') || 'default';
}
function initialChoice(): string {
    return viewerTheme()?.choice || load(KEYS.theme) || html().getAttribute('data-latex-theme-choice') || SYSTEM;
}
function initialSystem(): { light: string; dark: string } {
    const v = viewerTheme();
    return { light: v?.light || load(KEYS.themeLight) || 'default', dark: v?.dark || load(KEYS.themeDark) || 'dark' };
}
function initialZoom(): number {
    const z = parseFloat(html().style.getPropertyValue('--rtx-zoom')) || parseFloat(load(KEYS.zoom) || '');
    return z > 0 ? Math.min(ZOOM.max, Math.max(ZOOM.min, z)) : 1;
}

/** What a set of reading options controls: the page's (reading) or one
 *  element's (scopedReading). */
export interface ReadingState {
    /** The theme shown. */
    theme: Signal<string>;
    /** What the reader chose: a theme, or 'system' (the page's options only). */
    choice?: Signal<string>;
    /** The system mode's themes, while the system is light and dark. */
    system?: Signal<{ light: string; dark: string }>;
    setSystemThemes?(slots: { light?: string; dark?: string }): void;
    zoom: Signal<number>;
    width: Signal<string>;
    themes: Theme[];
    setTheme(t: string): void;
    zoomBy(dir: -1 | 0 | 1): void;
    setWidth(w: string): void;
    /** How selected text looks ('native' or 'bands'); a page's only. */
    selection?: Signal<string>;
    setSelection?(s: string): void;
}

/** The reader's choices, applied to the page as they change. */
export const reading: ReadingState & { setZoom(z: number): void; selection: Signal<string>; setSelection(s: string): void;
    math: Signal<string>; setMath(m: string): void; debug: Signal<boolean>; setDebug(on: boolean): void;
    reader: Signal<boolean>; setReader(on: boolean): void } = {
    theme: signal(initialTheme()),
    choice: signal(initialChoice()),
    system: signal(initialSystem()),
    zoom: signal(initialZoom()),
    width: signal(html().getAttribute('data-width') || load(KEYS.width) || 'auto'),
    // The reader's choice, else the page's default (its data-latex-selection).
    selection: signal(load(KEYS.selection) || html().getAttribute('data-latex-selection') || 'native'),
    math: signal(load(KEYS.math) === 'spoken' ? 'spoken' : 'mathml'),
    debug: signal(load('reflowtex-a11y-debug') === '1'),
    reader: signal(load('reflowtex-a11y-reader') === '1'),
    /** The themes a page offers (the class names its CSS styles). */
    themes: THEMES,

    /** A theme, or 'system'. */
    setTheme(t: string) {
        const api = window.reflowtex;
        if (api?.setTheme) { api.setTheme(t); return; }       // (it says so: the listener below)
        // without the viewer: the theme itself, as the viewer sets it
        save(KEYS.theme, t);
        reading.choice!.value = t;
        if (t === SYSTEM) { const s = reading.system!.value; t = matchMedia('(prefers-color-scheme: dark)').matches ? s.dark : s.light; }
        const root = html();
        for (const th of reading.themes) root.classList.remove(th.name);
        if (t !== 'default') root.classList.add(t);
        root.setAttribute('data-theme', t);
        reading.theme.value = t;
    },
    setSystemThemes(slots: { light?: string; dark?: string }) {
        const api = window.reflowtex;
        if (api?.setSystemThemes) { api.setSystemThemes(slots); return; }
        if (slots.light) save(KEYS.themeLight, slots.light);
        if (slots.dark) save(KEYS.themeDark, slots.dark);
        reading.system!.value = { ...reading.system!.value, ...slots };
        if (reading.choice!.value === SYSTEM) reading.setTheme(SYSTEM);
    },
    /** Larger (1), smaller (-1) or back to 100% (0). */
    zoomBy(dir: -1 | 0 | 1) {
        const z = reading.zoom.value;
        reading.setZoom(dir === 0 ? 1 : z * (dir > 0 ? ZOOM.step : 1 / ZOOM.step));
    },
    setZoom(z: number) {
        z = Math.min(ZOOM.max, Math.max(ZOOM.min, z));
        html().style.setProperty('--rtx-zoom', String(z));
        save(KEYS.zoom, String(z));
        reading.zoom.value = z;
        resize();
    },
    setWidth(w: string) {
        html().setAttribute('data-width', w);
        save(KEYS.width, w);
        reading.width.value = w;
        resize();
    },
    setSelection(sel: string) {
        html().setAttribute('data-latex-selection', sel);
        save(KEYS.selection, sel);
        reading.selection!.value = sel;
    },
    setReader(on: boolean) {
        const api = window.reflowtex;
        if (api?.setScreenReaderMode) api.setScreenReaderMode(on);      // (it says so: the listener below)
    },
    setDebug(on: boolean) {
        const api = window.reflowtex;
        if (api?.setAccessibleDebug) api.setAccessibleDebug(on);        // (it says so: the listener below)
    },
    setMath(m: string) {
        const api = window.reflowtex;
        if (api?.setAccessibleMath) api.setAccessibleMath(m as 'mathml' | 'spoken');        // (it says so: the listener below)
        else { save(KEYS.math, m); reading.math.value = m; }
    },
};
// The choice made elsewhere (another control on the page): the options show it.
if (typeof document !== 'undefined')
    document.addEventListener('reflowtex:accessible-math', e => { reading.math.value = (e as CustomEvent).detail.mode; });
if (typeof document !== 'undefined')
    document.addEventListener('reflowtex:accessible-debug', e => { reading.debug.value = (e as CustomEvent).detail.on; });
if (typeof document !== 'undefined')
    document.addEventListener('reflowtex:screen-reader-mode', e => { reading.reader.value = (e as CustomEvent).detail.on; });
if (typeof document !== 'undefined')
    document.addEventListener('reflowtex:theme', e => {
        const d = (e as CustomEvent).detail;
        reading.theme.value = d.theme; reading.choice!.value = d.choice; reading.system!.value = { light: d.light, dark: d.dark };
    });
// A choice the reader made before stands on every page.
if (load(KEYS.selection)) html().setAttribute('data-latex-selection', reading.selection!.value);

// The theme set from elsewhere (the inspector's Colours view, a page's own
// script) by the same convention, data-theme on <html>: the options show it.
if (typeof MutationObserver !== 'undefined')
    new MutationObserver(() => {
        const t = html().getAttribute('data-theme');
        if (t && t !== reading.theme.peek()) reading.theme.value = t;
    }).observe(html(), { attributes: true, attributeFilter: ['data-theme'] });

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Choices for one element alone – an example's preview – not remembered:
 *  the theme as data-latex-theme on it (the viewer's scoped themes: its
 *  Theming docs), the size as a CSS zoom on `stage` (default: the element)
 *  and data-latex-zoom-level on it. The page's theme is shown chosen until
 *  another is. */
export function scopedReading(target: HTMLElement, themes: Theme[], stage: HTMLElement = target): ReadingState {
    const state: ReadingState = {
        theme: signal(target.getAttribute('data-latex-theme') || reading.theme.value),
        zoom: signal(parseFloat(target.getAttribute('data-latex-zoom-level') || '1') || 1),
        width: signal('auto'),
        themes,
        setTheme(t) { target.setAttribute('data-latex-theme', t); state.theme.value = t; },
        zoomBy(dir) {
            const z = dir === 0 ? 1 : Math.min(ZOOM.max, Math.max(ZOOM.min, state.zoom.value * (dir > 0 ? ZOOM.step : 1 / ZOOM.step)));
            const r = Math.round(z * 1000) / 1000;
            target.setAttribute('data-latex-zoom-level', String(r));
            stage.style.zoom = r === 1 ? '' : String(r);
            state.zoom.value = r;
        },
        setWidth() {},
    };
    // Until the reader picks one here, the page's theme, as it changes.
    reading.theme.subscribe(t => { if (!target.hasAttribute('data-latex-theme')) state.theme.value = t; });
    return state;
}

export interface ReadingOptionsProps {
    /** Whose choices: the page's (`reading`, the default) or an element's
     *  (scopedReading). */
    state?: ReadingState;
    /** Offer the column width (a page that lets its column change). */
    width?: boolean;
    /** Offer how selected text looks: the browser's highlight or even
     *  bands (a page's options only). */
    selection?: boolean;
    /** Offer the inspector (when the page has it). Default true. */
    inspect?: boolean;
    /** Offer showing the reader's text (the viewer's setAccessibleDebug) –
     *  a debugging aid, for a while; the corner panel's only. */
    debug?: boolean;
    themes?: Theme[];
    /** Called after a choice that should close a panel holding these. */
    onDone?: () => void;
    class?: string;
}

/** The controls: text size, colour theme, (column width), (inspector). */
export function ReadingOptions({ state = reading, width = false, selection = false, inspect = true, debug = false, themes = state.themes, onDone, class: cls }: ReadingOptionsProps) {
    // (the inspector's API, when the page has it: src/inspector/README.md)
    const inspector = window.reflowtex?.inspector as { open(): unknown; shortcut?: string } | undefined;
    const api = window.reflowtex;
    const showDebug = debug && state === reading && !!api?.setAccessibleDebug && !!document.querySelector('.latex-a11y');
    return (
        <div class={cls ? `rtx-reading ${cls}` : 'rtx-reading'}>
            <div class="rtx-reading-row rtx-reading-size" role="group" aria-label="Text size">
                <button type="button" data-z="out" aria-label="Smaller text" title="Smaller" onClick={() => state.zoomBy(-1)}>A</button>
                <button type="button" data-z="reset" aria-label="Reset text size" title="Reset" onClick={() => state.zoomBy(0)}>
                    {Math.round(state.zoom.value * 100)}%</button>
                <button type="button" data-z="in" aria-label="Larger text" title="Larger" onClick={() => state.zoomBy(1)}>A</button>
            </div>
            <div class="rtx-reading-row rtx-reading-themes" role="radiogroup" aria-label="Colour theme">
                {state.choice && <button type="button" role="radio" data-t={SYSTEM} aria-checked={state.choice.value === SYSTEM}
                        title="One theme while the system is light, another while it is dark" onClick={() => state.setTheme(SYSTEM)}>
                    <span class="rtx-swatch" aria-hidden="true">Aa</span><span>System</span>
                </button>}
                {themes.map(t => (
                    <button type="button" role="radio" data-t={t.name}
                            aria-checked={(state.choice ? state.choice.value : state.theme.value) === t.name}
                            onClick={() => state.setTheme(t.name)}>
                        <span class="rtx-swatch" aria-hidden="true">Aa</span><span>{t.label || title(t.name)}</span>
                    </button>))}
            </div>
            {state.choice?.value === SYSTEM && state.system && state.setSystemThemes && <div class="rtx-reading-row rtx-reading-system">
                {(['light', 'dark'] as const).map(k => (
                    <label class="rtx-reading-slot">
                        <span>{k === 'light' ? 'When the system is light' : 'When the system is dark'}</span>
                        <select data-slot={k} value={state.system!.value[k]}
                                onChange={e => state.setSystemThemes!({ [k]: (e.currentTarget as HTMLSelectElement).value })}>
                            {themes.map(t => <option value={t.name}>{t.label || title(t.name)}</option>)}
                        </select>
                    </label>))}
            </div>}
            {width && <div class="rtx-reading-row">
                <p class="rtx-reading-caption" id="rtx-width-label">Text width</p>
                <div class="rtx-seg" role="radiogroup" aria-labelledby="rtx-width-label">
                    {WIDTHS.map(w => (
                        <button type="button" role="radio" data-w={w} aria-checked={state.width.value === w}
                                onClick={() => state.setWidth(w)}>{title(w)}</button>))}
                </div>
            </div>}
            {selection && state.selection && state.setSelection && <div class="rtx-reading-row">
                <p class="rtx-reading-caption" id="rtx-selection-label">Selection</p>
                <div class="rtx-seg" role="radiogroup" aria-labelledby="rtx-selection-label">
                    {SELECTIONS.map(o => (
                        <button type="button" role="radio" data-s={o.name} aria-checked={state.selection!.value === o.name}
                                onClick={() => state.setSelection!(o.name)}>{o.label}</button>))}
                </div>
            </div>}
            {state === reading && document.querySelector('.latex-a11y') && <div class="rtx-reading-row">
                <p class="rtx-reading-caption" id="rtx-math-label">Formulas for screen readers</p>
                <div class="rtx-seg" role="radiogroup" aria-labelledby="rtx-math-label">
                    {MATH_MODES.map(o => (
                        <button type="button" role="radio" data-m={o.name} aria-checked={reading.math.value === o.name}
                                onClick={() => reading.setMath(o.name)}>{o.label}</button>))}
                </div>
            </div>}
            {state === reading && document.querySelector('.latex-a11y') && api?.setScreenReaderMode && <div class="rtx-reading-row">
                <p class="rtx-reading-caption" id="rtx-reader-label">Screen reader mode</p>
                <div class="rtx-seg" role="radiogroup" aria-labelledby="rtx-reader-label">
                    {[{ on: false, label: 'Off' }, { on: true, label: 'On' }].map(o => (
                        <button type="button" role="radio" data-reader={String(o.on)} aria-checked={reading.reader.value === o.on}
                                title={o.on ? 'A click reaches the text a screen reader reads, word by word; the drawing’s text is not selectable' : 'The drawing’s text is selected and clicked, as it is shown'}
                                onClick={() => reading.setReader(o.on)}>{o.label}</button>))}
                </div>
            </div>}
            {((inspect && inspector) || showDebug) && <div class="rtx-reading-row rtx-reading-tools">
                {inspect && inspector && <button type="button" class="rtx-reading-inspect" title="The boxes and glue behind the page"
                        onClick={() => { onDone?.(); inspector.open(); }}>
                    <span>Inspect boxes and glue</span><kbd>{inspector.shortcut || ''}</kbd>
                </button>}
                {showDebug && <button type="button" role="switch" class="rtx-reading-debug" aria-checked={reading.debug.value}
                        title="Show the text a screen reader reads, where it lies, each element tinted (debugging)"
                        onClick={() => reading.setDebug(!reading.debug.value)}>Reader text</button>}
            </div>}
        </div>);
}

/** A round "Aa" button in the corner of the window, opening the reading
 *  options in a panel above it; Escape or a click outside closes it. */
export function ReadingButton(props: ReadingOptionsProps) {
    const open = useSignal(false);
    const root = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
    const close = (focus = false) => { open.value = false; if (focus) button.current?.focus(); };
    useEffect(() => {
        const away = (e: Event) => { if (open.value && !root.current?.contains(e.target as Node)) close(); };
        const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && open.value) close(true); };
        document.addEventListener('pointerdown', away);
        document.addEventListener('keydown', key);
        return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', key); };
    }, []);
    // Before the panel is painted, as the old one did: focus is where the
    // keyboard expects it at once.
    useLayoutEffect(() => {
        if (open.value) (panel.current?.querySelector<HTMLElement>('[aria-checked="true"]') || panel.current?.querySelector('button'))?.focus();
    }, [open.value]);
    return (
        <div ref={root} class="rtx-reading-corner">
            {open.value && <div ref={panel} class="rtx-panel rtx-reading-panel" role="dialog" aria-label="Reading options">
                <ReadingOptions debug {...props} onDone={() => close()} />
            </div>}
            <button ref={button} type="button" class="rtx-reading-button" aria-haspopup="dialog" aria-expanded={open.value}
                    title="Reading options" onClick={() => { open.value = !open.value; }}>
                <span class="rtx-aa" aria-hidden="true"><span>A</span><span>a</span></span>
                <span class="rtx-sr-only">Reading options</span>
            </button>
        </div>);
}

/** An example's own preview options (the Hugo integration's themes=): text
 *  size and theme for the preview this element stands in, alone. Declared as
 *  <div data-rtx="preview-options" data-themes="light,dark">. */
export function PreviewOptions({ themes = 'light,dark', element }: { themes?: string; element?: HTMLElement }) {
    const state = useRef<ReadingState | null>(null);
    if (!state.current && element) {
        const target = (element.closest('.latex-example-preview') as HTMLElement) || element.parentElement!;
        const stage = (target.querySelector('.latex-example-stage') as HTMLElement) || target;
        state.current = scopedReading(target, themes.split(',').map(t => ({ name: t.trim() })).filter(t => t.name), stage);
    }
    return state.current ? <ReadingOptions state={state.current} inspect={false} class="rtx-reading-preview" /> : null;
}
