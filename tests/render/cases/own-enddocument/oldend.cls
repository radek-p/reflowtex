% A class whose \enddocument is LaTeX's from before 2020, as some journal
% classes still define it: no hooks, \@enddocumenthook, \clearpage, the .aux
% read back, \@@end. Nothing added with \AddToHook{enddocument/...} runs.
\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{oldend}[2026/10/28 article with an \string\enddocument\space of its own]
\LoadClass{article}
\renewcommand*\enddocument{%
  \let\AtEndDocument\@firstofone
  \@enddocumenthook
  \@checkend{document}%
  \clearpage
  \begingroup
    \if@filesw
      \immediate\closeout\@mainaux
      \let\@setckpt\@gobbletwo
      \let\@newl@bel\@testdef
      \@tempswafalse
      \makeatletter \input\jobname.aux
    \fi
  \endgroup
  \deadcycles\z@\@@end}
