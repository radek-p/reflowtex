// SPDX-License-Identifier: AGPL-3.0-or-later
// The viewer's own colour map: the looks of the themes light, dark, sepia and
// contrast, as data (the README's Theming). Data only, with no browser code,
// so a site generator's build can read it too (the Hugo integration's
// prebuild writes it out for templates that show a map).
//
// The theme `default` is not here and never has a map: it draws TeX's colours
// exactly, as the PDF has them.

/** How a theme draws a link: its glyphs' colour at rest, pointed at and
 *  pressed (each unset: TeX's own colour, then the state before), and whether
 *  a line is drawn under it while it is pointed at. */
export interface LinkLook {
    color?: string;
    hover?: string;
    active?: string;
    underline?: 'none' | 'hover';
}

/** A colour map: per theme, the colours TeX wrote and what to draw instead
 *  (`colors`) and how links look (`links`); and the tints TeX baked, to mix
 *  again against the page in every theme but default. */
export interface ColorMap {
    colors?: Record<string, Record<string, string>>;
    links?: Record<string, LinkLook>;
    tints?: Record<string, [string, number]>;
}

/** The name of the built-in map. Every block uses it unless it names
 *  another (data-color-map), and so does every map for a theme it leaves
 *  out; a page's map of this name replaces the built-in's themes it gives. */
export const BUILTIN_MAP = 'reflowtex';

/** The theme that draws TeX's colours as they are. */
export const DEFAULT_THEME = 'default';

/** TeX's white is the paper: drawn as the page's background. */
const PAPER = 'var(--latex-page-bg, Canvas)';
const ACTIVE = '#c2410c';

export const BUILTIN_COLOR_MAPS: Record<string, ColorMap> = {
    [BUILTIN_MAP]: {
        colors: {
            light: { '#000000': '#333333', '#ffffff': PAPER },
            dark: { '#000000': '#e7e5e4', '#ffffff': PAPER, '#ff0000': '#ff7b72', '#0000ff': '#79c0ff',
                    '#4f4f54': '#9c9ca3', '#fcc712': '#7a5c00' },
            sepia: { '#000000': '#453a26', '#ffffff': PAPER, '#ff0000': '#c02d0c', '#0000ff': '#155e97',
                     '#4f4f54': '#544f45' },
            contrast: { '#000000': '#000000', '#ffffff': PAPER, '#ff0000': '#b30000', '#0000ff': '#0000b3' },
        },
        links: {
            light: { color: '#2f2ccd', hover: '#221f99', active: ACTIVE, underline: 'hover' },
            dark: { color: '#9d9bff', hover: '#c3c2ff', active: ACTIVE, underline: 'hover' },
            sepia: { color: '#3431b0', hover: '#25238a', active: ACTIVE, underline: 'hover' },
            contrast: { color: '#1f1ca8', hover: '#000000', active: ACTIVE, underline: 'hover' },
        },
        tints: {
            '#ffcccc': ['#ff0000', 20],
            '#ccccff': ['#0000ff', 20],
            '#fef4d0': ['#fcc712', 20],
            '#808080': ['#000000', 50],
        },
    },
};
