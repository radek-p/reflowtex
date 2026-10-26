// SPDX-License-Identifier: AGPL-3.0-or-later
// How a font's glyphs reach the page: the one record of it, for the whole
// project. The pipeline decides it once per font (src/pipeline/fonts) and
// records it on the font; it travels on the wire (latex.proto, FontInfo:
// kind, filename, reason) and the viewer and the inspector read it from
// there. Nothing else tells one kind from another – not a font's file name,
// and no sentinel. Every decision over it is a switch that names each kind,
// so a new kind fails to compile wherever it has to be handled.
//
// It imports only its neighbour, so it runs anywhere: in Node, and bundled
// into the viewer and the inspector.
import { unreachable } from './unreachable.ts';

/** A font's face.
 *  - opentype: the OpenType file TeX loaded (fontspec, unicode-math), served
 *    as it is or with its cmap completed (src/pipeline/fonts/fonts.ts, patch);
 *  - type1: a classic TeX font's Type 1 outlines, converted by the pipeline
 *    into an OpenType file of its own (src/pipeline/fonts/type1.ts);
 *  - bitmap: a classic font with only a METAFONT source, rendered by
 *    METAFONT at a high resolution and served as an OpenType file of the
 *    outlines of its pixels (src/pipeline/fonts/metafont.ts);
 *  - virtual: a virtual font (its .vf's packets), each glyph of which the
 *    pipeline drew as the characters of the fonts the packets name, which
 *    have faces of their own (src/pipeline/fonts/vf.ts): no glyph is drawn
 *    from it;
 *  - boxes: no outline any producer could give; each glyph is drawn as a box
 *    of the size TeX gave it, and `reason` says why. */
export type TexFontFace =
    | { kind: 'opentype'; file: string }
    | { kind: 'type1'; file: string }
    | { kind: 'bitmap'; file: string }
    | { kind: 'virtual' }
    | { kind: 'boxes'; reason: string };
export type FontKind = TexFontFace['kind'];
/** The faces drawn from a font file. */
export type FileFace = Extract<TexFontFace, { file: string }>;

/** Every kind, as latex.proto's FontKind enum names them (checked by the
 *  unit tests). */
export const FONT_KINDS: readonly FontKind[] = ['opentype', 'type1', 'boxes', 'virtual', 'bitmap'];

/** The file a face is drawn from, or null when it has none. */
export function faceFile(face: TexFontFace): string | null {
    switch (face.kind) {
        case 'opentype': case 'type1': case 'bitmap': return face.file;
        case 'virtual': case 'boxes': return null;
        default: return unreachable(face, 'font face');
    }
}

/** FontInfo's face fields on the wire. */
export interface WireFace { kind?: string; filename?: string; reason?: string }

/** A face as latex.proto carries it. */
export function faceToWire(face: TexFontFace): { kind: FontKind; filename?: string; reason?: string } {
    switch (face.kind) {
        case 'opentype': case 'type1': case 'bitmap': return { kind: face.kind, filename: face.file };
        case 'virtual': return { kind: face.kind };
        case 'boxes': return { kind: face.kind, reason: face.reason };
        default: return unreachable(face, 'font face');
    }
}

/** A face as decoded from the wire. Data that does not make a face (a kind
 *  this code does not know, a file face with no file) is drawn as boxes,
 *  saying so: a page never fails over one font. */
export function faceFromWire(w: WireFace): TexFontFace {
    const kind = w.kind as FontKind | undefined;
    switch (kind) {
        case 'opentype': case 'type1': case 'bitmap':
            return w.filename ? { kind, file: w.filename } : { kind: 'boxes', reason: `a ${kind} font that names no file` };
        case 'virtual': return { kind };
        case 'boxes': return { kind, reason: w.reason ?? '' };
        case undefined: return { kind: 'boxes', reason: 'the document does not say how the font is drawn' };
        default: {
            const other: never = kind;
            return { kind: 'boxes', reason: `a kind of font this viewer does not know (${String(other)})` };
        }
    }
}
