// SPDX-License-Identifier: AGPL-3.0-or-later
// latex-viewer.js
// Finds every [data-nodelist-b64] element on the page and renders it as an
// inline SVG using Knuth-Plass line breaking.
//
// Data is embedded in the HTML at Hugo build time (via prebuild.py).
// No runtime fetching of binary files — works fully offline.
//
// Depends on protobuf.min.js being loaded first (exposes global `protobuf`).

(function () {
'use strict';

// Version marker for cache diagnosis: logs the ?v= content hash the page
// requested, and stamps <html data-latex-viewer> when colour maps install.
const BUILD = (document.currentScript?.src.match(/v=([a-f0-9]+)/) || [])[1] || 'unversioned';
console.log(`[latex-viewer] build ${BUILD}`);

// ── Fixed rendering constants ─────────────────────────────────────────────────

const ZOOM         = 2;
const SP_TO_PX     = ZOOM / 65536;
const RUNNING_RULE = -1073741824;

// ── KP algorithm defaults (overridable per-block via data attributes) ─────────

const DEFAULT_BLEED_PX               = 10;
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
const DEFAULT_USE_PROTRUSION         = true;
const DEFAULT_USE_EXPANSION          = true;
const DEFAULT_WIDTH_PT               = 400;

const RIGHT_PROTRUSION = { 44:0.7,46:0.7,58:0.5,59:0.5,45:0.5,8208:0.5,8722:0.5,33:0.3,63:0.3 };
const LEFT_PROTRUSION  = { 40:0.3,8220:0.7,8216:0.7 };

// ── Colour substitution maps ─────────────────────────────────────────────────
// Displayed values per theme, keyed by the colour LaTeX produced (lowercase
// hex). Colours not listed render as-is. Each non-light theme is matched by
// its class name on <html>; adding a theme = a new key here plus a class the
// page switcher can set. Rendering uses CSS custom properties, so theme
// switches restyle already-rendered SVG without any re-rendering.
//
// '#000000' is special: it is the DEFAULT text colour (the serializer omits
// colour on black glyphs, so they carry no inline fill). When a theme maps
// it, all default-coloured LaTeX text uses that value; when absent, default
// text falls back to the page's currentColor (as in the dark theme, where
// the page already provides a light text colour).
const COLOR_MAPS = {
    light: {
        '#000000': '#333333',   // default text → dark grey, easier on the eyes
    },
    dark: {
        '#000000': '#e7e5e4',   // default text → lighter grey (stone-200)
        '#ff0000': '#ff7b72',   // red   → softer red readable on dark
        '#0000ff': '#79c0ff',   // blue  → lighter blue readable on dark
        // lipicsGray is a *muted* accent: dark grey on the paper's white. On a
        // near-black page the same role needs the mirror image — a grey lifted
        // well clear of the background (7.2:1) but still dimmer than the body
        // text, so it stays an accent. The faint cool cast of the original is
        // kept.
        '#4f4f54': '#9c9ca3',   // lipicsGray → lifted cool grey
        // lipicsYellow is a highlight *drawn under text*, so it is the one
        // colour that must be read against the default text rather than the
        // page. Left bright it scores 1.26:1 against this theme's near-white
        // text — the paper gets away with it only because its text is black
        // (8:1). Dimmed to the brightest amber that still clears 4.5:1 (4.98),
        // so it stays recognisably yellow. The other themes keep dark text on
        // it and need no override.
        '#fcc712': '#7a5c00',   // lipicsYellow → dark amber, readable under text
    },
    sepia: {
        '#000000': '#453a26',   // default text → dark warm brown
        '#ff0000': '#c02d0c',   // red   → vivid rust, clearly not text
        '#0000ff': '#155e97',   // blue  → strong cool blue, clearly not text
        '#4f4f54': '#544f45',   // lipicsGray → same darkness, warmed to the page
    },
    contrast: {
        '#000000': '#000000',   // default text → true black
        '#ff0000': '#b30000',   // red   → darker for contrast on white
        '#0000ff': '#0000b3',   // blue  → darker for contrast on white
        // No lipicsGray override: the class's own #4f4f54 already scores 8.2:1
        // on white. The entry that used to be here existed only to darken the
        // washed-out grey this pipeline had before.
    },
};

// The page background behind a LaTeX block, per theme. TeX has no notion of the
// page's colour, so `white` in a drawing does not mean the colour white — it
// means "the paper", i.e. whatever the reader sees behind the figure. Pinning it
// to #ffffff is right only by coincidence on a white page and turns into white
// blobs on a dark one.
//
// These track the page: <main> inherits the body's background, which the theme
// classes set (see assets/css/main.css and layouts/_default/baseof.html). If the
// page's palette changes, these must follow.
const PAGE_BG = {
    light:    '#fafaf9',   // body bg-stone-50
    dark:     '#0c0a09',   // body dark:bg-stone-950
    sepia:    '#f4ecd8',   // html.sepia body
    contrast: '#ffffff',   // html.contrast body
};

// Colours TeX produced by mixing a base colour into the page: `red!20!white` is
// red at 20% over the paper. TeX resolves that to flat RGB at compile time, so
// what arrives is #ffcccc with no trace of how it was built — and a tint of a
// white page is unreadable on a dark one. Re-deriving the mix at runtime keeps
// the intent: a tint follows both its base colour and the current background.
//
// This is not the same as opacity, and must not be reimplemented with it: these
// fills are opaque on purpose, because they mask the drawing underneath.
//
// Each entry is  baked-hex: [base colour, percentage of base].
const TINTS = {
    '#ffcccc': ['#ff0000', 20],   // red!20!white         — live intervals, scopes
    '#ccccff': ['#0000ff', 20],   // blue!20!white        — live intervals, scopes
    '#fef4d0': ['#fcc712', 20],   // lipicsYellow!20!white — scopes
    '#808080': ['#000000', 50],   // black!50!white       — muted labels
};

function colorFill(c) {
    return `var(--latex-color-${c.slice(1)}, ${c})`;
}

let colorMapsInstalled = false;
function installColorMaps() {
    if (colorMapsInstalled) return;
    colorMapsInstalled = true;
    let css = '';
    for (const theme of new Set([...Object.keys(COLOR_MAPS), ...Object.keys(PAGE_BG)])) {
        const decls = Object.entries(COLOR_MAPS[theme] ?? {})
            .map(([src, dst]) => `  --latex-color-${src.slice(1)}: ${dst};`);
        if (PAGE_BG[theme]) decls.push(`  --latex-page-bg: ${PAGE_BG[theme]};`);
        if (decls.length === 0) continue;
        const sel = theme === 'light' ? ':root' : `:root.${theme}`;
        css += sel + ' {\n' + decls.join('\n') + '\n}\n';
    }

    // Derived colours. These are theme-independent declarations: every term is
    // itself a themed variable, so the browser recomputes them on a theme switch
    // with no re-render. They sit on :root, where the theme classes also live, so
    // var() resolves against the *same* element's themed values.
    //
    // The light theme's own block is a plain :root too, and comes first, so these
    // must not restate anything COLOR_MAPS sets, or they would win for light only.
    const derived = ['  --latex-color-ffffff: var(--latex-page-bg);'];
    for (const [hex, [base, pct]] of Object.entries(TINTS)) {
        derived.push(`  --latex-color-${hex.slice(1)}: color-mix(in srgb, `
                   + `var(--latex-color-${base.slice(1)}, ${base}) ${pct}%, `
                   + `var(--latex-page-bg));`);
    }
    css += ':root {\n' + derived.join('\n') + '\n}\n';
    // Default-coloured glyphs carry no inline fill; route them through the
    // '#000000' variable with currentColor as fallback. The html prefix
    // outranks the page's own `.latex-block svg text` rule regardless of
    // stylesheet order.
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
        useProtrusion:        bool('protrusion',          DEFAULT_USE_PROTRUSION),
        useExpansion:         bool('expansion',           DEFAULT_USE_EXPANSION),
        bleedPx:              num('bleedPx',              DEFAULT_BLEED_PX),
        align:                alignFromEl(el),
    };
}

// ── Per-page shared state ─────────────────────────────────────────────────────

// fontInfo is intentionally NOT global — font IDs are per-compilation and collide
// across blocks (e.g. both block 1 and block 2 may use ID 54 for different files).
// Each block gets its own map returned from registerFonts().
const registeredFontFaces = new Set();
let   sharedDocType       = null;   // protobuf.js Document type (see loadSchema)
let   fontUrlMap          = {};     // original font filename → served filename (see loadFontMap)
let   fontBase            = '/fonts/'; // @font-face src base; override via #latex-font-map[data-fonts-base] for sites served under a subpath (e.g. GitHub Pages project sites)
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
    // a width it is never shown at — leaving that stale layout to be printed.
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
    // geometry) stays correct — it is pure computation and cheap. Painting, the
    // DOM-heavy part, is then gated to the visible segments.
    const root = layoutDocument(data.fontInfo, data.doc, newWidth, params, data.cache);
    if (root !== el.firstElementChild) el.replaceChildren(root);
    // Re-layout moved every line: painted segments now hold ink at stale positions.
    // Mark them dirty so they get re-drawn in place — the on-screen ones now (below),
    // each off-screen one when it next scrolls into view (segIO). They are never
    // hidden in the meantime: their <svg> keeps its new reserved size, only its
    // glyphs are stale until repainted.
    for (const s of data.cache.dom.segs) if (s.painted) s.dirty = true;
    const tp = performance.now();
    const repainted = paintVisibleNow(data.fontInfo, data.cache);
    const st = data.cache.stats || {};
    console.log(`[latex-viewer] re-render at ${newWidth.toFixed(0)}pt: layout ${(tp - t0).toFixed(1)} ms, paint ${(performance.now() - tp).toFixed(1)} ms (${repainted} visible segment(s); ${st.repositioned||0} repositioned, ${st.created||0} created)`);
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
    if (data.cache.dom) for (const s of data.cache.dom.segs) segIO.unobserve(s.svg);
    data.cache.dom = null;
    data.cache.layout = null;
    const params = { ...data.params, align: data.lastAlign };
    el.replaceChildren(layoutDocument(data.fontInfo, data.doc, data.lastWidth, params, data.cache));
    paintVisibleNow(data.fontInfo, data.cache);
}

