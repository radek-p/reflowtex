// SPDX-License-Identifier: AGPL-3.0-or-later

import {
    DEFAULT_ADJ_DEMERITS, DEFAULT_ALIGN, DEFAULT_DISPLAY_MIN_SPACE,
    DEFAULT_DISPLAY_OVERFLOW_TOLERANCE, DEFAULT_DOUBLE_HYPHEN_DEMERITS,
    DEFAULT_EMERGENCY_TOLERANCE, DEFAULT_FINAL_HYPHEN_DEMERITS, DEFAULT_LAST_LINE_MIN,
    DEFAULT_LAST_LINE_PENALTY, DEFAULT_LINE_PENALTY, DEFAULT_MAX_EXPAND, DEFAULT_MAX_SHRINK,
    DEFAULT_PRETOLERANCE, DEFAULT_TOLERANCE, DEFAULT_TOLERANCE_2, DEFAULT_EMERGENCY_STRETCH,
    DEFAULT_USE_EXPANSION, DEFAULT_USE_PROTRUSION,
} from '../engine/core.ts';

/** A block's layout parameters: the line breaker's (TeX's names, as
 *  data attributes on the block) and the viewer's own. */
export interface Params {
    linePenalty: number;
    adjDemerits: number;
    doubleHyphenDemerits: number;
    finalHyphenDemerits: number;
    pretolerance: number;
    tolerance: number;
    /** \emergencystretch (sp): with it, TeX's third pass (breaker.ts). */
    emergencyStretch: number;
    tolerance2: number;
    emergencyTolerance: number;
    lastLineMin: number;
    lastLinePenalty: number;
    maxExpand: number;
    maxShrink: number;
    displayMinSpacePt: number;
    displayOverflowTolerancePx: number;
    useProtrusion: boolean;
    useExpansion: boolean;
    /** true: TeX's final pass unless it sets an overfull line; 'strict':
     *  TeX's, overfull lines too; false: the viewer's fallbacks (kpBreak). */
    texFinalPass: boolean | 'strict';
    /** 'justify' | 'left' | 'right' | 'center' */
    align: string;
    /** Set by the layout for a paragraph that is not justified: any line
     *  that fits costs nothing. */
    ragged?: boolean;
}

// ── Per-block params ──────────────────────────────────────────────────────────

// Read the current alignment for an element: CSS custom property wins over data attr.
// Called both at mount time and on every resize so media-query changes are picked up.
export function alignFromEl(el: HTMLElement): string {
    const css = getComputedStyle(el).getPropertyValue('--latex-align').trim();
    return css || el.dataset.align || DEFAULT_ALIGN;
}

export function paramsFromEl(el: HTMLElement): Params {
    return paramsFromData(el.dataset, alignFromEl(el));
}

/** A block's params from its data attributes (an element's dataset), with
 *  the alignment it has. */
export function paramsFromData(d: Record<string, string | undefined>, align: string): Params {
    const num  = (key: string, def: number) => key in d ? parseFloat(d[key]!) : def;
    const bool = (key: string, def: boolean) => key in d ? d[key] !== 'false'  : def;
    return {
        linePenalty:          num('linePenalty',          DEFAULT_LINE_PENALTY),
        adjDemerits:          num('adjDemerits',          DEFAULT_ADJ_DEMERITS),
        doubleHyphenDemerits: num('doubleHyphenDemerits', DEFAULT_DOUBLE_HYPHEN_DEMERITS),
        finalHyphenDemerits:  num('finalHyphenDemerits',  DEFAULT_FINAL_HYPHEN_DEMERITS),
        pretolerance:         num('pretolerance',         DEFAULT_PRETOLERANCE),
        tolerance:            num('tolerance',            DEFAULT_TOLERANCE),
        // (in pt, as the page's other lengths)
        emergencyStretch:     num('emergencyStretch',     DEFAULT_EMERGENCY_STRETCH) * 65536,
        tolerance2:           num('tolerance2',           DEFAULT_TOLERANCE_2),
        emergencyTolerance:   num('emergencyTolerance',   DEFAULT_EMERGENCY_TOLERANCE),
        lastLineMin:          num('lastLineMin',          DEFAULT_LAST_LINE_MIN),
        lastLinePenalty:      num('lastLinePenalty',      DEFAULT_LAST_LINE_PENALTY),
        maxExpand:            num('maxExpand',            DEFAULT_MAX_EXPAND),
        maxShrink:            num('maxShrink',            DEFAULT_MAX_SHRINK),
        displayMinSpacePt:    num('displayMinSpace',      DEFAULT_DISPLAY_MIN_SPACE),
        displayOverflowTolerancePx:
                               num('displayOverflowTolerance', DEFAULT_DISPLAY_OVERFLOW_TOLERANCE),
        useProtrusion:        bool('protrusion',          DEFAULT_USE_PROTRUSION),
        useExpansion:         bool('expansion',           DEFAULT_USE_EXPANSION),
        // true: TeX's final pass unless it sets an overfull line; 'strict':
        // TeX's, overfull lines too; false: the viewer's fallbacks (see kpBreak)
        texFinalPass:         'texFinalPass' in d ? (d.texFinalPass === 'strict' ? 'strict' : d.texFinalPass !== 'false') : true,
        align,
    };
}
