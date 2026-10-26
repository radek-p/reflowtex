// SPDX-License-Identifier: AGPL-3.0-or-later
// The faces the blocks draw in: one FontFace per font file (by its original
// name, its family derived from it), made by script and added to
// document.fonts – never an @font-face rule, since Chromium makes every CSS
// face anew, unloaded, whenever a style sheet is added, and each new block's
// fonts (or any other style element) then made every family on screen load
// again. A face comes from the font map's served file beside the script
// (fontBase, data-fonts-base, #latex-font-map), or from what the page gave
// (host.fonts.provide: bytes or a URL). A font given again replaces its face
// only once the new file has loaded, and the blocks are drawn again.
//
//   registerFonts(fontsData) -> FontTable    a block's fonts: faces made (or shared), loaded
//   provideFont(file, source) -> Promise      host.fonts.provide
//   fontLoaded(file) · familyLoaded(family) · familyLoading(family) · whenFamilyLoaded(family) · fontsReady() · faceRecords()

import { ZOOM } from '../engine/core.ts';
import { SCRIPT_URL } from './page.ts';
import { report } from './log.ts';
import { scheduleFontRepaint } from './blocks.ts';
import { faceFromWire } from '../../../shared/font-face.ts';
import { unreachable } from '../../../shared/unreachable.ts';
import type { DocFont, FontTable, ViewerFace } from '../engine/model.ts';

// fontInfo is intentionally NOT global – font IDs are per-compilation and collide
// across blocks (e.g. both block 1 and block 2 may use ID 54 for different files).
// Each block gets its own map returned from registerFonts().
export const registeredFontFaces = new Set<string>();

export let   fontUrlMap: Record<string, string> = {};     // original font filename → served filename (see loadFontMap)
// Fonts are deployed beside this script. Resolving from the script URL keeps the
// viewer portable across a domain root, arbitrary subpaths, and local previews
// (including a page opened straight off disk over file://, where an absolute
// '/fonts/'-style path can't resolve at all – see loadFontMap's handling of
// data-fonts-base below, which must preserve this same resolution).
export let   fontBase            = SCRIPT_URL
    ? new URL('fonts/', SCRIPT_URL).href
    : '/fonts/';
export let   fontsPending        = false;  // a face still had to be fetched at first paint (see registerFonts / init)

// ── Faces ─────────────────────────────────────────────────────────────────────

/** Where a face's file comes from: bytes, or a URL. */
export type FontSource = ArrayBuffer | Uint8Array | string;
interface Face {
    file: string;
    family: string;
    face: FontFace;
    /** a URL source, for tools (null: from bytes) */
    url: string | null;
    bytes: ArrayBuffer | null;
    /** settles when the face has loaded or failed */
    settled: Promise<void>;
}
const faces = new Map<string, Face>();          // family → its face in effect
const given = new Map<string, FontSource>();     // file → what the page gave, before its first block
const latest = new Map<string, FontFace>();       // family → the newest face asked for (a later provide wins)
const swaps = new Set<Promise<void>>();

/** A font file's family: its original name, without .otf, safe as a CSS name. */
export const familyOf = (file: string): string => file.replace(/\.otf$/i, '').replace(/[^a-zA-Z0-9]/g, '_');

function asBuffer(src: ArrayBuffer | Uint8Array): ArrayBuffer {
    if (src instanceof ArrayBuffer) return src;
    return src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength) as ArrayBuffer;
}
function makeFace(file: string, family: string, src: FontSource): Face {
    const bytes = typeof src === 'string' ? null : asBuffer(src);
    const url = typeof src === 'string' ? new URL(src, document.baseURI).href : null;
    const face = new FontFace(family, bytes ?? `url(${JSON.stringify(url)})`);
    const settled = face.loaded.then(() => {}, () => {});
    return { file, family, face, url, bytes, settled };
}

/** The face of a block's font, made the first time (from what the page gave, else the served file) and added to
 *  the document; shared by every block after. */
