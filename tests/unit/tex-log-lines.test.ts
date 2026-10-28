// SPDX-License-Identifier: AGPL-3.0-or-later
// TeX's broken log lines, as every reader of the log joins them: one log
// written by LuaTeX (fixtures/luatex-broken-lines.log: lualatex of
// fixtures/luatex-broken-lines.tex as doc.tex, TeX Live 2026, with shell
// escape off), whose figure names, messages, file and font names are long
// and not ASCII, so LuaTeX broke them where it breaks lines: at 79 bytes of
// UTF-8, before a character of several bytes that would not fit (a line of
// 77 bytes), and at 80 bytes after a font's name. Each reader
// must find its record whole.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requestedFigures } from '../../src/pipeline/figures.ts';
import { texErrors } from '../../src/pipeline/tex-log.ts';
import { logDiagnostics, missingCharsFromLog } from '../../src/pipeline/backend/tex-log.ts';

const fixture = (name: string) => new URL(`fixtures/${name}`, import.meta.url);
const LOG = readFileSync(fixture('luatex-broken-lines.log'));
const CHAPTER = 'rozdziały/część-pierwsza-wprowadzenie-do-zagadnień-teoretycznych/sekcja.tex';

test('the log is broken as LuaTeX breaks it: by bytes, never inside a character, at 80 bytes after a name', () => {
  const lengths = LOG.toString('latin1').split('\n').map(l => l.length);
  const text = LOG.toString('utf8').split('\n');
  const at = (start: string) => lengths[text.findIndex(l => l.startsWith(start))];
  assert.equal(at('Package epstopdf Info: Source file: <figures/wykres'), 79, 'bytes, not characters (76 of them)');
  assert.equal(at('Package epstopdf Info: Source file: <figures/distribution'), 77, 'ł would not fit in 79');
  assert.equal(at('(./rozdziały'), 79, 'a file\'s name, 74 characters');
  assert.ok(lengths.includes(80) && !lengths.slice(1).some(n => n > 80), 'text printed after a name runs to 80 bytes, no further (the banner, first, is not broken)');
});

test('epstopdf\'s requests, their names broken at 79 bytes or before a character that would not fit', () => {
  assert.deepEqual(requestedFigures(LOG.toString('utf8')), [
    { source: 'figures/wykres-zależności-czasu-od-rozmiaru-danych.eps', output: 'figures/wykres-zależności-czasu-od-rozmiaru-danych-eps-converted-to.pdf' },
    { source: 'figures/distribution-of-the-run-times-xxłódź.eps', output: 'figures/distribution-of-the-run-times-xxłódź-eps-converted-to.pdf' },
  ]);
});

test('errors: each message whole, with no space where TeX broke it; the file whose name TeX broke at 80 bytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rtx-tex-log-lines-'));
  try {
    copyFileSync(fixture('luatex-broken-lines.tex'), join(dir, 'doc.tex'));
    mkdirSync(join(dir, CHAPTER, '..'), { recursive: true });
    writeFileSync(join(dir, CHAPTER), 'Tekst sekcji.\nZdanie z błędem \\nieznanepolecenie{} w środku.\n');
    assert.deepEqual(texErrors(LOG.toString('utf8'), dir), [
      { message: 'Package luatex.def Error: File `figures/wykres-zależności-czasu-od-rozmiaru-danych-eps-converted-to.pdf\' not found: using draft setting.',
        file: './doc.tex', line: 4, context: '...-zależności-czasu-od-rozmiaru-danych.eps}', count: 1 },
      { message: 'Package luatex.def Error: File `figures/distribution-of-the-run-times-xxłódź-eps-converted-to.pdf\' not found: using draft setting.',
        file: './doc.tex', line: 5, context: '...istribution-of-the-run-times-xxłódź.eps}', count: 1 },
      { message: 'Package demo Error: Nie można zapisać pliku wyników: katalog docelowy jest tylko do odczytu.',
        file: './doc.tex', line: 7, context: '...: katalog docelowy jest tylko do odczytu}{}', count: 1 },
      { message: 'Undefined control sequence.', file: `./${CHAPTER}`, line: 2, context: 'Zdanie z błędem \\nieznanepolecenie', count: 1 },
    ]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('warnings: a message TeX broke is whole, with the input line it ends with', () => {
  assert.deepEqual(logDiagnostics(LOG.toString('utf8')), [
    { severity: 'warning', message: 'Ostrzeżenie: źródło danych zawiera wartości spoza zakresu, więc wykres jest przycięty on input line 6.', line: 6 },
  ]);
});

test('missing characters: lines of 79 and 80 bytes, some whole, some broken after the font\'s name', () => {
  const brief = missingCharsFromLog(LOG).map(m => [m.font, m.char, m.count]);
  assert.deepEqual(brief, [
    ['file:lmroman10-regular.otf', 0x2550, 3], ['file:lmroman10-regular.otf', 0x1F600, 3], ['file:lmroman10-regular.otf', 0x10FFFD, 3],
    ['file:lmroman10-italic.otf', 0x1F600, 3], ['file:lmroman10-italic.otf', 0x10FFFD, 3], ['file:lmroman10-bolditalic.otf', 0x2550, 3],
  ]);
});
