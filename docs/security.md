# Compiling LaTeX you did not write

Reflow TeX's input is LaTeX, and LaTeX is a programming language with file I/O,
not a markup format. Whenever the snippets being compiled come from somewhere
other than the person running the build – contributed content a site generator
walks, papers from a corpus, a CI job building a submission – the compile step is
executing someone else's program. This note says what the pipeline does about
that, what it deliberately does not, and how to run it when the input is not
trusted.

## What the pipeline does

**Shell escape is off.** `src/pipeline/lualatex.ts` invokes LuaTeX with
`-no-shell-escape`. With shell escape enabled, a `\write18{...}` or a
`\directlua{os.execute(...)}` anywhere in a snippet or its preamble runs
arbitrary commands as the build user, which turns "render this author's maths"
into remote code execution. Nothing in the pipeline needs it: TikZ capture
records finished boxes rather than shelling out to a sub-run.

The flag is passed explicitly rather than left to the default, because TeX Live's
default is **`restricted`, not off**. Restricted mode still executes a whitelist
of helper programs – `latexminted` (Python), `texosquery-jre8` (Java),
`repstopdf`, `makeindex` and others – with arguments the document chooses. It is
a speed bump, not a boundary.

A caller whose own preamble genuinely needs shell escape (minted, gnuplottex)
can set `REFLOWTEX_SHELL_ESCAPE=1`. That is an assertion that every snippet
compiled in the run is trusted. Do not set it in a build that touches input from
elsewhere.

## What it does not do

**It does not stop a document reading your files.** TeX Live ships
`openin_any = a`, so a `.tex` file can `\openin` any path the build user can
read – `~/.ssh/id_rsa`, a `.env`, shell history – and typeset the contents.
LuaTeX's `io.open`, `lfs`, and `os.getenv` remain available with shell escape
off, so environment variables are readable too. Verify your own settings with:

```sh
kpsewhich -var-value=shell_escape   # p = restricted (TeX Live default)
kpsewhich -var-value=openin_any     # a = any file is readable
kpsewhich -var-value=openout_any    # p = writes confined
```

**That read matters more here than in an ordinary LaTeX workflow.** This
pipeline's entire job is to serialize what TeX typeset and embed it in a web
page. A document that reads a secret and typesets it – in white, at 1pt, off the
edge of the box – does not leave that secret in a local PDF you never open. It
gets encoded into `nodelist.pb` and published with the page.

With shell escape off there is no network stack inside the TeX process: LuaTeX's
`socket` module is unavailable and `io.popen` is inert, so a document cannot
open a connection itself. Exfiltration therefore requires an artifact you go on
to publish, share, or commit – which is exactly what a build pipeline produces.

**It does not bound resource use.** TeX macro loops do not terminate on their
own. Run untrusted input under a timeout.

## Running untrusted input

Flags harden the process; a container bounds the blast radius by deciding which
files exist to be read in the first place. Use both.

```sh
docker compose run --rm --network none reflowtex <your build command>
```

Additionally, when the input is untrusted:

- Do not mount secrets, SSH keys, or your home directory into the container.
- Pass `openin_any=p openout_any=p` in the environment to confine reads to the
  build tree and the texmf trees.
- Bound each run: `timeout 120 ...`, plus a memory cap.
- Never run the input's own build tooling. A `latexmkrc` in a source tree is
  executed as Perl by `latexmk`; a bundled `Makefile` or `*.sh` is someone
  else's code; a bundled `graphicx.sty` shadows the real one, because kpathsea
  searches the current directory first.
- Treat `input.log` and any output as potentially carrying file contents the
  document read.

## Reporting

If you find a way to make the pipeline execute code or read outside its build
directory with default settings, please open an issue.
