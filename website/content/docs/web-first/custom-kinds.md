---
title: Custom kinds
weight: 50
latexTitle: true
---

{{< latex preamble="webfirst" >}}
\pagetitle[Web-first \LaTeX]{Custom kinds}
\bigskip
The package is built from two primitives, streams and actions. You can use
them for environments of your own.
\section*{Streams}
\verb|\begin{webstream}[|\emph{key=value}\verb|]{|\emph{kind}\verb|}|
makes what is typeset inside it a \emph{stream}: a separate run of paragraphs
and displays with a name, its \emph{kind}, placed where the environment stood.
Streams nest, and a footnote is a stream too. On its way to the reader a
stream passes four stages:
\begin{enumerate}
\item \textbf{\TeX{}} typesets the body as usual; every node inside carries
  the stream's number in a LuaTeX attribute, which changes nothing about the
  typesetting.
\item \textbf{The serializer} collects the paragraphs and displays of that
  number into a stream of that kind, and leaves a placeholder in the flow.
\item \textbf{The viewer} lays the stream out inside
  \verb|<div class="latex-stream" data-kind="|\emph{kind}\verb|">|, re-broken
  at the width of that element, with every parameter as a
  \texttt{data-}\emph{key} attribute.
\item \textbf{The page} decides what the kind looks like, with CSS, and what
  it does, with a few lines of JavaScript.
\end{enumerate}
\section*{Actions}
\verb|\webaction{|\emph{action}\verb|}{|\emph{text}\verb|}| makes the
text a control: clicking it sends \emph{action} to the page as a DOM event
that bubbles out through the streams around it. The accordion's links are
actions.
\section*{Example: a warning}
\textbf{Step 1: the environment.} Name a kind and open a stream of it, in the
preamble.
{{< /latex >}}

```latex
\newenvironment{webwarning}
  {\begin{webstream}{warning}}
  {\end{webstream}}
```

{{< latex preamble="webfirst" >}}
\textbf{Step 2: the look.} Style the stream's element like any other. Padding
narrows the measure: the text inside is broken to fit what is left.
{{< /latex >}}

```css
.latex-stream[data-kind="warning"] {
  padding: 0.6rem 1rem;
  border-left: 3px solid #c2410c;
  background: color-mix(in srgb, #c2410c 8%, transparent);
}
```

{{< latex preamble="webfirst" show-source="true" >}}
\begin{webwarning}
\noindent\textbf{Warning.} This paragraph was written inside
\texttt{webwarning}, a kind this page defines for itself. In a PDF it is an
ordinary paragraph.
\end{webwarning}
{{< /latex >}}

{{< latex preamble="webfirst" >}}
\textbf{Step 3: the behaviour}, when a kind needs one. Register it under the
kind's name in a script on the page, before or after the viewer. The viewer
calls \texttt{mount} once for every box of that kind, with the box and a
\texttt{ctx}; \texttt{ctx.state} outlives the box -- the viewer rebuilds
boxes when web fonts arrive -- so a kind keeps what it must remember there.
The built-in hint is this code plus keyboard handling:
{{< /latex >}}

```js
window.reflowtex ??= { streamKinds: {} };
reflowtex.streamKinds.hint = {
  mount(box, ctx) {
    const reveal = () => { ctx.state.revealed = true; box.classList.add('latex-revealed'); };
    if (ctx.state.revealed) reveal();
    box.addEventListener('click', reveal);
  },
};
```

{{< latex preamble="webfirst" >}}
\section*{How the accordion is built}
The same way. Its environments open streams, with the options passed on as parameters, and
its links are actions:
{{< /latex >}}

```latex
\NewDocumentEnvironment{webaccordion}{O{}}   % options: initial=…, print=…
  {\begin{webstream}[#1]{accordion}}
  {\end{webstream}}
\NewDocumentEnvironment{webpane}{O{}}
  {\begin{webstream}[name=#1]{pane}}
  {\end{webstream}}
\NewDocumentCommand\webpanelink{m m}{\webaction{pane:#1}{#2}}
\NewDocumentCommand\webnextpane{O{See more}}{\webpanelink{next}{#1}}
```

{{< latex preamble="webfirst" >}}
(The real definitions add defaults and the print forms.) Its look is one CSS
rule, hiding every pane but the active one. Its behaviour listens for the
actions; \texttt{alternatives: true} tells the viewer that the panes replace
one another, so each is spaced as if it alone stood in its place.
{{< /latex >}}

```js
accordion: {
  alternatives: true,                   // panes replace one another
  mount(box, ctx) {
    const panes = [...box.firstElementChild.children]
      .filter(e => e.dataset.kind === 'pane');
    const show = i => {
      ctx.state.pane = i;
      panes.forEach((p, k) => p.classList.toggle('latex-pane-active', k === i));
      ctx.paint();                      // draw the pane now showing
    };
    show(ctx.state.pane ?? find(ctx.attrs.initial));
    box.addEventListener('reflowtex:action', e => {
      const m = /^pane:(.+)$/.exec(e.detail.action);
      if (!m) return;                   // not ours: let it bubble on
      e.stopPropagation();              // an outer accordion must not act too
      show(find(m[1]));                 // find: next, prev, a name, a number…
    });
  },
},
```

<style>
  .latex-stream[data-kind="warning"] {
    padding: 0.6rem 1rem;
    border-left: 3px solid #c2410c;
    background: color-mix(in srgb, #c2410c 8%, transparent);
  }
</style>
