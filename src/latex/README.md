# reflowtex.sty – the companion package

For documents written *for* the web, not only published on it. A snippet
loads it like any package:

```latex
\usepackage{reflowtex}
```

The pipeline finds it on its own (it puts this directory on `TEXINPUTS`). To
compile the same source to a PDF, put `reflowtex.sty` next to the document.
Every construct has a print form, so the document still produces an ordinary
PDF.

| | On the web | In print |
|---|---|---|
| `\ifreflowtex` | true | false |
| `webonly` / `printonly` | body kept / dropped | dropped / kept |
| `\begin{webstream}{kind}` | body becomes a stream of that kind | transparent |
| `\begin{webstream}[key=value]{kind}` | parameters become `data-key` on the stream's element | ignored |
| `\webaction{action}{text}` | `text` is a control sending `action` to the page | nothing typeset |
| `\webtext{name}{default}` | `default`, which a page may replace: `reflowtex.setText(name, text)` | `default` |
| `\webwidget[default]{name}` | a page's HTML widget (`reflowtex.widgets[name]`), breakable across lines | `default`, or nothing (and no extra space) |
| `webaccordion[initial=…, print=…]` with `webpane[name]` | one pane shown at a time | only the `print=` pane (default: the last) |
| `\webpanelink{target}{text}`, `\webnextpane[text]`, `\webprevpane[text]` | switch the enclosing accordion (target: name, number, `next`, `prev`, `first`, `last`) | nothing typeset |
| `webnote`, `webhint` | a framed note; a hint blurred until clicked | ordinary paragraphs |
| `\DeclareWebBox[new]{env}[kind=, accent=, background=, class=]` | `env` (or its copy `new`) drawn as a box | nothing (the copy is defined) |
| `leantheorem[decl=, url=, show=]`: a theorem, its proof, `leancode` | the theorem, with Proof and Lean switches hanging under its frame, opening either or both beneath it | theorem, proof, then the code (`leanprint=false`: without) |
| `leanproof[decl=, url=, show=]` with `leancode` | one frame; Proof and Lean switches show either, both (side by side) or neither | the proof, then the code as a listing (`leanprint=false`: without) |
| leanblueprint's `\lean`, `\leanok`, `\uses`, … | markers, no output | markers, no output |
| option `[boxed]` | every `\newtheorem` environment and `proof` boxed | nothing |

`webstream` is the primitive the rest is built from. How a stream travels
through the pipeline, and how to give a new kind a look (CSS) and a behaviour
(JavaScript), is on the website's *Web-first LaTeX* page
(`website/content/docs/web-first.md`) and in the Streams section of
[src/viewer/README.md](../viewer/README.md).

Limits:
- Streams are block-level: each one starts and ends a paragraph.
- The bodies of `webonly`/`printonly`, and in print the panes, are read as
  arguments, so they cannot hold verbatim.
- Panes are named by option, `\begin{webpane}[expanded]`: an environment
  named `expanded` would clash with the `\expanded` primitive.
