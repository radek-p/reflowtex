# Render tests

Every glyph the browser draws, checked against where TeX put it.

For each case, the document is compiled by the pipeline's own template into
a **pageless PDF** – one page as tall as the document, every glyph and rule
where TeX placed it (`tools/pageless-pdf`). The same run gives the viewer
page. Chromium opens that page with its column pinned to the PDF's width,
and `vector-compare.ts` matches each glyph the viewer drew (from the SVG,
not from pixels) with the PDF's. A case passes when:

- the browser drew the same number of glyphs as TeX, and every one of them
  has its glyph in the PDF;
- no glyph is further than the case's `tolerance` from it, across or
  down;
- every rule the browser drew is in the PDF, and every rule in the PDF is
  drawn (but for the case's `rules_missing`); a rule is its four corners,
  so it may be at any angle, and none is further than `rule_tolerance`
  from TeX's, corner by corner.

Because it compares coordinates, not pixels, the result is the same on any
system: macOS and the Linux of GitHub's runners draw text differently, but
place it identically.

## Small cases and large ones

Both, for different reasons.

- **Small cases** (`cases/*.tex`), one feature each: a paragraph, inline
  mathematics, displays, alignments, lists and headings, footnotes,
  microtype, rules at any angle. When one fails, its name says where to
  look, and it takes a few seconds to run again.
- **Whole documents** (testmath, in `cases.ts`, marked slow): what the
  small cases do not think of – how features meet, and how small errors add
  up over 15 000 pt.

Each small case is tested at three widths: the one it was typeset at, and
100 pt narrower and 85 pt wider. There the browser breaks the lines again
itself, and TeX is compiled at that width to say where they should end up:
it tests the reflowing, not only the copying.

## Running them

```sh
make test-render        # the small cases (about 2 minutes)
make test-render-all    # with testmath (about 1 more)
node --test --test-name-pattern displays tests/render/render.test.ts     # one case
node --test --test-name-pattern "displays@own" tests/render/render.test.ts
```

The tests run on Node (`node:test`); the first run installs the repository's
Node dependencies and Playwright's Chromium. On
GitHub the workflow `.github/workflows/render-tests.yml` runs them all on
every push and pull request, in the project's container image; when one
fails, its reports are attached to the run (`render-reports`).

## When a test fails

The message says what is wrong: glyphs missing, glyphs off (the first few,
with where and by how much), rules off. Each case's build is kept in
`build/<case>/w<width>/`:

- `vector/vector.json` – every glyph's offset, the lines, the rules;
- `pageless.pdf` – what TeX set;
- `site/index.html` (under `build/<case>/w0/`) – the page; serve `build/`
  and open it to see the browser's side.

`tools/pageless-pdf/compare.ts` compares the same two pixel by pixel, for a
picture of the difference.

## Adding a case

Put a short, complete document in `cases/<name>.tex`: a comment on its
first line saying what it tests, `\documentclass`, the packages it needs,
and a few paragraphs – enough text that its lines break differently at the
other widths. It is picked up by name. Settings that differ from
`defaults` go in an entry of `cases.ts`.

## Pictures

Glyphs in TikZ pictures – node text, labels – are compared like any other:
the viewer draws them as outlines (`<use>`, reported as ◊). By default
the PDF has the pictures the capture shipped, stacked back at their places,
so a picture the capture got wrong would be wrong on both sides. A case
with `tex_pictures` (`tikz-labels`, `tikz-nested`) has its PDFs
compiled with TikZ's own `\tikzpicture` (`pageless.ts --tex-pictures`):
TeX draws the pictures in the text, and the capture, dvisvgm and the
viewer's placing of each picture are all tested against it. Its page is
built from a run of its own, `build/<case>/site-run/`. TikZ strokes
straight lines as TeX strokes rules, and the browser draws them as paths:
the case's `rules_missing` counts them.

## Known failures and tolerances

A case that fails for a reason not yet fixed gets `known: '…'` in
`cases.ts`: it still runs, as an expected failure, so the suite stays
green – and the day it passes, the suite fails, to have the mark taken off.
`tolerance` in `defaults` (0.05 pt, 0.1 px at the viewer's 2 px to the
point) is the target every case is to meet. Each case also has its own
ceilings in its entry: `tolerance`, and `rule_tolerance` where it draws
rules – the worst it attains today, across all its widths, so that it can
only get better. At the end of a run a table gives each test's worst glyph
and rule against its ceilings and the target, and names any case doing
better than its ceilings, with the values to lower them to.
