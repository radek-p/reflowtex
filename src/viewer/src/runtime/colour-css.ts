// SPDX-License-Identifier: AGPL-3.0-or-later
// The colour maps as CSS (colour.ts says what they are): data in, a
// stylesheet out, with no page of its own, so it can be tested on its own.
import type { ColorMap } from './builtin-colour-maps.ts';
import { BUILTIN_COLOR_MAPS, BUILTIN_MAP, DEFAULT_THEME } from './builtin-colour-maps.ts';

export function colorFill(c: string): string {
    return `var(--latex-color-${c.slice(1)}, ${c})`;
}

/** A link glyph's fill: the theme's link colour for its state, else `fill`,
 *  its colour as TeX wrote it. */
export function linkFill(fill: string): string {
    return `var(--latex-link-ink, ${fill})`;
}

/** The built-in map, the page's map of the same name over it, theme by theme. */
export function builtin(pageMaps: Record<string, ColorMap>): ColorMap {
    return layer(pageMaps[BUILTIN_MAP] ?? {}, BUILTIN_COLOR_MAPS[BUILTIN_MAP]);
}

/** `map` over `base`, theme by theme: a theme `map` gives (its colours, or
 *  its links) replaces base's; tints are added. */
function layer(map: ColorMap, base: ColorMap): ColorMap {
    return {
        colors: { ...base.colors, ...map.colors },
        links: { ...base.links, ...map.links },
        tints: { ...base.tints, ...map.tints },
    };
}

/** The themes the maps give (the page's, over the built-in), `default` first. */
export function mapThemes(pageMaps: Record<string, ColorMap>): string[] {
    const names = new Set<string>([DEFAULT_THEME]);
    for (const m of [builtin(pageMaps), ...Object.values(pageMaps)])
        for (const t of [...Object.keys(m.colors ?? {}), ...Object.keys(m.links ?? {})]) names.add(t);
    return [...names];
}

const LINK_PROPS = { color: '--latex-link-color', hover: '--latex-link-hover-color',
                     active: '--latex-link-active-color', underline: '--latex-link-underline' } as const;

/** The custom properties a theme of a map sets: each colour it maps, each
 *  tint, and the link look. */
function themeDecls(map: ColorMap, theme: string): Map<string, string> {
    const d = new Map<string, string>();
    if (theme === DEFAULT_THEME) return d;
    for (const [hex, [base, pct]] of Object.entries(map.tints ?? {}))
        d.set(`--latex-color-${hex.slice(1)}`, `color-mix(in srgb, var(--latex-color-${base.slice(1)}, ${base}) ${pct}%, `
                                             + 'var(--latex-page-bg, Canvas))');
    for (const [src, dst] of Object.entries(map.colors?.[theme] ?? {})) d.set(`--latex-color-${src.slice(1)}`, dst);
    const look = map.links?.[theme] ?? {};
    for (const [k, prop] of Object.entries(LINK_PROPS)) {
        const v = look[k as keyof typeof LINK_PROPS];
        if (v !== undefined) d.set(prop, v);
    }
    return d;
}

/** The stylesheet of the page's maps over the built-in; `escape` makes a
 *  theme's name a CSS identifier (CSS.escape). */
export function colorMapCss(maps: Record<string, ColorMap>, escape: (s: string) => string): string {
    // Each map with the blocks it is for: the built-in for every block, a
    // named map (over the built-in) for the blocks that name it, which outrank
    // the built-in's rules by the attribute.
    const base = builtin(maps);
    const targets: [string, ColorMap][] = [['.latex-block', base]];
    for (const [name, map] of Object.entries(maps))
        if (name !== BUILTIN_MAP) targets.push([`.latex-block[data-color-map=${JSON.stringify(name)}]`, layer(map, base)]);
    const themes = new Set<string>([DEFAULT_THEME]);
    for (const [, m] of targets) for (const t of [...Object.keys(m.colors ?? {}), ...Object.keys(m.links ?? {})]) themes.add(t);
    // Every rule sets every property any rule sets – 'initial' where its theme
    // leaves one out, which makes var() fall back to TeX's own colour – so a
    // named map's theme replaces the built-in's whole rather than adding to it,
    // and a theme scoped to part of the page undoes the page's.
    const decls = new Map<string, Map<string, Map<string, string>>>();
    const props = new Set<string>();
    for (const [sel, m] of targets) {
        const byTheme = new Map<string, Map<string, string>>();
        for (const t of themes) { const d = themeDecls(m, t); byTheme.set(t, d); for (const p of d.keys()) props.add(p); }
        decls.set(sel, byTheme);
    }
    let css = COLOUR_CSS;
    if (!props.size) return css;
    const block = (selector: string, d: Map<string, string>) =>
        `${selector} {\n${[...props].map(p => `  ${p}: ${d.get(p) ?? 'initial'};`).join('\n')}\n}\n`;
    // The page's theme: a class on <html> (none for default, whose
    // properties are all unset).
    for (const [sel, byTheme] of decls)
        for (const [t, d] of byTheme) if (t !== DEFAULT_THEME) css += block(`:root.${escape(t)} ${sel}`, d);
    // A theme scoped to part of the page: data-latex-theme="T" on any
    // ancestor gives the blocks inside theme T's colours whatever the page's
    // own theme is (a theme preview beside an example, say). Later, so it
    // wins the tie with the page's rule of the same specificity.
    for (const [sel, byTheme] of decls)
        for (const [t, d] of byTheme) css += block(`:root [data-latex-theme=${JSON.stringify(t)}] ${sel}`, d);
    return css;
}

// Default-coloured glyphs carry no inline fill; route them through the
// '#000000' variable with TeX's black as fallback. The html prefix outranks
// a page's own `.latex-block svg text` rule regardless of stylesheet order.
//
// Deliberately not 'rect': rules set their fill inline, and this rule's
// specificity would otherwise reach inside a tikzpicture and repaint every
// coloured shape in the drawing as text.
//
// A link's glyphs are filled with --latex-link-ink over their own colour
// (linkFill): the theme's colour for the link's state, when it has one.
export const COLOUR_CSS = `
  html .latex-block svg text, html .latex-block svg tspan { fill: var(--latex-color-000000, #000000); }
  .latex-block svg .latex-link { cursor: pointer; --latex-link-ink: var(--latex-link-color); }
  .latex-block svg .latex-link.latex-link-hover {
    --latex-link-ink: var(--latex-link-hover-color, var(--latex-link-color)); }
  .latex-block svg .latex-link.latex-link-active {
    --latex-link-ink: var(--latex-link-active-color, var(--latex-link-hover-color, var(--latex-link-color))); }
`;
