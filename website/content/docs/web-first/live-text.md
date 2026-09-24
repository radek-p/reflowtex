---
title: Live text
weight: 48
latexTitle: true
---

{{< latex preamble="webfirst" >}}
\pagetitle[Web-first \LaTeX]{Live text}
\bigskip
A \cs{webtext} is a named place in running text whose words the page can
change: a counter, a clock, a value the page computes. \TeX{} typesets the
default text, and that is what the PDF shows; on the web a script gives the
name a new text, and the paragraph re-breaks around it.
{{< /latex >}}

{{< latex preamble="webfirst" show-source="true" >}}
This page has been open for \webtext{elapsed}{a moment}, and the paragraph
has been broken again each time the words above changed length. You have
pressed \webaction{count}{this link} \webtext{clicks}{no times at
all}; every press sets the count again, and the lines move to make room for
it.
{{< /latex >}}

The page's own script:

```html
<script>
  const start = Date.now();
  setInterval(() => {
    const s = Math.round((Date.now() - start) / 1000);
    reflowtex.setText('elapsed', s === 1 ? 'one second' : s + ' seconds');
  }, 1000);
  let n = 0;
  document.addEventListener('reflowtex:action', e => {
    if (e.detail.action !== 'count') return;
    n++;
    reflowtex.setText('clicks', n === 1 ? 'once' : n + ' times');
  });
</script>
```

<script>
  (function () {
    var start = Date.now(), n = 0;
    function set(name, text) { if (window.reflowtex && reflowtex.setText) reflowtex.setText(name, text); }
    setInterval(function () {
      var s = Math.round((Date.now() - start) / 1000);
      set('elapsed', s === 1 ? 'one second' : s + ' seconds');
    }, 1000);
    document.addEventListener('reflowtex:action', function (e) {
      if (e.detail.action !== 'count') return;
      n++;
      set('clicks', n === 1 ? 'once' : n + ' times');
    });
  })();
</script>

{{< latex preamble="webfirst" >}}
\section*{How it is set}
\TeX{} sets the default as it sets any text. A text the page gives instead
is set the way a browser sets it: in the default's font and colour, word by
word, each word measured by the browser, with no kerning or ligatures from
one word to the next. It breaks only at its spaces --- a no-break space
keeps two words together --- and between its words stands the interword glue
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
