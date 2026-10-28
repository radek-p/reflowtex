// SPDX-License-Identifier: AGPL-3.0-or-later
// Capture backends without TeX (src/pipeline/backend): the registry and
// selection, the capabilities descriptor and its reading, what the pipeline
// asks of a backend (with a backend made here, in memory), the LuaTeX
// backend's log reading, and the integrations' --backend and
// --list-backends. The backends themselves are checked against TeX by the
// conformance suite (tests/backends).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Pipeline, toolchainHash, type CompileOptions } from '../../src/pipeline/pipeline.ts';
import { BackendUnavailable, MissingCapability, UnknownBackend } from '../../src/pipeline/errors.ts';
import {
  CAPABILITIES, CAPABILITY_NAMES, documentNeeds, fullCapabilities, supports, unmetNeeds,
  createBackend, listBackends, registerBackend, unregisterBackend, selectedBackendId, formatBackends, DEFAULT_BACKEND,
  type Capabilities, type CaptureBackend, type CaptureDocument, type CaptureRun,
} from '../../src/pipeline/backend/index.ts';
import { Log } from '../../src/shared/log.ts';
import { logDiagnostics } from '../../src/pipeline/backend/luatex.ts';
import type { SerializerOutput } from '../../src/pipeline/nodes.ts';

const REPO = new URL('../../', import.meta.url).pathname;
const run = promisify(execFile);
const tmp = () => mkdtempSync(join(tmpdir(), 'reflowtex-backends-'));

// ── The registry and selection ───────────────────────────────────────────────

test('the backends: LuaTeX the default and available, Tectonic registered but not available, claiming nothing', () => {
  const list = listBackends();
  assert.equal(list[0].id, 'luatex');
  assert.equal(list[0].default, true);
  assert.equal(list[0].available, true);
  const t = list.find(b => b.id === 'tectonic')!;
  assert.equal(t.available, false);
  assert.match(t.reason!, /not available in this build/);
  assert.deepEqual(Object.keys(t.capabilities).sort(), [...CAPABILITY_NAMES].sort(), 'every capability listed');
  assert.ok(Object.values(t.capabilities).every(v => v === false));
  assert.equal(list[0].capabilities.mathml, true);
  assert.equal(list[0].capabilities.glyphSourceMap, false);
});

test('choosing a backend: explicit, else REFLOWTEX_BACKEND, else luatex', () => {
  assert.equal(selectedBackendId({ env: {} }), DEFAULT_BACKEND);
  assert.equal(selectedBackendId({ env: { REFLOWTEX_BACKEND: 'tectonic' } }), 'tectonic');
  assert.equal(selectedBackendId({ flag: 'luatex', env: { REFLOWTEX_BACKEND: 'tectonic' } }), 'luatex');
});

test('an unknown backend names the ones there are; an unavailable one says why, at once', () => {
  assert.throws(() => createBackend('nope'), (e: Error) => e instanceof UnknownBackend && /luatex, tectonic/.test(e.message));
  const dir = tmp();
  assert.throws(() => new Pipeline({ buildRoot: dir, fontsDir: join(dir, 'f'), backend: 'tectonic', log: new Log('pipeline') }),
    (e: Error) => e instanceof BackendUnavailable && /Tectonic backend is not available in this build/.test(e.message));
});

// ── Capabilities ─────────────────────────────────────────────────────────────

test('a capability is had only when claimed true: absent, unknown or not a boolean is false', () => {
  const caps = { pictures: true, mathml: false, made_up: true, tagging: 'yes' } as unknown as Capabilities;
  assert.equal(supports(caps, 'pictures'), true);
  assert.equal(supports(caps, 'mathml'), false);
  assert.equal(supports(caps, 'companion'), false);
  assert.equal(supports(caps, 'made_up'), false, 'not a capability');
  assert.equal(supports(caps, 'tagging'), false, 'not true');
  assert.equal(supports(undefined, 'pictures'), false);
  assert.equal(supports({}, 'toString'), false, 'not inherited');
  const full = fullCapabilities(caps);
  assert.deepEqual(Object.keys(full), [...CAPABILITY_NAMES]);
  assert.equal(full.pictures, true);
  assert.equal(full.tagging, false);
});

test('every capability has its meaning, and docs/backends.md lists each', () => {
  assert.deepEqual(CAPABILITIES.map(c => c.name), [...CAPABILITY_NAMES]);
  const doc = readFileSync(join(REPO, 'docs/backends.md'), 'utf8');
  for (const c of CAPABILITIES) {
    assert.ok(c.meaning.length > 20, c.name);
    assert.ok(doc.includes(`| \`${c.name}\` |`), `docs/backends.md has a row for ${c.name}`);
  }
});

