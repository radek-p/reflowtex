---
title: Inline buttons
weight: 50
latexTitle: true
---

{{< latex preamble="webfirst" >}}
\pagetitle[Companion package]{Inline buttons}
\bigskip
A \cs{webwidget} is a place in a line of text where the page draws its own
HTML. The companion package's browser side draws one kind for you: a button
that sits in the line, its label anything – text \TeX{} has typeset, say.
The component \verb|InlineButton| draws it, and \verb|InlineButton.size| gives
the widget's size; its look is CSS, custom properties and a class of your
own.
{{< /latex >}}

{{< latex preamble="webfirst" >}}
\section*{DIY: a note behind a button}
Here \cs{mypopover}\verb|{label}{note}| puts a button in the text, with the
label on it, that opens the note below. The preamble makes it of a
\cs{webwidget} and its two parts, the label and the note (\cs{webpart}),
which \TeX{} typesets with the rest and keeps out of the flow.
{{< /latex >}}

{{< latex preamble="popover" show-source="true" >}}
The Moon's distance changes over a month \mypopover{more}{From about
363\,300\,km at perigee to 405\,500\,km at apogee: its orbit is an
ellipse.}.
{{< /latex >}}

{{< latex preamble="webfirst" >}}
The preamble:
{{< /latex >}}

{{< source preamble="popover" >}}

{{< latex preamble="webfirst" >}}
The page's script. The widget is an inline instance of kind
\texttt{popover}, and the label and the note are its parts. It draws them
with the building blocks the companion package provides, written with
Preact.
{{< /latex >}}

{{< include file="examples/popover.js" >}}

{{< include file="examples/popover.js" as="module" >}}
