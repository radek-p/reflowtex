# Backend conformance tests

The suite every capture backend is checked by (`docs/backends.md` describes
backends and their capabilities). For each backend it reads the
capabilities descriptor, compiles the shared fixtures in `fixtures/` and
checks the output for what the backend claims; what it does not claim is
skipped, with the reason. A backend this build cannot use (the Tectonic
placeholder) is checked to fail clearly when selected.

```sh
make test-conformance                                    # every registered backend
REFLOWTEX_BACKENDS=luatex node --test tests/backends/conformance.test.ts
node --test --test-name-pattern pictures tests/backends/conformance.test.ts
```

It needs TeX (as the capture tests do) but no browser. Each fixture is a
small complete document named after what it exercises; a new capability
gets a fixture and a check here, and the last test fails until it has one.
`REFLOWTEX_KEEP_BUILD=1` keeps the build directories for a look.
