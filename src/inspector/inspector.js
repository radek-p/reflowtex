// SPDX-License-Identifier: AGPL-3.0-or-later
// reflowtex inspector – GENERATED from src/inspector/src/inspector.js by esbuild (make build-inspector); sources sha256 0cced8ab9ca76e945218ca562d7af8644e4615b09398231c61361ef972204c17
"use strict";
(() => {
  // src/inspector.js
  (() => {
    const api = window.reflowtex = window.reflowtex || {};
    if (api.inspector) return;
    const SELF = document.currentScript && document.currentScript.src;
    function asset(name) {
      const u = new URL(name, SELF || location.href);
      if (SELF) u.search = new URL(SELF).search;
      return u.href;
    }
    const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    let panel = null;
    const load = () => panel = panel || import(asset("panel/app.js")).then((m) => m.mount({ asset }));
    const loaded = (name) => async (...args) => (await load())[name](...args);
    api.inspector = {
      open: loaded("open"),
      toggle: loaded("toggle"),
      dock: loaded("dock"),
      inspect: loaded("inspect"),
      isOpen: async () => panel ? (await panel).isOpen() : false,
      // (nothing to close, or to place, before it is loaded: the place is only remembered)
      close: async () => {
        if (panel) (await panel).close();
      },
      setDock: async (mode) => {
        if (panel) return (await panel).setDock(mode);
        if (!["float", "left", "bottom", "right"].includes(mode)) return;
        try {
          localStorage.setItem("reflowtex-inspector-dock", mode);
        } catch {
        }
      },
      shortcut: IS_MAC ? "⌥⇧I" : "Alt+Shift+I"
    };
    addEventListener("keydown", (e) => {
      if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === "KeyI") {
        e.preventDefault();
        api.inspector.toggle();
      }
    }, true);
  })();
})();
