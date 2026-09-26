# SPDX-License-Identifier: AGPL-3.0-or-later
# Reflow TeX – one-command demos.
#
# Prerequisites on PATH: lualatex (TeX Live), gs (Ghostscript), dvisvgm, Node >= 22.18.
# Node deps: installed into node_modules/ on first use – see the `node-deps` target.
# (The tools and tests not yet moved to TypeScript still use a local .venv.)

PORT ?= 8000
DEMO_OUT := build/demo-site
# Pinned version of the vendored browser runtime (src/viewer/protobuf.min.js).
# Bump this and run `make vendor-protobuf` to update it.
PROTOBUFJS_VERSION := 8.7.1
TERSER_VERSION     = 5.39.0
# The inspector panel's UI library (src/inspector/vendor/preact.js): Preact,
# htm and Preact Signals in one ES module. Bump and run `make vendor-inspector`.
PREACT_VERSION     = 10.29.8
HTM_VERSION        = 3.1.1
SIGNALS_VERSION    = 2.11.2
ESBUILD_VERSION    = 0.28.2

VENV := .venv
PYTHON := $(CURDIR)/$(VENV)/bin/python3

.PHONY: help node-deps demo display-model-smoke serve hugo-demo testmath-demo website website-clean check test-render test-render-all test-web clean vendor-protobuf vendor-inspector venv build-viewer minify-viewer

help:
	@echo "Reflow TeX targets:"
	@echo "  make node-deps        install the Node dependencies (npm ci)"
	@echo "  make venv             create .venv for the tools not yet in TypeScript"
	@echo "  make check            verify the pipeline prerequisites are installed"
	@echo "  make demo             build the vanilla demo site into $(DEMO_OUT)"
	@echo "  make display-model-smoke  build the narrow display regression site"
	@echo "  make serve            build the demo and serve it at http://localhost:$(PORT)"
	@echo "  make hugo-demo        compile + serve the Hugo example (needs hugo)"
	@echo "  make testmath-demo    render AMS' testmath.tex (classic CM fonts, legacy path)"
	@echo "  make website          rebuild website/public (incremental – only changed blocks)"
	@echo "  make website-clean    force a full clean rebuild of website/public (incl. testmath.tex)"
	@echo "  make clean            remove build artefacts"
	@echo "  make vendor-protobuf  refresh src/viewer/protobuf.min.js from protobufjs@$(PROTOBUFJS_VERSION)"
	@echo "  make build-viewer     bundle src/viewer/src/ into src/viewer/latex-viewer.js, then minify (maintainers; after editing the viewer)"
	@echo "  make minify-viewer    regenerate src/viewer/latex-viewer.min.js only"
	@echo "  make test-render      the render tests: every glyph in the browser against TeX (tests/render)"
	@echo "  make test-render-all  the same, with the whole-document cases (testmath)"
	@echo "  make test-web         the web tests: the viewer, companion and Hugo integration in Chromium and WebKit (tests/web)"
	@echo "  make vendor-inspector refresh src/inspector/vendor/preact.js (preact@$(PREACT_VERSION), htm, signals)"

# Python deps live in a project-local virtualenv, not the system interpreter.
# Everything below depends on this and calls $(PYTHON), so `make demo` etc. set
# it up on first use – no manual `pip install` needed. Needs Python 3.9+ (see
# scripts/find_python.sh – macOS's bundled python3 qualifies); rebuilds the
# venv if it's missing or was created with a too-old interpreter.
venv:
	@if [ -x $(VENV)/bin/python3 ] && $(VENV)/bin/python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)' 2>/dev/null; then \
	  : ; \
	else \
	  py="$$(./scripts/find_python.sh)" || exit 1; \
	  echo "Creating $(VENV) with $$py ($$($$py --version))"; \
	  rm -rf $(VENV); \
	  $$py -m venv $(VENV); \
	fi; \
	if [ ! -f $(VENV)/.deps-installed ] || [ src/encode/requirements.txt -nt $(VENV)/.deps-installed ]; then \
	  $(VENV)/bin/pip install --upgrade pip; \
	  $(VENV)/bin/pip install -r src/encode/requirements.txt; \
	  touch $(VENV)/.deps-installed; \
	fi

