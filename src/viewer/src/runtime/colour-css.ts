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

const LINK_PROPS = { color: 'link-color', hover: 'link-hover-color', active: 'link-active-color', underline: 'link-underline' } as const;

/** The custom properties a theme of a map sets, named `--latex-<ns><what>`
 *  (ns '' for the block's own: --latex-color-<hex>, --latex-link-color, …):
 *  each colour it maps, each tint, and the link look. */
function themeDecls(map: ColorMap, theme: string, ns: string): Map<string, string> {
    const d = new Map<string, string>();
    if (theme === DEFAULT_THEME) return d;
    const colour = (hex: string) => `--latex-${ns}color-${hex.slice(1)}`;
    for (const [hex, [base, pct]] of Object.entries(map.tints ?? {}))
        d.set(colour(hex), `color-mix(in srgb, var(${colour(base)}, ${base}) ${pct}%, var(--latex-page-bg, Canvas))`);
    for (const [src, dst] of Object.entries(map.colors?.[theme] ?? {})) d.set(colour(src), dst);
    const look = map.links?.[theme] ?? {};
    for (const [k, what] of Object.entries(LINK_PROPS)) {
        const v = look[k as keyof typeof LINK_PROPS];
        if (v !== undefined) d.set(`--latex-${ns}${what}`, v);
    }
    return d;
}

/** The stylesheet of the page's maps over the built-in; `escape` makes a
 *  theme's name a CSS identifier (CSS.escape).
 *
 *  A theme's colours are declared on the element that carries the theme –
 *  <html> with the theme's class (the page's theme), or any element with
 *  data-latex-theme="T" (a pane, an example's preview) – and reach the
 *  blocks by inheritance, so a block takes the theme of its nearest themed
 *  ancestor, and two themes can stand side by side or one inside the other.
 *  The built-in map's colours are the blocks' own properties; a named map's
 *  are declared under a name of its own (--latex-map<k>-…), which a block
 *  naming the map takes as its own. */
export function colorMapCss(maps: Record<string, ColorMap>, escape: (s: string) => string): string {
    const base = builtin(maps);
    const named = Object.entries(maps).filter(([name]) => name !== BUILTIN_MAP)
        .map(([name, map], k): [string, ColorMap, string] => [name, layer(map, base), `map${k}-`]);
    const themes = new Set<string>([DEFAULT_THEME]);
    for (const m of [base, ...named.map(n => n[1])])
        for (const t of [...Object.keys(m.colors ?? {}), ...Object.keys(m.links ?? {})]) themes.add(t);
    // What any theme sets, of the block's own properties, without --latex-
    const own = new Set<string>();
    const byTheme = new Map<string, Map<string, string>>();
    for (const t of themes) {
        const d = new Map(themeDecls(base, t, ''));
        for (const [, m, ns] of named) for (const [p, v] of themeDecls(m, t, ns)) d.set(p, v);
        for (const p of [...themeDecls(base, t, '').keys(), ...named.flatMap(([, m, ns]) =>
            [...themeDecls(m, t, ns).keys()].map(q => q.replace(`--latex-${ns}`, '--latex-')))]) own.add(p.slice('--latex-'.length));
        byTheme.set(t, d);
    }
    let css = COLOUR_CSS;
    if (!own.size) return css;
    // Every theme declares every property any theme sets – 'initial' where it
    // leaves one out, which makes var() fall back to TeX's own colour – so a
    // theme inside another undoes the outer one's, and a named map's theme
    // replaces the built-in's whole rather than adding to it.
    const props = [...own].map(p => `--latex-${p}`)
        .concat(named.flatMap(([, , ns]) => [...own].map(p => `--latex-${ns}${p}`)));
    for (const [t, d] of byTheme) {
        const sel = (t === DEFAULT_THEME ? [] : [`:root.${escape(t)}`]).concat(`[data-latex-theme=${JSON.stringify(t)}]`);
        css += `${sel.join(', ')} {\n${props.map(p => `  ${p}: ${d.get(p) ?? 'initial'};`).join('\n')}\n}\n`;
    }
    // A block that names a map takes the map's properties as its own.
    for (const [name, , ns] of named)
        css += `.latex-block[data-color-map=${JSON.stringify(name)}] {\n`
             + [...own].map(p => `  --latex-${p}: var(--latex-${ns}${p});`).join('\n') + '\n}\n';
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
