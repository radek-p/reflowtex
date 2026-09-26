#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Exact placement: the strip's glyphs and rules against the viewer's.

    vector_compare.py <build dir | pageless.pdf> <url> [--out DIR] [--margin PT]

No pixels. MuPDF's trace (`mutool trace`) gives every glyph LuaTeX wrote
into the strip with its origin, and dom_dump.js gives every glyph the
viewer put on the page (tspan x/y) in the same frame: pt from the column's
margin edge, pt from the top. Each viewer glyph is matched to the nearest
strip glyph (within --window, no character matching: a CM glyph's unicode
differs between the two), and the residuals say where the viewer's
geometry departs from TeX's, to a hundredth of a point:

  - vertical: after the two blocks are aligned at the top, the browser's
    height as a function of position (a drift means the browser's stacking
    loses or gains height);
  - horizontal: per text line, the offset at the line's start (protrusion
    or indentation differences) and the slope along the line (a glue or
    expansion ratio that differs from TeX's);
  - rules: the viewer's rects against the strip's rules, corner by corner,
    at any angle.

Writes vector.json (every matched glyph's residual, the per-line table,
the rule table) and prints the lines that are off. This is the check to
run before compare.py: whatever it reports is geometry, not rasterisation.
"""
from __future__ import annotations
import argparse
import collections
import json
import os
import re
import subprocess
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
PT_PER_BP = 72.27 / 72


def trace_strip(pdf: Path, out: Path) -> tuple[list, list]:
    """Glyphs [(x, y, unicode, font, size)] and rules [4×2 array of corners]
    of the strip's single page, in pt, y from the top."""
    txt = subprocess.run(['mutool', 'trace', str(pdf), '1'], capture_output=True, text=True, check=True).stdout
    out.write_text(txt)
    glyphs, rules = [], []
    for m in re.finditer(r'<fill_text[^>]*transform="([^"]+)">(.*?)</fill_text>', txt, re.S):
        a, b, c, d, e, f = [float(v) for v in m.group(1).split()]
        for sp in re.finditer(r'<span font="([^"]+)"[^>]*trm="([^"]+)">(.*?)</span>', m.group(2), re.S):
            font = sp.group(1).split('+')[-1]
            trm = [float(v) for v in sp.group(2).split()]
            for g in re.finditer(r'<g unicode="([^"]*)" glyph="[^"]*" x="([^"]+)" y="([^"]+)"', sp.group(3)):
                x, y = float(g.group(2)), float(g.group(3))
                glyphs.append(((a * x + c * y + e) * PT_PER_BP, (b * x + d * y + f) * PT_PER_BP,
                               g.group(1), font, trm[3] * PT_PER_BP, trm[0] / trm[3] if trm[3] else 1.0))
    # Rules: the four corners of what each path paints, at any angle. LuaTeX
    # strokes a rule along its centre line, lw thick (butt caps; a square
    # cap reaches lw/2 further), horizontal or vertical as the rule is wide
    # or tall, and under \rotatebox through a rotating transform; a filled
    # four-cornered path is taken as it stands.
    for m in re.finditer(r'<(stroke|fill)_path ([^>]*)>(.*?)</(?:stroke|fill)_path>', txt, re.S):
        attrs = dict(re.findall(r'(\w+)="([^"]*)"', m.group(2)))
        a, b, c, d, e, f = [float(v) for v in attrs['transform'].split()]
        pts = [(float(p.group(1)), float(p.group(2)))
               for p in re.finditer(r'<(?:moveto|lineto) x="([^"]+)" y="([^"]+)"', m.group(3))]
        if m.group(1) == 'stroke':
            if len(pts) != 2:
                continue
            (x0, y0), (x1, y1) = pts
            length = np.hypot(x1 - x0, y1 - y0)
            if length == 0:
                continue
            ux, uy = (x1 - x0) / length, (y1 - y0) / length
            hw = float(attrs['linewidth']) / 2
            cap = hw if attrs.get('linecap', '0').split(',')[0] != '0' else 0.0
            x0, y0, x1, y1 = x0 - ux * cap, y0 - uy * cap, x1 + ux * cap, y1 + uy * cap
            nx, ny = -uy * hw, ux * hw
            pts = [(x0 + nx, y0 + ny), (x1 + nx, y1 + ny), (x1 - nx, y1 - ny), (x0 - nx, y0 - ny)]
        else:
            if len(pts) == 5 and pts[0] == pts[4]:
                pts = pts[:4]
            if len(pts) != 4:
                continue
        rules.append(np.array([((a * x + c * y + e) * PT_PER_BP, (b * x + d * y + f) * PT_PER_BP) for x, y in pts]))
    return glyphs, rules


def dump_dom(url: str, out: Path, hsize: float, margin: float, node: str, wait_log: str | None = None) -> dict:
    cmd = [node, str(HERE / 'dom_dump.js'), url, str(out), '--hsize', repr(hsize), '--margin', repr(margin)]
    if wait_log:
        cmd += ['--wait-log', wait_log]
    r = subprocess.run(cmd, capture_output=True, text=True)
    sys.stderr.write(r.stderr)
    if r.returncode != 0:
        sys.exit(f'dom_dump.js failed ({r.returncode}): {r.stdout}')
    return json.loads(out.read_text())


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('build', type=Path)
    ap.add_argument('url')
    ap.add_argument('--out', type=Path, default=None)
    ap.add_argument('--margin', type=float, default=None, help='white either side of the column, pt (default: the strip\'s)')
    ap.add_argument('--window', type=float, default=0.7, help='largest distance (pt) between a viewer glyph and the strip glyph it is taken to be')
    ap.add_argument('--line-tol', type=float, default=0.1, help='a line is reported when a glyph on it is off by more than this (pt)')
    ap.add_argument('--node', default='node')
    ap.add_argument('--wait-log', default=None, help='before dumping, wait for a console line containing this text')
    args = ap.parse_args()

    pdf = args.build / 'pageless.pdf' if args.build.is_dir() else args.build
    meta = json.loads(pdf.with_name('pageless.json').read_text())
    sp = meta['sp_per_pt']
    hsize, strip_margin = meta['hsize'] / sp, meta['margin'] / sp
    margin = strip_margin if args.margin is None else args.margin
    out = args.out or pdf.parent / 'vector'
    out.mkdir(parents=True, exist_ok=True)

    P, rules = trace_strip(pdf, out / 'trace.txt')
    dom = dump_dom(args.url, out / 'dom.json', hsize, margin, args.node, args.wait_log)
    G = dom['glyphs']
    print(f'strip: {len(P)} glyphs, {len(rules)} rules; viewer: {len(G)} glyphs, {len(dom["rects"])} rects')

    # the viewer's frame starts `margin` left of the column; the strip's `strip_margin`
    shift = strip_margin - margin
    Pxy = np.array([(g[0], g[1]) for g in P]) if P else np.zeros((0, 2))
    D = np.array([(g['x'] + shift, g['y']) for g in G]) if G else np.zeros((0, 2))
    order = np.argsort(Pxy[:, 1]); Py = Pxy[order, 1]
    matched = []                       # (dom index, strip index, dx, dy) with dx/dy = strip − viewer
    for j, g in enumerate(G):
        if not g['text'].strip():
            continue
        ty = D[j, 1]
        lo, hi = np.searchsorted(Py, ty - args.window), np.searchsorted(Py, ty + args.window)
        if hi <= lo:
            continue
        cand = order[lo:hi]
        dd = np.abs(Pxy[cand] - D[j])
        ok = np.where(dd[:, 0] < args.window)[0]
        if len(ok) == 0:
            continue
        k = ok[np.argmin(dd[ok].sum(1))]
        matched.append((j, int(cand[k]), float(Pxy[cand[k], 0] - D[j, 0]), float(Pxy[cand[k], 1] - D[j, 1])))
    n_ink = sum(1 for g in G if g['text'].strip())
    print(f'matched {len(matched)} of {n_ink} viewer glyphs within {args.window} pt')
    if not matched:
        sys.exit('nothing matched: are the two the same document at the same width?')
    M = np.array([(m[2], m[3]) for m in matched])
    ys = np.array([G[m[0]]['y'] for m in matched])

    # vertical: the drift, as the median dy per 250 pt of height
    edges = np.arange(0, ys.max() + 250, 250)
    drift = []
    for e0, e1 in zip(edges, edges[1:]):
        s = (ys >= e0) & (ys < e1)
        drift.append(round(float(np.median(M[s, 1])), 3) if s.sum() > 10 else None)
    print(f'vertical (strip − viewer, pt): mean {M[:, 1].mean():+.3f}, sd {M[:, 1].std():.3f}, '
          f'largest {np.abs(M[:, 1]).max():.3f}; drift per 250 pt: {[d for d in drift if d is not None][:8]} … {[d for d in drift if d is not None][-3:]}')

    # horizontal, per line (glyphs sharing a baseline): offset at the start, slope along the line
    lines = collections.defaultdict(list)
    for (j, i, dx, dy) in matched:
        lines[round(G[j]['y'], 2)].append((D[j, 0], dx, G[j]['text']))
    table = []
    for y, pts in sorted(lines.items()):
        pts.sort()
        x = np.array([p[0] for p in pts]); dx = np.array([p[1] for p in pts])
        slope = float(np.polyfit(x, dx, 1)[0] * 100) if len(pts) >= 6 and x.max() - x.min() > 50 else 0.0
        table.append({'y': y, 'glyphs': len(pts), 'start_dx': round(float(dx[0]), 3), 'end_dx': round(float(dx[-1]), 3),
                      'max_abs_dx': round(float(np.abs(dx).max()), 3), 'slope_pt_per_100pt': round(slope, 3),
                      'text': ''.join(p[2] for p in pts)[:60]})
    off = [t for t in table if t['max_abs_dx'] > args.line_tol]
    print(f'horizontal: {len(table)} lines, {len(off)} with a glyph off by more than {args.line_tol} pt')
    for t in sorted(off, key=lambda t: -t['max_abs_dx'])[:25]:
        print(f'  y {t["y"]:9.2f}  start {t["start_dx"]:+.2f}  end {t["end_dx"]:+.2f}  slope {t["slope_pt_per_100pt"]:+.3f}/100pt  {t["text"]!r}')

    # rules: each viewer rect against the strip rule whose corners are
    # nearest. `off` is the farthest any corner of either is from the
    # other's nearest corner (pt): position, size and angle in one number.
    # dx/dy are the move between their centres (strip − viewer).
    def corner_distance(A, B):
        dd = np.hypot(*(A[:, None, :] - B[None, :, :]).transpose(2, 0, 1))
        return max(dd.min(1).max(), dd.min(0).max())
    centres = np.array([q.mean(0) for q in rules]) if rules else np.zeros((0, 2))
    rule_rows, drawn = [], set()
    for r in dom['rects']:
        if r['w'] <= 0 or r['h'] <= 0:
            continue
        V = np.array(r['pts']) + [shift, 0]
        c = V.mean(0)
        near = np.where(np.abs(centres - c).max(1) < 2 + np.ptp(V, 0).max() / 2)[0] if len(rules) else []
        best = min(((corner_distance(V, rules[k]), k) for k in near), default=None)
        if best and best[0] < 2:
            off, k = best
            drawn.add(k)
            rule_rows.append({'y': round(r['y'], 2), 'x': round(r['x'] + shift, 2), 'off': round(float(off), 3),
                              'dx': round(float(centres[k, 0] - c[0]), 3), 'dy': round(float(centres[k, 1] - c[1]), 3)})
        else:
            rule_rows.append({'y': round(r['y'], 2), 'unmatched': True, 'w': round(r['w'], 2), 'h': round(r['h'], 2)})
    # and the rules TeX drew that the browser did not
    missing = [{'y': round(float(rules[k][:, 1].min()), 2), 'x': round(float(rules[k][:, 0].min()), 2)}
               for k in range(len(rules)) if k not in drawn]
    rm = [r for r in rule_rows if 'dx' in r]
    if rm:
        a = np.array([(r['dx'], r['dy']) for r in rm])
        print(f'rules: {len(rm)} matched of {len(rule_rows)} drawn, {len(missing)} of TeX\'s not drawn; '
              f'strip − viewer x sd {a[:, 0].std():.3f}, y sd {a[:, 1].std():.3f}, '
              f'largest corner distance {max(r["off"] for r in rm):.3f} pt')
    for r in sorted((r for r in rm if r['off'] > args.line_tol), key=lambda r: -r['off'])[:10]:
        print(f'  rule at y {r["y"]:9.2f}: corners {r["off"]:.2f} pt off, centre dx {r["dx"]:+.2f} dy {r["dy"]:+.2f} pt')

    (out / 'vector.json').write_text(json.dumps({
        'hsize_pt': hsize, 'margin_pt': margin, 'window_pt': args.window,
        'glyphs': {'strip': len(P), 'viewer': n_ink, 'matched': len(matched)},
        'vertical': {'mean': round(float(M[:, 1].mean()), 4), 'sd': round(float(M[:, 1].std()), 4),
                     'max_abs': round(float(np.abs(M[:, 1]).max()), 4), 'drift_per_250pt': drift},
        'lines': table, 'lines_off': off, 'rules': rule_rows, 'rules_missing': missing,
        'matched': [{'y': round(G[j]['y'], 2), 'x': round(D[j, 0], 2), 'text': G[j]['text'], 'font': G[j]['font'],
                     'dx': round(dx, 3), 'dy': round(dy, 3)} for (j, i, dx, dy) in matched],
    }, indent=1))
    print(f'→ {out / "vector.json"}')


if __name__ == '__main__':
    main()
