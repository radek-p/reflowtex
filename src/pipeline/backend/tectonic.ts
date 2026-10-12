// SPDX-License-Identifier: AGPL-3.0-or-later
// The Tectonic backend's place: registered, so it can be listed and
// selected, but not in this build. Its descriptor claims nothing, because
// nothing works yet; selecting it fails with a message saying so.
// docs/backends.md, "Adding a backend", is how a real one replaces this.
import { BackendUnavailable } from '../errors.ts';
import type { Capabilities } from './capabilities.ts';
import type { Availability, BackendRuntime, CaptureBackend, CaptureDocument, CaptureJob } from './types.ts';

export const TECTONIC_UNAVAILABLE =
  'the Tectonic backend is not available in this build: only its place is registered (docs/backends.md says how a backend plugs in); the default backend, luatex, is';

export class TectonicPlaceholder implements CaptureBackend {
  readonly id = 'tectonic';
  readonly name = 'Tectonic (XeTeX engine; not available in this build)';
  readonly runtime: BackendRuntime = { kind: 'none', concurrent: false };
  readonly capabilities: Capabilities = {};

  availability(): Availability { return { ok: false, reason: TECTONIC_UNAVAILABLE }; }

  open(doc: CaptureDocument): Promise<CaptureJob> {
    return Promise.reject(new BackendUnavailable(TECTONIC_UNAVAILABLE, doc.label));
  }
}
