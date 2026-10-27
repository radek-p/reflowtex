// SPDX-License-Identifier: AGPL-3.0-or-later

import { BUILD } from './page.ts';
import type { ColorMap } from '../host/types.ts';
import { report } from './log.ts';
import { BUILTIN_MAP } from './builtin-colour-maps.ts';
import { builtin, colorMapCss, mapThemes as themesOf } from './colour-css.ts';

export { colorFill, linkFill } from './colour-css.ts';

// ── Colour maps ──────────────────────────────────────────────────────────────
// Every colour is drawn as TeX wrote it, through a CSS custom property named
// after it: var(--latex-color-<hex>, <hex>). With nothing set, that is TeX's
// own colour – black glyphs and rules are #000000, links are the colours the
// document gave them (hyperref's colorlinks) – which is the theme `default`.
//
// Every other theme (a class on <html>, see theme.ts; or data-latex-theme on
// an element, for the blocks inside it) is a colour map's: the map sets those
// properties on the block. A map, in the page's optional JSON island
//
//   <script id="latex-color-maps" type="application/json">
//     { "<name>": {
//         "colors": { "<theme>": { "<tex-hex>": "<css colour>", … }, … },
//         "links":  { "<theme>": { "color", "hover", "active", "underline" }, … },
//         "tints":  { "<baked-hex>": ["<base-hex>", <percent>], … }
//     }, … }
//   </script>
//
// colors – per theme, the colours TeX wrote and what to draw instead; a
//   colour a theme leaves out is drawn as TeX wrote it.
// links – per theme, how a link is drawn: the colour of its glyphs at rest,
//   pointed at (hover) and pressed (active), and whether a line is drawn
//   under it while it is pointed at (underline: "hover"; "none" by default).
//   Unset, a link keeps TeX's colours (the state before, for hover and
//   active), and has no underline.
// tints – colours TeX produced by mixing a base colour into the page, e.g.
//   `red!20!white` is red at 20% over the paper. TeX resolves that to flat
//   RGB at compile time, so what arrives is a baked hex with no trace of how
//   it was built – and a tint of a *white* page reads wrong on a dark one.
//   Re-deriving the mix at runtime, against whatever --latex-page-bg
//   currently is, keeps the intent: a tint follows both its base colour and
//   the current background. Not the same as opacity, and must not be
//   reimplemented with it – these fills are opaque on purpose, masking the
//   drawing underneath. Each entry is baked-hex: [base-hex, percent-of-base];
//   in every theme but default.
//
// The viewer ships one map, `reflowtex` (builtin-colour-maps.ts), with the
// themes light, dark, sepia and contrast. A block uses it unless it names
// another with [data-color-map="<name>"]; a named map falls back to it theme
// by theme (a theme the map gives replaces the built-in's, colours and links
// separately), and the page's own map named `reflowtex` replaces the
// built-in's themes it gives. The theme `default` has no map, ever.
//
// --latex-page-bg is deliberately not part of this data: TeX has no notion of
// the page's colour, so it is the *page's* responsibility (its own theme
// CSS), not a colour map's – e.g. `:root.dark { --latex-page-bg: #0c0a09; }`
// alongside wherever else that theme sets its background. Unset, it falls
// back to the CSS `Canvas` system colour. The built-in themes draw TeX's
// white with it: the paper.

export let colorMapsInstalled = false;
// The page's maps (its island, or what setColorMaps last gave) and the
// stylesheet made of them with the built-in, rebuilt in place when they change.
let pageMaps: Record<string, ColorMap> = {};
let mapStyle: HTMLStyleElement | null = null;

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** The colour maps in force, as the island's JSON has them (a copy): the
 *  built-in (`reflowtex`, with the page's of that name over it) and the
 *  page's others. */
export function getColorMaps(): Record<string, ColorMap> {
    return copy({ ...pageMaps, [BUILTIN_MAP]: builtin(pageMaps) });
}

/** The themes the maps give, `default` first. */
export const mapThemes = (): string[] => themesOf(pageMaps);

/** Replace the page's colour maps (host.setColorMaps): the page's colours
 *  follow at once, with no layout – they are CSS custom properties. */
export function setColorMaps(maps: Record<string, ColorMap> | null | undefined): void {
    pageMaps = copy(maps || {});
    if (!mapStyle) { mapStyle = document.createElement('style'); document.head.appendChild(mapStyle); }
    mapStyle.textContent = colorMapCss(pageMaps, CSS.escape);
}

export function installColorMaps(): void {
    if (colorMapsInstalled) return;
    colorMapsInstalled = true;
    const island = document.getElementById('latex-color-maps');
    let maps: Record<string, ColorMap> = {};
    if (island) {
        try { maps = JSON.parse(island.textContent!); }
        catch (e) { report('error', 'color-maps-malformed', 'malformed #latex-color-maps JSON', { error: e }); }
    }
    // what the page gave host.setColorMaps before the first block wins over
    // the island, map by map (it was replaced by it)
    setColorMaps({ ...maps, ...pageMaps });
    document.documentElement.setAttribute('data-latex-viewer', BUILD);
}

