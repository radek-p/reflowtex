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

## Captured calls

The display model and the transforms are checked on their own inputs rather
than through whole builds: `capture.py` runs an existing build script with the
Python pipeline's functions wrapped. It records every call's arguments,
result and changed arguments, and every LuaTeX run's serializer output, under
`build/capture/<run>/<block>/`. The tests replay each call through the
TypeScript function and compare.

    PY=.venv/bin/python3
    $PY tests/parity/capture.py build/capture/site integrations/hugo/prebuild.py website \
        --demos-dir examples/demo --demos-dir examples/testmath --demos-dir examples/book \
        --demos-dir examples/symbol --force -j 8
    $PY tests/parity/capture.py build/capture/testmath examples/testmath/build.py -o build/parity-testmath-site
    $PY tests/parity/capture.py build/capture/dmn integrations/vanilla/build.py examples/display-model-narrow -o build/parity-dmn-site

(The Hugo run needs the shortcode and partial copied into `website/layouts/`,
as `website/build.sh` does.) `REFLOWTEX_CAPTURE` points the tests elsewhere.