# The build runs on Node, straight from the TypeScript sources (src/pipeline);
# its dependencies are installed on first use and again when the lock changes.
node-deps:
	@if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then \
	  npm ci --no-audit --no-fund; \
	fi

check: node-deps
	@ok=1; \
	for t in lualatex kpsewhich gs dvisvgm node; do \
	  if command -v $$t >/dev/null 2>&1; then echo "  found: $$t"; \
	  else echo "  MISSING: $$t"; ok=0; fi; \
	done; \
	node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 18) ? 0 : 1)' \
	  && echo "  found: Node $$(node --version) (runs TypeScript directly)" \
	  || { echo "  MISSING: Node >= 22.18 (found $$(node --version))"; ok=0; }; \
	[ $$ok -eq 1 ] && echo "All prerequisites present." || { echo "Some prerequisites are missing."; exit 1; }

demo: node-deps
	node integrations/vanilla/build.ts examples/demo -o $(DEMO_OUT) --title "Reflow TeX demo"

display-model-smoke: node-deps
	node integrations/vanilla/build.ts examples/display-model-narrow \
		-o build/display-model-smoke --title "Display model smoke test"

serve: demo
	node scripts/serve.ts $(DEMO_OUT) $(PORT)

hugo-demo: node-deps
	cd integrations/hugo && node prebuild.ts . --demos-dir ../../examples/demo && hugo server --port $(PORT)

# Renders AMS' testmath.tex (bundled verbatim, LPPL 1.3c – see
# examples/testmath/NOTICE.md) with the classic Computer Modern fonts, exercising
# the Type1→web-font conversion. Output is a self-contained site under build/.
testmath-demo: node-deps
	node examples/testmath/build.ts
	@echo "Serve it: node scripts/serve.ts build/testmath-site $(PORT)"

# The actual reflowtex.dev site (website/). build.sh installs what it needs
# itself. Incremental: only blocks whose content changed since the last run
# get recompiled.
website:
	cd website && ./build.sh

# Forces every block (including testmath.tex on the Showcase page) to
# recompile from scratch – needed after touching src/extract/template.tex,
# font handling, or anything else that isn't reflected in a block's own
# content hash. Slower; use `website` for routine content edits.
# The render tests (tests/render/README.md): pytest in the venv, and the
# tests' own Playwright with its Chromium (downloaded once).
RENDER := tests/render
test-render-deps: venv
	@$(PYTHON) -m pip install -q -r $(RENDER)/requirements.txt -r tools/pageless-pdf/requirements.txt
	@cd $(RENDER) && { [ -d node_modules/playwright ] || npm ci --no-audit --no-fund; } && npx playwright install chromium

test-render: test-render-deps
	$(PYTHON) -m pytest $(RENDER) -m "not slow"

test-render-all: test-render-deps
	$(PYTHON) -m pytest $(RENDER)

# The web tests (tests/web/README.md): pytest and Playwright for Python, with
# Chromium and WebKit (downloaded once); Hugo for the integration's site.
test-web: venv
	@$(PYTHON) -m pip install -q -r tests/web/requirements.txt
	@$(PYTHON) -m playwright install chromium webkit
	$(PYTHON) -m pytest tests/web

website-clean:
	cd website && rm -rf public resources .reflowtex-build .hugo_build.lock \
	       data/latex_blocks data/latex_schema.json data/latex_files.json data/latex_font_map.json \
	       data/latex_sources.json static/fonts static/latex-viewer.js static/protobuf.min.js static/testmath \
	       layouts/shortcodes/latex.html layouts/partials/reflowtex-viewer.html
	cd website && PREBUILD_ARGS="--force --prune" ./build.sh