// Repaint every block after a wave of webfonts finishes loading. On a cold cache
// faces arrive in waves *after* content has painted — at init, and lazily on
// scroll — and SVG <text> does not reliably re-rasterise when its face lands
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
// notifications" — harmless but noisy. Deferring to the next frame breaks that
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
// the block's height keeps scroll geometry exact). Painting — placing tens of
// thousands of glyph elements — is the DOM-heavy part, so a segment is painted
// only once it comes within a viewport of the screen. Which segments those are is
// tracked by an IntersectionObserver on each segment's own <svg>, i.e. from the
// real element positions. It is deliberately NOT computed from a running height
// model: a painted display's actual height includes padding reserved for the ink
// that overhangs its box (see paintSegment), which such a model cannot predict, so
// it drifts from the real layout and, near the bottom of a long page, mis-gates
// segments that are in fact on screen. Observing the elements has no such drift and
// costs no per-frame measurement.
//
// Painting is grow-only: a segment, once painted, is never hidden. Scrolling can
// only ever add ink, never remove it, so text never vanishes as the page moves. A
// width change re-draws the painted segments in place (their glyphs move) — the
// visible ones at once, the rest when scrolled to — but still never blanks them.
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
// font rerender, which rebuilds the DOM, makes new ones — see rerenderBlock).
function observeSegments(cache) {
    const segs = cache.dom.segs;
    for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (s.observed) continue;
        segRef.set(s.svg, { cache, i });
        segIO.observe(s.svg);
        s.observed = true;
    }
}

