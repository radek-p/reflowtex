---
title: Reflow TeX
latexTitle: true
# A candidate for the home page, set as one LaTeX document. Not linked from
# anywhere and not listed; to adopt it, move this content to _index.md (its
# relative links already assume the site root, hence the URL below).
type: docs
url: /home-draft.html
build:
  list: never
sitemap:
  disable: true
---

<div class="home-doc">

{{< latex batch="home" preamble="homedoc" >}}
\begin{center}
{\LARGE\bfseries Reflow\,\TeX\par}
\medskip
{\large \TeX{} typesetting on the web\par}
\end{center}

\begin{abstract}
Reflow\,\TeX{} puts \LaTeX{} documents on web pages. You write \LaTeX{} as
usual and Lua\TeX{} typesets it. Readers get \TeX's fonts, spacing,
formulas and pictures, with the lines broken again for the width of their
screen, so a paper can be read on a phone without zooming. This page is
written in \LaTeX{}; each section shows one thing you get.
\end{abstract}
{{< /latex >}}

<p class="home-doc-cta">
<a class="primary" href="docs/getting-started/installation/">Get started</a>
<a href="docs/showcase/testmath/">See a whole paper</a>
</p>

{{< latex batch="home" preamble="homedoc" class="opens-section" >}}
\section{Lines that fit the screen}
A PDF is set for one page width. Reflow\,\TeX{} keeps each paragraph as
\TeX{} built it, before it was broken into lines, and the browser breaks
it for the width it has.
{{< /latex >}}

<div class="resizer home-doc-resizer" id="home-resizer">
<div class="resizer-body">

{{< latex batch="home" preamble="homedoc" >}}
\noindent Drag the line on the right of this paragraph. The paragraph is
broken into lines again for the new width, with \TeX's hyphenation and
justification, and formulas such as $\sum_{k=1}^{n} k = \frac{n(n+1)}{2}$
keep their spacing. On a phone the same text fits the screen, with no
zooming or scrolling sideways.
{{< /latex >}}

</div>
<div class="resizer-handle" role="slider" tabindex="0" aria-label="Width of the paragraph"
     aria-valuemin="30" aria-valuemax="100" aria-valuenow="100"></div>
</div>

{{< latex batch="home" preamble="homedoc" class="opens-section" >}}
\section{Mathematics}
Formulas are set by \TeX, in its fonts, with its spacing. Displayed
equations are not re-broken; on a narrow screen the space around and
inside them shrinks first, as far as \TeX{} allows, and only then does a
display scroll.
\begin{equation}\label{eq:home-gauss}
  \int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
\end{equation}
Equations keep their numbers, and references such
as~\eqref{eq:home-gauss} are links. Footnotes open where you are reading,
when you point at the marker.\footnote{Like this one.}
{{< /latex >}}

{{< latex batch="home" preamble="homedoc" class="opens-section" >}}
\section{Pictures and tables}
Ti\emph{k}Z pictures are drawn as in the PDF and stay sharp at any zoom
(Figure~\ref{fig:home-tikz}). A picture or a table sized by the width of the
column, such as Figure~\ref{fig:home-kink} and Table~\ref{tab:home-planets},
follows the reader's column.

