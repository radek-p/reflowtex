// SPDX-License-Identifier: AGPL-3.0-or-later
// The inspected page as the agent sees it: the viewer's inspection API
// (window.reflowtex.inspect, set when the agent is installed) and its host
// API, and a few helpers every part uses.

/** The viewer's inspection API (set by install, index.js). */
export let I = null;
export function setInspect(api) { I = api; }
export const SP = () => I.spToPx;
export const RUNNING = -1073741824;
export const shown = el => !!(el && el.isConnected && el.getClientRects().length);
export const near = r => r.top < 2 * innerHeight && r.top + r.height > -innerHeight;
export const host = () => window.reflowtex && window.reflowtex.host;