// Paint, synchronously, every segment that needs it (never painted, or dirtied by
// a reflow) and is within a viewport of the screen. Reads each segment's real box,
// so it shares the IntersectionObserver's immunity to height drift and is correct
// under page zoom (getBoundingClientRect and innerHeight are the same space). Two
// passes — measure all, then paint — because painting mutates the DOM and would
// otherwise force a fresh layout between measurements. Used for the first paint and
// after a reflow; the observer covers whatever scrolls into view later.
function paintVisibleNow(fontInfo, cache) {
    if (!cache.dom) return 0;
    cache.stats = { created: 0, moved: 0, repositioned: 0, removed: 0 };
    const segs = cache.dom.segs;
    const vh = window.innerHeight || 800, M = vh;
    const todo = [];
    for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        if (s.painted && !s.dirty) continue;
        const r = s.svg.getBoundingClientRect();
        if (r.bottom > -M && r.top < vh + M) todo.push(i);
    }
    for (const i of todo) paintSegment(fontInfo, cache, i);
    return todo.length;
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
// resize — or the synthetic resize the zoom control fires — can change which
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
        // 'unknown' — e.g. a Type1 math font with no OpenType form) has nothing to
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
        };
    }

    const families = [...new Set(Object.values(fileToFamily))].filter(fam => fam !== 'serif');

    // A face that still has to be fetched (cold cache) can first paint as a
    // fallback, and SVG <text> — notably in Firefox — does not always re-rasterise
    // when the real face arrives. Note it so init() can force one repaint once the
    // faces have settled; a warm load (every face already cached, so the first
    // paint is already correct) leaves this false and pays for no second render.
    const check = fam => { try { return document.fonts.check(`12px '${fam}'`); } catch { return false; } };
    if (document.fonts && families.some(fam => !check(fam))) fontsPending = true;

    // allSettled, not all: a font that fails to load (a missing file, a network
    // blip) must not reject and blank the whole block — its glyphs fall back (or
    // are drawn as metric boxes; see the sink). 'serif' is a system family and
    // needs no loading.
    await Promise.allSettled(families.map(fam => document.fonts.load(`12px '${fam}'`)));
    return fontInfo;
}

// ── Glyph metrics ─────────────────────────────────────────────────────────────
// A glyph's width/height/depth are interned once per distinct box in the
// document's glyph_metrics table (the encoder replaces the inline dimensions with
// a 1-based Node.metrics index — the same box repeats across thousands of glyphs,
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
// (an un-interned document — e.g. output.json fed straight to layout by a test
// harness), honour those. The branch outcome is constant for a given document,
// so it costs nothing measurable.
const gW = n => n.width  !== undefined ? n.width  : glyphMetrics[n.metrics - 1].width;
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
function sumRigidWidth(nodes) { return nodes.reduce((a, n) => n.type==='glyph' ? a+gW(n) : n.type==='kern' ? a+n.kern : a, 0); }

