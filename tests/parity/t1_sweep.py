# SPDX-License-Identifier: AGPL-3.0-or-later
# The Python side of the Type 1 sweep (t1-sweep.test.ts): every Type 1 outline
# pdftex.map names, once – through the first face that uses it, with that
# face's encoding – converted by t1_convert.py into <out>/. One JSON line per
# face in <out>/manifest.jsonl, written as it goes; a face already there is
# skipped, so a stopped sweep resumes. Temporary, like the rest of tests/parity.
#     python3 tests/parity/t1_sweep.py <out> [processes]
import json, sys, time
from multiprocessing import Pool
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'src/encode'))
import t1_convert as T

OUT = Path(sys.argv[1])


def one(name):
    found = T.find_pfb(name)
    if not found:
        return {'name': name, 'outline': None}
    pfb, enc = found
    try:
        served, addr = T._convert(pfb, name, OUT, enc)
        return {'name': name, 'pfb': pfb, 'served': served, 'addressing': {str(k): v for k, v in addr.items()}}
    except Exception as e:                                   # noqa: BLE001
        return {'name': name, 'pfb': pfb, 'error': f'{type(e).__name__}: {e}'}


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    seen, faces = set(), []
    for name, (outline, _enc) in T._map_entries().items():
        if outline not in seen:
            seen.add(outline); faces.append(name)
    manifest = OUT / 'manifest.jsonl'
    done = {json.loads(l)['name'] for l in manifest.read_text().splitlines()} if manifest.exists() else set()
    todo = [f for f in faces if f not in done]
    print(f'{len(faces)} outlines, {len(done)} done, {len(todo)} to convert', flush=True)
    t0 = time.perf_counter()
    with manifest.open('a') as m, Pool(int(sys.argv[2]) if len(sys.argv) > 2 else 8) as pool:
        for i, r in enumerate(pool.imap_unordered(one, todo, chunksize=8)):
            m.write(json.dumps(r) + '\n')
            if i % 500 == 0:
                m.flush(); print(f'  {i}/{len(todo)}, {time.perf_counter() - t0:.0f} s', flush=True)
    print(f'done in {time.perf_counter() - t0:.0f} s')
