# Pictures: a PDF page as SVG

A captured TikZ picture or an included PDF figure is a page of a PDF; these
modules draw it as SVG for the page, with no Node API, so that the build
pipeline and a browser (a host's Web Worker) convert a picture alike.

| module | what |
|---|---|
| `pdf-svg.ts` | `pdfPageSvg(bytes, page, { wasmUrl })` → `{ svg }`: MuPDF's drawing of the page, every glyph a `<use data-text>` of its outline; `pdfPagePicture(bytes, page, prefix, { wasmUrl })` → `{ svg, vb_w, vb_h }`, the picture as the pipeline puts it in a document |
| `rewrite.ts` | `rewritePictureSvg(svg, prefix)`: the markup cleaned of what could run, ids prefixed, colours to the theme's custom properties (a mask's content keeps its own). No MuPDF |

Bytes are a `Uint8Array`, results plain objects of strings and numbers.
MuPDF (the `mupdf` package, 10 MB of WebAssembly) is loaded with a dynamic
import on the first conversion: a module that imports `pdf-svg.ts` statically
pulls nothing heavy into a bundle until a picture is drawn. The package finds
its `.wasm` beside its own module; a host that serves it from another place
passes `wasmUrl` (read on the first conversion). The pipeline's side –
reading the files, bitmaps, the picture nodes – is `src/pipeline/pictures.ts`.
