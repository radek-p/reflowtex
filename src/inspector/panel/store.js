// SPDX-License-Identifier: AGPL-3.0-or-later
// reflowtex inspector – GENERATED from src/inspector/src/panel/store.js by esbuild (make build-inspector); sources sha256 0cced8ab9ca76e945218ca562d7af8644e4615b09398231c61361ef972204c17
import { signal } from "../vendor/preact.js";
const STORE = "reflowtex-inspector";
const keyOf = (k) => k ? `${STORE}-${k}` : STORE;
function recall(k, fallback, parse = JSON.parse) {
  try {
    const v = localStorage.getItem(keyOf(k));
    return v == null ? fallback : parse(v);
  } catch {
    return fallback;
  }
}
function keep(k, v, str = JSON.stringify) {
  try {
    localStorage.setItem(keyOf(k), str(v));
  } catch {
  }
}
const plain = (v) => v;
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const SHORTCUT = IS_MAC ? "⌥⇧I" : "Alt+Shift+I";
const COPY_KEY = IS_MAC ? "⌘C" : "Ctrl+C";
const isOpen = signal(false);
const view = signal(recall("view", "tree", plain) === "res" ? "res" : "tree");
const dark = signal(false);
const guides = signal({ baselines: false, badness: false, springs: false, a11y: false, ...recall("guides", {}) });
const picking = signal(false);
const blocks = signal(null);
const noViewer = signal(false);
const flash = signal(null);
let flashTimer = 0;
function say(text, ms = 2500) {
  flash.value = text;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    if (flash.value === text) flash.value = null;
  }, ms);
}
const menu = signal(null);
const refs = { root: null, tree: null, rbody: null };
export {
  COPY_KEY,
  IS_MAC,
  SHORTCUT,
  blocks,
  dark,
  flash,
  guides,
  isOpen,
  keep,
  menu,
  noViewer,
  picking,
  plain,
  recall,
  refs,
  say,
  view
};
