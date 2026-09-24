---
title: Live text
weight: 48
latexTitle: true
---

{{< latex preamble="webfirst" >}}
\pagetitle[Web-first \LaTeX]{Live text}
\bigskip
A \cs{webtext} marks a named piece of running text that the page can
replace: a counter, a clock, a value computed by a script. \TeX{} typesets
the default text, which is what the PDF shows. On the web a script sets new
text, and the paragraph re-breaks around it.
{{< /latex >}}

<div class="live-demo">
<div class="live-stepper" role="group" aria-label="Apples in the basket">
  <button type="button" data-step="-1" aria-label="One apple fewer">−</button>
  <input type="number" min="0" max="999" value="0" inputmode="numeric" aria-label="Number of apples">
  <button type="button" data-step="1" aria-label="One apple more">+</button>
  <span class="live-stepper-label">apples</span>
</div>
<svg class="live-arrow" aria-hidden="true"><path class="live-arrow-line" d=""/><path class="live-arrow-head" d=""/></svg>

{{< latex preamble="webfirst" show-source="true" >}}
The basket holds \webtext{apples}{no apples at all}. The count comes
from the page's script: press the buttons above, and the lines around it
re-break to make room for the new words.
{{< /latex >}}

</div>

The page's own script:

```js
const words = ['no apples at all', 'a single apple', 'two apples', 'three apples', /* … */];
let n = 0;
function show() {
  field.value = n;
  reflowtex.setText('apples', n === 0 ? null : words[n] ?? `${n} apples`);   // null: TeX's own default
}
stepper.addEventListener('click', e => { n = Math.max(0, n + Number(e.target.dataset.step || 0)); show(); });
field.addEventListener('input', () => { n = Math.max(0, parseInt(field.value, 10) || 0); show(); });
```

<style>
  .live-demo { position: relative; margin-top: 1.5rem; }
  .live-stepper { display: inline-flex; align-items: center; gap: 2px; padding: 3px;
    border-radius: 999px; font: 14px/1 ui-sans-serif, system-ui, sans-serif;
    border: 1px solid color-mix(in srgb, currentColor 16%, transparent);
    background: var(--latex-page-bg); box-shadow: 0 1px 2px rgba(0,0,0,.05); }
  .live-stepper button { width: 30px; height: 30px; border: 0; border-radius: 999px; cursor: pointer;
    font: 500 18px/1 ui-sans-serif, system-ui, sans-serif; color: var(--lt-primary);
    background: color-mix(in srgb, var(--lt-primary) 9%, transparent); transition: background-color .15s ease; }
  .live-stepper button:hover { background: color-mix(in srgb, var(--lt-primary) 18%, transparent); }
  .live-stepper button:active { background: color-mix(in srgb, var(--lt-primary) 28%, transparent); }
  .live-stepper button:disabled { opacity: .35; cursor: default; background: color-mix(in srgb, currentColor 6%, transparent); }
  .live-stepper button:focus-visible { outline: 2px solid var(--lt-primary); outline-offset: 2px; }
  .live-stepper input { width: 2.6em; height: 30px; box-sizing: border-box; padding: 0; margin: 0 2px;
    border: 0; border-radius: 8px; background: none; color: inherit; text-align: center;
    font: 650 15px/1 ui-sans-serif, system-ui, sans-serif; font-variant-numeric: tabular-nums;
    -moz-appearance: textfield; appearance: textfield; }
  .live-stepper input::-webkit-outer-spin-button, .live-stepper input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
  .live-stepper input:hover { background: color-mix(in srgb, currentColor 6%, transparent); }
  .live-stepper input:focus { outline: 2px solid var(--lt-primary); outline-offset: -2px; background: none; }
  .live-stepper-label { padding: 0 .8em 0 .55em; opacity: .6; }
  /* The live words, in the accent colour, and the arrow pointing at them. */
  .live-demo [data-slot="apples"] { fill: var(--lt-primary) !important; }
  .live-arrow { position: absolute; left: 0; top: 0; width: 100%; height: 100%; overflow: visible;
    pointer-events: none; z-index: 5; }
  .live-arrow-line { fill: none; stroke: var(--lt-primary); stroke-width: 1.4; stroke-linecap: round; opacity: .85; }
  .live-arrow-head { fill: var(--lt-primary); stroke: var(--lt-primary); stroke-width: .8; stroke-linejoin: round; opacity: .85; }
  .live-demo figure.latex-example { margin-top: 3.25rem; }