function ensureFace(file: string, family: string): Face {
    let f = faces.get(family);
    if (f) return f;
    const src = given.get(file) ?? `${fontBase}${fontUrlMap[file] || file}`;
    given.delete(file);
    f = makeFace(file, family, src);
    faces.set(family, f);
    document.fonts.add(f.face);
    void f.face.load().catch(() => {});
    return f;
}

/** host.fonts.provide: a font's file, by its original name. Before any block uses it, it is where its face will
 *  come from; after, the face is replaced once the new file has loaded (a failure leaves the old one, with a
 *  warning), and the blocks are drawn again. True once it is in effect (or will be, for a font no block uses yet);
 *  false when its file could not be loaded, or a newer one was given meanwhile. */
export function provideFont(file: string, source: FontSource): Promise<boolean> {
    const family = familyOf(file);
    const old = faces.get(family);
    if (!old) { given.set(file, source); return Promise.resolve(true); }
    const next = makeFace(file, family, source);
    if (old.url !== null && old.url === next.url) return old.settled.then(() => old.face.status === 'loaded');
    latest.set(family, next.face);
    const swap = next.face.load().then(() => {
        if (latest.get(family) !== next.face) return false;          // a newer one was given meanwhile
        latest.delete(family);
        document.fonts.add(next.face);
        document.fonts.delete(old.face);
        faces.set(family, next);
        scheduleFontRepaint();
        return true;
    }, (e: unknown) => {
        if (latest.get(family) === next.face) latest.delete(family);
        report('warning', 'font-replace-failed', `font ${file}: the new file could not be loaded (${(e as Error)?.message ?? e}); the previous one stays`, { font: file, error: e });
        return false;
    });
    const done = swap.then(() => {}).finally(() => swaps.delete(done));
    swaps.add(done);
    return swap;
}

const loadedFace = (f: Face | undefined) => !!f && f.face.status === 'loaded';
/** Whether a font's face has loaded (by its original file name). */
export const fontLoaded = (file: string): boolean => loadedFace(faces.get(familyOf(file)));
/** Whether a family's face has loaded (a block's FontInfo.family). */
export const familyLoaded = (family: string): boolean => loadedFace(faces.get(family));
/** Whether a family's face is still on its way (made by the viewer, neither loaded nor failed): what to wait for. */
export function familyLoading(family: string): boolean {
    const st = faces.get(family)?.face.status;
    return st === 'unloaded' || st === 'loading';
}
/** Settles once a family's face has loaded or failed (at once for one the viewer did not make). */
export const whenFamilyLoaded = (family: string): Promise<void> => faces.get(family)?.settled ?? Promise.resolve();
/** Settles once every face asked for so far, and every replacement on its way, has loaded or failed. */
export async function fontsReady(): Promise<void> {
    await Promise.all([...[...faces.values()].map(f => f.settled), ...swaps]);
}
/** The faces in effect, for tools (the inspector reads a font's file through them). */
export function faceRecords(): { file: string; family: string; status: FontFaceLoadStatus; url: string | null; bytes: ArrayBuffer | null }[] {
    return [...faces.values()].map(f => ({ file: f.file, family: f.family, status: f.face.status, url: f.url, bytes: f.bytes }));
}

// ── Font loading ──────────────────────────────────────────────────────────────

