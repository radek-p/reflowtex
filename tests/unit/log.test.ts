// SPDX-License-Identifier: AGPL-3.0-or-later
// The log (src/shared/log.ts): records collected with their levels and
// codes, a block's warnings taken from its data, the Log tab's filter, the
// alerted level's threshold and the selection of what readers are shown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Log, atLeast, codesOf, consoleSink, countByLevel, isAlertLevel, matchesFilter, parseSelection, selects, toWarning,
         type LogRecord } from '../../src/shared/log.ts';

test('a log keeps its records in order, each with its level, code, source, block and time, and gives each to its sinks', () => {
  const seen: LogRecord[] = [];
  const log = new Log('viewer', [r => seen.push(r)]);
  const a = log.warn('font-replace-failed', 'font x.otf: the new file could not be loaded', { font: 'x.otf', size: 10 });
  const b = log.add({ level: 'info', code: 'note', message: 'n', block: 'b1', source: 'page', time: 5 });
  assert.deepEqual([a.seq, b.seq], [1, 2]);
  assert.equal(a.level, 'warning');
  assert.deepEqual(a.details, { font: 'x.otf', size: '10' }, 'particulars are strings');
  assert.equal(a.source, 'viewer');
  assert.equal(a.block, null);
  assert.ok(Math.abs(a.time - Date.now()) < 10000);
  assert.deepEqual([b.source, b.block, b.time], ['page', 'b1', 5]);
  assert.deepEqual(seen, [a, b]);
  assert.deepEqual(log.records().map(r => r.seq), [1, 2]);
  assert.deepEqual(log.records(1).map(r => r.seq), [2], 'after a seq: those after it');
  // a subscriber from now on; one that throws does not stop the others or the reporter
  const later: string[] = [];
  const stop = log.subscribe(r => later.push(r.code));
  log.subscribe(() => { throw new Error('a broken sink'); });
  log.error('e1', 'one');
  stop();
  log.error('e2', 'two');
  assert.deepEqual(later, ['e1']);
  assert.equal(log.records().length, 4);
});

test("a block's warnings join the log as the build's, with their block; unknown levels count as warnings", () => {
  const log = new Log('viewer');
  const rs = log.addWarnings([
    { level: 'warning', code: 'font-without-face', message: 'font rtxnoface10 has no face', details: { font: 'rtxnoface10' } },
    { level: 'info', code: 'missing-char', message: 'm' },                         // (an empty map decodes as absent)
    { level: 'bogus' as 'info', code: '', message: 'x' },
  ], 'k1');
  assert.deepEqual(rs.map(r => [r.level, r.code, r.source, r.block]),
    [['warning', 'font-without-face', 'pipeline', 'k1'], ['info', 'missing-char', 'pipeline', 'k1'], ['warning', 'unknown', 'pipeline', 'k1']]);
  assert.deepEqual(rs[1].details, {});
  assert.deepEqual(log.addWarnings(undefined, 'k2'), []);
  // and back to the wire form (debug is not carried)
  assert.deepEqual(toWarning({ level: 'debug', code: 'c', message: 'm', details: { a: '1' } }), { level: 'info', code: 'c', message: 'm', details: { a: '1' } });
});

test('levels: a record is at a threshold or above it; none is above every level', () => {
  assert.ok(atLeast('error', 'error') && atLeast('error', 'warning') && atLeast('warning', 'info') && atLeast('debug', 'debug'));
  assert.ok(!atLeast('warning', 'error') && !atLeast('info', 'warning') && !atLeast('debug', 'info'));
  for (const l of ['debug', 'info', 'warning', 'error'] as const) assert.ok(!atLeast(l, 'none'), l);
  assert.ok(isAlertLevel('none') && isAlertLevel('warning') && !isAlertLevel('warn') && !isAlertLevel(undefined));
  // what the default alerted level (error) lets through to the console: errors only
  const log = new Log('viewer');
  const all = [log.debug('d', 'd'), log.info('i', 'i'), log.warn('w', 'w'), log.error('e', 'e')];
  assert.deepEqual(all.filter(r => atLeast(r.level, 'error')).map(r => r.code), ['e']);
  assert.deepEqual(all.filter(r => atLeast(r.level, 'warning')).map(r => r.code), ['w', 'e']);
  assert.deepEqual(all.filter(r => atLeast(r.level, 'none')).map(r => r.code), []);
  assert.deepEqual(countByLevel(all), { debug: 1, info: 1, warning: 1, error: 1 });
});