// The set size of one glue node under a box's packing ratio.
function setGlue(g, ratio, fillOrder) {
    let w = g.width;
    if (ratio > 0 && (g.stretch_order || 0) === fillOrder && g.stretch > 0) w += ratio * g.stretch;
    else if (ratio < 0 && (g.shrink_order || 0) === fillOrder && g.shrink > 0) w += ratio * g.shrink;
    return w;
}

// A vlist's glue is *set* exactly as an hlist's is, just along y — so stacking
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

function buildBreakCandidates(nodes) {
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
        // \centering / \raggedleft set it rigid ("0pt") — and keying the end on
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
            const preGlyphW=sumRigidWidth(n.pre),postGlyphW=sumRigidWidth(n.post),replaceGlyphW=sumRigidWidth(n.replace);
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
            if (n.type==='glyph') cumGlyphW+=gW(n);
            else if (n.type==='kern') cumGlyphW+=n.kern;
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
                const hasFill = bcJ.cumFill>bcs[i].cumFill;
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
                const lp=p.linePenalty+b; let d=Math.abs(lp)>=10000?100000000:lp*lp;
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
    // friends make this visible — \@xsect drops the usual \parindent box and
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
        for(const n of ns){
            switch(n.type){
                case 'glyph':{
                    const scale=er!==0?1+er:1, w=gW(n)*scale*SP_TO_PX;
                    const h=gH(n)*SP_TO_PX, d=gD(n)*SP_TO_PX;
                    items.push({x1:x,x2:x+w,h,d}); x+=w; break;
                }
                case 'glue':{let w=n.width; if(r>0&&!(n.stretch_order||0)&&n.stretch>0)w+=r*n.stretch; else if(r<0&&!(n.shrink_order||0)&&n.shrink>0)w+=r*n.shrink; x+=w*SP_TO_PX; break;}
                case 'kern': x+=n.kern*(1+er)*SP_TO_PX; break;
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
// (serializer `cite`). The renderer only *tags* those glyphs — class lr-cite and
// data-cite="<n>"; all behaviour lives in one shared popover driven by delegated
// document events. Delegation (rather than per-glyph listeners) means it does not
// matter when a glyph is painted, that a number is several separate <tspan>s, or
// whether SVG text elements reliably fire mouseenter — a single listener on the
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
    // exact — never scraped back out of rendered text.
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
// build the box from those (width ~half an em, height from the font size — rough
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
// the global emission order is break-invariant — a reflow can move elements
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
//     mirrored — 90° turns the wrong way.
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

// m1 ∘ m2 — apply m2, then m1.
function affineMul(m1, m2) {
    if (!m1) return m2;
    if (!m2) return m1;
    const [a1,b1,c1,d1,e1,f1] = m1, [a2,b2,c2,d2,e2,f2] = m2;
    return [a1*a2 + c1*b2,       b1*a2 + d1*b2,
            a1*c2 + c1*d2,       b1*c2 + d1*d2,
            a1*e2 + c1*f2 + e1,  b1*e2 + d1*f2 + f1];
}

function reconcileSink(byNode, used, stats) {
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
                el.textContent = String.fromCodePoint(n.char);
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
                byNode.set(n, el); stats.created++;
            } else {
                el.setAttribute('x', x); el.setAttribute('y', y); stats.repositioned++;
            }
            place(textParent, lastTspan, el, isNew);
            used.add(el); lastTspan = el;
        },
        // A glyph whose font could not be loaded: draw its TeX metric boxes — the
        // advance width by the height above the baseline, and by the depth below —
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
        // A precompiled tikzpicture. Its markup never changes, so reflowing is
        // only ever a new transform — the drawing itself is built once.
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
//   \cleaders — the remainder is split evenly at the two ends (centred);
//   \xleaders — the remainder is spread evenly into count+1 gaps;
//   \leaders / \gleaders — copies align to a grid on the *enclosing* box rather
//     than to this glue, which is not information the node carries, so they are
//     packed from the left. Nothing in this pipeline uses them today.
const GLUE_LEADERS = 100, GLUE_CLEADERS = 101, GLUE_XLEADERS = 102;

// The DOM reconciler is keyed by node identity, so every tiled copy needs its
// own node objects: drawing one leader box N times would look up the same
// element N times, move it, and leave a single copy at the last position. The
// clones are cached on the glue node and reused while the count holds, which
// keeps the elements — and the reconciler's work — stable across reflows.
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
    else { start=0; }                     // \leaders / \gleaders — see note above

    const copies=leaderCopies(n,count);
    for(let i=0;i<count;i++){
        renderNodes(fontInfo,sink,[copies[i]],x+(start+i*step)*SP_TO_PX,baselineY,0,0,0);
    }
}

// Stack a vlist's children top-to-bottom. refY is the vlist's reference baseline
// and vlistX its left edge; both are supplied by the caller (already resolving any
// shift for the context the vlist appears in). Split out of renderNodes so a vlist
// nested inside another vlist can reuse it — without this, a vlist child was
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
// dimension (the RUNNING_RULE sentinel) inherits it — that is how a \vrule stretches
// to the exact height of the \hbox it sits in (e.g. the two side edges of the amsthm
// QED box). Without this the rule is dropped and only the top/bottom edges show.
function renderNodes(fontInfo, sink, nodes, x, baselineY, ratio, expandRatio, fillOrder, runH, runD) {
    ratio=ratio||0; expandRatio=expandRatio||0; fillOrder=fillOrder||0; runH=runH||0; runD=runD||0;
    for(const n of nodes){
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
                const scale=expandRatio!==0?1+expandRatio:1;
                sink.glyph(n, x, baselineY, fontInfo[String(n.font)]);
                x+=gW(n)*scale*SP_TO_PX; break;
            }
            case 'glue':{
                let w=n.width;
                if(ratio>0&&(n.stretch_order||0)===fillOrder&&n.stretch>0) w+=ratio*n.stretch;
                else if(ratio<0&&(n.shrink_order||0)===fillOrder&&n.shrink>0) w+=ratio*n.shrink;
                if(n.leader) renderLeaders(fontInfo,sink,n,x,baselineY,w);
                if(n.subtype===13) sink.space(n, x, baselineY);
                x+=w*SP_TO_PX; break;
            }
            case 'kern':  x+=n.kern*(1+expandRatio)*SP_TO_PX; break;
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
                // ratio/fillOrder pass through for the same reason — these
                // were siblings in the parent list and their glue is set by
                // the parent's packing.
                sink.beginTransform(n, svgMatrixOf(n, x, baselineY));
                x=renderNodes(fontInfo,sink,n.children,x,baselineY,ratio,expandRatio,fillOrder,runH,runD);
                sink.endTransform();
                break;
            }
            case 'disc':  x=renderNodes(fontInfo,sink,n.replace,x,baselineY,0,expandRatio,0,runH,runD); break;
            case 'math':  x+=n.surround*SP_TO_PX; break;
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
// reduced to the same "line" shape — {nodes, ratio, er, x0} — and the existing
// profiling, spacing, and reconciliation machinery then treats them alike:
//
//   paragraph → Knuth-Plass re-breaks it at the reader's width, many lines
//   display   → one line whose single node is TeX's finished box
//
// Displays are never re-broken or re-packed: TeX already set their glue at
// compile time, and replaying that verbatim is what keeps \hfill, \rlap,
// \mathclap and alignment tabskips faithful to the PDF (re-packing would
// silently activate glue TeX deliberately left slack). The only freedom taken
// is horizontal placement: the box is centred at the reader's width, or
// pinned to the left edge and allowed to overflow when it does not fit — the
// container scrolls in that case.
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
// width, so it can be wider than the column — in one shared SVG that overflow
// would scroll the whole block, dragging text that fits perfectly out of view.
// Giving each display its own scroll container (as MathJax and KaTeX do) keeps
// the text still and lets only the maths pan.
//
// Segmentation depends solely on the content stream, never on width, so the
// segment list is stable across reflows and every element stays reusable.
const HL_ALIGNMENT = 4;   // hlist subtype: one row of an alignment

function segmentsOf(doc) {
    const segs = [];
    let text = null, gap = 0;
    for (const item of contentStream(doc)) {
        if (item.kind === 'vspace') { gap = item.amount * SP_TO_PX; continue; }
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
            text = null; gap = 0;
            continue;
        }
        const para = doc.paragraphs[item.para - 1];
        if (!para) continue;
        // Consecutive paragraphs normally merge into one text segment and stack
        // with adaptive leading. An explicit vspace before this paragraph (from
        // \vspace, or a section heading's before/after skip) breaks that merge:
        // the paragraph starts a new segment whose gapBefore reproduces exactly
        // the space TeX asked for (segment boxes stack baseline-to-baseline).
        if (!text || gap) { text = { kind: 'text', items: [], gapBefore: gap }; segs.push(text); }
        text.items.push({ index: item.para, para });
        gap = 0;
    }
    return segs;
}

