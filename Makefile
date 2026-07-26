# SPDX-License-Identifier: AGPL-3.0-or-later
# Reflow TeX — one-command demos.
#
# Prerequisites on PATH: lualatex (TeX Live), dvisvgm, protoc, python3.
# Python deps: managed automatically in a local .venv — see the `venv` target.

PORT ?= 8000
DEMO_OUT := build/demo-site
# Pinned version of the vendored browser runtime (src/viewer/protobuf.min.js).
# Bump this and run `make vendor-protobuf` to update it.
PROTOBUFJS_VERSION := 8.7.1

VENV := .venv
PYTHON := $(CURDIR)/$(VENV)/bin/python3

.PHONY: help demo serve hugo-demo testmath-demo website website-clean check clean vendor-protobuf venv

help:
	@echo "Reflow TeX targets:"
	@echo "  make venv             create .venv and install the Python deps into it"
	@echo "  make check            verify the pipeline prerequisites are installed"
	@echo "  make demo             build the vanilla demo site into $(DEMO_OUT)"
	@echo "  make serve            build the demo and serve it at http://localhost:$(PORT)"
	@echo "  make hugo-demo        compile + serve the Hugo example (needs hugo)"
	@echo "  make testmath-demo    render AMS' testmath.tex (classic CM fonts, legacy path)"
	@echo "  make website          rebuild website/public (incremental — only changed blocks)"
	@echo "  make website-clean    force a full clean rebuild of website/public (incl. testmath.tex)"
	@echo "  make clean            remove build artefacts"
	@echo "  make vendor-protobuf  refresh src/viewer/protobuf.min.js from protobufjs@$(PROTOBUFJS_VERSION)"

# Python deps live in a project-local virtualenv, not the system interpreter.
# Everything below depends on this and calls $(PYTHON), so `make demo` etc. set
# it up on first use — no manual `pip install` needed. Needs Python 3.10+ (see
# scripts/find_python.sh); rebuilds the venv if it's missing or was created
# with a too-old interpreter (e.g. macOS's bundled 3.9 python3).
venv:
	@if [ -x $(VENV)/bin/python3 ] && $(VENV)/bin/python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' 2>/dev/null; then \
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

check: venv
	@ok=1; \
	for t in lualatex dvisvgm protoc python3; do \
	  if command -v $$t >/dev/null 2>&1; then echo "  found: $$t"; \
	  else echo "  MISSING: $$t"; ok=0; fi; \
	done; \
	$(PYTHON) -c "import google.protobuf, fontTools" 2>/dev/null \
	  && echo "  found: python protobuf + fonttools (in $(VENV))" \
	  || { echo "  MISSING: python protobuf and/or fonttools (run: make venv)"; ok=0; }; \
	[ $$ok -eq 1 ] && echo "All prerequisites present." || { echo "Some prerequisites are missing."; exit 1; }

demo: venv
	$(PYTHON) integrations/vanilla/build.py examples/demo -o $(DEMO_OUT) --title "Reflow TeX demo"

serve: demo
	@echo "Serving $(DEMO_OUT) at http://localhost:$(PORT)  (Ctrl-C to stop)"
	$(PYTHON) -m http.server -d $(DEMO_OUT) $(PORT)

hugo-demo: venv
	cd integrations/hugo && $(PYTHON) prebuild.py . --demos-dir ../../examples/demo && hugo server --port $(PORT)

# Renders AMS' testmath.tex (bundled verbatim, LPPL 1.3c — see
# examples/testmath/NOTICE.md) with the classic Computer Modern fonts, exercising
# the Type1→web-font conversion. Output is a self-contained site under build/.
testmath-demo: venv
	$(PYTHON) examples/testmath/build.py
	@echo "Serve it: python3 -m http.server -d build/testmath-site $(PORT)"

# The actual reflowtex.dev site (website/). build.sh manages its own venv, so
# this doesn't depend on the `venv` target above. Incremental: only blocks
# whose content changed since the last run get recompiled.
website:
	cd website && ./build.sh

# Forces every block (including the slow, multi-pass testmath.tex) to
# recompile from scratch — needed after touching src/extract/template.tex,
# font handling, or anything else that isn't reflected in a block's own
# content hash. Slower; use `website` for routine content edits.
website-clean:
	cd website && rm -rf public resources .reflowtex-build .hugo_build.lock \
	       data/latex_blocks data/latex_schema.json data/latex_files.json data/latex_font_map.json \
	       static/fonts static/latex-viewer.js static/protobuf.min.js static/testmath \
	       layouts/shortcodes/latex.html layouts/partials/reflowtex-viewer.html
	cd website && FORCE_TESTMATH=1 PREBUILD_ARGS="--force --prune" ./build.sh

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
