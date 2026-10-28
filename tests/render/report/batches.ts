// SPDX-License-Identifier: AGPL-3.0-or-later
// The report's batches: named sets of results, each its own list and summary
// (the render tests; the paper corpus; whatever else is published beside
// them). batches.json, beside the report page, lists them; without it there
// is one, the render tests in build/. The URL names the batch (?batch=<id>)
// and the result (#<id>), so a link opens both.
//
// No DOM here: the report (app.ts) and the unit tests use it.

export interface Batch {
  id: string; label: string;
  /** its report.json, relative to the report page; a result's dir and page are relative to that file's folder */
  index: string;
  /** where it comes in the selector (ascending; then by label) */
  order?: number;
}

export const DEFAULT_BATCHES: Batch[] = [{ id: 'tests', label: 'Tests', index: 'build/report.json', order: 1 }];

/** The batches listed in batches.json, in order; the default when it lists none. */
export function readBatches(json: unknown): Batch[] {
  const list = (json as { batches?: unknown } | null)?.batches;
  const ok = Array.isArray(list) ? list.filter((b): b is Batch => !!b && typeof b === 'object'
    && typeof (b as Batch).id === 'string' && typeof (b as Batch).label === 'string' && typeof (b as Batch).index === 'string') : [];
  if (!ok.length) return DEFAULT_BATCHES;
  return [...ok].sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.label.localeCompare(b.label));
}

/** The batch the URL's query names (?batch=<id>), else the first. */
export function chooseBatch(batches: Batch[], search: string): Batch {
  const want = new URLSearchParams(search).get('batch');
  return batches.find(b => b.id === want) ?? batches[0];
}

/** The folder a batch's results are relative to: its index's, with a trailing '/'. */
export function batchRoot(b: Batch): string {
  const i = b.index.lastIndexOf('/');
  return i < 0 ? '' : b.index.slice(0, i + 1);
}

/** The query and hash that open this batch (and a result in it). */
export function batchHref(b: Batch, id?: string): string {
  return `?batch=${encodeURIComponent(b.id)}${id ? `#${encodeURIComponent(id)}` : ''}`;
}

/** A result's file: gzipped (name.gz) where the result says its files are. */
export const fileName = (name: string, gz?: boolean): string => (gz ? `${name}.gz` : name);
