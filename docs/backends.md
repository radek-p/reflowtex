# Capture backends

A capture backend turns LaTeX into the node lists the rest of reflowtex works
on: TeX's paragraphs before they are broken, the vertical flow, displays,
fonts, streams. Everything after the capture is shared by every backend:
MathML, pictures to SVG, the transforms, fonts, the encoder and the viewer.

```
LaTeX ──▶ backend ──▶ output.json shape ──▶ shared pipeline ──▶ nodelist.pb + fonts
          (luatex,     (SerializerOutput)    (transform, fonts,
           …)                                  encode)
```

This build has two:

- **`luatex`**, the default: the document is set in `src/extract/template.tex`
  and compiled by `lualatex` from TeX Live; `src/extract/serializer.lua`
  writes the node lists.
- **`tectonic`**, a placeholder. It is registered so that it can be listed and
  selected, and it claims no capability. Selecting it fails at once with
  "the Tectonic backend is not available in this build". A real Tectonic
  backend replaces it by implementing the interface below.

The code is in `src/pipeline/backend/`: `types.ts` (the interface),
`capabilities.ts` (the capabilities and their meanings), `registry.ts`
(selection and listing), `luatex.ts` and `tectonic.ts`.

## Choosing a backend

The default is `luatex`. A choice, in order of precedence:

- **API:** `new Pipeline({ …, backend: 'luatex' })`, or a backend object
  (`backend: myBackend`).
- **CLI:** `--backend ID` on `integrations/vanilla/build.ts` and
  `integrations/hugo/prebuild.ts`.
- **Environment:** `REFLOWTEX_BACKEND=ID`.

An unknown id fails with the list of known ones. A backend that this build
cannot use fails when the pipeline is made, before anything compiles.

### Listing backends and what they can do

```sh
node integrations/vanilla/build.ts --list-backends          # a table
node integrations/vanilla/build.ts --list-backends --json   # for a program
```

In code, `listBackends()` (`src/pipeline/backend/registry.ts`) gives, for
each backend, its id, its name, whether it is the default, whether it is
available (and why not), how it runs, and every capability as `true` or
`false`. A host can add a backend of its own with
`registerBackend(id, options => backend)`.

## The interface

A backend (`CaptureBackend`) has an `id`, a `name`, a `runtime`, a
`capabilities` descriptor, `availability()` and `open(document)`.

- **`open(document)`** gets the document as the caller wrote it: `content`
  (a snippet or a complete document) and `preamble`, a working directory,
  the directories to search for files the document reads, a site's own font
  files, and whether to capture MathML. It returns a job.
