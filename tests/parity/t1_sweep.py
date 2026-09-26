# SPDX-License-Identifier: AGPL-3.0-or-later
# The Python side of the Type 1 sweep (t1-sweep.test.ts): every face pdftex.map
# names, converted by t1_convert.py into <out>/, with a manifest of what each
# became. Temporary, like the rest of tests/parity.
import json, sys, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'src/encode'))
import t1_convert as T
out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
faces = sorted(T._map_entries())
manifest, t0 = {}, time.perf_counter()
for i, name in enumerate(faces):
    found = T.find_pfb(name)
    if not found:
        manifest[name] = None; continue
    pfb, enc = found
    try:
        served, addr = T._convert(pfb, name, out, enc)
        manifest[name] = {'pfb': pfb, 'served': served, 'addressing': {str(k): v for k, v in addr.items()}}
    except Exception as e:                                   # noqa: BLE001
        manifest[name] = {'pfb': pfb, 'error': f'{type(e).__name__}: {e}'}
    if i % 200 == 0:
        print(f'  {i}/{len(faces)} faces, {time.perf_counter() - t0:.0f} s', flush=True)
(out / 'manifest.json').write_text(json.dumps(manifest))
print(f'{len(faces)} faces in {time.perf_counter() - t0:.0f} s')
