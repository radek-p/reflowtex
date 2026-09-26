// SPDX-License-Identifier: AGPL-3.0-or-later

export let   sharedDocType       = null;   // protobuf.js Document type (see loadSchema)

// ── Helpers ───────────────────────────────────────────────────────────────────

export function b64ToBytes(b64) {
    return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

// The page embeds latex.proto as base64 text; parse it at runtime into a
// protobuf.js Document type. keepCase keeps the schema's snake_case field names
// (glyph_metrics, stretch_order, size_sp) – the renderer reads those, not
// protobuf.js's default camelCase. (Runtime .proto parsing is the simple option;
// precompiling a descriptor with pbjs + the minimal runtime is the future size
// win – see README.)
export function loadSchema() {
    const el = document.getElementById('latex-schema');
    if (!el?.dataset.schemaB64) throw new Error('#latex-schema element with data-schema-b64 not found');
    const protoText = new TextDecoder().decode(b64ToBytes(el.dataset.schemaB64));
    const root = protobuf.parse(protoText, { keepCase: true }).root;
    sharedDocType = root.lookupType('latex.Document');
}


// Decode one block. toObject options reproduce the kiwi decode shape exactly:
// defaults:false keeps unset scalars absent (proto2 presence – gW relies on
// width===undefined); arrays:true gives empty repeated fields as [] (not
// undefined); enums:String yields the lowercase enum names the renderer compares
// against ('glyph', 'display'); longs:Number keeps ints as plain numbers.
export function decodeBlock(b64) {
    const msg = sharedDocType.decode(b64ToBytes(b64));
    return sharedDocType.toObject(msg, { defaults: false, arrays: true, enums: String, longs: Number });
}