test('what a document needs, read off its source', () => {
  const needs = (c: string, p = '', o = {}) => documentNeeds(c, p, o).map(n => n.capability).sort();
  assert.deepEqual(needs('Plain text.'), []);
  assert.deepEqual(needs('\\begin{tikzpicture}\\end{tikzpicture}'), ['pictures']);
  assert.deepEqual(needs('x', '\\usepackage{tikz}'), [], 'loading TikZ draws nothing');
  assert.deepEqual(needs('\\includegraphics{a.pdf}'), ['pictures']);
  assert.deepEqual(needs('x', '\\usepackage{microtype}'), ['fontExpansion', 'protrusion']);
  assert.deepEqual(needs('x', '\\usepackage[expansion=false]{microtype}'), ['protrusion']);
  assert.deepEqual(needs('x', '\\usepackage{amsmath,fontspec}'), ['opentypeFonts']);
  assert.deepEqual(needs('x', '\\usepackage{reflowtex}'), ['companion']);
  assert.deepEqual(needs('x', '\\DocumentMetadata{tagging=on}'), ['tagging']);
  assert.deepEqual(needs('x', '\\DocumentMetadata{tagging=on}\n\\tagpdfsetup{math/mathml/luamml/load=true}'), ['mathml', 'tagging']);
  assert.deepEqual(needs('x', '% \\usepackage{fontspec}'), [], 'a comment is not a need');
  assert.deepEqual(needs('x', '', { passes: 3 }), ['multiPass']);
  assert.deepEqual(needs('x', '', { batch: true }), ['batchParts']);
  assert.deepEqual(unmetNeeds(documentNeeds('\\tikz \\draw (0,0);', '\\usepackage{microtype}'), { pictures: true }).map(n => n.capability).sort(),
    ['fontExpansion', 'protrusion']);
});

// ── The pipeline with a backend of its own ───────────────────────────────────

/** A minimal output.json: one paragraph (a kern), and a display if asked. */
function output(o: { display?: boolean; modelled?: boolean; width?: number } = {}): SerializerOutput {
  const box = { type: 'hlist', width: 100 * 65536, height: 10 * 65536, depth: 0, children: [] };
  return {
    fonts: new Map(), streams: [], source_width: o.width ?? 300 * 65536,
    paragraphs: [{ nodes: [{ type: 'kern', subtype: 0, kern: 65536 }] }],
    content: [{ kind: 'paragraph', para: 1 }, ...(o.display ? [{ kind: 'display', box }] : [])],
    ...(o.modelled ? { display_model: true } : {}),
  } as SerializerOutput;
}

/** A backend made here: its captures counted, the runs it was asked for kept. */
function memoryBackend(caps: Capabilities, make: (run: CaptureRun) => SerializerOutput): CaptureBackend & { runs: CaptureRun[]; docs: CaptureDocument[] } {
  const runs: CaptureRun[] = [], docs: CaptureDocument[] = [];
  return {
    id: 'memory', name: 'in memory', runtime: { kind: 'none', concurrent: true }, capabilities: caps, runs, docs,
    availability: () => ({ ok: true }),
    open: async doc => {
      docs.push(doc);
      return { capture: async r => { runs.push(r); return { data: make(r), dir: doc.dir, diagnostics: [{ severity: 'warning', message: 'from memory' }] }; } };
    },
  };
}

const pipeline = (backend: CaptureBackend, o: { missingCapabilities?: 'error' | 'warn' } = {}) => {
  const dir = tmp(), log = new Log('pipeline');
  return { pipe: new Pipeline({ buildRoot: dir, fontsDir: join(dir, 'fonts'), backend, log, ...o }), log };
};
/** The pipeline's records, as `level code: message` lines (for messages on failure). */
const lines = (log: Log) => log.records().map(r => `${r.level} ${r.code}:${r.message}`).join('\n');

test('a backend given as an object compiles through the pipeline; its diagnostics are kept by key', async () => {
  const b = memoryBackend({}, () => output());
  const { pipe } = pipeline(b);
  const bytes = await pipe.compile('Text.', { kind: 'snippet', key: 'k1' });
  assert.ok(bytes.length > 0);
  assert.equal(pipe.backend, b);
  assert.deepEqual(b.runs, [{ widthExtraSp: 0, passes: 1 }]);
  assert.equal(b.docs[0].content, 'Text.', 'the document as written: the backend prepares it');
  assert.deepEqual(pipe.diagnostics.get('k1'), [{ severity: 'warning', message: 'from memory' }]);
});

