// SPDX-License-Identifier: AGPL-3.0-or-later
// A font, in the Resources view: what the page serves and how, and a table
// of every glyph in its file – the ones the page uses marked. A glyph
// selected there is drawn large, with the box TeX gave it and its ink.
import { html, useState, useEffect, useMemo, useRef } from '../vendor/preact.js';
import { call, got } from './bridge.js';
import { Table, Action, Head, Muted, copyText } from './ui.js';
import { resData, resVersion, glyphSel, wantGlyph, markUses, hoverUses, showInTree } from './resources.js';

export const hex = cp => 'U+' + cp.toString(16).toUpperCase().padStart(4, '0');
const isPUA = cp => (cp >= 0xE000 && cp <= 0xF8FF) || cp >= 0xF0000;
const ptOf = sp => +(sp / 65536).toFixed(3) + 'pt';
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
// A glyph the documents use, as a resource of its own (its uses on the page).
const glyphKey = (d, c) => (c && c.uses ? `glyph:${c.cps.find(cp => cp != null)}:${d.key}` : null);
function selectGlyph(d, i) {
    glyphSel.value = { i, key: glyphKey(d, d.cells[i]) };
    markUses();
}

export function FontDetails({ fontKey }) {
    const [d, setD] = useState(undefined);            // undefined: being read; null: gone
    const [q, setQ] = useState('');
    const [which, setWhich] = useState('all');
    const grid = useRef(null);
    const version = resVersion.value;                   // (read again when the resources are)
    useEffect(() => {
        let live = true;
        (async () => {
            const x = await call('fontGlyphs', fontKey.slice(5));
            // its ink is measured in the loaded face, which the page may not have needed yet
            if (got(x) && x.family) {
                const probe = (x.cells.find(c => c.cps.length) || { cps: [65] }).cps[0];
                try { await document.fonts.load(`16px '${x.family}'`, String.fromCodePoint(probe)); } catch { /* measured as it is */ }
            }
            if (live) setD(got(x) ? x : null);
        })();
        return () => { live = false; };
    }, [fontKey, version]);
    // A glyph asked for from elsewhere (a node's "In its font"): selected, in view.
    useEffect(() => {
        const want = wantGlyph.value;
        if (!d || !want || want.key !== fontKey) return;
        wantGlyph.value = null;
        const i = d.cells.findIndex(c => c.cps.includes(want.cp));
        if (i < 0) return;
        selectGlyph(d, i);
        requestAnimationFrame(() => {
            const el = grid.current && grid.current.querySelector(`[data-i="${i}"]`);
            if (el) el.scrollIntoView({ block: 'center' });
        });
    }, [d]);
    const shown = useMemo(() => (d ? glyphsShown(d, q, which) : []), [d, q, which]);
    if (d === undefined) return html`<${Muted}>Reading the font file…<//>`;
    if (d === null) return html`<${Muted}>Gone – the page changed.<//>`;
    const res = resData.value && [...resData.value.fonts, ...resData.value.modifiedFonts].find(r => r.key === fontKey);
    const sel = glyphSel.value;
    const cellOf = e => e.target.closest('.cell');
    return html`
        <${Head} title=${res ? res.label : fontKey.slice(5)}>
            <${Action} title="Select its next glyph in the Boxes view" onClick=${() => showInTree(fontKey)}>Show in tree<//>
        <//>
        <${Table} rows=${fontRows(d)}/>
        <div class="gbar">
            <input type="search" class="gsearch" spellcheck="false" aria-label="Search the glyphs"
                placeholder="A, →, U+2192, 0x41, 65, #12 (glyph index), a name…" value=${q}
                onInput=${e => setQ(e.currentTarget.value)}
                onKeyDown=${e => { if (e.key === 'Escape' && q) { e.stopPropagation(); setQ(''); } }}/>
            <select aria-label="Which glyphs" value=${which} onChange=${e => setWhich(e.currentTarget.value)}>
                <option value="all">All glyphs</option><option value="used">Used here</option>
                <option value="unused">Not used</option><option value="pua">Private use</option>
            </select>
            <span class="gcount muted">${shown.length} of ${d.cells.length}</span>
        </div>
        <div class="ginfo">${sel && d.cells[sel.i] && html`<${GlyphInfo} key=${sel.i} d=${d} i=${sel.i}/>`}</div>
        <div class="grid" role="grid" aria-label="Glyphs" ref=${grid}
                onClick=${e => { const c = cellOf(e); if (c) selectGlyph(d, +c.dataset.i); }}
                onMouseMove=${e => { const c = cellOf(e); if (c) hoverUses(glyphKey(d, d.cells[+c.dataset.i])); }}
                onMouseLeave=${() => hoverUses(null)}>
            ${shown.map(i => html`<${Cell} key=${i} i=${i} c=${d.cells[i]} family=${d.family} sel=${!!sel && sel.i === i}/>`)}
        </div>`;
}
// (Between two cells – the grid's gaps – the hover stays as it was: it changes
// on the next glyph, and clears when the pointer leaves the grid.)