- **`job.capture({ widthExtraSp, passes })`** compiles the document with the
  text width widened by `widthExtraSp` (0 is the document's own width), in
  at most `passes` runs. It returns:
  - `data`: the node lists, fonts, streams and the rest, in the shape of
    `output.json` (`SerializerOutput`, `src/pipeline/nodes.ts`);
  - `dir`: the directory holding the run's files;
  - `mathml`: LaTeX's MathML for each formula, by number, where captured;
  - `pictures`: a picture source, when the backend makes pictures' SVG
    itself (otherwise the pipeline converts each picture's PDF page in
    `dir`);
  - `diagnostics`: warnings, with their file and line where known.
- The pipeline calls `capture` once for the document, then again for each
  width sample it needs. The job may keep state between captures (LuaTeX
  runs each later capture in a copy of the first one's directory, so it
  reads back the same `.aux`).
- **`runtime`** says how the backend runs: `process` (a program per
  capture), `service` (a long-lived process), `wasm` (WebAssembly in this
  process or a worker), `none` (a placeholder); whether several documents
  may compile at once; and whether, with several, the first runs alone (to
  fill a cache the others would otherwise all build at once).
- **`dispose()`** and **`job.close()`**, both optional, free what a backend
  or a job holds.
- **`pipelineOnly`**, optional: keys the backend's captures carry for the
  pipeline's own use that the wire format does not, by `latex.proto`
  message name, e.g. `{ Paragraph: ['line_hint'], ContentItem: [...] }`.
  The encoder refuses any key the schema has no field for, so that nothing
  is dropped without a word; the keys declared here (with those the
  pipeline keeps for itself) are left out instead. A key the message has a
  field for cannot be declared. A caller of `encodeDocument` passes the
  same as `encodeDocument(data, { pipelineOnly })`.

Characters a font lacks are in `data.missing_chars` (`MissingChar`: font,
character, how often), from which the encoder makes the block's
`missing-char` warnings. The LuaTeX serializer records them from the node
lists, with the stream and the text around each. A backend with no such
hook can read them off TeX's log, which every engine writes:
`missingCharsFromLog(log)` (`src/pipeline/backend/tex-log.ts`) reads TeX's,
pdfTeX's, XeTeX's and LuaTeX's "Missing character" lines, warnings or
errors, joined where TeX broke them at `max_print_line`.

Glyph source positions, where a backend has them, are on glyph nodes as
`src: { file, line, column?, length? }` (`GlyphSource`); the document's own
text has `file: ''`, its lines counted in the content as given.

## Capabilities

A capability is a named promise with a precise meaning. A backend claims it
by setting it to `true` in its descriptor. An absent or unknown capability,
or any value other than `true`, reads as `false`. Every claim is checked by
the conformance suite.

"If missing" is what the pipeline does when a document needs a capability
its backend lacks: **error** stops the build (the result would be wrong or
incomplete), **warn** builds it and logs what is missing. A caller can turn
the errors into warnings with `missingCapabilities: 'warn'`. What a document
needs is read off its source (`documentNeeds`): what it loads and draws, how
many passes were asked for, whether it is compiled as a batch.

| Capability | Meaning | If missing |
|---|---|---|
| `multiPass` | Runs the document again, up to the passes asked for, until the files TeX reads back (.aux, .toc, .lof, .lot) stop changing, so cross-references, citations and contents resolve. | error |
| `widthResampling` | Compiles the same document with its text width widened by a given amount and reports the width it used (`source_width`). The pipeline models displays across widths by compiling a few such samples. | warn: displays keep the document's width |
| `singlePassDisplays` | One run already gives every display its model across widths (the output is marked `display_model`), so the pipeline compiles no width samples. | warn |
| `opentypeFonts` | OpenType fonts (fontspec, unicode-math) are captured with the font file each glyph comes from. | error |
| `classicFonts` | 8-bit TFM fonts (Computer Modern and the other Type 1 families) are captured with their font files, character codes and hyphenation as TeX made them. | error |
| `protrusion` | microtype's character protrusion: paragraphs carry `protrude_chars` and fonts each character's protrusion codes, so the browser hangs punctuation into the margin as TeX does. | warn |
| `fontExpansion` | microtype's font expansion: paragraphs carry `adjust_spacing` and fonts their expansion limits, step and per-character factors. | warn |
| `pictures` | TikZ pictures and included graphics are captured as picture nodes with TeX's box metrics, and the pipeline gets SVG for each (from the run's PDF pages, or from the backend's own picture source). | error |
| `companion` | The companion package (`reflowtex.sty`, `reflowtex-lean.sty`) works: streams, `\webtext` slots, `\webwidget` instances and parts, `\webspan` marks, actions. | error |
| `batchParts` | Several parts compiled as one document (`Pipeline.compileBatch`) come back cut at each part, numbering and references carried across. | error |
| `tagging` | The author's `\DocumentMetadata` is honoured: LaTeX's tagging code runs, and the node lists are what they are without it. | error |
| `mathml` | Formulas carry LaTeX's own MathML (tagging with luamml) where the author enables it; the pipeline converts nothing itself. | error |
| `glyphSourceLines` | Every glyph carries the source file and line TeX was reading when it was set. | warn |
| `glyphSourceMap` | Every glyph carries its exact source position: file, line, column and length, so a click finds the character it came from. | warn |
| `texBreaks` | Each paragraph also records TeX's own line breaks at the source width (`tex_breaks`). | warn |
| `incremental` | One block of a document is recompiled from a saved state (the preamble run once), not the whole document. | warn |
| `inBrowser` | The backend runs inside a browser (WebAssembly), with no native tools. | error |
| `shellEscape` | The backend can run with shell escape when the caller asks for it, asserting every document is trusted. Shell escape is off unless asked for, for every backend. | error |

### Where the pipeline asks instead of assuming

- **Displays.** The pipeline samples wider widths only when the backend has
  `widthResampling`. With `singlePassDisplays` and a modelled output it
  compiles once. With neither, displays keep the document's width, with a
  warning.
- **Passes.** More than one pass is asked for only of a backend with
  `multiPass`.
- **Needs.** A document's needs are checked against the descriptor before
  anything compiles (see "If missing").
- **Several documents.** The first runs alone only when the backend's
  runtime says so (LuaTeX: luaotfload's font cache).
- **MathML** comes from the capture result. **Pictures** come from the
  backend's picture source when it has one, else from the PDF pages in the
  run's directory.
- **Build keys.** `toolchainHash(src, backendId)` includes the backend for
  any backend but LuaTeX, so a block built by one is stale for another.

## Capability matrix

What each backend does today, and what a Tectonic backend is expected to do.
**yes**: claimed and checked by the conformance suite. **no**: not
supported. **possible**: not done, but the engine allows it. **planned**:
expected of the backend. **not planned**: the engine or its LaTeX cannot do
it, as things stand.

| Capability | LuaTeX | Tectonic (expected) |
|---|---|---|
| `multiPass` | yes | planned |
| `widthResampling` | yes | planned |
| `singlePassDisplays` | no: displays are sampled by compiling again | planned: the engine can set a display again at another width within one run; primitive displays first, amsmath alignments later |
| `opentypeFonts` | yes | planned: HarfBuzz shaping as in LuaTeX; italic correction and mark offsets differ slightly |
| `classicFonts` | yes | planned, with gaps: Unicode characters typed into 8-bit fonts need help from a package, and a ligature split at a hyphenation point is not formed again |
| `protrusion` | yes | planned |
| `fontExpansion` | yes | not planned: XeTeX has no font expansion |
| `pictures` | yes: PDF pages converted by dvisvgm | planned: SVG made from the engine's own output, with no native tools; a few PGF features (fadings, interpolated shadings) missing at first |
| `companion` | yes | planned: the package's notes written by TeX and read back after the run, in place of Lua |
| `batchParts` | yes | planned |
| `tagging` | yes (TeX Live 2026) | not planned for now: needs a LaTeX newer than the one in Tectonic's TeX bundle |
| `mathml` | yes (TeX Live 2026, with luamml) | not planned: luamml needs LuaTeX, and the pipeline does not convert formulas itself |
| `glyphSourceLines` | possible: LuaTeX can stamp every glyph with its input line | planned |
| `glyphSourceMap` | no: LuaTeX gives no column without changes to the engine | planned |
| `texBreaks` | possible | planned |
| `incremental` | no | planned: the preamble run once, each block compiled from a memory snapshot |
| `inBrowser` | no | planned: WebAssembly in a worker |
| `shellEscape` | yes, when asked for | not planned |

Beyond capabilities, the two differ in where TeX's files come from (TeX Live
for LuaTeX; for Tectonic, a pinned bundle of TeX files) and in small metric
differences a conformance run against both will list (fontdimen rounding by
one sp, `\predisplaysize`, the shape of `\leqno`).

## The conformance suite

`tests/backends/conformance.test.ts` runs against every registered backend,
or those named in `REFLOWTEX_BACKENDS` (comma-separated):

```sh
make test-conformance
REFLOWTEX_BACKENDS=luatex node --test tests/backends/conformance.test.ts
```

For each backend it:

1. checks the descriptor names only known capabilities, each a boolean;
2. for a backend not available in this build, checks that selecting it and
   opening a document both fail with `BackendUnavailable`, and skips every
   capability with the reason;
3. checks the base contract every backend meets: paragraphs, glyph fonts in
   the font table, each font naming its file, a source width, diagnostics,
   the encoder and font provisioning on the output;
4. for each capability, compiles its fixture (`tests/backends/fixtures/`)
   and checks the output for what the capability promises. A capability the
   backend does not claim is skipped, saying so. `incremental` and
   `inBrowser` have no shared check yet: claimed, they show as to do.

The LuaTeX backend passes it.

## Adding a backend

A backend is a module that implements `CaptureBackend` and is registered.
For a Tectonic backend, in outline:

1. **Implement the interface** in `src/pipeline/backend/tectonic.ts`, in
   place of the placeholder. `open()` prepares the document for the engine
   (its own host document in place of the LuaTeX template, the companion
   package's support), and `capture()` runs the engine and converts what it
   records into the `SerializerOutput` shape. A run at `widthExtraSp > 0`
   widens the text width, as the LuaTeX template's `%%WIDTH-EXTRA-SP%%`
   does. Pictures come through a `PictureSource`; problems as
   `diagnostics`.
2. **Describe it honestly.** Set `runtime` (a native program is `process`,
   a WebAssembly build `wasm`) and claim only the capabilities the
   conformance suite confirms. `availability()` returns `{ ok: false,
   reason }` when the engine or its files are missing from the build, so
   selecting it still fails clearly.
3. **Register it** in `registry.ts` (or, from a host, with
   `registerBackend`).
4. **Run the conformance suite** with `REFLOWTEX_BACKENDS=tectonic`; claim
   each capability as its check passes. Add a fixture and a check for any
   new capability, and a row to both tables above.
5. **Update the matrix** from "planned" to what the backend does.

Fields a backend adds to the output that the schema does not model are
ignored by the encoder, as today; a field the viewer should use needs a
change to `src/schema/latex.proto` first.
