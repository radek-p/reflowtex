---
title: Reference
weight: 60
latexTitle: true
---

{{< latex preamble="webfirst" >}}
\pagetitle[Companion package]{Reference}
\bigskip
\begin{description}
\item[\cs{ifreflowtex}] true only in the pipeline's compile.
\item[webonly, printonly] body kept only on the web, or only in print.
\item[\texttt{webstream[key=value]\{kind\}}] typeset the body as a
  stream of that kind; parameters become \texttt{data-}\emph{key}, except
  \texttt{class} (CSS classes) and \texttt{--}\emph{name} (a CSS custom
  property); transparent in print.
\item[\cs{webaction}\texttt{\{action\}\{text\}}] a control sending
  \emph{action} as a \texttt{reflowtex:action} event; nothing in print.
  (\cs{webaction}, its first name, still works.)
\item[\cs{webwidget}\texttt{[default]\{name\}}] a place for a page's HTML
  widget (\texttt{reflowtex.widgets[name]}), which reports its size and
  where it may break; the line breaker may break it across lines. Nothing
  in print, unless given a default.
\item[\cs{webaside}\texttt{[key=value]\{kind\}\{text\}}] text typeset
  out of the flow, in running text too, for a page to show where it likes
  (a popover, a margin note); left out in print. A widget gets its block's
  asides as \texttt{ctx.asides(kind)}, a script any block's as
  \texttt{reflowtex.asides(block, kind)}: each \texttt{\{kind, attrs,
  width(), render(el, width?)\}}, drawn at a width or on one line at its
  natural width. Example: \cs{mypopover} on the page Footnotes.
\item[\cs{webtext}\texttt{\{name\}\{default\}}] text a page may replace:
  \texttt{reflowtex.setText(name, text)}, or \texttt{null} for the default
  again; the default in print.
\item[\texttt{webaccordion[initial=,print=]}] one \texttt{webpane[name]}
  shown at a time.
\item[\cs{webpanelink}, \cs{webnextpane}, \cs{webprevpane}] switch pane: a name,
  a number, \texttt{next}, \texttt{prev}, \texttt{first}, \texttt{last}.
\item[webnote, webhint] a note; a hint blurred until clicked, and again on the next click.
\item[\texttt{leantheorem[decl=,url=,show=]}] a theorem with its proof and
  Lean code: switches in the theorem's frame open either or both beneath it.
\item[\texttt{leanproof[decl=,url=,show=]}, \texttt{leancode}] a proof and
  its Lean code in one frame, each shown or hidden by its own switch; option
  \texttt{leanprint=false} leaves the code out of print. The macros of leanblueprint --
  \cs{lean}, \cs{leanok}, \cs{uses} and the rest -- compile as markers.
\item[\cs{DeclareWebBox}\texttt{[new]\{env\}[options]}] draw \emph{env} (or a
  copy of it named \emph{new}) as a box; options \texttt{kind},
  \texttt{accent}, \texttt{background}, \texttt{class}.
\item[\texttt{[boxed]}] package option: every \cs{newtheorem}
  environment and \texttt{proof} boxed.
\item[\texttt{.latex-stream[data-kind=\dots]}] a stream's element; its first
  child holds the laid-out content.
\item[\texttt{window.reflowtex.streamKinds}] kinds a page defines:
  \texttt{\{alternatives?, mount(box, ctx)\}}, with \texttt{ctx} holding
  \texttt{kind}, \texttt{index}, \texttt{stream}, \texttt{attrs},
  \texttt{state} and \texttt{paint()}.
\end{description}
A \texttt{webstream} is block-level: it starts and ends a paragraph. A
\cs{webaside} is not: it may stand in a sentence. The DOM contract is in \texttt{src/viewer/README.md}, section
\emph{Streams}, and the wire format in \texttt{src/schema/latex.proto},
message \texttt{Stream}.
{{< /latex >}}

