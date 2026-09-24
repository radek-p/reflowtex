// SPDX-License-Identifier: AGPL-3.0-or-later
// latex-viewer.js
// Finds every [data-nodelist-b64] element on the page and renders it as an
// inline SVG using Knuth-Plass line breaking.
//
// Data is embedded in the HTML at Hugo build time (via prebuild.py).
// No runtime fetching of binary files – works fully offline.
//
// Depends on protobuf.min.js being loaded first (exposes global `protobuf`).

(function () {
'use strict';

// document.currentScript is only valid during this script's own synchronous
// top-level execution – it reads as null from inside any callback (DOMContent-
// Loaded handlers, event listeners, …), so anything that needs it later must
// capture it now.
const SCRIPT_URL = document.currentScript?.src;

// Version marker for cache diagnosis: logs the ?v= content hash the page
// requested, and stamps <html data-latex-viewer> once the viewer initialises.
const BUILD = (SCRIPT_URL?.match(/v=([a-f0-9]+)/) || [])[1] || 'unversioned';

// The page-facing surface. Today it holds one thing: the registry of stream
// kinds a page may extend (see STREAM_KINDS). Created here so a page can fill
// it in a script that runs either before or after this one.
const api = window.reflowtex = window.reflowtex || {};
api.streamKinds = api.streamKinds || {};
console.log(`[latex-viewer] build ${BUILD}`);

// ── Fixed rendering constants ─────────────────────────────────────────────────

const ZOOM         = 2;
const SP_TO_PX     = ZOOM / 65536;
const RUNNING_RULE = -1073741824;

// ── KP algorithm defaults (overridable per-block via data attributes) ─────────

const DEFAULT_ALIGN                  = 'justify'; // 'justify' | 'left' | 'right' | 'center'

const DEFAULT_LINE_PENALTY           = 10;
const DEFAULT_ADJ_DEMERITS           = 10000;
const DEFAULT_DOUBLE_HYPHEN_DEMERITS = 10000;
const DEFAULT_PRETOLERANCE           = 100;
const DEFAULT_TOLERANCE              = 200;
const DEFAULT_TOLERANCE_2            = 500;
const DEFAULT_EMERGENCY_TOLERANCE    = 10000;
const DEFAULT_LAST_LINE_MIN          = 0.25;
const DEFAULT_LAST_LINE_PENALTY      = 100000;
const DEFAULT_MAX_EXPAND             = 0.02;
const DEFAULT_MAX_SHRINK             = 0.02;
const DEFAULT_MIN_GAP                = 16;   // pt
const DEFAULT_PAD                    = 2;    // pt (only when spacing > min gap)
const DEFAULT_DISPLAY_MIN_SPACE      = 10;   // pt; 0 allows affine gaps to reach zero
const DEFAULT_DISPLAY_OVERFLOW_TOLERANCE = 2; // px; ignores rounding/tiny ink overhang
const DEFAULT_USE_PROTRUSION         = true;
const DEFAULT_USE_EXPANSION          = true;
const DEFAULT_WIDTH_PT               = 400;

const RIGHT_PROTRUSION = { 44:0.7,46:0.7,58:0.5,59:0.5,45:0.5,8208:0.5,8722:0.5,33:0.3,63:0.3 };
const LEFT_PROTRUSION  = { 40:0.3,8220:0.7,8216:0.7 };

// ── Colour maps (optional, page-supplied) ────────────────────────────────────
// reflowtex ships no palette of its own – colour substitution is entirely
// optional and driven by data an integration embeds on the page, so this file
// stays document-agnostic. A block opts in with [data-color-map="<name>"],
// naming one entry of an optional page-supplied JSON island:
//
//   <script id="latex-color-maps" type="application/json">
//     { "<name>": {
//         "colors": { "<theme>": { "<tex-hex>": "<displayed-hex>", … }, … },
//         "tints":  { "<baked-hex>": ["<base-hex>", <percent>], … }
//     }, … }
//   </script>
//
// colors – flat per-theme substitution, keyed by the hex TeX/tikz produced;
//   colours not listed render as-is. Each non-light theme is matched by a
//   class name on <html> (see this file's README's Theming section); adding a
//   theme to a map is just a new key here plus a class the page switcher sets.
//   Rendering reads these through CSS custom properties, so a theme switch
//   restyles already-rendered SVG with no re-render.
//
//   '#000000' is special: it is the DEFAULT text colour (the serializer omits
//   colour on black glyphs, so they carry no inline fill). Mapping it in a
//   theme recolours all default-coloured text there; leaving it unmapped
//   falls back to the page's currentColor, which is why basic dark mode keeps
//   working even for a block with no colour map at all. '#ffffff' is special
//   too, but is not something a map needs to set: it always tracks
//   --latex-page-bg (see below), because a flat white fill in a TikZ/PDF
//   picture means "the paper", not a deliberate colour choice – true with or
//   without a colour map, so it's a fixed default rather than map data.
//
// tints – colours TeX produced by mixing a base colour into the page, e.g.
//   `red!20!white` is red at 20% over the paper. TeX resolves that to flat
//   RGB at compile time, so what arrives is a baked hex with no trace of how
//   it was built – and a tint of a *white* page reads wrong on a dark one.
//   Re-deriving the mix at runtime, against whatever --latex-page-bg
//   currently is, keeps the intent: a tint follows both its base colour and
//   the current background. This is not the same as opacity, and must not be
//   reimplemented with it – these fills are opaque on purpose, masking the
//   drawing underneath. Each entry is baked-hex: [base-hex, percent-of-base].
//
// --latex-page-bg is deliberately not part of this data: TeX has no notion of
// the page's colour, so it is the *page's* responsibility (its own theme
// CSS), not a colour map's – e.g. `:root.dark { --latex-page-bg: #0c0a09; }`
// alongside wherever else that theme sets its background. Unset, it falls
// back to the CSS `Canvas` system colour, so tints and the viewer's own UI
// chrome (the display scrollbox, citation popovers) still land somewhere
// sane with zero configuration.

function colorFill(c) {
    return `var(--latex-color-${c.slice(1)}, ${c})`;
}

let colorMapsInstalled = false;
function installColorMaps() {
    if (colorMapsInstalled) return;
    colorMapsInstalled = true;
    const island = document.getElementById('latex-color-maps');
    let maps = {};
    if (island) {
        try { maps = JSON.parse(island.textContent); }
        catch (e) { console.error('[latex-viewer] malformed #latex-color-maps JSON', e); }
    }

    // TeX has no notion of the page's colour, so a flat white fill in a
    // TikZ/PDF picture (the paper, not a deliberate colour choice) needs to
    // track whatever the page's background actually is. True for every
    // picture regardless of colour map, so – unlike the rest of this
    // function – this is not map data: it is a fixed, unconditional default,
    // on :root so a map's own '#ffffff' entry (if any) still wins by
    // specificity.
    let css = ':root { --latex-color-ffffff: var(--latex-page-bg, Canvas); }\n';
    for (const [name, map] of Object.entries(maps)) {
        const sel = `.latex-block[data-color-map=${JSON.stringify(name)}]`;
        for (const [theme, entries] of Object.entries(map.colors ?? {})) {
            const decls = Object.entries(entries)
                .map(([src, dst]) => `  --latex-color-${src.slice(1)}: ${dst};`);
            if (decls.length === 0) continue;
            const scoped = theme === 'light' ? sel : `:root.${theme} ${sel}`;
            css += scoped + ' {\n' + decls.join('\n') + '\n}\n';
        }
        // A theme scoped to part of the page: data-latex-theme="T" on any
        // ancestor gives the blocks inside theme T's colours whatever the
        // page's own theme is (a theme preview beside an example, say). Every
        // colour any theme of this map remaps is declared, so a scoped theme
        // also undoes the page theme's substitutions: a colour T leaves alone
        // goes back to itself, and default text back to currentColor. The
        // :root prefix outranks the page-theme rules above; being later wins
        // the tie with a page-theme rule of the same specificity.
        const allSrc = new Set();
        for (const entries of Object.values(map.colors ?? {})) for (const src of Object.keys(entries)) allSrc.add(src);
        if (allSrc.size) {
            const themes = new Set(['light', ...Object.keys(map.colors ?? {})]);
            for (const theme of themes) {
                const entries = (map.colors ?? {})[theme] ?? {};
                const decls = [...allSrc].map(src => `  --latex-color-${src.slice(1)}: `
                    + (entries[src] ?? (src === '#000000' ? 'currentColor' : src)) + ';');
                css += `:root [data-latex-theme=${JSON.stringify(theme)}] ${sel} {\n` + decls.join('\n') + '\n}\n';
            }
        }
        const tintDecls = Object.entries(map.tints ?? {}).map(([hex, [base, pct]]) =>
            `  --latex-color-${hex.slice(1)}: color-mix(in srgb, `
          + `var(--latex-color-${base.slice(1)}, ${base}) ${pct}%, `
          + `var(--latex-page-bg, Canvas));`);
        if (tintDecls.length) css += sel + ' {\n' + tintDecls.join('\n') + '\n}\n';
    }
    // Default-coloured glyphs carry no inline fill; route them through the
    // '#000000' variable with currentColor as fallback – works with zero
    // colour maps installed. The html prefix outranks the page's own
    // `.latex-block svg text` rule regardless of stylesheet order.
    //
    // Deliberately not 'rect': rules set their fill inline, and this rule's
    // specificity would otherwise reach inside a tikzpicture and repaint every
    // coloured shape in the drawing as text.
    css += 'html .latex-block svg text, html .latex-block svg tspan '
         + '{ fill: var(--latex-color-000000, currentColor); }\n';
    const s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
    document.documentElement.setAttribute('data-latex-viewer', BUILD);
}

// ── Per-block params ──────────────────────────────────────────────────────────

// Read the current alignment for an element: CSS custom property wins over data attr.
// Called both at mount time and on every resize so media-query changes are picked up.
function alignFromEl(el) {
    const css = getComputedStyle(el).getPropertyValue('--latex-align').trim();
    return css || el.dataset.align || DEFAULT_ALIGN;
}

function paramsFromEl(el) {
    const d   = el.dataset;
    const num  = (key, def) => key in d ? parseFloat(d[key]) : def;
    const bool = (key, def) => key in d ? d[key] !== 'false'  : def;
    return {
        linePenalty:          num('linePenalty',          DEFAULT_LINE_PENALTY),
        adjDemerits:          num('adjDemerits',          DEFAULT_ADJ_DEMERITS),
        doubleHyphenDemerits: num('doubleHyphenDemerits', DEFAULT_DOUBLE_HYPHEN_DEMERITS),
        pretolerance:         num('pretolerance',         DEFAULT_PRETOLERANCE),
        tolerance:            num('tolerance',            DEFAULT_TOLERANCE),
        tolerance2:           num('tolerance2',           DEFAULT_TOLERANCE_2),
        emergencyTolerance:   num('emergencyTolerance',   DEFAULT_EMERGENCY_TOLERANCE),
        lastLineMin:          num('lastLineMin',          DEFAULT_LAST_LINE_MIN),
        lastLinePenalty:      num('lastLinePenalty',      DEFAULT_LAST_LINE_PENALTY),
        maxExpand:            num('maxExpand',            DEFAULT_MAX_EXPAND),
        maxShrink:            num('maxShrink',            DEFAULT_MAX_SHRINK),
        minGapPt:             num('minGap',               DEFAULT_MIN_GAP),
        padPt:                num('pad',                  DEFAULT_PAD),
        displayMinSpacePt:    num('displayMinSpace',      DEFAULT_DISPLAY_MIN_SPACE),
        displayOverflowTolerancePx:
                               num('displayOverflowTolerance', DEFAULT_DISPLAY_OVERFLOW_TOLERANCE),
        useProtrusion:        bool('protrusion',          DEFAULT_USE_PROTRUSION),
        useExpansion:         bool('expansion',           DEFAULT_USE_EXPANSION),
        align:                alignFromEl(el),
    };
}

// ── Per-page shared state ─────────────────────────────────────────────────────

// fontInfo is intentionally NOT global – font IDs are per-compilation and collide
// across blocks (e.g. both block 1 and block 2 may use ID 54 for different files).
// Each block gets its own map returned from registerFonts().
const registeredFontFaces = new Set();
let   sharedDocType       = null;   // protobuf.js Document type (see loadSchema)
let   fontUrlMap          = {};     // original font filename → served filename (see loadFontMap)
// Fonts are deployed beside this script. Resolving from the script URL keeps the
// viewer portable across a domain root, arbitrary subpaths, and local previews
// (including a page opened straight off disk over file://, where an absolute
// '/fonts/'-style path can't resolve at all – see loadFontMap's handling of
// data-fonts-base below, which must preserve this same resolution).
let   fontBase            = SCRIPT_URL
    ? new URL('fonts/', SCRIPT_URL).href
    : '/fonts/';
let   fontsPending        = false;  // a face still had to be fetched at first paint (see registerFonts / init)

// Per-block cache so ResizeObserver can re-render without re-decoding.
// cache holds width-independent layout state (break candidates) and the
// previously rendered SVG so resize can move elements instead of recreating.
const blockData = new WeakMap(); // el → { doc, lastWidth, lastAlign, params, cache }

// Re-layout one block for its current width/alignment. Returns false if nothing
// needed doing (so the caller can stay quiet).
function reflowBlock(el) {
    const data = blockData.get(el);
    if (!data) return false;
    // A block inside a collapsed section is display:none and reports clientWidth
    // 0, which would fall through to DEFAULT_WIDTH_PT and re-lay-out the block at
    // a width it is never shown at – leaving that stale layout to be printed.
    // Keep the last good layout; being shown again resizes the element, which
    // fires the observer once more.
    if (el.clientWidth === 0 && !el.dataset.latexWidth) return false;
    const newWidth = el.dataset.latexWidth
        ? parseInt(el.dataset.latexWidth)
        : (el.clientWidth / ZOOM) || DEFAULT_WIDTH_PT;
    // Re-read alignment every time: a media query may have changed --latex-align.
    const newAlign = alignFromEl(el);
    if (Math.abs(newWidth - data.lastWidth) < 0.5 && newAlign === data.lastAlign) return false;
    data.lastWidth = newWidth;
    data.lastAlign = newAlign;
    const params = { ...data.params, align: newAlign };
    const t0  = performance.now();
    // Layout always runs for the whole block so its height (and the page's scroll
    // geometry) stays correct – it is pure computation and cheap. Painting, the
    // DOM-heavy part, is then gated to the visible segments.
    const root = layoutDocument(data.fontInfo, data.doc, newWidth, params, data.cache);
    if (root !== el.firstElementChild) el.replaceChildren(root);
    remeasureStreams(data.fontInfo, data.doc, newWidth, params, data.cache);
    // Re-layout moved every line: painted segments now hold ink at stale positions.
    // Mark them dirty so they get re-drawn in place – the on-screen ones now (below),
    // each off-screen one when it next scrolls into view (segIO). They are never
    // hidden in the meantime: their <svg> keeps its new reserved size, only its
    // glyphs are stale until repainted.
    markDirty(data.cache);
    const tp = performance.now();
    const repainted = paintVisibleNow(data.fontInfo, data.cache);
    const st = data.cache.stats || {};
    const ls = data.cache.layoutStats || {};
    console.log(`[latex-viewer] re-render at ${newWidth.toFixed(0)}pt: layout ${(tp - t0).toFixed(1)} ms, paint ${(performance.now() - tp).toFixed(1)} ms (${repainted} visible segment(s); ${st.repositioned||0} repositioned, ${st.created||0} created; segments: ${ls.computed||0} laid out, ${ls.reused||0} reused, ${ls.deferred||0} deferred to scroll)`);
    return true;
}

// Rebuild a block's DOM from scratch at its current width and repaint the visible
// segments. Used when webfonts finish loading after the first paint: the layout is
// unchanged (it is computed from the document's embedded glyph metrics, never the
// browser font), but discarding cache.dom forces layoutDocument to create fresh
// elements, which is what makes the browser rasterise the glyphs with the
// now-loaded face instead of the fallback it painted first. Break candidates
// (cache.bcs) survive, so this costs a layout pass and a visible-segment repaint,
// not a re-decode.
function rerenderBlock(el) {
    const data = blockData.get(el);
    if (!data) return;
    // Rebuilding makes fresh <svg>s, so stop observing the old ones (segIO would
    // otherwise hold detached elements). layoutDocument observes the new ones.
    unobserveAll(data.cache);
    data.cache.dom = null;
    data.cache.layout = null;
    const params = { ...data.params, align: data.lastAlign };
    el.replaceChildren(layoutDocument(data.fontInfo, data.doc, data.lastWidth, params, data.cache));
    remeasureStreams(data.fontInfo, data.doc, data.lastWidth, params, data.cache);
    paintVisibleNow(data.fontInfo, data.cache);
}

// Stream segments (see layoutStreamSegment) nest a whole layout, with its own
// cache, inside the segment's box. These walk a block's cache tree.
function markDirty(cache) {
    if (!cache.dom) return;
    for (const s of cache.dom.segs) {
        if (s.painted) s.dirty = true;
        if (s.sub) markDirty(s.sub);
    }
}
function unobserveAll(cache) {
    if (!cache.dom) return;
    for (const s of cache.dom.segs) {
        if (s.svg) segIO.unobserve(s.svg);
        if (s.sub) unobserveAll(s.sub);
    }
}
// A stream segment laid out while its box was not yet in the document could
// not measure the box's inner width and used the column's. Once the block is
// mounted, one more layout pass reads the real width; everything but the
// stream segments comes straight from the cache, so it is cheap.
function remeasureStreams(fontInfo, doc, widthPt, params, cache) {
    if (!cache.streamsUnmeasured) return;
    cache.streamsUnmeasured = false;
    layoutDocument(fontInfo, doc, widthPt, params, cache);
}

// Repaint every block after a wave of webfonts finishes loading. On a cold cache
// faces arrive in waves *after* content has painted – at init, and lazily on
// scroll – and SVG <text> does not reliably re-rasterise when its face lands
// (Firefox especially). A one-shot repaint on document.fonts.ready is not enough:
// a heading below the first screen is not painted until scrolled to, so if it is
// reached while its (bold) face is still loading it paints in a fallback that the
// already-fired repaint never revisits. So repaint on every loadingdone wave, not
// just once. rerenderBlock also clears the cached elements, so segments painted
// later on scroll are fresh too. Coalesced to one frame; the listener detaches
// once every face has settled. Wired up (see init) only when a face was still
// pending at first paint, so a warm load does none of this.
let fontRepaintScheduled = false;
function scheduleFontRepaint() {
    if (fontRepaintScheduled) return;
    fontRepaintScheduled = true;
    requestAnimationFrame(() => {
        fontRepaintScheduled = false;
        for (const el of observedBlocks) rerenderBlock(el);
        if (document.fonts && document.fonts.status === 'loaded' && document.fonts.removeEventListener) {
            document.fonts.removeEventListener('loadingdone', scheduleFontRepaint);
        }
    });
}

// Re-layout runs in a rAF, not synchronously in the observer callback. Doing the
// work inline resizes the observed element (a new layout has a new height), which
// the observer then reports as "ResizeObserver loop completed with undelivered
// notifications" – harmless but noisy. Deferring to the next frame breaks that
// synchronous feedback loop and coalesces bursts of resizes into one pass.
const roPending = new Set();
let roScheduled = false;
const ro = new ResizeObserver(entries => {
    for (const entry of entries) roPending.add(entry.target);
    if (roScheduled) return;
    roScheduled = true;
    requestAnimationFrame(() => {
        roScheduled = false;
        const els = [...roPending];
        roPending.clear();
        for (const el of els) reflowBlock(el);
    });
});

// ── Per-segment painting (grow-only) ──────────────────────────────────────────
// Layout always covers the whole block (cheap pure computation, and it must, so
// the block's height keeps scroll geometry exact). Painting – placing tens of
// thousands of glyph elements – is the DOM-heavy part, so a segment is painted
// only once it comes within a viewport of the screen. Which segments those are is
// tracked by an IntersectionObserver on each segment's own <svg>, i.e. from the
// real element positions. It is deliberately NOT computed from a running height
// model: a model would have to reproduce every margin and wrapper detail of the
// real layout (a scrollable display's headroom padding and compensating margins,
// say – see layoutDocument), so it drifts from it and, near the bottom of a long
// page, mis-gates segments that are in fact on screen. Observing the elements has
// no such drift and costs no per-frame measurement.
//
// Painting is grow-only: a segment, once painted, is never hidden. Scrolling can
// only ever add ink, never remove it, so text never vanishes as the page moves. A
// width change re-draws the painted segments in place (their glyphs move) – the
// visible ones at once, the rest when scrolled to – but still never blanks them.
const observedBlocks = new Set();       // blocks (for font-repaint + print)
const segRef = new WeakMap();           // a segment's <svg> → { cache, i }
const segIO = new IntersectionObserver(entries => {
    for (const e of entries) {
        const ref = segRef.get(e.target);
        const s = ref && ref.cache.dom && ref.cache.dom.segs[ref.i];
        if (!s) continue;
        s.intersecting = e.isIntersecting;
        if (e.isIntersecting && (!s.painted || s.dirty)) paintSegment(ref.cache.fontInfo, ref.cache, ref.i);
    }
}, { rootMargin: '100% 0px' });         // one-viewport vertical lookahead

// Observe each not-yet-observed segment of a block. Idempotent: a segment's <svg>
// is created once and reused across reflows, so its observation persists (only a
// font rerender, which rebuilds the DOM, makes new ones – see rerenderBlock).
function observeSegments(cache) {
    const segs = cache.dom.segs;
    for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (s.observed || !s.svg) continue;   // a stream segment has no <svg> of its own
        segRef.set(s.svg, { cache, i });
        segIO.observe(s.svg);
        s.observed = true;
    }
}

// Paint, synchronously, every segment that needs it (never painted, or dirtied by
// a reflow) and is within a viewport of the screen. Reads each segment's real box,
// so it shares the IntersectionObserver's immunity to height drift and is correct
// under page zoom (getBoundingClientRect and innerHeight are the same space). Two
// passes – measure all, then paint – because painting mutates the DOM and would
// otherwise force a fresh layout between measurements. Used for the first paint and
// after a reflow; the observer covers whatever scrolls into view later.
function paintVisibleNow(fontInfo, cache) {
    if (!cache.dom) return 0;
    cache.stats = { created: 0, moved: 0, repositioned: 0, removed: 0 };
    const segs = cache.dom.segs;
    const vh = window.innerHeight || 800, M = vh;
    const todo = [], nested = [];
    for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        // A stream segment paints through its nested cache – after this pass,
        // so the measurements below are not interleaved with DOM writes.
        if (!s.svg) { if (s.sub) nested.push(s.sub); continue; }
        if (s.painted && !s.dirty) continue;
        // Not rendered at all (inside a collapsed stream, say): its rect is all
        // zeros, which would pass the test below. The IntersectionObserver
        // paints it once it is shown.
        if (!s.svg.getClientRects().length) continue;
        const r = s.svg.getBoundingClientRect();
        if (r.bottom > -M && r.top < vh + M) todo.push(i);
    }
    for (const i of todo) paintSegment(fontInfo, cache, i);
    let n = todo.length;
    for (const c of nested) n += paintVisibleNow(fontInfo, c);
    return n;
}

let vpScheduled = false;
function scheduleViewportPaint() {
    if (vpScheduled) return;
    vpScheduled = true;
    requestAnimationFrame(() => {
        vpScheduled = false;
        for (const el of observedBlocks) {
            const data = blockData.get(el);
            if (data) paintVisibleNow(data.fontInfo, data.cache);
        }
    });
}
// Scrolling is handled by the IntersectionObserver (no per-frame work). A viewport
// resize – or the synthetic resize the zoom control fires – can change which
// segments are on screen without the observer necessarily re-firing, so re-check
// the visible set then.
window.addEventListener('resize', scheduleViewportPaint, { passive: true });