test('the kind the caller gives reaches the backend with the preamble and metadata, ', async () => {
  const b = memoryBackend({}, () => output());
  const { pipe } = pipeline(b);
  await pipe.compile('\\documentclass{book}\nX', { kind: 'snippet', preamble: '\\documentclass{article}', key: 'k', documentMetadata: { keys: 'lang=de' }, jobname: 'paper' });
  assert.deepEqual([b.docs[0].kind, b.docs[0].preamble, b.docs[0].documentMetadata, b.docs[0].jobname], ['snippet', '\\documentclass{article}', { keys: 'lang=de' }, 'paper']);
});

test('no kind given: an error naming the option, before anything is compiled', async () => {
  const b = memoryBackend({}, () => output());
  const { pipe } = pipeline(b);
  await assert.rejects(pipe.compile('Text.', { key: 's' } as unknown as CompileOptions), /the option kind is required: 'document' .* or 'snippet'/);
  assert.equal(b.docs.length, 0);
});

test('displays: sampled only when the backend can compile wider; else kept at the width, with a warning', async () => {
  const plain = memoryBackend({}, () => output({ display: true }));
  const a = pipeline(plain);
  await a.pipe.compile('\\[x\\]', { kind: 'snippet', key: 'd1' });
  assert.equal(plain.runs.length, 1, 'no width samples asked of a backend without widthResampling');
  assert.ok(a.log.records().some(r => r.level === 'warning' && r.code === 'display-widths-unsupported' && r.details.block === 'd1' &&
    /^  d1: warning: backend memory cannot compile at other widths; displays stay/.test(r.message)), lines(a.log));

  const modelled = memoryBackend({ singlePassDisplays: true, widthResampling: true }, () => output({ display: true, modelled: true }));
  const b = pipeline(modelled);
  await b.pipe.compile('\\[x\\]', { kind: 'snippet', key: 'd2' });
  assert.equal(modelled.runs.length, 1, 'the backend modelled the displays: no samples');
  assert.ok(!b.log.records().some(r => r.level === 'warning'), lines(b.log));

  const resampling = memoryBackend({ widthResampling: true }, r => output({ display: true, width: 300 * 65536 + r.widthExtraSp }));
  const c = pipeline(resampling);
  await c.pipe.compile('\\[x\\]', { kind: 'snippet', key: 'd3' });
  assert.deepEqual(resampling.runs.map(r => r.widthExtraSp / 65536), [0, 128, 256], 'the document, then two wider samples');
  // the build's lines are records of the log, each with its code, the line as printed its message
  const stable = c.log.records().filter(r => r.code === 'display-model-stable');
  assert.deepEqual(stable.map(r => [r.level, r.source, r.message, r.details]),
    [['info', 'pipeline', '  d3: display model stable at 300, 428, 556 pt', { block: 'd3', widths: '300, 428, 556' }]], lines(c.log));
});

test('passes: asked of a backend only when it can run again', async () => {
  const one = memoryBackend({}, () => output()), many = memoryBackend({ multiPass: true }, () => output());
  await pipeline(one, { missingCapabilities: 'warn' }).pipe.compile('x', { kind: 'snippet', passes: 3 });
  await pipeline(many).pipe.compile('x', { kind: 'snippet', passes: 3 });
  assert.equal(one.runs[0].passes, 1);
  assert.equal(many.runs[0].passes, 3);
});

test('a missing capability: an error where the result would be wrong, a warning where only less refined', async () => {
  const b = memoryBackend({}, () => output());
  const { pipe, log } = pipeline(b);
  await assert.rejects(pipe.compile('\\begin{tikzpicture}\\end{tikzpicture}', { kind: 'snippet', key: 'p' }),
    (e: Error) => e instanceof MissingCapability && /backend memory lacks pictures/.test(e.message));
  assert.equal(b.runs.length, 0, 'nothing compiled');
  await pipe.compile('x', { kind: 'snippet', preamble: '\\usepackage{microtype}', key: 'm' });
  assert.ok(log.records().some(r => r.level === 'warning' && r.code === 'missing-capability' && r.details.capability === 'protrusion' &&
    /warning: backend memory lacks protrusion/.test(r.message)), lines(log));
  const lenient = pipeline(b, { missingCapabilities: 'warn' });
  await lenient.pipe.compile('\\begin{tikzpicture}\\end{tikzpicture}', { kind: 'snippet', key: 'p2' });
  assert.ok(lenient.log.records().some(r => r.code === 'missing-capability' && /warning: backend memory lacks pictures/.test(r.message)), lines(lenient.log));
});

