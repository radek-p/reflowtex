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
.latex-block rect.latex-mark[data-mark~="key"] {
  fill: color-mix(in srgb, var(--lt-primary) 18%, transparent);
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

<style>
  .latex-block rect.latex-mark[data-mark~="key"] { fill: color-mix(in srgb, var(--lt-primary) 18%, transparent); }
</style>