</style>
<script>
  (function () {
    var demo = document.currentScript.previousElementSibling;
    while (demo && !(demo.classList && demo.classList.contains('live-demo'))) demo = demo.previousElementSibling;
    if (!demo) return;
    var stepper = demo.querySelector('.live-stepper'), field = stepper.querySelector('input');
    var label = stepper.querySelector('.live-stepper-label');
    var minus = stepper.querySelector('[data-step="-1"]'), arrow = demo.querySelector('.live-arrow-line');
    var head = demo.querySelector('.live-arrow-head');
    var WORDS = ['no apples at all', 'a single apple', 'two apples', 'three apples', 'four apples', 'five apples',
      'six apples', 'seven apples', 'eight apples', 'nine apples', 'ten apples', 'eleven apples', 'twelve apples',
      'thirteen apples', 'fourteen apples', 'fifteen apples', 'sixteen apples', 'seventeen apples',
      'eighteen apples', 'nineteen apples', 'twenty apples'];
    var n = 0;
    function show() {
      if (document.activeElement !== field) field.value = n;
      label.textContent = n === 1 ? 'apple' : 'apples';
      minus.disabled = n === 0;
      if (window.reflowtex && reflowtex.setText) reflowtex.setText('apples', n === 0 ? null : (WORDS[n] || n + ' apples'));
    }
    stepper.addEventListener('click', function (e) {
      var b = e.target.closest('[data-step]'); if (!b) return;
      n = Math.max(0, Math.min(999, n + Number(b.dataset.step))); field.value = n; show();
    });
    // The number is editable: typed, or stepped with the arrow keys.
    field.addEventListener('input', function () {
      var v = parseInt(field.value, 10);
      if (!isNaN(v)) { n = Math.max(0, Math.min(999, v)); show(); }
    });
    field.addEventListener('blur', function () { field.value = n; });
    show();

    // The arrow: from under the stepper to the top of the live words' first
    // line, a gentle curve as TikZ would draw it. Redrawn every frame while
    // the example is on screen, so it follows every reflow.
    var visible = false;
    function draw() {
      var glyphs = demo.querySelectorAll('[data-slot="apples"]');
      // Nothing to point at while the Result is not shown (the LaTeX tab is).
      var preview = demo.querySelector('.latex-example-preview');
      if (!glyphs.length || !preview || !preview.getClientRects().length) {
        arrow.setAttribute('d', ''); head.setAttribute('d', ''); return;
      }
      var d = demo.getBoundingClientRect(), st = stepper.getBoundingClientRect(), f = field.getBoundingClientRect();
      // the live words on the line where they begin: their span, and its top
      var first = glyphs[0].getBoundingClientRect(), left = first.left, right = first.right, top = first.top;
      for (var i = 1; i < glyphs.length; i++) {
        var r = glyphs[i].getBoundingClientRect();
        if (Math.abs(r.top - first.top) > 4) break;
        left = Math.min(left, r.left); right = Math.max(right, r.right); top = Math.min(top, r.top);
      }
      // from the stepper's bottom edge under the number, to just above the
      // middle of that span
      var x0 = (f.left + f.right) / 2 - d.left, y0 = st.bottom - d.top;
      var x1 = (left + right) / 2 - d.left, y1 = top - 4 - d.top;
      var dy = Math.max(24, (y1 - y0) * 0.5);
      var c1x = x0, c1y = y0 + dy, c2x = x1, c2y = y1 - dy;
      // The head: a triangle, its tip at the end, pointing along the curve's
      // direction there; the curve stops at the middle of its base.
      var ux = x1 - c2x, uy = y1 - c2y, ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
      var L = 8, W = 3.6, bx = x1 - L * ux, by = y1 - L * uy;
      arrow.setAttribute('d', 'M' + x0 + ' ' + y0 + ' C' + c1x + ' ' + c1y + ' ' + c2x + ' ' + c2y + ' ' + bx + ' ' + by);
      head.setAttribute('d', 'M' + x1 + ' ' + y1 + ' L' + (bx - W * uy) + ' ' + (by + W * ux)
        + ' L' + (bx + W * uy) + ' ' + (by - W * ux) + ' Z');
    }
    function loop() { if (!visible) return; draw(); requestAnimationFrame(loop); }
    new IntersectionObserver(function (es) {
      var was = visible; visible = es[0].isIntersecting;
      if (visible && !was) requestAnimationFrame(loop);
    }).observe(demo);
  })();
</script>

{{< latex preamble="webfirst" >}}
\section*{How it is set}
\TeX{} sets the default as it sets any text. A text the page gives instead
is set the way a browser sets it: in the default's font and colour, word by
word, each word measured by the browser, with no kerning or ligatures from
one word to the next. It breaks only at its spaces (a no-break space
keeps two words together), and between its words stands the interword glue
of that font, with the stretch and shrink \TeX{} would give it, so the line
it lands on is justified with the rest.
\begin{description}
\item[\texttt{reflowtex.setText(name, text)}] shows \emph{text} in every
  \cs{webtext} of that name, in every block of the page; several changes
  within one frame are laid out together, and only the lines around them are
  drawn again.
\item[\texttt{reflowtex.setText(name, null)}] brings back \TeX's default.
\item[\texttt{reflowtex.getText(name)}] the text last given, if any.
\end{description}
A \cs{webtext} belongs in running text: inside a box, such as \cs{mbox}, its
default cannot be replaced. In print it is its default, typeset as usual.
{{< /latex >}}

{{< latex preamble="webfirst" >}}
To insert HTML instead of words, such as a badge or a small control, see
the next page, \emph{HTML widgets}.
{{< /latex >}}
