// SPDX-License-Identifier: AGPL-3.0-or-later
// The backends this build knows, by id; choosing one; listing them with
// what each can do.
//
//     listBackends()                       → [{ id, name, available, capabilities, … }]
//     createBackend('luatex', { template })
//     selectedBackendId({ flag, env })     → the --backend flag, else REFLOWTEX_BACKEND, else 'luatex'
//
// A host may register its own: registerBackend('mine', o => new Mine(o)).
import { UnknownBackend } from '../errors.ts';
import { fullCapabilities, type CapabilityName } from './capabilities.ts';
import { LuaTeXBackend } from './luatex.ts';
import { TectonicPlaceholder } from './tectonic.ts';
import type { BackendOptions, BackendRuntime, CaptureBackend } from './types.ts';

export const DEFAULT_BACKEND = 'luatex';

export type BackendFactory = (o: BackendOptions) => CaptureBackend;

const factories = new Map<string, BackendFactory>([
  ['luatex', o => new LuaTeXBackend(o)],
  ['tectonic', () => new TectonicPlaceholder()],
]);

/** Make `id` selectable (replacing a backend of that id). */
export function registerBackend(id: string, factory: BackendFactory): void {
  factories.set(id, factory);
}

/** Forget `id` (a host's own backend, once it is done with it). */
export function unregisterBackend(id: string): void {
  factories.delete(id);
}

export const backendIds = (): string[] => [...factories.keys()];

/** The backend `id`, configured with `o`. Throws UnknownBackend, naming the
 *  ids there are, for one this build does not know. Whether it is usable is
 *  its availability(). */
export function createBackend(id: string, o: BackendOptions = {}): CaptureBackend {
  const f = factories.get(id);
  if (!f) throw new UnknownBackend(`unknown backend "${id}"; this build has: ${backendIds().join(', ')}`);
  const b = f(o);
  if (b.id !== id) throw new UnknownBackend(`backend registered as "${id}" calls itself "${b.id}"`);
  return b;
}

/** What a host shows of a backend. `capabilities` has every capability,
 *  false where the backend does not claim it. */
export interface BackendInfo {
  id: string;
  name: string;
  default: boolean;
  available: boolean;
  /** why not, when it is not available */
  reason?: string;
  runtime: BackendRuntime;
  capabilities: Record<CapabilityName, boolean>;
}

export function describeBackend(b: CaptureBackend): BackendInfo {
  const a = b.availability();
  return {
    id: b.id, name: b.name, default: b.id === DEFAULT_BACKEND, available: a.ok, ...(a.ok ? {} : { reason: a.reason }),
    runtime: b.runtime, capabilities: fullCapabilities(b.capabilities),
  };
}

/** Every backend this build knows, the default first. */
export function listBackends(): BackendInfo[] {
  return backendIds().map(id => describeBackend(createBackend(id)))
    .sort((a, b) => Number(b.default) - Number(a.default));
}

/** The backend a caller chose: an explicit choice (a CLI flag, an API
 *  option), else REFLOWTEX_BACKEND, else the default. */
export function selectedBackendId(o: { flag?: string | null; env?: NodeJS.ProcessEnv } = {}): string {
  const env = o.env ?? process.env;
  return o.flag || env.REFLOWTEX_BACKEND || DEFAULT_BACKEND;
}

/** A plain-text table of the backends and their capabilities, for a CLI's
 *  --list-backends. */
export function formatBackends(list: BackendInfo[] = listBackends()): string {
  const lines: string[] = [];
  for (const b of list) {
    lines.push(`${b.id}${b.default ? ' (default)' : ''}: ${b.name}`);
    lines.push(`  ${b.available ? 'available' : `not available: ${b.reason}`}`);
    lines.push(`  runs as: ${b.runtime.kind}${b.runtime.concurrent ? ', several documents at once' : ''}`);
    const has = Object.entries(b.capabilities).filter(([, v]) => v).map(([k]) => k);
    lines.push(`  capabilities: ${has.length ? has.join(', ') : 'none'}`);
  }
  return lines.join('\n');
}