function fontRows(d) {
    const used = d.cells.filter(c => c.uses).length;
    const rows = [['file', d.file || '(none)'], ['TeX font', d.names.join(', ')], ['sizes', d.sizes.map(ptOf).join(', ')]];
    if (d.origin) rows.push(['served', d.origin === 'converted' ? 'converted: a classic Type 1 font the pipeline rebuilt as OpenType'
        : d.origin === 'patched' ? 'patched: the pipeline added cmap entries for code points LuaTeX used, and serves it renamed'
        : 'unmodified, as TeX had it']);
    if (d.origin === 'converted' || d.origin === 'patched' || d.puaUsed)
        rows.push(['private use', (d.puaInFile != null ? `${plural(d.puaInFile, 'code point')} in the file, ` : '')
            + `${d.puaUsed} used – a glyph the font gives no code point of its own (a variant, a size of a delimiter) gets one`]);
    if (d.family) rows.push(['CSS family', `'${d.family}'` + (d.status ? ` – ${d.status}` : '')]);
    if (d.url) rows.push(['loaded from', d.url]);
    if (d.numGlyphs != null) rows.push(['glyphs', `${d.numGlyphs} in the file, ${d.upem} units per em`]);
    rows.push(['used', `${plural(used, 'glyph')}, ${d.cells.reduce((a, c) => a + c.uses, 0)} times`]);
    if (d.micro.quad) rows.push(['quad', ptOf(d.micro.quad)]);
    if (d.micro.expand || d.micro.codes) rows.push(['microtype', [d.micro.expand && `expansion ${d.micro.expand}`,
        d.micro.codes && `codes for ${plural(d.micro.codes, 'character')}`].filter(Boolean).join('; ')]);
    if (d.error) rows.push(['glyph table', d.error]);
    return rows;
}

