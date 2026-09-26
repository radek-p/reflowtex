# Parity tests (temporary)

While the build moves from Python (`src/encode`) to TypeScript
(`src/pipeline`), each TypeScript module is checked against what the Python
one produces from the same input. These tests go away with the Python.

They read build roots the Python pipeline wrote (one directory per block,
holding `output.json` and `nodelist.pb`): the directories listed in
`REFLOWTEX_PARITY_ROOTS` (separated by `:`), or else those under
`build/parity/`, which `tests/parity/prepare.sh` fills by building the
examples with the Python integrations.

    tests/parity/prepare.sh            # once; needs lualatex and the venv
    npm run test:parity
    REFLOWTEX_PARITY_ROOTS=website/.reflowtex-build npm run test:parity

`REFLOWTEX_PYTHON` names the Python to compare against (default: this
checkout's `.venv`), so a worktree can use the main checkout's venv.
