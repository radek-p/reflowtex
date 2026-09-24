---
title: Reflow TeX
latexTitle: true
aliases: ["/docs/"]
---

{{< latex preamble="home" >}}
\pagetitle[Reflow\,\TeX]{Real \TeX{} on the web}
\bigskip
\noindent \LaTeX{}, published exactly as a genuine Lua\TeX{} run set it --
every glyph, kern and formula -- with the lines broken again by the browser,
for whatever screen it is read on.
{{< /latex >}}

{{< hero >}}

{{< latex preamble="home" >}}
\section*{It is all real \TeX}
Every card below is a live block: set by \TeX, laid out by the browser. The
layout around them is plain HTML and CSS -- which is the point.
{{< /latex >}}

<div class="bento">

<div class="card span-4 card-resize">
<div class="resizer" id="home-resizer">
<div class="resizer-body">

{{< latex preamble="home" >}}
\cardtitle{Drag the edge}
This paragraph was typeset once, by \TeX{}, and never again by anything
else: every glyph, every kern, the spacing of
$\sum_{k=1}^{n} k = \frac{n(n+1)}{2}$. What the browser does is choose
where the lines break. Drag this field's right edge, and the Knuth--Plass
algorithm runs again for the new width, hyphenation included, so the column
stays justified and even at any measure.
{{< /latex >}}

</div>
<div class="resizer-handle" role="slider" tabindex="0" aria-label="Width of the paragraph"
     aria-valuemin="30" aria-valuemax="100" aria-valuenow="100"></div>
</div>
</div>

<div class="card span-2">

{{< latex preamble="home" >}}
\cardtitle{Displays}
\[ \int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi} \]
Operator sizes, limits and spacing, as \TeX{} set them.
{{< /latex >}}

</div>

<div class="card span-2 theme-hover" data-latex-theme="dark" tabindex="0">

{{< latex preamble="home" >}}
\cardtitle{In the dark}
\begin{align*}
  (a+b)^2 &= a^2 + 2ab + b^2 \\
  (a-b)^2 &= a^2 - 2ab + b^2
\end{align*}
This card alone is in the dark theme; the colour map recolours its
\TeX. Point at it.
{{< /latex >}}

</div>

<div class="card span-2 theme-hover" data-latex-theme="sepia" tabindex="0">

