# SPDX-License-Identifier: AGPL-3.0-or-later
# Reflow TeX — one-command demos.
#
# Prerequisites on PATH: lualatex (TeX Live), dvisvgm, protoc, python3.
# Python deps: pip install -r src/encode/requirements.txt

PORT ?= 8000
DEMO_OUT := build/demo-site
# Pinned version of the vendored browser runtime (src/viewer/protobuf.min.js).
# Bump this and run `make vendor-protobuf` to update it.
PROTOBUFJS_VERSION := 8.7.1

.PHONY: help demo serve hugo-demo testmath-demo check clean vendor-protobuf

help:
	@echo "Reflow TeX targets:"
	@echo "  make check            verify the pipeline prerequisites are installed"
	@echo "  make demo             build the vanilla demo site into $(DEMO_OUT)"
	@echo "  make serve            build the demo and serve it at http://localhost:$(PORT)"
	@echo "  make hugo-demo        compile + serve the Hugo example (needs hugo)"
	@echo "  make testmath-demo    render AMS' testmath.tex (classic CM fonts, legacy path)"
	@echo "  make clean            remove build artefacts"
	@echo "  make vendor-protobuf  refresh src/viewer/protobuf.min.js from protobufjs@$(PROTOBUFJS_VERSION)"

check:
	@ok=1; \
	for t in lualatex dvisvgm protoc python3; do \
	  if command -v $$t >/dev/null 2>&1; then echo "  found: $$t"; \
	  else echo "  MISSING: $$t"; ok=0; fi; \
	done; \
	python3 -c "import google.protobuf, fontTools" 2>/dev/null \
	  && echo "  found: python protobuf + fonttools" \
	  || { echo "  MISSING: python protobuf and/or fonttools (pip install -r src/encode/requirements.txt)"; ok=0; }; \
	[ $$ok -eq 1 ] && echo "All prerequisites present." || { echo "Some prerequisites are missing."; exit 1; }

demo:
	python3 integrations/vanilla/build.py examples/demo -o $(DEMO_OUT) --title "Reflow TeX demo"

serve: demo
	@echo "Serving $(DEMO_OUT) at http://localhost:$(PORT)  (Ctrl-C to stop)"
	python3 -m http.server -d $(DEMO_OUT) $(PORT)

hugo-demo:
	cd integrations/hugo && python3 prebuild.py . --demos-dir ../../examples/demo && hugo server --port $(PORT)

# Renders AMS' testmath.tex (bundled verbatim, LPPL 1.3c — see
# examples/testmath/NOTICE.md) with the classic Computer Modern fonts, exercising
# the Type1→web-font conversion. Output is a self-contained site under build/.
testmath-demo:
	python3 examples/testmath/build.py
	@echo "Serve it: python3 -m http.server -d build/testmath-site $(PORT)"

# Maintainer-only: refresh the vendored browser runtime from npm at the pinned
# version. Needs npm on PATH; users building sites do not — the file is committed
# so the browser side stays Node-free and offline.
vendor-protobuf:
	@tmp=$$(mktemp -d); \
	npm pack protobufjs@$(PROTOBUFJS_VERSION) --pack-destination $$tmp --silent >/dev/null && \
	tar -xzf $$tmp/protobufjs-$(PROTOBUFJS_VERSION).tgz -C $$tmp && \
	cp $$tmp/package/dist/protobuf.min.js src/viewer/protobuf.min.js && \
	rm -rf $$tmp && \
	echo "vendored src/viewer/protobuf.min.js from protobufjs@$(PROTOBUFJS_VERSION)"

clean:
	rm -rf build
	rm -rf integrations/hugo/public integrations/hugo/resources \
	       integrations/hugo/.reflowtex-build integrations/hugo/data/latex_blocks \
	       integrations/hugo/data/latex_schema.json integrations/hugo/data/latex_files.json \
	       integrations/hugo/data/latex_font_map.json integrations/hugo/static/fonts \
	       integrations/hugo/static/latex-viewer.js integrations/hugo/static/protobuf.min.js
