// SPDX-License-Identifier: AGPL-3.0-or-later

import { I } from './context.js';
import { census, fileOf, fontKeyOf } from './census.js';

// How the pipeline served a font (see src/pipeline/fonts/fonts.ts): 'converted', a
// classic Type 1 font it rebuilt as OpenType (the document names the new file,
// NAME.reflowtex-HASH.otf); 'patched', an OpenType font whose cmap it extended
// with code points LuaTeX used – private-use ones among them – and serves
// renamed (only the page's font map, and so the @font-face rule, says so);
// 'original', served as it is; null with no file.
export const MODIFIED_FILE = /\.reflowtex-[0-9a-f]{8}\.otf$/i;
export const isPUA = cp => (cp >= 0xE000 && cp <= 0xF8FF) || cp >= 0xF0000;
export function fontOrigin(file, family) {
    if (!file) return null;
    if (MODIFIED_FILE.test(file)) return 'converted';
    const url = family && fontUrl(family);
    return url && MODIFIED_FILE.test(decodeURIComponent(new URL(url).pathname)) ? 'patched' : 'original';
}
// ── Font files ─────────────────────────────────────────────────────────────────
// A font's glyphs, read from the file the page loaded it from (the viewer's
// @font-face rule): each glyph's index, its name, the code points that map to
// it and its advance – and, from the documents, how often each character is
// used, at what sizes, with the metrics TeX gave it and its microtype codes.
export function fontUrl(family) {
    for (const ss of document.styleSheets) {
        let rules;
        try { rules = ss.cssRules; } catch { continue; }
        for (const r of rules) {
            if (!(r instanceof CSSFontFaceRule)) continue;
            if (r.style.getPropertyValue('font-family').replace(/["']/g, '').trim() !== family) continue;
            const m = /url\(\s*["']?([^"')]+)/.exec(r.style.getPropertyValue('src'));
            if (m) return new URL(m[1], ss.href || document.baseURI).href;
        }
    }
    return null;
}
export const fontStatus = family => { for (const f of document.fonts || []) if (f.family.replace(/["']/g, '') === family) return f.status; return null; };
export const fontFiles = new Map();                     // url → a promise of the parsed file
export function loadFontFile(url) {
    if (!fontFiles.has(url)) {
        const p = fetch(url).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); }).then(parseFont);
        p.catch(() => fontFiles.delete(url));    // may work another time
        fontFiles.set(url, p);
    }
    return fontFiles.get(url);
}
// The tables an OpenType file needs for a glyph list: cmap (format 4 or 12),
// maxp, head, hhea and hmtx, and CFF's charset for the names. (A TrueType
// file's names are in `post`, which is not read: the pipeline makes CFF.)
export function parseFont(buf) {
    const v = new DataView(buf), u8 = o => v.getUint8(o), u16 = o => v.getUint16(o), u32 = o => v.getUint32(o);
    const sig = String.fromCharCode(u8(0), u8(1), u8(2), u8(3));
    if (sig === 'wOFF' || sig === 'wOF2') throw new Error('a WOFF file, which is not read here');
    const T = {};
    for (let i = 0, n = u16(4); i < n; i++) {
        const r = 12 + 16 * i;
        T[String.fromCharCode(u8(r), u8(r + 1), u8(r + 2), u8(r + 3))] = u32(r + 8);
    }
    const upem = T.head != null ? u16(T.head + 18) : 1000;
    const numGlyphs = T.maxp != null ? u16(T.maxp + 4) : 0;
    const numH = T.hhea != null ? u16(T.hhea + 34) : 0;
    const adv = new Array(numGlyphs);
    if (T.hmtx != null && numH) for (let g = 0; g < numGlyphs; g++) adv[g] = u16(T.hmtx + 4 * Math.min(g, numH - 1));
    // cmap: the best Unicode subtable – full repertoire (format 12) over BMP (format 4)
    const cps = Array.from({ length: numGlyphs }, () => []);
    if (T.cmap != null) {
        const subs = [];
        for (let i = 0, n = u16(T.cmap + 2); i < n; i++) {
            const r = T.cmap + 4 + 8 * i, plat = u16(r), enc = u16(r + 2), off = T.cmap + u32(r + 4);
            if (plat === 0 || (plat === 3 && (enc === 1 || enc === 10))) subs.push({ off, format: u16(off) });
        }
        const sub = subs.find(s => s.format === 12) || subs.find(s => s.format === 4);
        const map = (c, g) => { if (g > 0 && g < numGlyphs) cps[g].push(c); };
        if (sub && sub.format === 12) {
            for (let i = 0, n = u32(sub.off + 12); i < n; i++) {
                const r = sub.off + 16 + 12 * i, start = u32(r), end = u32(r + 4), g0 = u32(r + 8);
                for (let c = start; c <= end && c - start < 0x10000; c++) map(c, g0 + c - start);
            }
        } else if (sub) {
            const o = sub.off, seg2 = u16(o + 6), ends = o + 14, starts = ends + seg2 + 2, deltas = starts + seg2, ros = deltas + seg2;
            for (let i = 0; i < seg2 / 2; i++) {
                const end = u16(ends + 2 * i), start = u16(starts + 2 * i), delta = u16(deltas + 2 * i), ro = u16(ros + 2 * i);
                for (let c = start; c <= end && c !== 0xFFFF; c++) {
                    let g;
                    if (!ro) g = (c + delta) & 0xFFFF;
                    else { g = u16(ros + 2 * i + ro + 2 * (c - start)); if (g) g = (g + delta) & 0xFFFF; }
                    map(c, g);
                }
            }
        }
    }
    return { upem, numGlyphs, adv, cps, names: T['CFF '] != null ? cffNames(v, T['CFF '], numGlyphs) : null };
}
// Glyph names from a CFF table's charset (CFF1; a CID-keyed font's glyphs are
// named by CID).
export function cffNames(v, base, numGlyphs) {
    try {
        const u8 = o => v.getUint8(o), u16 = o => v.getUint16(o);
        const off = (o, size) => { let x = 0; for (let i = 0; i < size; i++) x = x * 256 + u8(o + i); return x; };
        // an INDEX at o: its entries' [start, end) and where it ends
        const index = o => {
            const count = u16(o);
            if (!count) return { items: [], end: o + 2 };
            const os = u8(o + 2), data = o + 3 + (count + 1) * os - 1, items = [];
            for (let i = 0; i < count; i++) items.push([data + off(o + 3 + i * os, os), data + off(o + 3 + (i + 1) * os, os)]);
            return { items, end: data + off(o + 3 + count * os, os) };
        };
        const names = index(base + u8(base + 2)), top = index(names.end), strings = index(top.end);
        // the Top DICT: operators and their operands
        const dict = {};
        let [o, end] = top.items[0], ops = [];
        while (o < end) {
            const b0 = u8(o);
            if (b0 <= 21) { const op = b0 === 12 ? 1200 + u8(o + 1) : b0; o += b0 === 12 ? 2 : 1; dict[op] = ops; ops = []; }
            else if (b0 === 28) { ops.push(v.getInt16(o + 1)); o += 3; }
            else if (b0 === 29) { ops.push(v.getInt32(o + 1)); o += 5; }
            else if (b0 === 30) { o++; while (o < end) { const b = u8(o++); if ((b & 15) === 15 || (b >> 4) === 15) break; } ops.push(0); }
            else if (b0 <= 246) { ops.push(b0 - 139); o++; }
            else if (b0 <= 250) { ops.push((b0 - 247) * 256 + u8(o + 1) + 108); o += 2; }
            else { ops.push(-(b0 - 251) * 256 - u8(o + 1) - 108); o += 2; }
        }
        const cid = dict[1230] !== undefined, at = dict[15] ? dict[15][0] : 0;
        const str = sid => {
            if (cid) return `cid${sid}`;
            if (sid < CFF_STD.length) return CFF_STD[sid];
            const s = strings.items[sid - CFF_STD.length];
            return s ? String.fromCharCode(...new Uint8Array(v.buffer, v.byteOffset + s[0], s[1] - s[0])) : `sid${sid}`;
        };
        const out = ['.notdef'];
        if (at <= 2) { for (let g = 1; g < numGlyphs; g++) out.push(at === 0 ? str(g) : null); return out; }  // the predefined charsets: ISOAdobe (expert ones not named)
        const p = base + at, format = u8(p);
        let q = p + 1;
        if (format === 0) for (let g = 1; g < numGlyphs; g++, q += 2) out.push(str(u16(q)));
        else while (out.length < numGlyphs) {
            const first = u16(q), left = format === 1 ? u8(q + 2) : u16(q + 2);
            q += format === 1 ? 3 : 4;
            for (let i = 0; i <= left && out.length < numGlyphs; i++) out.push(str(first + i));
        }
        return out;
    } catch { return null; }
}
export const CFF_STD = '.notdef space exclam quotedbl numbersign dollar percent ampersand quoteright parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore quoteleft a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde exclamdown cent sterling fraction yen florin section currency quotesingle quotedblleft guillemotleft guilsinglleft guilsinglright fi fl endash dagger daggerdbl periodcentered paragraph bullet quotesinglbase quotedblbase quotedblright guillemotright ellipsis perthousand questiondown grave acute circumflex tilde macron breve dotaccent dieresis ring cedilla hungarumlaut ogonek caron emdash AE ordfeminine Lslash Oslash OE ordmasculine ae dotlessi lslash oslash oe germandbls onesuperior logicalnot mu trademark Eth onehalf plusminus Thorn onequarter divide brokenbar degree thorn threequarters twosuperior registered minus eth multiply threesuperior copyright Aacute Acircumflex Adieresis Agrave Aring Atilde Ccedilla Eacute Ecircumflex Edieresis Egrave Iacute Icircumflex Idieresis Igrave Ntilde Oacute Ocircumflex Odieresis Ograve Otilde Scaron Uacute Ucircumflex Udieresis Ugrave Yacute Ydieresis Zcaron aacute acircumflex adieresis agrave aring atilde ccedilla eacute ecircumflex edieresis egrave iacute icircumflex idieresis igrave ntilde oacute ocircumflex odieresis ograve otilde scaron uacute ucircumflex udieresis ugrave yacute ydieresis zcaron exclamsmall Hungarumlautsmall dollaroldstyle dollarsuperior ampersandsmall Acutesmall parenleftsuperior parenrightsuperior twodotenleader onedotenleader zerooldstyle oneoldstyle twooldstyle threeoldstyle fouroldstyle fiveoldstyle sixoldstyle sevenoldstyle eightoldstyle nineoldstyle commasuperior threequartersemdash periodsuperior questionsmall asuperior bsuperior centsuperior dsuperior esuperior isuperior lsuperior msuperior nsuperior osuperior rsuperior ssuperior tsuperior ff ffi ffl parenleftinferior parenrightinferior Circumflexsmall hyphensuperior Gravesmall Asmall Bsmall Csmall Dsmall Esmall Fsmall Gsmall Hsmall Ismall Jsmall Ksmall Lsmall Msmall Nsmall Osmall Psmall Qsmall Rsmall Ssmall Tsmall Usmall Vsmall Wsmall Xsmall Ysmall Zsmall colonmonetary onefitted rupiah Tildesmall exclamdownsmall centoldstyle Lslashsmall Scaronsmall Zcaronsmall Dieresissmall Brevesmall Caronsmall Dotaccentsmall Macronsmall figuredash hypheninferior Ogoneksmall Ringsmall Cedillasmall questiondownsmall oneeighth threeeighths fiveeighths seveneighths onethird twothirds zerosuperior foursuperior fivesuperior sixsuperior sevensuperior eightsuperior ninesuperior zeroinferior oneinferior twoinferior threeinferior fourinferior fiveinferior sixinferior seveninferior eightinferior nineinferior centinferior dollarinferior periodinferior commainferior Agravesmall Aacutesmall Acircumflexsmall Atildesmall Adieresissmall Aringsmall AEsmall Ccedillasmall Egravesmall Eacutesmall Ecircumflexsmall Edieresissmall Igravesmall Iacutesmall Icircumflexsmall Idieresissmall Ethsmall Ntildesmall Ogravesmall Oacutesmall Ocircumflexsmall Otildesmall Odieresissmall OEsmall Oslashsmall Ugravesmall Uacutesmall Ucircumflexsmall Udieresissmall Yacutesmall Thornsmall Ydieresissmall 001.000 001.001 001.002 001.003 Black Bold Book Light Medium Regular Roman Semibold'.split(' ');

// A font's glyph table: every glyph of its file, and every character the
// documents use (one a file lacks among them, marked so).
export async function fontGlyphs(fontKey) {
    const inst = [];                              // the fonts, in the blocks, that are this one
    for (const el of I.blocks()) {
        const st = I.state(el);
        if (st) for (const f of st.doc.fonts || []) if (fontKeyOf(f) === fontKey) inst.push({ st, f });
    }
    if (!inst.length) return null;
    const family = inst[0].st.fontInfo[inst[0].f.id] && inst[0].st.fontInfo[inst[0].f.id].family;
    const file = fileOf(inst[0].f);
    // what the documents use: per character, its count, sizes, metrics, codes
    const used = new Map();
    for (const { st, f } of inst) {
        const fi = st.fontInfo[f.id];
        for (const [ch, u] of census(st.doc).glyphs.get(f.id) || []) {
            let r = used.get(ch);
            if (!r) used.set(ch, r = { count: 0, tex: [], codes: null });
            r.count += u.count;
            const m = u.metrics || {};
            if (!r.tex.some(t => t[0] === f.size_sp)) r.tex.push([f.size_sp, m.width || 0, m.height || 0, m.depth || 0]);
            const cc = fi && fi.codes && fi.codes.get(ch);
            if (cc && !r.codes) r.codes = { lp: cc.lp || 0, rp: cc.rp || 0, ef: cc.ef ?? 1000 };
        }
    }
    const sizes = [...new Set(inst.map(i => i.f.size_sp))].sort((a, b) => a - b);
    const out = { key: fontKey, file, family, sizes, names: [...new Set(inst.map(i => i.f.name))],
                  status: family ? fontStatus(family) : null, url: family ? fontUrl(family) : null, cells: [] };
    const f0 = inst[0].f;
    out.micro = { quad: f0.quad || 0, expand: f0.expand_stretch || f0.expand_shrink
        ? `stretch ${f0.expand_stretch || 0}, shrink ${f0.expand_shrink || 0}, step ${f0.expand_step || 0}` : null,
        codes: (f0.codes || []).length };
    const cell = (gid, name, cps, adv) => {
        const u = cps.map(c => used.get(c)).filter(Boolean);
        return { gid, name, cps, adv, uses: u.reduce((a, r) => a + r.count, 0),
                 tex: u.length ? u[0].tex : null, codes: u.length ? u[0].codes : null };
    };
    let font = null;
    if (!file) out.error = 'no font file: TeX named a font the pipeline could not turn into OpenType, so the viewer draws its glyphs as boxes';
    else if (!out.url) out.error = 'no @font-face rule for it on this page';
    else try { font = await loadFontFile(out.url); } catch (e) { out.error = `could not read ${out.url}: ${e.message || e}`; }
    out.origin = fontOrigin(file, family);
    out.puaUsed = [...used.keys()].filter(isPUA).length;
    if (font) {
        out.upem = font.upem; out.numGlyphs = font.numGlyphs;
        out.puaInFile = font.cps.reduce((a, l) => a + l.filter(isPUA).length, 0);
        const mapped = new Set();
        for (let g = 0; g < font.numGlyphs; g++) {
            font.cps[g].forEach(c => mapped.add(c));
            out.cells.push(cell(g, font.names ? font.names[g] : null, font.cps[g], font.adv[g]));
        }
        for (const ch of [...used.keys()].sort((a, b) => a - b))  // used, but not in the file's cmap
            if (!mapped.has(ch)) out.cells.push({ ...cell(null, null, [ch], null), missing: true });
    } else {
        for (const ch of [...used.keys()].sort((a, b) => a - b)) out.cells.push(cell(null, null, [ch], null));
    }
    return out;
}
