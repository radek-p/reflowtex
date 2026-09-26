# Capture tests

What the serializer (`src/extract/serializer.lua`) records of a document:
small snippets are compiled by the pipeline and their `output.json` is
checked – colours, links, anchors, what reaches the content stream at all.
They need TeX but no browser, and take seconds.

The render tests (`tests/render`) check where the viewer draws each glyph,
and the web tests (`tests/web`) how pages behave; neither looks at a glyph's
colour or at where a link points, which is what these are for.

```sh
make test-capture
node --test --test-name-pattern colour tests/capture/capture.test.ts
```

`capture(body, preamble, passes)` compiles a snippet once per run and returns
its `output.json`; it fails when the serializer raised a Lua error in a
callback (LuaTeX only warns, and drops what the callback would have
captured). A document that reads anything back through the `.aux` – `\ref`,
`\cite`, a table of contents, and also packages such as `transparent` –
needs two passes or more, as a real build would give it.
