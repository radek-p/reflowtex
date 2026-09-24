#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Encode a node-list output.json into a protobuf Document (latex.proto).

Replaces encode-standalone.mjs (kiwi). Descriptor-driven: fields are set by
walking the message descriptor, so the .proto is the single source of truth for
which fields exist and their types – the encoder can't drift from it. proto2
presence is preserved by only setting keys that exist in the source dict.

Usage: python3 encode_pb.py <output.json> <nodelist.pb>
"""
import json, re, sys
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
    for stream in doc.get('streams', []):
        for it in stream.get('content', []):
            if it.get('box'):
                walk([it['box']])
    doc['glyph_metrics'] = table


# A handful of commands that stand for text, for outline titles.
_TEXT_COMMANDS = {
    'ldots': '…', 'dots': '…', 'TeX': 'TeX', 'LaTeX': 'LaTeX', 'AmS': 'AMS',
    'alpha': 'α', 'beta': 'β', 'gamma': 'γ', 'delta': 'δ', 'epsilon': 'ε',
    'lambda': 'λ', 'mu': 'μ', 'pi': 'π', 'sigma': 'σ', 'phi': 'φ', 'omega': 'ω',
    'Gamma': 'Γ', 'Delta': 'Δ', 'Lambda': 'Λ', 'Sigma': 'Σ', 'Phi': 'Φ', 'Omega': 'Ω',
    'infty': '∞', 'times': '×', 'le': '≤', 'ge': '≥', 'to': '→', 'S': '§',
}


def tex_to_text(s: str) -> str:
    """Plain text from a title as TeX source (detokenized): known symbol
    commands become their character, every other command is dropped (its
    braced argument kept), and braces, $ and ties go. Good enough for a table
    of contents; the typeset heading is what the reader sees in the text."""
    s = s.replace('---', '—').replace('--', '–').replace('~', ' ')
    s = s.replace('``', '“').replace("''", '”').replace('`', '‘').replace("'", '’')
    s = re.sub(r'\\([A-Za-z]+)\s*', lambda m: _TEXT_COMMANDS.get(m.group(1), ''), s)
    s = re.sub(r'\\(.)', r'\1', s)            # \{ \% \& …
    s = s.replace('{', '').replace('}', '').replace('$', '')
    return re.sub(r'\s+', ' ', s).strip()


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
            if f.is_repeated:
                for item in v:
                    fill(getattr(msg, k).add(), item)
            else:
                fill(getattr(msg, k), v)
        else:
            if f.is_repeated:
                getattr(msg, k).extend(v)
            else:
                setattr(msg, k, v)


def _font_entry(fid: str, f: dict) -> dict:
    entry = {'id': int(fid), 'name': f['name'], 'size_sp': f['size_sp'], 'filename': f['filename']}
    # Microtypography the serializer recorded (see FontInfo in latex.proto);
    # older output.json files simply lack the keys.
    for key in ('quad', 'expand_stretch', 'expand_shrink', 'expand_step', 'codes'):
        if key in f:
            entry[key] = f[key]
    return entry


def build_document(data: dict) -> L.Document:
    doc = {
        # fonts is a map keyed by id in output.json; the wire form is a list.
        # (Lua writes an empty table as [] – a block with no text, a lone
        # picture, has no fonts)
        'fonts': [_font_entry(k, f) for k, f in (data.get('fonts') or {}).items()]
                 if isinstance(data.get('fonts'), dict) else [],
        'paragraphs': data.get('paragraphs', []),
        'content': data.get('content', []),
        'pictures': data.get('pictures', []),
        'streams': data.get('streams', []),
        'outline': [dict(e, title=tex_to_text(e.get('title', '')),
                         number=tex_to_text(e.get('number', '')))
                    for e in data.get('outline', [])],
        'source_width': data.get('source_width'),
        'display_model': data.get('display_model'),
        # Lua writes an empty table as [], so these are always lists.
        'links': data.get('links', []),
        'anchors': data.get('anchors', []),
        'slots': data.get('slots', []),
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