# Maintainer-only: refresh the vendored browser runtime from npm at the pinned
# version. Needs npm on PATH; users building sites do not – the file is committed
# so the browser side stays Node-free and offline.
vendor-protobuf:
	@tmp=$$(mktemp -d); \
	npm pack protobufjs@$(PROTOBUFJS_VERSION) --pack-destination $$tmp --silent >/dev/null && \
	tar -xzf $$tmp/protobufjs-$(PROTOBUFJS_VERSION).tgz -C $$tmp && \
	sed '/^\/\/# sourceMappingURL=/d' $$tmp/package/dist/protobuf.min.js > src/viewer/protobuf.min.js && \
	rm -rf $$tmp && \
	echo "vendored src/viewer/protobuf.min.js from protobufjs@$(PROTOBUFJS_VERSION)"

# Maintainer-only: rebuild the inspector panel's vendored UI library at the
# pinned versions – one minified ES module the panel imports (panel/*.js need
# no build of their own). Needs npm; the file is committed like protobuf.min.js.
vendor-inspector:
	@tmp=$$(mktemp -d); out=$$(pwd)/src/inspector/vendor/preact.js; \
	cd $$tmp && npm init -y >/dev/null && \
	npm install --silent --no-audit --no-fund preact@$(PREACT_VERSION) htm@$(HTM_VERSION) \
	  @preact/signals@$(SIGNALS_VERSION) esbuild@$(ESBUILD_VERSION) && \
	printf '%s\n' "import { h } from 'preact';" "import htm from 'htm';" \
	  "export { h, render, Fragment } from 'preact';" \
	  "export { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'preact/hooks';" \
	  "export { signal, computed, effect, batch, useSignal, useComputed, useSignalEffect } from '@preact/signals';" \
	  "export const html = htm.bind(h);" > entry.js && \
	npx esbuild entry.js --bundle --format=esm --minify --legal-comments=none --outfile=out.js --log-level=warning && \
	{ echo "/* preact@$(PREACT_VERSION), htm@$(HTM_VERSION), @preact/signals@$(SIGNALS_VERSION) – MIT licensed; bundled by esbuild@$(ESBUILD_VERSION) (make vendor-inspector) */"; cat out.js; } > $$out && \
	cd / && rm -rf $$tmp && \
	echo "vendored src/inspector/vendor/preact.js ($$(wc -c < $$out | tr -d ' ') bytes)"

# Maintainer-only: bundle the viewer's modules (src/viewer/src/) into the
# committed classic script src/viewer/latex-viewer.js (src/viewer/build.sh),
# then minify it. Needs npx (Node); site builders do not.
build-viewer:
	@ESBUILD_VERSION=$(ESBUILD_VERSION) sh src/viewer/build.sh
	@$(MAKE) --no-print-directory minify-viewer

# Maintainer-only: regenerate the committed minified viewer after editing
# latex-viewer.js. Integrations ship the minified copy under the name
# latex-viewer.js when its header records the current source's SHA-256, and
# fall back to the source (with a warning) when it is stale – so forgetting
# this step costs bytes, never correctness. Needs npx (Node); site builders
# do not. terser is pinned like protobufjs above.
minify-viewer:
	@src=src/viewer/latex-viewer.js; out=src/viewer/latex-viewer.min.js; \
	sha=$$(shasum -a 256 $$src | cut -c1-64); \
	npx --yes terser@$(TERSER_VERSION) $$src --compress --mangle \
	  --comments '/SPDX-License-Identifier/' -o $$out.tmp && \
	{ printf '/* reflowtex latex-viewer.js, minified by terser@$(TERSER_VERSION); source sha256 %s */\n' "$$sha"; cat $$out.tmp; } > $$out && \
	rm -f $$out.tmp && \
	echo "wrote $$out ($$(wc -c < $$src | tr -d ' ') -> $$(wc -c < $$out | tr -d ' ') bytes)"

clean:
	rm -rf build
	rm -rf integrations/hugo/public integrations/hugo/resources \
	       integrations/hugo/.reflowtex-build integrations/hugo/data/latex_blocks \
	       integrations/hugo/data/latex_schema.json integrations/hugo/data/latex_files.json \
	       integrations/hugo/data/latex_font_map.json integrations/hugo/static/fonts \
	       integrations/hugo/static/latex-viewer.js integrations/hugo/static/protobuf.min.js
