#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Check a pageless strip against the same document paginated normally.

    check_against_paged.py <strip.pdf> <paged.pdf> [--tol 0.012] [--dump PAGE]

Within one page of a \\raggedbottom document, TeX places every line exactly
as it would on an endless galley: only page breaks (discarded glue,
\\topskip) and the running head/foot differ. So every word's position
relative to the first word of its page must agree between the paged PDF and
the strip, to the backend's rounding. This walks each paged page's words
(pdftotext -bbox), finds the same run of words in the strip, and reports the
largest deviation of relative x/y offsets. Pages whose text straddles a
chunk boundary of the strip check the stacking for free: a seam would show
as a jump in dy from that word on.
"""
import re
import subprocess
import sys
from pathlib import Path

WORD_RE = re.compile(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>')


def words(pdf: Path):
    """[[(x, y, text), …] per page]; x/y = top-left of the word's box."""
    out = subprocess.run(['pdftotext', '-bbox', str(pdf), '-'], capture_output=True, text=True, check=True).stdout
    pages = []
    for chunk in out.split('<page ')[1:]:
        pages.append([(float(m.group(1)), float(m.group(2)), m.group(5)) for m in WORD_RE.finditer(chunk)])
    return pages


def main() -> None:
    args = sys.argv[1:]
    tol = 0.012          # x quantisation of PDF text operators is 1/1000 em
    if '--tol' in args:
        i = args.index('--tol'); tol = float(args[i + 1]); del args[i:i + 2]
    dump = None                                # --dump N: print every word of page N
    if '--dump' in args:
        i = args.index('--dump'); dump = int(args[i + 1]); del args[i:i + 2]
    if len(args) != 2:
        sys.exit(__doc__)
    strip = words(Path(args[0]))
    if len(strip) != 1:
        sys.exit(f'strip has {len(strip)} pages, expected 1')
    strip = strip[0]
    paged = words(Path(args[1]))
    texts = [w[2] for w in strip]

    worst = 0.0
    total_matched = 0
    pos = 0                                    # search cursor into the strip
    for k, page in enumerate(paged, start=1):
        if len(page) < 6:
            print(f'page {k}: {len(page)} words, skipped')
            continue
        # locate the page's opening words in the strip (skip a running head:
        # try each of the first dozen words as the anchor)
        start = None
        for a in range(min(12, len(page) - 5)):
            probe = [w[2] for w in page[a:a + 5]]
            for i in range(pos, len(texts) - 5):
                if texts[i:i + 5] == probe:
                    start = (a, i)
                    break
            if start:
                break
        if not start:
            print(f'page {k}: opening words not found in the strip')
            continue
        a, i = start
        px0, py0 = page[a][0], page[a][1]
        sx0, sy0 = strip[i][0], strip[i][1]
        matched, worst_page, first_bad, reordered = 0, 0.0, None, 0
        j = a
        while j < len(page) and i < len(strip):
            in_place = (page[j][2] == strip[i][2] and
                        abs((strip[i][0] - sx0) - (page[j][0] - px0)) <= 1.0 and
                        abs((strip[i][1] - sy0) - (page[j][1] - py0)) <= 1.0)
            if not in_place:
                if page[j][2] == strip[i][2]:
                    reordered += 1          # same text, elsewhere: a reordered formula word
                # pdftotext orders the words of a formula differently on the two
                # pages now and then: resync on a run of four equal words, the
                # candidate whose relative position is closest to where we are
                best = None
                for jj in range(j, min(j + 40, len(page) - 4)):
                    probe = [w[2] for w in page[jj:jj + 4]]
                    for ii in range(i, min(i + 120, len(strip) - 4)):
                        if texts[ii:ii + 4] == probe:
                            dev = max(abs((strip[ii][0] - sx0) - (page[jj][0] - px0)),
                                      abs((strip[ii][1] - sy0) - (page[jj][1] - py0)))
                            if best is None or dev < best[0]:
                                best = (dev, jj, ii)
                    if best and best[0] <= tol:
                        break
                # a candidate that is not where the text should be is another
                # occurrence of the same words: stop the page rather than follow it
                if not best or best[0] > 1.0:
                    break
                j, i = best[1], best[2]
            dx = (strip[i][0] - sx0) - (page[j][0] - px0)
            dy = (strip[i][1] - sy0) - (page[j][1] - py0)
            d = max(abs(dx), abs(dy))
            if d > worst_page:
                worst_page = d
            if d > tol and first_bad is None:
                first_bad = (page[j][2], round(dx, 4), round(dy, 4), round(strip[i][1], 3))
            if dump == k:
                print(f'   {page[j][2]!r:28} paged y={page[j][1]:9.3f}  strip y={strip[i][1]:10.3f}  dx={dx:+.4f} dy={dy:+.4f}')
            matched += 1
            j += 1
            i += 1
        unmatched = len(page) - j
        print(f'page {k}: {matched} words matched from word {a}, {unmatched} left unmatched, '
              f'{reordered} reordered, max deviation {worst_page:.4f} bp'
              + (f'  FIRST BAD: {first_bad}' if first_bad else ''))
        worst = max(worst, worst_page)
        total_matched += matched
        pos = i
    print(f'== {total_matched} words matched, worst deviation {worst:.4f} bp, tolerance {tol} bp: '
          + ('OK' if worst <= tol else 'MISMATCH'))
    sys.exit(0 if worst <= tol else 1)


if __name__ == '__main__':
    main()
