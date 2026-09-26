# SPDX-License-Identifier: AGPL-3.0-or-later
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))


def pytest_configure(config):
    config.addinivalue_line('markers', 'slow: a whole document (testmath); skipped by make test-render')


def pytest_terminal_summary(terminalreporter, config):
    """Each test's worst glyph and rule, against its ceiling and the target
    (cases.toml): a test doing better than its ceiling says to lower it."""
    import render
    rows = config.stash.get(render.WORST, [])
    if not rows:
        return
    tr = terminalreporter
    tr.section('render: worst offsets (pt)')
    tr.write_line(f'{"test":<28} {"glyph":>7} {"ceiling":>8} {"rule":>7} {"ceiling":>8}   target {rows[0][1]["target"]}')
    lower = set()
    for tid, case, (g, r) in sorted(rows, key=lambda x: x[0]):
        rt = case.get('rule_tolerance', case['tolerance'])
        note = []
        if g <= case['target'] and (r is None or r <= case['target']):
            note.append('meets target')
        # a case's ceilings are its worst over all its widths
        by_case = [(g2, r2) for t2, c2, (g2, r2) in rows if c2['name'] == case['name']]
        if len(by_case) == len(case['widths']):
            cg = max(x[0] for x in by_case)
            cr = max((x[1] for x in by_case if x[1] is not None), default=None)
            if cg < case['tolerance'] or (cr is not None and cr < rt):
                lower.add((case['name'], cg, cr))
        rule = '' if r is None else f'{r:.3f}'
        rceil = '' if r is None else f'{rt:.3f}'
        tr.write_line(f'{tid:<28} {g:>7.3f} {case["tolerance"]:>8.3f} {rule:>7} {rceil:>8}   {", ".join(note)}')
    for name, cg, cr in sorted(lower):
        tr.write_line(f'{name} does better than its ceilings: lower them in cases.toml to '
                      f'tolerance = {cg:.3f}' + (f', rule_tolerance = {cr:.3f}' if cr is not None else ''))