{{< latex preamble="home" >}}
\cardtitle{Diagrams, in sepia}
\[
\begin{tikzcd}
  A \arrow[r, "f"] \arrow[d, "g"'] & B \arrow[d, "h"] \\
  C \arrow[r, "k"'] & D
\end{tikzcd}
\]
A \texttt{tikz-cd} square, drawn as SVG with \TeX's own metrics.
{{< /latex >}}

</div>

<div class="card span-2">

{{< latex preamble="home" >}}
\cardtitle{Interactive}
\begin{theorem}
There are infinitely many primes.
\end{theorem}
\begin{webaccordion}
\begin{webpane}[collapsed]
\noindent\textit{Idea:} multiply them all, add one. \webnextpane[Proof]
\end{webpane}
\begin{webpane}[expanded]
\begin{proof}\hfill\webprevpane[Less]\par
If $p_1, \dots, p_k$ were all of them, $p_1 \cdots p_k + 1$ would have a
prime factor that is none of them.
\end{proof}
\end{webpane}
\end{webaccordion}
{{< /latex >}}

</div>

<div class="card span-3">

{{< latex preamble="home" >}}
\cardtitle{Footnotes and links}
\vspace{-\baselineskip}
\begin{equation}\label{eq:home-euler}
  e^{i\pi} + 1 = 0
\end{equation}
Equation~\eqref{eq:home-euler} is a link, and this sentence ends in a
footnote.\footnote{Typeset by \TeX{} in full, and re-broken to fit the
popover.} Hover the marker.
{{< /latex >}}

</div>

<div class="card span-3">

{{< latex preamble="home" >}}
\cardtitle{Real text}
Select this sentence, search the page for it, copy it. It is text, drawn in
the document's own fonts, not a picture of text.
{{< /latex >}}

</div>

</div>

{{< latex preamble="home" >}}
\section*{How it works}
{{< /latex >}}

<div class="steps">

<div class="step">

{{< latex preamble="home" >}}
\raggedright
\cardtitle{\TeX{} sets it}
\noindent A real Lua\TeX{} run typesets your
source, and a Lua hook records the finished node list -- before any line
is broken.
{{< /latex >}}

</div>

<div class="step">

{{< latex preamble="home" >}}
\raggedright
\cardtitle{Shipped as data}
\noindent Glyphs, kerns, glue and boxes, with
their exact positions, travel as compact Protocol Buffers inside the page.
{{< /latex >}}

</div>

<div class="step">

{{< latex preamble="home" >}}
\raggedright
\cardtitle{The browser breaks it}
\noindent A small viewer runs Knuth--Plass
at the reader's width and draws SVG; resize, and it breaks again.
{{< /latex >}}

</div>

</div>

{{< latex preamble="home" >}}
\section*{Where to next}
{{< /latex >}}

<div class="map">

<a class="map-card" href="docs/getting-started/installation/">

{{< latex preamble="home" >}}
\raggedright
\cardtitle{Getting started}
\noindent Install the toolchain; publish a static
page, a Hugo site, or a book in parts.
{{< /latex >}}

</a>

<a class="map-card" href="docs/typesetting/inline-math/">

{{< latex preamble="home" >}}
\raggedright
\cardtitle{Typesetting}
\noindent What a block can hold, each with a live
result beside its source.
{{< /latex >}}

</a>

<a class="map-card" href="docs/web-first/overview/">

{{< latex preamble="home" >}}
\raggedright
\cardtitle{Web-first \LaTeX}
\noindent Accordions, notes, hints, boxed
theorems -- and kinds of your own.
{{< /latex >}}

</a>

<a class="map-card" href="docs/showcase/">

{{< latex preamble="home" >}}
\raggedright
\cardtitle{Showcase}
\noindent Complete papers and books, among them the AMS
sample paper, \texttt{testmath.tex}.
{{< /latex >}}

</a>

</div>

<script>
  (function () {
    // The draggable edge of the resizable paragraph, and its eased height.
    var box = document.getElementById('home-resizer');
    if (box) {
      var handle = box.querySelector('.resizer-handle'), body = box.querySelector('.resizer-body');
      var block = body.querySelector('.latex-block');
      var full = function () { return box.parentElement.clientWidth; };
      var setPct = function (pct) {
        pct = Math.max(30, Math.min(100, pct));
        box.style.width = pct + '%';
        handle.setAttribute('aria-valuenow', Math.round(pct));
      };
      handle.addEventListener('pointerdown', function (e) {
        handle.setPointerCapture(e.pointerId); box.classList.add('dragging'); e.preventDefault();
      });
      handle.addEventListener('pointermove', function (e) {
        if (!handle.hasPointerCapture(e.pointerId)) return;
        setPct((e.clientX - box.getBoundingClientRect().left) / full() * 100);
      });
      var end = function () { box.classList.remove('dragging'); };
      handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
      handle.addEventListener('keydown', function (e) {
        var now = parseFloat(handle.getAttribute('aria-valuenow'));
        if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { setPct(now - 5); e.preventDefault(); }
        if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { setPct(now + 5); e.preventDefault(); }
      });
      if (block && window.ResizeObserver) {
        new ResizeObserver(function () { body.style.height = block.offsetHeight + 'px'; }).observe(block);
      }
    }
    // Themed cards ease into the light theme while pointed at or focused.
    document.querySelectorAll('.card.theme-hover').forEach(function (card) {
      var rest = card.getAttribute('data-latex-theme');
      var light = function () { card.setAttribute('data-latex-theme', 'light'); };
      var back = function () { card.setAttribute('data-latex-theme', rest); };
      card.addEventListener('pointerenter', light); card.addEventListener('pointerleave', back);
      card.addEventListener('focus', light); card.addEventListener('blur', back);
    });
  })();
</script>
