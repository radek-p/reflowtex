// SPDX-License-Identifier: AGPL-3.0-or-later
// The picture converter (src/pictures/pdf-svg.ts) in a browser's Web Worker,
// as a host bundles it: MuPDF's package served from a folder of its own and
// its .wasm from another, found through `wasmUrl`. Its pictures must be the
// pipeline's, byte for byte.
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as esbuild from 'esbuild';
import { test, expect } from './fixtures.ts';
import { BUILD, REPO } from './web.ts';
import { pdfPagePicture } from '../../src/pictures/pdf-svg.ts';
import * as F from '../unit/figure-pdfs.ts';

const DIR = join(BUILD, 'pdf-svg-worker');
const MUPDF = join(REPO, 'node_modules/mupdf/dist');
const FIXTURES = { type3Vector: F.type3VectorPdf, type3Bitmap: F.type3BitmapPdf, icc: F.iccFillsPdf, heatmap: F.heatmapPdf,
  shading: F.shadingPdf, pattern: F.tilingPatternPdf, stroked: F.strokedTextPdf, mask: F.softMaskPdf, figure: F.themedFigurePdf };

test.beforeAll(async () => {
  mkdirSync(join(DIR, 'mupdf'), { recursive: true });
  mkdirSync(join(DIR, 'wasm'), { recursive: true });
  // the package's modules in one folder, its .wasm in another: found only through wasmUrl
  for (const f of ['mupdf.js', 'mupdf-wasm.js']) copyFileSync(join(MUPDF, f), join(DIR, 'mupdf', f));
  copyFileSync(join(MUPDF, 'mupdf-wasm.wasm'), join(DIR, 'wasm', 'mupdf-wasm.wasm'));
  writeFileSync(join(DIR, 'entry.ts'), `import { pdfPagePicture } from ${JSON.stringify(join(REPO, 'src/pictures/pdf-svg.ts'))};
self.onmessage = async e => {
  const { bytes, prefix, wasmUrl } = e.data;
  try { self.postMessage({ picture: await pdfPagePicture(bytes, 1, prefix, { wasmUrl, stripPageBackground: true }) }); }
  catch (err) { self.postMessage({ error: String(err) }); }
};`);
  await esbuild.build({
    entryPoints: [join(DIR, 'entry.ts')], bundle: true, format: 'esm', platform: 'browser', outfile: join(DIR, 'worker.js'), logLevel: 'error',
    plugins: [{ name: 'mupdf-beside', setup: b => { b.onResolve({ filter: /^mupdf$/ }, () => ({ path: './mupdf/mupdf.js', external: true })); } }],
  });
  writeFileSync(join(DIR, 'index.html'), '<!doctype html><title>pdf-svg worker</title>');
  for (const [name, make] of Object.entries(FIXTURES)) writeFileSync(join(DIR, `${name}.pdf`), make());
});

test('the converter in a Web Worker draws the pipeline\'s pictures', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium', 'the same code in every engine: once is enough');
  const base = `${process.env.REFLOWTEX_WEB_URL}/pdf-svg-worker/`;
  await page.goto(`${base}index.html`);
  for (const [name, make] of Object.entries(FIXTURES)) {
    const bytes = new Uint8Array(make());
    const inWorker = await page.evaluate(async ([base, name]) => {
      const bytes = new Uint8Array(await (await fetch(`${base}${name}.pdf`)).arrayBuffer());
      const w = new Worker(`${base}worker.js`, { type: 'module' });
      const r = await new Promise<{ picture?: unknown; error?: string }>(ok => { w.onmessage = e => ok(e.data); w.postMessage({ bytes, prefix: 'p1-', wasmUrl: `${base}wasm/mupdf-wasm.wasm` }); });
      w.terminate();
      return r;
    }, [base, name] as const);
    expect(inWorker.error, name).toBeUndefined();
    expect(inWorker.picture, name).toEqual(await pdfPagePicture(bytes, 1, 'p1-', { stripPageBackground: true }));
  }
});
