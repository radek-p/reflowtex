# Binary format

The node list is serialised to Protocol Buffers against
[`src/schema/latex.proto`](../src/schema/latex.proto). The `.proto` is the single
source of truth: the Python encoder is descriptor-driven (it walks the schema, so
it can't encode a field the schema doesn't declare), and the browser parses the
same `.proto` text at runtime to decode. Change the schema in one place and both
sides follow.

## Key decisions

### proto2, not proto3

The renderer relies on field **presence**: a glyph with no explicit `width` reads
its width from the shared metrics table; an unset `subtype` means "none". proto3
makes unset scalars indistinguishable from zero, which would erase exactly these
distinctions. proto2 tracks presence explicitly, so "absent" and "0" stay
different.

### `double` for layout scalars

Glue set ratios and the TikZ picture transform matrix are stored as `double`, not
`float`. The layout is computed from these, and 32-bit floats introduced rounding
differences from the reference `output.json`. Doubles make the browser layout
bit-for-bit identical to the source.

### Lowercased enum values

Enum values in the `.proto` are lowercase (`glyph`, `display`, …) so that
decoding with `enums: String` yields the exact strings the renderer already
compares against (`n.type === 'glyph'`) – no mapping layer.

### Interned glyph metrics

Every glyph carries a width/height/depth, but a document uses only a few hundred
distinct triples across tens of thousands of glyphs. So distinct
`(width, height, depth)` triples are stored once in `Document.glyph_metrics`, and
each glyph node references one by a 1-based `metrics` index. A glyph that needs a
one-off size can still carry inline dimensions instead. On a real paper this cut
the glyph payload substantially; it matters more as documents grow.

## Decoding contract (browser)

The viewer parses the schema and decodes each block like this:

```js
const root = protobuf.parse(protoText, { keepCase: true }).root;   // keep snake_case field names
const Document = root.lookupType('latex.Document');
const doc = Document.toObject(Document.decode(bytes), {
  defaults: false,   // unset scalars stay absent (proto2 presence)
  arrays:   true,    // empty repeated fields become [], not undefined
  enums:    String,  // 'glyph', 'display', …
  longs:    Number,  // plain JS numbers
});
```

`keepCase: true` matters because the renderer reads `glyph_metrics`,
`stretch_order`, `size_sp` – the schema's snake_case names – not protobuf.js's
default camelCase.

## Cost and a future optimisation

Parsing the `.proto` at runtime keeps the browser side simple and dependency-free
beyond the vendored `protobuf.min.js`. The size/speed win available later is to
precompile the schema to a descriptor with `pbjs` and ship the protobuf *minimal*
runtime instead of the full bundle – decoding is unchanged, the parse step goes
away, and the payload shrinks. It's deliberately not done in the alpha to keep the
build trivial.
