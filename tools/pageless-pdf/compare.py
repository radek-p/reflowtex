#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Compare the pageless strip with the browser's rendering, pixel row by row.

    compare.py <build dir | pageless.pdf> <page url> [options]

Both sides are rendered at the same scale, --ppp device pixels per TeX point
(default 2: the viewer's 2 CSS px/pt at device scale 1; pdftoppm at
ppp x 72.27 dpi), in the same frame: the column of \\hsize with --margin M
points of white either side. M defaults to the strip's own margin from
pageless.json; a smaller M crops the strip and pads the browser alike, so
there is one margin, not two.

The two images are aligned the way text files are diffed, with lines as the
unit. Each image is cut into *bands* — runs of pixel rows that carry ink,
i.e. lines of text, displays, rules — and every band is reduced to its ink
profile (mean ink per column, pooled over --block pixels). Bands are then
matched in order by profile correlation (sequence alignment with free gaps:
a band pairs with another only when they correlate above --match, in
sequence order), so a rendering fault that shifts everything below it costs
only the bands it touches, not the rest of the document. Pixel rows rather
than lines were the unit of the hash the diff was first tried with, but the
two rasterisers differ in glyph weight, hinting and horizontal sub-pixel
placement, so the row hashes of an identical line disagree and every line
was chopped into slivers; a line's profile does not care.

Inside a matched pair the browser's band may sit a pixel or two off in
either direction (where the ink threshold cuts a band, centring rounding); the shift within
--search-x/--search-y that best overlays the pair is found and reported.
With it applied the rows are compared pixel for pixel: a row is *equal*
when at most --frac of its pixels differ by more than --tol (0..255) in any
channel, else *differing*. Blank rows between consecutive matched bands are
paired in order; the surplus on one side is a *spacing* difference.

A differing run of --shift-min rows or more is then tested for being the
same ink somewhere else: its strip ink is cut into pieces (ink row-bands,
each cut at --gap white columns) and every piece is looked for in the
browser within --shift-x/--shift-y px by normalised correlation of blurred
ink (a rasterisation difference hardly moves a correlation, where the pixel
tolerance fails). When every piece is found (--shift-corr) and at least one
sits --shift-min-px or more from its place, the rows are *shifted*: a
display the browser centres where TeX set it flush left, an alignment row
a few points off. The pieces and their displacements are in the report.

Output in --out (default <build>/compare/):

    strip.png, browser.png   the two renderings, this frame, this region
    diff.png                 side by side, rows aligned by the diff, with the
                             bar between: green equal, red differing, grey a
                             band with no counterpart (its other side blank),
                             amber blank rows the other side does not have,
                             blue the same ink shifted (see above)
    overview.png             diff.png reduced --overview times, the bar kept
                             legible (in a group, grey > red > blue > amber > green)
    report.json, and a summary on stdout: counts; the matched bands with the
    worst residuals; the browser's vertical offset per band and the places
    where it changes (a spacing difference right there); the unmatched
    bands.