test('the first of several documents runs alone only for a backend that asks for it', async () => {
  let open = 0, most = 0;
  const b = memoryBackend({}, () => output());
  const counted: CaptureBackend = {
    ...b, runtime: { kind: 'process', concurrent: true, firstRunAlone: false },
    open: async doc => {
      const job = await b.open(doc);
      return { capture: async r => { open++; most = Math.max(most, open); await new Promise(res => setImmediate(res)); open--; return job.capture(r); } };
    },
  };
  const { pipe } = pipeline(counted);
  await pipe.compileMany(['a', 'b', 'c'].map(k => ({ key: k, content: k, kind: 'snippet' as const })), 3);
  assert.equal(most, 3, 'all three at once');
});

test('a host can register a backend of its own', () => {
  registerBackend('memory-test', () => ({ ...memoryBackend({ pictures: true }, () => output()), id: 'memory-test' }));
  registerBackend('misnamed', () => memoryBackend({}, () => output()));
  assert.throws(() => createBackend('misnamed'), /registered as "misnamed" calls itself "memory"/);
  unregisterBackend('misnamed');
  const info = listBackends().find(b => b.id === 'memory-test')!;
  assert.equal(info.capabilities.pictures, true);
  assert.match(formatBackends([info]), /memory-test: in memory\n {2}available\n.*\n {2}capabilities: pictures/);
  unregisterBackend('memory-test');
  assert.ok(!listBackends().some(b => b.id === 'memory-test'));
});

test('the toolchain hash: as before for LuaTeX, another for another backend', () => {
  assert.equal(toolchainHash(undefined, 'luatex'), toolchainHash());
  assert.notEqual(toolchainHash(undefined, 'tectonic'), toolchainHash());
});

// ── The LuaTeX backend, without TeX ──────────────────────────────────────────

test('LuaTeX log warnings, with their continuation lines and input lines', () => {
  const log = [
    'LaTeX Warning: Reference `sec:x\' on page 1 undefined on input line 12.',
    '',
    'Package hyperref Warning: Token not allowed in a PDF string (Unicode):',
    '(hyperref)                removing `math shift\' on input line 7.',
    '',
    'LaTeX Font Warning: not matched.',
    'Class article Warning: Something odd.',
    'Overfull \\hbox (1.0pt too wide) in paragraph at lines 3--4',
  ].join('\n');
  assert.deepEqual(logDiagnostics(log), [
    { severity: 'warning', message: 'Reference `sec:x\' on page 1 undefined on input line 12.', line: 12 },
    { severity: 'warning', message: 'Token not allowed in a PDF string (Unicode): removing `math shift\' on input line 7.', line: 7 },
    { severity: 'warning', message: 'Something odd.' },
  ]);
});

// ── The integrations' CLIs ───────────────────────────────────────────────────

test('--backend tectonic: a clear error, before anything is compiled', async () => {
  const out = tmp();
  for (const cli of [['integrations/vanilla/build.ts', join(REPO, 'examples/demo'), '-o', out], ['integrations/hugo/prebuild.ts', join(REPO, 'integrations/hugo')]]) {
    await assert.rejects(run(process.execPath, [...cli, '--backend', 'tectonic'], { cwd: REPO }), (e: { code: number; stderr: string }) => {
      assert.equal(e.code, 1);
      assert.match(e.stderr, /the Tectonic backend is not available in this build/);
      return true;
    }, cli[0]);
  }
});

test('--list-backends, as text and as JSON', async () => {
  const { stdout } = await run(process.execPath, ['integrations/vanilla/build.ts', '--list-backends', '--json'], { cwd: REPO });
  const list = JSON.parse(stdout) as { id: string; available: boolean; capabilities: Record<string, boolean> }[];
  assert.deepEqual(list.map(b => [b.id, b.available]), [['luatex', true], ['tectonic', false]]);
  const text = (await run(process.execPath, ['integrations/hugo/prebuild.ts', '--list-backends'], { cwd: REPO })).stdout;
  assert.match(text, /^luatex \(default\): /);
  assert.match(text, /tectonic: .*\n {2}not available: /);
});