// Lay a text segment out: KP-break each paragraph at the reader's width and
// stack the lines with the adaptive collision-based leading.
function layoutTextSegment(fontInfo, seg, widthPt, p, cache) {
    const widthSp  = Math.round(widthPt * 65536);
    const columnPx = widthPt * ZOOM;
    const lines = [], lrp = [], meta = [];

    for (const { index, para } of seg.items) {
        let bcs = cache.bcs.get(index);
        if (!bcs) { bcs = buildBreakCandidates(para.nodes); cache.bcs.set(index, bcs); }

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
        // the indent has to be applied — at x0=0 the label would sit at
        // negative x and be clipped away.
        const indentSp = para.indent || 0;
        const indentPx = indentSp * SP_TO_PX;
        const availSp  = Math.max(1, widthSp - indentSp);
        const availPx  = columnPx - indentPx;

        for (const ln of kpBreak(bcs, para.nodes, availSp, p)) {
            // For non-justified modes: allow glue shrink (ratio<0) but never stretch.
            // When the line must shrink, rendering and positioning are identical to justify.
            // The alignment offset only applies to lines whose natural width fits the column.
            const ratio = justify ? ln.ratio : Math.min(0, ln.ratio);
            const er    = p.useExpansion ? ratio * p.maxExpand : 0;
            const protX = -(p.useProtrusion ? ln.leftProtrusion * SP_TO_PX : 0);
            const natSp = sumWidthSp(ln.nodes);
            let x0, fillRatio = 0, fillOrder = 0;
            if (ratio < 0) {
                x0 = protX;  // squeezed to fit — same position as justified
            } else {
                const natPx = natSp * SP_TO_PX;
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
                    const slackSp = availSp - natSp;
                    if (slackSp > 0) { fillRatio = slackSp / fi.stretch; fillOrder = fi.order; x0 = protX; }
                }
            }
            lines.push(ln);
            lrp.push({ ratio, er, x0: x0 + indentPx, fillRatio, fillOrder });
            meta.push(lineMeta);
        }
    }
    return { lines, lrp, meta, W: Math.ceil(columnPx) };
}

