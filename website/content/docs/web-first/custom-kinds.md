---
title: Custom kinds
weight: 55
latexTitle: true
---

{{< latex preamble="webfirst" >}}
\pagetitle[Companion package]{Custom kinds}
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
Or, with both forms at once – the web's and the PDF's – in one line:
{{< /latex >}}

```latex
\NewWebEnvironment{webwarning}{warning}{\par\noindent\textbf{Warning.} }{\par}
```

{{< latex preamble="webfirst" >}}
Its \verb|[key=value]| parameters reach the page as they are written (a
colour may be \verb|#c2410c|). \cs{NewWebAside} does the same for a command
whose text stands out of the flow, in the margin or a popover.
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
\textbf{Step 3: the behaviour}, when a kind needs one. The companion
package draws a kind with a component, in the element the stream has in the
flow. \verb|<Typeset/>| is the stream's text, laid out at the width it is
given and spaced from the text around it as \TeX{} spaced it; the element
grows and shrinks with what the component draws, and the text after it
follows. State kept with \verb|useInstanceState| outlives redrawing. The
built-in hint is this, plus keyboard handling and the look:
{{< /latex >}}

```js
import { define, Typeset, useInstanceState, useBlockHost, useLayoutEffect, html }
  from 'reflowtex/companion';

define('hint', () => {
  const revealed = useInstanceState('revealed', false), host = useBlockHost();
  useLayoutEffect(() => {
    const flip = () => { revealed.value = !revealed.value; };
    host.el.addEventListener('click', flip);
    return () => host.el.removeEventListener('click', flip);
  }, []);
  useLayoutEffect(() => { host.el.toggleAttribute('data-revealed', revealed.value); });
  return html`<${Typeset} />`;
});
```

{{< latex preamble="webfirst" >}}
\section*{How the accordion is built}
The same way. Its environments open streams, with the options passed on as
parameters, and its links are actions:
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
(The real definitions add defaults and the print forms.) Its component draws
each pane's text, showing one, and handles the actions of verb
\texttt{pane} pressed in them: \verb|useAction| gets them however deep in
the panes the link stands, and one accordion inside another handles its own.
{{< /latex >}}

```js
define('accordion', ({ instance, attrs }) => {
  const panes = instance.children.filter(c => c.kind === 'pane');
  // find: a pane by name, number, next, prev, first or last
  const open = useInstanceState('pane', () => find(panes, attrs.initial || '1'));
  useAction('pane', ({ arg }) => { open.value = find(panes, arg, open.value); });
  return html`${panes.map((p, i) => html`
    <div class="rtx-pane" data-state=${i === open.value ? 'open' : 'closed'}>
      <${Typeset} of=${p} edge=${i === open.value ? 'both' : undefined} />
    </div>`)}`;
});
```

{{< latex preamble="webfirst" >}}
The package's own adds the animation, the keyboard and print
(\texttt{src/companion/src/kinds/accordion.tsx}).
{{< /latex >}}

<style>
  .latex-stream[data-kind="warning"] {
    padding: 0.6rem 1rem;
    border-left: 3px solid #c2410c;
    background: color-mix(in srgb, #c2410c 8%, transparent);
  }
</style>
