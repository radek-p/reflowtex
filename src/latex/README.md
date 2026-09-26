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
| `\webtext{name}{default}` | `default`, which a page may replace: `reflowtex.host.setText(name, text)` | `default` |
| `\webwidget[default]{kind:key}` | an inline instance the page draws (`defineInline(kind, …)` in the companion), breakable across lines | `default`, or nothing (and no extra space) |
| `\webpart{role}{text}` | a part of the widget before it (in text) or of the environment around it: `instance.part(role)` | nothing typeset |
| `\webid{id}{text}`, `\webclass{classes}{text}` | the glyphs marked: `data-rtx-id`, classes; a band under each line (`rect.latex-mark`); `reflowtex.host.mark(id)` | `text` |
| `\NewWebEnvironment{env}{kind}{print begin}{print end}` | `env[key=value]` is a block of `kind` | the body between the print code |
| `\NewWebAside{\cmd}{kind}{print form}` | `\cmd[key=value]{text}` is an aside of `kind` | the print form (`#1`: the text) |
| `webaccordion[initial=…, print=…]` with `webpane[name]` | one pane shown at a time | only the `print=` pane (default: the last) |
| `\webpanelink{target}{text}`, `\webnextpane[text]`, `\webprevpane[text]` | switch the enclosing accordion (target: name, number, `next`, `prev`, `first`, `last`) | nothing typeset |
| `webnote`, `webhint` | a framed note; a hint blurred until clicked | ordinary paragraphs |
| `\DeclareWebBox[new]{env}[kind=, accent=, background=, class=]` | `env` (or its copy `new`) drawn as a box | nothing (the copy is defined) |
| `leantheorem[decl=, url=, show=]`: a theorem, its proof, `leancode` (reflowtex-lean.sty, loaded with the package) | the theorem, with Proof and Lean switches hanging under its frame, opening either or both beneath it | theorem, proof, then the code (`leanprint=false`: without) |
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