// Where a box's ink actually starts and ends, in the box's own coordinates.
//
// A display's width says nothing about where its ink is: \[..\] carries its
// centring in the box's shift, amsmath bakes an align* row's centring into
// leading glue (140pt of it, hidden behind a negative backup cell), and
// numbered equations use frozen kerns. All of that was computed for the
// compiled \displaywidth and is meaningless at the reader's width. Measuring
// the ink sidesteps every one of those cases without special-casing any.
//
// This drives the real renderNodes with a sink that records instead of
// drawing, so the measurement cannot drift from what actually gets painted.
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

// A numbered display equation is packed by TeX to the full \displaywidth as
// [kern, body(#6), kern, number(#7)]: the equation centred in the band and its
// number flushed to the right margin. Because the whole thing is one rigid box,
// the re-centring below would count the number as ink and shove the equation
// left of centre. LuaTeX marks the number box with hlist subtype 7
// (equationnumber), so it can be lifted out exactly rather than guessed at.
// Returns the body (a shallow copy of the box with the number and its gap kern
// removed, its width shrunk to what remains) and the number box, or null.
const HL_EQNUMBER = 7;
function splitEquationNumber(box) {
    const ch = box.children;
    if (!ch || ch.length < 2) return null;
    const last = ch[ch.length - 1];
    if (!(last.type === 'hlist' && last.subtype === HL_EQNUMBER)) return null;
    let cut = ch.length - 1;                                     // drop the number…
    if (cut > 0 && (ch[cut-1].type === 'kern' || ch[cut-1].type === 'glue')) cut--;  // …and its gap
    const children = ch.slice(0, cut);
    // The advance after the body must reflect only what is left, not the original
    // full-width box, or the trailing spacer/number would land a whole band away.
    const bodyBox = { ...box, children, width: sumWidthSp(children) };
    return { bodyBox, numberBox: last };
}

