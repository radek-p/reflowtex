# Contributing to Reflow TeX

Thank you for your interest. Reflow TeX is in its initial phase of
development, and its direction is set by the maintainer, Radosław
Piórkowski. Contributions are welcome within that direction.

## Before you start

- **Open an issue first** for anything beyond a small fix, so we can agree on
  the approach before you spend time on it. A pull request that changes the
  design without prior discussion may be declined, however good the code.
- **Bug reports** are most useful with the LaTeX source that shows the
  problem, the browser, and what you expected to see.
- **Security reports**: please report privately, through the repository's
  Security tab, not in a public issue.

## The Contributor License Agreement

Every contribution needs a signed [Contributor License Agreement](CLA.md).
It grants the maintainer broad rights in what you contribute – including the
right to license it under terms other than the AGPL – so that the project's
licensing and direction stay under one control while it takes shape. You keep
the copyright in your contributions.

To sign, comment on your first pull request with:

> I have read the CLA Document and I hereby sign the CLA

A pull request cannot be merged before its author has signed.

## Working on the code

- `make check` verifies the toolchain; `make venv` sets up Python.
- `make website` rebuilds the documentation site, which doubles as the
  broadest test: every page is compiled and rendered by the pipeline.
- New source files start with an SPDX header:
  `SPDX-License-Identifier: AGPL-3.0-or-later`.
- Keep commits focused, with a message that says what changed and why.
