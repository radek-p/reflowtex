# SPDX-License-Identifier: AGPL-3.0-or-later
"""Pipeline transforms without TeX: `python3 -m pytest tests/encode`."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'src' / 'encode'))
import transforms  # noqa: E402


def test_batch_part_keeps_its_asides():
    """A part's asides are reached through their marks (Node.aside), and
    renumbered with the other streams; they were dropped before."""
    glyph = lambda t, **k: {'type': 'glyph', 'text': t, **k}
    data = {
        'paragraphs': [
            {'nodes': [glyph('a'), {'type': 'hlist', 'aside': 3, 'children': []}]},   # part 1, with a mark
            {'nodes': [glyph('b')]},                                                 # the aside's text
            {'nodes': [glyph('c')]},                                                 # part 2
        ],
        'content': [{'kind': 'stream', 'stream': 1}, {'kind': 'stream', 'stream': 2}],
        'streams': [
            {'kind': 'batch-part', 'attrs': [{'key': 'part', 'value': '1'}], 'content': [{'kind': 'paragraph', 'para': 1}]},
            {'kind': 'batch-part', 'attrs': [{'key': 'part', 'value': '2'}], 'content': [{'kind': 'paragraph', 'para': 3}]},
            {'kind': 'marginpar', 'attrs': [{'key': 'aside', 'value': 'true'}], 'content': [{'kind': 'paragraph', 'para': 2}]},
        ],
    }
    one, two = transforms.batch_parts(data)
    assert [s['kind'] for s in one['streams']] == ['marginpar']
    marks = [n for p in one['paragraphs'] for n in p['nodes'] if n.get('aside')]
    assert [m['aside'] for m in marks] == [1], 'the mark points at the renumbered aside'
    text = [n['text'] for p in one['paragraphs'] for n in p['nodes'] if n.get('text')]
    assert 'b' in text, "the aside's paragraph is kept"
    assert two['streams'] == []
