---
title: Render tests
weight: 30
latexTitle: true
---

{{< latex preamble="about" >}}
\pagetitle[Tools]{Render tests}
\bigskip
Every change to Reflow\,\TeX{} is checked against \TeX{} by the render
tests. Each test document is typeset by LuaTeX as a
\href{../pageless-pdf/}{pageless PDF} and shown in the browser with its
column as wide as the PDF's, and every glyph and rule the browser draws is
matched with the one in the PDF. \href{../../getting-started/accuracy/}{Accuracy}
says what they find.

The page below shows every test, as run for this version of the site: the
PDF on the left, and on the right the page the browser laid out, with the
inspector open on it.
{{< /latex >}}

<div class="render-tests">
<a href="{{< siteurl "render-tests/" >}}" class="shot"><img src="{{< siteurl "images/render-tests.webp" >}}" width="1600" height="1000" alt="The render tests: a test's pageless PDF beside the page the browser laid out, TeX's rules the browser draws otherwise marked on the PDF, the list of them on the right, and the inspector open below." loading="lazy"></a>
<p><a href="{{< siteurl "render-tests/" >}}" class="open">Open the render tests</a> It fills the window; the browser's back button returns here.</p>
</div>
<style>
  .render-tests .shot { display: block; border: 1px solid color-mix(in srgb, currentColor 18%, transparent); border-radius: 6px; overflow: hidden; line-height: 0; }
  .render-tests .shot img { width: 100%; height: auto; }
  .render-tests p { font-size: .9rem; margin: .75rem 0 2rem; display: flex; align-items: center; gap: .9rem; flex-wrap: wrap; }
  .render-tests .open { display: inline-block; padding: .4rem .9rem; border-radius: 6px; background: var(--lt-primary, #0b57d0); color: #fff; text-decoration: none; font-weight: 600; }
  .render-tests .open:hover { filter: brightness(1.1); }
</style>

{{< latex preamble="about" >}}
\section*{What it shows}
A glyph or rule further from \TeX's position than the test allows is boxed
in red on both sides, and so is one drawn on one side only. The list beside
them has each of them; click one to bring it to the middle of both sides.
The error threshold above the list says how far off counts: at 0, every
offset is listed. The arrow keys go from test to test, and the bar at the
top says whether each one passes.

The two sides scroll together, at the same place on both. A crosshair goes
with the pointer and marks the same point on the other side, and a drag
draws an area on both, with its size and place in points in the bar at the
bottom. \emph{Inspect} opens the inspector on the page, and \emph{View}
chooses the theme, the page's colours, and whether the two sides are side
by side or one above the other.

\section*{Running them}
The tests are in \texttt{tests/render/} of the repository. They need what
the build needs, and Chromium, which the first run installs:
{{< /latex >}}

```sh
make test-render        # the short documents, at three widths each
make test-render-all    # and testmath.tex
make render-report      # the page above, for your run: http://localhost:8010/
```