// ── The table ──────────────────────────────────────────────────────────────────
// The glyphs a search asks for: a character; a code point (U+2192, 0x2192);
// a number, as a glyph index or a decimal code point; #12, a glyph index; or
// part of a glyph's name. Every reading that applies counts.
function glyphTest(q) {
    q = q.trim();
    if (!q) return null;
    const tests = [];
    let m;
    if ((m = /^(?:u\+?|0x|\\u\{?)([0-9a-f]{1,6})\}?$/i.exec(q))) { const cp = parseInt(m[1], 16); tests.push(c => c.cps.includes(cp)); }
    else if ((m = /^(?:#|gid\s*:?\s*)(\d+)$/i.exec(q))) { const g = +m[1]; tests.push(c => c.gid === g); }
    else if (/^\d+$/.test(q)) { const n = +q; tests.push(c => c.gid === n || c.cps.includes(n)); }
    const chars = [...q];
    if (chars.length === 1 || !/[\p{L}\p{N}]/u.test(q)) { const cps = chars.map(ch => ch.codePointAt(0)); tests.push(c => c.cps.some(cp => cps.includes(cp))); }
    const lq = q.toLowerCase();
    tests.push(c => !!c.name && c.name.toLowerCase().includes(lq));
    return c => tests.some(t => t(c));
}
// Which cells, in what order: by code point; then the glyphs with none (by
// index), which the viewer cannot draw; then characters the file lacks.
function glyphsShown(d, q, which) {
    const test = glyphTest(q);
    const rank = c => (c.missing ? 2 : c.cps.length ? 0 : 1), first = c => (c.cps.length ? Math.min(...c.cps) : c.gid);
    return d.cells.map((c, i) => i)
        .sort((a, b) => rank(d.cells[a]) - rank(d.cells[b]) || first(d.cells[a]) - first(d.cells[b]))
        .filter(i => {
            const c = d.cells[i];
            if (which === 'used' && !c.uses) return false;
            if (which === 'unused' && c.uses) return false;
            if (which === 'pua' && !c.cps.some(isPUA)) return false;
            return !test || test(c);
        });
}
function Cell({ i, c, family, sel }) {
    const cp = c.cps[0];
    const title = [cp != null ? c.cps.map(hex).join(' ') : 'no code point', c.name,
                   c.gid != null ? `#${c.gid}` : 'not in the file', c.uses ? `used ${c.uses}×` : ''].filter(Boolean).join(' · ');
    return html`<button type="button" data-i=${i} title=${title}
            class=${'cell' + (c.uses ? ' used' : '') + (c.missing ? ' missing' : '') + (cp == null ? ' unmapped' : '') + (sel ? ' sel' : '')}>
        <span class="g">${cp != null && html`<${CellGlyph} cp=${cp} family=${family}/>`}</span>
        <span class="cap">${cp != null ? cp.toString(16).toUpperCase().padStart(4, '0') : `#${c.gid}`}</span>
        ${c.uses ? html`<span class="uses">${c.uses}</span>` : null}
    </button>`;
}

// ── A glyph ────────────────────────────────────────────────────────────────────
function GlyphInfo({ d, i }) {
    const c = d.cells[i], key = glyphKey(d, c);
    const [drawn, setDrawn] = useState(null);          // how many of its uses are on the page now
    const version = resVersion.value;
    useEffect(() => {
        if (!key) return;
        let live = true;
        call('uses', key).then(ids => { if (live) setDrawn(got(ids) ? ids.length : 0); });
        return () => { live = false; };
    }, [key, version]);
    const rows = [];
    if (c.gid != null) rows.push(['glyph index', `#${c.gid}`]);
    if (c.name) rows.push(['name', c.name]);
    rows.push(['code point' + (c.cps.length > 1 ? 's' : ''), c.cps.length
        ? c.cps.map(cp => hex(cp) + (isPUA(cp) ? ' (private use: the pipeline gave the glyph a code point of its own)' : '')).join(', ')
        : 'none: the viewer cannot draw it']);
    if (c.missing) rows.push(['in the file', 'no – the document uses it, but the font\'s cmap has no such character']);
    if (c.adv != null) rows.push(['advance', `${c.adv} units` + (d.upem ? ` = ${d.sizes.map(sz => ptOf(c.adv / d.upem * sz)).join(', ')}` : '')]);
    for (const [sz, w, ht, dp] of c.tex || []) rows.push([`TeX at ${ptOf(sz)}`, `${ptOf(w)} × ${ptOf(ht)} + ${ptOf(dp)}`]);
    if (c.codes) rows.push(['microtype', `\\lpcode ${c.codes.lp}, \\rpcode ${c.codes.rp}, \\efcode ${c.codes.ef}`]);
    const oh = c.cps.length ? overhang(c, d) : null;
    if (oh) rows.push([`ink at ${ptOf(c.tex ? c.tex[0][0] : d.sizes[0])}`, oh]);
    rows.push(['used', c.uses ? `${plural(c.uses, 'time')} in the documents` : 'not in these documents']);
    if (key) rows.push(['on the page now', drawn == null ? '…' : `${drawn} drawn`]);
    return html`
        <div class="gtop">
            <${GlyphFigure} c=${c} d=${d}/>
            <div class="actions">
                ${key && drawn ? html`<${Action} title="Select its next use in the Boxes view" onClick=${() => showInTree(key)}>Show in tree<//>` : null}
                ${c.cps.length ? html`<${Action} title="Copy the character" onClick=${() => copyText(String.fromCodePoint(c.cps[0]), 'the character')}>Copy<//>` : null}
            </div>
        </div>
        <${Table} rows=${rows}/>`;
}

// A glyph's ink, as the browser draws it: its extent about the pen's origin on
// the baseline, in ems – l and r across (l negative to the left of the
// origin), a above the baseline and d below. From the canvas's text metrics,
// which measure the glyph's outline in the loaded font. Null for no font.
const inkMemo = new Map();
let inkCtx = null;
function inkOf(family, cp) {
    if (!family || cp == null) return null;
    const k = family + ' ' + cp;
    if (inkMemo.has(k)) return inkMemo.get(k);
    inkCtx = inkCtx || document.createElement('canvas').getContext('2d');
    inkCtx.font = `100px '${family}'`;
    const m = inkCtx.measureText(String.fromCodePoint(cp));
    const ink = { l: -m.actualBoundingBoxLeft / 100, r: m.actualBoundingBoxRight / 100,
                  a: m.actualBoundingBoxAscent / 100, d: m.actualBoundingBoxDescent / 100 };
    const out = ink.r > ink.l && ink.a + ink.d > 0 ? ink : null;   // a space has none
    inkMemo.set(k, out);
    return out;
}
const fontFamily = family => (family ? `'${family}'` : undefined);
// A table cell's glyph: at one size for all, on a common baseline – unless
// its ink would not fit, when it is shrunk to fit and centred.
function CellGlyph({ cp, family }) {
    const W = 40, H = 32, BASE = 22, top = 23;        // px; the baseline 23px down
    const ink = inkOf(family, cp);
    let F = BASE, x0 = -W / 2 + (ink ? (ink.l + ink.r) / 2 * BASE : BASE * 0.3), y0 = -top;
    if (ink) {
        const fits = ink.a * BASE <= top - 1 && ink.d * BASE <= H - top - 1 && (ink.r - ink.l) * BASE <= W - 2;
        if (!fits) {
            F = BASE * Math.min(1, (W - 4) / ((ink.r - ink.l) * BASE), (H - 4) / ((ink.a + ink.d) * BASE));
            x0 = (ink.l + ink.r) / 2 * F - W / 2;
            y0 = (ink.d - ink.a) / 2 * F - H / 2;
        }
    }
    return html`<svg width=${W} height=${H} viewBox=${`${x0.toFixed(2)} ${y0.toFixed(2)} ${W} ${H}`} aria-hidden="true">
        <text x="0" y="0" font-size=${F.toFixed(2)} fill="currentColor" font-family=${fontFamily(family)}>${String.fromCodePoint(cp)}</text>
    </svg>`;
}
// A glyph drawn large: its ink whole, the box TeX gave it (dashed, for a
// glyph the documents use) and the baseline.
function GlyphFigure({ c, d }) {
    if (!c.cps.length) return html`<span class="big muted">no code point to draw it by</span>`;
    const em = (c.tex ? c.tex[0][0] : d.sizes[0] || 655360) / 65536;              // pt
    const adv = c.adv != null && d.upem ? c.adv / d.upem * em : null;
    const [w, ht, dp] = c.tex ? c.tex[0].slice(1).map(v => v / 65536) : [adv ?? em / 2, 0, 0];
    const ink = inkOf(d.family, c.cps[0]);
    let x0 = 0, x1 = w, y0 = -ht, y1 = dp;
    if (ink) { x0 = Math.min(x0, ink.l * em); x1 = Math.max(x1, ink.r * em); y0 = Math.min(y0, -ink.a * em); y1 = Math.max(y1, ink.d * em); }
    if (y1 - y0 < em * 0.05) { y0 = -em * 0.7; y1 = em * 0.2; }
    const pad = em * 0.15, W = x1 - x0 + 2 * pad, H = y1 - y0 + 2 * pad;
    const k = Math.min(120 / H, 260 / W, 8);   // px per pt
    const line = { 'vector-effect': 'non-scaling-stroke', fill: 'none', 'stroke-width': '1' };
    const title = c.tex ? `TeX's box: ${ptOf(c.tex[0][1])} × ${ptOf(c.tex[0][2])} + ${ptOf(c.tex[0][3])}, and the baseline`
        : 'the baseline (TeX gave it no box: the documents do not use it)';
    return html`<svg class="big" width=${(W * k).toFixed(1)} height=${(H * k).toFixed(1)} viewBox=${`${x0 - pad} ${y0 - pad} ${W} ${H}`}>
        <line ...${line} class="base" x1=${x0 - pad} x2=${x1 + pad} y1="0" y2="0"/>
        ${c.tex && html`<rect ...${line} class="tbox" stroke-dasharray="3 2" x="0" y=${-ht} width=${Math.max(w, 0)} height=${ht + dp}/>`}
        <text x="0" y="0" font-size=${em} fill="currentColor" font-family=${fontFamily(d.family)}>${String.fromCodePoint(c.cps[0])}</text>
        <title>${title}</title>
    </svg>`;
}
// Where a glyph's ink goes past the box TeX gave it, at its first size.
function overhang(c, d) {
    const ink = inkOf(d.family, c.cps[0]);
    if (!ink) return null;
    const em = (c.tex ? c.tex[0][0] : d.sizes[0] || 655360) / 65536, pt = v => +v.toFixed(2) + 'pt';
    const out = [`${pt(ink.l * em)} to ${pt(ink.r * em)} across, ${pt(ink.a * em)} up, ${pt(ink.d * em)} down`];
    if (c.tex) {
        const [w, ht, dp] = c.tex[0].slice(1).map(v => v / 65536), past = [];
        const add = (v, side) => { if (v > 0.01) past.push(`${pt(v)} ${side}`); };
        add(-ink.l * em, 'left'); add(ink.r * em - w, 'right'); add(ink.a * em - ht, 'above'); add(ink.d * em - dp, 'below');
        out.push(past.length ? `past TeX's box: ${past.join(', ')}` : 'within TeX\'s box');
    }
    return out.join('; ');
}
