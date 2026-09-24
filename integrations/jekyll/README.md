# Reflow TeX – Jekyll integration (planned)

This integration is **not built yet**. It's stubbed here to mark the intended
shape.

## Planned design

Mirror the [Hugo integration](../hugo): a thin shell over
[`../../src`](../../src), no logic of its own.

- **A prebuild step** (`prebuild.py`, reusing `src/encode/pipeline.py`) scans the
  site's pages/posts for Reflow TeX blocks, compiles each, and writes the results
  into Jekyll's data and static directories:
  - compiled blocks + the schema into `_data/` (e.g. `_data/reflowtex/…`),
  - provisioned fonts and the viewer scripts into `assets/` (served at the root).
- **A Liquid tag or include** emits the block markup –
  `<div class="latex-block" data-nodelist-b64="…">` – by looking up the compiled
  block by the same content hash the prebuild uses
  (`pipeline.content_key`, boundary `===REFLOWTEX-PREAMBLE-BOUNDARY===`).
- **A viewer include** embeds the schema, the minimal CSS, and the two scripts –
  the analogue of Hugo's `partials/reflowtex-viewer.html`.

The one Jekyll-specific question is how blocks are authored: a `{% latex %}…
{% endlatex %}` block tag (closest to the Hugo shortcode) versus fenced code
blocks tagged for a converter plugin. The block tag is the likely choice.
