// SPDX-License-Identifier: AGPL-3.0-or-later

// document.currentScript is only valid during this script's own synchronous
// top-level execution – it reads as null from inside any callback (DOMContent-
// Loaded handlers, event listeners, …), so anything that needs it later must
// capture it now.
export const SCRIPT_URL = document.currentScript?.src;

// Version marker for cache diagnosis: logs the ?v= content hash the page
// requested (when debugging – see debugLog), and stamps <html
// data-latex-viewer> once the viewer initialises.
export const BUILD = (SCRIPT_URL?.match(/v=([a-f0-9]+)/) || [])[1] || 'unversioned';

// The page-facing object: window.reflowtex. What pages use is its host
// (reflowtex.host, host/host.ts); the rest are a few switches (debug,
// fontWarning) and tools (inspect).
export const api = window.reflowtex = window.reflowtex || {};
// Timing lines (load, every re-render) are opt-in: set window.reflowtex.debug
// = true (read on each line, so it can be flipped in the console), or add
// ?reflowtex-debug to the page URL.
if (/[?&]reflowtex-debug\b/.test(location.search)) api.debug = true;
export const debugLog = (...a) => { if (api.debug) console.debug(...a); };
debugLog(`[latex-viewer] build ${BUILD}`);
