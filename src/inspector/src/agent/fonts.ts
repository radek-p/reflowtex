// SPDX-License-Identifier: AGPL-3.0-or-later

import { I } from './context.ts';
import { census, familyOf, fileOf, fontKeyOf } from './census.ts';
import { faceFromWire } from '../../../shared/font-face.ts';
import { unreachable } from '../../../shared/unreachable.ts';
import { isPrivateUse } from '../../../shared/glyph-text.ts';
import type { FontGlyphs, FontOrigin, GlyphCell } from '../protocol.ts';
import type { DocFont } from '../../../viewer/src/engine/model.ts';
import type { BlockData } from '../../../viewer/src/runtime/block-data.ts';

/** What a font file says of its glyphs (parseFont): units per em, the
 *  advance of each glyph, the code points that map to it, and its name. */
interface ParsedFont { upem: number; numGlyphs: number; adv: number[]; cps: number[][]; names: (string | null)[] | null }

// How the pipeline served a font (its face, src/shared/font-face.ts):
// 'converted', a classic Type 1 font it rebuilt as OpenType; 'patched', an
// OpenType font whose cmap it extended with code points LuaTeX used –
// private-use ones among them – and serves under another name (only the
// page's font map, and so the @font-face rule, says so); 'original', served as
// it is; null with no face.
export function fontOrigin(f: DocFont, family: string | null): FontOrigin {
    const face = faceFromWire(f);
    switch (face.kind) {
        case 'type1': case 'bitmap': return 'converted';
        case 'opentype': {
            const url = family && fontUrl(family);
            return url && decodeURIComponent(new URL(url).pathname).split('/').pop() !== face.file ? 'patched' : 'original';
        }
        case 'virtual': case 'boxes': return null;
        default: return unreachable(face, 'font face');
    }
}
// ── Font files ─────────────────────────────────────────────────────────────────
// A font's glyphs, read from the file the page loaded it from (the viewer's
// @font-face rule): each glyph's index, its name, the code points that map to
// it and its advance – and, from the documents, how often each character is
// used, at what sizes, with the metrics TeX gave it and its microtype codes.
function fontUrl(family: string): string | null {
    // the viewer's own faces (made by script: no @font-face rule), else an older viewer's rule
    const face = I.faces?.().find(f => f.family === family);
    if (face) return face.url ?? (face.bytes ? `bytes:${family}` : null);
    for (const ss of document.styleSheets) {
        let rules: CSSRuleList;
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
const fontStatus = (family: string): string | null => { for (const f of document.fonts || []) if (f.family.replace(/["']/g, '') === family) return f.status; return null; };
const fontFiles = new Map<string, Promise<ParsedFont>>();                     // url → a promise of the parsed file
function loadFontFile(url: string): Promise<ParsedFont> {
    if (!fontFiles.has(url)) {
        // a face the page gave as bytes (host.fonts.provide): read from the viewer, not fetched
        const given = url.startsWith('bytes:') ? I.faces?.().find(f => f.family === url.slice(6))?.bytes : null;
        const p = given ? Promise.resolve(given.slice(0)).then(parseFont)
            : fetch(url).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); }).then(parseFont);
        p.catch(() => fontFiles.delete(url));    // may work another time
        fontFiles.set(url, p);
    }
    return fontFiles.get(url)!;
}
// The tables an OpenType file needs for a glyph list: cmap (format 4 or 12),
// maxp, head, hhea and hmtx, and CFF's charset for the names. (A TrueType
// file's names are in `post`, which is not read: the pipeline makes CFF.)
function parseFont(buf: ArrayBuffer): ParsedFont {
    const v = new DataView(buf), u8 = (o: number) => v.getUint8(o), u16 = (o: number) => v.getUint16(o), u32 = (o: number) => v.getUint32(o);
    const sig = String.fromCharCode(u8(0), u8(1), u8(2), u8(3));
    if (sig === 'wOFF' || sig === 'wOF2') throw new Error('a WOFF file, which is not read here');
    const T: Record<string, number> = {};
    for (let i = 0, n = u16(4); i < n; i++) {
        const r = 12 + 16 * i;
        T[String.fromCharCode(u8(r), u8(r + 1), u8(r + 2), u8(r + 3))] = u32(r + 8);
    }
    const upem = T.head != null ? u16(T.head + 18) : 1000;
    const numGlyphs = T.maxp != null ? u16(T.maxp + 4) : 0;
    const numH = T.hhea != null ? u16(T.hhea + 34) : 0;
    const adv = new Array<number>(numGlyphs);
    if (T.hmtx != null && numH) for (let g = 0; g < numGlyphs; g++) adv[g] = u16(T.hmtx + 4 * Math.min(g, numH - 1));
    // cmap: the best Unicode subtable – full repertoire (format 12) over BMP (format 4)
    const cps = Array.from({ length: numGlyphs }, (): number[] => []);
    if (T.cmap != null) {
        const subs: { off: number; format: number }[] = [];
        for (let i = 0, n = u16(T.cmap + 2); i < n; i++) {
            const r = T.cmap + 4 + 8 * i, plat = u16(r), enc = u16(r + 2), off = T.cmap + u32(r + 4);
            if (plat === 0 || (plat === 3 && (enc === 1 || enc === 10))) subs.push({ off, format: u16(off) });
        }
        const sub = subs.find(s => s.format === 12) || subs.find(s => s.format === 4);
        const map = (c: number, g: number) => { if (g > 0 && g < numGlyphs) cps[g].push(c); };
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
                    let g: number;
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
function cffNames(v: DataView, base: number, numGlyphs: number): (string | null)[] | null {
    try {
        const u8 = (o: number) => v.getUint8(o), u16 = (o: number) => v.getUint16(o);
        const off = (o: number, size: number) => { let x = 0; for (let i = 0; i < size; i++) x = x * 256 + u8(o + i); return x; };
        // an INDEX at o: its entries' [start, end) and where it ends
        const index = (o: number): { items: [number, number][]; end: number } => {
            const count = u16(o);
            if (!count) return { items: [], end: o + 2 };
            const os = u8(o + 2), data = o + 3 + (count + 1) * os - 1, items: [number, number][] = [];
            for (let i = 0; i < count; i++) items.push([data + off(o + 3 + i * os, os), data + off(o + 3 + (i + 1) * os, os)]);
            return { items, end: data + off(o + 3 + count * os, os) };
        };
        const names = index(base + u8(base + 2)), top = index(names.end), strings = index(top.end);
        // the Top DICT: operators and their operands
        const dict: Record<number, number[]> = {};
        let [o, end] = top.items[0], ops: number[] = [];
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
        const str = (sid: number): string => {
            if (cid) return `cid${sid}`;
            if (sid < CFF_STD.length) return CFF_STD[sid];
            const s = strings.items[sid - CFF_STD.length];
            return s ? String.fromCharCode(...new Uint8Array(v.buffer, v.byteOffset + s[0], s[1] - s[0])) : `sid${sid}`;
        };
        const out: (string | null)[] = ['.notdef'];
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
const CFF_STD = '.notdef space exclam quotedbl numbersign dollar percent ampersand quoteright parenleft parenright asterisk plus comma hyphen period slash zero one two three four five six seven eight nine colon semicolon less equal greater question at A B C D E F G H I J K L M N O P Q R S T U V W X Y Z bracketleft backslash bracketright asciicircum underscore quoteleft a b c d e f g h i j k l m n o p q r s t u v w x y z braceleft bar braceright asciitilde exclamdown cent sterling fraction yen florin section currency quotesingle quotedblleft guillemotleft guilsinglleft guilsinglright fi fl endash dagger daggerdbl periodcentered paragraph bullet quotesinglbase quotedblbase quotedblright guillemotright ellipsis perthousand questiondown grave acute circumflex tilde macron breve dotaccent dieresis ring cedilla hungarumlaut ogonek caron emdash AE ordfeminine Lslash Oslash OE ordmasculine ae dotlessi lslash oslash oe germandbls onesuperior logicalnot mu trademark Eth onehalf plusminus Thorn onequarter divide brokenbar degree thorn threequarters twosuperior registered minus eth multiply threesuperior copyright Aacute Acircumflex Adieresis Agrave Aring Atilde Ccedilla Eacute Ecircumflex Edieresis Egrave Iacute Icircumflex Idieresis Igrave Ntilde Oacute Ocircumflex Odieresis Ograve Otilde Scaron Uacute Ucircumflex Udieresis Ugrave Yacute Ydieresis Zcaron aacute acircumflex adieresis agrave aring atilde ccedilla eacute ecircumflex edieresis egrave iacute icircumflex idieresis igrave ntilde oacute ocircumflex odieresis ograve otilde scaron uacute ucircumflex udieresis ugrave yacute ydieresis zcaron exclamsmall Hungarumlautsmall dollaroldstyle dollarsuperior ampersandsmall Acutesmall parenleftsuperior parenrightsuperior twodotenleader onedotenleader zerooldstyle oneoldstyle twooldstyle threeoldstyle fouroldstyle fiveoldstyle sixoldstyle sevenoldstyle eightoldstyle nineoldstyle commasuperior threequartersemdash periodsuperior questionsmall asuperior bsuperior centsuperior dsuperior esuperior isuperior lsuperior msuperior nsuperior osuperior rsuperior ssuperior tsuperior ff ffi ffl parenleftinferior parenrightinferior Circumflexsmall hyphensuperior Gravesmall Asmall Bsmall Csmall Dsmall Esmall Fsmall Gsmall Hsmall Ismall Jsmall Ksmall Lsmall Msmall Nsmall Osmall Psmall Qsmall Rsmall Ssmall Tsmall Usmall Vsmall Wsmall Xsmall Ysmall Zsmall colonmonetary onefitted rupiah Tildesmall exclamdownsmall centoldstyle Lslashsmall Scaronsmall Zcaronsmall Dieresissmall Brevesmall Caronsmall Dotaccentsmall Macronsmall figuredash hypheninferior Ogoneksmall Ringsmall Cedillasmall questiondownsmall oneeighth threeeighths fiveeighths seveneighths onethird twothirds zerosuperior foursuperior fivesuperior sixsuperior sevensuperior eightsuperior ninesuperior zeroinferior oneinferior twoinferior threeinferior fourinferior fiveinferior sixinferior seveninferior eightinferior nineinferior centinferior dollarinferior periodinferior commainferior Agravesmall Aacutesmall Acircumflexsmall Atildesmall Adieresissmall Aringsmall AEsmall Ccedillasmall Egravesmall Eacutesmall Ecircumflexsmall Edieresissmall Igravesmall Iacutesmall Icircumflexsmall Idieresissmall Ethsmall Ntildesmall Ogravesmall Oacutesmall Ocircumflexsmall Otildesmall Odieresissmall OEsmall Oslashsmall Ugravesmall Uacutesmall Ucircumflexsmall Udieresissmall Yacutesmall Thornsmall Ydieresissmall 001.000 001.001 001.002 001.003 Black Bold Book Light Medium Regular Roman Semibold'.split(' ');

// A font's glyph table: every glyph of its file, and every character the
// documents use (one a file lacks among them, marked so).
export async function fontGlyphs(fontKey: string): Promise<FontGlyphs | null> {
    const inst: { st: BlockData; f: DocFont }[] = [];                              // the fonts, in the blocks, that are this one
    for (const el of I.blocks()) {
        const st = I.state(el);
        if (st) for (const f of st.doc.fonts || []) if (fontKeyOf(f) === fontKey) inst.push({ st, f });
    }
    if (!inst.length) return null;
    const family = familyOf(inst[0].st.fontInfo[inst[0].f.id!]);
    const face0 = faceFromWire(inst[0].f), file = fileOf(inst[0].f);
    // what the documents use: per character, its count, sizes, metrics, codes
    const used = new Map<number, { count: number; tex: [number, number, number, number][]; codes: GlyphCell['codes'] }>();
    for (const { st, f } of inst) {
        const fi = st.fontInfo[f.id!];
        for (const [ch, u] of census(st.doc).glyphs.get(f.id!) || []) {
            let r = used.get(ch);
            if (!r) used.set(ch, r = { count: 0, tex: [], codes: null });
            r.count += u.count;
            const m: { width?: number; height?: number; depth?: number } = u.metrics || {};
            if (!r.tex.some(t => t[0] === f.size_sp)) r.tex.push([f.size_sp, m.width || 0, m.height || 0, m.depth || 0]);
            const cc = fi && fi.codes && fi.codes.get(ch);
            if (cc && !r.codes) r.codes = { lp: cc.lp || 0, rp: cc.rp || 0, ef: cc.ef ?? 1000 };
        }
    }
    const sizes = [...new Set(inst.map(i => i.f.size_sp))].sort((a, b) => a - b);
    // (the rest of it follows)
    const out = { key: fontKey, file, family, sizes, names: [...new Set(inst.map(i => i.f.name!))],
                  status: family ? fontStatus(family) : null, url: family ? fontUrl(family) : null, cells: [] } as unknown as FontGlyphs;
    const f0 = inst[0].f;
    out.micro = { quad: f0.quad || 0, expand: f0.expand_stretch || f0.expand_shrink
        ? `stretch ${f0.expand_stretch || 0}, shrink ${f0.expand_shrink || 0}, step ${f0.expand_step || 0}` : null,
        codes: (f0.codes || []).length };
    const cell = (gid: number | null, name: string | null, cps: number[], adv: number | null): GlyphCell => {
        const u = cps.map(c => used.get(c)).filter(r => !!r);
        return { gid, name, cps, privateUse: cps.filter(isPrivateUse), adv, uses: u.reduce((a, r) => a + r.count, 0),
                 tex: u.length ? u[0].tex : null, codes: u.length ? u[0].codes : null };
    };
    let font: ParsedFont | null = null;
    const noFile = ((): string | null => {
        switch (face0.kind) {
            case 'opentype': case 'type1': case 'bitmap': return null;
            case 'boxes': return `no font file (${face0.reason}), so the viewer draws nothing for its glyphs: each keeps its space and its text`;
            case 'virtual': return 'a virtual font: its glyphs are drawn in the fonts its packets name';
            default: return unreachable(face0, 'font face');
        }
    })();
    if (noFile) out.error = noFile;
    else if (!out.url) out.error = 'no @font-face rule for it on this page';
    else try { font = await loadFontFile(out.url); } catch (e) { out.error = `could not read ${out.url}: ${(e as Error).message || e}`; }
    out.origin = fontOrigin(inst[0].f, family);
    out.puaUsed = [...used.keys()].filter(isPrivateUse).length;
    if (font) {
        out.upem = font.upem; out.numGlyphs = font.numGlyphs;
        out.puaInFile = font.cps.reduce((a, l) => a + l.filter(isPrivateUse).length, 0);
        const mapped = new Set<number>();
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