// Lay a display segment out: rigid boxes, never re-broken or re-packed. The
// only freedom taken is where the group as a whole sits horizontally.
function layoutDisplaySegment(fontInfo, seg, widthPt) {
    const columnPx = widthPt * ZOOM;
    const diPx = (seg.rows[0].item.display_indent || 0) * SP_TO_PX;

    // A lone centred equation with a number: re-centre the body at the reader's
    // width and pin the number to the right margin independently, so widening the
    // column keeps the equation centred and the number at the edge. Only when the
    // body actually fits — an overflowing equation falls through to the generic
    // left-pin path, which keeps TeX's box (number and all) intact and scrollable.
    if (seg.rows.length === 1) {
        const split = splitEquationNumber(seg.rows[0].item.box);
        if (split) {
            const availW  = columnPx - diPx;
            const bodyInk = inkExtentOf(fontInfo, split.bodyBox);
            const numInk  = inkExtentOf(fontInfo, split.numberBox);
            const bodyW   = bodyInk.max - bodyInk.min;
            const xBody   = diPx + (availW - bodyW) / 2 - bodyInk.min;   // body ink centred
            const xNum    = diPx + availW - numInk.max;                  // number ink flush right
            const spacer  = xNum - (xBody + split.bodyBox.width * SP_TO_PX);
            if (bodyW <= availW && spacer >= 0) {
                return {
                    lines: [{ nodes: [
                        split.bodyBox,
                        { type: 'kern', kern: spacer / SP_TO_PX },
                        split.numberBox,
                    ], ratio: 0, fitness: 2, leftProtrusion: 0 }],
                    lrp:  [{ ratio: 0, er: 0, x0: xBody }],
                    gaps: [null],
                    W:    Math.ceil(columnPx),
                };
            }
        }
    }

    const rows = seg.rows.map(r => ({
        ...r,
        // TeX's placement of this row within its band, kept verbatim.
        shiftPx: ((r.item.display_shift || 0) - (r.item.display_indent || 0)) * SP_TO_PX,
        ink:     inkExtentOf(fontInfo, r.item.box),
    }));

    // One offset for the whole group: rows keep their relative positions, so
    // an alignment's & columns stay aligned no matter where the group lands.
    let gMin = Infinity, gMax = -Infinity;
    for (const r of rows) {
        gMin = Math.min(gMin, r.shiftPx + r.ink.min);
        gMax = Math.max(gMax, r.shiftPx + r.ink.max);
    }
    const groupW = gMax - gMin;
    const availW = columnPx - diPx;
    // Centre the ink when it fits; otherwise pin its left edge to x=0 so none
    // of it ends up at negative x, where scrolling could never reach it.
    const offset = groupW <= availW
        ? diPx + (availW - groupW) / 2 - gMin
        : -gMin;

    return {
        lines: rows.map(r => ({ nodes: [r.item.box], ratio: 0, fitness: 2, leftProtrusion: 0 })),
        lrp:   rows.map(r => ({ ratio: 0, er: 0, x0: offset + r.shiftPx })),
        gaps:  rows.map(r => r.gap || null),
        // Only this segment may grow past the column, and only as far as the
        // ink truly reaches — so a short display never scrolls.
        W: Math.ceil(Math.max(columnPx, offset + gMax)),
    };
}

function layoutDocument(fontInfo, doc, widthPt, p, cache) {
    // Point the glyph-metrics reader at this document's table, and stash it on the
    // cache so paintDocument (which is handed only the cache) reads the same one.
    // fontInfo is stashed too, so the IntersectionObserver — which is handed only a
    // segment reference — can repaint it (see observeSegments / segIO).
    useGlyphMetrics(doc.glyph_metrics);
    cache.metrics = doc.glyph_metrics;
    cache.fontInfo = fontInfo;
    const columnPx = widthPt * ZOOM;
    const minGapPx = p.minGapPt * ZOOM;
    const padPx    = p.padPt    * ZOOM;

    // Break candidates depend only on the node list, never on width or params,
    // so they are cached per paragraph across every reflow.
    cache.bcs = cache.bcs || new Map();
    const segs = segmentsOf(doc);

    if (!cache.dom) {
        const root = document.createElement('div');
        cache.dom = { root, segs: [], byNode: new Map(), live: new Set() };
    }
    const dom = cache.dom;
    dom.root.style.visibility = '';   // may have been hidden while paint was deferred

    const laid = segs.map((seg, i) => {
        const geom = seg.kind === 'display'
            ? layoutDisplaySegment(fontInfo, seg, widthPt)
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
    });

    // The per-segment elements persist across renders; only contents reconcile.
    while (dom.segs.length < laid.length) {
        // xmlns:xlink is declared so a picture's `<use xlink:href=…>` (dvisvgm
        // emits the xlink form) resolves once its markup is injected via innerHTML.
        const svg = svgEl('svg', { xmlns:'http://www.w3.org/2000/svg', 'xmlns:xlink':'http://www.w3.org/1999/xlink' });
        // Block CSS cascade from prose containers; SVG text uses explicit per-glyph font families.
        svg.style.cssText = 'display:block;overflow:visible;font-weight:normal;font-style:normal';
        dom.segs.push({ svg, wrap: null, pairs: [] });
    }
    dom.root.replaceChildren();
    laid.forEach((L, i) => {
        const s = dom.segs[i];
        s.svg.setAttribute('width', L.W);
        s.svg.setAttribute('height', L.H);
        s.svg.setAttribute('viewBox', `0 0 ${L.W} ${L.H}`);

        // Only a display that genuinely overflows gets a scroll box, because a
        // scroll box is also a *clipping* box: CSS forces overflow-y to 'auto'
        // once overflow-x is set, and there is no way to scroll one axis while
        // letting the other bleed. Ink that legitimately hangs outside its box
        // — accents, protrusion, delimiter overshoot — would be cut off. So a
        // display that fits is mounted bare and can bleed freely; only one that
        // must pan pays for it, and its wrapper is padded to spare the bleed.
        const overflows = L.seg.kind === 'display' && L.W > columnPx;
        let mount = s.svg;
        if (overflows) {
            if (!s.wrap) s.wrap = document.createElement('div');
            s.wrap.className = 'latex-display';
            if (s.svg.parentNode !== s.wrap) s.wrap.replaceChildren(s.svg);
            mount = s.wrap;
        } else if (s.wrap && s.svg.parentNode === s.wrap) {
            s.svg.remove();          // no longer overflowing: shed the scroll box
        }
        // Between two text segments TeX inserts interline (baselineskip) glue on
        // top of any explicit \vspace, exactly as it does between the lines of a
        // paragraph. Reproduce it so a heading sits the LaTeX distance above its
        // body — and independently of the heading's descender depth, since the
        // glue absorbs that. Displays keep their own captured spacing.
        const prev = laid[i-1];
        let margin = L.gapBefore || 0;
        if (i > 0 && L.seg.kind === 'text' && prev.seg.kind === 'text' && L.firstMeta) {
            margin += texInterlineGlue(prev.lastDepth, L.firstAscent, L.firstMeta);
        }
        s.svg.style.marginTop = '';
        if (s.wrap) s.wrap.style.marginTop = '';
        mount.style.marginTop = margin ? `${margin}px` : '';
        dom.root.appendChild(mount);
    });

    cache.layout = { laid };
    // Track each segment by its own <svg>, not by a running height model that would
    // drift from the real layout (see the per-segment painting section).
    observeSegments(cache);
    return dom.root;
}

