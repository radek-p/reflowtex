// SPDX-License-Identifier: AGPL-3.0-or-later
// Reflow TeX inspector – a panel that shows the boxes and glue behind the
// blocks on the page (see README.md).
//
// Include it after latex-viewer.js. It costs nothing until opened: the panel
// (panel/, ES modules), its stylesheet and the page agent (agent.js) load
// from beside this file on first use. Open it with Alt+Shift+I (⌥⇧I on a
// Mac), or from a page's own controls through window.reflowtex.inspector:
//
//   reflowtex.inspector.open(blockEl?, { dock, scroll }?)
//                                        open; with a block, show that block.
//                                        `dock` is where this page would have
//                                        it: 'left', 'right', 'bottom',
//                                        'float', or 'auto' (right, or bottom
//                                        in a portrait window). The reader's
//                                        own choice, once made, wins.
//                                        `scroll: false` leaves the page where
//                                        it is (opening as the page loads).
//   reflowtex.inspector.setDock(mode)    dock to an edge of the window, or float
//   reflowtex.inspector.close()
//   reflowtex.inspector.toggle()
//   reflowtex.inspector.dock(el, block?) put the panel inside el, open for
//                                        good
//   reflowtex.inspector.shortcut         the shortcut's label, for a tooltip
(() => {
const api = window.reflowtex = window.reflowtex || {};
if (api.inspector) return;

const SELF = document.currentScript && document.currentScript.src;
// A file beside this one, with this one's ?v= cache-buster.
function asset(name) {
    const u = new URL(name, SELF || location.href);
    if (SELF) u.search = new URL(SELF).search;
    return u.href;
}
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

let panel = null;
const load = () => (panel = panel || import(asset('panel/app.js')).then(m => m.mount({ asset })));
const loaded = name => async (...args) => (await load())[name](...args);
api.inspector = {
    open: loaded('open'),
    toggle: loaded('toggle'),
    dock: loaded('dock'),
    // (nothing to close, or to place, before it is loaded: the place is only remembered)
    close: async () => { if (panel) (await panel).close(); },
    setDock: async mode => {
        if (panel) return (await panel).setDock(mode);
        if (!['float', 'left', 'bottom', 'right'].includes(mode)) return;
        try { localStorage.setItem('reflowtex-inspector-dock', mode); } catch { /* not remembered */ }
    },
    shortcut: IS_MAC ? '⌥⇧I' : 'Alt+Shift+I',
};
addEventListener('keydown', e => {
    if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyI') {
        e.preventDefault();
        api.inspector.toggle();
    }
}, true);
})();
