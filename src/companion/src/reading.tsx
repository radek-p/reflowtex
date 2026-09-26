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
// <html> (none for light) and data-theme; the text size is --rtx-zoom on
// <html> (1 = 100%); the width is data-width on <html>. Every change also
// sends a window resize, so the viewer lays the text out again. For no flash
// before the module has loaded, a page sets the saved state itself first,
// from the same localStorage keys (the website's head.html does).
import { signal, useSignal, type Signal } from '@preact/signals';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';

const KEYS = { theme: 'reflowtex-theme', zoom: 'reflowtex-zoom', width: 'reflowtex-width' };
const ZOOM = { min: 0.5, max: 3, step: 1.1 };

export interface Theme { name: string; label?: string }
export const THEMES: Theme[] = [{ name: 'light' }, { name: 'dark' }, { name: 'sepia' }, { name: 'contrast' }];
export const WIDTHS = ['auto', 'narrow', 'normal', 'wide'];

const load = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const save = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const html = () => document.documentElement;
const resize = () => window.dispatchEvent(new Event('resize'));

function initialTheme(): string {
    return html().getAttribute('data-theme') || load(KEYS.theme)
        || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
function initialZoom(): number {
    const z = parseFloat(html().style.getPropertyValue('--rtx-zoom')) || parseFloat(load(KEYS.zoom) || '');
    return z > 0 ? Math.min(ZOOM.max, Math.max(ZOOM.min, z)) : 1;
}

/** What a set of reading options controls: the page's (reading) or one
 *  element's (scopedReading). */
export interface ReadingState {
    theme: Signal<string>;
    zoom: Signal<number>;
    width: Signal<string>;
    themes: Theme[];
    setTheme(t: string): void;
    zoomBy(dir: -1 | 0 | 1): void;
    setWidth(w: string): void;
}

/** The reader's choices, applied to the page as they change. */
export const reading: ReadingState & { setZoom(z: number): void } = {
    theme: signal(initialTheme()),
    zoom: signal(initialZoom()),
    width: signal(html().getAttribute('data-width') || load(KEYS.width) || 'auto'),
    /** The themes a page offers (the class names its CSS styles). */
    themes: THEMES,

    setTheme(t: string) {
        const root = html();
        for (const th of reading.themes) if (th.name !== 'light') root.classList.remove(th.name);
        if (t !== 'light') root.classList.add(t);
        root.setAttribute('data-theme', t);
        save(KEYS.theme, t);
        reading.theme.value = t;
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
};

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
    /** Offer the inspector (when the page has it). Default true. */
    inspect?: boolean;
    themes?: Theme[];
    /** Called after a choice that should close a panel holding these. */
    onDone?: () => void;
    class?: string;
}

/** The controls: text size, colour theme, (column width), (inspector). */
export function ReadingOptions({ state = reading, width = false, inspect = true, themes = state.themes, onDone, class: cls }: ReadingOptionsProps) {
    const inspector = (window.reflowtex as any)?.inspector;
    return (
        <div class={cls ? `rtx-reading ${cls}` : 'rtx-reading'}>
            <div class="rtx-reading-row rtx-reading-size" role="group" aria-label="Text size">
                <button type="button" data-z="out" aria-label="Smaller text" title="Smaller" onClick={() => state.zoomBy(-1)}>A</button>
                <button type="button" data-z="reset" aria-label="Reset text size" title="Reset" onClick={() => state.zoomBy(0)}>
                    {Math.round(state.zoom.value * 100)}%</button>
                <button type="button" data-z="in" aria-label="Larger text" title="Larger" onClick={() => state.zoomBy(1)}>A</button>
            </div>
            <div class="rtx-reading-row rtx-reading-themes" role="radiogroup" aria-label="Colour theme">
                {themes.map(t => (
                    <button type="button" role="radio" data-t={t.name} aria-checked={state.theme.value === t.name}
                            onClick={() => state.setTheme(t.name)}>
                        <span class="rtx-swatch" aria-hidden="true">Aa</span><span>{t.label || title(t.name)}</span>
                    </button>))}
            </div>
            {width && <div class="rtx-reading-row">
                <p class="rtx-reading-caption" id="rtx-width-label">Text width</p>
                <div class="rtx-seg" role="radiogroup" aria-labelledby="rtx-width-label">
                    {WIDTHS.map(w => (
                        <button type="button" role="radio" data-w={w} aria-checked={state.width.value === w}
                                onClick={() => state.setWidth(w)}>{title(w)}</button>))}
                </div>
            </div>}
            {inspect && inspector && <div class="rtx-reading-row">
                <button type="button" class="rtx-reading-inspect" title="The boxes and glue behind the page"
                        onClick={() => { onDone?.(); inspector.open(); }}>
                    <span>Inspect boxes and glue</span><kbd>{inspector.shortcut || ''}</kbd>
                </button>
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
                <ReadingOptions {...props} onDone={() => close()} />
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
