# Documents and snippets

The pipeline compiles LaTeX in one of two kinds, and the caller says which:
`kind` is required, and the text is never read to decide. A call without it
fails at once, with an error naming the option (TypeScript callers fail at
compile time).

- **`document`**: a complete LaTeX file, `\documentclass` to `\end{document}`.
  It is compiled as it is. TeX itself chooses the class, even when the class
  line is behind a conditional or in a file the document inputs. TeX follows
  the inputs and expands the conditionals too. reflowtex adds no packages: the
  document gets what it loads.
- **`snippet`**: a piece of LaTeX, set in a document made of the caller's
  preamble (class, packages, macros), `\begin{document}`, the snippet and
  `\end{document}`. The preamble is the whole setup, so it starts with its
  `\documentclass` (and its `\DocumentMetadata`, if any, before that). Without
  a preamble, the snippet is set in reflowtex's default one
  (`DEFAULT_PREAMBLE` in `src/pipeline/driver.ts`): article with mathtools,
  amssymb and TikZ. Integrations are expected to pass their own.

Text holding a `\documentclass` and passed as a snippet is still a snippet. It
goes into the preamble's document, and TeX reports the second class line as
an error.

## How a document is compiled

lualatex compiles a driver (`reflowtex-driver.tex`), not the document. The
driver issues the caller's `\DocumentMetadata` when it applies (below), then
reads reflowtex's capture code (`src/extract/reflowtex-capture.tex`), then the
document with the primitive `\input`. The capture code loads no package. What
it needs from the class, from graphicx or from the preamble it installs through
LaTeX's hooks: the end of the class, `package/graphics/after` and
`begindocument/before`, where `reflowtex-capture-late.tex` is read.

The run is set up as the author's own:

- The job is named after the document's file (`-jobname`), so `\jobname` is the
  author's, and so are the names of the `.aux`, the `.bbl` it reads and the
  files it writes. A document given as text has the job name the caller passes
  (`jobname`), else `input`.
- The run's own directory comes first in `TEXINPUTS`, so the job's `.aux`,
  `.toc`, `.lof` and `.lot` are its own, never stale files of the same name
  beside the document. The document's directories come next.
- The primitive `\input` reads the document as TeX reads a main file:
  LaTeX's file hooks do not run for it, and `\CurrentFile` is empty in it, as in
  the author's run.
- TeX would read a `%&format` first line only in a main file. lualatex
  ignores `%&pdflatex` there too (checked, TeX Live 2026), so nothing differs.
  `% !TEX` lines are for editors, and TeX skips them either way.
- `\endinput` in the main file stops it where it stands, as in the author's run.
  A document that never reaches `\end{document}` ends with "no legal \end found"
  either way.

For a document, the caller's preamble, if it gives one, is read at the end of
the document's own preamble (`begindocument/before`), before reflowtex's late
capture code.

## The caller's `\DocumentMetadata`

`documentMetadata: { keys, force? }` (pipeline API), `--document-metadata KEYS
[--force-metadata]` (`tools/pageless-pdf/pageless.ts`). It applies to documents
and snippets alike.

- **Keep** (the default): the document's own `\DocumentMetadata` wins. The
  caller's keys apply only to a document that sets none. That is asked of TeX:
  a short run stops when the class begins, and the kernel's
  `\IfDocumentMetadataTF` says whether the document's own has run. The
  document's text is not read.
- **Force** (`force: true`): the caller's keys apply to every document. The
  driver issues them first. A `\DocumentMetadata` in the document is then
  ignored, and the log gets a warning naming its keys:
  `Package reflowtex Warning: The document's \DocumentMetadata is ignored, the
  caller's is forced. Ignored keys: lang=en.` This is meant for a publisher who
  sets one metadata for many documents. It is the only command reflowtex
  redefines for the document, and only under force.

## Passes

A run is repeated while what TeX reads back (`.aux`, `.toc`, `.lof`, `.lot`)
changes, or while the log asks for a rerun ("Rerun to get cross-references
right", a package's "Please rerun LaTeX"). It stops at `passes` (default 3).
`\relax` and the page count are left out of the comparison, because LaTeX
writes them to every `.aux`. So a snippet that reads nothing back takes one
pass, and the source is never searched for `\ref`.

## The API and the command lines

```ts
pipe.compile(content: string, o: {
  kind: 'document' | 'snippet',           // required
  preamble?: string,                      // a snippet's setup; for a document, read at the end of its own
  documentMetadata?: { keys: string, force?: boolean },
  jobname?: string,                       // \jobname (default 'input')
  passes?: number, key?: string, name?: string,
}): Promise<Uint8Array>

pipe.compileBatch(parts: { key, content, name? }[], o?: { preamble?, documentMetadata?, jobname?, passes?, key?, name? })
pipe.compileMany(items: { content, key, kind, preamble?, … }[], jobs?)
```

| | document | snippet |
|---|---|---|
| `Pipeline.compile(content, o)` | `o.kind = 'document'` | `o.kind = 'snippet'` |
| `Pipeline.compileBatch(parts, o)` | – | always: the parts are snippets set in `o.preamble` |
| `integrations/vanilla/build.ts DIR` | the default: every `.tex` file | `--snippet` (and `--batch`): `DIR/preamble.tex` is the setup |
| Hugo `{{< latex >}}` | `kind="document"` | the default; `preamble="name"` is the setup |
| `tools/pageless-pdf/pageless.ts FILE` | the default | `--snippet`, with `--preamble P.tex` |

Command lines: `--snippet [--preamble FILE]`, `--document-metadata KEYS
[--force-metadata]` (pageless.ts; vanilla's preamble is `DIR/preamble.tex`).
vanilla names each job after its file (`paper.tex`: `\jobname` is `paper`).