export async function registerFonts(fontsData: Record<string, DocFont>): Promise<FontTable> {
    const fontInfo: FontTable = {};
    const fileToFamily: Record<string, string> = {};
    /** each file's font, by its own name: cmr12, not the served cmr12.reflowtex-dfb1fe6f.otf */
    const fileToName: Record<string, string> = {};
    // The face each font is drawn with (src/shared/font-face.ts), as the
    // pipeline decided it: from a file – its FontFace made once (ensureFace),
    // under a family keyed off the file's *original* name (its stable
    // identity across blocks), fetched from the file the font map gives (for
    // a modified font a renamed, content-hashed file; the map is empty on
    // pages that don't ship it, so it falls back to the name as-is) – or
    // none, its glyphs drawn as boxes.
    const faceOf = (f: DocFont): ViewerFace => {
        const face = faceFromWire(f);
        switch (face.kind) {
            case 'opentype': case 'type1': case 'bitmap': {
                const file = face.file;
                if (!fileToFamily[file]) {
                    const family = familyOf(file);
                    ensureFace(file, family);
                    registeredFontFaces.add(file);
                    fileToFamily[file] = family;
                    fileToName[file] = face.kind !== 'opentype' ? (f.name || family) : file.replace(/\.[^.]*$/, '');
                }
                return { kind: 'text', family: fileToFamily[file] };
            }
            case 'boxes': return { kind: 'boxes', reason: face.reason };
            // its glyphs are drawn in the fonts its packets name: none is in it
            case 'virtual': return { kind: 'boxes', reason: 'a virtual font, drawn in the fonts it names' };
            default: return unreachable(face, 'font face');
        }
    };

    // No font-feature-settings are applied: glyphs that are not the cmap
    // default for their codepoint (script-size variants, accents, …) are
    // rewritten to dedicated PUA codepoints by the pipeline (addressing.ts),
    // so every glyph renders identically in every browser without relying on
    // GSUB features.
    for (const [idStr, f] of Object.entries(fontsData)) {
        fontInfo[idStr] = {
            face:    faceOf(f),
            size_px: (f.size_sp / 65536) * ZOOM,
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

    const families = [...new Set(Object.values(fileToFamily))];

    // A face that still has to be fetched (cold cache) can first paint as a
    // fallback, and SVG <text> – notably in Firefox – does not always re-rasterise
    // when the real face arrives. Note it so init() can force one repaint once the
    // faces have settled; a warm load (every face already cached, so the first
    // paint is already correct) leaves this false and pays for no second render.
    if (families.some(fam => !familyLoaded(fam))) fontsPending = true;

    // A font that fails to load (a missing file, a network blip) must not
    // reject and blank the whole block – its glyphs fall back. Tell the
    // reader about a failed one, once per page, by the font's own name.
    await Promise.all(families.map(fam => whenFamilyLoaded(fam)));
    const failed = families.filter(fam => faces.get(fam)?.face.status === 'error')
        .map(fam => { const file = Object.keys(fileToFamily).find(k => fileToFamily[k] === fam); return file ? fileToName[file] : fam; });
    if (failed.length) reportFontFailure(failed);
    return fontInfo;
}

// ── A warning when fonts fail ─────────────────────────────────────────────────
// Without its fonts a block still lays out (the metrics travel with the
// document) but draws its glyphs in a stand-in face, or not at all for the
// symbol fonts of mathematics – which a reader cannot tell from a broken page.
// So a failed download is logged (font-load-failed, an error) naming every
// font that failed so far; the page's log shows it to readers unless the page
// is configured otherwise (log.ts).
export const failedFonts = new Set<string>();
export function reportFontFailure(names: string[]): void {
    for (const n of names) failedFonts.add(n);
    const list = [...failedFonts];
    const shown = list.slice(0, 4).join(', ') + (list.length > 4 ? ` and ${list.length - 4} more` : '');
    report('error', 'font-load-failed', `Some fonts could not be downloaded (${shown}). `
        + 'Text may appear in a stand-in font, and mathematics may be missing.', { fonts: list.join(', ') });
}

// Optional: {original filename → served filename} written into the page as a JSON
// island (the integrations: prebuild.ts, build.ts). Lets a modified font be fetched from its
// renamed, content-hashed file while blocks still refer to it by its original
// name. Absent → registerFonts falls back to the original name.
export function loadFontMap(): void {
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
    if (!el.textContent!.trim()) return;
    try { fontUrlMap = JSON.parse(el.textContent!); }
    catch { fontUrlMap = {}; }
}
