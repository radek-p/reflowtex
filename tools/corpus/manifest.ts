// SPDX-License-Identifier: AGPL-3.0-or-later
// The paper corpus's manifest (corpus/manifest.json): what each paper is,
// where its source comes from and how it is built. fetch.ts, run.ts and
// report.ts all read it through here, so its shape is checked in one place.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(fileURLToPath(new URL('../..', import.meta.url)));
export const CORPUS_DIR = join(REPO, 'corpus');
export const MANIFEST = join(CORPUS_DIR, 'manifest.json');

/** How the paper's bibliography is made before TeX's last passes: nothing
 *  (it ships a .bbl, or uses thebibliography), BibTeX or Biber. */
export type Bibliography = 'none' | 'bibtex' | 'biber';

export interface Paper {
  /** arxiv-<arXiv id> (a '/' in old-style ids as '_'), or the source's own name (ctan-…) */
  id: string;
  title: string;
  authors: string[];
  year: number;
  /** where it appeared: a conference or journal, or the archive it is on */
  venue: string;
  /** the document class */
  class: string;
  /** a coarse group (Computer science, Mathematics, Physics, …) and the field within it */
  domain: string;
  field: string;
  /** SPDX id and the licence's text */
  licence: string;
  licence_url: string;
  /** who to credit and how, as the licence asks */
  attribution: string;
  /** the human landing page where the paper was published (arXiv abstract, the publisher's page, CTAN, GitHub) */
  original_page: string;
  /** the PDF as the authors' own toolchain made it */
  original_url: string;
  /** the version published elsewhere, when the source here is a preprint of it */
  published?: { venue: string; doi?: string; url: string };
  arxiv?: string;
  source: Source;
  /** the main file, relative to the source's root */
  main: string;
  bibliography: Bibliography;
  /** corpus/patches/<id>.patch: what was changed in the source, and why (in the patch's header) */
  patch?: string;
  /** the class and a few packages it loads that are rare in the set (packages.ts) */
  packages: string[];
  /** a paper the pipeline cannot build yet: listed, with the reason, not run */
  supported: boolean;
  reason?: string;
  /** a memory limit for its container (docker's --memory), when the default is too little */
  memory?: string;
}

export interface Source {
  /** the download (arXiv's e-print, a release archive) */
  url: string;
  sha256: string;
  /** the folder inside the archive that is the paper's root, when it is not the archive's own */
  root?: string;
}

export interface Manifest {
  description: string;
  texlive: string;
  tolerance_pt: number;
  /** the goal a paper is held to: placement at least this share, and no vertical jump */
  goal: { placement: number; jumps: number };
  papers: Paper[];
}

const ID = /^[a-z0-9][a-z0-9._-]*$/;

/** The manifest, checked: every paper with the fields the tools rely on, ids unique and safe as folder names. */
export function loadManifest(file = MANIFEST): Manifest {
  const m = JSON.parse(readFileSync(file, 'utf8')) as Manifest;
  checkManifest(m);
  return m;
}

export function checkManifest(m: Manifest): void {
  if (!Array.isArray(m.papers)) throw new Error('manifest: no papers');
  const seen = new Set<string>();
  for (const p of m.papers) {
    const where = `manifest: ${p.id ?? '(no id)'}`;
    if (typeof p.id !== 'string' || !ID.test(p.id)) throw new Error(`${where}: an id is lower case letters, digits, '.', '_' and '-'`);
    if (seen.has(p.id)) throw new Error(`${where}: listed twice`);
    seen.add(p.id);
    for (const k of ['title', 'venue', 'class', 'domain', 'field', 'licence', 'licence_url', 'attribution', 'original_page', 'original_url', 'main'] as const)
      if (typeof p[k] !== 'string' || !p[k]) throw new Error(`${where}: no ${k}`);
    if (!Array.isArray(p.authors) || !p.authors.length) throw new Error(`${where}: no authors`);
    if (!Array.isArray(p.packages)) throw new Error(`${where}: no packages`);
    if (!['none', 'bibtex', 'biber'].includes(p.bibliography)) throw new Error(`${where}: bibliography is none, bibtex or biber`);
    if (!p.source?.url || !/^https:\/\//.test(p.source.url)) throw new Error(`${where}: the source is an https URL`);
    if (!/^[0-9a-f]{64}$/.test(p.source.sha256 ?? '')) throw new Error(`${where}: no sha256 of the source`);
    if (!safeRelative(p.main) || (p.source.root !== undefined && !safeRelative(p.source.root))) throw new Error(`${where}: main and root are paths inside the source`);
    if (p.patch !== undefined && p.patch !== `patches/${p.id}.patch`) throw new Error(`${where}: its patch is patches/${p.id}.patch`);
    if (typeof p.supported !== 'boolean' || (!p.supported && !p.reason)) throw new Error(`${where}: a paper not supported says why`);
  }
}

/** A relative path that stays inside its root: no absolute path, no '..', no empty part. */
export function safeRelative(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false;
  return path.split('/').every(s => s !== '' && s !== '.' && s !== '..');
}

export const patchFile = (p: Paper): string | null => (p.patch ? join(CORPUS_DIR, p.patch) : null);
export const manifestDir = (file: string): string => dirname(resolve(file));
