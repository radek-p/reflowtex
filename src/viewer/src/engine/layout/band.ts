// SPDX-License-Identifier: AGPL-3.0-or-later

import type { LineBand } from '../model.ts';

// Where a paragraph's line is set at the reader's width: its indent and the
// measure it is broken to (sp). A list item's indent is a fixed measure
// (\leftmargin), so it stays put and the text column narrows around it – the
// item's label hangs a fixed distance to the left of it, and at x0=0 would
// sit at negative x and be clipped away. A paragraph's measure can be
// narrower than the column on the right too: a quote environment sets \hsize
// = \textwidth - 2\leftmargin, and a wrapped figure takes the right or left
// of the lines beside it. That margin is what remains of the source width,
// as fixed a measure as the left one, so it narrows the column the same way.
// (At the source width, keeping only the left indent set a 295pt quote at
// 320pt: a line TeX had to shrink came out at its natural width, 22pt wider
// than in the PDF.) This is the one rule for widths other than TeX's: each
// line keeps its distances from both edges of the column, so a wrapped
// figure keeps its size and the number of lines beside it. Either distance
// may be negative: a paragraph TeX set wider than the column (a page of
// \newgeometry's with smaller margins, a list with a negative \rightmargin,
// a negative \rightskip) reaches past the column's edge by as much at every
// width, as its indent does on the left.
export function lineBandAtWidth(band: LineBand, widthSp: number, sourceWidthSp: number): { indentSp: number; rightSp: number; availSp: number } {
    const indentSp = band.indent || 0;
    const rightSp = (sourceWidthSp > 0 && band.width! > 0) ? sourceWidthSp - indentSp - band.width! : 0;
    return { indentSp, rightSp, availSp: widthSp - indentSp - rightSp };
}