test('what readers are shown: a selection by code, by level, or both', () => {
  const r = (level: 'info' | 'warning' | 'error', code: string) => ({ level, code });
  const byDefault = ['font-load-failed'];
  assert.ok(selects(byDefault, r('error', 'font-load-failed')));
  assert.ok(!selects(byDefault, r('error', 'kind-failed')), 'another error is not shown by default');
  assert.ok(!selects([], r('error', 'font-load-failed')), '[] shows nothing');
  assert.ok(selects(['error'], r('error', 'kind-failed')) && !selects(['error'], r('warning', 'missing-char')), 'a level: that level and above');
  const both = ['warning', 'font-load-failed'];
  assert.ok(selects(both, r('warning', 'missing-char')) && selects(both, r('error', 'kind-failed')) && !selects(both, r('info', 'note')));
  assert.ok(selects(['missing-char'], r('info', 'missing-char')), 'a code at any level');
  assert.deepEqual(parseSelection('font-load-failed, missing-char  error'), ['font-load-failed', 'missing-char', 'error']);
  assert.deepEqual(parseSelection('none'), []);
  assert.deepEqual(parseSelection(''), []);
});

test("the Log tab's filter: by level, by code, by text in the message, code, particulars or block", () => {
  const log = new Log('viewer');
  log.addWarnings([{ level: 'warning', code: 'missing-char', message: 'U+2192 is not in cmr10', details: { font: 'cmr10', char: '→' } }], 'blockA');
  log.error('font-load-failed', 'Some fonts could not be downloaded (lmroman10)', { fonts: 'lmroman10' });
  log.info('note', 'a page note');
  const rs = log.records();
  const codes = (f: Parameters<typeof matchesFilter>[1]) => rs.filter(r => matchesFilter(r, f)).map(r => r.code);
  assert.deepEqual(codes({}), ['missing-char', 'font-load-failed', 'note'], 'no filter: all');
  assert.deepEqual(codes({ levels: [] }), ['missing-char', 'font-load-failed', 'note'], 'no level chosen: all');
  assert.deepEqual(codes({ levels: new Set(['warning', 'error'] as const) }), ['missing-char', 'font-load-failed']);
  assert.deepEqual(codes({ code: 'note' }), ['note']);
  assert.deepEqual(codes({ text: 'LMROMAN' }), ['font-load-failed'], 'any case');
  assert.deepEqual(codes({ text: 'cmr10' }), ['missing-char'], 'a particular');
  assert.deepEqual(codes({ text: 'blocka' }), ['missing-char'], "the block's key");
  assert.deepEqual(codes({ text: 'font-load' }), ['font-load-failed'], 'the code');
  assert.deepEqual(codes({ levels: ['info'], text: 'cmr10' }), [], 'all must hold');
  assert.deepEqual(codesOf(rs), ['font-load-failed', 'missing-char', 'note']);
});

test("the build's console sink prints each message as one line, errors on stderr, debug only when asked", () => {
  const out: string[] = [], err: string[] = [];
  const { log: l, error: e } = console;
  console.log = (s: string) => { out.push(s); };
  console.error = (s: string) => { err.push(s); };
  try {
    const log = new Log('pipeline', [consoleSink()]);
    log.info('font-provision', '  font-provision: a.otf ← b');
    log.warn('font-without-face', '  fonts: warning: font x has no face');
    log.error('block-failed', 'ERROR: x: it failed');
    log.debug('timing', 'not printed');
    new Log('pipeline', [consoleSink({ debug: true })]).debug('timing', 'printed');
  } finally { console.log = l; console.error = e; }
  assert.deepEqual(out, ['  font-provision: a.otf ← b', '  fonts: warning: font x has no face', 'printed']);
  assert.deepEqual(err, ['ERROR: x: it failed']);
});
