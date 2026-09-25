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
Each card below is a block of \LaTeX{} in an ordinary web page.
{{< /latex >}}

<div class="bento">

<div class="card span-4 card-resize">
<div class="resizer" id="home-resizer">
<div class="resizer-body">

{{< latex preamble="home" >}}
\cardtitle{Drag the edge}
Drag the right edge of this box. The paragraph is broken into lines again
for the new width, with \TeX's hyphenation and justification, and formulas
such as $\sum_{k=1}^{n} k = \frac{n(n+1)}{2}$ keep their spacing. On a
phone the same text fits the screen, with no zooming or scrolling
sideways.
{{< /latex >}}

</div>
<div class="resizer-handle" role="slider" tabindex="0" aria-label="Width of the paragraph"
     aria-valuemin="30" aria-valuemax="100" aria-valuenow="100"></div>
</div>
</div>

<div class="card span-2">

{{< latex preamble="home" >}}
\raggedright
\cardtitle*{Displays}
\[ \int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi} \]
Displayed equations look as they do in the PDF.
{{< /latex >}}

</div>

<div class="card span-2">

{{< latex preamble="home" >}}
\raggedright\hyphenpenalty=10000
\cardtitle*{TikZ pictures and diagrams}
\[
\begin{tikzcd}
  A \arrow[r, "f"] \arrow[d, "g"'] & B \arrow[d, "h"] \\
  C \arrow[r, "k"'] & D
\end{tikzcd}
\]
\[
\begin{tikzpicture}[>=stealth, thick, baseline=(p.base), every loop/.style={looseness=6}]
  \node[draw, circle, inner sep=2pt] (p) at (0,0) {$p$};
  \node[draw, circle, double, inner sep=2pt] (q) at (2,0) {$q$};
  \draw[->] (-0.8,0) -- (p);
  \draw[->, blue] (p) to[bend left] node[above] {$a$} (q);
  \draw[->, red] (q) to[bend left] node[below] {$b$} (p);
  \draw[->] (p) to[loop above] node[above] {$b$} (p);
  \draw[->] (q) to[loop above] node[above] {$a$} (q);
\end{tikzpicture}
\]
{{< /latex >}}

</div>

<div class="card span-2">

{{< latex preamble="home" >}}
\raggedright
\cardtitle{Accessibility settings}
\noindent Text size and colour scheme.
{{< /latex >}}

{{< reading-options >}}

</div>

<div class="card span-2 card-split">

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

{{< latex preamble="home" >}}
\noindent\textit{Exercise.} Is $2^{11} - 1$ prime?
\begin{webhint}
No: $2^{11} - 1 = 2047 = 23 \cdot 89$.
\end{webhint}
{{< /latex >}}

</div>

<div class="card span-2">

{{< latex preamble="home" >}}
\raggedright
\hyphenpenalty=10000
\cardtitle{Figures scaled to width}
\noindent\includegraphics[width=\linewidth]{figures/kink.pdf}
{{< /latex >}}

</div>

<div class="card span-2">

{{< latex preamble="home" >}}
\raggedright
\cardtitle{Tables}
\noindent A table as wide as the column follows the column.

\medskip
\begin{tabular*}{\linewidth}{@{\extracolsep{\fill}}lrr@{}}
\hline
Planet & Mass & Day \\
\hline
Mercury & 0.330 & 4\,222.6 \\
Venus   & 4.87  & 2\,802.0 \\
Earth   & 5.97  & 24.0 \\
Mars    & 0.642 & 24.7 \\
\hline
\end{tabular*}
{{< /latex >}}

</div>

<div class="card span-2">

{{< latex preamble="home" >}}
\cardtitle{Footnotes and links}
\vspace{-\baselineskip}
\begin{equation}\label{eq:home-euler}
  e^{i\pi} + 1 = 0
\end{equation}
References such as~\eqref{eq:home-euler} are links. Footnotes open where
you are reading, when you point at the marker.\footnote{Like this one.}
{{< /latex >}}

</div>

<div class="card span-3 live-card">

{{< latex preamble="home" >}}
\raggedright
\cardtitle{Live text}
\noindent The basket holds \webtext{apples}{no apples at all}. The page's
script sets these words, and the lines are broken again around them.
{{< /latex >}}

<div class="home-stepper" role="group" aria-label="Apples in the basket">
<button type="button" data-step="-1" aria-label="One apple fewer" disabled>−</button><output>0</output><button type="button" data-step="1" aria-label="One apple more">+</button>
</div>

</div>

<div class="card span-3">

{{< latex preamble="home" >}}
\raggedright
\cardtitle{HTML widgets}
\noindent A page can place its own HTML in the text, such as this
badge: \webwidget{home:badge}. Click it to change its label; the badge
may be split between lines, like a word.
{{< /latex >}}

</div>

<div class="card span-6">

{{< latex preamble="home" >}}
\cardtitle{Lean beside a proof}
\noindent Open the proof, the Lean code that checks it, or both.
\begin{leantheorem}[decl=sum_odd]
\begin{theorem}
The sum of the first $n$ odd numbers is $n^2$.
\end{theorem}
\begin{proof}
By induction on $n$. For $n = 0$ both sides are $0$. If the sum of the
first $k$ odd numbers is $k^2$, adding the next one gives
\[ k^2 + (2k + 1) = (k + 1)^2 . \]
\end{proof}
\begin{leancode}
theorem sum_odd (n : ℕ) :
    ∑ i ∈ Finset.range n, (2 * i + 1) = n ^ 2 := by
  induction n with
  | zero => simp
  | succ k ih =>
    rw [Finset.sum_range_succ, ih]
    ring
\end{leancode}
\end{leantheorem}
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
    // Live text: the stepper sets the words in the basket.
    var stepper = document.querySelector('.home-stepper');
    if (stepper) {
      var WORDS = ['no apples at all', 'a single apple', 'two apples', 'three apples', 'four apples',
        'five apples', 'six apples', 'seven apples', 'eight apples', 'nine apples', 'ten apples'];
      var n = 0, out = stepper.querySelector('output'), minus = stepper.querySelector('[data-step="-1"]');
      stepper.addEventListener('click', function (e) {
        var b = e.target.closest('[data-step]'); if (!b) return;
        n = Math.max(0, Math.min(99, n + Number(b.dataset.step)));
        out.textContent = n; minus.disabled = n === 0;
        if (window.reflowtex && reflowtex.setText) reflowtex.setText('apples', n === 0 ? null : (WORDS[n] || n + ' apples'));
      });
    }
    // An HTML widget: a badge in the text, split at its spaces when the
    // line needs it. A click swaps its label and the paragraph re-breaks.
    var LABELS = ['✓ checked', '✓ checked by Lean on 25 September 2026'];
    var esc = function (t) { return t.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); };
    window.reflowtex = window.reflowtex || {};
    reflowtex.widgets = reflowtex.widgets || {};
    reflowtex.widgets['home:badge'] = {
      measure: function (ctx) {
        var words = LABELS[ctx.state.long ? 1 : 0].split(' ');
        var m = function (t) { return ctx.measure('<span class="home-badge" style="padding:0"><span style="white-space:pre">' + esc(t) + '</span></span>'); };
        var space = m('a b').width - m('ab').width, pad = 0.55 * 0.72 * ctx.fontSize;
        return {
          segments: words.map(function (w) { var r = m(w); return { width: r.width, height: r.height, depth: r.depth }; }),
          gaps: words.slice(1).map(function () { return { width: space, penalty: 100 }; }),
          ends: { left: { cap: pad, cut: pad }, right: { cap: pad, cut: pad } },
        };
      },
      render: function (el, part, ctx) {
        var words = LABELS[ctx.state.long ? 1 : 0].split(' ');
        el.innerHTML = '<button type="button" class="home-badge' + (part.left === 'cut' ? ' cut-left' : '')
          + (part.right === 'cut' ? ' cut-right' : '') + '">' + esc(words.slice(part.from, part.to + 1).join(' ')) + '</button>';
        el.firstChild.addEventListener('click', function () { ctx.state.long = !ctx.state.long; ctx.invalidate(); });
      },
    };
  })();
</script>
