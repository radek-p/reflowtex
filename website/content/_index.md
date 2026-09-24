---
title: Reflow TeX
latexTitle: true
aliases: ["/docs/"]
---

{{< latex preamble="home" >}}
\pagetitle[Reflow\,\TeX]{\TeX{} typesetting on the web}
\bigskip
\noindent Write \LaTeX{} as usual and let Lua\TeX{} typeset it. The page keeps
\TeX's fonts, spacing and formulas; only the line breaks are left to the
browser, so the text fits any screen.
{{< /latex >}}

{{< hero >}}

{{< latex preamble="home" >}}
\section*{Examples}
Each card below is a separate block, typeset by \TeX{} and broken into lines
by the browser. The grid around them is ordinary HTML and CSS.
{{< /latex >}}

<div class="bento">

<div class="card span-4 card-resize">
<div class="resizer" id="home-resizer">
<div class="resizer-body">

{{< latex preamble="home" >}}
\cardtitle{Drag the edge}
This paragraph was typeset once, by \TeX{}: its glyphs, its kerns and
the spacing of $\sum_{k=1}^{n} k = \frac{n(n+1)}{2}$. The browser only
chooses where the lines break. Drag the right edge of this box and the
Knuth--Plass algorithm runs again for the new width, with hyphenation, so
the text stays justified.
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
Only this card uses the dark theme; a colour map recolours its
\TeX. Hover over it to switch to the light theme.
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
A \texttt{tikz-cd} diagram, drawn as SVG and placed with \TeX's
metrics.
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
footnote.\footnote{Typeset by \TeX{}, and re-broken to fit the
popover.} Hover over the marker.
{{< /latex >}}

</div>

<div class="card span-3">

{{< latex preamble="home" >}}
\cardtitle{Selectable text}
You can select this sentence, copy it, or find it with the browser's search.
It is ordinary text, drawn in the document's fonts.
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
\cardtitle{\TeX{} typesets}
\noindent Lua\TeX{} compiles your source. A Lua
hook saves each paragraph's node list before \TeX{} breaks it into
lines.
{{< /latex >}}

</div>

<div class="step">

{{< latex preamble="home" >}}
\raggedright
\cardtitle{Stored in the page}
\noindent The glyphs, kerns, glue and boxes,
with their positions, are stored in the page as Protocol Buffers.
{{< /latex >}}

</div>

<div class="step">

{{< latex preamble="home" >}}
\raggedright
\cardtitle{The browser breaks lines}
\noindent A small script runs Knuth--Plass
for the current width and draws the lines as SVG. When the width changes,
it runs again.
{{< /latex >}}

</div>

</div>

{{< latex preamble="about" >}}
\noindent At the width of its PDF, the browser puts every glyph of the AMS
sample paper within a third of a point of where LuaTeX put it:
\href{docs/showcase/accuracy/}{How close to the PDF?}
{{< /latex >}}

{{< latex preamble="home" >}}
\section*{Where to next}
{{< /latex >}}

<div class="map">

<a class="map-card" href="docs/getting-started/installation/">

{{< latex preamble="home" >}}
\raggedright
\cardtitle{Getting started}
\noindent Install the tools, then publish a
static page, a Hugo site or a book.
{{< /latex >}}

</a>

<a class="map-card" href="docs/typesetting/inline-math/">

{{< latex preamble="home" >}}
\raggedright
\cardtitle{Typesetting}
\noindent What a block can contain, each
example next to its source.
{{< /latex >}}

</a>

<a class="map-card" href="docs/web-first/overview/">

{{< latex preamble="home" >}}
\raggedright
\cardtitle{Web-first \LaTeX}
\noindent Accordions, notes, hints, boxed
theorems and environments of your own.
{{< /latex >}}

</a>

<a class="map-card" href="docs/showcase/">

{{< latex preamble="home" >}}
\raggedright
\cardtitle{Showcase}
\noindent Whole papers and books, including the
AMS sample paper \texttt{testmath.tex}.
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
