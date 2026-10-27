// SPDX-License-Identifier: AGPL-3.0-or-later
// The backend conformance suite (README.md): for each backend, its
// capabilities descriptor read, the shared fixtures (fixtures/) compiled, and
// what it claims checked in the output. What it does not claim is skipped,
// saying so; a backend this build cannot use is checked to fail clearly.
//
//     node --test tests/backends/conformance.test.ts             (every registered backend)
//     REFLOWTEX_BACKENDS=luatex node --test tests/backends/conformance.test.ts
import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pipeline, contentKey } from '../../src/pipeline/pipeline.ts';
import { readSerializerOutput, forEachNode, type SerializerOutput, type TexNode } from '../../src/pipeline/nodes.ts';
import { encodeDocument } from '../../src/pipeline/encode.ts';
import { BackendUnavailable } from '../../src/pipeline/errors.ts';
import { CAPABILITY_NAMES, supports, type CapabilityName } from '../../src/pipeline/backend/capabilities.ts';
import { backendIds, createBackend } from '../../src/pipeline/backend/registry.ts';
import type { CaptureBackend, GlyphSource } from '../../src/pipeline/backend/types.ts';
import { Log } from '../../src/shared/log.ts';

// Nothing is fetched while tests run (docker/test-packages.txt has what the
// fixtures load beyond the pipeline's own list).
process.env.REFLOWTEX_NO_AUTOINSTALL ??= '1';

const FIXTURES = new URL('./fixtures/', import.meta.url).pathname;
const fixture = (name: string) => readFileSync(join(FIXTURES, `${name}.tex`), 'utf8');
const ROOT = mkdtempSync(join(tmpdir(), 'reflowtex-conformance-'));
after(() => { if (!process.env.REFLOWTEX_KEEP_BUILD) rmSync(ROOT, { recursive: true, force: true }); });

const ids = (process.env.REFLOWTEX_BACKENDS ?? backendIds().join(',')).split(',').map(s => s.trim()).filter(Boolean);

/** LaTeX's tagging with luamml needs luamml 0.8 (TeX Live 2026): an older
 *  TeX Live is a fact of the machine, not of the backend. */
const oldLuamml = (() => {
  try {
    const sty = execFileSync('kpsewhich', ['luamml.sty'], { encoding: 'utf8' }).trim();
    const m = /ProvidesExplPackage\s*\{luamml\}\s*\{[^}]*\}\s*\{(\d+)\.(\d+)/.exec(readFileSync(sty, 'utf8'));
    return !m || Number(m[1]) + Number(m[2]) / 10 < 0.8;
  } catch { return false; }
})();

/** Every glyph of a document, in order, with the list it is in. */
function glyphs(d: SerializerOutput): TexNode[] {
  const out: TexNode[] = [];
  forEachNode(d, n => { if (n.type === 'glyph') out.push(n); });
  return out;
}
/** The paragraphs' text, unbroken (discretionaries' replacement texts). */
function paragraphText(d: SerializerOutput): string[] {
  const text = (nodes: TexNode[] | undefined): string => (nodes ?? []).map(n =>
    n.type === 'glyph' ? String.fromCodePoint(n.char ?? 0x3f)
      : n.type === 'glue' ? ' ' : text(n.children) + text(n.replace)).join('');
  return d.paragraphs.map(p => text(p.nodes).replace(/\s+/g, ' ').trim());
}

for (const id of ids) {
  const backend = createBackend(id);
  const caps = backend.capabilities;
  const available = backend.availability();

  describe(`backend ${id}`, () => {
    test('the descriptor names only known capabilities, each true or false', () => {
      for (const [k, v] of Object.entries(caps)) {
        assert.ok((CAPABILITY_NAMES as readonly string[]).includes(k), `unknown capability ${k}`);
        assert.equal(typeof v, 'boolean', `${k} is ${typeof v}`);
      }
    });

    if (!available.ok) {
      test('not available: selecting it fails clearly, and so does opening a document', async () => {
        assert.throws(() => new Pipeline({ buildRoot: join(ROOT, id), fontsDir: join(ROOT, id, 'fonts'), backend: id, log: new Log('pipeline') }),
          (e: Error) => e instanceof BackendUnavailable && e.message.includes('not available'));
        await assert.rejects(backend.open({ content: fixture('base'), preamble: '', dir: join(ROOT, id, 'x'), label: 'base',
          searchDirs: [], localFonts: [], mathml: false }), BackendUnavailable);
      });
      for (const c of CAPABILITY_NAMES) test(c, { skip: available.reason }, () => {});
      return;
    }
    conformance(id, backend);
  });
}

