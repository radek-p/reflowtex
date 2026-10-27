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
  /** TikZ pictures in the PDF drawn by TeX, not stacked back from the
   *  capture's private pages (pageless.ts --tex-pictures): the browser's
   *  pictures – their labels' glyphs – are then checked against TeX itself,
   *  with the capture and dvisvgm under test; the page is built from a run of
   *  its own */
  tex_pictures?: boolean;
  /** also compile the document with plain lualatex, as its author would, and
   *  check the strip at its own width glyph by glyph against that PDF (test
   *  <case>@plain, within the PDFs' precision): the pipeline's compile must set the
   *  document as LaTeX does. The document must fit on one page and have no
   *  page number (\pagestyle{empty}), footnotes or floats */
  against_plain?: boolean;
  /** the document plain lualatex compiles for `against_plain`, from the
   *  repository root, when it is not the case's own: the same document less
   *  what the strip is not to show (the page breaks of page-breaks-plain) */
  plain_file?: string;
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
    // 0.005 on macOS; Linux Chromium (the CI image) draws three rules 8 600
    // and 12 900 pt down the page 0.006 off at their corners.
    rule_tolerance: 0.007,
    // TeX's rules the browser may leave out: the class is `draft`, and TeX
    // marks two overfull lines (verbatim, beside the column) with
    // \overfullrule's black box; the viewer draws no such marks.
    rules_missing: 2,
  },
  alignments: { tolerance: 0.012 },
  displays: { tolerance: 0.01, rule_tolerance: 0.005 },
  footnotes: { tolerance: 0.009 },
  'inline-math': { tolerance: 0.009, rule_tolerance: 0.001 },
  // lmodern with classic maths: lmmi, lmsy and lmex read through the font
  // map's encodings (with their own, the page was refused for code points the
  // fonts lacked). All 235 glyphs found. Worst attained 2026-10-25.
  'latin-modern-math': { tolerance: 0.009, rule_tolerance: 0.004 },
  'lists-headings': { tolerance: 0.009 },
  microtype: { tolerance: 0.014 },
  paragraph: { tolerance: 0.010 },
  // The paragraph at widths that are no whole number of pixels (2 px per pt):
  // a real paper's \hsize rarely is one. The column must be the exact width,
  // not the nearest pixel, or every space of a justified line is off.
  // Worst attained 2026-10-25: 0.011 (0.13 to 0.22 when the column was rounded).
  'fractional-width': { file: 'tests/render/cases/paragraph.tex', widths: [0.37, -100.21, 84.83], tolerance: 0.011 },
  rules: { tolerance: 0.010, rule_tolerance: 0.004 },
  // Rules set straight into a paragraph (a bare \vrule, not \rule's box):
  // the breaker took their width for 0, a tall one's height and depth never
  // reached the line spacing, and one with a running height or depth was
  // drawn without it. Worst attained 2026-10-25 (until then, 372 of the
  // browser's glyphs had none of TeX's within 0.7 pt).
  'inline-rules': { tolerance: 0.010, rule_tolerance: 0.001 },
  // Rule leaders with a running height or depth: colortbl's cell colours
  // (\columncolor, \cellcolor, \rowcolor), \leaders\vrule in boxes, and
  // \leaders\hrule\vfill in a \vbox in a line (a running width), and a line
  // of only \hrulefill. They were drawn with no height (the box's was not
  // passed down), a vlist's leaders not at all, and a line whose only ink is
  // a leader was dropped as blank. One page, so against_plain too. Worst
  // attained 2026-10-27.
  'colortbl-cells': { against_plain: true, tolerance: 0.009, rule_tolerance: 0.004 },
  // bbm's double-struck letters (\mathbbm), a font with only a METAFONT
  // source, drawn from METAFONT's bitmaps as outlines. Worst attained
  // 2026-10-26; all 358 glyphs found (also when they were boxes: the
  // comparison sees where a glyph is, not its ink).
  bbm: { tolerance: 0.009 },
  // A \label in vertical mode – after \begin{theorem}, \section and \item, and
  // a theorem straight after a display – as in real papers: its anchor used to
  // take interline glue and reset \prevdepth, so the pipeline's own compile set
  // the next line lower than LaTeX does (by the depth of the line above), and
  // after a display the browser counted interline glue twice (up to 4.8 pt
  // here). against_plain checks the compile itself. Worst attained 2026-10-25.
  'label-anchors': { against_plain: true, tolerance: 0.010, rule_tolerance: 0.002 },
  // ae's T1 text through virtual fonts, accented letters built from two
  // glyphs. Worst attained 2026-10-27 (0.082 until then, when the strip's
  // Type 1 glyphs were read by MuPDF's whole-number widths: see type1-text).
  'virtual-fonts': { tolerance: 0.009 },
  // Long justified lines in T1 Latin Modern, whose widths are no whole
  // thousandths of an em, against the same text in OpenType. The strip's
  // glyphs used to be read by MuPDF's whole-number widths, which put TeX's own
  // lines past the margin by up to 0.19 pt at their ends while the browser's
  // were exact. Worst attained 2026-10-27.
  'type1-text': { tolerance: 0.010 },
  // Lines with nothing visible, as in real papers: a display followed by an
  // empty box, a \write, a \medskip or a label at an item's end, blank lines
  // in verbatim, a label left alone after a box as wide as the text. Each was
  // dropped with its space (12 to 25.6 pt each, 134 pt by the end). One page,
  // so against_plain too. Worst attained 2026-10-25.
  'blank-lines': { against_plain: true, tolerance: 0.010, rule_tolerance: 0.003 },
  // Rows with no space between them: a longtable, an \halign of struts under
  // \offinterlineskip, a paragraph with \baselineskip=0pt. A gap of 0 was taken
  // for no gap and the rows spread by the viewer's own leading, 16 pt at least.
  // Worst attained 2026-10-27.
  'touching-rows': { tolerance: 0.010, rule_tolerance: 0.003 },
  // Interline glue TeX did not take from the lines it stands between, as in
  // real papers: amsart's abstract, a \vtop of height zero with \prevdepth\z@
  // after it; a \vbox to a fixed height with fil glue (a title box); a
  // \prevdepth the document assigns, \nointerlineskip, an empty \hbox{}. And a
  // paragraph ending in \\, whose empty last line was taken for a blank line
  // and counted twice (20 pt). Worst attained 2026-10-26.
  'amsart-abstract': { against_plain: true, tolerance: 0.009 },
  'vbox-to': { against_plain: true, tolerance: 0.010 },
  prevdepth: { against_plain: true, tolerance: 0.009 },
  'par-newline': { against_plain: true, tolerance: 0.011 },
  // \maketitle's author blocks joined by \and, as in real papers, too wide
  // for one line: the browser never broke at glue of infinite stretch, so the
  // row stayed on one line, overfull, and everything below sat higher than
  // in TeX (501 of 541 glyphs past 0.7 pt). A line of two or three blocks
  // then put all its slack between them, where TeX shares it with the
  // centring skips. Worst attained 2026-10-27.
  'title-authors': { against_plain: true, tolerance: 0.009 },
  // Paragraphs ending in negative glue (\hspace{-1cm} before a blank line), as
  // in real papers: the breaker kept a start whose line had become overfull
  // until its final pass, and the last line's negative glue then let it reach
  // the end, one line fewer than TeX. Worst attained 2026-10-27.
  'negative-hspace-end': { against_plain: true, tolerance: 0.010 },
  // Equation numbers with no room beside their formula, set by TeX on a line
  // of their own below it, with no \belowdisplayskip after them, as in real
  // papers (the browser added the skip: 10 pt lower after each). At the
  // document's width; worst attained 2026-10-27.
  'eq-tag-own-line': { against_plain: true, widths: [0], tolerance: 0.009 },
  // The same at other widths, where a number moves beside its formula or
  // below it with the measure, as TeX decides it again (§1202): the browser
  // keeps it where TeX set it at the document's width.
  'eq-tag-own-line-reflow': { file: 'tests/render/cases/eq-tag-own-line.tex', widths: [-100, 85], tolerance: 0.010,
    known: 'an equation number keeps its own line, or its place beside the formula, at every width' },
  // Text between the rows of an alignment (\intertext, \shortintertext), as in
  // real papers: its display skips are \vskip's of its own, which the browser
  // took for skips TeX left out and added again, 10 pt above the text and 10 pt
  // more below it. At the document's width; worst attained 2026-10-27.
  intertext: { against_plain: true, widths: [0], tolerance: 0.009, rule_tolerance: 0.004 },
  // Space asked for inside a paragraph, as in real papers: \\[len], \vspace and
  // \smallskip between two sentences, \vadjust pre, and a box and a rule in
  // a \vadjust. TeX sets it below (or above) the line the request ends up in;
  // the browser dropped the space, set the next line at the plain
  // baselineskip and drew a box or rule in it after the paragraph (over 900
  // glyphs more than 0.7 pt from TeX's). Worst attained 2026-10-27.
  'newline-skip': { against_plain: true, tolerance: 0.010, rule_tolerance: 0.002 },
  // Characters typed raw that the font has no glyph for, as in real papers: ł,
  // Ł, ź and ﬀ in a T1 font, box drawing in Latin Modern OpenType. TeX
  // reports them missing and draws nothing (OpenType: the font's empty
  // .notdef); the page was refused, as no served font could draw them, and
  // the converted T1 font would have drawn its own ł. One page, so
  // against_plain too. Worst attained 2026-10-27 (0.180 until then, in the T1
  // paragraphs: see type1-text).
  'missing-chars': { against_plain: true, tolerance: 0.010 },
  // The same under hyperref, whose \caption leaves its anchor alone on a line
  // after a display (28.6 pt lost) or after a full-width box and a line end
  // (12 pt): floats, so not against plain. Worst attained 2026-10-25; rules
  // 0.003 since 2026-10-27, when a float became a box in the flow (its rule
  // 0.001 lower in the browser).
  'blank-lines-figures': { tolerance: 0.009, rule_tolerance: 0.003 },
  // A rule and a box set in vertical mode, and a paragraph holding only a
  // rule: kept as fixed displays (they used to be dropped, with 202 glyphs
  // after them out of place). Worst attained 2026-09-26.
  unusual: { tolerance: 0.009, rule_tolerance: 0.005 },
  // Labels in TikZ pictures against TeX's own drawing of them (tex_pictures):
  // the capture, dvisvgm and the viewer's placing of a picture all under test.
  // A picture's straight lines are rules on both sides, TeX's strokes against
  // dvisvgm's paths (until 2026-10-25 only TeX's counted: 12 not drawn).
  // Worst attained 2026-10-25.
  'tikz-labels': { tex_pictures: true, tolerance: 0.009, rule_tolerance: 0.005 },
  // A picture inside another, and a pgfplots axis: the inner one used to be
  // captured on its own and lost. Worst attained 2026-10-25 (1 of TeX's rules
  // not drawn until then: a straight line, counted on TeX's side only).
  'tikz-nested': { tex_pictures: true, tolerance: 0.009 },
  // Paragraphs with their own tolerances (\sloppy, a bibliography,
  // \emergencystretch) and hyphenation penalties. Worst attained 2026-10-27.
  sloppy: { tolerance: 0.013 },
  // Fills, straight lines and arrow tips in pictures, counted alike on both
  // sides, and labels under a rotation, a scale and a mirror; at 11pt, one
  // font at two sizes, whose scaled glyph copies dvisvgm keeps out of sight
  // (they used to be counted, at the picture's corner). Worst attained
  // 2026-10-25.
  'tikz-fills': { tex_pictures: true, tolerance: 0.010, rule_tolerance: 0.004 },
  // nicematrix's environment captured as one picture, against TeX's own
  // drawing of it (tex_pictures); its hvlines are PGF strokes, the vertical
  // ones drawn twice. Worst attained 2026-10-25 (12 of TeX's rules not drawn
  // until then, when only TeX's strokes counted).
  nicematrix: { tex_pictures: true, tolerance: 0.009, rule_tolerance: 0.005 },
  // A page whose origin is moved – geometry's hoffset and voffset, a class's
  // \advance\hoffset-1in, the PDF origin – with a picture: the strip and the
  // captured picture are shipped with no offsets (both used to keep them:
  // every glyph of the strip off by the offsets, and the picture's labels and
  // lines off its box). Worst attained 2026-10-25.
  'page-offsets': { tex_pictures: true, tolerance: 0.013, rule_tolerance: 0.004 },
  // Forced page breaks on the main vertical list: \newpage, \clearpage (with
  // a float before it), \cleardoublepage making a blank page, \null\newpage,
  // two in a row, one after a display and before a heading, LaTeX's own
  // floats of [p] and [h], \vspace and \vspace* after a break, and \newpage
  // inside a minipage and a \parbox. Each used to leave the next line lower
  // in the strip by the depth of the line before the break (up to 0.59 pt
  // off here; 1189 of 1443 glyphs past 0.7 pt). Worst attained 2026-10-26; rules
  // 0.005 since 2026-10-27, when the [p] and [h] floats, lost until then, came
  // into the flow as boxes, rules and all.
  'page-breaks': { tolerance: 0.009, rule_tolerance: 0.005 },
  // The same breaks, and the strip glyph for glyph against plain lualatex's
  // page of the document with the breaks taken out: the column runs on across
  // a break as in the middle of a page. Worst attained 2026-10-26.
  'page-breaks-plain': { against_plain: true, plain_file: 'tests/render/cases/plain/page-breaks-plain.tex', tolerance: 0.009 },
  // multicols: the column lines go down the main list, and multicol's output
  // routine puts the balanced columns back as one box. The page shows the
  // lines; the strip shipped both (the browser drew 565 glyphs, TeX 859). At
  // its own width only: at another, the page narrows the columns by the
  // change in the text width, where TeX divides the new width among them.
  // Worst attained 2026-10-27.
  multicols: { widths: [0], tolerance: 0.010 },
  // A document whose class line is in a file it inputs (\input{preamble}, as
  // in real papers): it was refused as not a complete document. Worst attained
  // 2026-10-27.
  'class-in-input': { file: 'tests/render/cases/class-in-input/main.tex', against_plain: true, tolerance: 0.010 },
  // A document's files named relative to its directory, ./sub/part and
  // ../ for a figure, as in real papers: TeX took such a name relative to the
  // build directory, and the build stopped. Not against plain: that compile
  // runs in a build directory too. Worst attained 2026-10-27.
  'relative-paths': { file: 'tests/render/cases/relative-paths/main.tex', tolerance: 0.010 },
  // Pictures graphicx clips (clip with a trim or a viewport), beside one whole
  // and one through a viewport unclipped. graphicx puts a clipped image in a
  // box resource, which the page drew as a filled rule: the picture and its
  // text lost (84 of 599 glyphs here). The text of the included page is
  // placed by dvisvgm within 0.024 pt, the whole page's as the clipped ones'.
  // Worst attained 2026-10-27.
  'img-clip': { file: 'tests/render/cases/img-clip/main.tex', tolerance: 0.024 },
  // Boxes saved with \saveboxresource, one drawn twice, one cut to a box
  // narrower than its text: each was drawn as a filled rule, its text lost
  // (56 of 287 glyphs). Worst attained 2026-10-27.
  'box-resources': { tolerance: 0.010 },
  // Floats LaTeX places itself: [p], [h], a type float's \newfloat defines,
  // algorithm's, figure*. Each is set where it is written, as float's [H]
  // sets one; the strip glyph for glyph against plain lualatex's page of the
  // document with every float [H]. Those LaTeX could not place before the end
  // of the document were lost, from the strip and the page alike (45 of 892
  // glyphs here), and one put back after the prose that follows it. Worst
  // attained 2026-10-27.
  floats: { against_plain: true, plain_file: 'tests/render/cases/plain/floats.tex', tolerance: 0.009, rule_tolerance: 0.004 },
};
