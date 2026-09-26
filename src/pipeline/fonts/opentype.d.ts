// SPDX-License-Identifier: AGPL-3.0-or-later
// The part of opentype.js (which ships no types) the pipeline uses: building a
// CFF-flavoured OpenType font from glyph outlines, and reading a font back
// (the tests compare outlines through it).
declare module 'opentype.js' {
  export interface PathCommand { type: 'M' | 'L' | 'C' | 'Q' | 'Z'; x?: number; y?: number; x1?: number; y1?: number; x2?: number; y2?: number }
  export class Path {
    commands: PathCommand[];
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    curveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void;
    close(): void;
  }
  export class Glyph {
    constructor(options: { name: string; advanceWidth: number; path: Path; unicodes?: number[]; unicode?: number });
    name: string;
    advanceWidth: number;
    unicodes: number[];
    path: Path;
  }
  export interface FontOptions {
    familyName: string; styleName: string; fullName?: string; postScriptName?: string;
    unitsPerEm: number; ascender: number; descender: number; glyphs: Glyph[];
  }
  export class Font {
    constructor(options: FontOptions);
    toArrayBuffer(): ArrayBuffer;
    unitsPerEm: number;
    glyphs: { length: number; get(i: number): Glyph };
    charToGlyph(c: string): Glyph;
  }
  export function parse(buffer: ArrayBuffer): Font;
  // Node loads the package's CommonJS build ("main"; it has no "exports"),
  // so the API is the default export.
  const opentype: { Path: typeof Path; Glyph: typeof Glyph; Font: typeof Font; parse: typeof parse };
  export default opentype;
}
