#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// corpus/LICENSES.md from the manifest: each paper, its authors, its
// licence, where it comes from, and what was changed in it.
//
//     node tools/corpus/licences.ts            # writes corpus/LICENSES.md
//     node tools/corpus/licences.ts --check    # fails if it is not up to date
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { CORPUS_DIR, loadManifest, type Manifest } from './manifest.ts';
import { patchReason } from './patch.ts';

export function licencesMd(m: Manifest): string {
  const out = ['# The corpus\'s papers: licences and attribution', '',
    'Each paper of the corpus is the work of its authors, under the licence named here, which allows it to be',
    'redistributed. reflowtex does not ship the papers\' sources: tools/corpus/fetch.ts downloads each from the',
    'address given, checked against its sha256. What the website shows of a paper (its page, typeset by reflowtex',
    'from that source, and the comparison with TeX\'s own typesetting) is a rendering of it, and is credited as below.',
    'Where a source was changed before it was built, the patch in patches/ records the change and why.', ''];
  for (const p of [...m.papers].sort((a, b) => a.id.localeCompare(b.id))) {
    out.push(`## ${p.id}`, '', `**${p.title}**`, '', p.authors.join(', '), '',
      `- Licence: [${p.licence}](${p.licence_url})`,
      `- Published: ${p.original_page}${p.published ? ` (${p.published.venue}${p.published.doi ? `, doi:${p.published.doi}` : ''})` : ''}`,
      `- Source: ${p.source.url} (sha256 \`${p.source.sha256}\`)`,
      ...(p.patch ? [`- Changed: [${p.patch}](${p.patch}). ${patchReason(readFileSync(join(CORPUS_DIR, p.patch), 'utf8'))}`] : []),
      ...(!p.supported ? [`- Not built: ${p.reason}`] : []),
      `- Credit: ${p.attribution}`, '');
  }
  return out.join('\n');
}

if (import.meta.main) {
  const file = join(CORPUS_DIR, 'LICENSES.md'), text = licencesMd(loadManifest());
  if (process.argv.includes('--check')) {
    if (!existsSync(file) || readFileSync(file, 'utf8') !== text) { console.error('corpus/LICENSES.md is not up to date: node tools/corpus/licences.ts'); process.exit(1); }
  } else writeFileSync(file, text);
}