function conformance(id: string, backend: CaptureBackend): void {
  const caps = backend.capabilities;
  const claims = (c: CapabilityName) => supports(caps, c);
  const skip = (c: CapabilityName) => (claims(c) ? false : `${id} does not claim ${c}`);
  const pipe = new Pipeline({ buildRoot: join(ROOT, id, 'build'), fontsDir: join(ROOT, id, 'fonts'), backend, log: new Log('pipeline') });

  /** A fixture compiled by the pipeline once: its bytes and its output.json. */
  const built = new Map<string, Promise<{ bytes: Uint8Array; data: SerializerOutput; key: string }>>();
  const build = (name: string, passes = 1) => {
    const k = `${name}/${passes}`;
    if (!built.has(k)) built.set(k, (async () => {
      const content = fixture(name), key = contentKey(content, `passes ${passes}`);
      const bytes = await pipe.compile(content, '', { key, passes, name });
      return { bytes, key, data: readSerializerOutput(readFileSync(join(pipe.buildRoot, key, 'output.json'), 'utf8')) };
    })());
    return built.get(k)!;
  };

  // ── The base contract: every backend ──────────────────────────────────────

  test('base: paragraphs, fonts with files, content items; encodes', async () => {
    const { bytes, data } = await build('base');
    assert.ok(bytes.length > 0);
    assert.ok(data.paragraphs.length >= 2, 'two paragraphs');
    const text = paragraphText(data).join(' ');
    for (const w of ['Every backend sets this paragraph', 'A second paragraph.']) assert.ok(text.includes(w), `${w} in ${text}`);
    const kinds = new Set(data.content.map(i => i.kind));
    assert.ok(kinds.has('paragraph'), [...kinds].join());
    for (const g of glyphs(data)) assert.ok(data.fonts.has(String(g.font)), `glyph font ${g.font} is in the font table`);
    // the fixture's fonts all have outlines: none is drawn as boxes
    for (const [fid, f] of data.fonts) assert.ok(f.face.kind === 'opentype' || f.face.kind === 'type1', `font ${fid} (${f.name}) has a face: ${JSON.stringify(f.face)}`);
    assert.ok(Number(data.source_width) > 0, 'reports its width');
  });

  test('base: a capture at the document width gives the node lists and diagnostics', async () => {
    const dir = join(ROOT, id, 'direct-base');
    const job = await backend.open({ content: fixture('base'), preamble: '', dir, label: 'direct base', searchDirs: [], localFonts: [], mathml: false });
    try {
      const r = await job.capture({ widthExtraSp: 0, passes: 1 });
      assert.ok(r.data.paragraphs.length >= 2);
      assert.ok(Array.isArray(r.diagnostics));
      for (const d of r.diagnostics) assert.ok(d.severity === 'warning' || d.severity === 'error');
      assert.equal(typeof r.dir, 'string');
    } finally { await job.close?.(); }
  });

  test('base: fonts provision for the page', async () => {
    await build('base');
    await pipe.finishFonts();
    assert.ok(Object.keys(pipe.fontMap()).length > 0);
  });

  // ── Capabilities, each checked only when claimed ──────────────────────────

  test('multiPass: a forward reference resolves', { skip: skip('multiPass') }, async () => {
    const { data } = await build('multipass', 3);
    const text = paragraphText(data)[0];
    assert.match(text, /See Section 2\./, text);
  });

  test('widthResampling: a wider capture reports the width it used', { skip: skip('widthResampling') }, async () => {
    const dir = join(ROOT, id, 'direct-displays');
    const job = await backend.open({ content: fixture('displays'), preamble: '', dir, label: 'direct displays', searchDirs: [], localFonts: [], mathml: false });
    try {
      const a = await job.capture({ widthExtraSp: 0, passes: 1 });
      const extra = 128 * 65536;
      const b = await job.capture({ widthExtraSp: extra, passes: 1 });
      assert.equal(Number(b.data.source_width) - Number(a.data.source_width), extra);
    } finally { await job.close?.(); }
  });

  test('widthResampling: the pipeline models the displays', { skip: skip('widthResampling') }, async () => {
    const { data } = await build('displays');
    assert.equal(data.display_model, true);
    assert.ok(data.content.some(i => i.kind === 'display'));
  });

  test('singlePassDisplays: one capture carries the display model', { skip: skip('singlePassDisplays') }, async () => {
    const dir = join(ROOT, id, 'direct-displays-1');
    const job = await backend.open({ content: fixture('displays'), preamble: '', dir, label: 'one pass displays', searchDirs: [], localFonts: [], mathml: false });
    try {
      const r = await job.capture({ widthExtraSp: 0, passes: 1 });
      assert.equal(r.data.display_model, true);
    } finally { await job.close?.(); }
  });

  test('opentypeFonts: glyphs from an OpenType file', { skip: skip('opentypeFonts') }, async () => {
    const { data } = await build('opentype');
    const files = [...data.fonts.values()].map(f => (f.face.kind === 'opentype' ? f.face.file : ''));
    assert.ok(files.some(f => /lmroman10-regular\.otf$/i.test(f)), files.join());
    assert.ok(paragraphText(data)[0].startsWith('OpenType text'));
  });

  test('classicFonts: T1 and OT1 Computer Modern, served', { skip: skip('classicFonts') }, async () => {
    const { data } = await build('classic');
    const names = [...data.fonts.values()].map(f => f.name);
    assert.ok(names.some(n => /^ec/.test(n)), `a T1 (EC) font: ${names}`);
    assert.ok(names.some(n => /^cmr/.test(n)), `an OT1 (CM) font: ${names}`);
    for (const f of data.fonts.values()) if (/^(ec|cm)/.test(f.name)) assert.equal(f.face.kind, 'type1', `${f.name} served from its Type 1 outlines`);
    assert.match(paragraphText(data)[0], /caf/);
  });

  test('protrusion: protrude_chars and protrusion codes', { skip: skip('protrusion') }, async () => {
    const { data } = await build('protrusion');
    assert.ok(data.paragraphs.some(p => Number(p.protrude_chars) > 0));
    const codes = [...data.fonts.values()].flatMap(f => (f.codes as { lp: number; rp: number }[] | undefined) ?? []);
    assert.ok(codes.some(c => c.rp > 0), 'right protrusion for some character');
  });

  test('fontExpansion: adjust_spacing and expansion limits', { skip: skip('fontExpansion') }, async () => {
    const { data } = await build('expansion');
    assert.ok(data.paragraphs.some(p => Number(p.adjust_spacing) > 0));
    assert.ok([...data.fonts.values()].some(f => Number(f.expand_stretch) > 0 && Number(f.expand_step) > 0));
  });

  test('pictures: a TikZ picture becomes SVG', { skip: skip('pictures') }, async () => {
    const { data } = await build('pictures');
    const pics = data.pictures as { svg: string; vb_w: number; vb_h: number }[];
    assert.equal(pics.length, 1);
    assert.ok(pics[0].vb_w > 0 && pics[0].vb_h > 0);
    let refs = 0;
    forEachNode(data, n => { if (n.type === 'picture' && n.picture === 1) refs++; });
    assert.equal(refs, 1);
  });

  test('companion: a widget with its parameters and a stream', { skip: skip('companion') }, async () => {
    const { data } = await build('companion');
    const slots = data.slots as { kind: string; name: string; attrs?: { key: string; value: string }[] }[];
    assert.deepEqual(slots.map(s => [s.kind, s.name, s.attrs?.map(a => `${a.key}=${a.value}`)]), [['widget', 'badge', ['tone=warm']]]);
    assert.ok(data.streams.some(s => s.kind === 'box'));
  });

  test('batchParts: two parts of one document, numbering carried', { skip: skip('batchParts') }, async () => {
    const parts = [{ key: `${id}-part-a`, content: '\\section{One}\nFirst part.' }, { key: `${id}-part-b`, content: '\\section{Two}\nSecond part.' }];
    const out = await pipe.compileBatch(parts, '', { name: 'batch' });
    assert.deepEqual([...out.keys()], parts.map(p => p.key));
    const second = readSerializerOutput(readFileSync(join(pipe.buildRoot, parts[1].key, 'output.json'), 'utf8'));
    assert.ok(paragraphText(second).some(t => /^2 ?Two/.test(t)), paragraphText(second).join(' | '));
  });

  test('tagging: \\DocumentMetadata honoured, the text as without it', { skip: skip('tagging') || (oldLuamml && 'TeX Live older than 2026 (luamml < 0.8)') }, async () => {
    const { data } = await build('tagging');
    assert.match(paragraphText(data)[0], /^Tagged text/);
  });

  test('mathml: LaTeX\'s MathML on each formula', { skip: skip('mathml') || (oldLuamml && 'TeX Live older than 2026 (luamml < 0.8)') }, async () => {
    const { data } = await build('mathml');
    let inline = 0;
    forEachNode(data, n => { if (n.type === 'math' && typeof n.mathml === 'string' && n.mathml.includes('<math')) inline++; });
    assert.ok(inline >= 1, 'the inline formula');
    assert.ok(data.content.some(i => i.kind === 'display' && String(i.mathml).includes('<mfrac')), 'the display');
  });

  const sourceOf = (g: TexNode) => g.src as GlyphSource | undefined;
  test('glyphSourceLines: each glyph knows its line', { skip: skip('glyphSourceLines') }, async () => {
    const { data } = await build('sources');
    const gs = glyphs(data);
    assert.ok(gs.length > 0);
    for (const g of gs) assert.ok(sourceOf(g) && sourceOf(g)!.line >= 1, `glyph ${g.char} has a source line`);
    const line = (ch: string) => sourceOf(gs.find(g => g.char === ch.codePointAt(0))!)!.line;
    assert.equal(line('f'), 4);          // "four"
    assert.equal(line('v'), 5);          // "five"
  });

  test('glyphSourceMap: each glyph knows its column and length', { skip: skip('glyphSourceMap') }, async () => {
    const { data } = await build('sources');
    const src = fixture('sources').split('\n');
    for (const g of glyphs(data)) {
      const s = sourceOf(g);
      assert.ok(s && typeof s.column === 'number' && typeof s.length === 'number', `glyph ${g.char} has a column`);
      if (s!.file === '' && s!.length === 1) assert.equal(src[s!.line - 1][s!.column!], String.fromCodePoint(g.char!));
    }
  });

  test('texBreaks: TeX\'s own breaks per paragraph', { skip: skip('texBreaks') }, async () => {
    const { data } = await build('base');
    for (const p of data.paragraphs) assert.ok(Array.isArray(p.tex_breaks), 'tex_breaks');
  });

  test('incremental: no shared check yet', { skip: skip('incremental'), todo: 'the interface has no shared entry point for it yet; the backend\'s own tests cover it' }, () => {
    assert.fail('not checked here yet');
  });

  test('inBrowser: no shared check in Node', { skip: skip('inBrowser'), todo: 'checked by the backend\'s own browser tests' }, () => {
    assert.fail('not checked here yet');
  });

  test('shellEscape: a shell command runs when asked for, and only then', { skip: skip('shellEscape') }, async () => {
    for (const on of [false, true]) {
      const dir = join(ROOT, id, `shell-escape-${on}`);
      const b = createBackend(id, { shellEscape: on });
      const job = await b.open({ content: fixture('shell-escape'), preamble: '', dir, label: 'shell escape', searchDirs: [], localFonts: [], mathml: false });
      try {
        const r = await job.capture({ widthExtraSp: 0, passes: 1 });
        assert.equal(existsSync(join(r.dir, 'shell-escape-ran.txt')), on, `shell escape ${on ? 'on' : 'off'}`);
      } finally { await job.close?.(); }
    }
  });

  test('every capability has a check here', () => {
    const checked: CapabilityName[] = ['multiPass', 'widthResampling', 'singlePassDisplays', 'opentypeFonts', 'classicFonts', 'protrusion',
      'fontExpansion', 'pictures', 'companion', 'batchParts', 'tagging', 'mathml', 'glyphSourceLines', 'glyphSourceMap', 'texBreaks',
      'incremental', 'inBrowser', 'shellEscape'];
    assert.deepEqual([...checked].sort(), [...CAPABILITY_NAMES].sort());
  });

  test('the encoder takes every fixture', async () => {
    for (const k of built.keys()) {
      const { data } = await built.get(k)!;
      assert.ok(encodeDocument(structuredClone(data), { pipelineOnly: backend.pipelineOnly }).length > 0, k);
    }
  });
}
