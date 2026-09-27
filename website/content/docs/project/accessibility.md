---
title: Accessibility
weight: 20
aliases: [/docs/getting-started/accessibility/]
latexTitle: true
---

{{< latex preamble="docs" >}}
\pagetitle[The project]{Accessibility}
\bigskip
A page made with Reflow\,\TeX\ can carry, next to each block, the text a
screen reader needs: the words in reading order, and every formula as
MathML. VoiceOver reads MathML aloud and lets the reader
step through a formula part by part.

Each formula also carries its spoken form, written when the page is built.
A reader who would rather hear that can choose it: the formula is then
read as part of the sentence, without a stop at every symbol. The choice
is in the reading options, under \emph{Formulas for screen readers}, and
in the switch below.

The picture shows the beginning of AMS \texttt{testmath.tex}. The orange
boxes are where the hidden text lies; a screen reader outlines them as it
reads. Under each line is what it is given there.
{{< /latex >}}

{{< a11y-reading >}}

{{< latex preamble="docs" >}}
The hidden text is laid over the drawing line by line, so the outline a
screen reader draws stays on the words it reads. Without JavaScript it is
still in the page, in reading order.

To build a page with it, pass \texttt{--a11y} to the static-site builder
(\texttt{integrations/vanilla/build.ts}). On a Hugo site, set
\texttt{reflowtexA11y = true} under \texttt{[params]}; a single block can
say \texttt{a11y="true"} or \texttt{a11y="false"}. Every block on this
site has it.

The inspector shows what a screen reader is given for any part of a page.
Its \emph{Accessibility} tab has the text of the selected box, with each
formula as MathML or spoken, and a switch between the two. Under
\emph{Overlays}, \emph{Accessibility layer} draws the orange boxes over
the page itself, as in the picture above.
{{< /latex >}}
