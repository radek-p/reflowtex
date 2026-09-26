// SPDX-License-Identifier: AGPL-3.0-or-later

// ── Fixed rendering constants ─────────────────────────────────────────────────

export const ZOOM         = 2;
export const SP_TO_PX     = ZOOM / 65536;
export const RUNNING_RULE = -1073741824;

// ── KP algorithm defaults (overridable per-block via data attributes) ─────────

export const DEFAULT_ALIGN                  = 'justify'; // 'justify' | 'left' | 'right' | 'center'

export const DEFAULT_LINE_PENALTY           = 10;
export const DEFAULT_ADJ_DEMERITS           = 10000;
export const DEFAULT_DOUBLE_HYPHEN_DEMERITS = 10000;
export const DEFAULT_FINAL_HYPHEN_DEMERITS  = 5000;
export const DEFAULT_PRETOLERANCE           = 100;
export const DEFAULT_TOLERANCE              = 200;
export const DEFAULT_TOLERANCE_2            = 500;
export const DEFAULT_EMERGENCY_TOLERANCE    = 10000;
export const DEFAULT_LAST_LINE_MIN          = 0;      // off: TeX has no such rule
export const DEFAULT_LAST_LINE_PENALTY      = 100000;
export const DEFAULT_MAX_EXPAND             = 0.02;
export const DEFAULT_MAX_SHRINK             = 0.02;
export const DEFAULT_MIN_GAP                = 16;   // pt
export const DEFAULT_PAD                    = 2;    // pt (only when spacing > min gap)
export const DEFAULT_DISPLAY_MIN_SPACE      = 10;   // pt; 0 allows affine gaps to reach zero
export const DEFAULT_DISPLAY_OVERFLOW_TOLERANCE = 2; // px; ignores rounding/tiny ink overhang
export const DEFAULT_USE_PROTRUSION         = true;
export const DEFAULT_USE_EXPANSION          = true;
export const DEFAULT_WIDTH_PT               = 400;

export const RIGHT_PROTRUSION = { 44:0.7,46:0.7,58:0.5,59:0.5,45:0.5,8208:0.5,8722:0.5,33:0.3,63:0.3 };
export const LEFT_PROTRUSION  = { 40:0.3,8220:0.7,8216:0.7 };

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
export let glyphMetrics = null;
export function useGlyphMetrics(table) {
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
export const gW = n => n.width  !== undefined ? n.width  : glyphMetrics[n.metrics - 1].width;

// Font expansion as TeX applies it: a line's factor `er` (a fraction) stretches
// or shrinks a glyph only if its font was given expansion limits
// (\expandglyphsinfont – microtype sets them on text fonts, never on math
// fonts), and then scaled by the character's \efcode (‰; 1000 unless listed).
// A font kern between two glyphs expands with them, by the mean of their
// codes (LuaTeX's kern_stretch/kern_shrink); one of the two fonts not
// expanding halves it, as LuaTeX averages the two fonts' limits.
export function glyphExpandScale(fontInfo, n, er) {
    if (!er || n.text !== undefined) return 1;
    const fi = fontInfo && fontInfo[String(n.font)];
    if (!fi || !fi.expand) return 1;
    const c = fi.codes.get(n.char);
    const ef = c && c.ef !== undefined ? c.ef : 1000;
    return ef > 0 ? 1 + er * ef / 1000 : 1;
}
export function kernExpandScale(fontInfo, l, r, er) {
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
export function expandableSp(fontInfo, ns, i) {
    const n = ns[i];
    if (n.type === 'glyph') return gW(n) * (glyphExpandScale(fontInfo, n, 1) - 1);
    if (n.type === 'kern' && (n.subtype || 0) === 0)
        return n.kern * (kernExpandScale(fontInfo, ns[i - 1], ns[i + 1], 1) - 1);
    return 0;
}
export function sumExpandableSp(fontInfo, ns) {
    let w = 0;
    for (let i = 0; i < (ns || []).length; i++) w += expandableSp(fontInfo, ns, i);
    return w;
}
export const gH = n => n.height !== undefined ? n.height : glyphMetrics[n.metrics - 1].height;
export const gD = n => n.depth  !== undefined ? n.depth  : glyphMetrics[n.metrics - 1].depth;

// ── Width helpers ─────────────────────────────────────────────────────────────

export function nodeWidthSp(n) {
    switch (n.type) {
        case 'glyph':               return gW(n);
        case 'picture':             return n.width;
        case 'kern':                return n.kern;
        case 'glue':                return n.width;
        case 'disc':                return sumWidthSp(n.replace);
        case 'wdisc':               return sumWidthSp(n.replace);   // a widget, unbroken
        case 'widget':              return n.width;
        // A transform is drawing-only and has no metrics of its own; its
        // children advance the pen just as they did before being grouped.
        case 'transform':           return sumWidthSp(n.children);
        case 'hlist': case 'vlist': return n.width;
        case 'math':                return n.surround;
        default:                    return 0;
    }
}

export function sumWidthSp(nodes)    { return nodes.reduce((a, n) => a + nodeWidthSp(n), 0); }
// The infinite-order fill on a line (\hfil/\hfill from \\, \hfill, or the amsthm
// QED glue) and its total stretch at that order. A line carrying one is not
// justified; instead its slack goes entirely into this glue, which is what pushes
// anything after it (a QED box, a right-flushed word) to the right margin.
export function fillInfo(nodes) {
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
export function setGlue(g, ratio, fillOrder) {
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
export function vlistGlueRatio(box) {
    if (box.glue_sign === 1 && box.glue_set > 0) return { ratio:  box.glue_set, fillOrder: box.glue_order || 0 };
    if (box.glue_sign === 2 && box.glue_set > 0) return { ratio: -box.glue_set, fillOrder: box.glue_order || 0 };
    return { ratio: 0, fillOrder: 0 };
}

export function hlistGlueRatio(box) {
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
