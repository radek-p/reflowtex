# The paper corpus

Real papers, built by reflowtex and compared with TeX's own typesetting of them. Each one is typeset twice: by
LuaTeX as one tall page (the pageless PDF, every glyph where TeX put it) and by the browser from reflowtex's
output, at the paper's own width. The comparison matches the browser's glyphs with TeX's, line by line.

The papers come from arXiv, the ICALP 2026 proceedings (LIPIcs, through the authors' arXiv sources) and CTAN,
across computer science, mathematics, physics, astronomy, engineering, statistics, economics, biology,
chemistry, the earth sciences and medicine. Each is under a licence that allows it to be redistributed
(CC BY 4.0, CC BY-SA 4.0, CC0 1.0, GPL); [LICENSES.md](LICENSES.md) credits each one.

## What is here

- `manifest.json`: every paper. Its title, authors, year, venue, class, field and licence, where it was
  published (`original_page`) and its PDF (`original_url`). Its source (`source.url`, `source.sha256`), main file
  and how its bibliography is made. Its patch, if any, and its notable packages. A paper the pipeline cannot
  build yet (`"supported": false`) is listed with the reason and not run.
- `patches/<id>.patch`: what was changed in a paper's source before it was built, and why, in the patch's
  header. A change is made only where the paper needs another engine for something it does not use (an
  unused package that needs pdfTeX, say).
- `LICENSES.md`: attribution per paper, written from the manifest (`node tools/corpus/licences.ts`).

The sources themselves are not in the repository. `tools/corpus/fetch.ts` downloads each, once, into
`corpus/.cache/` (or `CORPUS_CACHE`), under its sha256.

## Notable packages

`packages` in the manifest is the paper's class, then up to four packages it loads that fewer than a third of
the corpus's papers load. They are read off the source (the main file and what it `\input`s, without
comments, verbatim text or the paper's own style files), rarest first, and leave out packages nearly every
paper loads (amsmath, graphicx, hyperref, xcolor, …). `tools/corpus/packages.ts` has the rule.

## The scores

- **Placement** (the headline): the share of TeX's glyphs that are in a line the browser also has, and within
  0.092 pt along it, once the line is set on TeX's baseline. Each browser line is paired with one of TeX's by an
  order-preserving alignment. A glyph in a line with no partner (lost, or broken differently) counts as wrong.
- **Vertical jumps**: the places where the browser's lines move against TeX's by more than 0.092 pt between
  one line and the next, each counted once, where it happens.
- **Absolute**: the share of TeX's glyphs with a browser glyph within 0.092 pt in both directions, where it
  is. One offset near the top makes everything after it wrong, so this is for reference.

A paper is at the goal when its placement is at least 99 % and it has no vertical jump.

## Running it

```sh
node tools/corpus/fetch.ts --check                              # download the sources (once), unpack each to check it
docker build -f docker/corpus/Dockerfile -t reflowtex-corpus .  # the image: frozen TeX Live 2025, the papers' packages
node tools/corpus/run.ts --image reflowtex-corpus [--only <id>,…] [--jobs 2]
node tools/corpus/report.ts                                     # website/data/corpus.json, the blocks and the comparisons
```

`run.ts` builds each paper in a container of its own, `--network none`, with the repository read-only and only
the paper's folder (`corpus/results/<id>/`) writable. It runs `tools/corpus/paper.ts` in there: plain
`lualatex -no-shell-escape` as the author builds the paper (with BibTeX or Biber when the manifest says so),
then reflowtex's capture, the page, and the comparison in Chromium. Shell escape is never on. The paper's
source is untrusted: it is unpacked by `tools/corpus/archive.ts`, which writes only plain files under the
destination and refuses absolute paths, `..`, links and devices.

`report.ts` writes `website/data/corpus.json` (the website's showcase and accuracy sections are built from it).
It also writes `website/corpus-blocks/<id>.json` (each paper's block, as measured, for its page on the site)
and `website/static/corpus/`: the measured pages, the outlines, and the comparison, which the render
report shows as its batch "Paper corpus" (`render-tests/?batch=corpus#<id>`).

In CI, `.github/workflows/corpus.yml` does all of this in four shards, and the website's deploy takes its
newest results.

`docker/corpus/texlive-packages.txt`, the image's TeX Live packages, is made by `tools/corpus/texlive.ts` from
the logs of a run in a full TeX Live: every file the papers' TeX runs read, by the package that ships it.