--region X0 Y0 X1 Y1 restricts the strip to that rectangle (TeX pt; x from
the strip's left edge, y from its top, as raster.py counts) and photographs
the browser --slack points above and below it, so the diff can still find
the lines whatever the vertical offset there. Tick marks on the bar every
--tick points (strip side left, browser side right) locate a row.

The browser is driven by browser_capture.js (Playwright; see there). Its
screenshots are cached in --out and reused with --reuse.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
PT_PER_BP = 72.27 / 72
SP_PER_PT = 65536

# row verdicts
EQUAL, DIFFER, UNMATCHED, SPACING, SHIFTED = 1, 2, 3, 4, 5
COLOUR = {EQUAL: (46, 204, 64), DIFFER: (255, 65, 54), UNMATCHED: (150, 150, 150), SPACING: (255, 190, 0),
          SHIFTED: (0, 116, 217)}
PRIORITY = {UNMATCHED: 5, DIFFER: 4, SHIFTED: 3, SPACING: 2, EQUAL: 1}
BLANK = (232, 232, 232)                       # the other side of a row that has none
TICK = (0, 0, 0)


# ── rendering ────────────────────────────────────────────────────────────────

def strip_raster(pdf: Path, x_px: int, y_px: int, w_px: int, h_px: int, dpi: float, out: Path,
                 rasteriser: str = 'pdftoppm', ss: int = 1) -> np.ndarray:
    """The strip's pixels at dpi, rows y..y+h, columns x..x+w. pdftoppm crops
    at no cost for the rest of the page; mutool has no crop, so the whole
    strip is rendered once and kept beside the PDF (keyed by dpi and the
    PDF's mtime) — worth it where poppler draws something wrong (double
    accents float above their letters in poppler, not in MuPDF)."""
    if rasteriser == 'mutool':
        Image.MAX_IMAGE_PIXELS = None
        tag = f'{dpi:.2f}' + (f'x{ss}' if ss > 1 else '')
        cache = pdf.with_name(f'{pdf.stem}.mutool-{tag}-{int(pdf.stat().st_mtime)}.png')
        if not cache.exists():
            for stale in pdf.parent.glob(f'{pdf.stem}.mutool-*.png'):
                stale.unlink()
            if ss > 1:
                # drawn ss times finer, then each ss×ss block averaged: what
                # is cached is already at dpi (see --supersample)
                # (in bands, so MuPDF never holds the whole big page; the big
                # image is then opened once, at 3 bytes a pixel – 6 GB for
                # testmath at 16 px/pt – and reduced in place of a copy)
                big = cache.with_suffix('.big.png')
                subprocess.run(['mutool', 'draw', '-B', '2048', '-T', '4', '-o', str(big),
                                '-r', f'{dpi * ss:.6f}', str(pdf), '1'],
                               check=True, capture_output=True)
                im = Image.open(big)
                if im.mode != 'RGB':
                    im = im.convert('RGB')
                im.reduce(ss).save(cache)
                del im
                big.unlink()
            else:
                subprocess.run(['mutool', 'draw', '-o', str(cache), '-r', f'{dpi:.6f}', str(pdf), '1'],
                               check=True, capture_output=True)
        full = np.asarray(Image.open(cache).convert('RGB'))
        img = np.full((h_px, w_px, 3), 255, np.uint8)
        y1, x1 = min(full.shape[0], y_px + h_px), min(full.shape[1], x_px + w_px)
        if y1 > y_px and x1 > x_px:
            img[:y1 - y_px, :x1 - x_px] = full[y_px:y1, x_px:x1]
        Image.fromarray(img).save(out)
        return img
    subprocess.run(['pdftoppm', '-r', f'{dpi * ss:.6f}', '-f', '1', '-l', '1', '-x', str(x_px * ss), '-y', str(y_px * ss),
                    '-W', str(w_px * ss), '-H', str(h_px * ss), '-png', '-singlefile', str(pdf), str(out.with_suffix(''))],
                   check=True)
    img = Image.open(out).convert('RGB')
    if ss > 1:
        img = img.reduce(ss)
        img.save(out)
    img = np.asarray(img)
    if img.shape[1] != w_px:
        sys.exit(f'strip raster is {img.shape[1]} px wide, expected {w_px}')
    return img


def browser_raster(args, hsize_pt: float, margin_pt: float, y0_css: float, y1_css, cache: Path):
    """The browser's frame between CSS rows y0..y1 as RGB rows; returns
    (image, first device row, manifest)."""
    manifest = cache / 'manifest.json'
    ss = args.supersample
    request = {'url': args.url, 'ppp': args.ppp * ss, 'hsize': hsize_pt, 'margin': margin_pt, 'y0': y0_css, 'y1': y1_css,
               'css': args.browser_css, 'chromium_args': args.chromium_args}
    if not (args.reuse and manifest.exists() and json.loads(manifest.read_text()).get('request') == request):
        cmd = [args.node, str(HERE / 'browser_capture.js'), args.url, str(cache),
               '--hsize', repr(hsize_pt), '--margin', repr(margin_pt), '--ppp', repr(args.ppp * ss),
               '--band', str(args.band), '--y0', repr(y0_css)]
        if args.browser_css:
            cmd += ['--extra-css', args.browser_css]
        if args.chromium_args:
            cmd += ['--chromium-args', args.chromium_args]
        if y1_css is not None:
            cmd += ['--y1', repr(y1_css)]
        if args.wait_log:
            cmd += ['--wait-log', args.wait_log]
        r = subprocess.run(cmd, capture_output=True, text=True)
        sys.stderr.write(r.stderr)
        if r.returncode != 0:
            sys.exit(f'browser capture failed ({r.returncode})')
        m = json.loads(manifest.read_text())
        m['request'] = request
        manifest.write_text(json.dumps(m, indent=1))
    m = json.loads(manifest.read_text())
    if m['errors']:
        print(f'browser page errors: {m["errors"][:3]}', file=sys.stderr)
    dsf = m['dsf'] / ss                          # device px per CSS px after the reduction
    row0 = round(m['y0'] * dsf)
    row1 = round(m['y1'] * dsf)
    width = round(m['css_width'] * dsf)
    img = np.full((row1 - row0, width, 3), 255, np.uint8)
    for b in m['bands']:
        band = Image.open(b['file']).convert('RGB')
        if ss > 1:
            # a band is a whole number of ss×ss blocks when band*ppp/2 is
            # whole (it is: --band is CSS px, ppp 2); pad the last one
            if band.height % ss or band.width % ss:
                padded = Image.new('RGB', (-(-band.width // ss) * ss, -(-band.height // ss) * ss), (255, 255, 255))
                padded.paste(band, (0, 0)); band = padded
            band = band.reduce(ss)
        band = np.asarray(band)
        top = round(b['scroll_y'] * dsf)
        a0, a1 = max(top, row0), min(top + band.shape[0], row1)
        if a1 > a0:
            img[a0 - row0:a1 - row0] = band[a0 - top:a1 - top, :width]
    return img, row0, m


# ── bands and their alignment ────────────────────────────────────────────────

def ink_of(img: np.ndarray) -> np.ndarray:
    return 255 - img.min(axis=2).astype(np.int16)              # 0 white .. 255 black


BAND_GAP = 1


def bands_of(ink: np.ndarray, thr: int, gap: int = None) -> list[tuple[int, int]]:
    """[(y0, y1)] runs of rows with a pixel darker than thr; runs separated by
    fewer than `gap` blank rows are one band. The tolerance is what makes the
    cut the same on both sides: a line 1pt above a display is fused with it
    by one rasteriser's anti-aliasing and not by the other's, and a fused band
    would pair with half of itself."""
    gap = BAND_GAP if gap is None else gap
    rows = (ink > thr).any(axis=1)
    edges = np.flatnonzero(np.diff(np.concatenate([[0], rows.view(np.int8), [0]])))
    out = []
    for k in range(0, len(edges), 2):
        y0, y1 = int(edges[k]), int(edges[k + 1])
        if out and y0 - out[-1][1] < gap:
            out[-1] = (out[-1][0], y1)
        else:
            out.append((y0, y1))
    return out


def profiles_of(ink: np.ndarray, bands: list, block: int) -> np.ndarray:
    """Centred, normalised ink profile of every band, pooled over `block` px."""
    w = ink.shape[1]
    pad = (-w) % block
    P = np.zeros((len(bands), (w + pad) // block), np.float32)
    for k, (a, b) in enumerate(bands):
        prof = ink[a:b].mean(axis=0)
        P[k] = np.pad(prof, (0, pad)).reshape(-1, block).mean(axis=1)
    P -= P.mean(axis=1, keepdims=True)
    n = np.linalg.norm(P, axis=1, keepdims=True)
    n[n == 0] = 1
    return P / n


def align_bands(S: np.ndarray, match: float) -> list[tuple[int, int]]:
    """Monotone pairing (i, j) maximising the sum of (S[i, j] - match) over
    pairs, gaps free: sequence alignment, the diff of two band lists."""
    na, nb = S.shape
    gain = S - match
    dp = np.zeros((na + 1, nb + 1), np.float32)
    for i in range(1, na + 1):
        cand = np.maximum(dp[i - 1, 1:], dp[i - 1, :-1] + gain[i - 1])    # gap in b / match
        dp[i, 1:] = np.maximum.accumulate(cand)                          # gap in a (free): running max
    pairs = []
    i, j = na, nb
    while i > 0 and j > 0:
        v = dp[i, j]
        if gain[i - 1, j - 1] > 0 and v == dp[i - 1, j - 1] + gain[i - 1, j - 1]:
            pairs.append((i - 1, j - 1)); i -= 1; j -= 1
        elif v == dp[i - 1, j]:
            i -= 1
        else:
            j -= 1
    return pairs[::-1]


def best_shift(A: np.ndarray, B: np.ndarray, a0: int, b0: int, n: int, sx: int, sy: int, tol: int):
    """(dx, dy, residual): the shift of B's rows b0.. against A's a0..a0+n
    with the fewest pixels differing by more than tol."""
    W = A.shape[1]
    best = None
    if a0 < 0 or a0 + n > A.shape[0]:
        return None
    a = A[a0:a0 + n].astype(np.int16)
    for dy in range(-sy, sy + 1):
        bb0 = b0 + dy
        if bb0 < 0 or bb0 + n > B.shape[0]:
            continue
        b = B[bb0:bb0 + n].astype(np.int16)
        for dx in range(-sx, sx + 1):
            ax0, bx0 = max(0, dx), max(0, -dx)
            w = W - abs(dx)
            d = np.abs(a[:, ax0:ax0 + w] - b[:, bx0:bx0 + w]).max(axis=2)
            r = float((d > tol).mean())
            if best is None or r < best[2]:
                best = (dx, dy, r)
    return best


def centroid_offset(a: np.ndarray, b: np.ndarray, dx: int) -> tuple[float, float]:
    """(y, x) of B's ink centroid minus A's, in pixels, for rows already
    paired one to one and B shifted by dx columns, whole pixels taken out:
    the sub-pixel part of where the two renderers put the same line."""
    a = a.astype(np.float64); b = b.astype(np.float64)
    wa, wb = a.sum(), b.sum()
    if wa <= 0 or wb <= 0:
        return 0.0, 0.0
    rows = np.arange(a.shape[0]); cols = np.arange(a.shape[1])
    ya = (rows * a.sum(axis=1)).sum() / wa; yb = (rows * b.sum(axis=1)).sum() / wb
    xa = (cols * a.sum(axis=0)).sum() / wa; xb = (cols * b.sum(axis=0)).sum() / wb
    dy, dx2 = yb - ya, xb - xa - dx
    return dy - round(dy), dx2 - round(dx2)          # the fraction: whole pixels are the shift's business


def runs_of(flags: np.ndarray) -> list[tuple[int, int]]:
    """[(start, end)] of consecutive True."""
    edges = np.flatnonzero(np.diff(np.concatenate([[0], flags.view(np.int8), [0]])))
    return [(int(edges[k]), int(edges[k + 1])) for k in range(0, len(edges), 2)]


def fragments_of(ink: np.ndarray, thr: int, gap: int, pad: int = 2) -> list[tuple[int, int]]:
    """Column ranges of ink in a block of rows, runs closer than `gap`
    merged, each widened by `pad` px."""
    cols = (ink > thr).any(axis=0)
    out = []
    for c0, c1 in runs_of(cols):
        if out and c0 - out[-1][1] < gap:
            out[-1] = (out[-1][0], c1)
        else:
            out.append((c0, c1))
    w = ink.shape[1]
    return [(max(0, c0 - pad), min(w, c1 + pad)) for c0, c1 in out]


def blur3(a: np.ndarray) -> np.ndarray:
    """3x3 box blur, edge-replicated: absorbs sub-pixel phase before a
    correlation."""
    p = np.pad(a, 1, mode='edge')
    return sum(p[i:i + a.shape[0], j:j + a.shape[1]] for i in range(3) for j in range(3)) / 9.0


def ncc_search(a: np.ndarray, b: np.ndarray, cy: int, cx: int):
    """Normalised cross-correlation of template a (h x w) at every position
    inside b (H x W, H >= h, W >= w): (corr, dy, dx) of the best relative to
    the in-place position (cy, cx), and the corr in place. FFT for the sums
    of products, integral images for the window statistics."""
    h, w = a.shape
    H, W = b.shape
    a0 = a - a.mean()
    na = np.sqrt((a0 * a0).sum())
    if na < 1e-6:
        return None
    fb = np.fft.rfft2(b)
    fa = np.fft.rfft2(a0, s=b.shape)
    num = np.fft.irfft2(fb * np.conj(fa), s=b.shape)[:H - h + 1, :W - w + 1]
    ii = np.zeros((H + 1, W + 1)); ii[1:, 1:] = b.cumsum(0).cumsum(1)
    ii2 = np.zeros((H + 1, W + 1)); ii2[1:, 1:] = (b * b).cumsum(0).cumsum(1)
    S1 = ii[h:, w:] - ii[:-h, w:] - ii[h:, :-w] + ii[:-h, :-w]
    S2 = ii2[h:, w:] - ii2[:-h, w:] - ii2[h:, :-w] + ii2[:-h, :-w]
    var = np.maximum(S2 - S1 * S1 / (h * w), 1e-6)
    corr = num / (na * np.sqrt(var))
    corr[var < 1e-3] = 0
    cy, cx = min(max(cy, 0), corr.shape[0] - 1), min(max(cx, 0), corr.shape[1] - 1)
    yy, xx = np.mgrid[:corr.shape[0], :corr.shape[1]]
    k = int(np.argmax(corr - 1e-3 * (np.abs(yy - cy) + np.abs(xx - cx))))   # nearest of equals
    dy, dx = divmod(k, corr.shape[1])
    return float(corr[dy, dx]), dy - cy, dx - cx, float(corr[cy, cx])


def row_verdicts(A: np.ndarray, B: np.ndarray, ia: np.ndarray, ib: np.ndarray, dx: int, tol: int, frac: float) -> np.ndarray:
    W = A.shape[1]
    ax0, bx0 = max(0, dx), max(0, -dx)
    w = W - abs(dx)
    d = np.abs(A[ia][:, ax0:ax0 + w].astype(np.int16) - B[ib][:, bx0:bx0 + w].astype(np.int16)).max(axis=2)
    bad = (d > tol).sum(axis=1)
    return np.where(bad > frac * W, DIFFER, EQUAL)


def merge_bands(pairs, ba, bb, A, B, args):
    """Groups [(strip band indices, browser band indices)] from the pairs:
    a pair whose bands differ in height by more than --merge-min rows and
    15 % is regrouped so that the shorter side is the contiguous run of its
    free bands (unpaired neighbours) whose combined extent, ink to ink,
    matches the taller band within --merge-min rows; the run must contain
    the paired band. Each group remembers the original pair for the fall-back
    when its pixels do not overlay (see the pair loop)."""
    tol = args.merge_min
    groups = []
    for k, (i, j) in enumerate(pairs):
        ha, hb = ba[i][1] - ba[i][0], bb[j][1] - bb[j][0]
        prev_i = pairs[k - 1][0] if k else -1
        prev_j = pairs[k - 1][1] if k else -1
        next_i = pairs[k + 1][0] if k + 1 < len(pairs) else len(ba)
        next_j = pairs[k + 1][1] if k + 1 < len(pairs) else len(bb)
        ia_g, jb_g = [i], [j]
        if ha - hb > max(tol, 0.15 * ha):
            jb_g = best_run(bb, j, prev_j + 1, next_j, ha, tol) or [j]
        elif hb - ha > max(tol, 0.15 * hb):
            ia_g = best_run(ba, i, prev_i + 1, next_i, hb, tol) or [i]
        groups.append((ia_g, jb_g))
    return groups


def best_run(bands, j, lo, hi, target, tol):
    """The contiguous run of bands within [lo, hi) containing j whose extent
    (first top to last bottom) is closest to target and within tol rows;
    None when no run is."""
    best = None
    for j0 in range(lo, j + 1):
        for j1 in range(j, hi):
            if j1 == j0 == j:
                continue
            span = bands[j1][1] - bands[j0][0]
            d = abs(span - target)
            if d <= tol and (best is None or d < best[0]):
                best = (d, j0, j1)
    return list(range(best[1], best[2] + 1)) if best else None


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('build', type=Path, help='build dir with pageless.pdf + pageless.json, or the pdf')
    ap.add_argument('url', help='the bundle page, e.g. http://localhost:8000/index.html')
    ap.add_argument('--ppp', type=float, default=2.0, help='device pixels per TeX point (default 2)')
    ap.add_argument('--margin', type=float, default=None, help='white either side of the column, pt (default: the strip\'s)')
    ap.add_argument('--region', type=float, nargs=4, metavar=('X0', 'Y0', 'X1', 'Y1'), help='strip rectangle, pt')
    ap.add_argument('--slack', type=float, default=200, help='browser rows photographed beyond a region, pt')
    ap.add_argument('--out', type=Path, default=None)
    ap.add_argument('--tol', type=int, default=96, help='per-pixel channel difference tolerated (0..255)')
    ap.add_argument('--frac', type=float, default=0.01, help='fraction of a row\'s pixels allowed beyond --tol')
    ap.add_argument('--ink', type=int, default=80, help='a row with a pixel darker than this (0..255) carries ink; anti-aliasing fringes below it keep the band cut the same on both sides')
    ap.add_argument('--band-gap', type=int, default=1, help='blank rows that separate two bands (fewer: one band)')
    ap.add_argument('--block', type=int, default=4, help='pixels pooled per profile cell')
    ap.add_argument('--match', type=float, default=0.6, help='least profile correlation for two bands to pair')
    ap.add_argument('--search-x', type=int, default=3, help='horizontal shift searched inside a pair, px')
    ap.add_argument('--merge-min', type=int, default=3,
                    help='rows: a pair whose bands differ by more than this (and 15%%) is regrouped one band against several')
    ap.add_argument('--accept', type=float, default=0.08,
                    help='a run of unpaired lines between two pairs is taken as one block when its residual is below this')
    ap.add_argument('--search-y', type=int, default=2, help='vertical shift searched inside a pair, px')
    ap.add_argument('--shift-min', type=int, default=6, help='a differing run of at least this many rows is tested for a shift')
    ap.add_argument('--shift-x', type=int, default=240, help='horizontal search for a shifted fragment, px')
    ap.add_argument('--shift-y', type=int, default=40, help='vertical search for a shifted fragment, px')
    ap.add_argument('--shift-corr', type=float, default=0.9, help='least ink correlation for a fragment to count as found')
    ap.add_argument('--shift-deep', type=float, default=0.97,
                    help='a piece found below this correlation is cut finer, in case a part of it moved')
    ap.add_argument('--shift-min-width', type=float, default=12, help='a piece narrower than this (pt) cannot claim a move; twice this for a move beyond 4pt')
    ap.add_argument('--shift-min-px', type=int, default=2, help='a fragment found closer than this is in place, not shifted')
    ap.add_argument('--gap', type=int, default=16, help='white columns that separate two fragments, px')
    ap.add_argument('--step-min', type=float, default=1.0,
                    help='report a change of the browser offset only from this size (pt): below it is the ink threshold cutting a band a row off')
    ap.add_argument('--spacing-tol', type=int, default=1,
                    help='surplus blank rows up to this many per gap are equal, not a spacing difference (px)')
    ap.add_argument('--bar', type=int, default=24, help='width of the diff bar, px')
    ap.add_argument('--tick', type=float, default=500, help='tick marks on the bar every N pt (0: none)')
    ap.add_argument('--overview', type=int, default=8, help='reduction factor of overview.png (0: none)')
    ap.add_argument('--no-full-image', action='store_true', help='skip diff.png (overview only)')
    ap.add_argument('--band', type=int, default=2000, help='browser viewport height per screenshot, CSS px')
    ap.add_argument('--browser-css', default='', help='extra CSS injected into the page (e.g. font smoothing)')
    ap.add_argument('--chromium-args', default='', help='flags for the browser, space-separated')
    ap.add_argument('--supersample', type=int, default=1, metavar='K',
                    help='draw both sides K times finer and average K×K blocks down to --ppp: takes the '
                         'rasterisers\' own pixel snapping (MuPDF puts every glyph on a whole pixel row) and '
                         'hinting out of the comparison while keeping the geometry at --ppp (3 is plenty; '
                         'the strip is drawn whole at K times the size first)')
    ap.add_argument('--rasteriser', choices=('pdftoppm', 'mutool'), default='mutool' if shutil.which('mutool') else 'pdftoppm',
                    help='who draws the strip: MuPDF (mutool, the default when installed: whole strip once, cached; '
                         'agrees with the browser on twice as many rows) or poppler (pdftoppm, crops for free)')
    ap.add_argument('--node', default='node')
    ap.add_argument('--reuse', action='store_true', help='reuse cached browser screenshots for the same request')
    ap.add_argument('--wait-log', default=None,
                    help='before capturing, wait for a console line containing this text (a page script that loads late)')
    args = ap.parse_args()

    build = args.build
    pdf = build if build.suffix == '.pdf' else build / 'pageless.pdf'
    meta = json.loads((pdf.parent / 'pageless.json').read_text())
    out = args.out or pdf.parent / 'compare'
    out.mkdir(parents=True, exist_ok=True)

    hsize = meta['hsize'] / SP_PER_PT
    strip_margin = meta['margin'] / SP_PER_PT
    margin = strip_margin if args.margin is None else args.margin
    if margin > strip_margin + 1e-6:
        sys.exit(f'--margin {margin} exceeds the strip\'s margin {strip_margin}pt (rebuild the strip with a wider one)')
    ppp = args.ppp
    dpi = ppp * 72.27
    info = subprocess.run(['pdfinfo', str(pdf)], capture_output=True, text=True, check=True).stdout
    size = [l for l in info.splitlines() if l.startswith('Page size')][0].split()
    strip_h_pt = float(size[4]) * PT_PER_BP

    # the frame: x = 0 is M left of the column, y as the strip counts
    frame_x = strip_margin - margin
    frame_w = hsize + 2 * margin
    if args.region:
        X0, Y0, X1, Y1 = args.region
        fx0, fx1 = max(0.0, X0 - frame_x), min(frame_w, X1 - frame_x)
        fy0, fy1 = max(0.0, Y0), min(strip_h_pt, Y1)
        if fx1 <= fx0 or fy1 <= fy0:
            sys.exit('empty region')
    else:
        fx0, fx1, fy0, fy1 = 0.0, frame_w, 0.0, strip_h_pt

    def px(v: float) -> int:
        return int(round(v * ppp))

    A = strip_raster(pdf, px(frame_x + fx0), px(fy0), px(fx1) - px(fx0), px(fy1) - px(fy0), dpi, out / 'strip.png',
                     args.rasteriser, args.supersample)

    # the browser, in CSS px (2 per pt), the band around the region
    by0 = max(0.0, fy0 - args.slack) if args.region else 0.0
    by1 = (fy1 + args.slack) if args.region else None
    Bfull, brow0, manifest = browser_raster(args, hsize, margin, by0 * 2, None if by1 is None else by1 * 2, out / 'browser-cache')
    B = np.ascontiguousarray(Bfull[:, px(fx0):px(fx1)])
    Image.fromarray(B).save(out / 'browser.png')
    b_top_pt = brow0 / ppp                        # strip-frame y of B's first row (browser's own origin)

    # bands, profiles, alignment
    global BAND_GAP
    BAND_GAP = args.band_gap
    inkA, inkB = ink_of(A), ink_of(B)
    ba, bb = bands_of(inkA, args.ink), bands_of(inkB, args.ink)
    if not ba or not bb:
        sys.exit(f'nothing to compare: {len(ba)} strip band(s), {len(bb)} browser band(s)')
    PA, PB = profiles_of(inkA, ba, args.block), profiles_of(inkB, bb, args.block)
    # the similarity tolerates a horizontal shift up to the shift search
    # width, so a display the browser centres elsewhere still pairs with
    # its line (then fails the pixel test and is found shifted, below)
    with np.errstate(all='ignore'):
        S = PA @ PB.T
        K = max(0, args.shift_x // args.block)
        for k in range(1, K + 1):
            for sh in (k, -k):
                R = np.roll(PA, sh, axis=1)
                if sh > 0:
                    R[:, :sh] = 0
                else:
                    R[:, sh:] = 0
                np.maximum(S, R @ PB.T, out=S)
    ha = np.array([b - a for a, b in ba], np.float32)
    hb = np.array([b - a for a, b in bb], np.float32)
    S -= 0.5 * np.abs(np.log(ha[:, None] / hb[None, :]))     # bands of unlike height are unlike
    pairs = align_bands(S, args.match)

    # One band against several: a tall delimiter or a fraction rule bridges
    # the rows of a display in one rasteriser and not in the other, so one
    # side has a single band where the other has two or three. The alignment
    # then pairs the tall band with just one of them, the rest stay unpaired
    # and the display is reported shifted or missing. For every pair whose
    # heights clearly differ, the free bands around the shorter side's band
    # are grouped into the contiguous run whose combined height matches the
    # taller band; the merged pair is kept if its pixels overlay well.
    groups = merge_bands(pairs, ba, bb, A, B, args)

    # a region: browser rows outside the matched extent were photographed on
    # purpose (the slack); leave them out of the picture and the counts
    if args.region and pairs:
        jlo = max(0, bb[pairs[0][1]][0] - 2 * args.search_y - 4)
        jhi = min(B.shape[0], bb[pairs[-1][1]][1] + 2 * args.search_y + 4)
    else:
        jlo, jhi = 0, B.shape[0]

    # pixel verdicts per pair, then the row pairing in diff order:
    # rows (ia, ib, verdict, dx), ia/ib = -1 where a side has no row
    rows_ia, rows_ib, rows_v, rows_dx = [], [], [], []
    pair_info = []
    ca, cb = 0, jlo                         # next unconsumed row on each side
    pa = {i for i, _ in pairs}
    pb = {j for _, j in pairs}

    def flush(a_to: int, b_to: int):
        """Rows up to a_to / b_to, each side in its own row order: an ink
        row with no pair is unmatched (grey, the other side blank); blank
        rows pair with blank rows, and where one side has run out of them
        the surplus is a spacing difference (amber) — within the tolerance,
        equal. Order matters: the unmatched ink of a band that failed to
        pair must stay where its blank neighbours put it, or the picture
        shows it hard against the line above."""
        nonlocal ca, cb
        a_rows = [(r, inkA[r].max() > args.ink) for r in range(ca, a_to)]
        b_rows = [(r, inkB[r].max() > args.ink) for r in range(cb, b_to)]
        n_a_blank = sum(1 for _, ink in a_rows if not ink)
        n_b_blank = sum(1 for _, ink in b_rows if not ink)
        surplus = EQUAL if abs(n_a_blank - n_b_blank) <= args.spacing_tol else SPACING
        i = j = 0
        while i < len(a_rows) or j < len(b_rows):
            a_ink = i < len(a_rows) and a_rows[i][1]
            b_ink = j < len(b_rows) and b_rows[j][1]
            if a_ink:
                rows_ia.append(a_rows[i][0]); rows_ib.append(-1); rows_v.append(UNMATCHED); rows_dx.append(0); i += 1
            elif b_ink:
                rows_ia.append(-1); rows_ib.append(b_rows[j][0]); rows_v.append(UNMATCHED); rows_dx.append(0); j += 1
            elif i < len(a_rows) and j < len(b_rows):
                rows_ia.append(a_rows[i][0]); rows_ib.append(b_rows[j][0]); rows_v.append(EQUAL); rows_dx.append(0); i += 1; j += 1
            elif i < len(a_rows):
                rows_ia.append(a_rows[i][0]); rows_ib.append(-1); rows_v.append(surplus); rows_dx.append(0); i += 1
            else:
                rows_ia.append(-1); rows_ib.append(b_rows[j][0]); rows_v.append(surplus); rows_dx.append(0); j += 1
        ca, cb = a_to, b_to

    # what gets compared as a block: every pair, and — between two pairs —
    # a run of lines left unpaired on both sides (one renderer's bands
    # touch where the other's are apart, so 1 band faces 2; or a formula's
    # profile correlates poorly); such a run is taken if it overlays well
    items = []
    for k, (ia_g, jb_g) in enumerate(groups):
        single = len(ia_g) == 1 and len(jb_g) == 1
        items.append({'a': (ba[ia_g[0]][0], ba[ia_g[-1]][1]), 'b': (bb[jb_g[0]][0], bb[jb_g[-1]][1]),
                      'sim': float(S[ia_g[0], jb_g[0]]) if single else None,
                      'kind': 'band' if single else 'merge', 'ia': list(ia_g), 'jb': list(jb_g),
                      'pair': (ia_g[0] if len(ia_g) == 1 else pairs[k][0], jb_g[0] if len(jb_g) == 1 else pairs[k][1])})
        if k + 1 < len(groups):
            i, j = ia_g[-1], jb_g[-1]
            i2, j2 = groups[k + 1][0][0], groups[k + 1][1][0]
            if i2 > i + 1 and j2 > j + 1:
                items.append({'a': (ba[i + 1][0], ba[i2 - 1][1]), 'b': (bb[j + 1][0], bb[j2 - 1][1]),
                              'sim': None, 'kind': 'block', 'ia': list(range(i + 1, i2)), 'jb': list(range(j + 1, j2))})
    items.sort(key=lambda t: t['a'][0])
    pa = {i for ia_g, _ in groups for i in ia_g}
    pb = {j for _, jb_g in groups for j in jb_g}

    for it in items:
        (a0, a1), (b0, b1) = it['a'], it['b']
        n = max(a1 - a0, b1 - b0) + 2          # one row of context either side
        a_start, b_start = max(0, a0 - 1), max(0, b0 - 1)
        n = min(n, A.shape[0] - a_start, B.shape[0] - b_start - args.search_y)   # the image's edge
        shift = best_shift(A, B, a_start, b_start, n, args.search_x, args.search_y, args.tol)
        if shift is None:                    # at the very edge of the image
            dx, dy, resid = 0, 0, 1.0
        else:
            dx, dy, resid = shift
        if it['kind'] == 'block':
            if resid > args.accept:
                continue                     # different content after all: stays unmatched
            pa.update(it['ia']); pb.update(it['jb'])
        elif it['kind'] == 'merge' and resid > args.accept:
            # the grouping did not overlay: fall back to the one pair the
            # alignment made (its bands stay paired, the rest unmatched)
            i, j = it['pair']
            for lst, keep, allb in ((pa, i, it['ia']), (pb, j, it['jb'])):
                for x in allb:
                    if x != keep:
                        lst.discard(x)
            it = {'a': ba[i], 'b': bb[j], 'sim': float(S[i, j]), 'kind': 'band', 'ia': [i], 'jb': [j]}
            (a0, a1), (b0, b1) = it['a'], it['b']
            n = max(a1 - a0, b1 - b0) + 2
            a_start, b_start = max(0, a0 - 1), max(0, b0 - 1)
            n = min(n, A.shape[0] - a_start, B.shape[0] - b_start - args.search_y)
            shift = best_shift(A, B, a_start, b_start, n, args.search_x, args.search_y, args.tol)
            dx, dy, resid = shift if shift else (0, 0, 1.0)
        b_start += dy
        a_lo, b_lo = max(a_start, ca), max(b_start, cb)
        a_hi, b_hi = min(a_start + n, A.shape[0]), min(b_start + n, jhi)
        k0 = max(a_lo - a_start, b_lo - b_start)
        k1 = min(a_hi - a_start, b_hi - b_start)
        if k1 <= k0:
            continue
        flush(a_start + k0, b_start + k0)
        ia = np.arange(a_start + k0, a_start + k1)
        ib = np.arange(b_start + k0, b_start + k1)
        v = row_verdicts(A, B, ia, ib, dx, args.tol, args.frac)
        r_start = len(rows_ia)
        rows_ia += ia.tolist(); rows_ib += ib.tolist(); rows_v += v.tolist(); rows_dx += [dx] * len(ia)
        # where the ink actually sits, to a fraction of a pixel: the centroid
        # of each side's rows, the whole-pixel shift taken out
        sub_y, sub_x = centroid_offset(inkA[ia], inkB[ib], dx)
        ca, cb = a_start + k1, b_start + k1
        pair_info.append({
            'strip_y0': round(fy0 + a0 / ppp, 2), 'strip_y1': round(fy0 + a1 / ppp, 2),
            'browser_y0': round(b_top_pt + b0 / ppp, 2),
            'offset_pt': round((b_top_pt + (b0 + dy) / ppp) - (fy0 + a0 / ppp), 2),
            'dx_px': dx, 'dy_px': dy, 'sub_px_y': round(sub_y, 3), 'sub_px_x': round(sub_x, 3),
            'similarity': None if it['sim'] is None else round(it['sim'], 3),
            'kind': it['kind'], 'lines': len(it['ia']),
            'rows': int(k1 - k0), 'differing_rows': int((v == DIFFER).sum()), 'shifted_rows': 0,
            'residual': round(resid, 4), '_r': (r_start, r_start + len(ia))})
    flush(A.shape[0], jhi)
    ia_arr, ib_arr, verdict = np.array(rows_ia, np.int64), np.array(rows_ib, np.int64), np.array(rows_v, np.int8)
    dx_arr = np.array(rows_dx, np.int64)

    # ── shifted, not different? ──────────────────────────────────────────────
    # A differing run of some height is often the same ink somewhere else:
    # a display the browser centres where TeX set it flush left, a row of
    # an alignment a few pixels off. Split the run's strip ink into
    # horizontal fragments and look for each in the browser within
    # --shift-x/--shift-y px, by correlation of blurred ink (rasterisation
    # differences hardly move a correlation). When every fragment is found
    # and at least one is off its place, the rows are *shifted* (blue).
    shifted_runs, shift_tests = [], []
    fA, fB = blur3(inkA.astype(np.float32)), blur3(inkB.astype(np.float32))
    sx, sy = args.shift_x, args.shift_y
    for r0, r1 in runs_of(verdict == DIFFER):
        if r1 - r0 < args.shift_min:
            continue
        ia_all, ib_all = ia_arr[r0:r1], ib_arr[r0:r1]
        frags = []

        def place(rows: np.ndarray, c0: int, c1: int, gap: int) -> list:
            """The strip piece rows x c0..c1 looked for in the browser: its
            fragment record(s). A piece not found — or found but not well,
            since a small part off its place hardly lowers the whole's
            correlation — is cut finer, its own ink row-bands then column
            runs at half the gap, because a display's parts move on their
            own (an inner fraction between delimiters that stay); the finer
            cut replaces the whole when it finds a part moved."""
            ia, ib = rows, ib_all[np.searchsorted(ia_all, rows)]
            sub = inkA[ia][:, c0:c1]
            if (sub > args.ink).sum() < 30:
                return []                                  # too little ink to place
            a = fA[ia][:, c0:c1]
            b_lo, b_hi = max(0, ib[0] - sy), min(B.shape[0], ib[-1] + 1 + sy)
            w0, w1 = max(0, c0 - sx), min(B.shape[1], c1 + sx)
            b = fB[b_lo:b_hi, w0:w1]
            res = ncc_search(a, b, ib[0] - b_lo, c0 - w0) if b.shape[0] >= a.shape[0] else None
            rec = {'y0_pt': round(fy0 + ia[0] / ppp, 2), 'y1_pt': round(fy0 + (ia[-1] + 1) / ppp, 2),
                   'x0_pt': round((frame_x + fx0) + c0 / ppp, 2), 'x1_pt': round((frame_x + fx0) + c1 / ppp, 2),
                   'dx_px': None, 'dy_px': None, 'corr': None, 'corr_in_place': None, 'found': False, 'moved': False}
            if res is not None:
                corr, dy, dx, corr0 = res
                rec.update(corr=round(corr, 3), corr_in_place=round(corr0, 3))
                if corr >= args.shift_corr:
                    # a moved claim needs a piece wide enough to be distinctive:
                    # a lone letter is "found" wherever the same letter recurs,
                    # a short word wherever it recurs — the larger the jump,
                    # the wider the piece must be
                    far = max(abs(dx), abs(dy))
                    wide = (c1 - c0) >= args.shift_min_width * ppp * (2 if far > 4 * ppp else 1)
                    rec.update(dx_px=int(dx), dy_px=int(dy), found=True,
                               moved=bool(far >= args.shift_min_px and corr - corr0 >= 0.05 and wide))
            if rec['found'] and rec['corr'] >= args.shift_deep:
                return [rec]
            parts = []
            for s0, s1 in bands_of(sub, args.ink):
                for d0, d1 in fragments_of(sub[s0:s1], args.ink, max(1, gap // 2)):
                    parts.append((rows[s0:s1], c0 + d0, c0 + d1))
            finer = gap >= 4 and (len(parts) > 1 or (parts and (parts[0][1] > c0 or parts[0][2] < c1 or len(parts[0][0]) < len(rows))))
            if finer:
                recs = [r for pr, d0, d1 in parts for r in place(pr, d0, d1, gap // 2)]
                if recs and (not rec['found'] or any(r['moved'] for r in recs)):
                    return recs
            return [rec]

        for s0, s1 in bands_of(inkA[ia_all], args.ink):
            for c0, c1 in fragments_of(inkA[ia_all[s0:s1]], args.ink, args.gap):
                frags += place(ia_all[s0:s1], c0, c1, args.gap)
        found = sum(f['found'] for f in frags)
        moved = sum(f['moved'] for f in frags)
        outcome = ('shifted' if frags and found == len(frags) and moved else
                   'in place' if frags and found == len(frags) else 'not found')
        shift_tests.append({'strip_y0': round(fy0 + ia_all[0] / ppp, 2), 'strip_y1': round(fy0 + (ia_all[-1] + 1) / ppp, 2),
                            'rows': int(r1 - r0), 'pieces': len(frags), 'found': int(found), 'moved': int(moved),
                            'outcome': outcome, 'fragments': frags})
        if frags and found == len(frags) and moved:
            verdict[r0:r1] = SHIFTED
            shifted_runs.append({'strip_y0': round(fy0 + ia_all[0] / ppp, 2), 'strip_y1': round(fy0 + (ia_all[-1] + 1) / ppp, 2),
                                 'rows': int(r1 - r0), 'fragments': frags})

    for p in pair_info:                   # the verdicts after the shift pass
        seg = verdict[p['_r'][0]:p['_r'][1]]
        p['differing_rows'] = int((seg == DIFFER).sum()); p['shifted_rows'] = int((seg == SHIFTED).sum())
        del p['_r']

    # report
    counts = {name: int((verdict == code).sum()) for name, code in
              (('equal', EQUAL), ('differing', DIFFER), ('unmatched', UNMATCHED), ('spacing', SPACING),
               ('shifted', SHIFTED))}
    counts['unmatched_strip'] = int(((verdict == UNMATCHED) & (ia_arr >= 0)).sum())
    counts['unmatched_browser'] = int(((verdict == UNMATCHED) & (ib_arr >= 0)).sum())
    counts['spacing_strip'] = int(((verdict == SPACING) & (ia_arr >= 0)).sum())
    counts['spacing_browser'] = int(((verdict == SPACING) & (ib_arr >= 0)).sum())
    unmatched = []
    for side, bands, inpair, top in (('strip', ba, pa, fy0), ('browser', bb, pb, b_top_pt)):
        for k, (y0, y1) in enumerate(bands):
            if k not in inpair and (side == 'strip' or jlo <= y0 < jhi):
                unmatched.append({'side': side, 'y0': round(top + y0 / ppp, 2), 'y1': round(top + y1 / ppp, 2), 'rows': y1 - y0})
    steps = []
    for p, q in zip(pair_info, pair_info[1:]):
        d = q['offset_pt'] - p['offset_pt']
        if abs(d) >= args.step_min - 1e-9:
            steps.append({'between_strip_y': p['strip_y1'], 'and': q['strip_y0'], 'delta_pt': round(d, 2)})
    offsets = [p['offset_pt'] for p in pair_info]
    good = [p for p in pair_info if p['similarity'] is not None and p['similarity'] >= 0.9]
    sub = {axis: {'mean': round(float(np.mean([p[k] for p in good])), 3), 'std': round(float(np.std([p[k] for p in good])), 3)}
           for axis, k in (('y', 'sub_px_y'), ('x', 'sub_px_x'))} if good else None
    dxs = [p['dx_px'] for p in pair_info]
    dys = [p['dy_px'] for p in pair_info]
    report = {
        'ppp': ppp, 'dpi': dpi, 'margin_pt': margin, 'hsize_pt': hsize, 'frame_x_pt': frame_x,
        'region_pt': [frame_x + fx0, fy0, frame_x + fx1, fy1], 'browser_rows_from_pt': b_top_pt,
        'rows': {'strip': int(A.shape[0]), 'browser': int(jhi - jlo), **counts},
        'bands': {'strip': len(ba), 'browser': len(bb), 'matched_strip': len(pa), 'matched_browser': len(pb),
                  'blocks': len([p for p in pair_info if p['kind'] == 'block']),
                  'merges': len([p for p in pair_info if p['kind'] == 'merge'])},
        'settings': {'supersample': args.supersample, 'tol': args.tol, 'frac': args.frac, 'ink': args.ink, 'block': args.block, 'match': args.match,
                     'search_x': args.search_x, 'search_y': args.search_y, 'shift_min': args.shift_min,
                     'shift_x': args.shift_x, 'shift_y': args.shift_y, 'shift_corr': args.shift_corr, 'gap': args.gap},
        'offset_pt': {'first': offsets[0], 'last': offsets[-1], 'min': min(offsets), 'max': max(offsets)} if offsets else None,
        'dx_px_histogram': {str(k): dxs.count(k) for k in sorted(set(dxs))},
        'dy_px_histogram': {str(k): dys.count(k) for k in sorted(set(dys))},
        'sub_pixel_offset_px': sub,
        'spacing_steps': sorted(steps, key=lambda s: -abs(s['delta_pt'])),
        'shifted_runs': sorted(shifted_runs, key=lambda r: -r['rows']),
        'shift_tests': shift_tests,
        'worst_pairs': sorted(pair_info, key=lambda p: (-p['differing_rows'], -p['residual']))[:40],
        'unmatched_bands': unmatched,
        'pairs': pair_info,
        'browser_geometry': manifest.get('geometry'),
    }
    (out / 'report.json').write_text(json.dumps(report, indent=1))
    # rows.tsv: every row of the diff in diff order — strip row, browser row
    # (-1 where a side has none), verdict, the pair's horizontal shift
    with (out / 'rows.tsv').open('w') as f:
        f.write('strip_row\tbrowser_row\tverdict\tdx_px\n')
        names = {EQUAL: 'equal', DIFFER: 'differ', UNMATCHED: 'unmatched', SPACING: 'spacing', SHIFTED: 'shifted'}
        for a, b, v, d in zip(ia_arr.tolist(), ib_arr.tolist(), verdict.tolist(), dx_arr.tolist()):
            f.write(f'{a}\t{b}\t{names[v]}\t{d}\n')

    # the picture: rows in diff order, left the strip, right the browser
    W = A.shape[1]
    N = len(ia_arr)
    left = np.empty((N, W, 3), np.uint8); left[:] = BLANK
    right = np.empty((N, W, 3), np.uint8); right[:] = BLANK
    has_a, has_b = ia_arr >= 0, ib_arr >= 0
    left[has_a] = A[ia_arr[has_a]]
    right[has_b] = B[ib_arr[has_b]]
    bar = np.empty((N, args.bar, 3), np.uint8)
    for code, colour in COLOUR.items():
        bar[verdict == code] = colour
    if args.tick > 0:
        t = args.tick * ppp
        third = max(1, args.bar // 3)
        ya = fy0 * ppp + ia_arr
        yb = b_top_pt * ppp + ib_arr
        ta = has_a & (np.floor(ya / t) != np.floor((ya - 1) / t))
        tb = has_b & (np.floor(yb / t) != np.floor((yb - 1) / t))
        bar[ta, :third] = TICK
        bar[tb, args.bar - third:] = TICK
    if not args.no_full_image:
        Image.fromarray(np.concatenate([left, bar, right], axis=1)).save(out / 'diff.png')
        # heat.png: the same rows, white where the pair agrees, red by how
        # much a pixel differs (with the pair's horizontal shift applied)
        heat = np.empty((N, W, 3), np.uint8); heat[:] = BLANK
        both = has_a & has_b
        for dx in np.unique(dx_arr[both]):
            sel = both & (dx_arr == dx)
            ax0, bx0 = max(0, int(dx)), max(0, -int(dx))
            w = W - abs(int(dx))
            d = np.abs(A[ia_arr[sel]][:, ax0:ax0 + w].astype(np.int16) - B[ib_arr[sel]][:, bx0:bx0 + w].astype(np.int16)).max(axis=2)
            block = np.full((sel.sum(), W, 3), 255, np.uint8)
            block[:, ax0:ax0 + w, 1] = (255 - d).astype(np.uint8)
            block[:, ax0:ax0 + w, 2] = (255 - d).astype(np.uint8)
            heat[sel] = block
        Image.fromarray(heat).save(out / 'heat.png')
    if args.overview > 1:
        f = args.overview
        rows = -(-N // f)
        padN = rows * f - N

        def shrink(img):
            if padN:
                img = np.concatenate([img, np.full((padN, img.shape[1], 3), 255, np.uint8)])
            return np.asarray(Image.fromarray(img).resize((max(1, img.shape[1] // f), rows), Image.BOX))

        pri = np.zeros(rows * f, np.int8)
        for code, p in PRIORITY.items():
            pri[:N][verdict == code] = p
        g = pri.reshape(rows, f).max(axis=1)
        bar_s = np.full((rows, max(3, -(-args.bar // f)), 3), 255, np.uint8)
        for code, p in PRIORITY.items():
            bar_s[g == p] = COLOUR[code]
        Image.fromarray(np.concatenate([shrink(left), bar_s, shrink(right)], axis=1)).save(out / 'overview.png')

    print(f'frame: hsize {hsize:g}pt, margin {margin:g}pt, {ppp:g} px/pt; strip region '
          f'x {frame_x + fx0:g}..{frame_x + fx1:g}, y {fy0:g}..{fy1:g} pt')
    blocks = [p for p in pair_info if p['kind'] == 'block']
    merges = [p for p in pair_info if p['kind'] == 'merge']
    print(f'bands: strip {len(ba)}, browser {len(bb)}, matched {len(pa)}/{len(pb)} '
          f'({len(blocks)} block(s) of touching lines taken whole, {len(merges)} band(s) paired with several)')
    print(f'rows: strip {A.shape[0]}, browser {jhi - jlo}: {counts["equal"]} equal, {counts["differing"]} differing, '
          f'{counts["shifted"]} shifted, unmatched {counts["unmatched_strip"]}/{counts["unmatched_browser"]}, '
          f'spacing surplus {counts["spacing_strip"]}/{counts["spacing_browser"]} (strip/browser)')
    if offsets:
        print(f'browser offset (browser y - strip y): first {offsets[0]:+g}pt, last {offsets[-1]:+g}pt, '
              f'range {min(offsets):+g}..{max(offsets):+g}pt; shift px: x {report["dx_px_histogram"]}, y {report["dy_px_histogram"]}')
    if sub:
        print(f'sub-pixel offset of the ink (browser - strip, whole pixels taken out), over {len(good)} well-paired lines: '
              f'y {sub["y"]["mean"]:+.3f} px (std {sub["y"]["std"]:.3f}), x {sub["x"]["mean"]:+.3f} px (std {sub["x"]["std"]:.3f})')
    for s in report['spacing_steps'][:12]:
        print(f'  spacing  between strip y {s["between_strip_y"]:9.2f} and {s["and"]:9.2f}: browser {s["delta_pt"]:+.2f}pt')
    if shift_tests:
        oc = [t['outcome'] for t in shift_tests]
        print(f'differing runs of {args.shift_min}+ rows tested for a shift: {len(oc)}: {oc.count("shifted")} shifted, '
              f'{oc.count("in place")} the same ink in place (within {args.shift_min_px - 1} px: rasterisation), '
              f'{oc.count("not found")} with a part not found')
    for r in report['shifted_runs'][:12]:
        parts = ', '.join(f'[{f["x0_pt"]:.0f}..{f["x1_pt"]:.0f} x {f["y0_pt"]:.0f}..{f["y1_pt"]:.0f}] by ({f["dx_px"] / ppp:+.1f},{f["dy_px"] / ppp:+.1f})pt'
                          for f in r['fragments'] if f['moved'])
        print(f'  shifted  strip y {r["strip_y0"]:9.2f}..{r["strip_y1"]:9.2f}  ({r["rows"]:3d} rows)  {parts}')
    for p in report['worst_pairs'][:12]:
        if p['differing_rows'] == 0:
            break
        print(f'  differ   strip y {p["strip_y0"]:9.2f}..{p["strip_y1"]:9.2f}  {p["differing_rows"]:3d}/{p["rows"]:3d} rows, '
              f'residual {p["residual"]:.3f}, shift ({p["dx_px"]:+d},{p["dy_px"]:+d}) px, '
              + (f'sim {p["similarity"]:.2f}' if p['similarity'] is not None else f'block of {p["lines"]} lines'))
    for u in sorted(unmatched, key=lambda u: -u['rows'])[:12]:
        print(f'  unmatched {u["side"]:7} y {u["y0"]:9.2f}..{u["y1"]:9.2f}  ({u["rows"]} rows)')
    print(f'→ {out}/diff.png, heat.png, overview.png, report.json')


if __name__ == '__main__':
    main()
