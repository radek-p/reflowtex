---
title: Books in parts
weight: 40
latexTitle: true
---

{{< latex preamble="docs" >}}
\pagetitle[Getting started]{Books in parts}
\bigskip
A book is one \LaTeX{} document: chapter~3 refers to a theorem of chapter~1,
counts its theorems and equations from where chapter~2 stopped, and uses the
macros the chapters before it defined. On the web the same book is several
pages, or several tabs. A \emph{batch} gives it both: every block with the
same \texttt{batch=} is compiled together, as one document, in the order
their \texttt{weight=} gives --- and each block then shows only its own
part.
{{< /latex >}}

{{< latex preamble="docs" >}}
Here is a small book of three chapters, each shown in a tab of its own.
Chapter~2 uses the macro \verb|\N| that chapter~1 defined and refers to its
theorem and equation; chapter~3 names theorems from both earlier chapters;
every number is the book's own.
{{< /latex >}}

{{< tabs >}}
{{< tab "Chapter 1" >}}{{< latex batch="counting" weight="1" file="chapter1.tex" preamble="../examples/book/preamble.tex" />}}{{< /tab >}}
{{< tab "Chapter 2" >}}{{< latex batch="counting" weight="2" file="chapter2.tex" preamble="../examples/book/preamble.tex" />}}{{< /tab >}}
{{< tab "Chapter 3" >}}{{< latex batch="counting" weight="3" file="chapter3.tex" preamble="../examples/book/preamble.tex" />}}{{< /tab >}}
{{< /tabs >}}

{{< latex preamble="docs" >}}
\section*{How the example is made}
Four files and one build command. The chapters are ordinary \texttt{.tex}
files without a preamble, in a directory the build is told about; the
book's preamble sits beside them, and every block names it with
\texttt{preamble=}, a path from the site's root:
{{< /latex >}}

```text
website/                               the Hugo site
├── content/docs/getting-started/
│   └── books.md                       this page: the shortcodes below
└── layouts/shortcodes/
    ├── latex.html                     from integrations/hugo
    └── tabs.html, tab.html            this site's tabs (optional)
examples/book/                         --demos-dir: where file="…" is found
├── preamble.tex                       preamble="../examples/book/preamble.tex"
├── chapter1.tex
├── chapter2.tex
└── chapter3.tex
```

{{< latex preamble="docs" >}}
The build is given that directory, and compiles the three chapters as one
book:
{{< /latex >}}

```sh
python integrations/hugo/prebuild.py website --demos-dir examples/book
hugo --source website
```

{{< tabs >}}
{{% tab "books.md" %}}
```markdown
{{</* tabs */>}}
{{</* tab "Chapter 1" */>}}
{{</* latex batch="counting" weight="1" file="chapter1.tex" preamble="../examples/book/preamble.tex" /*/>}}
{{</* /tab */>}}
{{</* tab "Chapter 2" */>}}
{{</* latex batch="counting" weight="2" file="chapter2.tex" preamble="../examples/book/preamble.tex" /*/>}}
{{</* /tab */>}}
{{</* tab "Chapter 3" */>}}
{{</* latex batch="counting" weight="3" file="chapter3.tex" preamble="../examples/book/preamble.tex" /*/>}}
{{</* /tab */>}}
{{</* /tabs */>}}
```
{{% /tab %}}
{{< tab "chapter1.tex" >}}{{< source file="chapter1.tex" >}}{{< /tab >}}
{{< tab "chapter2.tex" >}}{{< source file="chapter2.tex" >}}{{< /tab >}}
{{< tab "chapter3.tex" >}}{{< source file="chapter3.tex" >}}{{< /tab >}}
{{< tab "preamble.tex" >}}{{< source file="../examples/book/preamble.tex" >}}{{< /tab >}}
{{< /tabs >}}

{{< latex preamble="docs" >}}
The tabs are this site's own shortcodes (\texttt{tabs} and \texttt{tab},
a few lines each); nothing in the batch depends on them. The same three
\texttt{latex} lines could as well stand on three different pages, one
chapter each.
{{< /latex >}}

{{< latex preamble="docs" >}}
\section*{How it works}
\texttt{prebuild.py} collects every block of a batch --- across all pages
--- orders them by \texttt{weight} (ties go by page, then by position on the
page), and compiles them as one document, exactly as if a \texttt{main.tex}
had \verb|\include|d them in that order. Between the parts it places a
marker that opens no group, so whatever one part defines is still defined in
the next. The finished document is then cut back into one block per part,
each carrying only its own paragraphs, footnotes, pictures and labels.
\begin{description}
\item[One chapter, two places.] A block may repeat a chapter the batch
  already has --- the same \texttt{file=} on another page, say. It stays one
  chapter of the book, compiled once, at the lowest \texttt{weight=} it is
  given, and both places show it; its labels link to the page with that
  lowest weight. In a different batch the same file is compiled again, as
  part of that book.
\item[One preamble.] All blocks of a batch use the same
  \texttt{preamble=}: a name from \texttt{latex-preambles/}, or, as here, a
  path to a \texttt{.tex} file from the site's root. It may begin with its
  own \verb|\documentclass|, here \texttt{book}, so \verb|\chapter|
  works.
\item[Any pages.] The parts can sit on different pages. A reference to a
  label in another part becomes a link to the page that shows it, through the
  same link map as any other cross-reference.
\item[Inline too.] A batch block may hold its \LaTeX{} between the
  shortcode's opening and closing tags instead of naming a file.
\item[Without Hugo.] The static-site build does the same for a directory:
  \verb|build.py book/ --batch| compiles every snippet in it, in file-name
  order, as one document.
\item[Recompiled as a whole.] Changing, adding or reordering any part
  compiles the batch again, since every part's numbers may change.
\end{description}
{{< /latex >}}
