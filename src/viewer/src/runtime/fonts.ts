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
import { SCRIPT_URL, api } from './page.ts';
import { scheduleFontRepaint } from './blocks.ts';
import type { DocFont, FontTable } from '../engine/model.ts';

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
        console.warn(`[latex-viewer] font ${file}: the new file could not be loaded (${(e as Error)?.message ?? e}); the previous one stays`);
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
    for (const f of Object.values(fontsData)) {
        const file = f.filename!;
        if (fileToFamily[file]) continue;
        // A font the serializer could not resolve to an OTF file (filename
        // 'unknown' – e.g. a Type1 math font with no OpenType form) has nothing to
        // fetch. Map it to a system serif so its glyphs fall back, rather than
        // making a face that is guaranteed to fail.
        if (!file || file === 'unknown') { fileToFamily[file] = 'serif'; continue; }
        // The family is keyed off the font's *original* name (its stable identity
        // across blocks); the file it is fetched from comes from the font map,
        // which for a modified font is a renamed, content-hashed file (the map is
        // empty on pages that don't ship it, so it falls back to the name as-is).
        const family = familyOf(file);
        ensureFace(file, family);
        registeredFontFaces.add(file);
        fileToFamily[file] = family;
    }

    // No font-feature-settings are applied: glyphs that are not the cmap
    // default for their codepoint (script-size variants, accents, …) are
    // rewritten to dedicated PUA codepoints by prebuild.py, so every glyph
    // renders identically in every browser without relying on GSUB features.
    for (const [idStr, f] of Object.entries(fontsData)) {
        fontInfo[idStr] = {
            family:  fileToFamily[f.filename!]!,
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
    if (families.some(fam => !familyLoaded(fam))) fontsPending = true;

    // A font that fails to load (a missing file, a network blip) must not
    // reject and blank the whole block – its glyphs fall back (or are drawn as
    // metric boxes; see the sink). 'serif' is a system family and needs no
    // loading. Tell the reader about a failed one, once per page.
    await Promise.all(families.map(fam => whenFamilyLoaded(fam)));
    const failed = families.filter(fam => faces.get(fam)?.face.status === 'error')
        .map(fam => Object.keys(fileToFamily).find(k => fileToFamily[k] === fam) ?? fam)
        // by the font's own name: cmr12, not the served cmr12.reflowtex-dfb1fe6f.otf
        .map(file => file.replace(/\.otf$/i, '').replace(/\.reflowtex-[0-9a-f]+$/, ''));
    if (failed.length) reportFontFailure(failed);
    return fontInfo;
}

// ── A warning when fonts fail ─────────────────────────────────────────────────
// Without its fonts a block still lays out (the metrics travel with the
// document) but draws its glyphs in a stand-in face, or not at all for the
// symbol fonts of mathematics – which a reader cannot tell from a broken page.
// So a failed download shows a bar at the bottom of the window, as a cookie
// notice does, naming the fonts and offering a reload. A page may style it
// (.latex-font-warning) or switch it off: window.reflowtex.fontWarning = false.
export const failedFonts = new Set<string>();
export let fontWarning: HTMLDivElement | null = null;
export function reportFontFailure(names: string[]): void {
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
          /* display: flex above would outrank the hidden attribute Dismiss sets */
          .latex-font-warning[hidden] { display: none; }
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
            const act = (e.target as Element).closest('button')?.dataset.act;
            if (act === 'reload') location.reload();
            if (act === 'close') fontWarning!.hidden = true;
        });
        document.body.appendChild(fontWarning);
    }
    const list = [...failedFonts];
    const shown = list.slice(0, 4).join(', ') + (list.length > 4 ? ` and ${list.length - 4} more` : '');
    fontWarning.querySelector('p')!.innerHTML = '<strong>Some fonts could not be downloaded</strong> '
        + `(${shown.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' } as Record<string, string>)[c]!)}). `
        + 'Text may appear in a stand-in font, and mathematics may be missing.';
}

// Optional: {original filename → served filename} written into the page as a JSON
// island (prebuild.py / build.py). Lets a modified font be fetched from its
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
