// SPDX-License-Identifier: AGPL-3.0-or-later
// Font subsetting with HarfBuzz's subsetter (hb-subset), compiled to
// WebAssembly by the harfbuzzjs package. The module imports nothing, so its C
// API is driven directly: a blob, a face, a subset input, the result.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

interface HB {
  memory: WebAssembly.Memory;
  malloc(n: number): number; free(p: number): void;
  hb_blob_create(p: number, n: number, mode: number, user: number, destroy: number): number;
  hb_blob_destroy(b: number): void; hb_blob_get_data(b: number, lenPtr: number): number; hb_blob_get_length(b: number): number;
  hb_face_create(blob: number, index: number): number; hb_face_destroy(f: number): void; hb_face_reference_blob(f: number): number;
  hb_set_add(s: number, v: number): void; hb_set_clear(s: number): void; hb_set_invert(s: number): void;
  hb_subset_input_create_or_fail(): number; hb_subset_input_destroy(i: number): void;
  hb_subset_input_set(i: number, which: number): number;
  hb_subset_input_get_flags(i: number): number; hb_subset_input_set_flags(i: number, f: number): void;
  hb_subset_or_fail(face: number, input: number): number;
  _initialize?(): void;
}

let hb: HB | null = null;
async function harfbuzz(): Promise<HB> {
  if (hb) return hb;
  const wasm = readFileSync(createRequire(import.meta.url).resolve('harfbuzzjs/dist/harfbuzz-subset.wasm'));
  const { instance } = await WebAssembly.instantiate(wasm);
  hb = instance.exports as unknown as HB;
  hb._initialize?.();
  return hb;
}

const tag = (s: string) => ((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) >>> 0;
// hb-subset.h
const FLAG_NAME_LEGACY = 0x8, FLAG_NOTDEF_OUTLINE = 0x40, FLAG_GLYPH_NAMES = 0x80;
const SET_UNICODE = 1, SET_DROP_TABLE_TAG = 3, SET_NAME_ID = 4, SET_NAME_LANG_ID = 5, SET_LAYOUT_FEATURE_TAG = 6;

/** The font cut down to `unicodes`: every name record kept (so a modified
 *  font still says so), no layout features (the viewer shapes nothing – TeX
 *  set every glyph), a .notdef outline, glyph names. Null if HarfBuzz fails. */
export async function subsetFont(bytes: Uint8Array, unicodes: Iterable<number>, dropTables: string[] = []): Promise<Uint8Array | null> {
  const h = await harfbuzz();
  const ptr = h.malloc(bytes.length);
  new Uint8Array(h.memory.buffer, ptr, bytes.length).set(bytes);
  const blob = h.hb_blob_create(ptr, bytes.length, 2 /* writable */, 0, 0);
  const face = h.hb_face_create(blob, 0);
  const input = h.hb_subset_input_create_or_fail();
  try {
    const uset = h.hb_subset_input_set(input, SET_UNICODE);
    for (const u of unicodes) h.hb_set_add(uset, u);
    for (const which of [SET_NAME_ID, SET_NAME_LANG_ID]) {
      const s = h.hb_subset_input_set(input, which);
      h.hb_set_clear(s); h.hb_set_invert(s);                  // all of them
    }
    h.hb_set_clear(h.hb_subset_input_set(input, SET_LAYOUT_FEATURE_TAG));
    const drop = h.hb_subset_input_set(input, SET_DROP_TABLE_TAG);
    for (const t of dropTables) h.hb_set_add(drop, tag(t));
    h.hb_subset_input_set_flags(input, h.hb_subset_input_get_flags(input) | FLAG_NAME_LEGACY | FLAG_NOTDEF_OUTLINE | FLAG_GLYPH_NAMES);
    const sub = h.hb_subset_or_fail(face, input);
    if (!sub) return null;
    const rblob = h.hb_face_reference_blob(sub);
    const out = new Uint8Array(h.memory.buffer, h.hb_blob_get_data(rblob, 0), h.hb_blob_get_length(rblob)).slice();
    h.hb_blob_destroy(rblob);
    h.hb_face_destroy(sub);
    return out;
  } finally {
    h.hb_subset_input_destroy(input);
    h.hb_face_destroy(face);
    h.hb_blob_destroy(blob);
    h.free(ptr);
  }
}
