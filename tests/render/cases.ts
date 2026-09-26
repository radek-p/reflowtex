// SPDX-License-Identifier: AGPL-3.0-or-later
// The render tests: each case is compiled to a pageless PDF and shown by the
// viewer, and every glyph the browser draws is compared with TeX's (see
// README.md). `defaults` apply to every case unless the case overrides them.

export interface CaseSettings {
  /** widths to test, as changes to the document's own \textwidth (pt): 0 is
   *  the width it was typeset at; the others make the browser break the lines
   *  again, and TeX is compiled at that width to say where they should be */
  widths?: number[];
  /** largest distance (pt) between a glyph in the browser and the same glyph
   *  in the PDF, across and down; in `defaults`, the target every case is to
   *  meet; in a case, its ceiling – the worst it attains today, which may only
   *  go down */
  tolerance?: number;
  /** the same for rules: the farthest a corner of one is from TeX's (the
   *  glyph tolerance unless given) */
  rule_tolerance?: number;
  /** how many of TeX's rules the browser may leave out (0 unless given) */
  rules_missing?: number;
  /** lualatex passes (2 or 3 for references) */
  passes?: number;
  /** the document, from the repository root (default cases/<name>.tex) */
  file?: string;
  template?: string;
  /** a whole document: skipped by make test-render */
  slow?: boolean;
  /** a failure on record: the case runs as an expected failure, and when it
   *  passes again the suite says so, to have the mark taken off */
  known?: string;
}

export const defaults: Required<Pick<CaseSettings, 'widths' | 'tolerance' | 'passes'>> = {
  widths: [0, -100, 85],
  tolerance: 0.05,
  passes: 2,
};

// Each case's ceilings are the worst it attains today across all its widths,
// so that it can only get better – when a run shows it doing better, lower
// them to match. Cases in cases/<name>.tex without an entry use the defaults.
// Worst attained 2026-09-26. paragraph and rules went from 0.009 to 0.010
// that day for the measurement alone: the strip's glyphs are now read from
// MuPDF's exact coordinates, where `mutool trace` printed six significant
// digits (a true 0.0097 used to round to 0.009).
export const cases: Record<string, CaseSettings> = {
  testmath: {
    file: 'examples/testmath/testmath.tex',
    template: 'examples/testmath/template.tex',
    passes: 3,
    widths: [0],
    slow: true,
    // All 41 566 glyphs found; 165 rules.
    tolerance: 0.092,
    rule_tolerance: 0.005,
    // TeX's rules the browser may leave out: the class is `draft`, and TeX
    // marks two overfull lines (verbatim, beside the column) with
    // \overfullrule's black box; the viewer draws no such marks.
    rules_missing: 2,
  },
  alignments: { tolerance: 0.012 },
  displays: { tolerance: 0.01, rule_tolerance: 0.005 },
  footnotes: { tolerance: 0.009 },
  'inline-math': { tolerance: 0.009, rule_tolerance: 0.001 },
  'lists-headings': { tolerance: 0.009 },
  microtype: { tolerance: 0.014 },
  paragraph: { tolerance: 0.010 },
  rules: { tolerance: 0.010, rule_tolerance: 0.004 },
  // A rule and a box set in vertical mode, and a paragraph holding only a
  // rule: kept as fixed displays (they used to be dropped, with 202 glyphs
  // after them out of place). Worst attained 2026-09-26 (Python harness).
  unusual: { tolerance: 0.010, rule_tolerance: 0.005 },
};
