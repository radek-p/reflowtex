// SPDX-License-Identifier: AGPL-3.0-or-later
// reflowtex inspector – GENERATED from src/inspector/src/panel/bridge.ts by esbuild (make build-inspector); sources sha256 d804145e4ff690a9b9102807085ae3c32fbb48784b008089c6cc59884d83cb00
import { say } from "./store.js";
const AGENT = 7;
const MISSING = /* @__PURE__ */ Symbol("missing");
let asset = (name) => name;
const useAsset = (fn) => {
  asset = fn;
};
const assetUrl = (name) => asset(name);
let page = window;
const pageWindow = () => page;
function setPageWindow(w) {
  page = w;
  loading = null;
  retried = false;
}
let loading = null, retried = false;
function loadAgent() {
  const w = page, a = w.__rtxInspector;
  if (w.__rtxInspectorInstall && (!a || a.agent >= AGENT)) return Promise.resolve();
  if (a && retried) return Promise.resolve();
  const fresh = !!w.__rtxInspectorInstall;
  return loading = loading || new Promise((resolve, reject) => {
    const s = w.document.createElement("script");
    const u = new URL(asset("agent.js"));
    if (fresh) {
      retried = true;
      u.searchParams.set("agent", AGENT + "-" + Date.now());
    }
    s.src = u.href;
    s.onload = () => {
      loading = null;
      resolve();
    };
    s.onerror = () => {
      loading = null;
      reject(new Error("could not load the inspector agent"));
    };
    w.document.head.appendChild(s);
  });
}
async function call(method, ...args) {
  const w = page;
  try {
    await loadAgent();
  } catch (e) {
    if (w.closed) return MISSING;
    throw e;
  }
  if (w !== page || w.closed) return MISSING;
  let a = w.__rtxInspector;
  if ((!a || a.agent < AGENT) && w.__rtxInspectorInstall() === "ok") a = w.__rtxInspector;
  if (a && typeof a[method] !== "function") {
    say(`the page's inspector agent is older than this panel (${a.agent}, needs ${AGENT}): reload the page`, 1e4);
    return MISSING;
  }
  return a ? a[method](...args) : MISSING;
}
const got = (v) => v != null && v !== MISSING;
export {
  AGENT,
  MISSING,
  assetUrl,
  call,
  got,
  pageWindow,
  setPageWindow,
  useAsset
};
