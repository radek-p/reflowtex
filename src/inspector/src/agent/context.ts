// SPDX-License-Identifier: AGPL-3.0-or-later
// The inspected page as the agent sees it: the viewer's inspection API
// (window.reflowtex.inspect, set when the agent is installed) and its host
// API, and a few helpers every part uses.

import type { Inspect } from '../../../viewer/src/host/inspect.ts';
import type { Host } from '../../../viewer/src/host/types.ts';

/** The viewer's inspection API as the agent reads it: an older viewer may
 *  lack the later calls. */
export type ViewerInspect = Omit<Inspect, 'surfaces' | 'kinds' | 'scopes' | 'faces'> & Partial<Pick<Inspect, 'surfaces' | 'kinds' | 'scopes' | 'faces'>>;

/** The viewer's inspection API (set by install, index.ts). */
export let I: ViewerInspect = null!;
export function setInspect(api: ViewerInspect): void { I = api; }
export const SP = (): number => I.spToPx;
export const RUNNING = -1073741824;
export const shown = (el: Element | null | undefined): boolean => !!(el && el.isConnected && el.getClientRects().length);
/** A box (viewport px) within a screen of the viewport. */
export const near = (r: { top: number; height: number }): boolean => r.top < 2 * innerHeight && r.top + r.height > -innerHeight;
export const host = (): Host | undefined => window.reflowtex && window.reflowtex.host;