// Print needs every segment painted (off-screen ones are empty until then). Grow-
// only means they simply stay painted afterwards, so there is nothing to restore.
window.addEventListener('beforeprint', () => {
    for (const el of observedBlocks) {
        const data = blockData.get(el);
        if (data) paintDocument(data.fontInfo, data.cache);
    }
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function b64ToBytes(b64) {
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

// ── Font loading ──────────────────────────────────────────────────────────────

async function registerFonts(fontsData) {
    const fontInfo = {};
    const fileToFamily = {};
    let css = '';
    for (const f of Object.values(fontsData)) {
        const file = f.filename;
        if (fileToFamily[file]) continue;
        // A font the serializer could not resolve to an OTF file (filename
        // 'unknown' – e.g. a Type1 math font with no OpenType form) has nothing to
        // fetch. Map it to a system serif so its glyphs fall back, rather than
        // emitting an @font-face that is guaranteed to 404.
        if (!file || file === 'unknown') { fileToFamily[file] = 'serif'; continue; }
        // The family is keyed off the font's *original* name (its stable identity
        // across blocks); the file it is fetched from comes from the font map,
        // which for a modified font is a renamed, content-hashed file (the map is
        // empty on pages that don't ship it, so it falls back to the name as-is).
        const family  = file.replace(/\.otf$/i, '').replace(/[^a-zA-Z0-9]/g, '_');
        const servedFile = fontUrlMap[file] || file;
        if (!registeredFontFaces.has(file)) {
            css += `@font-face { font-family: '${family}'; src: url('${fontBase}${servedFile}'); }\n`;
            registeredFontFaces.add(file);
        }
        fileToFamily[file] = family;
    }

    if (css) {
        const s = document.createElement('style');
        s.textContent = css;
        document.head.appendChild(s);
    }

    // No font-feature-settings are applied: glyphs that are not the cmap
    // default for their codepoint (script-size variants, accents, …) are
    // rewritten to dedicated PUA codepoints by prebuild.py, so every glyph
    // renders identically in every browser without relying on GSUB features.
    for (const [idStr, f] of Object.entries(fontsData)) {
        fontInfo[idStr] = {
            family:  fileToFamily[f.filename],
            size_px: (f.size_sp / 65536) * ZOOM,
            // A font with no OTF to load: its glyphs are drawn as metric boxes
            // (see the sink's glyph handler) so the missing ink is visible.
            unresolved: !f.filename || f.filename === 'unknown',
            // Microtypography as TeX had it (FontInfo in latex.proto): the
            // quad protrusion is relative to, \expandglyphsinfont's three
            // arguments (null = the font does not expand), and per-character
            // \lpcode/\rpcode/\efcode for the characters that have any. Handed
            // to an external breaker through the hook's helpers; the built-in
            // breaker keeps its own protrusion table and expansion limits.
            quad:   f.quad || 0,
            expand: (f.expand_stretch || f.expand_shrink)
                        ? { stretch: f.expand_stretch || 0, shrink: f.expand_shrink || 0,
                            step: f.expand_step || 0 }
                        : null,
            codes:  new Map((f.codes || []).map(c => [c.char, c])),
        };
    }

    const families = [...new Set(Object.values(fileToFamily))].filter(fam => fam !== 'serif');

    // A face that still has to be fetched (cold cache) can first paint as a
    // fallback, and SVG <text> – notably in Firefox – does not always re-rasterise
    // when the real face arrives. Note it so init() can force one repaint once the
    // faces have settled; a warm load (every face already cached, so the first
    // paint is already correct) leaves this false and pays for no second render.
    const check = fam => { try { return document.fonts.check(`12px '${fam}'`); } catch { return false; } };
    if (document.fonts && families.some(fam => !check(fam))) fontsPending = true;

    // allSettled, not all: a font that fails to load (a missing file, a network
    // blip) must not reject and blank the whole block – its glyphs fall back (or
    // are drawn as metric boxes; see the sink). 'serif' is a system family and
    // needs no loading.
    await Promise.allSettled(families.map(fam => document.fonts.load(`12px '${fam}'`)));
    // A face whose file could not be fetched settles with status 'error'
    // (load() itself still resolves). Tell the reader, once per page.
    if (document.fonts) {
        const failed = [];
        for (const face of document.fonts) {
            const fam = String(face.family).replace(/^['"]|['"]$/g, '');
            if (face.status === 'error' && families.includes(fam)) {
                const file = Object.keys(fileToFamily).find(k => fileToFamily[k] === fam);
                // by the font's own name: cmr12, not the served cmr12.reflowtex-dfb1fe6f.otf
                failed.push(file ? file.replace(/\.otf$/i, '').replace(/\.reflowtex-[0-9a-f]+$/, '') : fam);
            }
        }
        if (failed.length) reportFontFailure(failed);
    }
    return fontInfo;
}

// ── A warning when fonts fail ─────────────────────────────────────────────────
// Without its fonts a block still lays out (the metrics travel with the
// document) but draws its glyphs in a stand-in face, or not at all for the
// symbol fonts of mathematics – which a reader cannot tell from a broken page.
// So a failed download shows a bar at the bottom of the window, as a cookie
// notice does, naming the fonts and offering a reload. A page may style it
// (.latex-font-warning) or switch it off: window.reflowtex.fontWarning = false.
const failedFonts = new Set();
let fontWarning = null;
function reportFontFailure(names) {
    for (const n of names) failedFonts.add(n);
    if (api.fontWarning === false || !document.body) return;
    if (!fontWarning) {
        const st = document.createElement('style');
        st.textContent = `
          .latex-font-warning { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%);
            z-index: 2147483000; box-sizing: border-box; width: min(44rem, calc(100vw - 32px));
            display: flex; align-items: center; gap: 12px; padding: 12px 14px 12px 18px;
            font: 14px/1.45 ui-sans-serif, system-ui, sans-serif; color: #fff; background: #2b2622;
            border-radius: 12px; box-shadow: 0 8px 28px rgba(0,0,0,.28); }
          .latex-font-warning p { margin: 0; flex: 1; }
          .latex-font-warning strong { color: #ffcf8a; }
          .latex-font-warning button { font: inherit; font-weight: 600; color: inherit; cursor: pointer;
            border: 1px solid rgba(255,255,255,.35); background: none; border-radius: 8px; padding: 6px 12px; }
          .latex-font-warning button:hover { background: rgba(255,255,255,.12); }
          .latex-font-warning button[data-act="close"] { border: 0; padding: 6px 8px; font-size: 18px; line-height: 1; opacity: .8; }
          @media print { .latex-font-warning { display: none; } }`;
        document.head.appendChild(st);
        fontWarning = document.createElement('div');
        fontWarning.className = 'latex-font-warning';
        fontWarning.setAttribute('role', 'alert');
        fontWarning.innerHTML = '<p></p><button type="button" data-act="reload">Reload</button>'
            + '<button type="button" data-act="close" aria-label="Dismiss">\u00d7</button>';
        fontWarning.addEventListener('click', e => {
            const act = e.target.closest('button')?.dataset.act;
            if (act === 'reload') location.reload();
            if (act === 'close') fontWarning.hidden = true;
        });
        document.body.appendChild(fontWarning);
    }
    const list = [...failedFonts];
    const shown = list.slice(0, 4).join(', ') + (list.length > 4 ? ` and ${list.length - 4} more` : '');
    fontWarning.querySelector('p').innerHTML = '<strong>Some fonts could not be downloaded</strong> '
        + `(${shown.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])}). `
        + 'Text may appear in a stand-in font, and mathematics may be missing.';
}

// ── Glyph metrics ─────────────────────────────────────────────────────────────
// A glyph's width/height/depth are interned once per distinct box in the
// document's glyph_metrics table (the encoder replaces the inline dimensions with
// a 1-based Node.metrics index – the same box repeats across thousands of glyphs,
// so keeping one copy matters at 1000-page scale). They are NOT folded back onto
// the node; instead layout/paint read them straight from the table by index,
// which is a single array lookup and keeps the nodes lean. `glyphMetrics` is
// pointed at the current block's table by layoutDocument/paintDocument before any
// node is touched; both entry points re-point it, so deferred paints and
// interleaved blocks always read their own table.
let glyphMetrics = null;
function useGlyphMetrics(table) {
    glyphMetrics = table || [];
    // A decoded entry may lack a zero dimension (an absent field decodes to
    // undefined); fill it in once (per block) or the reader would get undefined
    // and poison the layout arithmetic. Idempotent.
    for (const m of glyphMetrics) {
        if (m.width  === undefined) m.width  = 0;
        if (m.height === undefined) m.height = 0;
        if (m.depth  === undefined) m.depth  = 0;
    }
}
// Read from the table by index; but if a glyph still carries inline dimensions
// (an un-interned document – e.g. output.json fed straight to layout by a test
// harness), honour those. The branch outcome is constant for a given document,
// so it costs nothing measurable.
const gW = n => n.width  !== undefined ? n.width  : glyphMetrics[n.metrics - 1].width;

// Font expansion as TeX applies it: a line's factor `er` (a fraction) stretches
// or shrinks a glyph only if its font was given expansion limits
// (\expandglyphsinfont – microtype sets them on text fonts, never on math
// fonts), and then scaled by the character's \efcode (‰; 1000 unless listed).
// A font kern between two glyphs expands with them, by the mean of their
// codes (LuaTeX's kern_stretch/kern_shrink); one of the two fonts not
// expanding halves it, as LuaTeX averages the two fonts' limits.
function glyphExpandScale(fontInfo, n, er) {
    if (!er || n.text !== undefined) return 1;
    const fi = fontInfo && fontInfo[String(n.font)];
    if (!fi || !fi.expand) return 1;
    const c = fi.codes.get(n.char);
    const ef = c && c.ef !== undefined ? c.ef : 1000;
    return ef > 0 ? 1 + er * ef / 1000 : 1;
}
function kernExpandScale(fontInfo, l, r, er) {
    if (!er || !l || !r || l.type !== 'glyph' || r.type !== 'glyph') return 1;
    const fl = fontInfo && fontInfo[String(l.font)], fr = fontInfo && fontInfo[String(r.font)];
    const ml = fl && fl.expand ? 1 : 0, mr = fr && fr.expand ? 1 : 0;
    if (!ml && !mr) return 1;
    const efOf = (fi, n) => { const c = fi && fi.codes && fi.codes.get(n.char); return c && c.ef !== undefined ? c.ef : 1000; };
    return 1 + er * ((efOf(fl, l) + efOf(fr, r)) / 2 / 1000) * ((ml + mr) / 2);
}
// How much of node i of `ns` a line's expansion factor er widens, as the
// two functions above apply it when the line is drawn: a glyph's width times
// its \efcode share, a font kern's by the mean of its neighbours', and zero
// for anything of a font without expansion. The breaker must stretch a line
// by exactly this much per unit of er, or a justified line is drawn short or
// long by the difference (a document without microtype expands nothing).
function expandableSp(fontInfo, ns, i) {
    const n = ns[i];
    if (n.type === 'glyph') return gW(n) * (glyphExpandScale(fontInfo, n, 1) - 1);
    if (n.type === 'kern' && (n.subtype || 0) === 0)
        return n.kern * (kernExpandScale(fontInfo, ns[i - 1], ns[i + 1], 1) - 1);
    return 0;
}
function sumExpandableSp(fontInfo, ns) {
    let w = 0;
    for (let i = 0; i < (ns || []).length; i++) w += expandableSp(fontInfo, ns, i);
    return w;
}
const gH = n => n.height !== undefined ? n.height : glyphMetrics[n.metrics - 1].height;
const gD = n => n.depth  !== undefined ? n.depth  : glyphMetrics[n.metrics - 1].depth;

// ── Width helpers ─────────────────────────────────────────────────────────────

function nodeWidthSp(n) {
    switch (n.type) {
        case 'glyph':               return gW(n);
        case 'picture':             return n.width;
        case 'kern':                return n.kern;
        case 'glue':                return n.width;
        case 'disc':                return sumWidthSp(n.replace);
        // A transform is drawing-only and has no metrics of its own; its
        // children advance the pen just as they did before being grouped.
        case 'transform':           return sumWidthSp(n.children);
        case 'hlist': case 'vlist': return n.width;
        case 'math':                return n.surround;
        default:                    return 0;
    }
}

function sumWidthSp(nodes)    { return nodes.reduce((a, n) => a + nodeWidthSp(n), 0); }
// The infinite-order fill on a line (\hfil/\hfill from \\, \hfill, or the amsthm
// QED glue) and its total stretch at that order. A line carrying one is not
// justified; instead its slack goes entirely into this glue, which is what pushes
// anything after it (a QED box, a right-flushed word) to the right margin.
function fillInfo(nodes) {
    let order = 0, stretch = 0;
    for (const n of nodes) {
        if (n.type === 'glue' && (n.stretch_order || 0) > 0) {
            const o = n.stretch_order;
            if (o > order) { order = o; stretch = n.stretch; }
            else if (o === order) stretch += n.stretch;
        }
    }
    return { order, stretch };
}

// The set size of one glue node under a box's packing ratio.
function setGlue(g, ratio, fillOrder) {
    let w = g.width;
    // Stretch and shrink are signed, and TeX sets a negative one too: amsmath's
    // multline cancels a fill with \hskip 0pt plus -1fill to push a row's first
    // line flush left, and any glue of the packing order takes part.
    if (ratio > 0 && (g.stretch_order || 0) === fillOrder && g.stretch) w += ratio * g.stretch;
    else if (ratio < 0 && (g.shrink_order || 0) === fillOrder && g.shrink) w += ratio * g.shrink;
    return w;
}

// A vlist's glue is *set* exactly as an hlist's is, just along y – so stacking
// its children by their natural widths is wrong wherever TeX packed the box to
// a size. Extensible delimiters are the case that makes this visible: LuaTeX
// assembles a tall \left( from GlyphAssembly pieces stacked with *negative,
// stretchable* glue so they overlap, and it is the set size that makes the
// assembly reach its declared height. Summing the raw widths instead leaves the
// bracket around a 45pt box some 11pt short of its own baseline, floating above
// the thing it is supposed to enclose.
//
// Unlike hlistGlueRatio this has no natural-size fallback: that path measures
// with nodeWidthSp, which is a *horizontal* size and means nothing in a vlist.
// TeX fills in glue_set/glue_sign on every box it packs, so there is nothing to
// fall back for; a box without them simply has no glue to set.
function vlistGlueRatio(box) {
    if (box.glue_sign === 1 && box.glue_set > 0) return { ratio:  box.glue_set, fillOrder: box.glue_order || 0 };
    if (box.glue_sign === 2 && box.glue_set > 0) return { ratio: -box.glue_set, fillOrder: box.glue_order || 0 };
    return { ratio: 0, fillOrder: 0 };
}

function hlistGlueRatio(box) {
    if (box.glue_sign === 1 && box.glue_set > 0) return { ratio:  box.glue_set, fillOrder: box.glue_order || 0 };
    if (box.glue_sign === 2 && box.glue_set > 0) return { ratio: -box.glue_set, fillOrder: box.glue_order || 0 };
    // A box TeX packed carries glue_set, 0 when it was set at its natural
    // size – and a natural box can still be wider than its contents: a
    // sub/superscript box gets \scriptspace added to its width with no node
    // for it. Measuring such a box would stretch its glue by that surplus;
    // only a box with no packing information at all is measured.
    if (box.glue_set !== undefined && box.glue_set !== null) return { ratio: 0, fillOrder: 0 };
    const nodes = box.children;
    let natural = 0;
    const stretch = [0,0,0,0], shrink = [0,0,0,0];
    for (const n of nodes) {
        if (n.type === 'glue') { natural += n.width; stretch[n.stretch_order||0] += n.stretch; shrink[n.shrink_order||0] += n.shrink; }
        else { natural += nodeWidthSp(n); }
    }
    const slack = box.width - natural;
    if (slack > 0) { for (let o=3;o>=0;o--) if (stretch[o]>0) return { ratio: slack/stretch[o], fillOrder:o }; }
    else if (slack < 0) { for (let o=3;o>=0;o--) if (shrink[o]>0)  return { ratio: slack/shrink[o],  fillOrder:o }; }
    return { ratio: 0, fillOrder: 0 };
}

// ── Protrusion ────────────────────────────────────────────────────────────────

function findLastGlyph(nodes, idx)  { for(let k=idx-1;k>=0;k--){ const n=nodes[k]; if(n.type==='kern'||n.type==='penalty') continue; return n.type==='glyph'?n:null; } return null; }
function findFirstGlyph(nodes, idx) { for(let k=idx;k<nodes.length;k++){ const n=nodes[k]; if(n.type==='kern'||n.type==='penalty'||n.type==='local_par') continue; return n.type==='glyph'?n:null; } return null; }
function rightProtrusionOf(g) { return g ? (RIGHT_PROTRUSION[g.char]||0)*gW(g) : 0; }
function leftProtrusionOf(g)  { return g ? (LEFT_PROTRUSION [g.char]||0)*gW(g) : 0; }

// ── Knuth-Plass: break candidates ────────────────────────────────────────────

// cumGlyphW and the disc *GlyphW fields hold *expandable* width
// (expandableSp), which lineMetrics turns into the line's expansion stretch.
function buildBreakCandidates(nodes, fontInfo) {
    const bcs = [{
        kind:'start', nodeIdx:-1, penalty:0,
        preW:0, postW:0, replaceW:0, preGlyphW:0, postGlyphW:0, replaceGlyphW:0,
        spaceW:0, spaceS:0, spaceZ:0, cumW:0, cumS:0, cumZ:0, cumGlyphW:0, cumFill:0,
        rightProtrusion:0, leftProtrusion:leftProtrusionOf(findFirstGlyph(nodes,0)),
    }];
    let cumW=0, cumS=0, cumZ=0, cumGlyphW=0, cumFill=0;

    for (let i=0; i<nodes.length; i++) {
        const n = nodes[i];
        if (n.type==='local_par') continue;

        // \parfillskip (LuaTeX subtype 15) terminates the paragraph, whatever its
        // stretch. The usual value is "0pt plus 1fil" (a ragged last line), but
        // \centering / \raggedleft set it rigid ("0pt") – and keying the end on
        // stretch>0, as before, gave a centred paragraph (a title, \begin{center})
        // no end candidate at all: kpPass then returned nothing and the greedy
        // fallback emitted no final line, so the whole paragraph vanished whenever
        // it happened to fit on one line. Key on the subtype instead.
        if (n.type==='glue' && n.subtype===15) {
            bcs.push({ kind:'end', nodeIdx:i, penalty:-10000, preW:0,postW:0,replaceW:0, preGlyphW:0,postGlyphW:0,replaceGlyphW:0, spaceW:0,spaceS:0,spaceZ:0, cumW,cumS,cumZ,cumGlyphW,cumFill, rightProtrusion:rightProtrusionOf(findLastGlyph(nodes,i)), leftProtrusion:0 });
            break;
        }
        // A mid-paragraph infinite fill (the \hfil that \\ inserts before its
        // forced break, or an explicit \hfill) is not the end: it marks the line
        // that contains it as "filled" (cumFill), so its slack is absorbed there
        // rather than justified, exactly like a last line. Treating the first such
        // fill as the end would silently drop everything after a \\.
        if (n.type==='glue' && n.stretch_order>0) {
            cumW+=n.width; cumFill+=1;
            continue;
        }
        if (n.type==='glue' && n.subtype===13) {
            bcs.push({ kind:'space', nodeIdx:i, penalty:0, preW:0,postW:0,replaceW:0, preGlyphW:0,postGlyphW:0,replaceGlyphW:0, spaceW:n.width,spaceS:n.stretch,spaceZ:n.shrink, cumW,cumS,cumZ,cumGlyphW,cumFill, rightProtrusion:rightProtrusionOf(findLastGlyph(nodes,i)), leftProtrusion:leftProtrusionOf(findFirstGlyph(nodes,i+1)) });
            cumW+=n.width; cumS+=!n.stretch_order?n.stretch:0; cumZ+=!n.shrink_order?n.shrink:0;
        } else if (n.type==='disc') {
            const preW=sumWidthSp(n.pre),postW=sumWidthSp(n.post),replaceW=sumWidthSp(n.replace);
            const preGlyphW=sumExpandableSp(fontInfo,n.pre),postGlyphW=sumExpandableSp(fontInfo,n.post),replaceGlyphW=sumExpandableSp(fontInfo,n.replace);
            const preGs=n.pre.filter(x=>x.type==='glyph'), postGs=n.post.filter(x=>x.type==='glyph');
            bcs.push({ kind:'disc', nodeIdx:i, penalty:50, preW,postW,replaceW, preGlyphW,postGlyphW,replaceGlyphW, spaceW:0,spaceS:0,spaceZ:0, cumW,cumS,cumZ,cumGlyphW,cumFill, rightProtrusion:rightProtrusionOf(preGs.length>0?preGs[preGs.length-1]:findLastGlyph(nodes,i)), leftProtrusion:leftProtrusionOf(postGs.length>0?postGs[0]:findFirstGlyph(nodes,i+1)) });
            cumW+=replaceW; cumGlyphW+=replaceGlyphW;
        } else if (n.type==='penalty' && n.penalty<10000) {
            let lgW=0,lgS=0,lgZ=0,firstAfterLG=i+1;
            for (let k=i+1;k<nodes.length;k++) {
                const m=nodes[k];
                if (m.type==='kern') { lgW+=m.kern; firstAfterLG=k+1; }
                else if (m.type==='glue') { lgW+=m.width; lgS+=!m.stretch_order?m.stretch:0; lgZ+=!m.shrink_order?m.shrink:0; firstAfterLG=k+1; }
                else break;
            }
            bcs.push({ kind:'penalty', nodeIdx:i, penalty:n.penalty, preW:0,postW:0,replaceW:0, preGlyphW:0,postGlyphW:0,replaceGlyphW:0, spaceW:0,spaceS:0,spaceZ:0, cumW,cumS,cumZ,cumGlyphW,cumFill, leadingGlueW:lgW,leadingGlueS:lgS,leadingGlueZ:lgZ, rightProtrusion:rightProtrusionOf(findLastGlyph(nodes,i)), leftProtrusion:leftProtrusionOf(findFirstGlyph(nodes,firstAfterLG)) });
        } else {
            cumW+=nodeWidthSp(n);
            cumGlyphW+=expandableSp(fontInfo,nodes,i);
            if (n.type==='glue') { cumS+=!n.stretch_order?n.stretch:0; cumZ+=!n.shrink_order?n.shrink:0; }
        }
    }
    return bcs;
}

function lineStartW(bc)      { if(bc.kind==='start') return 0; if(bc.kind==='space') return bc.cumW+bc.spaceW;   if(bc.kind==='disc') return bc.cumW+bc.replaceW-bc.postW; return bc.cumW+(bc.leadingGlueW||0); }
function lineEndW(bc)        { if(bc.kind==='disc')  return bc.cumW+bc.preW; return bc.cumW; }
function lineStartS(bc)      { if(bc.kind==='start') return 0; if(bc.kind==='space') return bc.cumS+bc.spaceS;   if(bc.kind==='penalty') return bc.cumS+(bc.leadingGlueS||0); return bc.cumS; }
function lineStartZ(bc)      { if(bc.kind==='start') return 0; if(bc.kind==='space') return bc.cumZ+bc.spaceZ;   if(bc.kind==='penalty') return bc.cumZ+(bc.leadingGlueZ||0); return bc.cumZ; }
function lineStartGlyphW(bc) { if(bc.kind==='start') return 0; if(bc.kind==='space') return bc.cumGlyphW;        if(bc.kind==='disc')    return bc.cumGlyphW+bc.replaceGlyphW-bc.postGlyphW; return bc.cumGlyphW; }
function lineEndGlyphW(bc)   { if(bc.kind==='disc')  return bc.cumGlyphW+bc.preGlyphW; return bc.cumGlyphW; }

function lineMetrics(bcA, bcB, p) {
    const protrude = p.useProtrusion ? bcA.leftProtrusion + bcB.rightProtrusion : 0;
    const w  = lineEndW(bcB) - lineStartW(bcA) - protrude;
    const s0 = bcB.cumS - lineStartS(bcA);
    const z0 = bcB.cumZ - lineStartZ(bcA);
    if (p.useExpansion) {
        const gW = lineEndGlyphW(bcB) - lineStartGlyphW(bcA);
        return { w, s: s0+gW*p.maxExpand, z: z0+gW*p.maxShrink };
    }
    return { w, s:s0, z:z0 };
}

// The emergency pass (threshold 10000) admits every line, and badness is
// capped at 10000, so every line past the cap would cost the same flat 1e8
// demerits: the breaker could then put the one unavoidable bad line anywhere –
// and does put it first, as a single-word line, since that lets every later
// line be perfect. In that pass lines are therefore weighed by their real,
// uncapped looseness, so a slightly loose line always beats a nearly empty one.
// (TeX avoids the same flatness in practice with \emergencystretch.)
function rawBadness(shortage, total) {
    if (shortage === 0) return 0;
    if (total <= 0) return 1e7;
    const r = shortage / total;
    return Math.min(1e7, 100 * r * r * r);
}

function badness(shortage, total) {
    if (shortage===0) return 0; if (total<=0) return 10000;
    const r=shortage/total; return Math.min(10000, Math.round(100*r*r*r));
}

// ── KP DP (one pass) ─────────────────────────────────────────────────────────

function kpPass(bcs, lineWidthSp, threshold, allowDisc, p) {
    const N=bcs.length;
    const dp=Array.from({length:N},()=>[null,null,null,null]);
    dp[0][2]={demerits:0,prev_j:-1,prev_fc:-1,ratio:0,hyphenated:false};
    let minRejectedBadness=null;

    // A forced break (penalty <= -10000, e.g. from \\) is mandatory: no line may
    // span across it. lastForced[j] is the candidate index of the nearest forced
    // break before j, so a line from i to j is legal only when i >= lastForced[j].
    const lastForced=new Array(N).fill(-1);
    for (let k=1,lf=-1;k<N;k++){ lastForced[k]=lf; if(bcs[k].kind==='penalty'&&bcs[k].penalty<=-10000) lf=k; }

    for (let j=1;j<N;j++) {
        const bcJ=bcs[j];
        if (!allowDisc&&bcJ.kind==='disc') continue;
        if (bcJ.penalty>=10000) continue;
        for (let i=0;i<j;i++) {
            if (i<lastForced[j]) continue;   // line would span a forced break
            for (let fc_i=0;fc_i<4;fc_i++) {
                const si=dp[i][fc_i]; if(!si) continue;
                const {w,s,z}=lineMetrics(bcs[i],bcJ,p);
                // A line carrying an infinite-order fill (\hfil from \\, \hfill)
                // absorbs positive slack instead of justifying: ratio 0, badness 0.
                // So does every line of a paragraph that is not justified (p.ragged):
                // \raggedright, \centering and \raggedleft set \rightskip or
                // \leftskip to 0pt plus 1fil, so any line that fits costs nothing
                // and TeX takes the fewest lines, hyphenating only when it must.
                const hasFill = p.ragged || bcJ.cumFill>bcs[i].cumFill;
                if (bcJ.kind==='end') {
                    const slack=lineWidthSp-w; if(slack<0&&(z===0||(-slack/z)>1)) continue;
                    const ratio=slack<0?slack/z:0, b=ratio<0?badness(-slack,z):0, lp=p.linePenalty+b;
                    let d=lp*lp;
                    // Last-line penalty: penalise if last line is shorter than lastLineMin
                    if (p.lastLineMin>0 && w<p.lastLineMin*lineWidthSp) d+=p.lastLinePenalty;
                    const fc_j=(ratio<0&&b>12)?3:2, td=si.demerits+d;
                    if(!dp[j][fc_j]||td<dp[j][fc_j].demerits) dp[j][fc_j]={demerits:td,prev_j:i,prev_fc:fc_i,ratio,hyphenated:false};
                    continue;
                }
                const slack=lineWidthSp-w;
                let ratio, b;
                if(hasFill&&slack>=0){ ratio=0; b=0; }   // fill absorbs the slack
                else{
                    if(slack>0) ratio=s>0?slack/s:Infinity; else if(slack<0) ratio=z>0?slack/z:-Infinity; else ratio=0;
                    if(ratio<-1) continue;
                    b=badness(Math.abs(slack),slack>=0?s:z);
                    if(b>threshold) { if(minRejectedBadness===null||b<minRejectedBadness) minRejectedBadness=b; continue; }
                }
                const fc_j=slack>=0?(b>99?0:b>12?1:2):(b>12?3:2);
                const bd=threshold>=10000&&!(hasFill&&slack>=0) ? rawBadness(Math.abs(slack),slack>=0?s:z) : b;
                const lp=p.linePenalty+bd; let d=threshold>=10000 ? lp*lp : (Math.abs(lp)>=10000?100000000:lp*lp);
                if(bcJ.penalty>0) d+=bcJ.penalty*bcJ.penalty;
                else if(bcJ.penalty>-10000) d-=bcJ.penalty*bcJ.penalty;
                if(Math.abs(fc_j-fc_i)>1) d+=p.adjDemerits;
                if(bcJ.kind==='disc'&&si.hyphenated) d+=p.doubleHyphenDemerits;
                const td=si.demerits+d;
                if(!dp[j][fc_j]||td<dp[j][fc_j].demerits) dp[j][fc_j]={demerits:td,prev_j:i,prev_fc:fc_i,ratio,hyphenated:bcJ.kind==='disc'};
            }
        }
    }
    const endIdx=N-1; if(bcs[endIdx].kind!=='end') return {breaks:null,minRejectedBadness};
    let bestFc=-1, bestD=Infinity;
    for(let fc=0;fc<4;fc++) if(dp[endIdx][fc]&&dp[endIdx][fc].demerits<bestD){bestD=dp[endIdx][fc].demerits;bestFc=fc;}
    if(bestFc===-1) return {breaks:null,minRejectedBadness};
    const breaks=[]; let j=endIdx,fc=bestFc;
    while(j>0){breaks.push({bcIdx:j,fc,demerits:dp[j][fc].demerits,ratio:dp[j][fc].ratio});const pj=dp[j][fc].prev_j,pfc=dp[j][fc].prev_fc;j=pj;fc=pfc;}
    breaks.reverse(); return {breaks,minRejectedBadness};
}

function extractLineNodes(startBC, endBC, nodes) {
    const result=[]; let from;
    if(startBC.kind==='start'){from=0;}
    else{if(startBC.kind==='disc') for(const pn of nodes[startBC.nodeIdx].post) result.push(pn); from=startBC.nodeIdx+1;}
    // Glue and kern are discarded at a line break, but only at a *break*: at
    // the very start of a paragraph they are real content. \subparagraph* and
    // friends make this visible – \@xsect drops the usual \parindent box and
    // re-inserts the indent as \hskip\parindent glue, which stripping here
    // would delete from the render while the break candidates still counted
    // its width, leaving the first line short by exactly the indent.
    if(startBC.kind!=='start'&&result.length===0){while(from<endBC.nodeIdx&&(nodes[from].type==='glue'||nodes[from].type==='kern'))from++;}
    const to=endBC.nodeIdx;
    for(let i=from;i<to;i++) if(nodes[i].type!=='local_par') result.push(nodes[i]);
    if(endBC.kind==='disc') for(const pn of nodes[endBC.nodeIdx].pre) result.push(pn);
    return result;
}

function greedyFallback(bcs, nodes, lineWidthSp, p) {
    const breaks=[]; let s=0;
    for(let j=1;j<bcs.length;j++){
        const {w}=lineMetrics(bcs[s],bcs[j],p);
        if(bcs[j].kind==='end'){breaks.push({bcIdx:j,fc:2,demerits:0,ratio:0});break;}
        if(w>lineWidthSp&&j>s+1){breaks.push({bcIdx:j-1,fc:2,demerits:0,ratio:0});s=j-1;}
    }
    return breaks;
}

function kpBreak(bcs, nodes, lineWidthSp, p) {
    let breaks=null;
    if (p.pretolerance >= 0)
        breaks = kpPass(bcs,lineWidthSp,p.pretolerance,false,p).breaks;
    if(!breaks) breaks = kpPass(bcs,lineWidthSp,p.tolerance,true,p).breaks;
    if(!breaks) breaks = kpPass(bcs,lineWidthSp,p.tolerance2,true,p).breaks;
    if(!breaks) breaks = kpPass(bcs,lineWidthSp,p.emergencyTolerance,true,p).breaks;
    if(!breaks) breaks = greedyFallback(bcs,nodes,lineWidthSp,p);
    const lines=[];
    for(let k=0;k<breaks.length;k++){
        const startBC=k===0?bcs[0]:bcs[breaks[k-1].bcIdx], endBC=bcs[breaks[k].bcIdx];
        lines.push({nodes:extractLineNodes(startBC,endBC,nodes),ratio:breaks[k].ratio,fitness:breaks[k].fc,leftProtrusion:startBC.leftProtrusion});
    }
    return lines;
}

// ── Adaptive line spacing ─────────────────────────────────────────────────────

function lineProfile(fontInfo, nodes, xStart, ratio, expandRatio) {
    const items=[];
    function walk(ns, x, r, er) {
        for(let i=0;i<ns.length;i++){
            const n=ns[i];
            switch(n.type){
                case 'glyph':{
                    const w=gW(n)*glyphExpandScale(fontInfo,n,er)*SP_TO_PX;
                    const h=gH(n)*SP_TO_PX, d=gD(n)*SP_TO_PX;
                    items.push({x1:x,x2:x+w,h,d}); x+=w; break;
                }
                case 'glue':{let w=n.width; if(r>0&&!(n.stretch_order||0)&&n.stretch)w+=r*n.stretch; else if(r<0&&!(n.shrink_order||0)&&n.shrink)w+=r*n.shrink; x+=w*SP_TO_PX; break;}
                case 'kern': x+=n.kern*((n.subtype||0)===0?kernExpandScale(fontInfo,ns[i-1],ns[i+1],er):1)*SP_TO_PX; break;
                case 'disc': x=walk(n.replace,x,0,er); break;
                case 'math': x+=n.surround*SP_TO_PX; break;
                case 'picture':{
                    const w=(n.width??0)*SP_TO_PX;
                    items.push({x1:x,x2:x+w,h:(n.height??0)*SP_TO_PX,d:(n.depth??0)*SP_TO_PX});
                    x+=w; break;
                }
                case 'hlist':case 'vlist':{
                    const w=(n.width??0)*SP_TO_PX, shift=(n.shift??0)*SP_TO_PX;
                    items.push({x1:x,x2:x+w,h:Math.max(0,(n.height??0)*SP_TO_PX-shift),d:Math.max(0,(n.depth??0)*SP_TO_PX+shift)});
                    x+=w; break;
                }
            }
        }
        return x;
    }
    walk(nodes,xStart,ratio,expandRatio);
    return items;
}

function minRequiredAdvance(upper, lower) {
    let req=0;
    for(const u of upper){if(u.d<=0)continue; for(const l of lower){if(l.h<=0)continue; if(u.x2>l.x1&&l.x2>u.x1) req=Math.max(req,u.d+l.h);}}
    return req;
}

// TeX's interline spacing rule, in px. Given the previous line's depth and this
// line's ascent, and the paragraph's \baselineskip / \lineskip / \lineskiplimit
// (all px), return the baseline-to-baseline advance TeX would use: normally the
// baselineskip, but when the two lines are tall enough that the baselineskip glue
// would fall below lineskiplimit, the fixed lineskip instead. This is exactly the
// rule LaTeX applies, so lines land at the LaTeX distance.
function texInterlineAdvance(prevDepth, thisAscent, m) {
    return (m.bskip - prevDepth - thisAscent >= m.lskiplimit)
        ? m.bskip
        : prevDepth + thisAscent + m.lskip;
}
// The glue portion of that advance (advance minus the two abutting extents), used
// when segments are stacked as boxes with a margin between them.
function texInterlineGlue(prevDepth, thisAscent, m) {
    return texInterlineAdvance(prevDepth, thisAscent, m) - prevDepth - thisAscent;
}

// ── Citations ──────────────────────────────────────────────────────────────────
// A \lrcite number carries its reference number on each of its digit glyphs
// (serializer `cite`). The renderer only *tags* those glyphs – class lr-cite and
// data-cite="<n>"; all behaviour lives in one shared popover driven by delegated
// document events. Delegation (rather than per-glyph listeners) means it does not
// matter when a glyph is painted, that a number is several separate <tspan>s, or
// whether SVG text elements reliably fire mouseenter – a single listener on the
// document handles every citation.
//
//   hover a number → preview it (popover anchored under the number, arrow to it)
//   click a number → pin it open, so its doi/url link is clickable
//   click again, click ×, or click away → close
//
// The reference is typeset from structured .bib fields (title / authors / rest /
// link) produced by scripts/build-citations.py.

let citeData = {};        // { "16": {title, authors, rest, link:{href,label}}, ... }
let citePop = null;       // shared popover element
let citeContent = null;   // its text container
let citeArrow = null;     // the little triangle pointing at the number
let pinnedNum = null;     // reference number of the pinned popover, or null
let pinnedAnchor = null;  // a glyph of the pinned number (to re-anchor on scroll)

function installCitations() {
    const raw = document.getElementById('lr-citations');
    if (raw) {
        try {
            let d = JSON.parse(raw.textContent);
            // Tolerate a doubly-encoded payload (JSON string of JSON).
            if (typeof d === 'string') d = JSON.parse(d);
            if (d && typeof d === 'object') citeData = d;
        } catch { /* leave citeData empty; citations simply stay inert */ }
    }
    // No citation data on the page → nothing for a popover to show. Don't build
    // the popover DOM at all, so a page that doesn't ship the citation CSS never
    // renders a stray close button (the popover relies on that CSS to stay hidden
    // until opened).
    if (Object.keys(citeData).length === 0) return;
    if (citePop) return;

    citePop = document.createElement('div');
    citePop.id = 'lr-cite-pop';
    citePop.setAttribute('role', 'tooltip');
    citeArrow = document.createElement('div'); citeArrow.className = 'lr-cite-arrow';
    const close = document.createElement('button');
    close.className = 'lr-cite-close'; close.type = 'button';
    close.setAttribute('aria-label', 'Close'); close.textContent = '×';
    citeContent = document.createElement('div'); citeContent.className = 'lr-cite-content';
    citePop.append(citeArrow, close, citeContent);
    document.body.appendChild(citePop);
    close.addEventListener('click', closeCite);

    const citeAt = t => (t && t.closest) ? t.closest('[data-cite]') : null;

    // Hover preview (only while nothing is pinned).
    document.addEventListener('pointerover', e => {
        if (pinnedNum !== null) return;
        const el = citeAt(e.target);
        if (el) openCite(el.dataset.cite, el, false);
    });
    document.addEventListener('pointerout', e => {
        if (pinnedNum !== null) return;
        const from = citeAt(e.target);
        if (!from) return;
        const to = citeAt(e.relatedTarget);       // moving between digits of the
        if (!to || to.dataset.cite !== from.dataset.cite) closeCite();  // same number stays open
    });
    // Click a number to pin/unpin; click outside a pinned popover to close it.
    document.addEventListener('click', e => {
        const el = citeAt(e.target);
        if (el) {
            e.preventDefault();
            const num = el.dataset.cite;
            if (pinnedNum === num) closeCite(); else openCite(num, el, true);
        } else if (pinnedNum !== null && !citePop.contains(e.target)) {
            closeCite();
        }
    });

    const reflow = () => { if (pinnedNum !== null && pinnedAnchor) positionCite(pinnedAnchor); };
    window.addEventListener('scroll', reflow, { passive: true });
    window.addEventListener('resize', reflow);
}

function fillCite(num) {
    const ref = citeData[num];
    if (!ref) return false;
    citeContent.textContent = '';
    const add = (cls, text) => {
        const d = document.createElement('div'); d.className = cls; d.textContent = text;
        citeContent.appendChild(d);
    };
    if (ref.title)   add('lr-cite-title', ref.title);
    if (ref.authors) add('lr-cite-authors', ref.authors);
    if (ref.rest)    add('lr-cite-rest', ref.rest);
    // The link is taken verbatim from the .bib's own url/doi field, so it is
    // exact – never scraped back out of rendered text.
    if (ref.link && ref.link.href) {
        const d = document.createElement('div'); d.className = 'lr-cite-link';
        const a = document.createElement('a');
        a.href = ref.link.href; a.textContent = ref.link.label || ref.link.href;
        a.target = '_blank'; a.rel = 'noopener noreferrer';
        d.appendChild(a); citeContent.appendChild(d);
    }
    return true;
}

// The on-screen box of a single glyph <tspan>. Neither getBoundingClientRect()
// nor getBBox() works: for an SVG <tspan> both return the box of the whole
// enclosing <text> run, which would anchor every citation to the centre of its
// line. But each glyph carries its own baseline position as x/y attributes, so
// build the box from those (width ~half an em, height from the font size – rough
// is fine, it only anchors a popover) and map it through getScreenCTM(), which
// folds in every ancestor transform and the SVG's own screen position.
function glyphScreenRect(el) {
    const svg = el.ownerSVGElement;
    const ctm = el.getScreenCTM && el.getScreenCTM();
    const x = parseFloat(el.getAttribute('x'));
    const y = parseFloat(el.getAttribute('y'));
    const fs = parseFloat(el.getAttribute('font-size'));
    if (!svg || !ctm || !svg.createSVGPoint || !isFinite(x) || !isFinite(y) || !isFinite(fs)) {
        return el.getBoundingClientRect();
    }
    // Glyph box in user units: from the baseline up by ~cap height and a hair
    // below it, half an em wide (numerals).
    const x0 = x, x1 = x + fs * 0.5, y0 = y - fs * 0.72, y1 = y + fs * 0.10;
    const pt = svg.createSVGPoint();
    let L = Infinity, T = Infinity, R = -Infinity, B = -Infinity;
    for (const [px, py] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
        pt.x = px; pt.y = py;
        const p = pt.matrixTransform(ctm);
        L = Math.min(L, p.x); R = Math.max(R, p.x); T = Math.min(T, p.y); B = Math.max(B, p.y);
    }
    return { left: L, top: T, right: R, bottom: B, width: R - L, height: B - T };
}

// A number is several adjacent digit <tspan>s sharing data-cite (bracket, comma
// and space glyphs have no cite and break the run). Union their boxes so the
// popover and its arrow anchor to the whole number, not one digit.
function citeGroupRect(el) {
    const num = el.dataset.cite;
    const same = e => e && e.dataset && e.dataset.cite === num;
    const kin = [el];
    for (let p = el.previousElementSibling; same(p); p = p.previousElementSibling) kin.push(p);
    for (let n = el.nextElementSibling;     same(n); n = n.nextElementSibling)     kin.push(n);
    let L = Infinity, T = Infinity, R = -Infinity, B = -Infinity;
    for (const k of kin) {
        const b = glyphScreenRect(k);
        if (!b) continue;
        L = Math.min(L, b.left); T = Math.min(T, b.top); R = Math.max(R, b.right); B = Math.max(B, b.bottom);
    }
    return isFinite(L) ? { left: L, top: T, right: R, bottom: B, width: R - L, height: B - T }
                       : el.getBoundingClientRect();
}

// Anchor the popover to the number in viewport coordinates (position:fixed), so
// no positioned/transformed ancestor can shift it. Placed below the number, or
// above when there is no room; the arrow always points back at the number.
function positionCite(anchor) {
    const r = citeGroupRect(anchor);
    const gap = 9, vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const pw = citePop.offsetWidth, ph = citePop.offsetHeight;
    const cx = r.left + r.width / 2;

    const left = Math.max(8, Math.min(cx - pw / 2, vw - pw - 8));
    const above = (r.bottom + gap + ph > vh) && (r.top - gap - ph > 0);
    const top = above ? r.top - ph - gap : r.bottom + gap;

    citePop.classList.toggle('lr-above', above);
    citePop.style.left = left + 'px';
    citePop.style.top  = top + 'px';
    // Measure the arrow offset from the popover's *actual* rendered left, so it
    // stays on the number through viewport clamping and sub-pixel rounding.
    const box = citePop.getBoundingClientRect();
    citeArrow.style.left = Math.max(12, Math.min(box.width - 12, cx - box.left)) + 'px';
}

function openCite(num, anchor, pin) {
    if (!fillCite(num)) return;
    citePop.classList.toggle('lr-pinned', pin);
    citePop.classList.add('lr-open');
    positionCite(anchor);                 // measured after content is in place
    if (pin) { pinnedNum = num; pinnedAnchor = anchor; }
}

function closeCite() {
    pinnedNum = null; pinnedAnchor = null;
    citePop.classList.remove('lr-open', 'lr-pinned');
}

// Tag a \lrcite digit glyph; the delegated listeners in installCitations do the
// rest, so nothing here needs re-binding when the reconciler reuses the element.
function registerCiteSource(el, num) {
    el.classList.add('lr-cite');
    el.dataset.cite = num;
}

// Bibliography [n] labels still carry `citetarget`; keep marking them in the DOM
// (a cheap data attribute) so a "jump to entry" affordance can use them later.
function registerCiteTarget(el, num) { el.dataset.citeTarget = num; }

// ── Cross-references ─────────────────────────────────────────────────────────
// A \ref stamps every glyph of its printed text with the same document-local id
// (see template.tex), so a reference is a *set* of glyphs, not one. That is what
// makes it possible to light the whole reference up on hover even when the
// browser has broken it across two lines – the pieces never had to stay
// adjacent, they only have to share an id.
//
// Where a label lives is not something this file can know: one LaTeX document
// may be published as one page or, as a book is, as one page per chapter. So
// resolution is split. Labels that some block *on this page* defines are
// resolved here, against what was actually compiled. Everything else is looked
// up in an optional page-supplied map, which is the only place that knows how
// this document was carved into URLs. A label in neither is not a link at all:
// it keeps its text and its ordinary colour, so a reference whose target was
// never published can never masquerade as something to click.
let linkMap    = {};        // label → href, from the page (#latex-link-map)
const pageLabels = new Set();  // labels defined by some block on this page
const linkTargets = new Map(); // label → the anchor element, once one exists
let blockSeq = 0;              // per-block prefix, so ids from two blocks differ
// The directory the viewer was loaded from, which is the site root. Same trick
// as fontBase, and for the same reason: resolving from the script's own URL is
// the one thing that is true whether the site is at a domain root, under a
// subpath, or opened from disk.
let siteBase = document.currentScript && document.currentScript.src
    ? new URL('.', document.currentScript.src).href
    : (typeof location !== 'undefined' ? location.href : '/');

function loadLinkMap() {
    const el = document.getElementById('latex-link-map');
    if (!el || !el.textContent.trim()) return;
    try {
        const d = JSON.parse(el.textContent);
        if (d && typeof d === 'object') linkMap = d;
    } catch { /* leave it empty; references simply stay inert */ }
}

// Where a link points, as something the browser can navigate to from wherever
// this page happens to be sitting.
//
// The map holds paths relative to the *site root*, not to the server root, and
// they are resolved against the directory the viewer script itself was loaded
// from. That is what makes a built site portable: the same files work served at
// a domain root, served under a subpath, and opened straight off disk over
// file://, without anything being rewritten between those cases.
function linkHref(link) {
    if (!link) return null;
    if (link.url) return link.url;
    const label = link.label;
    if (!label) return null;
    if (linkTargets.has(label) || pageLabels.has(label)) return '#' + label;
    const rel = linkMap[label];
    if (!rel) return null;
    try { return new URL(rel, siteBase).href; } catch { return rel; }
}

// Toggle a state class across every glyph of one reference. The group is found
// by data-link, which is block-scoped, so two references printing the same
// number stay independent and one that spans a line break still lights up whole.
function setLinkState(key, cls, on) {
    if (!key) return;
    const els = document.querySelectorAll(`[data-link="${CSS.escape(key)}"]`);
    for (const el of els) el.classList.toggle(cls, on);
    drawLinkUnderline(key, els);
}

// The underline of a hovered reference. CSS text-decoration would underline
// each glyph on its own – every glyph is a separately placed tspan, and the
// spaces between words are not glyphs at all – so the viewer draws it: one
// line per text line, from the reference's first glyph to its last. Glyphs
// are grouped by their SVG and baseline, so a reference broken across lines
// gets one underline per piece. In the glyphs' current colour, so hover and
// press colours carry over.
function drawLinkUnderline(key, els) {
    for (const old of document.querySelectorAll('.latex-link-underline')) old.remove();
    const hover = [...els].filter(el => el.classList.contains('latex-link-hover'));
    if (!hover.length) return;
    const lines = [];   // { svg, base, left, right, em, colour }
    for (const el of hover) {
        const svg = el.ownerSVGElement, ctm = el.getScreenCTM(), sctm = svg?.getScreenCTM();
        if (!svg || !ctm || !sctm) continue;
        const r = el.getBoundingClientRect();
        if (!r.width) continue;
        const inv = sctm.inverse();
        const at = (x, y) => new DOMPoint(x, y).matrixTransform(inv);
        // Baseline from the tspan's own position; extent from its ink box.
        const q = new DOMPoint(+el.getAttribute('x'), +el.getAttribute('y')).matrixTransform(ctm);
        const base = at(q.x, q.y).y;
        const left = at(r.left, r.top).x, right = at(r.right, r.top).x;
        const em = (+el.getAttribute('font-size') || 12) * Math.hypot(ctm.a, ctm.b) / Math.hypot(sctm.a, sctm.b);
        let line = lines.find(l => l.svg === svg && Math.abs(l.base - base) < .6 * Math.max(l.em, em));
        if (!line) lines.push(line = { svg, base, left, right, em, colour: getComputedStyle(el).fill });
        line.base = Math.max(line.base, base); line.em = Math.max(line.em, em);
        line.left = Math.min(line.left, left); line.right = Math.max(line.right, right);
    }
    for (const l of lines) {
        const y = l.base + .13 * l.em;
        const u = svgEl('line', { x1: l.left, x2: l.right, y1: y, y2: y, 'stroke-width': Math.max(.065 * l.em, 1) });
        u.setAttribute('class', 'latex-link-underline');
        u.style.cssText = `stroke:${l.colour};pointer-events:none`;
        l.svg.appendChild(u);
    }
}

// The reference under the pointer, and the one being pressed (data-link keys).
// Module-level so a repaint can restore them: a reflow while the pointer rests
// on a reference (a \webtext changing, say) moves its glyphs, may draw them as
// new elements without the state classes, and leaves the drawn underline where
// the glyphs were.
let hot = null, held = null, linkRestoreQueued = false;
function restoreLinkStates() {
    if ((!hot && !held) || linkRestoreQueued) return;
    linkRestoreQueued = true;
    queueMicrotask(() => {
        linkRestoreQueued = false;
        setLinkState(held, 'latex-link-active', true);
        setLinkState(hot, 'latex-link-hover', true);
    });
}

function installLinks() {
    loadLinkMap();
    const linkAt = t => (t && t.closest) ? t.closest('[data-link]') : null;

    document.addEventListener('pointerover', e => {
        const el = linkAt(e.target), key = el?.dataset.link || null;
        if (key === hot) return;
        setLinkState(hot, 'latex-link-hover', false);
        hot = key;
        setLinkState(hot, 'latex-link-hover', true);
    }, { passive: true });
    document.addEventListener('pointerout', e => {
        if (linkAt(e.relatedTarget)?.dataset.link === hot) return;
        setLinkState(hot, 'latex-link-hover', false); hot = null;
    }, { passive: true });

    // Pressed state is its own class so a page can colour press differently from
    // hover. Released globally, not on the glyph, or a drag off the reference
    // would leave it stuck looking pressed.
    document.addEventListener('pointerdown', e => {
        held = linkAt(e.target)?.dataset.link || null;
        setLinkState(held, 'latex-link-active', true);
    }, { passive: true });
    const release = () => { setLinkState(held, 'latex-link-active', false); held = null; };
    document.addEventListener('pointerup', release, { passive: true });
    document.addEventListener('pointercancel', release, { passive: true });

    document.addEventListener('click', e => {
        const el = linkAt(e.target);
        if (el && el.dataset.linkAction) {
            // Handed to the page as an event from the glyph, so it bubbles
            // through the stream boxes around it and the innermost kind that
            // understands it handles it (and stops it).
            e.preventDefault();
            el.dispatchEvent(new CustomEvent('reflowtex:action', {
                bubbles: true, detail: { action: el.dataset.linkAction, source: el } }));
            return;
        }
        const href = el && el.dataset.linkHref;
        if (!href) return;
        e.preventDefault();
        const local = el.dataset.linkLabel && linkTargets.get(el.dataset.linkLabel);
        if (local) {
            local.scrollIntoView({ behavior: 'smooth', block: 'start' });
            // Leave the fragment in the address bar so the position is
            // shareable and the back button behaves, without a second jump.
            history.pushState(null, '', href);
        } else {
            window.location.href = href;
        }
    });

    // Keyboard: a reference is focusable (see registerLinkGlyph), so Enter and
    // Space must do what a click does.
    document.addEventListener('keydown', e => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const el = linkAt(e.target);
        if (!el) return;
        e.preventDefault();
        el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
}

// Tag one glyph of a reference. Only a reference we can actually resolve is
// marked – an unresolvable one is left as plain text (see the note above).
// Attached once, at element creation, so the reconciler's reuse keeps it.
function registerLinkGlyph(el, id, cache) {
    const link = cache.links?.[id - 1];
    // An action (\webaction) is a control rather than a destination: it
    // has no href, is always live, and is announced as a button.
    const action = link && link.action;
    const href = action ? null : linkHref(link);
    if (!href && !action) return;
    el.classList.add('latex-link');
    el.dataset.link = `${cache.blockKey}:${id}`;
    if (action) { el.classList.add('latex-action'); el.dataset.linkAction = action; }
    else el.dataset.linkHref = href;
    if (link.label) el.dataset.linkLabel = link.label;
    // One glyph of the reference carries the accessible name and the tab stop;
    // the rest are decoration, so a screen reader reads "Section 2", not "2 2 2".
    if (!document.querySelector(`[data-link="${CSS.escape(el.dataset.link)}"]`)) {
        el.setAttribute('role', action ? 'button' : 'link');
        el.setAttribute('tabindex', '0');
    }
}

// ── Slots (\webtext) ──────────────────────────────────────────────────────────
// reflowtex.sty's \webtext{name}{default} leaves a run of glyphs and spaces in a
// paragraph, each carrying the slot's id (Node.slot → Document.slots). Until a
// page gives the name a text, TeX's typesetting of the default is shown as is.
// Once it does – reflowtex.setText(name, text) – the run is replaced by the
// text set the way a browser sets it: split at breakable white space, each
// word one glyph-like node measured by the browser in the slot's font (no
// kerning, ligatures or expansion between words, which the browser's own
// shaping handles within them), and between words the interword glue of that
// font as TeX recorded it. The paragraph then re-breaks around the new text,
// and only the segments holding it are laid out and painted again.
const slotValues = new Map();          // name → string (absent: the default)
const slotBlocks = new Set();          // blocks whose document has slots
let slotMeasure = null;                // a canvas context, made on first use
let slotScheduled = false;

// The width of `text` in font `fi`, in sp, as the browser draws it.
function measureSlotText(fi, text) {
    slotMeasure = slotMeasure || document.createElement('canvas').getContext('2d');
    slotMeasure.font = `${fi.size_px}px ${JSON.stringify(fi.family)}`;
    return Math.round(slotMeasure.measureText(text).width / SP_TO_PX);
}

// The nodes a slot's text becomes. The font and colour are those of the
// default's first glyph; height and depth the default's own, so replacing a
// text never moves the line's baseline.
function slotNodes(fontInfo, slot, id, run, text) {
    const glyphs = [];
    const walk = ns => { for (const n of ns) { if (n.type === 'glyph') glyphs.push(n); else if (n.type === 'disc') walk(n.replace || []); } };
    walk(run);
    const t = glyphs[0];
    if (!t) return run;                // nothing to take the font from: keep the default
    const fi = fontInfo[String(t.font)];
    if (!fi || fi.unresolved) return run;
    const height = Math.max(...glyphs.map(gH)), depth = Math.max(...glyphs.map(gD));
    const spec = `${fi.size_px}px ${JSON.stringify(fi.family)}`;
    // Measured again once the face has loaded, if it had not yet.
    if (document.fonts && !document.fonts.check(spec, text)) {
        document.fonts.load(spec, text).then(() => scheduleSlots(), () => {});
    }
    const out = [];
    // Breakable white space separates words; no-break spaces stay inside one.
    for (const part of String(text).split(/([^\S\u00A0\u202F]+)/)) {
        if (!part) continue;
        if (/^[^\S\u00A0\u202F]+$/.test(part)) {
            out.push({ type: 'glue', subtype: 13, width: slot.space || 0,
                       stretch: slot.stretch || 0, shrink: slot.shrink || 0, slot: id });
        } else {
            out.push({ type: 'glyph', text: part, font: t.font, color: t.color, slot: id,
                       width: measureSlotText(fi, part), height, depth });
        }
    }
    return out;
}

// Rebuild the node list of every paragraph holding a slot from its original
// list, substituting the runs whose name has a text. Returns the indices of
// the paragraphs whose list changed.
function applySlots(fontInfo, doc) {
    const slots = doc.slots || [];
    if (!doc.slotParas) {
        doc.slotParas = [];
        (doc.paragraphs || []).forEach((para, i) => {
            if ((para.nodes || []).some(n => n.slot)) doc.slotParas.push({ index: i + 1, para, orig: para.nodes, made: [] });
        });
    }
    useGlyphMetrics(doc.glyph_metrics);
    const changed = new Set();
    for (const sp of doc.slotParas) {
        const orig = sp.orig, out = [], made = [];
        for (let i = 0; i < orig.length; i++) {
            const id = orig[i].slot, slot = id && slots[id - 1];
            const text = slot ? slotValues.get(slot.name) : undefined;
            if (text === undefined) { out.push(orig[i]); continue; }
            // The run: from here to the last node of this slot (a disc or a
            // font kern between its glyphs carries no id of its own).
            let j = i;
            for (let k = i + 1; k < orig.length; k++) if (orig[k].slot === id) j = k;
            const nodes = slotNodes(fontInfo, slot, id, orig.slice(i, j + 1), text);
            out.push(...nodes); made.push(...nodes);
            i = j;
        }
        // What was substituted, with its measured widths: a text measured
        // again once its font has loaded counts as a change.
        const key = made.map(n => n.text !== undefined ? n.text + '\u0002' + n.width : ' ').join('\u0001');
        if (key === sp.key && sp.made.length === made.length) continue;
        sp.key = key;
        sp.stale = sp.made; sp.made = made;
        sp.para.nodes = made.length ? out : orig;
        changed.add(sp.index);
    }
    return changed;
}

// Forget the layouts of the segments holding those paragraphs (in the nested
// layouts of streams too), and the drawn elements of the words replaced.
function invalidateParagraphs(cache, changed, stale) {
    if (!cache || !cache.dom || !cache.layoutCtx) return;
    for (const i of changed) cache.bcs && cache.bcs.delete(i);
    for (const n of stale) cache.dom.byNode.delete(n);
    cache.layoutCtx.segs.forEach((seg, i) => {
        const s = cache.dom.segs[i];
        if (!s) return;
        if (s.sub) invalidateParagraphs(s.sub, changed, stale);
        if (seg.items && seg.items.some(it => changed.has(it.index))) {
            s.hc = null;
            if (s.painted) s.dirty = true;
        }
    });
}

function refreshSlots(el) {
    const data = blockData.get(el);
    if (!data || !data.cache.dom) return;
    const changed = applySlots(data.fontInfo, data.doc);
    if (!changed.size) return;
    const stale = data.doc.slotParas.flatMap(sp => sp.stale || []);
    data.doc.slotParas.forEach(sp => { sp.stale = null; });
    invalidateParagraphs(data.cache, changed, stale);
    const params = { ...data.params, align: data.lastAlign };
    layoutDocument(data.fontInfo, data.doc, data.lastWidth, params, data.cache);
    paintVisibleNow(data.fontInfo, data.cache);
}

function scheduleSlots() {
    if (slotScheduled) return;
    slotScheduled = true;
    requestAnimationFrame(() => {
        slotScheduled = false;
        for (const el of slotBlocks) refreshSlots(el);
    });
}

// The page's side: give a slot a text (any value; it is shown as a string),
// or null/undefined to show the default again. Every \webtext of that name,
// in every block, follows. Updates within one frame are applied together.
api.setText = function (name, text) {
    if (text === null || text === undefined) slotValues.delete(String(name));
    else slotValues.set(String(name), String(text));
    scheduleSlots();
};
api.getText = name => slotValues.get(String(name));

// ── Footnotes ────────────────────────────────────────────────────────────────
// Footnote bodies are ordinary ContentItem streams stored outside the document's
// main flow. Hover/focus previews them; click pins the popover for touch users and
// so links/citations inside the fully rendered LaTeX body remain interactive.
let footnotePop = null;
let footnoteBody = null;
let footnoteArrow = null;
let pinnedFootnote = null;   // { block, id, anchor } or null
let hoverFootnote = null;

function installFootnotes() {
    if (footnotePop) return;
    const style = document.createElement('style');
    style.textContent = `
      .latex-footnote-source { cursor: help; text-decoration: underline dotted;
        text-underline-offset: .14em; pointer-events: auto; }
      #latex-footnote-pop { position: fixed; z-index: 2147483000; display: none;
        width: max-content; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px);
        overflow: auto; padding: .65rem .75rem; border: 1px solid color-mix(in srgb,
        currentColor 28%, transparent); border-radius: .45rem;
        background: var(--latex-page-bg, Canvas); color: inherit;
        box-shadow: 0 .5rem 1.6rem rgb(0 0 0 / .24); }
      #latex-footnote-pop.latex-footnote-open { display: block; }
      #latex-footnote-pop .latex-footnote-arrow { position: absolute; width: .7rem;
        height: .7rem; top: -.42rem; transform: rotate(45deg);
        background: var(--latex-page-bg, Canvas); border-left: 1px solid
        color-mix(in srgb, currentColor 28%, transparent); border-top: 1px solid
        color-mix(in srgb, currentColor 28%, transparent); }
      #latex-footnote-pop.latex-footnote-above .latex-footnote-arrow {
        top: auto; bottom: -.42rem; transform: rotate(225deg); }
      #latex-footnote-pop .latex-footnote-content { margin: 0; overflow: visible; }
      #latex-footnote-pop .latex-footnote-content svg { max-width: 100%; }
    `;
    document.head.appendChild(style);

    footnotePop = document.createElement('div');
    footnotePop.id = 'latex-footnote-pop';
    footnotePop.setAttribute('role', 'tooltip');
    footnoteArrow = document.createElement('div');
    footnoteArrow.className = 'latex-footnote-arrow';
    footnoteBody = document.createElement('div');
    footnoteBody.className = 'latex-block latex-footnote-content';
    footnotePop.append(footnoteArrow, footnoteBody);
    document.body.appendChild(footnotePop);

    const sourceAt = t => (t && t.closest) ? t.closest('[data-footnote]') : null;
    document.addEventListener('pointerover', e => {
        if (pinnedFootnote) return;
        const el = sourceAt(e.target);
        if (el) openFootnote(el, false);
    });
    document.addEventListener('pointerout', e => {
        if (pinnedFootnote) return;
        const from = sourceAt(e.target);
        if (!from) return;
        const to = sourceAt(e.relatedTarget);
        if (!to || to.dataset.footnote !== from.dataset.footnote) closeFootnote();
    });
    document.addEventListener('focusin', e => {
        if (!pinnedFootnote) {
            const el = sourceAt(e.target);
            if (el) openFootnote(el, false);
        }
    });
    document.addEventListener('focusout', e => {
        if (!pinnedFootnote && !footnotePop.contains(e.relatedTarget)) closeFootnote();
    });
    document.addEventListener('click', e => {
        const el = sourceAt(e.target);
        if (el) {
            e.preventDefault();
            const block = el.closest('[data-nodelist-b64]');
            const id = el.dataset.footnote;
            if (pinnedFootnote && pinnedFootnote.block === block && pinnedFootnote.id === id) {
                closeFootnote();
            } else {
                openFootnote(el, true);
            }
        } else if (pinnedFootnote && !footnotePop.contains(e.target)) {
            closeFootnote();
        }
    });
    document.addEventListener('keydown', e => {
        const el = sourceAt(e.target);
        if (el && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            openFootnote(el, true);
        } else if (e.key === 'Escape' && (pinnedFootnote || hoverFootnote)) {
            closeFootnote();
        }
    });
    const reposition = () => {
        const active = pinnedFootnote || hoverFootnote;
        if (active) positionFootnote(active.anchor);
    };
    const reflow = () => {
        const active = pinnedFootnote || hoverFootnote;
        if (active) {
            renderFootnote(active.block, active.id);
            positionFootnote(active.anchor);
        }
    };
    window.addEventListener('scroll', reposition, { passive: true });
    window.addEventListener('resize', reflow);
}

function footnoteGroupRect(el) {
    const id = el.dataset.footnote;
    const same = e => e && e.dataset && e.dataset.footnote === id;
    const kin = [el];
    for (let p = el.previousElementSibling; same(p); p = p.previousElementSibling) kin.push(p);
    for (let n = el.nextElementSibling; same(n); n = n.nextElementSibling) kin.push(n);
    let L = Infinity, T = Infinity, R = -Infinity, B = -Infinity;
    for (const k of kin) {
        const b = glyphScreenRect(k);
        L = Math.min(L, b.left); T = Math.min(T, b.top);
        R = Math.max(R, b.right); B = Math.max(B, b.bottom);
    }
    return isFinite(L) ? { left:L, top:T, right:R, bottom:B, width:R-L, height:B-T }
                       : el.getBoundingClientRect();
}

function renderFootnote(block, id) {
    const data = blockData.get(block);
    if (!data) return false;
    const note = (data.doc.streams || [])[Number(id) - 1];
    if (!note || note.kind !== 'footnote') return false;
    data.footnoteCaches = data.footnoteCaches || new Map();
    let fc = data.footnoteCaches.get(String(id));
    if (!fc) {
        fc = { bcs:null, dom:null, layout:null, stats:null };
        data.footnoteCaches.set(String(id), fc);
    }
    const widthPx = Math.min(420, Math.max(220, document.documentElement.clientWidth - 32));
    // The body is the stream's own content over the block's shared tables
    // (paragraphs, fonts, pictures, streams – and source_width: a footnote's
    // displays are modelled per scaled point of the measure they were compiled
    // at, so the popover must carry that measure across too).
    const noteDoc = { ...data.doc, content: note.content };
    footnoteBody.style.width = widthPx + 'px';
    footnoteBody.replaceChildren(layoutDocument(
        data.fontInfo, noteDoc, widthPx / ZOOM, data.params, fc));
    paintDocument(data.fontInfo, fc);
    return true;
}

function positionFootnote(anchor) {
    const r = footnoteGroupRect(anchor);
    const gap = 9, vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const pw = footnotePop.offsetWidth, ph = footnotePop.offsetHeight;
    const cx = r.left + r.width / 2;
    const left = Math.max(8, Math.min(cx - pw / 2, vw - pw - 8));
    const above = (r.bottom + gap + ph > vh) && (r.top - gap - ph > 0);
    const rawTop = above ? r.top - ph - gap : r.bottom + gap;
    const top = Math.max(8, Math.min(rawTop, vh - ph - 8));
    footnotePop.classList.toggle('latex-footnote-above', above);
    footnotePop.style.left = left + 'px';
    footnotePop.style.top = top + 'px';
    const box = footnotePop.getBoundingClientRect();
    footnoteArrow.style.left = Math.max(12, Math.min(box.width - 12, cx - box.left)) + 'px';
}

function openFootnote(anchor, pin) {
    const block = anchor.closest('[data-nodelist-b64]');
    const id = anchor.dataset.footnote;
    if (!block || !renderFootnote(block, id)) return;
    footnotePop.classList.add('latex-footnote-open');
    footnotePop.classList.toggle('latex-footnote-pinned', pin);
    positionFootnote(anchor);
    const active = { block, id, anchor };
    if (pin) { pinnedFootnote = active; hoverFootnote = null; }
    else hoverFootnote = active;
}

function closeFootnote() {
    pinnedFootnote = null; hoverFootnote = null;
    if (footnotePop) footnotePop.classList.remove(
        'latex-footnote-open', 'latex-footnote-pinned', 'latex-footnote-above');
}

function registerFootnoteSource(el, id) {
    el.classList.add('latex-footnote-source');
    el.dataset.footnote = id;
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-describedby', 'latex-footnote-pop');
}

// A glyph that refers to a stream (Node.stream, a 1-based index into
// Document.streams). What that means depends on the stream's kind: a footnote
// marker opens its body in the popover above. Other kinds referenced from a
// glyph are reserved for later (a term's definition on hover, say) and get no
// behaviour yet – the glyph renders as plain text.
function registerStreamSource(el, idx, cache) {
    const stream = (cache.streams || [])[idx - 1];
    if (!stream) return;
    if (stream.kind === 'footnote') registerFootnoteSource(el, idx);
}

// ── SVG renderer ──────────────────────────────────────────────────────────────

function svgEl(tag, attrs) {
    const el=document.createElementNS('http://www.w3.org/2000/svg',tag);
    for(const [k,v] of Object.entries(attrs)) el.setAttribute(k,String(v));
    return el;
}

// renderNodes emits glyphs, spaces, and rules through a sink object. The sink
// reconciles against the SVG elements of the previous render instead of
// recreating them: every element is keyed by the identity of the node-list
// object it renders (node objects are decoded once per block and never
// change). Because lines are contiguous slices of one fixed node sequence,
// the global emission order is break-invariant – a reflow can move elements
// between lines and toggle conditional ones (disc pre/post vs replace,
// boundary spaces) on and off, but never reorder them. So reconciliation is
// a single forward merge: reused elements in place cost two attribute writes,
// out-of-place ones a single insertBefore, and toggled-off ones are detached
// (kept in the byNode cache for later reattachment, so after both paths of a
// disc have been seen once, reflows allocate nothing at all).

// ── Transforms ────────────────────────────────────────────────────────────────
// A `transform` node (\rotatebox and friends) carries a PDF matrix applied
// about the current point; see the serializer, which folds TeX's save/setmatrix/
// restore whatsits into it. Two conversions are needed to get to SVG:
//
//   * PDF's y axis points up, SVG's points down. The SVG matrix is the PDF one
//     conjugated by the flip diag(1,-1), which negates the off-diagonal terms:
//     [a b c d] becomes matrix(a, -b, -c, d). Skip this and rotations come out
//     mirrored – 90° turns the wrong way.
//   * The matrix acts about the reference point, not the origin, so it is
//     wrapped in translate(±ref).
function svgMatrixOf(n, x, y) {
    return { a: n.m_a ?? 1, b: -(n.m_b ?? 0), c: -(n.m_c ?? 0), d: n.m_d ?? 1, x, y };
}

// The affine (a,b,c,d,e,f) of a transform about its reference point, in the
// order SVG's matrix() takes: x' = a·x + c·y + e, y' = b·x + d·y + f.
function affineOf(t) {
    return [t.a, t.b, t.c, t.d,
            t.x - (t.a * t.x + t.c * t.y),
            t.y - (t.b * t.x + t.d * t.y)];
}

// m1 ∘ m2 – apply m2, then m1.
function affineMul(m1, m2) {
    if (!m1) return m2;
    if (!m2) return m1;
    const [a1,b1,c1,d1,e1,f1] = m1, [a2,b2,c2,d2,e2,f2] = m2;
    return [a1*a2 + c1*b2,       b1*a2 + d1*b2,
            a1*c2 + c1*d2,       b1*c2 + d1*d2,
            a1*e2 + c1*f2 + e1,  b1*e2 + d1*f2 + f1];
}

function reconcileSink(byNode, used, stats, cache) {
    let textParent = null, auxParent = null, lastTspan = null, lastRect = null;
    const stack = [];

    function place(parent, last, el, isNew) {
        const expected = last ? last.nextSibling : parent.firstChild;
        if (el !== expected) {
            parent.insertBefore(el, expected);
            if (!isNew) stats.moved++;
        }
    }

    return {
        beginLine(textEl, auxEl) { textParent = textEl; auxParent = auxEl; lastTspan = null; lastRect = null; },
        // Rotated glyphs cannot go in the line's shared <text>: a tspan takes
        // no transform of its own (SVG 1.1), and x/y on a tspan would fight
        // the group's matrix anyway. So a transform gets its own <g> holding
        // its own <text>, and sits in the aux parent next to rules and
        // pictures. Nesting works because the parents are stacked.
        beginTransform(n, tf) {
            let g = byNode.get(n);
            const isNew = !g;
            if (isNew) {
                g = svgEl('g', {});
                const t = svgEl('text', {});
                t.style.cssText = 'font-weight:normal;font-style:normal';
                g.appendChild(t);
                byNode.set(n, g); stats.created++;
            } else { stats.repositioned++; }
            const [a,b,c,d,e,f] = affineOf(tf);
            g.setAttribute('transform', `matrix(${a} ${b} ${c} ${d} ${e} ${f})`);
            place(auxParent, lastRect, g, isNew);
            used.add(g); lastRect = g;
            stack.push({ textParent, auxParent, lastTspan, lastRect });
            textParent = g.firstChild; auxParent = g;
            lastTspan = null; lastRect = g.firstChild;
            used.add(g.firstChild);
        },
        endTransform() {
            const s = stack.pop();
            textParent = s.textParent; auxParent = s.auxParent;
            lastTspan = s.lastTspan; lastRect = s.lastRect;
        },
        glyph(n, x, y, fi) {
            // No loadable font for this glyph → draw its metric boxes instead of
            // an unshapeable character (see missing()).
            if (fi?.unresolved) { this.missing(n, x, y); return; }
            let el = byNode.get(n), isNew = !el;
            if (isNew) {
                el = svgEl('tspan', {x, y, 'font-family': fi?.family ?? 'serif', 'font-size': fi?.size_px ?? 12});
                // A \webtext slot's word (see Slots) is a whole word, as text.
                el.textContent = n.text !== undefined ? n.text : String.fromCodePoint(n.char);
                // Inline style so it wins over the page's `fill: currentColor`
                // rule; uncoloured glyphs keep currentColor (dark-mode aware).
                // Coloured ones go through the theme substitution maps.
                if (n.color) el.style.fill = colorFill(n.color);
                // Citation wiring (see installCitations). A \lrcite number's
                // glyphs become a clickable/hoverable citation; a bibliography
                // [n] label's glyphs become the scroll anchor. Attached once,
                // at creation, so reflow (which reuses the element) keeps them.
                if (n.cite)       registerCiteSource(el, n.cite);
                if (n.citetarget) registerCiteTarget(el, n.citetarget);
                if (n.stream)     registerStreamSource(el, n.stream, cache);
                if (n.link)       registerLinkGlyph(el, n.link, cache);
                byNode.set(n, el); stats.created++;
            } else {
                el.setAttribute('x', x); el.setAttribute('y', y); stats.repositioned++;
            }
            place(textParent, lastTspan, el, isNew);
            used.add(el); lastTspan = el;
        },
        // A glyph whose font could not be loaded: draw its TeX metric boxes – the
        // advance width by the height above the baseline, and by the depth below –
        // as two outlined rects, so the missing ink's place and size are visible.
        missing(n, x, y) {
            let el = byNode.get(n), isNew = !el;
            const w = gW(n) * SP_TO_PX;
            const h = gH(n) * SP_TO_PX;                 // above the baseline
            const d = gD(n) * SP_TO_PX;                 // below the baseline
            const boxes = [];
            if (h > 0) boxes.push([x, y - h, w, h]);
            if (d > 0) boxes.push([x, y,     w, d]);
            if (isNew) {
                el = svgEl('g', { class: 'latex-missing-glyph' });
                for (const [bx, by, bw, bh] of boxes) {
                    const r = svgEl('rect', { x: bx, y: by, width: bw, height: bh });
                    r.style.fill = 'none';
                    r.style.stroke = 'var(--latex-color-ff0000, #cc0000)';
                    r.style.strokeWidth = '1';
                    r.style.opacity = '0.55';
                    el.appendChild(r);
                }
                byNode.set(n, el); stats.created++;
            } else {
                const rects = el.children;
                boxes.forEach(([bx, by, bw, bh], i) => {
                    rects[i].setAttribute('x', bx);     rects[i].setAttribute('y', by);
                    rects[i].setAttribute('width', bw); rects[i].setAttribute('height', bh);
                });
                stats.repositioned++;
            }
            place(auxParent, lastRect, el, isNew);
            used.add(el); lastRect = el;
        },
        space(n, x, y) {
            let el = byNode.get(n), isNew = !el;
            if (isNew) {
                el = svgEl('tspan', {x, y});
                el.textContent = ' ';
                byNode.set(n, el); stats.created++;
            } else {
                el.setAttribute('x', x); el.setAttribute('y', y); stats.repositioned++;
            }
            place(textParent, lastTspan, el, isNew);
            used.add(el); lastTspan = el;
        },
        rule(n, x, y, w, h) {
            let el = byNode.get(n), isNew = !el;
            if (isNew) {
                el = svgEl('rect', {x, y, width: w, height: h});
                // Always set the fill inline rather than leaving it to page
                // CSS: a blanket `rect { fill: currentColor }` would also hit
                // the shapes inside a tikzpicture and flatten their colours,
                // since CSS outranks the presentation attributes dvisvgm emits.
                el.style.fill = n.color ? colorFill(n.color)
                                        : 'var(--latex-color-000000, currentColor)';
                byNode.set(n, el); stats.created++;
            } else {
                el.setAttribute('x', x); el.setAttribute('y', y);
                el.setAttribute('width', w); el.setAttribute('height', h);
                stats.repositioned++;
            }
            place(auxParent, lastRect, el, isNew);
            used.add(el); lastRect = el;
        },
        // A precompiled TikZ box or included PDF page. Its markup never changes,
        // so reflowing is only a new transform – the drawing is built once.
        picture(n, x, y) {
            let el = byNode.get(n), isNew = !el;
            const pic = n.pic;
            if (isNew) {
                // A drawing carries its own colours (already rewritten to
                // the theme's custom properties), unlike glyph ink which is
                // themed wholesale. The class marks that boundary for page CSS
                // and for anyone inspecting the DOM.
                el = svgEl('g', { class: 'latex-picture' });
                if (pic) el.innerHTML = pic.svg;
                // dvisvgm omits fill on black paths (SVG's initial fill is
                // black), so the theme's default text colour is supplied here
                // by inheritance rather than rewritten into every path.
                el.setAttribute('fill', 'var(--latex-color-000000, currentColor)');
                byNode.set(n, el); stats.created++;
            } else {
                stats.repositioned++;
            }
            // The source viewBox is in bp; scaling it to the node's TeX width
            // makes the drawing fill its box exactly, at any zoom.
            const s = pic && pic.vb_w ? (n.width * SP_TO_PX) / pic.vb_w : 1;
            el.setAttribute('transform',
                `translate(${x} ${y - n.height * SP_TO_PX}) scale(${s})`);
            place(auxParent, lastRect, el, isNew);
            used.add(el); lastRect = el;
        },
    };
}

// ── Leaders ───────────────────────────────────────────────────────────────────
// Leader glue carries a box that TeX repeats across the glue's set width rather
// than leaving it blank; \xrightarrow is an arrow tail, a \cleaders run of
// en-dashes, and an arrowhead. The set width is whatever the enclosing box's
// glue setting produced, so the copies are laid out here rather than baked in.
//
// Placement follows TeX82 §626-627: as many whole copies as fit, then
//   \cleaders – the remainder is split evenly at the two ends (centred);
//   \xleaders – the remainder is spread evenly into count+1 gaps;
//   \leaders / \gleaders – copies align to a grid on the *enclosing* box rather
//     than to this glue, which is not information the node carries, so they are
//     packed from the left. Nothing in this pipeline uses them today.
const GLUE_LEADERS = 100, GLUE_CLEADERS = 101, GLUE_XLEADERS = 102;

// The DOM reconciler is keyed by node identity, so every tiled copy needs its
// own node objects: drawing one leader box N times would look up the same
// element N times, move it, and leave a single copy at the last position. The
// clones are cached on the glue node and reused while the count holds, which
// keeps the elements – and the reconciler's work – stable across reflows.
function deepCloneNode(o){
    if(Array.isArray(o)) return o.map(deepCloneNode);
    if(o&&typeof o==='object'){
        const r={};
        for(const k of Object.keys(o)) r[k]=deepCloneNode(o[k]);
        return r;
    }
    return o;
}

function leaderCopies(n, count){
    if(!n._leaderCopies || n._leaderCopies.length!==count){
        n._leaderCopies=[];
        for(let i=0;i<count;i++) n._leaderCopies.push(deepCloneNode(n.leader));
    }
    return n._leaderCopies;
}

function renderLeaders(fontInfo, sink, n, x, baselineY, wSp){
    const L=n.leader;
    if(!L || wSp<=0) return;

    // A rule leader is not tiled: TeX simply runs the rule the whole length
    // (\hrulefill). Running dimensions inherit from the enclosing box, which is
    // not reachable here, so they fall back to the rule's own.
    if(L.type==='rule'){
        const h=(L.height===RUNNING_RULE?0:(L.height??0))*SP_TO_PX;
        const d=(L.depth ===RUNNING_RULE?0:(L.depth ??0))*SP_TO_PX;
        if(h+d>0) sink.rule(L, x, baselineY-h, wSp*SP_TO_PX, h+d);
        return;
    }

    const Lw=L.width??0;
    if(Lw<=0) return;                     // would tile forever
    const count=Math.floor(wSp/Lw);
    if(count<1) return;                   // not even one copy fits: TeX draws nothing

    const slack=wSp-count*Lw;
    let start, step=Lw;
    if(n.subtype===GLUE_XLEADERS){ const gap=slack/(count+1); start=gap; step=Lw+gap; }
    else if(n.subtype===GLUE_CLEADERS){ start=slack/2; }
    else { start=0; }                     // \leaders / \gleaders – see note above

    const copies=leaderCopies(n,count);
    for(let i=0;i<count;i++){
        renderNodes(fontInfo,sink,[copies[i]],x+(start+i*step)*SP_TO_PX,baselineY,0,0,0);
    }
}

// Stack a vlist's children top-to-bottom. refY is the vlist's reference baseline
// and vlistX its left edge; both are supplied by the caller (already resolving any
// shift for the context the vlist appears in). Split out of renderNodes so a vlist
// nested inside another vlist can reuse it – without this, a vlist child was
// dropped, which silently deleted the inner half of a stacked construction
// (double math accents, \substack, nested roots, …), leaving one piece too high.
function renderVlistBody(fontInfo, sink, n, vlistX, refY){
    const{ratio:vr,fillOrder:vfo}=vlistGlueRatio(n);
    const vlistW=n.width;
    let curY=refY-n.height*SP_TO_PX;
    for(const child of n.children){
        if(child.type==='kern'){curY+=child.kern*SP_TO_PX;}
        else if(child.type==='glue'){curY+=setGlue(child,vr,vfo)*SP_TO_PX;}
        else if(child.type==='rule'){
            const rw=(child.width===RUNNING_RULE?vlistW:child.width)*SP_TO_PX;
            const rh=(child.height+child.depth)*SP_TO_PX;
            sink.rule(child,vlistX,curY,rw,rh);
            curY+=rh;
        } else if(child.type==='hlist'){
            const cb=curY+child.height*SP_TO_PX;
            const{ratio:hr,fillOrder:hfo}=hlistGlueRatio(child);
            renderNodes(fontInfo,sink,child.children,vlistX+(child.shift??0)*SP_TO_PX,cb,hr,0,hfo,child.height,child.depth);
            curY+=(child.height+child.depth)*SP_TO_PX;
        } else if(child.type==='vlist'){
            // Inside a vlist a box's shift is horizontal; the child's own baseline
            // sits child.height below the current pen, then we advance past it.
            renderVlistBody(fontInfo,sink,child,vlistX+(child.shift??0)*SP_TO_PX,curY+child.height*SP_TO_PX);
            curY+=(child.height+child.depth)*SP_TO_PX;
        }
    }
}

// runH/runD (sp) are the enclosing box's height and depth. A rule with a running
// dimension (the RUNNING_RULE sentinel) inherits it – that is how a \vrule stretches
// to the exact height of the \hbox it sits in (e.g. the two side edges of the amsthm
// QED box). Without this the rule is dropped and only the top/bottom edges show.
function renderNodes(fontInfo, sink, nodes, x, baselineY, ratio, expandRatio, fillOrder, runH, runD) {
    ratio=ratio||0; expandRatio=expandRatio||0; fillOrder=fillOrder||0; runH=runH||0; runD=runD||0;
    for(let i=0;i<nodes.length;i++){
        const n=nodes[i];
        switch(n.type){
            case 'rule':{
                // In an hlist a rule is a vrule: its width is set, its height/depth
                // run to the enclosing box. Draw it, then advance the pen by its width.
                const w =(n.width ===RUNNING_RULE?0:(n.width ??0));
                const h =(n.height===RUNNING_RULE?runH:(n.height??0));
                const d =(n.depth ===RUNNING_RULE?runD:(n.depth ??0));
                const hp=h*SP_TO_PX, dp=d*SP_TO_PX;
                if(w>0&&hp+dp>0) sink.rule(n, x, baselineY-hp, w*SP_TO_PX, hp+dp);
                x+=w*SP_TO_PX; break;
            }
            case 'glyph':{
                sink.glyph(n, x, baselineY, fontInfo[String(n.font)]);
                x+=gW(n)*glyphExpandScale(fontInfo,n,expandRatio)*SP_TO_PX; break;
            }
            case 'glue':{
                let w=n.width;
                if(ratio>0&&(n.stretch_order||0)===fillOrder&&n.stretch) w+=ratio*n.stretch;       // signed, as setGlue
                else if(ratio<0&&(n.shrink_order||0)===fillOrder&&n.shrink) w+=ratio*n.shrink;
                if(n.leader) renderLeaders(fontInfo,sink,n,x,baselineY,w);
                if(n.subtype===13) sink.space(n, x, baselineY);
                if(sink.gap) sink.gap(n,'width',x,w*SP_TO_PX);
                x+=w*SP_TO_PX; break;
            }
            case 'kern':{
                // Expansion stretches the font's own kerns (subtype 0) with the
                // glyphs, as an expanded font copy would; an explicit \kern,
                // an accent kern or an italic correction keeps its width.
                const w=n.kern*((n.subtype||0)===0?kernExpandScale(fontInfo,nodes[i-1],nodes[i+1],expandRatio):1)*SP_TO_PX;
                if(sink.gap) sink.gap(n,'kern',x,w);
                x+=w; break;
            }
            case 'picture':{
                // The picture fills its TeX box exactly; the box is what makes
                // it behave like any other box in text, math or an align row.
                sink.picture(n, x, baselineY);
                x+=n.width*SP_TO_PX; break;
            }
            case 'transform':{
                // The matrix is drawing-only: TeX advanced the pen by the
                // untransformed content and sized the *enclosing* box to the
                // rotated bbox, so the children still advance x exactly as
                // they did before the serializer grouped them. (graphicx makes
                // the content box zero-width, so in practice this is 0.) The
                // ratio/fillOrder pass through for the same reason – these
                // were siblings in the parent list and their glue is set by
                // the parent's packing.
                sink.beginTransform(n, svgMatrixOf(n, x, baselineY));
                x=renderNodes(fontInfo,sink,n.children,x,baselineY,ratio,expandRatio,fillOrder,runH,runD);
                sink.endTransform();
                break;
            }
            case 'disc':  x=renderNodes(fontInfo,sink,n.replace,x,baselineY,0,expandRatio,0,runH,runD); break;
            case 'math':{
                const w=n.surround*SP_TO_PX;
                if(sink.gap) sink.gap(n,'surround',x,w);
                x+=w; break;
            }
            case 'hlist':{
                const{ratio:hr,fillOrder:hfo}=hlistGlueRatio(n);
                renderNodes(fontInfo,sink,n.children,x,baselineY+(n.shift??0)*SP_TO_PX,hr,0,hfo,n.height,n.depth);
                x+=n.width*SP_TO_PX; break;
            }
            case 'vlist':
                // A vlist encountered here sits in an hlist context, where a box's
                // shift is vertical (downward); renderVlistBody stacks its contents.
                renderVlistBody(fontInfo,sink,n,x,baselineY+(n.shift??0)*SP_TO_PX);
                x+=n.width*SP_TO_PX; break;
        }
    }
    return x;
}

// ── Document → SVG element ────────────────────────────────────────────────────
// A block is an ordered stream of paragraphs and displays (see latex.proto).
// The two are laid out very differently but stack identically, so both are
// reduced to the same "line" shape – {nodes, ratio, er, x0} – and the existing
// profiling, spacing, and reconciliation machinery then treats them alike:
//
//   paragraph → Knuth-Plass re-breaks it at the reader's width, many lines
//   display   → one line whose single node is TeX's finished box
//
// Displays are not re-broken or re-packed. The pipeline recovers sparse affine
// width derivatives by matching complete display trees from three increasingly
// wide TeX runs, and those finished dimensions are evaluated at the reader's
// width. The renderer never guesses which node is a gap or activates glue which
// TeX deliberately left slack.
//
// Split into two phases so far-from-viewport blocks can be sized without being
// drawn: layoutDocument runs KP + line spacing and sets the svg's dimensions
// (storing the result in cache.layout); paintDocument materialises the most
// recent layout into glyph/rule elements via the reconciling sink.

// Older blocks carry no content stream; treat them as all-paragraphs.
function contentStream(doc) {
    if (doc.content && doc.content.length) return doc.content;
    return doc.paragraphs.map((_, i) => ({ kind: 'paragraph', para: i + 1 }));
}

// A block is split into segments rather than drawn as one SVG: runs of text
// share an SVG, but every display gets its own. A display keeps its compiled
// width, so it can be wider than the column – in one shared SVG that overflow
// would scroll the whole block, dragging text that fits perfectly out of view.
// Giving each display its own scroll container (as MathJax and KaTeX do) keeps
// the text still and lets only the maths pan.
//
// Segmentation depends solely on the content stream, never on width, so the
// segment list is stable across reflows and every element stays reusable.
const HL_ALIGNMENT = 4;   // hlist subtype: one row of an alignment
const HL_EQUATION  = 6;   // hlist subtype: a display that is not an alignment

// Anchor markers that ended up *inside* what was typeset – a \label written
// mid-sentence, or one amsmath replayed into a display's own box. Their exact
// pen position is known but not useful: an anchor is a scroll destination, and
// the segment is the smallest thing worth scrolling to. Walked once per
// paragraph/box ever, since neither the tree nor the answer changes with width.
const anchorIdsCache = new WeakMap();
function anchorIdsOf(key, roots) {
    let ids = anchorIdsCache.get(key);
    if (ids) return ids;
    ids = [];
    (function walk(ns) {
        for (const n of ns || []) {
            if (n.anchor) ids.push(n.anchor);
            walk(n.children); walk(n.pre); walk(n.post); walk(n.replace);
            if (n.leader) walk([n.leader]);
        }
    })(roots);
    anchorIdsCache.set(key, ids);
    return ids;
}

// A \begin{center}\includegraphics..\end{center}-style figure – a paragraph
// whose only ink is one or more pictures, no running text. \mypic in the
// transducers book is the motivating case, but the test is structural (picture
// present, no glyph present) so it holds for any front end's plain centred
// figure. Such a paragraph gets its own segment (isFigure, below) so a picture
// wider than the column can pan independently instead of bleeding into the
// margin, the same reasoning that gives every display its own scroll box.
// Cached per paragraph object, since segmentsOf reruns on every reflow.
const figureParaCache = new WeakMap();
function isFigureParagraph(para) {
    let v = figureParaCache.get(para);
    if (v !== undefined) return v;
    let hasPicture = false, hasGlyph = false;
    (function walk(ns) {
        for (const n of ns || []) {
            if (n.type === 'picture') hasPicture = true;
            else if (n.type === 'glyph') hasGlyph = true;
            walk(n.children); walk(n.pre); walk(n.post); walk(n.replace);
            if (n.leader) walk([n.leader]);
        }
    })(para.nodes);
    v = hasPicture && !hasGlyph;
    figureParaCache.set(para, v);
    return v;
}

function segmentsOf(doc) {
    const segs = [];
    const pendingAnchors = [];
    const own = (seg, ids) => { if (ids.length) (seg.anchors ||= []).push(...ids); };
    let text = null, gap = 0;
    for (const item of contentStream(doc)) {
        if (item.kind === 'vspace') { gap = item.amount * SP_TO_PX; continue; }
        if (item.kind === 'anchorpoint') {
            // A label that stood between two items – nearly always straight
            // after a sectioning command, which is why it is in vertical mode
            // at all. Attach it to the item it *followed*, so jumping to it
            // lands on the heading rather than below it.
            //
            // Deliberately does not close the open text run or consume `gap`:
            // segmentation must depend only on what is typeset, or adding a
            // label would split a merged paragraph run and change its leading.
            const owner = segs[segs.length - 1];
            if (owner) (owner.anchors ||= []).push(item.anchor);
            else pendingAnchors.push(item.anchor);
            continue;
        }
        if (item.kind === 'stream') {
            // A separately typeset stream embedded here (what the companion
            // package's \begin{reflowtexstream} wraps). Its own segment: the
            // content is laid out as a nested block inside the segment's box,
            // at whatever width the page gives that box (see
            // layoutStreamSegment). Like a display it never merges with the
            // prose around it, and its anchors are the nested layout's concern.
            const stream = doc.streams && doc.streams[item.stream - 1];
            if (stream) {
                segs.push({ kind: 'stream', stream, index: item.stream, gapBefore: gap });
                text = null; gap = 0;
            }
            continue;
        }
        if (item.kind === 'display') {
            // Consecutive alignment rows are the rows of one align/gather, and
            // must be laid out together: they share a single offset so their
            // & alignment survives, and they pan as one unit rather than each
            // row scrolling separately. A \[..\] display is always its own
            // segment.
            const isAlign = item.box.subtype === HL_ALIGNMENT;
            const last    = segs[segs.length - 1];
            if (isAlign && last && last.kind === 'display' && last.isAlign) {
                last.rows.push({ item, gap });
            } else {
                segs.push({ kind: 'display', isAlign, rows: [{ item, gap: 0 }], gapBefore: gap });
            }
            own(segs[segs.length - 1], anchorIdsOf(item.box, item.box.children));
            text = null; gap = 0;
            continue;
        }
        const para = doc.paragraphs[item.para - 1];
        if (!para) continue;
        if (isFigureParagraph(para)) {
            // Never merges with neighbouring prose (own(...) + closing the run
            // below), for the same reason a display never does: it needs its own
            // scroll box, and a shared one would let an oversized figure drag
            // perfectly-fitting text out of view with it.
            const fig = { kind: 'text', isFigure: true,
                          items: [{ index: item.para, para }], gapBefore: gap };
            segs.push(fig);
            own(fig, anchorIdsOf(para, para.nodes));
            text = null; gap = 0;
            continue;
        }
        // Consecutive paragraphs normally merge into one text segment and stack
        // with adaptive leading. An explicit vspace before this paragraph (from
        // \vspace, or a section heading's before/after skip) breaks that merge:
        // the paragraph starts a new segment whose gapBefore reproduces exactly
        // the space TeX asked for (segment boxes stack baseline-to-baseline).
        if (!text || gap) { text = { kind: 'text', items: [], gapBefore: gap }; segs.push(text); }
        text.items.push({ index: item.para, para });
        own(text, anchorIdsOf(para, para.nodes));
        gap = 0;
    }
    // A label before anything was typeset has nothing to trail, so it leads.
    if (pendingAnchors.length && segs.length) own(segs[0], pendingAnchors);
    // Space after the last item. The main flow has none worth keeping, but a
    // stream can end with its environment's closing skip (a proof's \topsep
    // inside an accordion pane), which must still separate it from what
    // follows the stream – so layoutDocument ends with a spacer this high.
    segs.trailingGap = gap;
    return segs;
}

// Lay a text segment out: KP-break each paragraph at the reader's width and
// stack the lines with the adaptive collision-based leading.
function layoutTextSegment(fontInfo, seg, widthPt, p, cache) {
    const widthSp  = Math.round(widthPt * 65536);
    const columnPx = widthPt * ZOOM;
    const lines = [], lrp = [], meta = [];
    // Right edge of the widest line's ink, tracked alongside the loop below.
    // columnPx-only would be wrong for a figure segment (see isFigureParagraph):
    // its one line is an unbreakable, unshrinkable box that is exactly as wide
    // as the source picture, so an oversized one is genuinely wider than the
    // column rather than merely mis-measured. Harmless for ordinary text, whose
    // segment W is never read (only isFigure's mount logic consults it).
    let maxRightPx = columnPx;

    for (const { index, para } of seg.items) {
        let bcs = cache.bcs.get(index);
        if (!bcs) { bcs = buildBreakCandidates(para.nodes, fontInfo); cache.bcs.set(index, bcs); }

        // Alignment is per paragraph: TeX's \centering/\raggedright/\raggedleft
        // set the paragraph's \leftskip/\rightskip, which the serializer reads and
        // records as para.align. A paragraph with none (the common case) inherits
        // the block's alignment (p.align, from --latex-align). This is what centres
        // a \maketitle title inside an otherwise justified document.
        const align   = para.align || p.align;
        const justify = align === 'justify';

        // TeX interline parameters for this paragraph (sp → px). bskip>0 marks
        // "use the LaTeX rule"; absent (old data) falls back to adaptive leading.
        const lineMeta = para.baselineskip ? {
            bskip:      para.baselineskip  * SP_TO_PX,
            lskip:      (para.lineskip || 0) * SP_TO_PX,
            lskiplimit: (para.lineskiplimit || 0) * SP_TO_PX,
        } : null;

        // A list item's indent is a fixed measure (\leftmargin), so it stays
        // put and the text column narrows around it. The item's label hangs a
        // fixed distance to the left of this offset, which is precisely why
        // the indent has to be applied – at x0=0 the label would sit at
        // negative x and be clipped away.
        const indentSp = para.indent || 0;
        const indentPx = indentSp * SP_TO_PX;
        // A paragraph's measure can be narrower than the column on the right
        // too: a quote environment sets \hsize = \textwidth - 2\leftmargin
        // and the serializer records that width with the left indent. The
        // right margin is what remains of the source width, and it is as
        // fixed a measure as the left one, so it narrows the text column the
        // same way. (At the source width, keeping only the left indent set
        // a 295pt quote at 320pt: a line TeX had to shrink came out at its
        // natural width, 22pt wider than in the PDF.)
        const rightSp  = (cache.sourceWidthSp > 0 && para.width > 0)
            ? Math.max(0, cache.sourceWidthSp - indentSp - para.width) : 0;
        const availSp  = Math.max(1, widthSp - indentSp - rightSp);
        const availPx  = columnPx - indentPx - rightSp * SP_TO_PX;

        // Pluggable breaker. A page may install an alternative paragraph
        // breaker as window.reflowtexBreak(nodes, availSp, params, helpers)
        // – e.g. a TeX engine's own line-breaking code compiled to WebAssembly.
        // It returns the same line objects kpBreak does ([{nodes, ratio,
        // fitness, leftProtrusion}]), or null to decline (module still
        // loading, unsupported paragraph), in which case the built-in
        // Knuth–Plass runs. Everything below is agnostic to which breaker ran.
        // A line flagged `exact: true` carries a TeX-exact glue ratio whose
        // stretch pool holds no glyph expandability, so the viewer's own
        // expansion is not applied on top of it; a line carrying `expand` (a
        // fraction: 0.012 = glyphs 1.2 % wider) was expanded by the breaker
        // itself, exactly that much. The helpers also hand over what TeX had
        // for microtypography – each font's protrusion/expansion codes and
        // the paragraph's \adjustspacing/\protrudechars – so an engine can
        // apply them as TeX did.
        const ext = typeof window !== 'undefined' && typeof window.reflowtexBreak === 'function'
            ? window.reflowtexBreak(para.nodes, availSp, p, {
                  gW, gH, gD, align,
                  bskip: para.baselineskip || 0,
                  lskip: para.lineskip || 0,
                  font: fid => fontInfo[String(fid)] || null,
                  adjustSpacing: para.adjust_spacing || 0,
                  protrudeChars: para.protrude_chars || 0,
              })
            : null;
        for (const ln of (ext || kpBreak(bcs, para.nodes, availSp, justify ? p : { ...p, ragged: true }))) {
            // For non-justified modes: allow glue shrink (ratio<0) but never stretch.
            // When the line must shrink, rendering and positioning are identical to justify.
            // The alignment offset only applies to lines whose natural width fits the column.
            const ratio = justify ? ln.ratio : Math.min(0, ln.ratio);
            const er    = ln.expand !== undefined ? ln.expand
                        : (p.useExpansion && !ln.exact) ? ratio * p.maxExpand : 0;
            const protX = -(p.useProtrusion ? ln.leftProtrusion * SP_TO_PX : 0);
            const natSp = sumWidthSp(ln.nodes);
            const natPx = natSp * SP_TO_PX;
            let x0, fillRatio = 0, fillOrder = 0;
            if (ratio < 0 || natPx > availPx) {
                // ratio<0 is not a reliable proxy for "too wide to fit" on its
                // own: kpBreak's ratio falls back to exactly 0 (not negative)
                // when a line is overfull but every glue order has zero
                // shrinkability to report a shrink ratio against – exactly
                // \begin{center}'s infinite-stretch, zero-shrink centring
                // glue. Left unguarded, the center/right branch below computes
                // a negative x0 for any centred figure wider than the column,
                // drawing it into negative SVG coordinates: still positioned
                // correctly relative to nothing, but visibly detached to the
                // left of the column instead of flush with its left edge.
                x0 = protX;  // squeezed to fit – same position as justified
            } else {
                switch (align) {
                    case 'right':  x0 = availPx - natPx; break;
                    case 'center': x0 = (availPx - natPx) / 2; break;
                    default:       x0 = protX; break;
                }
                // A line with an infinite fill and room to spare distributes the
                // slack into that fill (KP left it at ratio 0), flushing whatever
                // follows to the right margin. This is set-once at layout: the fill
                // stretch is a fixed measure, only the available width varies.
                const fi = fillInfo(ln.nodes);
                if (fi.order > 0 && fi.stretch > 0) {
                    // TeX packs the line with its left margin kern in it, so a
                    // protruding first character widens the slack by what it
                    // hangs into the margin – the line still ends at the measure.
                    // (Its right margin kern, when any, is a kern node in ln.nodes.)
                    const leftKernSp = p.useProtrusion ? (ln.leftProtrusion || 0) : 0;
                    const slackSp = availSp - (natSp - leftKernSp);
                    if (slackSp > 0) { fillRatio = slackSp / fi.stretch; fillOrder = fi.order; x0 = protX; }
                }
            }
            maxRightPx = Math.max(maxRightPx, x0 + indentPx + natPx);
            lines.push(ln);
            lrp.push({ ratio, er, x0: x0 + indentPx, fillRatio, fillOrder });
            meta.push(lineMeta);
        }
    }
    return { lines, lrp, meta, W: Math.ceil(maxRightPx),
             preDisplaySizeSp: preDisplaySizeSp(fontInfo, lines, lrp) };
}

// Where a box's ink ends, used only to size its horizontal scroll area.
// Placement comes exclusively from TeX's (possibly affine-evaluated) geometry;
// ink bounds must never feed back into centring or alignment.
function inkExtentOf(fontInfo, box) {
    let min = Infinity, max = -Infinity;
    // Transform-aware: under a rotation it is the box's *height* that spans x,
    // so the horizontal extent has to be taken from the mapped corners rather
    // than from the node's width. Hence the full box rather than just (x, w).
    let M = null;
    const stack = [];
    const note = (x, w, yTop, yBot) => {
        if (!M) {
            if (x < min) min = x;
            if (x + w > max) max = x + w;
            return;
        }
        const [a,b,c,d,e,f] = M;
        for (const [px, py] of [[x,yTop],[x+w,yTop],[x,yBot],[x+w,yBot]]) {
            const tx = a*px + c*py + e;
            if (tx < min) min = tx;
            if (tx > max) max = tx;
        }
    };
    renderNodes(fontInfo, {
        beginLine() {},
        beginTransform(n, tf) { stack.push(M); M = affineMul(M, affineOf(tf)); },
        endTransform()        { M = stack.pop(); },
        glyph(n, x, y) { note(x, gW(n) * SP_TO_PX, y - gH(n) * SP_TO_PX, y + gD(n) * SP_TO_PX); },
        space()        {},                    // inter-word glue is not ink
        rule(n, x, y, w, h) { note(x, w, y, y + h); },
        picture(n, x, y) { note(x, n.width * SP_TO_PX, y - n.height * SP_TO_PX, y + n.depth * SP_TO_PX); },
    }, [box], 0, 0, 0, 0, 0);
    return isFinite(min) ? { min, max } : { min: 0, max: 0 };
}

// Evaluate sparse affine geometry recovered from several increasingly wide
// LuaTeX compilations. This is deliberately oblivious to display type:
// equation, \[...\], align, gather, multline, and package-defined displays all
// arrive as the same recursively matched finished node tree.
const AFFINE_NODE_FIELDS = [
    'width', 'height', 'depth', 'stretch', 'shrink', 'kern', 'shift',
    'glue_set', 'surround', 'm_a', 'm_b', 'm_c', 'm_d',
];
const AFFINE_CHILD_LISTS = ['children', 'pre', 'post', 'replace'];
function affineDisplayNode(n, deltaSp) {
    let out = n, changed = false;
    const edit = () => { if (!changed) { out = { ...n }; changed = true; } };
    for (const field of AFFINE_NODE_FIELDS) {
        const rate = n[`${field}_rate`];
        if (rate !== undefined) {
            edit();
            out[field] = (n[field] || 0) + rate * deltaSp;
        }
    }
    for (const key of AFFINE_CHILD_LISTS) {
        if (!n[key]?.length) continue;
        const children = n[key].map(child => affineDisplayNode(child, deltaSp));
        if (children.some((child, i) => child !== n[key][i])) {
            edit(); out[key] = children;
        }
    }
    if (n.leader) {
        const leader = affineDisplayNode(n.leader, deltaSp);
        if (leader !== n.leader) { edit(); out.leader = leader; }
    }
    return out;
}

function affineDisplayItem(item, deltaSp) {
    const out = { ...item, box: affineDisplayNode(item.box, deltaSp) };
    for (const field of ['display_width', 'display_indent', 'display_shift']) {
        const rate = item[`${field}_rate`];
        if (rate !== undefined) out[field] = (item[field] || 0) + rate * deltaSp;
    }
    return out;
}

// Which of a display's affine gaps must keep a minimum, and which may close.
//
// The finished tree holds two kinds of horizontal space that shrink with the
// measure, and they are not the same thing. Space with ink on *both* sides is
// internal: it separates two pieces of the formula – the gap between an align's
// columns, or between the last column and its equation number – and closing it
// would run them together, so it stops at the configurable minimum. Space with
// ink on only one side is outer: the centring glue of an align row, the margin
// left of a short display. It belongs to the column, not to the formula, and
// may close completely. Squeezing it to nothing is exactly right – a display
// should be as narrow as its own ink before it starts to scroll.
//
// The test is geometric, not structural, so it holds for whatever tree TeX
// produced rather than for the environments we happened to think of: place the
// display with the renderer's own traversal, note where ink lands and where each
// floor-bearing gap lands, then ask whether ink falls on both sides of the gap.
// It reads only the compiled tree, so it is computed once per display and cached
// – the answer cannot change with the reader's width.
const displayGapKinds = new WeakMap();   // display item → Map(node → {field: isInternal})

function classifyDisplayGaps(fontInfo, item) {
    const cached = displayGapKinds.get(item);
    if (cached) return cached;
    const kinds = new Map();
    const gaps = [];
    let inkMin = Infinity, inkMax = -Infinity;
    const ink = (x, w) => {
        if (x < inkMin) inkMin = x;
        if (x + w > inkMax) inkMax = x + w;
    };
    renderNodes(fontInfo, {
        beginLine() {},
        // A gap's kind is about horizontal neighbours, and a transform's children
        // advance the pen untransformed (see renderNodes), so the plain pen
        // positions are the ones to compare. No matrix bookkeeping is needed.
        beginTransform() {}, endTransform() {},
        glyph(n, x)         { ink(x, gW(n) * SP_TO_PX); },
        space()             {},
        // Zero-width rules never reach this sink (renderNodes skips them), so a
        // strut – which is exactly that – correctly does not count as ink.
        rule(n, x, y, w)    { ink(x, w); },
        picture(n, x)       { ink(x, n.width * SP_TO_PX); },
        gap(n, field, x, w) { if (n[`${field}_floor`]) gaps.push({ n, field, x1: x, x2: x + w }); },
    }, [item.box], 0, 0, 0, 0, 0);

    // Ink that ends within a scaled point of a gap's edge abuts it. TeX's own
    // dimensions are integral scaled points, so anything finer is arithmetic
    // noise from accumulating two different sums to the same place – and an
    // equation number, whose box is pulled back onto its own right edge, lands
    // exactly there.
    const ABUT = SP_TO_PX;
    for (const g of gaps) {
        const internal = inkMin <= g.x1 + ABUT && inkMax >= g.x2 - ABUT;
        let fields = kinds.get(g.n);
        if (!fields) kinds.set(g.n, fields = {});
        fields[g.field] = internal;
    }
    displayGapKinds.set(item, kinds);
    return kinds;
}

// The narrowest measure this node's gaps may be evaluated at. Only nodes the
// classifier saw are considered, which is what keeps the floor to genuine gaps:
// a box's `width` also carries a rate, but a box is not space – it is however
// wide its contents came out – so it never fences off a measure of its own.
function affineFloorWidthNode(n, sourceWidthSp, floorSp, kinds) {
    let minimum = 0;
    const fields = kinds.get(n);
    if (fields) {
        for (const field of ['width', 'kern', 'surround']) {
            const rate = n[`${field}_rate`];
            if (fields[field] === undefined || !(rate > 0)) continue;
            const floor = fields[field] ? floorSp : 0;
            minimum = Math.max(minimum,
                sourceWidthSp + (floor - (n[field] || 0)) / rate);
        }
    }
    for (const key of AFFINE_CHILD_LISTS) {
        for (const child of n[key] || []) {
            minimum = Math.max(minimum, affineFloorWidthNode(child, sourceWidthSp, floorSp, kinds));
        }
    }
    if (n.leader) minimum = Math.max(minimum, affineFloorWidthNode(n.leader, sourceWidthSp, floorSp, kinds));
    return minimum;
}

function affineFloorWidthItem(fontInfo, item, sourceWidthSp, floorSp) {
    const kinds = classifyDisplayGaps(fontInfo, item);
    let minimum = affineFloorWidthNode(item.box, sourceWidthSp, floorSp, kinds);
    // display_shift places the whole display inside the column – centring for an
    // ordinary display, a fixed indent under fleqn. That is outer space by
    // construction: there is no ink on its far side to protect, so it closes to
    // zero and the display sits flush left before it starts to scroll.
    if (item.display_shift_floor && item.display_shift_rate > 0) {
        minimum = Math.max(minimum,
            sourceWidthSp - (item.display_shift || 0) / item.display_shift_rate);
    }
    // Never freeze *wider* than the measure the tree was compiled at. A gap that
    // was already below the minimum when TeX set it would otherwise ask for a
    // wider display than TeX itself produced; at the compiled width TeX's own
    // layout stands, whatever the minimum would prefer.
    return Math.min(minimum, sourceWidthSp);
}

// Lay a display segment out. The affine model updates the finished tree's
// geometry for the reader's width; placement is always the display_shift
// supplied by TeX – there is no ink-centering fallback. Every row of the segment
// is evaluated at the same measure, so an alignment's columns stay in step and
// the display freezes as one at the first gap to reach its floor.
// The makings of TeX's \predisplaysize for a display that would follow this
// segment's last line (TeX §1146): w, the line's shift plus the widths of
// everything up to and including its last piece of ink (a glyph, box, rule
// or leaders) – \maxdimen when glue set by the line's own ratio lies before
// that ink, so the end cannot be told, -\maxdimen for a line with no ink –
// and the quad of the line's last text font, the fallback for the 2em TeX
// adds (of the font current at the display, which the bundle records).
// Measured on the line as laid out here, so the choice TeX makes with it
// (displaySkipsFull) follows the reader's width.
function preDisplaySizeSp(fontInfo, lines, lrp) {
    const k = lines.length - 1;
    if (k < 0) return null;
    const ln = lines[k], L = lrp[k];
    const MAX = 1073741823;
    let x = L.x0, w = null, unknown = false, mathOn = false, font = null, anyFont = null;
    const found = () => { w = unknown ? MAX : x; };
    const walk = (ns, glueSet) => {
        for (let i = 0; i < ns.length; i++) {
            const n = ns[i];
            switch (n.type) {
                case 'glyph':
                    x += gW(n) * glyphExpandScale(fontInfo, n, L.er) * SP_TO_PX; found();
                    if (!mathOn) font = n.font;
                    anyFont = n.font; break;
                case 'hlist': case 'vlist': case 'picture':
                    x += (n.width ?? 0) * SP_TO_PX; found(); break;
                case 'rule':
                    x += (n.width === RUNNING_RULE ? 0 : (n.width ?? 0)) * SP_TO_PX; found(); break;
                case 'glue': {
                    let g = n.width;
                    const so = n.stretch_order || 0, sho = n.shrink_order || 0;
                    if (glueSet) {
                        if (L.ratio > 0 && !so && n.stretch) { g += L.ratio * n.stretch; unknown = true; }
                        else if (L.ratio < 0 && !sho && n.shrink) { g += L.ratio * n.shrink; unknown = true; }
                        else if (L.fillRatio > 0 && so === L.fillOrder && n.stretch) unknown = true;
                    }
                    x += g * SP_TO_PX;
                    if (n.leader) found();
                    break;
                }
                case 'kern':
                    x += n.kern * ((n.subtype || 0) === 0 ? kernExpandScale(fontInfo, ns[i-1], ns[i+1], L.er) : 1) * SP_TO_PX;
                    break;
                case 'math': x += (n.surround || 0) * SP_TO_PX; mathOn = n.subtype === 0; break;
                case 'disc': walk(n.replace || [], false); break;
            }
        }
    };
    walk(ln.nodes, true);
    const fi = fontInfo[String(font ?? anyFont)];
    return { w: w === null ? -MAX : w === MAX ? MAX : Math.round(w / SP_TO_PX), quad: (fi && fi.quad) || 0 };
}

// Whether TeX would set this display with the full display skips, redone at
// the reader's width: the full pair when the display's left edge (its shift,
// plus the kern LuaTeX puts before a numbered formula) is at or left of
// \predisplaysize, taken from the segment before when a set line stood
// directly before the display, and as TeX captured it otherwise (a display
// that opened its paragraph: -\maxdimen, or the indent box's end). An
// alignment is always set with the full pair. null when the bundle carries
// no skip data – the captured spacing then stands.
function displaySkipsFull(L, prev) {
    const rows = L.seg.rows;
    const item = rows && rows[0] && rows[0].item;
    if (!item || item.display_above === undefined || item.display_above === null) return null;
    // an alignment always gets the full pair (TeX §1206)
    if (item.box && item.box.subtype === HL_ALIGNMENT) return true;
    if (!item.box || item.box.subtype !== HL_EQUATION) return null;
    // At the width the document was set at, TeX's own choice stands: the
    // measure below follows TeX's to a fraction of a point, and a display
    // sitting within that of the threshold must not flip where the page is
    // meant to be the document.
    if (L.atSourceWidth && item.display_used_above != null) return item.display_used_above === item.display_above;
    const MAX = 1073741823;
    const captured = item.display_pre_size ?? 0;
    const pre = prev && prev.preDisplaySizeSp;
    let pds = captured;
    if (item.display_after_line && captured > -MAX && pre) {
        pds = Math.abs(pre.w) === MAX ? pre.w : pre.w + 2 * (item.display_quad || pre.quad);
    }
    const left = L.displayLeftSp ?? (item.display_shift || 0);
    return left <= pds;
}

// The change to the space above segment L (px) from redoing the skip choice:
// the display's own above skip, and the below skip of a display just before
// L. Records the display's choice on its layout for the segment after it.
function displaySkipAdjust(L, prev) {
    let delta = 0;
    if (L.seg.kind === 'display') {
        const full = displaySkipsFull(L, prev);
        L.displayFull = full;
        if (full !== null) {
            const it = L.seg.rows[0].item;
            delta += ((full ? it.display_above : it.display_above_short) - (it.display_used_above || 0)) * SP_TO_PX;
            // and the interline glue TeX set above the display, redone for
            // the line now above it and the display's height at this width
            const meta = it.display_baselineskip != null
                ? { bskip: it.display_baselineskip * SP_TO_PX, lskip: (it.display_lineskip || 0) * SP_TO_PX,
                    lskiplimit: (it.display_lineskiplimit || 0) * SP_TO_PX }
                : (prev && prev.firstMeta);
            // A display that opened an empty paragraph (display_after_line
            // false) had that paragraph's empty line above it, of depth 0,
            // not the last line of the text before.
            if (it.display_interline_above != null && prev && meta && L.firstAscent != null) {
                const depthAbove = it.display_after_line ? prev.lastDepth : 0;
                delta += texInterlineGlue(depthAbove, L.firstAscent, meta) - it.display_interline_above * SP_TO_PX;
            }
        }
    }
    if (prev && prev.seg.kind === 'display' && prev.displayFull !== null && prev.displayFull !== undefined) {
        const it = prev.seg.rows[prev.seg.rows.length - 1].item;
        // LaTeX's \addvspace below the display asks for at least display_after_min
        const floor = it.display_after_min || 0;
        const below = Math.max(prev.displayFull ? it.display_below : it.display_below_short, floor);
        delta += (below - Math.max(it.display_used_below || 0, floor)) * SP_TO_PX;
        if (it.display_interline_below != null && L.firstMeta && L.firstAscent != null) {
            delta += texInterlineGlue(prev.lastDepth, L.firstAscent, L.firstMeta) - it.display_interline_below * SP_TO_PX;
        }
    }
    return delta;
}

// A numbered equation, as LuaTeX packs it: [kern d][formula][kern][number],
// z wide, placed by TeX §1199 from the formula's natural width w and the
// number's e: when formula and number do not both fit (w + e + 1em > z) the
// formula is shrunk to z − e − 1em if its glue can give that much (a
// formula that cannot gets its number on a line of its own, which is not
// modelled: the captured tree stands); then the formula is centred in the
// measure (d = (z − w)/2) unless the number would overlap it – d < 2e –
// when it is centred in what is left of the number (d = (z − w − e)/2, or
// 0 for a formula opening with glue). Each branch is affine in z with the
// same slope, so the affine model carries whichever branch the source
// measure was on across the switches; redoing the rule from the evaluated
// widths puts the formula where TeX puts it at every measure.
function placeEquationNumber(item) {
    const b = item.box;
    if (!b || b.subtype !== HL_EQUATION || !b.children || b.children.length !== 4) return item;
    const [k0, f0, k1, num] = b.children;
    if (k0.type !== 'kern' || f0.type !== 'hlist' || k1.type !== 'kern' || num.type !== 'hlist' || num.subtype !== 7) return item;
    const z = item.display_width || 0, e = num.width || 0;
    if (!(z > 0) || !(e > 0)) return item;
    let f = f0, w = 0;
    const shrink = [0, 0, 0, 0];
    for (const n of f0.children || []) {
        w += nodeWidthSp(n);
        if (n.type === 'glue') shrink[n.shrink_order || 0] += n.shrink || 0;
    }
    const q = e + (item.display_quad || 0);       // TeX's math quad at text size
    if (w + q > z) {
        const order = shrink[3] ? 3 : shrink[2] ? 2 : shrink[1] ? 1 : 0;
        if (!(order > 0) && w - shrink[0] + q > z) return item;
        const target = z - q;
        f = { ...f0, width: target, glue_sign: 2, glue_order: order,
              glue_set: shrink[order] > 0 ? Math.min(order > 0 ? Infinity : 1, (w - target) / shrink[order]) : 0 };
        w = target;
    } else if (f0.glue_sign || Math.abs((f0.width || 0) - w) > 2) {
        f = { ...f0, width: w, glue_sign: 0, glue_order: 0, glue_set: 0 };
    }
    let d = Math.round((z - w) / 2);
    if (d < 2 * e) {
        d = Math.round((z - w - e) / 2);
        const first = f.children && f.children[0];
        if (first && first.type === 'glue') d = 0;
    }
    const children = [{ ...k0, kern: d }, f, { ...k1, kern: z - w - e - d }, num];
    return { ...item, box: { ...b, children } };
}

function layoutDisplaySegment(fontInfo, seg, widthPt, displayModel) {
    const targetSp = Math.round(widthPt * 65536);
    const floorSp = Math.max(0, displayModel.minSpacePt) * 65536;
    const minWidthSp = Math.max(0, ...seg.rows.map(r =>
        affineFloorWidthItem(fontInfo, r.item, displayModel.sourceWidthSp, floorSp)));
    const evaluatedSp = Math.max(targetSp, minWidthSp);
    seg = { ...seg, rows: seg.rows.map(r => ({
        ...r, item: placeEquationNumber(affineDisplayItem(r.item, evaluatedSp - displayModel.sourceWidthSp)),
    })) };
    const columnPx = widthPt * ZOOM;
    const rows = seg.rows.map(r => ({
        ...r,
        x0:  (r.item.display_shift || 0) * SP_TO_PX,
        ink: inkExtentOf(fontInfo, r.item.box),
    }));
    // The surface has to cover the measure the display was evaluated at *and*
    // whatever ink hangs past it, so a frozen display can be panned to its last
    // glyph rather than having it clipped by the scroll box.
    let right = Math.max(columnPx, evaluatedSp * SP_TO_PX);
    for (const r of rows) right = Math.max(right, r.x0 + r.ink.max);
    return {
        lines: rows.map(r => ({ nodes: [r.item.box], ratio: 0, fitness: 2, leftProtrusion: 0 })),
        lrp:   rows.map(r => ({ ratio: 0, er: 0, x0: r.x0 })),
        gaps:  rows.map(r => r.gap || null),
        W:     Math.ceil(right),
        // the display's left edge at this width, for displaySkipsFull: the
        // shift plus the kern LuaTeX opens a numbered formula's box with
        displayLeftSp: (rows[0].item.display_shift || 0)
            + ((c => c && c.type === 'kern' ? (c.kern || 0) : 0)((rows[0].item.box.children || [])[0])),
        atSourceWidth: Math.abs(evaluatedSp - displayModel.sourceWidthSp) < 32768,
    };
}

function updateDisplayOverflowCue(wrap) {
    const EPS = 1;
    wrap.classList.toggle('latex-overflow-left', wrap.scrollLeft > EPS);
    wrap.classList.toggle('latex-overflow-right',
        wrap.scrollLeft + wrap.clientWidth < wrap.scrollWidth - EPS);
}

// Size and position one segment's element for layout L: the <svg> surface, the
// scroll box a display that overflows the column needs, and the space above it,
// which depends on the previous segment's last depth. Returns what to mount.
// Shared by layoutDocument and materializeSegment; L may be a deferred layout
// (geometry from the height cache, no lines yet).
// ── Streams ───────────────────────────────────────────────────────────────────
// A stream is a separately typeset run of content (Document.streams): a
// footnote's body, or a block the author wrapped in the companion package's
// \begin{reflowtexstream}{kind}. Its content is an ordinary content stream
// over the block's shared paragraphs, so it is laid out by layoutDocument
// itself, recursively, into the segment's box – with its own cache, its own
// lazily painted segments, and streams of its own inside if it has them. The
// box is `<div class="latex-stream" data-kind="…">`; the kind decides how the
// page styles it and which behaviour, if any, it gets (STREAM_KINDS).
//
// Never cached at this level (the nested layout has its own cache) and never
// deferred: the box must exist and hold its content's height at once, and a
// hidden part (a collapsed body) is laid out but never painted, which is
// cheap. The width is the box's own inner width – so CSS padding on a kind
// narrows its measure – measured when the box is in the document; on the
// first, detached layout it falls back to the column and asks for one more
// pass (remeasureStreams).
function layoutStreamSegment(fontInfo, doc, s, seg, widthPt, p, cache) {
    if (!s.sub) {
        s.sub = { bcs: cache.bcs, dom: null, layout: null, stats: null,
                  streamState: cache.streamState };
    }
    // clientWidth includes the padding a kind's CSS may add; the measure is
    // what is left inside it.
    let innerPx = 0, frameTop = false, frameBottom = false;
    if (s.box.isConnected) {
        const cs = getComputedStyle(s.box);
        innerPx = s.box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        // A box whose CSS gives it padding or a border on a side is a frame
        // there (a boxed theorem, a note): TeX's interline glue does not
        // reach across a frame edge – the padding is the space there. A
        // bare stream (an accordion, a pane) stays part of the text.
        frameTop    = parseFloat(cs.paddingTop)    + parseFloat(cs.borderTopWidth)    > 0;
        frameBottom = parseFloat(cs.paddingBottom) + parseFloat(cs.borderBottomWidth) > 0;
    }
    let w = widthPt;
    if (innerPx > 0) w = innerPx / ZOOM;
    else cache.streamsUnmeasured = true;
    // A kind whose child streams are *alternatives* (an accordion's panes:
    // one shows at a time) has them laid out as if each alone stood here –
    // no spacing between them, since none ever follows another on screen.
    const hooks0 = api.streamKinds[seg.stream.kind] || STREAM_KINDS[seg.stream.kind];
    s.sub.alternatives = !!(hooks0 && hooks0.alternatives);
    const root = layoutDocument(fontInfo, { ...doc, content: seg.stream.content }, w, p, s.sub);
    if (root.parentNode !== s.box) s.box.replaceChildren(root);
    if (!s.mounted) {
        // The kind's behaviour gets the box once, after its first nested
        // layout, so whatever it looks for inside (its panes) exists.
        s.mounted = true;
        const kind = seg.stream.kind;
        const hooks = api.streamKinds[kind] || STREAM_KINDS[kind];
        if (hooks && hooks.mount) {
            let state = cache.streamState.get(seg.index);
            if (!state) { state = {}; cache.streamState.set(seg.index, state); }
            const attrs = Object.fromEntries((seg.stream.attrs || []).map(a => [a.key, a.value || '']));
            // paint(): after a behaviour reveals hidden content, draw it now
            // rather than on the IntersectionObserver's next report – so the
            // behaviour can, say, move focus into what it just showed.
            const sub = s.sub;
            const paint = () => paintVisibleNow(fontInfo, sub);
            // relayout(): lay the whole block out again at its current width,
            // for a behaviour that changed the width of its streams (putting
            // two side by side, say) without the block's own width changing.
            const relayout = () => {
                const el = s.box.closest('[data-nodelist-b64]');
                const d = el && blockData.get(el);
                if (!d) return;
                d.lastWidth = -1;
                reflowBlock(el);
            };
            try { hooks.mount(s.box, { kind, index: seg.index, stream: seg.stream, attrs, state, paint, relayout }); }
            catch (e) { console.error(`[latex-viewer] stream kind "${kind}" mount failed:`, e); }
        }
    }
    // What the neighbours need: the nested first line's ascent and leading
    // (for the interline glue above) and the last line's depth (for below).
    const laid = s.sub.layout.laid;
    const first = laid[0];
    let last = laid[laid.length - 1], alts = null;
    // The content's own edges, for CSS that sizes a frame around the ink
    // (the boxed-theorem padding: one x-height above the capitals of the
    // first line and below the last baseline). Written only on change.
    // A box that starts or ends with a display (or a box of its own) is
    // measured from that one's ink, not from a baseline: a fraction reaches far
    // below its baseline, and a rule meant for a line of text would pull the
    // frame onto it. Then the space is a plain x-height above or below.
    const textAt = L => L && L.seg && L.seg.kind === 'text';
    const fa = textAt(first) ? `${first.firstAscent}px` : 'var(--latex-cap-height, 0px)';
    const ld = textAt(last) ? `${last.lastDepth}px` : '0px';
    if (s.box.style.getPropertyValue('--latex-first-ascent') !== fa) s.box.style.setProperty('--latex-first-ascent', fa);
    if (s.box.style.getPropertyValue('--latex-last-depth') !== ld) s.box.style.setProperty('--latex-last-depth', ld);
    if (s.sub.alternatives) {
        // Each alternative's edges, so sizeSegment can give every one the
        // interline glue TeX would give it in this place. The first stands
        // for the group in the spacing computed at this level; the others
        // are offset from it (applyAlternativeOffsets).
        alts = laid.map((Lj, j) => ({ L: Lj, box: s.sub.dom.segs[j].box }))
                   .filter(a => a.L.seg.kind === 'stream');
        last = first;
    }
    return { seg, lines: [], H: root.offsetHeight, W: widthPt * ZOOM,
             firstAscent: first ? first.firstAscent : 0,
             lastDepth:   last  ? last.lastDepth    : 0,
             firstMeta:   first ? first.firstMeta   : null,
             alts, frameTop, frameBottom,
             gapBefore: seg.gapBefore || 0 };
}

// Built-in stream kinds. What a kind *looks* like is CSS on its selector; what
// it *does* is `mount(box, ctx)`, called once per box after its first nested
// layout. `ctx.state` is an object that outlives the box (a font re-render
// rebuilds the DOM), so a kind keeps anything it must remember there and
// restores it in mount. A page adds or overrides kinds before or after this
// script loads:
//
//     window.reflowtex = { streamKinds: { callout: { mount(box, ctx) { … } } } };
//
// A kind with no entry here is still rendered – as a plain box the page can
// style – it just has no behaviour.
// A small Lean 4 highlighter: comments, strings, numbers and keywords, as
// spans the page colours (--code-* custom properties if it has them).
const LEAN_KEYWORDS = new Set(('theorem lemma def example instance structure class inductive where by fun '
    + 'have show from at with match calc exact exacts intro intros induction cases rcases obtain simp simp_all '
    + 'rw rwa rfl apply refine use constructor omega norm_num linarith nlinarith ring ring_nf field_simp decide '
    + 'aesop sorry let in if then else do return namespace open section end variable noncomputable private '
    + 'protected theorem abbrev deriving universe mutual termination_by decreasing_by nat_cases positivity gcongr '
    + 'unfold subst specialize contradiction exfalso trivial assumption tauto push_neg by_contra by_cases').split(' '));
function highlightLean(code) {
    const esc = t => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const re = /(\/-[\s\S]*?-\/)|(--[^\n]*)|("(?:[^"\\]|\\.)*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_'.!?]*)/g;
    let out = '', last = 0, m;
    while ((m = re.exec(code))) {
        out += esc(code.slice(last, m.index));
        const [t] = m;
        if (m[1] || m[2]) out += `<span class="lean-com">${esc(t)}</span>`;
        else if (m[3]) out += `<span class="lean-str">${esc(t)}</span>`;
        else if (m[4]) out += `<span class="lean-num">${esc(t)}</span>`;
        else if (LEAN_KEYWORDS.has(t)) out += `<span class="lean-kw">${esc(t)}</span>`;
        else out += esc(t);
        last = re.lastIndex;
    }
    return out + esc(code.slice(last));
}

// The Proof and Lean switches of leanproof and leantheorem: independent, so
// either part, both (side by side from 44rem, else stacked) or neither shows.
// `box` carries the state classes, `host` gets the switch row (appended: see
// leanproof). Every change lays the block out again: the TeX part's width
// changes.
function leanSwitches(box, ctx, host, fallback) {
    if (!ctx.state.show) {
        const init = (ctx.attrs.show || fallback).toLowerCase();
        ctx.state.show = { proof: init === 'proof' || init === 'both', lean: init === 'lean' || init === 'both' };
    }
    const row = document.createElement('div');
    row.className = 'latex-lean-switches';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', 'Show the proof, its Lean code, or both');
    const buttons = {};
    const apply = () => {
        for (const k of ['proof', 'lean']) {
            box.classList.toggle('latex-show-' + k, ctx.state.show[k]);
            buttons[k].setAttribute('aria-pressed', String(ctx.state.show[k]));
        }
    };
    // The space TeX put after the widget is the space after the *proof* (with
    // a display's below-skip, if the proof ends in one). While the proof is
    // hidden the widget should be followed by the space that followed the
    // statement (leantheorem) or preceded the widget (leanproof), so its
    // bottom margin takes back the difference. The spacers are the layout's
    // own elements, read after each layout.
    const heightOf = el => (el && parseFloat(el.style.height)) || 0;
    const adjust = () => {
        box.style.marginBottom = '';
        if (ctx.state.show.proof) return;
        let after = box.nextElementSibling;
        while (after && after.classList.contains('latex-anchor')) after = after.nextElementSibling;
        const stmt = box.firstElementChild && box.firstElementChild.querySelector(':scope > .latex-stream[data-kind="leanstatement"]');
        const want = heightOf(stmt ? stmt.nextElementSibling : box.previousElementSibling);
        const d = want - heightOf(after);
        if (d < 0) box.style.marginBottom = `${d}px`;
    };
    for (const [k, label] of [['proof', 'Proof'], ['lean', 'Lean']]) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.addEventListener('click', () => {
            ctx.state.show[k] = !ctx.state.show[k];
            apply(); ctx.relayout(); ctx.paint(); adjust();
        });
        buttons[k] = b;
        row.appendChild(b);
    }
    host.appendChild(row);
    apply();
    requestAnimationFrame(adjust);                 // once the parent has placed its spacers
    window.addEventListener('resize', () => requestAnimationFrame(adjust), { passive: true });
}

const STREAM_KINDS = {
    // reflowtex.sty's leancode: Lean source carried as text (Stream.text),
    // shown as highlighted, selectable code under a small header naming the
    // declaration (linked when the author gave url=).
    leancode: {
        mount(box, ctx) {
            if (ctx.attrs.decl) {
                const head = document.createElement('div');
                head.className = 'latex-lean-head';
                const d = document.createElement(ctx.attrs.url ? 'a' : 'span');
                d.textContent = ctx.attrs.decl;
                if (ctx.attrs.url) { d.href = ctx.attrs.url; d.target = '_blank'; d.rel = 'noopener'; }
                head.appendChild(d);
                box.appendChild(head);
            }
            const pre = document.createElement('pre');
            const code = document.createElement('code');
            code.innerHTML = highlightLean(ctx.stream.text || '');
            pre.appendChild(code);
            box.appendChild(pre);
        },
    },
    // reflowtex.sty's leanproof: one frame (the proof's look) holding a TeX
    // part (leantex) and its Lean code (leancode), with Proof and Lean
    // switches on top (placed first by CSS order: the layout code takes a
    // stream box's first child for its content).
    leanproof: {
        mount(box, ctx) { leanSwitches(box, ctx, box, 'proof'); },
    },
    // reflowtex.sty's leantheorem: the statement (leanstatement), its proof
    // (leantex) and the code (leancode). The switches hang under the
    // theorem's frame, from its left edge, like tabs (under the statement
    // when theorems are not boxed); the proof and code open beneath them,
    // initially neither.
    leantheorem: {
        mount(box, ctx) {
            const root = box.firstElementChild;
            const stmt = root && root.querySelector(':scope > .latex-stream[data-kind="leanstatement"]');
            const thm = stmt && stmt.querySelector('.latex-stream[data-kind="theorem"]');
            leanSwitches(box, ctx, stmt || box, 'none');
            if (thm) {
                // In the theorem box's own colours, so a box with accent= or
                // background= of its own is matched too (the variables are
                // reset per stream, hence copied rather than inherited).
                const row = (stmt || box).lastElementChild;
                row.classList.add('latex-lean-hang');
                for (const v of ['--latex-box-accent', '--latex-box-background']) {
                    const val = thm.style.getPropertyValue(v);
                    if (val) row.style.setProperty(v, val);
                }
            }
        },
    },
    // reflowtex.sty's webhint: blurred (CSS) until the reader clicks it or
    // presses Enter/Space on it, and blurred again by the next click. Clicks
    // on a link inside, or that end a text selection, leave it as it is. The
    // state survives re-renders.
    hint: {
        mount(box, ctx) {
            const show = on => {
                ctx.state.revealed = on;
                box.classList.toggle('latex-revealed', on);
                box.setAttribute('aria-pressed', String(on));
                box.setAttribute('aria-label', on ? 'Hint, shown: press to hide' : 'Hint, hidden: press to reveal');
            };
            box.setAttribute('role', 'button');
            box.setAttribute('tabindex', '0');
            show(!!ctx.state.revealed);
            box.addEventListener('click', e => {
                if (e.target.closest && e.target.closest('[data-link]')) return;
                if (ctx.state.revealed && String(getSelection()).trim()) return;
                show(!ctx.state.revealed);
            });
            box.addEventListener('keydown', e => {
                if (e.target !== box || (e.key !== 'Enter' && e.key !== ' ')) return;
                e.preventDefault(); show(!ctx.state.revealed);
            });
        },
    },
    // One of several panes (reflowtex.sty's accordion): the child streams of
    // kind "pane", of which exactly one shows. The reader switches with
    // action links inside the panes – "pane:next", "pane:prev", "pane:first",
    // "pane:last", "pane:NAME" or "pane:NUMBER" (from 1). The hiding itself
    // is CSS (installStreamStyles); this keeps the current pane on the box as
    // data-pane and the pane's class latex-pane-active.
    accordion: {
        alternatives: true,          // panes replace one another (see layoutStreamSegment)
        mount(box, ctx) {
            const root = box.firstElementChild;
            const panes = root ? [...root.children].filter(e => e.matches('.latex-stream[data-kind="pane"]')) : [];
            if (!panes.length) return;
            const find = t => {
                if (t === 'first') return 0;
                if (t === 'last')  return panes.length - 1;
                if (t === 'next')  return Math.min(ctx.state.pane + 1, panes.length - 1);
                if (t === 'prev')  return Math.max(ctx.state.pane - 1, 0);
                const byName = panes.findIndex(p => p.dataset.name && p.dataset.name === t);
                if (byName >= 0) return byName;
                const n = parseInt(t, 10);
                return n >= 1 && n <= panes.length ? n - 1 : -1;
            };
            const show = i => {
                ctx.state.pane = i;
                panes.forEach((p, k) => p.classList.toggle('latex-pane-active', k === i));
                box.dataset.pane = panes[i].dataset.name || String(i + 1);
            };
            // What printing the page shows: the pane a PDF would (print=).
            const printAt = find(ctx.attrs.print || 'last');
            panes.forEach((p, k) => p.classList.toggle('latex-pane-print', k === printAt));
            if (ctx.state.pane === undefined) {
                const first = find(ctx.attrs.initial || '1');
                ctx.state.pane = first >= 0 ? first : 0;
            }
            show(ctx.state.pane);
            box.addEventListener('reflowtex:action', e => {
                const m = /^pane:(.+)$/.exec(e.detail.action);
                if (!m) return;                       // not ours: let it bubble on
                const i = find(m[1]);
                if (i < 0) return;
                e.stopPropagation();                  // an outer accordion must not act too
                // The tab stop is one glyph of the control's group, not
                // necessarily the one that sent the event: compare groups.
                const active = document.activeElement;
                // Only for keyboard focus: a mouse click focuses the glyph
                // too, and moving that would draw a focus ring nobody asked for.
                const hadFocus = !!(active && active.dataset && e.detail.source
                                    && active.dataset.link === e.detail.source.dataset.link
                                    && active.matches(':focus-visible'));
                show(i);
                ctx.paint();
                // Collapsing a long pane from its end would leave the reader
                // below the accordion; bring its top back into view.
                if (box.getBoundingClientRect().top < 0) box.scrollIntoView({ block: 'start' });
                // Keyboard: the control just pressed is now hidden, so move
                // focus to the first control of the pane now showing.
                if (hadFocus) {
                    const next = panes[i].querySelector('.latex-action[tabindex]');
                    if (next) next.focus({ preventScroll: true });
                }
            });
        },
    },
};

// The structural CSS the built-in kinds need (hidden or shown, a pointer, a
// disclosure marker). Appearance beyond that is the page's, on the same
// selectors; the marker glyphs are overridable through custom properties.
function installStreamStyles() {
    const st = document.createElement('style');
    // Built-in looks for reflowtex.sty's note, hint and boxed theorems. Each
    // colour is a custom property a page (or a theme class) can set; the
    // tints are mixed with transparent, so they sit on any page background.
    // Boxes keep their padding small: a nested box (a claim in a proof) is
    // narrower by exactly that much per level.
    st.textContent = `
      /* Frames (note, hint, theorem, proof) grow outward: a top-level one
         reaches into the margin by its padding and border
         (--latex-outset-l/-r), so its text keeps the column's full measure
         and lines up with the text around it. Inside another frame a box
         stays within it, a little narrower per level. The outsets do not
         inherit, so a stream inside a frame (a pane, say) has none.
         A page's own framed kind can set the same two variables. */
      :where(.latex-stream) { --latex-outset-l: initial; --latex-outset-r: initial; }
      .latex-stream {
        margin-left: calc(-1 * var(--latex-outset-l, 0px));
        margin-right: calc(-1 * var(--latex-outset-r, 0px)); }
      :is(.latex-stream[data-kind="theorem"], .latex-stream[data-kind="proof"],
          .latex-stream[data-kind="note"], .latex-stream[data-kind="hint"],
          .latex-stream[data-kind="leancode"]) .latex-stream {
        margin-left: 0; margin-right: 0; }
      .latex-stream[data-kind="note"] {
        --latex-outset-l: calc(1rem + 3px); --latex-outset-r: 1rem;
        padding: .6rem 1rem;
        border-left: 3px solid var(--latex-note-accent, #2f6fb3);
        background: color-mix(in srgb, var(--latex-note-accent, #2f6fb3) 8%, transparent); }
      .latex-stream[data-kind="hint"] {
        --latex-outset-l: 1rem; --latex-outset-r: 1rem;
        padding: .6rem 1rem; cursor: pointer;
        background: color-mix(in srgb, currentColor 5%, transparent);
        filter: blur(5px); transition: filter .2s; }
      .latex-stream[data-kind="hint"].latex-revealed { filter: none; }
      .latex-stream[data-kind="hint"]:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
      /* Vertical padding from the content's own edges: --latex-box-space
         (default one x-height of 10pt Latin Modern, 4.31pt) between the box
         and the top of a capital on the first line (cap height 6.83pt), and
         the same between the last baseline and the box. The viewer sets
         --latex-first-ascent / --latex-last-depth on every stream box. */
      :root { --latex-pt: ${ZOOM}px; }
      /* A box's colours are its own: do not inherit an enclosing box's
         (zero specificity, so a page's rule or the box's own inline value wins). */
      :where(.latex-stream) { --latex-box-accent: initial; --latex-box-background: initial; }
      .latex-stream[data-kind="theorem"], .latex-stream[data-kind="proof"] {
        --latex-outset-l: calc(.85rem + 3px); --latex-outset-r: .7rem;
        --latex-box-space: calc(4.31 * var(--latex-pt));
        --latex-cap-height: calc(6.83 * var(--latex-pt));
        padding: max(2px, calc(var(--latex-box-space) + var(--latex-cap-height) - var(--latex-first-ascent, 0px))) .7rem
                 max(2px, calc(var(--latex-box-space) - var(--latex-last-depth, 0px))) .85rem;
        /* --latex-box-accent / --latex-box-background: set per box (\makeboxed
           accent=, background=) or by a page; else the kind's defaults – a
           page may give theorems a background of their own
           (--latex-theorem-background), else a tint of their accent. */
        border-left: 3px solid var(--latex-box-accent, var(--latex-theorem-accent, #2f6fb3));
        background: var(--latex-box-background, var(--latex-theorem-background,
          color-mix(in srgb, var(--latex-theorem-accent, #2f6fb3) 7%, transparent))); }
      /* A box with an accent of its own and no background: a tint of that accent. */
      .latex-stream[data-kind="theorem"][style*="--latex-box-accent"] {
        background: var(--latex-box-background,
          color-mix(in srgb, var(--latex-box-accent) 7%, transparent)); }
      .latex-stream[data-kind="proof"] {
        border-left-color: var(--latex-box-accent, var(--latex-proof-accent, #8a8f98));
        background: var(--latex-box-background,
          color-mix(in srgb, var(--latex-box-accent, var(--latex-proof-accent, #8a8f98)) 6%, transparent)); }
      @media print {
        .latex-stream[data-kind="hint"] { filter: none; }
      }
      .latex-stream[data-kind="accordion"] > div > .latex-stream[data-kind="pane"]:not(.latex-pane-active) {
        display: none; }
      /* Lean beside a proof. leanproof: one frame (the proof's look), its
         switches on top, the proof box inside giving up its own frame.
         leantheorem: the switches in the theorem's frame, the proof (in its
         usual box) and the code beneath. The code has no background: just
         space from the proof. */
      .latex-stream[data-kind="leanproof"] { display: flex; flex-direction: column; container-type: inline-size; }
      .latex-stream[data-kind="leanproof"] > .latex-lean-switches { order: -1; margin-bottom: .6rem; }
      .latex-stream[data-kind="leanproof"]:not(.latex-show-proof):not(.latex-show-lean) > .latex-lean-switches { margin-bottom: 0; }
      .latex-stream[data-kind="leantheorem"] { container-type: inline-size; }
      .latex-stream[data-kind="leantheorem"] .latex-lean-switches { justify-content: flex-start; margin-top: .4rem; }
      /* Hanging from a boxed theorem: flush with the frame's bottom, starting
         where its text ("Theorem") starts, in the box's own colours (set by
         the script from the box). Only the label is dimmed, never the fill. */
      .latex-stream[data-kind="leantheorem"] .latex-lean-switches.latex-lean-hang {
        margin: 0; gap: 2px;
        --lt-accent: var(--latex-box-accent, var(--latex-theorem-accent, #2f6fb3));
        --lt-bg: var(--latex-box-background, var(--latex-theorem-background,
          color-mix(in srgb, var(--lt-accent) 7%, transparent))); }
      .latex-stream[data-kind="leantheorem"] .latex-lean-switches.latex-lean-hang[style*="--latex-box-accent"] {
        --lt-bg: var(--latex-box-background, color-mix(in srgb, var(--lt-accent) 7%, transparent)); }
      /* Borderless in every state, so nothing but colour changes on hover. */
      .latex-lean-switches.latex-lean-hang button,
      .latex-lean-switches.latex-lean-hang button:hover {
        border: 0; opacity: 1; color: color-mix(in srgb, currentColor 72%, transparent);
        background: linear-gradient(color-mix(in srgb, var(--lt-accent) 7%, transparent) 0 0), var(--lt-bg); }
      .latex-lean-switches.latex-lean-hang button:hover { color: inherit; }
      .latex-lean-switches.latex-lean-hang button[aria-pressed="true"] {
        color: inherit; background: linear-gradient(color-mix(in srgb, var(--lt-accent) 20%, transparent) 0 0), var(--lt-bg); }
      .latex-lean-switches { display: flex; gap: .3rem; }
      .latex-lean-switches button {
        font: 500 .72rem/1 ui-sans-serif, system-ui, sans-serif; letter-spacing: .02em; color: inherit;
        padding: .34rem .7rem; border-radius: 0; cursor: pointer; opacity: .75;
        background: none; border: 1px solid color-mix(in srgb, currentColor 24%, transparent); }
      .latex-lean-switches button:hover { opacity: 1; }
      .latex-lean-switches button[aria-pressed="true"] {
        opacity: 1; border-color: transparent; background: color-mix(in srgb, currentColor 13%, transparent); }
      .latex-lean-switches button:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
      :is(.latex-stream[data-kind="leanproof"], .latex-stream[data-kind="leantheorem"]) > div:first-child {
        display: grid; grid-template-columns: minmax(0, 1fr); gap: 1rem 2rem; align-items: start; }
      :is(.latex-stream[data-kind="leanproof"], .latex-stream[data-kind="leantheorem"]) > div:first-child > :not(.latex-stream) { display: none; }
      .latex-stream[data-kind="leantheorem"] > div:first-child > .latex-stream[data-kind="leanstatement"] { grid-column: 1 / -1; }
      :is(.latex-stream[data-kind="leanproof"], .latex-stream[data-kind="leantheorem"]):not(.latex-show-proof) > div:first-child > .latex-stream[data-kind="leantex"],
      :is(.latex-stream[data-kind="leanproof"], .latex-stream[data-kind="leantheorem"]):not(.latex-show-lean) > div:first-child > .latex-stream[data-kind="leancode"] { display: none; }
      @container (min-width: 44rem) {
        :is(.latex-stream[data-kind="leanproof"], .latex-stream[data-kind="leantheorem"]).latex-show-proof.latex-show-lean > div:first-child {
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); column-gap: 3.2rem; } }
      /* The code's frame: the proof's, in the Lean colour (--latex-lean-accent). */
      .latex-stream[data-kind="leancode"] {
        --latex-outset-l: calc(.85rem + 3px); --latex-outset-r: .7rem;
        padding: .6rem .7rem .7rem .85rem;
        border-left: 3px solid var(--latex-lean-accent, #2e8b7a);
        background: color-mix(in srgb, var(--latex-lean-accent, #2e8b7a) 7%, transparent); }
      .latex-lean-head { padding: 0 0 .35rem; opacity: .65; font: .72rem ui-monospace, "SF Mono", Menlo, monospace; }
      .latex-lean-head a { color: inherit; }
      .latex-stream[data-kind="leancode"] pre {
        margin: 0; padding: 0; border: 0; border-radius: 0; background: none; overflow-x: auto;
        font: .8rem/1.55 ui-monospace, "SF Mono", Menlo, "DejaVu Sans Mono", monospace; white-space: pre; }
      .latex-stream[data-kind="leancode"] pre code { font: inherit; }
      .lean-kw  { color: var(--code-kw, #1f5fa8); }
      .lean-com { color: var(--code-com, #7b7f86); font-style: italic; }
      .lean-str { color: var(--code-str, #2a7a3b); }
      .lean-num { color: var(--code-num, #a0522d); }
      @media print {
        .latex-lean-switches { display: none; }
        :is(.latex-stream[data-kind="leanproof"], .latex-stream[data-kind="leantheorem"]) > div:first-child > .latex-stream { display: block !important; }
      }
      @media print {
        .latex-stream[data-kind="accordion"] > div > .latex-stream[data-kind="pane"] { display: none; }
        .latex-stream[data-kind="accordion"] > div > .latex-stream[data-kind="pane"].latex-pane-print {
          display: block; }
        /* Controls do nothing on paper. More specific than the page's
           .latex-block svg .latex-link colour rule, which is also !important. */
        .latex-block svg .latex-link.latex-action { fill: transparent !important; }
      }
    `;
    document.head.appendChild(st);
}

// Text and stream segments join with TeX's interline glue (a stream's outer
// edges are its first and last lines); a display keeps its captured spacing.
const isTextLike = kind => kind === 'text' || kind === 'stream';

const onLayoutGrid = px => Math.round(px * 64) / 64;

// A group of alternatives (L.alts, see layoutStreamSegment) is spaced at this
// level by its first member. Each other member, when it is the one showing,
// must sit where TeX would have put *it*: its first line's interline glue
// from the line above the group, its last line's to the line below. Applied
// as margins on the member's own box, relative to the first member's glue.
function applyAlternativeOffsets(prev, L) {
    if (L.alts) {                                        // above the group
        const ref = L.alts[0].L;
        for (const a of L.alts) {
            let d = 0;
            if (prev && isTextLike(prev.seg.kind) && a.L.firstMeta && ref.firstMeta) {
                d = texInterlineGlue(prev.lastDepth, a.L.firstAscent, a.L.firstMeta)
                  - texInterlineGlue(prev.lastDepth, ref.firstAscent, ref.firstMeta);
            }
            setStyle(a.box, 'marginTop', d ? `${d}px` : '');
        }
    }
    if (prev && prev.alts) {                             // below the group
        const ref = prev.alts[0].L;
        for (const a of prev.alts) {
            let d = 0;
            if (isTextLike(L.seg.kind) && L.firstMeta) {
                d = texInterlineGlue(a.L.lastDepth, L.firstAscent, L.firstMeta)
                  - texInterlineGlue(ref.lastDepth, L.firstAscent, L.firstMeta);
            }
            setStyle(a.box, 'marginBottom', d ? `${d}px` : '');
        }
    }
}

function sizeSegment(s, L, prev, columnPx, p) {
    applyAlternativeOffsets(prev, L);
    if (L.seg.kind === 'stream') {
        // The box already holds the nested layout, which sized itself. Only
        // the spacer above is this level's: the explicit gap plus, after
        // text, the interline glue the first nested line would have had.
        let margin = L.gapBefore || 0;
        // Across a frame edge the author's explicit space replaces TeX's
        // interline glue; where there is none, the glue stays, so a frame
        // never touches its neighbour.
        const framed = L.frameTop || prev?.frameBottom;
        if (prev && isTextLike(prev.seg.kind) && L.firstMeta && !(framed && L.gapBefore)) {
            margin += texInterlineGlue(prev.lastDepth, L.firstAscent, L.firstMeta);
        }
        margin += displaySkipAdjust(L, prev);
        setStyle(s.gap, 'height', `${onLayoutGrid(margin)}px`);
        return { mount: s.box.firstElementChild, overflows: false };
    }
    // Do not create a scrollbar for scaled-point rounding or a tiny italic
    // overhang. A bare SVG uses the column as its viewport and overflow:
    // visible lets that ink bleed naturally without scaling the display.
    const tolerancePx = Math.max(0, p.displayOverflowTolerancePx || 0);
    // A figure paragraph (isFigureParagraph) is exactly one unbreakable,
    // unshrinkable picture box, so it can overflow the column precisely the
    // way a display can – and gets the same scroll-box treatment.
    const scrollable = L.seg.kind === 'display' || L.seg.isFigure;
    const overflows = scrollable && L.W > columnPx + tolerancePx;
    // columnPx unless genuinely overflowing: an ordinary (non-scrollable)
    // text segment's own L.W is now real ink width (see layoutTextSegment),
    // not always exactly columnPx – a paragraph with, say, one line 0.3px
    // narrower than another must still get the *same* surface as every
    // other non-overflowing segment, or adjacent paragraphs visibly render
    // at slightly different widths.
    const surfaceW = overflows ? L.W : columnPx;
    // Heights go on the browser's layout grid (1/64 px in Blink and WebKit)
    // rounded to nearest: laid out as given, a fractional height is floored
    // to the grid, and over hundreds of stacked segments those floors add up
    // to a drift of a few points against TeX's own galley.
    const H = onLayoutGrid(L.H);
    s.svg.setAttribute('width', surfaceW);
    s.svg.setAttribute('height', H);
    s.svg.setAttribute('viewBox', `0 0 ${surfaceW} ${H}`);

    // Only a display that genuinely overflows gets a scroll box, because a
    // scroll box is also a *clipping* box: CSS forces overflow-y to 'auto'
    // once overflow-x is set, and there is no way to scroll one axis while
    // letting the other bleed. Ink that legitimately hangs outside its box
    // – accents, protrusion, delimiter overshoot – would be cut off. So a
    // display that fits is mounted bare and can bleed freely; only one that
    // must pan pays for it, and its wrapper gets a little self-cancelling
    // headroom for the bleed (see the margin block below).
    let mount = s.svg;
    if (overflows) {
        if (!s.wrap) {
            s.wrap = document.createElement('div');
            s.wrap.addEventListener('scroll', () => updateDisplayOverflowCue(s.wrap),
                                    { passive: true });
        }
        // It genuinely exceeds the column, so show a right cue immediately.
        // Later paint/scroll measurements refine both directional classes.
        s.wrap.classList.add('latex-display', 'latex-overflow-right');
        if (s.svg.parentNode !== s.wrap) s.wrap.replaceChildren(s.svg);
        mount = s.wrap;
    } else if (s.wrap && s.svg.parentNode === s.wrap) {
        s.wrap.classList.remove('latex-overflow-left', 'latex-overflow-right');
        s.svg.remove();          // no longer overflowing: shed the scroll box
    }
    // Between two text segments TeX inserts interline (baselineskip) glue on
    // top of any explicit \vspace, exactly as it does between the lines of a
    // paragraph. Reproduce it so a heading sits the LaTeX distance above its
    // body – and independently of the heading's descender depth, since the
    // glue absorbs that. Displays keep their own captured spacing.
    let margin = L.gapBefore || 0;
    if (prev && L.seg.kind === 'text' && isTextLike(prev.seg.kind) && L.firstMeta
        && !(prev.frameBottom && L.gapBefore)) {           // see the stream branch above
        margin += texInterlineGlue(prev.lastDepth, L.firstAscent, L.firstMeta);
    }
    // The space above the segment lives in its spacer, not in a margin on the
    // element itself (scroll anchoring again, see layoutDocument).
    margin += displaySkipAdjust(L, prev);
    setStyle(s.gap, 'height', `${onLayoutGrid(margin)}px`);
    setStyle(s.svg, 'marginTop', '');
    if (s.wrap) { setStyle(s.wrap, 'marginTop', ''); setStyle(s.wrap, 'marginBottom', ''); }
    if (mount === s.wrap) {
        // A scroll box clips (overflow-x forces overflow-y), so give the ink
        // a little vertical headroom – but reserve no space for it: negative
        // margins take the padding straight back (the space above the display
        // itself is in the spacer), so a wrapped display occupies exactly the
        // vertical band the bare SVG would, and a small
        // overshoot (accents, delimiter overshoot) overlaps the adjacent
        // glue the same way it does in print. Fixed rather than measured:
        // getBBox on SVG text reports the font's ascent/descent box, not
        // glyph ink, and the converted CM faces carry ascents far beyond any
        // outline – padding by that phantom measure visibly inflated the
        // space around every scrollable display.
        const BLEED_PAD = 6;
        setStyle(mount, 'paddingTop', `${BLEED_PAD}px`);
        setStyle(mount, 'paddingBottom', `${BLEED_PAD}px`);
        setStyle(mount, 'marginTop', `${-BLEED_PAD}px`);
        setStyle(mount, 'marginBottom', `${-BLEED_PAD}px`);
        setStyle(mount, 'overflowAnchor', 'none');
    } else {
        setStyle(mount, 'marginTop', '');
    }
    // Scroll destinations for the labels this segment owns. Their own
    // element rather than an id on the segment: a segment can own several
    // labels, and an element has only one id. Zero height, so it takes part
    // in nothing – scroll-margin-top is left to the page, which is the only
    // thing that knows whether it has a sticky header.
    return { mount, overflows };
}

function layoutDocument(fontInfo, doc, widthPt, p, cache) {
    // Point the glyph-metrics reader at this document's table, and stash it on the
    // cache so paintDocument (which is handed only the cache) reads the same one.
    // fontInfo is stashed too, so the IntersectionObserver – which is handed only a
    // segment reference – can repaint it (see observeSegments / segIO).
    useGlyphMetrics(doc.glyph_metrics);
    cache.metrics = doc.glyph_metrics;
    cache.sourceWidthSp = doc.source_width || 0;   // the \hsize the paragraphs' widths refer to
    cache.fontInfo = fontInfo;
    const columnPx = widthPt * ZOOM;
    const displayModel = {
        sourceWidthSp: doc.source_width || 0,
        minSpacePt: p.displayMinSpacePt,
    };
    // paintSegment is handed only the cache, so the reference tables and this
    // block's id prefix travel on it.
    cache.links   = doc.links   || [];
    cache.anchors = doc.anchors || [];
    cache.streams = doc.streams || [];
    // Per-stream state a kind's behaviour keeps (an accordion's pane), keyed
    // by stream index. Lives on the top-level cache and is shared down into
    // the nested ones, so it survives a rebuild of the DOM (rerenderBlock).
    cache.streamState = cache.streamState || new Map();
    cache.blockKey = cache.blockKey || `b${++blockSeq}`;
    const minGapPx = p.minGapPt * ZOOM;
    const padPx    = p.padPt    * ZOOM;

    // Break candidates depend only on the node list, never on width or params,
    // so they are cached per paragraph across every reflow.
    cache.bcs = cache.bcs || new Map();
    const segs = segmentsOf(doc);

    if (!cache.dom) {
        const root = document.createElement('div');
        cache.dom = { root, segs: [], byNode: new Map(), live: new Set(),
                      anchors: new Map() };
    }
    const dom = cache.dom;
    dom.root.style.visibility = '';   // may have been hidden while paint was deferred

    const layoutOne = (seg, i) => {
        const geom = seg.kind === 'display'
            ? layoutDisplaySegment(fontInfo, seg, widthPt, displayModel)
            : layoutTextSegment(fontInfo, seg, widthPt, p, cache);

        // Profiles use actual render coords so collision detection matches real ink positions.
        const profiles = geom.lines.map((ln, j) =>
            lineProfile(fontInfo, ln.nodes, geom.lrp[j].x0, geom.lrp[j].ratio, geom.lrp[j].er)
        );
        const ascent     = (profiles[0] ?? []).reduce((m, it) => Math.max(m, it.h), 0);
        const baselineYs = [ascent];
        for (let j = 1; j < geom.lines.length; j++) {
            const gap = geom.gaps && geom.gaps[j];
            let advance;
            if (gap) {
                // TeX's own spacing between the rows of an alignment. Measured
                // baseline-to-baseline it must clear the previous depth and
                // this row's ascent.
                const prevDepth = profiles[j-1].reduce((m, it) => Math.max(m, it.d), 0);
                const rowAscent = profiles[j].reduce((m, it) => Math.max(m, it.h), 0);
                advance = prevDepth + gap + rowAscent;
            } else {
                const prevDepth = profiles[j-1].reduce((m, it) => Math.max(m, it.d), 0);
                const thisAsc   = profiles[j].reduce((m, it) => Math.max(m, it.h), 0);
                const lm = geom.meta && geom.meta[j];
                if (lm) {
                    // Land the line at exactly the LaTeX baseline-to-baseline.
                    advance = texInterlineAdvance(prevDepth, thisAsc, lm);
                } else {
                    // No captured metrics (older data): adaptive collision leading.
                    const needed = minRequiredAdvance(profiles[j-1], profiles[j]);
                    advance = needed > minGapPx ? needed + padPx : minGapPx;
                }
            }
            baselineYs.push(baselineYs[j-1] + advance);
        }
        const firstAscent = ascent;
        const lastDepth = (profiles[profiles.length-1] ?? []).reduce((m, it) => Math.max(m, it.d), 0);
        const H = baselineYs[baselineYs.length-1] + lastDepth;

        // A segment's box spans its first ascent to its last depth, so stacking
        // segments with margin-top = gap reproduces exactly the baseline-to-
        // baseline advance TeX asked for. firstMeta carries this segment's leading
        // parameters so a text→text join can add TeX's interline glue (see below).
        return { ...geom, seg, profiles, baselineYs, H, firstAscent, lastDepth,
                 firstMeta: (geom.meta && geom.meta[0]) || null, gapBefore: seg.gapBefore || 0 };
    };

    // ── Layout cache ──────────────────────────────────────────────────────────
    // A reflow used to re-break every paragraph, though only the segments near
    // the viewport are ever painted at the new width; the rest were laid out for
    // one number, their height, which sets the block's height and the page's
    // scroll geometry. Now each segment remembers, per width, the geometry its
    // neighbours need (height, first ascent, last depth, surface width), and the
    // full layout for the last few widths. A segment's height is taken to be
    // monotone in the width – the same height at two widths means the same
    // height everywhere between them – so once two observed widths agree, every
    // width in that interval is answered from the cache. A segment that is not
    // near the viewport and whose geometry is cached is then not laid out at all:
    // its layout is *deferred*, and materializeSegment runs it the moment
    // something needs its lines (a paint, once it scrolls into view). Should the
    // real height differ from the cached one, the page adjusts then and the
    // observation is corrected, so the assumption only ever costs a shift, never
    // a wrong render. Segments near the viewport are always laid out for real.
    // The per-segment elements persist across renders; only contents reconcile.
    while (dom.segs.length < segs.length) {
        const seg = segs[dom.segs.length];
        if (seg.kind === 'stream') {
            // The box is what the page styles and scripts by kind, and holds
            // the nested layout (layoutStreamSegment) rather than an <svg>.
            // Class and kind are set once, here: the box's style must never
            // change afterwards (scroll anchoring, below).
            const box = document.createElement('div');
            box.className = 'latex-stream';
            box.dataset.kind = seg.stream.kind || '';
            // The author's parameters (\begin{reflowtexstream}[key=value]),
            // for CSS and the kind's behaviour alike.
            // Two keys are special: class adds CSS classes, and a key
            // starting with -- sets that CSS custom property on the box
            // (reflowtex.sty's \makeboxed accent= and background=).
            for (const a of seg.stream.attrs || []) {
                if (!a.key || !/^[a-z0-9-]+$/.test(a.key)) continue;
                if (a.key === 'class') box.classList.add(...(a.value || '').split(/\s+/).filter(Boolean));
                else if (a.key.startsWith('--')) box.style.setProperty(a.key, a.value || '');
                else box.setAttribute('data-' + a.key, a.value || '');
            }
            const gap = document.createElement('div');
            gap.style.cssText = 'height:0px;overflow-anchor:none';
            dom.segs.push({ svg: null, box, gap, wrap: null, pairs: [], sub: null });
            continue;
        }
        // xmlns:xlink is declared so a picture's `<use xlink:href=…>` (dvisvgm
        // emits the xlink form) resolves once its markup is injected via innerHTML.
        const svg = svgEl('svg', { xmlns:'http://www.w3.org/2000/svg', 'xmlns:xlink':'http://www.w3.org/1999/xlink' });
        // Block CSS cascade from prose containers; SVG text uses explicit per-glyph font families.
        // overflow-anchor:none keeps the browser's scroll anchor off the <svg>: its
        // height attribute changes on every reflow, and a change to the anchor
        // node's own computed height is a suppression trigger (see the mounting
        // notes below). The anchor lands on `box` instead, whose style never changes.
        svg.style.cssText = 'display:block;overflow:visible;font-weight:normal;font-style:normal;overflow-anchor:none';
        const box = document.createElement('div');
        box.appendChild(svg);
        const gap = document.createElement('div');
        gap.style.cssText = 'height:0px;overflow-anchor:none';
        dom.segs.push({ svg, box, gap, wrap: null, pairs: [] });
    }

    const paramsKey = JSON.stringify(p);
    cache.layoutCtx = { layoutOne, segs, widthPt, p, columnPx, paramsKey };
    const stats = cache.layoutStats = { computed: 0, reused: 0, deferred: 0, materialized: 0 };
    const laid = segs.map((seg, i) => {
        const s = dom.segs[i];
        if (seg.kind === 'stream') {
            stats.computed++;
            return layoutStreamSegment(fontInfo, doc, s, seg, widthPt, p, cache);
        }
        const hc = segLayoutCache(s, paramsKey);
        const exact = hc.exact.get(widthPt);
        if (exact) { stats.reused++; return { ...exact, seg }; }
        if (!s.intersecting) {
            const g = cachedGeometry(hc, widthPt);
            if (g) {
                stats.deferred++;
                return { seg, deferred: true, lines: [], H: g.H, W: g.W, firstAscent: g.firstAscent,
                         lastDepth: g.lastDepth, firstMeta: g.firstMeta, gapBefore: seg.gapBefore || 0,
                         preDisplaySizeSp: g.preDisplaySizeSp, displayLeftSp: g.displayLeftSp, atSourceWidth: g.atSourceWidth };
            }
        }
        const L = layoutOne(seg, i);
        rememberLayout(hc, widthPt, L);
        stats.computed++;
        return L;
    });

    // ── Mounting, and the browser's scroll anchoring ──────────────────────
    // When a window resize reflows a page, the browser keeps the content at the
    // top of the viewport in place (CSS scroll anchoring): it picks the deepest
    // element partially visible there and, after layout, scrolls so that
    // element's top edge has not moved. It gives up the moment the anchor
    // element is removed from the DOM, or its own computed margin, padding or
    // (in practice) size changes. A reflow here changes every segment's height
    // and spacing, so the DOM is arranged to keep the anchor on something whose
    // style is constant: each segment is a spacer (its height carries the
    // spacing, replacing a margin) followed by a plain `box` holding the <svg>
    // (or the scroll wrapper of an overflowing display). Spacer, <svg> and
    // wrapper are excluded from anchor selection with overflow-anchor:none, so
    // the box – content-sized, never restyled – is what the browser holds on
    // to; the height changes it must compensate for are then all on siblings
    // above it, which is exactly the case anchoring handles. The child list is
    // reconciled in place rather than rebuilt, so nothing is detached.
    const want = [];
    laid.forEach((L, i) => {
        const s = dom.segs[i];
        const { mount, overflows } = sizeSegment(s, L, cache.alternatives ? null : laid[i-1], columnPx, p);
        if (cache.alternatives) setStyle(s.gap, 'height', '0px');
        s.mount = mount;
        for (const id of L.seg.anchors || []) {
            const label = cache.anchors[id - 1];
            if (!label) continue;
            let a = dom.anchors.get(label);
            if (!a) {
                a = document.createElement('div');
                a.className = 'latex-anchor';
                a.id = label;
                dom.anchors.set(label, a);
                linkTargets.set(label, a);
            }
            want.push(a);
        }
        if (mount.parentNode !== s.box) s.box.replaceChildren(mount);
        want.push(s.gap, s.box);
        if (overflows) {
            // Initial layout may still be detached from the document. Check in
            // the next frame, after the wrapper has a meaningful clientWidth.
            requestAnimationFrame(() => updateDisplayOverflowCue(s.wrap));
        }
    });

    if (segs.trailingGap) {
        if (!dom.trail) {
            dom.trail = document.createElement('div');
            dom.trail.style.cssText = 'overflow-anchor:none';
        }
        setStyle(dom.trail, 'height', `${segs.trailingGap}px`);
        want.push(dom.trail);
    }
    syncChildren(dom.root, want);
    cache.layout = { laid };
    observeSegments(cache);
    return dom.root;
}

// Make parent's children exactly `want`, in order, touching only what differs:
// an element already in place is left alone (see the scroll-anchoring notes in
// layoutDocument), and one that moved is re-inserted before its new successor.
function syncChildren(parent, want) {
    let k = 0;
    for (const el of want) {
        const cur = parent.childNodes[k];
        if (cur !== el) parent.insertBefore(el, cur || null);
        k++;
    }
    while (parent.childNodes.length > k) parent.lastChild.remove();
}

// Write a style property only when it changes: a rewrite with the same value
// is harmless to layout but an actual change on the anchor element (or one of
// its ancestors) is what cancels scroll anchoring.
function setStyle(el, prop, v) { if (el.style[prop] !== v) el.style[prop] = v; }

// Per-segment cache, keyed by the layout parameters (a change of alignment or of
// any Knuth–Plass knob starts afresh). `exact` maps a width to its full layout;
// `obs` is the sorted list of observed widths with the geometry seen there.
function segLayoutCache(s, key) {
    if (!s.hc || s.hc.key !== key) s.hc = { key, exact: new Map(), obs: [] };
    return s.hc;
}
const EXACT_LAYOUTS_KEPT = 3;

function rememberLayout(hc, w, L) {
    hc.exact.set(w, L);
    if (hc.exact.size > EXACT_LAYOUTS_KEPT) hc.exact.delete(hc.exact.keys().next().value);
    const o = { w, H: L.H, W: L.W, firstAscent: L.firstAscent, lastDepth: L.lastDepth, firstMeta: L.firstMeta,
                preDisplaySizeSp: L.preDisplaySizeSp, displayLeftSp: L.displayLeftSp, atSourceWidth: L.atSourceWidth };
    const obs = hc.obs;
    let k = 0;
    while (k < obs.length && obs[k].w < w) k++;
    if (k < obs.length && obs[k].w === w) obs[k] = o;   // re-observed: the real value wins
    else obs.splice(k, 0, o);
}

// Geometry for width w without laying out: an exact observation, or – heights
// being monotone in width – the interval between two observations of equal
// height that brackets w (the nearer end supplies the rest of the geometry).
function cachedGeometry(hc, w) {
    const obs = hc.obs;
    let k = 0;
    while (k < obs.length && obs[k].w < w) k++;
    if (k < obs.length && obs[k].w === w) return obs[k];
    if (k === 0 || k === obs.length) return null;
    const a = obs[k-1], b = obs[k];
    if (a.H !== b.H) return null;
    return (w - a.w <= b.w - w) ? a : b;
}

// Run the deferred layout of segment i now (its lines are needed), size its
// element for the real geometry, and fix the spacing of the segment below it,
// which depends on this one's last depth. If the real height differs from the
// cached one, the following content simply moves; the observation is replaced.
function materializeSegment(cache, i) {
    const laid = cache.layout && cache.layout.laid;
    const L = laid && laid[i];
    if (!L || !L.deferred) return;
    const ctx = cache.layoutCtx;
    useGlyphMetrics(cache.metrics);
    const s = cache.dom.segs[i];
    const real = ctx.layoutOne(ctx.segs[i], i);
    rememberLayout(segLayoutCache(s, ctx.paramsKey), ctx.widthPt, real);
    laid[i] = real;
    const remount = (seg, R, prev) => {
        const { mount, overflows } = sizeSegment(seg, R, prev, ctx.columnPx, ctx.p);
        if (mount.parentNode !== seg.box) seg.box.replaceChildren(mount);
        seg.mount = mount;
        if (overflows) requestAnimationFrame(() => updateDisplayOverflowCue(seg.wrap));
    };
    remount(s, real, laid[i-1]);
    if (laid[i+1]) remount(cache.dom.segs[i+1], laid[i+1], real);
    if (cache.layoutStats) cache.layoutStats.materialized++;
}

// Paint one segment: reconcile its lines' glyphs into its own <svg>. The reconcile
// is scoped to this segment (its own `live` set) because a node always lands in
// exactly one segment – segmentation is width-independent – so segments can be
// painted independently. That independence is what makes per-segment painting
// possible (see observeSegments / paintVisibleNow): a long document only pays the
// DOM cost for the segments that have been on screen, not for all of them at once.
function paintSegment(fontInfo, cache, i) {
    restoreLinkStates();              // once this paint is done (a microtask)
    materializeSegment(cache, i);     // a deferred layout is only ever run here
    useGlyphMetrics(cache.metrics);   // a paint may run after another block laid out
    const dom = cache.dom;
    const L   = cache.layout.laid[i];
    const s   = dom.segs[i];
    const stats = cache.stats || (cache.stats = { created: 0, moved: 0, repositioned: 0, removed: 0 });
    const used  = new Set();
    const sink  = reconcileSink(dom.byNode, used, stats, cache);

    // Grow/shrink the pool of per-line group pairs. Detached pairs are kept for
    // later regrowth; their stale children are swept by the live set.
    while (s.pairs.length < L.lines.length) {
        const g = svgEl('g', {'aria-hidden':'true', style:'user-select:none;pointer-events:none'});
        const text = svgEl('text', {});
        text.style.cssText = 'font-weight:normal;font-style:normal';
        s.pairs.push({ g, text, attached: false });
    }
    for (let j = 0; j < s.pairs.length; j++) {
        const pair = s.pairs[j];
        if (j < L.lines.length && !pair.attached) {
            s.svg.appendChild(pair.g);
            s.svg.appendChild(pair.text);
            pair.attached = true;
        } else if (j >= L.lines.length && pair.attached) {
            pair.g.remove();
            pair.text.remove();
            pair.attached = false;
        }
    }

    for (let j = 0; j < L.lines.length; j++) {
        const { ratio, er, x0, fillRatio, fillOrder } = L.lrp[j];
        sink.beginLine(s.pairs[j].text, s.pairs[j].g);
        // On a fill line finite glue is already at natural width (ratio 0), so the
        // single ratio slot carries the fill ratio and fillOrder selects the fill.
        renderNodes(fontInfo, sink, L.lines[j].nodes, x0, L.baselineYs[j],
                    fillOrder ? fillRatio : ratio, er, fillOrder || 0);
    }

    // Detach this segment's elements no longer rendered (disc paths toggled off,
    // spaces consumed by new break points). They stay cached in byNode.
    if (s.live) for (const el of s.live) if (!used.has(el)) { el.remove(); stats.removed++; }
    s.live = used;
    s.painted = true;
    s.dirty = false;

    // Overflow cues only. The wrapper's vertical geometry – the headroom padding
    // and the margins that take it back – is fixed at layout time (see
    // layoutDocument). Measuring painted ink here with getBBox was a trap: for
    // SVG text it returns the font's ascent/descent box, not the glyph outlines,
    // so the wrapper was padded for phantom overshoot and every scrollable
    // display carried visibly inflated space above and below.
    if (s.wrap && s.svg.parentNode === s.wrap) {
        updateDisplayOverflowCue(s.wrap);
    }
}

// Paint every segment regardless of the viewport – for printing, where nothing may
// be left as an empty placeholder.
function paintDocument(fontInfo, cache) {
    if (!cache.layout) return;
    cache.stats = { created: 0, moved: 0, repositioned: 0, removed: 0 };
    for (let i = 0; i < cache.layout.laid.length; i++) {
        const s = cache.dom.segs[i];
        if (!s.svg) { if (s.sub) paintDocument(fontInfo, s.sub); continue; }
        paintSegment(fontInfo, cache, i);
    }
}

// ── Initialisation ────────────────────────────────────────────────────────────

// Hang each picture's payload on the node that draws it, once per block, so
// the renderer never has to thread the document through every call.
function resolvePictures(doc) {
    const pics = doc.pictures;
    if (!pics || !pics.length) return;
    const walk = nodes => {
        for (const n of nodes) {
            if (n.type === 'picture' && n.picture) n.pic = pics[n.picture - 1];
            for (const k of ['children', 'replace', 'pre', 'post']) {
                if (n[k]) walk(n[k]);
            }
        }
    };
    for (const p of doc.paragraphs) walk(p.nodes);
    for (const it of doc.content || []) if (it.box) walk(it.box.children || []);
    for (const st of doc.streams || []) {
        for (const it of st.content || []) if (it.box) walk(it.box.children || []);
    }
}

// The page embeds latex.proto as base64 text; parse it at runtime into a
// protobuf.js Document type. keepCase keeps the schema's snake_case field names
// (glyph_metrics, stretch_order, size_sp) – the renderer reads those, not
// protobuf.js's default camelCase. (Runtime .proto parsing is the simple option;
// precompiling a descriptor with pbjs + the minimal runtime is the future size
// win – see README.)
function loadSchema() {
    const el = document.getElementById('latex-schema');
    if (!el?.dataset.schemaB64) throw new Error('#latex-schema element with data-schema-b64 not found');
    const protoText = new TextDecoder().decode(b64ToBytes(el.dataset.schemaB64));
    const root = protobuf.parse(protoText, { keepCase: true }).root;
    sharedDocType = root.lookupType('latex.Document');
}

// Optional: {original filename → served filename} written into the page as a JSON
// island (prebuild.py / build.py). Lets a modified font be fetched from its
// renamed, content-hashed file while blocks still refer to it by its original
// name. Absent → registerFonts falls back to the original name.
function loadFontMap() {
    const el = document.getElementById('latex-font-map');
    if (!el) return;
    // Optional override for where @font-face URLs resolve from – a relative
    // value (e.g. 'fonts/') is resolved against the script's own URL, same as
    // the default above, so it stays file://-safe; an absolute one (a scheme,
    // or a leading '/') is used as-is, e.g. to point at a CDN. Malformed input
    // (or no SCRIPT_URL to resolve a relative one against) leaves the default.
    const base = el.getAttribute('data-fonts-base');
    if (base) {
        const withSlash = base.endsWith('/') ? base : base + '/';
        try { fontBase = new URL(withSlash, SCRIPT_URL).href; }
        catch { /* keep the default */ }
    }
    if (!el.textContent.trim()) return;
    try { fontUrlMap = JSON.parse(el.textContent); }
    catch { fontUrlMap = {}; }
}

// Decode one block. toObject options reproduce the kiwi decode shape exactly:
// defaults:false keeps unset scalars absent (proto2 presence – gW relies on
// width===undefined); arrays:true gives empty repeated fields as [] (not
// undefined); enums:String yields the lowercase enum names the renderer compares
// against ('glyph', 'display'); longs:Number keeps ints as plain numbers.
function decodeBlock(b64) {
    const msg = sharedDocType.decode(b64ToBytes(b64));
    return sharedDocType.toObject(msg, { defaults: false, arrays: true, enums: String, longs: Number });
}

async function initBlock(el) {
    const nodelistB64 = el.dataset.nodelistB64;
    if (!nodelistB64) throw new Error('Missing data-nodelist-b64 attribute');

    const t0        = performance.now();
    const doc       = decodeBlock(nodelistB64);
    resolvePictures(doc);
    // Declare this block's labels before anything of it is painted, so its own
    // references resolve without needing the page map at all. Blocks initialise
    // in order, so a reference to a label defined by a *later* block on the same
    // page still needs the map – which for a site that ships one, it has.
    for (const label of doc.anchors || []) pageLabels.add(label);
    const t1        = performance.now();
    const fontsData = Object.fromEntries(doc.fonts.map(f => [String(f.id), f]));
    const fontInfo  = await registerFonts(fontsData);
    const t2        = performance.now();

    const params  = paramsFromEl(el);
    const widthPt = el.dataset.latexWidth
        ? parseInt(el.dataset.latexWidth)
        : (el.clientWidth / ZOOM) || DEFAULT_WIDTH_PT;
    const cache = { bcs: null, dom: null, layout: null, stats: null };  // bcs: Map(paraIdx → break candidates), built lazily
    const data  = { doc, fontInfo, lastWidth: widthPt, lastAlign: params.align, params, cache, painted: false };
    blockData.set(el, data);
    if (doc.slots && doc.slots.length) {
        slotBlocks.add(el);
        applySlots(fontInfo, doc);
    }
    // Layout first (this sets the svg's final height), then decide from the
    // block's resulting position whether to paint now or on approach. Blocks
    // are initialised top to bottom, so earlier blocks already have their
    // final heights when later ones measure their distance to the viewport.
    el.replaceChildren(layoutDocument(fontInfo, doc, widthPt, params, cache));
    remeasureStreams(fontInfo, doc, widthPt, params, cache);
    // The document's outline (sections, subsections, theorems), for a page to
    // build a table of contents from. Each entry's `id` is the id of its
    // anchor element, which exists once the block is laid out – now. Also
    // kept on the element for a script that attaches later.
    if (doc.outline && doc.outline.length) {
        const entries = doc.outline.map(e => ({
            kind: e.kind || '', env: e.env || '', level: e.level || 0,
            number: e.number || '', title: e.title || '',
            id: (doc.anchors || [])[(e.anchor || 0) - 1] || null,
        }));
        el.reflowtexOutline = entries;
        el.dispatchEvent(new CustomEvent('reflowtex:outline', { bubbles: true, detail: { block: el, entries } }));
    }
    const t3 = performance.now();
    // Paint the segments near the viewport now; layoutDocument has already set the
    // IntersectionObserver watching the rest, which paint (once, for good) as they
    // are scrolled toward. Never un-painted.
    paintVisibleNow(fontInfo, cache);
    data.painted = true;
    observedBlocks.add(el);
    const t4 = performance.now();
    ro.observe(el);
    // A segment is the paint unit: a run of consecutive text paragraphs, or a single
    // display. The rest are painted as they approach the viewport (segIO).
    const segTotal   = cache.dom.segs.length;
    const segPainted = cache.dom.segs.reduce((n, s) => n + (s.painted ? 1 : 0), 0);
    return { decode: t1 - t0, fonts: t2 - t1, layout: t3 - t2, paint: t4 - t3,
             total: t4 - t0, segTotal, segPainted };
}

async function init() {
    const blocks = [...document.querySelectorAll('[data-nodelist-b64]')];
    if (blocks.length === 0) return;

    const tStart = performance.now();
    installColorMaps();
    installCitations();
    installFootnotes();
    installStreamStyles();
    installLinks();
    loadSchema();
    loadFontMap();

    // Sequential to avoid font registration races
    let idx = 0, segPainted = 0, segTotal = 0;
    for (const el of blocks) {
        try {
            const t = await initBlock(el);
            segPainted += t.segPainted; segTotal += t.segTotal;
            console.log(`[latex-viewer] block ${++idx}/${blocks.length}: ${t.total.toFixed(1)} ms `
                + `(decode ${t.decode.toFixed(1)}, fonts ${t.fonts.toFixed(1)}, layout ${t.layout.toFixed(1)}, paint ${t.paint.toFixed(1)}) `
                + `– ${t.segPainted}/${t.segTotal} segments painted`);
        }
        catch (e) { el.textContent = `Render error: ${e.message}`; console.error(e); }
    }
    const segDeferred = segTotal - segPainted;
    console.log(`[latex-viewer] ${blocks.length} block(s) in ${(performance.now() - tStart).toFixed(1)} ms `
        + `· ${segPainted}/${segTotal} segments painted`
        + (segDeferred ? `, ${segDeferred} deferred (painted on scroll)` : ''));

    // Cold cache: at least one face was still loading when we first painted, so
    // some SVG glyphs may be showing in a fallback. Faces can finish in several
    // waves, and content keeps painting as the reader scrolls, so repaint on every
    // loadingdone wave (and once more when all faces settle) rather than a single
    // time – see scheduleFontRepaint. Guarded by fontsPending so a warm load, where
    // the first paint is already correct, does none of this.
    if (fontsPending && document.fonts) {
        if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', scheduleFontRepaint);
        if (document.fonts.ready) document.fonts.ready.then(scheduleFontRepaint);
    }
}

document.addEventListener('DOMContentLoaded', init);

})();