\begin{figure}[h]
\centering
\begin{tikzcd}
  A \arrow[r, "f"] \arrow[d, "g"'] & B \arrow[d, "h"] \\
  C \arrow[r, "k"'] & D
\end{tikzcd}
\qquad
\begin{tikzpicture}[>=stealth, thick, baseline=(p.base), every loop/.style={looseness=6}]
  \node[draw, circle, inner sep=2pt] (p) at (0,0) {$p$};
  \node[draw, circle, double, inner sep=2pt] (q) at (2,0) {$q$};
  \draw[->] (-0.8,0) -- (p);
  \draw[->, blue] (p) to[bend left] node[above] {$a$} (q);
  \draw[->, red] (q) to[bend left] node[below] {$b$} (p);
  \draw[->] (p) to[loop above] node[above] {$b$} (p);
  \draw[->] (q) to[loop above] node[above] {$a$} (q);
\end{tikzpicture}
\caption{A commutative square and a two-state automaton.}
\label{fig:home-tikz}
\end{figure}

\begin{figure}[h]
\centering
\includegraphics[width=.6\linewidth]{figures/kink.pdf}
\caption{A figure scaled to the width of the column.}
\label{fig:home-kink}
\end{figure}

\begin{table}[h]
\centering
\caption{Planets, their mass in $10^{24}$\,kg and their day in hours.}
\label{tab:home-planets}
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
\end{table}
{{< /latex >}}

{{< latex batch="home" preamble="homedoc" class="opens-section" >}}
\section{Theorems and proofs}
Theorems look as they do in the PDF. With the companion package, a proof
can be folded away and opened by the reader.
\begin{theorem}
There are infinitely many primes.
\end{theorem}
\begin{webaccordion}
\begin{webpane}[collapsed]
\noindent\textit{Idea:} were there finitely many, their product plus one
would have a prime factor that is none of them. \webnextpane[Proof]
\end{webpane}
\begin{webpane}[expanded]
\begin{proof}[\proofname\webpanelink{prev}{ (hide)}]
If $p_1, \dots, p_k$ were all of them, $p_1 \cdots p_k + 1$ would have a
prime factor that is none of them.
\end{proof}
\end{webpane}
\end{webaccordion}
\noindent An exercise can keep its answer hidden until asked for.
\begin{exercise}
Is $2^{11} - 1$ prime?
\begin{webhint}
No: $2^{11} - 1 = 2047 = 23 \cdot 89$.
\end{webhint}
\end{exercise}
{{< /latex >}}

{{< latex batch="home" preamble="homedoc" >}}
\DeclareWebBox{theorem}\DeclareWebBox{proof}
\noindent Theorems and proofs can also be set in boxes, and a theorem can
carry the Lean code that checks it.
\begin{theorem}
$\sqrt{2}$ is irrational.
\end{theorem}
\begin{proof}
If $\sqrt{2} = p/q$ in lowest terms, then $p^2 = 2q^2$, so $p$ is even;
then $q$ is even too.
\end{proof}
\noindent Open the proof of the next theorem, the Lean code, or both.
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

{{< latex batch="home" preamble="homedoc" class="opens-section" >}}
\section{Text that the page can change}
A script on the page can replace marked words in the text, and the
paragraph is broken into lines again around them.
{{< /latex >}}

<div class="home-doc-live">

{{< latex batch="home" preamble="homedoc" >}}
\noindent The basket holds \webtext{apples}{no apples at all}.
{{< /latex >}}

<div class="home-stepper" role="group" aria-label="Apples in the basket">
<button type="button" data-step="-1" aria-label="One apple fewer" disabled>−</button><output>0</output><button type="button" data-step="1" aria-label="One apple more">+</button>
</div>

</div>

{{< latex batch="home" preamble="homedoc" >}}
\noindent A piece of the text can also be an HTML control. The Moon is on
average \webtext{distance}{384\,400}~\webwidget{unit} from the Earth;
pick another unit, and the paragraph is broken again around it.
{{< /latex >}}

{{< latex batch="home" preamble="homedoc" class="opens-section" >}}
\section{Reading settings}
Readers choose the text size and the colour scheme. At a new size the
text is broken into lines again; in a dark theme, black text turns light,
and the colours in formulas and pictures change with it. The same settings
are behind the \textsf{Aa} button in the corner of every page.
{{< /latex >}}

<div class="home-doc-options">
{{< reading-options >}}
</div>

{{< latex batch="home" preamble="homedoc" class="opens-section" >}}
\section{How it works}
\begin{enumerate}
\item Lua\TeX{} compiles your source. A Lua hook saves each paragraph's
list of glyphs, kerns, glue and boxes before \TeX{} breaks it into lines.
\item These lists, with the fonts and positions, are stored in the page as
Protocol Buffers.
\item In the browser, a small script runs the Knuth--Plass algorithm for
the current width and draws the lines as SVG. When the width changes, it
runs again.
\end{enumerate}
At the width of its PDF, the browser puts every glyph of the AMS sample
paper within a third of a point of where Lua\TeX{} put it; see
\href{docs/showcase/accuracy/}{How close to the PDF?}

The paragraph below is broken again on every frame while its width
changes. Press the button to set it moving.
{{< /latex >}}

{{< breathing >}}
{{< latex preamble="homedoc" >}}
\noindent This paragraph was set by \TeX{} once, when the site was built.
While its column widens and narrows, your browser breaks it into lines on
every frame. It uses the Knuth--Plass algorithm, which chooses the breaks
for the paragraph as a whole, with the hyphenation, penalties and
tolerances that \TeX{} would use.
{{< /latex >}}
{{< /breathing >}}

{{< latex batch="home" preamble="homedoc" class="opens-section" >}}
\section{Where to next}
\begin{description}
\item[\href{docs/getting-started/installation/}{Getting started}] Install
the tools, then publish a static page, a Hugo site or a book.
\item[\href{docs/typesetting/inline-math/}{Typesetting}] What a block can
contain, each example next to its source.
\item[\href{docs/web-first/overview/}{Companion package}] Accordions,
notes, hints, boxed theorems and environments of your own.
\item[\href{docs/showcase/}{Showcase}] Whole papers and books, including
the AMS sample paper \texttt{testmath.tex}.
\end{description}
{{< /latex >}}

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
        withHost(function (host) { host.setText('apples', n === 0 ? null : (WORDS[n] || n + ' apples')); });
      });
    }
    // An HTML widget: the unit, a pill with a menu. A new unit sets the
    // number (live text) and the pill's label; the paragraph re-breaks.
    // [menu entry, pill label, number (null: TeX's own, 384 400)]
    var UNITS = [['kilometres', 'km', null], ['miles', 'miles', '238\u202f900'],
      ['light-seconds', 'light-seconds', '1.28'], ['Earth diameters', 'Earth diameters', '30']];
    var CHEV = '<svg class="home-chev" style="display:inline-block" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5"/></svg>';
    var esc = function (t) { return t.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); };
    var menu = null, opener = null;
    var unit = {};                       // the widget's state: instance id → the unit chosen
    function withHost(fn) {              // the viewer's host API, now or once it is there
      var h = window.reflowtex && reflowtex.host;
      if (h) fn(h); else document.addEventListener('reflowtex:host', function (e) { fn(e.detail.host); }, { once: true });
    }
    function closeMenu() {
      if (menu) { menu.remove(); menu = null; }
      if (opener) { opener.setAttribute('aria-expanded', 'false'); opener = null; }
    }
    function openMenu(btn, instance, env) {
      if (menu) { var same = opener === btn; closeMenu(); if (same) return; }
      opener = btn; btn.setAttribute('aria-expanded', 'true');
      var cur = unit[instance.id] || 0;
      menu = document.createElement('div');
      menu.className = 'home-menu'; menu.setAttribute('role', 'menu');
      menu.innerHTML = UNITS.map(function (u, i) {
        return '<button type="button" role="menuitemradio" aria-checked="' + (i === cur) + '" data-i="' + i + '">'
          + '<span class="tick">' + (i === cur ? '✓' : '') + '</span>' + esc(u[0]) + '</button>';
      }).join('');
      document.body.appendChild(menu);
      var r = btn.getBoundingClientRect();
      menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - menu.offsetWidth - 8)) + 'px';
      menu.style.top = (r.bottom + 6) + 'px';
      menu.addEventListener('click', function (e) {
        var b = e.target.closest('[data-i]'); if (!b) return;
        unit[instance.id] = Number(b.dataset.i); closeMenu(); env.invalidate();
        withHost(function (host) { host.setText('distance', UNITS[unit[instance.id]][2]); });
      });
      menu.addEventListener('keydown', function (e) {
        var items = [].slice.call(menu.querySelectorAll('button')), k = items.indexOf(document.activeElement);
        if (e.key === 'ArrowDown') { items[(k + 1) % items.length].focus(); e.preventDefault(); }
        if (e.key === 'ArrowUp') { items[(k + items.length - 1) % items.length].focus(); e.preventDefault(); }
      });
      (menu.querySelector('[aria-checked="true"]') || menu.querySelector('button')).focus();
    }
    document.addEventListener('pointerdown', function (e) {
      if (menu && !menu.contains(e.target) && !e.target.closest('.home-badge')) closeMenu();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && menu) { var o = opener; closeMenu(); if (o) o.focus(); } });
    window.addEventListener('scroll', closeMenu, { passive: true });
    // \webwidget{unit}: an inline instance of kind "unit".
    withHost(function (host) { host.define('unit', {
      measure: function (instance, env) {
        var words = UNITS[unit[instance.id] || 0][1].split(' ');
        var m = function (html) { return env.measure('<span class="home-badge" style="padding:0">' + html + '</span>'); };
        var space = m('a b').width - m('ab').width, pad = 0.55 * 0.72 * env.fontSize;
        return {
          segments: words.map(function (w) { return m('<span style="white-space:pre">' + esc(w) + '</span>'); }),
          gaps: words.slice(1).map(function () { return { width: space, penalty: 100 }; }),
          // a cut end: more padding, for the perforation, which hangs past
          // the margin by 3.75px (its middle on the margin)
          ends: { left: { cap: pad, cut: 0.75 * 0.72 * env.fontSize, overhang: 3.75 },
                  right: { cap: pad + m(CHEV).width, cut: 0.75 * 0.72 * env.fontSize, overhang: 3.75 } },
        };
      },
      render: function (instance, host) {
        var part = host.piece, u = unit[instance.id] || 0, words = UNITS[u][1].split(' ');
        host.el.innerHTML = '<button type="button" class="home-badge' + (part.left === 'cut' ? ' cut-left' : '')
          + (part.right === 'cut' ? ' cut-right' : '') + '" aria-haspopup="menu" aria-expanded="false" aria-label="Unit: '
          + esc(UNITS[u][0]) + '. Choose another">'
          + esc(words.slice(part.from, part.to + 1).join(' ')) + (part.right === 'cap' ? CHEV : '') + '</button>';
        host.el.firstChild.addEventListener('click', function (e) { openMenu(e.currentTarget, instance, host.env); });
      },
    }); });
  })();
</script>
