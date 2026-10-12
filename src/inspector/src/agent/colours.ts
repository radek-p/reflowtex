// SPDX-License-Identifier: AGPL-3.0-or-later

import { I, host } from './context.ts';
import { blocksLabel } from './census.ts';
import type { ColourMaps } from '../protocol.ts';
import type { ColorMap } from '../../../viewer/src/host/types.ts';

type Maps = Record<string, ColorMap>;

// A computed colour (rgb(), rgba(), color(srgb …)) as #rrggbb, or as it is.
function toHex(c: string): string {
    const n = (c.match(/[\d.]+/g) || []).map(Number);
    if (n.length < 3) return c;
    const srgb = /^color\(srgb/.test(c), k = srgb ? 255 : 1;
    const hx = (v: number) => Math.round(Math.max(0, Math.min(255, v * k))).toString(16).padStart(2, '0');
    const alpha = srgb ? n[3] : n[3];
    return '#' + hx(n[0]) + hx(n[1]) + hx(n[2]) + (alpha !== undefined && alpha < 1 ? hx(alpha * (srgb ? 1 : 255)) : '');
}

// The page's colour maps (#latex-color-maps): each map's colours per theme,
// its tints, the blocks that use it, and each colour as it is shown now – read
// from a probe in such a block, so the page's current theme is what counts.
// The maps in force come from the viewer (host.colorMaps), which the edits
// below change live (host.setColorMaps); the page's own, from its island,
// are kept for Reset.
function islandMaps(): Maps {
    const island = document.getElementById('latex-color-maps');
    try { return island ? JSON.parse(island.textContent!) : {}; } catch { return {}; }
}
let originalMaps: Maps | null = null;
function currentMaps(): Maps {
    const h = host();
    if (originalMaps === null) originalMaps = islandMaps();
    return h && h.colorMaps ? h.colorMaps() : islandMaps();
}
function applyMaps(maps: Maps): string {
    const h = host();
    if (!h || !h.setColorMaps) return 'this viewer cannot change its colour maps';
    h.setColorMaps(maps);
    return 'ok';
}
const HEX = /^#[0-9a-f]{6}$/i;
// One theme's colour for a TeX colour: value a CSS colour, or null to drop it.
export function setMapColour(name: string, theme: string, src: string, value: string | null): string {
    if (!HEX.test(src)) return 'a TeX colour is #rrggbb';
    const maps = currentMaps(), m = maps[name] = maps[name] || {};
    const cols = m.colors = m.colors || {}, t = cols[theme] = cols[theme] || {};
    if (value === null || value === '') delete t[src.toLowerCase()];
    else t[src.toLowerCase()] = String(value);
    return applyMaps(maps);
}
// A tint: baked hex → [base, percent]; null to drop it.
export function setMapTint(name: string, hex: string, base: string | null, pct: number): string {
    if (!HEX.test(hex)) return 'a tint is #rrggbb';
    const maps = currentMaps(), m = maps[name] = maps[name] || {};
    const tints = m.tints = m.tints || {};
    if (base === null) delete tints[hex.toLowerCase()];
    else { if (!HEX.test(base)) return 'a base is #rrggbb'; tints[hex.toLowerCase()] = [base.toLowerCase(), Math.max(0, Math.min(100, +pct || 0))]; }
    return applyMaps(maps);
}
// Every map at once, from JSON as the island has it.
export function importColourMaps(json: unknown): string {
    let maps: unknown;
    try { maps = typeof json === 'string' ? JSON.parse(json) : json; } catch (e) { return `not JSON: ${(e as Error).message}`; }
    if (!maps || typeof maps !== 'object' || Array.isArray(maps)) return 'expected { "name": { "colors": …, "tints": … } }';
    for (const [n, m] of Object.entries(maps)) if (!m || typeof m !== 'object') return `map ${n} is not an object`;
    return applyMaps(maps as Maps);
}
export const exportColourMaps = (): string => JSON.stringify(currentMaps(), null, 2);
export const resetColourMaps = (): string => applyMaps(originalMaps === null ? islandMaps() : originalMaps);

// The page's theme, and switching it. By the viewer's convention (its
// README, Theming) a theme other than light is a class on <html>, which the
// maps' rules key on; data-theme says the same for the page's own CSS. A
// page's switcher (the companion's reading options, say) follows the change.
const themeNames = (maps: Maps): Set<string> => new Set(['dark', 'sepia', 'contrast',
    ...Object.values(maps).flatMap(m => Object.keys(m.colors || {}))].filter(t => t !== 'light'));
function pageTheme(maps: Maps = currentMaps()): string {
    const root = document.documentElement, a = root.getAttribute('data-theme');
    return a || [...themeNames(maps)].find(t => root.classList.contains(t)) || 'light';
}
export function setPageTheme(t: unknown): string {
    if (typeof t !== 'string' || !/^[\w-]+$/.test(t)) return 'a theme is a class name';
    const root = document.documentElement;
    for (const n of themeNames(currentMaps())) root.classList.remove(n);
    if (t !== 'light') root.classList.add(t as string);
    root.setAttribute('data-theme', t as string);
    return 'ok';
}

export function colourMaps(): ColourMaps {
    const maps = currentMaps();
    const blocks = I.blocks();
    const theme = pageTheme(maps);
    const out = Object.entries(maps).map(([name, map]) => {
        const users = blocks.filter(el => el.dataset.colorMap === name);
        const probeIn = users[0] || null;
        const now = (hex: string) => {
            if (!probeIn) return null;
            const p = document.createElement('span');
            p.style.color = `var(--latex-color-${hex.slice(1)}, ${hex})`;
            probeIn.appendChild(p);
            const c = getComputedStyle(p).color;
            p.remove();
            return toHex(c);
        };
        // Light first (a colour the map leaves alone is shown as TeX set it),
        // then the map's themes, and the page's own, to edit it there too.
        const themes = [...new Set(['light', ...Object.keys(map.colors || {}), theme])];
        const srcs = [...new Set(themes.flatMap(t => Object.keys((map.colors || {})[t] || {})))].sort();
        return {
            name, themes, used: users.length, usedBy: blocksLabel(users.map(el => blocks.indexOf(el) + 1)),
            colors: srcs.map(src => ({ src, by: Object.fromEntries(themes.map(t => [t, ((map.colors || {})[t] || {})[src] ?? null])), now: now(src) })),
            tints: Object.entries(map.tints || {}).map(([hex, [base, pct]]) => ({ hex, base, pct, now: now(hex) })),
        };
    });
    return { theme, maps: out, edited: JSON.stringify(maps) !== JSON.stringify(originalMaps ?? maps) };
}
