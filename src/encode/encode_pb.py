#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Encode a node-list output.json into a protobuf Document (latex.proto).

Replaces encode-standalone.mjs (kiwi). Descriptor-driven: fields are set by
walking the message descriptor, so the .proto is the single source of truth for
which fields exist and their types — the encoder can't drift from it. proto2
presence is preserved by only setting keys that exist in the source dict.

Usage: python3 encode_pb.py <output.json> <nodelist.pb>
"""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import latex_pb2 as L
from google.protobuf.descriptor import FieldDescriptor as FD

# Match encode-standalone.mjs: these are omitted when 0 (the renderer treats
# absent and 0 identically for them), keeping the wire form small and the decoded
# document byte-identical in shape to the kiwi one.
OMIT_IF_ZERO = {'stretch_order', 'shrink_order', 'subtype', 'shift', 'glue_sign', 'glue_order'}
# Fields the pipeline carries but the wire format does not (dropped, as stripNode did).
NOT_ENCODED = {'file', 'gindex'}


def intern_glyph_metrics(doc: dict) -> None:
    """Replace each glyph's inline width/height/depth with a 1-based `metrics`
    index into doc['glyph_metrics'] (deduped). Mirrors internGlyphMetrics()."""
    table, seen = [], {}

    def intern(w, h, d):
        key = (w, h, d)
        i = seen.get(key)
        if i is None:
            table.append({'width': w, 'height': h, 'depth': d})
            i = len(table)
            seen[key] = i
        return i

    def walk(nodes):
        for n in nodes or []:
            if not isinstance(n, dict):
                continue
            if n.get('type') == 'glyph':
                n['metrics'] = intern(n.get('width', 0) or 0,
                                      n.get('height', 0) or 0,
                                      n.get('depth', 0) or 0)
                n.pop('width', None); n.pop('height', None); n.pop('depth', None)
            walk(n.get('children')); walk(n.get('pre')); walk(n.get('post')); walk(n.get('replace'))
            if n.get('leader'):
                walk([n['leader']])

    for p in doc.get('paragraphs', []):
        walk(p.get('nodes'))
    for it in doc.get('content', []):
        if it.get('box'):
            walk([it['box']])
    doc['glyph_metrics'] = table


def fill(msg, d: dict) -> None:
    """Set message fields from a dict, driven by the message descriptor."""
    fields = msg.DESCRIPTOR.fields_by_name
    for k, v in d.items():
        if v is None or k in NOT_ENCODED:
            continue
        f = fields.get(k)
        if f is None:                       # not in the schema -> drop (like stripNode)
            continue
        if k in OMIT_IF_ZERO and v == 0:
            continue
        if f.type == FD.TYPE_ENUM:
            setattr(msg, k, f.enum_type.values_by_name[v].number)
        elif f.type == FD.TYPE_MESSAGE:
            if f.label == FD.LABEL_REPEATED:
                for item in v:
                    fill(getattr(msg, k).add(), item)
            else:
                fill(getattr(msg, k), v)
        else:
            if f.label == FD.LABEL_REPEATED:
                getattr(msg, k).extend(v)
            else:
                setattr(msg, k, v)


def build_document(data: dict) -> L.Document:
    doc = {
        # fonts is a map keyed by id in output.json; the wire form is a list.
        'fonts': [{'id': int(k), 'name': f['name'], 'size_sp': f['size_sp'], 'filename': f['filename']}
                  for k, f in data['fonts'].items()],
        'paragraphs': data.get('paragraphs', []),
        'content': data.get('content', []),
        'pictures': data.get('pictures', []),
    }
    intern_glyph_metrics(doc)
    out = L.Document()
    fill(out, doc)
    return out


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit('Usage: python3 encode_pb.py <output.json> <nodelist.pb>')
    data = json.loads(Path(sys.argv[1]).read_text())
    out = build_document(data)
    blob = out.SerializeToString()
    Path(sys.argv[2]).write_bytes(blob)
    print(f'{sys.argv[2]}  {len(blob)} bytes')


if __name__ == '__main__':
    main()
