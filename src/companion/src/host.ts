// SPDX-License-Identifier: AGPL-3.0-or-later
// The viewer's host API (src/viewer/src/host/types.ts), once it exists. The
// viewer is a classic script and this a module, so either may run first.
import type { Host } from '../../viewer/src/host/types.ts';

export type * from '../../viewer/src/host/types.ts';

/** Call `fn` with the host: now, if the viewer has run, else when it does. */
export function onHost(fn: (host: Host) => void): void {
    const host = window.reflowtex?.host;
    if (host) { fn(host); return; }
    document.addEventListener('reflowtex:host', e => fn(e.detail.host), { once: true });
}

/** The host, as a promise. */
export const whenHost = (): Promise<Host> => new Promise(onHost);
