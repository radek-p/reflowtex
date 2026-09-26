---
title: Marks
weight: 52
latexTitle: true
---

{{< latex preamble="webfirst" >}}
\pagetitle[Companion package]{Marks}
\bigskip
Some text should be found or styled on its own: a key sentence, the term
being defined, a step of a proof that a script points at.
\verb|\webclass{|\emph{classes}\verb|}{|\emph{text}\verb|}| gives the text
CSS classes, and \verb|\webid{|\emph{id}\verb|}{|\emph{text}\verb|}| names
it. Every glyph inside carries the mark however the lines break, so a rule
in the page's stylesheet reaches all of it. Behind the text, each line of a
mark also has a band, from its first glyph to its last, spaces included:
it is invisible until the page gives it a colour, and makes a highlighter,
which a link's colour cannot be mistaken for. Marks nest: an inner one keeps
the outer classes. In print the text is simply typeset.
{{< /latex >}}

{{< latex preamble="webfirst" show-source="true" >}}
A prime is a number with exactly two divisors. \webclass{key}{Every number
above one is a product of primes, in only one way}, and that is why they
are called the atoms of arithmetic.
{{< /latex >}}

```css
/* a highlighter; a stroke of the same colour pads it, with round corners */
.latex-block rect.latex-mark[data-mark~="key"] {
  fill: #fff176; stroke: #fff176; stroke-width: 3px; stroke-linejoin: round;
}
```

{{< latex preamble="webfirst" >}}
A named mark is found from a script: \texttt{reflowtex.host.mark(id)} gives
the elements of its glyphs and a rectangle for each line it is drawn on, to
highlight it or place something beside it. Lines far from the window are
drawn only as the reader nears them, and so are their marks.
{{< /latex >}}

```js
const { elements, rects } = reflowtex.host.mark('euclid');
for (const r of rects()) { /* one rectangle per line */ }
```

{{< latex preamble="webfirst" >}}
\subsection*{The reader's marks}
A page can let its readers mark text too. With the highlighter on the
page, select some text on this one: a bar offers colours, and the text
gets a band behind each of its lines, as the key sentence above has. The
bands follow the text when the lines break again, a highlight may reach
from one block into the next, and pressing highlighted text lets the reader
change its colour or remove it. The page remembers them for the next visit.
{{< /latex >}}

```html
<div data-rtx="highlighter"></div>
```

{{< latex preamble="webfirst" >}}
Underneath, a highlight is a live mark: \texttt{reflowtex.host.addMark}
takes the glyphs by their places in the text and draws them as the
author's marks are drawn, with its classes in \texttt{data-mark}.
{{< /latex >}}

<div data-rtx="highlighter"></div>

<style>
  :root { --mark-highlight: #fff176; }
  html.dark, [data-latex-theme="dark"] { --mark-highlight: #5c5000; }
  .latex-block rect.latex-mark[data-mark~="key"] {
    fill: var(--mark-highlight); stroke: var(--mark-highlight); stroke-width: 3px; stroke-linejoin: round;
  }
</style>