// Paint one segment: reconcile its lines' glyphs into its own <svg>. The reconcile
// is scoped to this segment (its own `live` set) because a node always lands in
// exactly one segment — segmentation is width-independent — so segments can be
// painted independently. That independence is what makes per-segment painting
// possible (see observeSegments / paintVisibleNow): a long document only pays the
// DOM cost for the segments that have been on screen, not for all of them at once.
function paintSegment(fontInfo, cache, i) {
    useGlyphMetrics(cache.metrics);   // a paint may run after another block laid out
    const dom = cache.dom;
    const L   = cache.layout.laid[i];
    const s   = dom.segs[i];
    const stats = cache.stats || (cache.stats = { created: 0, moved: 0, repositioned: 0, removed: 0 });
    const used  = new Set();
    const sink  = reconcileSink(dom.byNode, used, stats);

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

    // A display in a scroll box pays a price: overflow-x:auto forces overflow-y to
    // auto as well, so ink hanging above/below the nominal box (accents, deep
    // subscripts, delimiter overshoot) is clipped. Measure the painted ink (getBBox
    // is 1:1 since the viewBox matches width/height) and pad the wrapper by exactly
    // the vertical overshoot, so the display shows in full and still pans.
    if (s.wrap && s.svg.parentNode === s.wrap) {
        let bb;
        try { bb = s.svg.getBBox(); } catch { bb = null; }
        if (bb) {
            const BASE_PAD = 4, pad = v => Math.round(Math.max(0, v) + BASE_PAD) + 'px';
            s.wrap.style.paddingTop    = pad(-bb.y);
            s.wrap.style.paddingBottom = pad((bb.y + bb.height) - L.H);
        }
    }
}

// Paint every segment regardless of the viewport — for printing, where nothing may
// be left as an empty placeholder.
function paintDocument(fontInfo, cache) {
    if (!cache.layout) return;
    cache.stats = { created: 0, moved: 0, repositioned: 0, removed: 0 };
    for (let i = 0; i < cache.layout.laid.length; i++) paintSegment(fontInfo, cache, i);
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
}

// The page embeds latex.proto as base64 text; parse it at runtime into a
// protobuf.js Document type. keepCase keeps the schema's snake_case field names
// (glyph_metrics, stretch_order, size_sp) — the renderer reads those, not
// protobuf.js's default camelCase. (Runtime .proto parsing is the simple option;
// precompiling a descriptor with pbjs + the minimal runtime is the future size
// win — see README.)
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
    // Optional base for @font-face URLs. Defaults to the site root ('/fonts/');
    // a site served under a subpath (GitHub Pages project site, reverse proxy)
    // sets this to the right prefix so fonts don't 404.
    const base = el.getAttribute('data-fonts-base');
    if (base) fontBase = base.endsWith('/') ? base : base + '/';
    if (!el.textContent.trim()) return;
    try { fontUrlMap = JSON.parse(el.textContent); }
    catch { fontUrlMap = {}; }
}

// Decode one block. toObject options reproduce the kiwi decode shape exactly:
// defaults:false keeps unset scalars absent (proto2 presence — gW relies on
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
    // Layout first (this sets the svg's final height), then decide from the
    // block's resulting position whether to paint now or on approach. Blocks
    // are initialised top to bottom, so earlier blocks already have their
    // final heights when later ones measure their distance to the viewport.
    el.replaceChildren(layoutDocument(fontInfo, doc, widthPt, params, cache));
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
                + `— ${t.segPainted}/${t.segTotal} segments painted`);
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
    // time — see scheduleFontRepaint. Guarded by fontsPending so a warm load, where
    // the first paint is already correct, does none of this.
    if (fontsPending && document.fonts) {
        if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', scheduleFontRepaint);
        if (document.fonts.ready) document.fonts.ready.then(scheduleFontRepaint);
    }
}

document.addEventListener('DOMContentLoaded', init);

})();
