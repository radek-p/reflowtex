# SPDX-License-Identifier: AGPL-3.0-or-later
# Reflow TeX – one-command demos.
#
# Prerequisites on PATH: lualatex (TeX Live), Node >= 22.18; for EPS figures, gs (Ghostscript).
# Node deps: installed into node_modules/ on first use – see the `node-deps` target.

PORT ?= 8000
REPORT_PORT ?= 8010
DEMO_OUT := build/demo-site
# Pinned version of the vendored browser runtime (src/viewer/protobuf.min.js).
# Bump this and run `make vendor-protobuf` to update it.
PROTOBUFJS_VERSION := 8.7.1
# The inspector panel's UI library (src/inspector/vendor/preact.js): Preact,
# htm and Preact Signals in one ES module. Bump and run `make vendor-inspector`.
PREACT_VERSION     = 10.29.8
HTM_VERSION        = 3.1.1
SIGNALS_VERSION    = 2.11.2
ESBUILD_VERSION    = 0.28.2

.PHONY: help node-deps demo display-model-smoke serve hugo-demo testmath-demo website website-clean check test-render test-render-all render-report test-capture test-conformance test-web typecheck build-companion build-inspector clean vendor-protobuf vendor-inspector build-viewer

help:
	@echo "Reflow TeX targets:"
	@echo "  make node-deps        install the Node dependencies (npm ci)"
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
	@echo "  make build-viewer     bundle src/viewer/src/ into src/viewer/latex-viewer.js and .min.js (builds that need it do so themselves)"
	@echo "  make test-render      the render tests: every glyph in the browser against TeX (tests/render)"
	@echo "  make test-render-all  the same, with the whole-document cases (testmath)"
	@echo "  make render-report    the render tests' results side by side, served locally (after test-render)"
	@echo "  make test-capture     the capture tests: what the serializer records of small documents (tests/capture)"
	@echo "  make test-conformance the backend conformance suite: each backend's claimed capabilities checked (tests/backends)"
	@echo "  make typecheck        type-check all the TypeScript: the Node side and the browser's (viewer host API, companion)"
	@echo "  make build-companion  bundle src/companion/src/ (TypeScript) into src/companion/companion.js"
	@echo "  make build-inspector  build src/inspector/src/ into the inspector's scripts"
	@echo "  make test-web         the web tests: the viewer, companion and Hugo integration in Chromium, WebKit and Firefox (tests/web)"
	@echo "  make vendor-inspector refresh src/inspector/vendor/preact.js (preact@$(PREACT_VERSION), htm, signals)"

# The build runs on Node, straight from the TypeScript sources (src/pipeline);
# its dependencies are installed on first use and again when the lock changes.
node-deps:
	@if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then \
	  npm ci --no-audit --no-fund; \
	fi

check: node-deps
	@ok=1; \
	for t in lualatex kpsewhich node; do \
	  if command -v $$t >/dev/null 2>&1; then echo "  found: $$t"; \
	  else echo "  MISSING: $$t"; ok=0; fi; \
	done; \
	node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 18) ? 0 : 1)' \
	  && echo "  found: Node $$(node --version) (runs TypeScript directly)" \
	  || { echo "  MISSING: Node >= 22.18 (found $$(node --version))"; ok=0; }; \
	for t in gs repstopdf; do \
	  if command -v $$t >/dev/null 2>&1; then echo "  found: $$t (EPS figures)"; \
	  else echo "  not found: $$t (needed only for EPS figures)"; fi; \
	done; \
	[ $$ok -eq 1 ] && echo "All prerequisites present." || { echo "Some prerequisites are missing."; exit 1; }

demo: node-deps
	node integrations/vanilla/build.ts examples/demo --snippet -o $(DEMO_OUT) --title "Reflow TeX demo"

display-model-smoke: node-deps
	node integrations/vanilla/build.ts examples/display-model-narrow --snippet \
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

# The render tests (tests/render/README.md), with Playwright's Chromium
# (downloaded once).
test-render-deps: node-deps
	@npx playwright install chromium

test-render: test-render-deps
	node --test tests/render/render.test.ts

test-render-all: test-render-deps
	REFLOWTEX_RENDER_ALL=1 node --test tests/render/render.test.ts

render-report: node-deps
	node tests/render/report/serve.ts $(REPORT_PORT)

# The capture tests (tests/capture/README.md): node:test; TeX only, no browser.
test-capture: node-deps
	node --test tests/capture/capture.test.ts

# The backend conformance suite (docs/backends.md): every registered backend,
# or those in REFLOWTEX_BACKENDS; TeX only, no browser.
test-conformance: node-deps
	node --test tests/backends/conformance.test.ts

# The web tests (tests/web/README.md): Playwright Test, in Chromium, WebKit
# and Firefox (downloaded once); Hugo for the integration's site.
test-web: node-deps
	@npx playwright install chromium webkit firefox
	npx playwright test -c tests/web

# Forces every block (including testmath.tex on the Showcase page) to
# recompile from scratch. `website` already recompiles a block whose content,
# preamble or toolchain (src/extract, src/latex, src/schema, src/pipeline)
# changed; this is for what neither records – a new TeX Live, fonts installed
# on the machine. Slower.
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
# pinned versions – one minified ES module the panel imports (panel/*.js are
# built from src/inspector/src/panel without it: make build-inspector). Needs
# npm; the file is committed like protobuf.min.js.
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

# Type-check all the TypeScript: the Node side (tsconfig.json) and the
# browser's (tsconfig.browser.json: the viewer's host modules, the companion).
typecheck: node-deps
	@npm run -s typecheck

# The browser's scripts, built from their TypeScript (src/pipeline/bundles.ts):
# none is committed, and every build that ships one (the integrations, the
# website, the tests) builds it first when it is missing or stale. These
# build one on demand, whether or not it is.
build-companion: node-deps
	@node scripts/build-bundles.ts --force companion

build-inspector: node-deps
	@node scripts/build-bundles.ts --force inspector

build-viewer: node-deps
	@node scripts/build-bundles.ts --force viewer

clean:
	rm -rf build
	rm -rf integrations/hugo/public integrations/hugo/resources \
	       integrations/hugo/.reflowtex-build integrations/hugo/data/latex_blocks \
	       integrations/hugo/data/latex_schema.json integrations/hugo/data/latex_files.json \
	       integrations/hugo/data/latex_font_map.json integrations/hugo/static/fonts \
	       integrations/hugo/static/latex-viewer.js integrations/hugo/static/protobuf.min.js
