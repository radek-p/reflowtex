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
\item[\cs{webaction}\texttt{\{verb:arg\}\{text\}}] a control; pressed, it
  goes to the innermost instance around it handling \emph{verb}
  (\texttt{instance.onAction}, \texttt{useAction}), then outward, and
  bubbles as a \texttt{reflowtex:action} event; nothing in print.
\item[\cs{webwidget}\texttt{[key=value, default=text]\{kind\}}] an
  inline instance of \emph{kind} with those parameters, drawn by the kind
  the page defines (\texttt{defineInline}, or the host API's
  \texttt{define} with \texttt{measure}), which reports its size and where
  it may break; the line breaker may break it across lines. Nothing in
  print, unless given a default. (The first form,
  \verb|\webwidget[text]{kind:key}|, still works.)
\item[\cs{webpart}\texttt{\{role\}\{text\}}] text typeset out of the flow
  as a part of an instance, \texttt{instance.part(role)}: in running text
  of the \cs{webwidget} just before it, between paragraphs of the
  environment around it. Left out in print.
\item[\cs{webid}\texttt{\{id\}\{text\}}, \cs{webclass}\texttt{\{classes\}\{text\}}]
  marks: the text named, for \texttt{reflowtex.host.mark(id)} to find, or
  given CSS classes; they nest. Just the text in print.
\item[\cs{NewWebEnvironment}\texttt{\{env\}\{kind\}\{print begin\}\{print end\}}]
  an environment of your own: on the web a block of \emph{kind}, with its
  \texttt{[key=value]} parameters taken as written; in print, the body
  between the print code.
\item[\cs{NewWebAside}\texttt{\{\textbackslash cmd\}\{kind\}\{print form\}}]
  a command \verb|\cmd[key=value]{text}| of your own: on the web an aside
  of \emph{kind} (\texttt{place=margin} puts it in the margin); in print,
  the print form, \verb|#1| its text.
\item[\cs{webaside}\texttt{[key=value]\{kind\}\{text\}}] text typeset
  out of the flow, in running text too, for a page to show where it likes
  (a popover, a margin note); left out in print. A detached instance:
  \texttt{reflowtex.host.instances(\{kind, \dots\})}, its text
  \texttt{part('body')}, drawn with \verb|<Typeset>| or
  \texttt{part.mount(el, \{width\})}; with \texttt{place=margin} the
  viewer sets it in the margin, drawn by its kind if the page defines one.
  Example: \cs{mysidenote} on the page Side notes.
\item[\cs{webtext}\texttt{\{name\}\{default\}}] text a page may replace:
  \texttt{reflowtex.host.setText(name, text)}, or one instance's
  \texttt{setText(text)}; \texttt{null} for the default again; the
  default in print.
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
  (The Lean environments are \texttt{reflowtex-lean.sty}, loaded with the
  package.)
\item[\cs{DeclareWebBox}\texttt{[new]\{env\}[options]}] draw \emph{env} (or a
  copy of it named \emph{new}) as a box; options \texttt{kind},
  \texttt{accent}, \texttt{background}, \texttt{class}.
\item[\texttt{[boxed]}] package option: every \cs{newtheorem}
  environment and \texttt{proof} boxed.
\item[\texttt{.latex-stream[data-kind=\dots]}] a stream's element; its first
  child holds the laid-out content.
\item[\texttt{reflowtex.host.define(kind, \{render, measure?\})}] how a
  kind is drawn, for every placement: a block in the flow, a note in the
  margin, a widget's pieces. The companion package's \texttt{define} and
  \texttt{defineInline} do it with a Preact component. The contract, with
  every type: \texttt{src/viewer/src/host/types.ts}.
\end{description}
A \texttt{webstream} is block-level: it starts and ends a paragraph. A
\cs{webaside} is not: it may stand in a sentence. The DOM contract is in \texttt{src/viewer/README.md}, section
\emph{Streams}, and the wire format in \texttt{src/schema/latex.proto},
message \texttt{Stream}.
{{< /latex >}}

