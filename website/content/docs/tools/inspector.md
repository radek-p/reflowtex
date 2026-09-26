---
title: Inspector
weight: 10
latexTitle: true
---

{{< latex preamble="docs" >}}
\pagetitle[Tools]{Inspector}
\bigskip
The inspector shows the boxes, glue, kerns and penalties of every block,
as the browser has just laid them out. Hover a row
to outline its node on the page, and select it to see what it is made of.
As in Chrome's, the outline follows the pointer: it goes when the pointer
leaves the tree, and the arrow keys bring it back for the selected row. A glue shows the width it was stretched or shrunk to on its
line, and a line its glue ratio and font expansion. Resize the window and the
tree follows the new line breaks.

On this page the inspector is open from the start, on the example below,
docked to the right of the window -- or below the page when the window is
taller than it is wide. The icons beside its close button float it over
the page or dock it on the left, at the bottom or on the right; drag the
edge facing the page to resize it. The browser remembers your choice for
every page. Elsewhere, press \texttt{Alt+Shift+I} (\texttt{Option+Shift+I}
on a Mac), click \emph{Inspect} on an example's result, or choose
\emph{Inspect boxes and glue} in the reading options.
{{< /latex >}}

{{< inspector-demo >}}
{{< latex preamble="microtype" >}}
\noindent The golden ratio $\varphi = \frac{1+\sqrt{5}}{2}$ is the
positive root of $x^2 = x + 1$, and its continued fraction is all ones:
\[
  \varphi = 1 + \cfrac{1}{1 + \cfrac{1}{1 + \cfrac{1}{1 + \dotsb}}}
\]
Every line of this paragraph is broken in the browser, so the glue between
its words is stretched or shrunk to fit whatever width it is given.
{{< /latex >}}
{{< /inspector-demo >}}

{{< latex preamble="docs" >}}
\section*{Things to try}
\begin{description}
\item[A line.] Expand the text segment, hover a line, and the page outlines
  every node on it: glyphs in blue, glue green and hatched, kerns purple.
  The line's row gives its glue ratio -- positive when stretched, negative
  when shrunk.
\item[A fraction.] Choose the picker (the arrow in a box, at the left of
  the inspector's toolbar) and click the~$5$ under the square root. The
  tree opens at that glyph, inside the boxes \TeX{} built for the radical,
  the numerator and the fraction; hover each in turn and watch the outline
  grow.
\item[Vertical space.] Between two paragraphs, a heading and its text,
  or text and a display, a \emph{vertical space} row lists the glue \TeX{}
  put there -- a \verb|\vspace|, a heading's skip, \verb|\parskip|, a
  display skip, and the interline \verb|\baselineskip| glue -- each drawn
  as a band in the space it takes.
\item[Badness.] Turn on \emph{Badness} in the overlays menu (beside the
  picker) and every line gets a bar at its end: green where \TeX{} would
  call it decent, amber loose or tight, red at 100 or more. \emph{Baselines} draws the baseline of every line.
\item[The baseline.] Whatever you hover draws a guide along its baseline
  across the whole window, so you can see what sits on it and what does
  not.
\item[A reflow.] Make the window narrower. The lines re-break, and the
  open rows follow.
\item[Fonts and glyphs.] Switch to \emph{Resources} and choose a font. The
  table shows every glyph in its file and marks the ones the page uses.
  Hover a glyph to outline where it is used; select it to see it drawn in
  the box \TeX{} gave it. Search by the character, its code point
  (\texttt{U+03C6}) or its name: try \texttt{phi} in \texttt{cmmi10}.
\item[Pictures and footnotes.] \emph{Resources} also lists the page's
  pictures, its streams (a footnote opens its popover from there, and the
  popover's boxes appear in the tree), and its links and labels.
\item[Widgets and marks.] \emph{Resources} lists the page's instances --
  every widget, aside and stream, with its kind, attributes and parts --
  the kinds a script has defined, and the marks made with \verb|\webid|
  and \verb|\webclass|. Hover one to outline it on the page.
\item[Colours.] \emph{Colours} shows every colour map the page uses, one
  cell per colour and tint. Click a theme's name to switch the page to it.
  Change a cell with its picker or type any CSS colour, and the page is
  redrawn at once; \texttt{Escape} in the picker puts the colour back. \emph{Export} copies the maps as
  JSON and saves them to a file; \emph{Import} and \emph{Paste} load them
  back, and \emph{Reset} returns to the page's own.
\end{description}

\section*{On your own pages}
The inspector ships with the viewer, in \texttt{src/inspector/}. Serve the
folder as it is and include its script after the viewer's; it does nothing
until it is opened, and only then loads its panel. A page's own controls open it through
\texttt{window.reflowtex.inspector}.
{{< /latex >}}

```html
<script src="latex-viewer.js"></script>
<script src="inspector/inspector.js"></script>   <!-- the rest of src/inspector/ beside it -->
<script>
  // open it on one block, e.g. from a button of your own
  button.onclick = () => reflowtex.inspector.open(blockElement);
</script>
```
