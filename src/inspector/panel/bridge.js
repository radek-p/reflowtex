// SPDX-License-Identifier: AGPL-3.0-or-later
// The page agent (agent.js): loaded into the page on first use and called
// through window.__rtxInspector. Every call answers MISSING when there is no
// agent to ask – no inspectable viewer, or an agent too old for this panel.
//
// The page is the panel's own window, or another one the host names
// (inspect(win) – a same-origin iframe: the render report inspects the page
// it shows, and keeps one panel as it moves from page to page).
import { say } from './store.js';

// The agent this panel needs (agent.js's AGENT) or a newer one. An older one
// already in the page – installed by another copy of the panel, or served
// from a stale cache – is replaced: agent.js is loaded again, with a query of
// its own so no cache can hand back the old file.
export const AGENT = 6;
export const MISSING = Symbol('missing');

let asset = name => name;                     // (set by the loader: a file beside it)
export const useAsset = fn => { asset = fn; };
export const assetUrl = name => asset(name);

let page = window;
/** The window whose blocks are inspected. */
export const pageWindow = () => page;
// (again for the same window: an iframe keeps its window as it navigates, and
// the new document has no agent yet)
export function setPageWindow(w) {
    page = w;
    loading = null; retried = false;
}

let loading = null, retried = false;
function loadAgent() {
    const w = page, a = w.__rtxInspector;
    if (w.__rtxInspectorInstall && (!a || a.agent >= AGENT)) return Promise.resolve();
    if (a && retried) return Promise.resolve();                // tried once: make do
    const fresh = !!w.__rtxInspectorInstall;
    return loading = loading || new Promise((resolve, reject) => {
        const s = w.document.createElement('script');
        const u = new URL(asset('agent.js'));
        if (fresh) { retried = true; u.searchParams.set('agent', AGENT + '-' + Date.now()); }
        s.src = u.href;
        s.onload = () => { loading = null; resolve(); };
        s.onerror = () => { loading = null; reject(new Error('could not load the inspector agent')); };
        w.document.head.appendChild(s);
    });
}

export async function call(method, ...args) {
    const w = page;
    try { await loadAgent(); } catch (e) { if (w.closed) return MISSING; throw e; }
    // (the page went – an iframe navigated – while the agent loaded)
    if (w !== page || w.closed) return MISSING;
    let a = w.__rtxInspector;
    if ((!a || a.agent < AGENT) && w.__rtxInspectorInstall() === 'ok') a = w.__rtxInspector;
    if (a && typeof a[method] !== 'function') {
        say(`the page's inspector agent is older than this panel (${a.agent}, needs ${AGENT}): reload the page`, 10000);
        return MISSING;
    }
    return a ? a[method](...args) : MISSING;
}
// An answer that is really there.
export const got = v => v != null && v !== MISSING;
