// SPDX-License-Identifier: AGPL-3.0-or-later
// reflowtex inspector – GENERATED from src/inspector/src/panel/dock.js by esbuild (make build-inspector); sources sha256 152c7e31fa146b913af49077e450edf32e78e5c3228f524e44f6707e407fd2e6
import { signal, computed, effect } from "../vendor/preact.js";
import { isOpen, recall, keep, plain } from "./store.js";
const SIDES = ["float", "left", "bottom", "right"];
const SIDE_TITLES = { float: "Float over the page", left: "Dock to left", bottom: "Dock to bottom", right: "Dock to right" };
const embedded = signal(false);
const side = signal("float");
const geom = signal(null);
const size = signal(0);
const viewport = () => ({ w: document.documentElement.clientWidth, h: document.documentElement.clientHeight });
let pageDock = "float";
const setPageDock = (where) => {
  pageDock = where;
};
function chosenDock() {
  let m = recall("dock", null, plain);
  if (!SIDES.includes(m)) m = pageDock;
  if (m === "auto") {
    const vp = viewport();
    m = vp.w >= vp.h ? "right" : "bottom";
  }
  return SIDES.includes(m) ? m : "float";
}
function setDock(mode) {
  if (!SIDES.includes(mode)) return;
  keep("dock", mode, plain);
  if (isOpen.value && !embedded.value) applyDock(mode);
}
function applyDock(mode) {
  side.value = mode;
  if (mode === "float") geom.value = floating(recall(null, null));
  else size.value = dockSize(mode);
}
function floating(g) {
  const vw = innerWidth, vh = innerHeight;
  const w = Math.min(g && g.w || 620, vw - 16), h = Math.min(g && g.h || Math.round(vh * 0.45), vh - 84);
  const x = g && g.x != null ? g.x : vw - w - 16, y = g && g.y != null ? g.y : Math.max(8, vh - h - 76);
  return { w, h, x: Math.max(8 - w + 80, Math.min(x, vw - 80)), y: Math.max(8, Math.min(y, vh - 40)) };
}
const saveGeom = () => keep(null, geom.value);
function startMove(e) {
  if (embedded.value || side.value !== "float" || e.button !== 0 || e.target.closest("button")) return;
  const bar = e.currentTarget, g = geom.value, dx = e.clientX - g.x, dy = e.clientY - g.y;
  bar.setPointerCapture(e.pointerId);
  e.preventDefault();
  const move = (ev) => {
    geom.value = floating({ ...geom.value, x: ev.clientX - dx, y: ev.clientY - dy });
  };
  const end = () => {
    bar.removeEventListener("pointermove", move);
    bar.removeEventListener("pointerup", end);
    bar.removeEventListener("pointercancel", end);
    saveGeom();
  };
  bar.addEventListener("pointermove", move);
  bar.addEventListener("pointerup", end);
  bar.addEventListener("pointercancel", end);
}
const FRAME = 3;
const LEAST = { w: 280, h: 180 };
const EDGES = ["n", "e", "s", "w", "ne", "se", "sw", "nw"];
const frameStyle = computed(() => {
  const g = geom.value;
  if (!isOpen.value || embedded.value || side.value !== "float" || !g) return null;
  return `left:${g.x - FRAME}px;top:${g.y - FRAME}px;width:${g.w + 2 * FRAME}px;height:${g.h + 2 * FRAME}px`;
});
function startEdge(e) {
  if (e.button !== 0 || side.value !== "float" || embedded.value) return;
  const handle = e.currentTarget, edge = handle.dataset.edge;
  const g0 = { ...geom.value }, px = e.clientX, py = e.clientY;
  handle.setPointerCapture(e.pointerId);
  e.preventDefault();
  const move = (ev) => {
    const dx = ev.clientX - px, dy = ev.clientY - py;
    let { x, y, w, h } = g0;
    if (edge.includes("e")) w = Math.max(LEAST.w, g0.w + dx);
    if (edge.includes("s")) h = Math.max(LEAST.h, g0.h + dy);
    if (edge.includes("w")) {
      w = Math.max(LEAST.w, g0.w - dx);
      x = g0.x + g0.w - w;
    }
    if (edge.includes("n")) {
      h = Math.max(LEAST.h, g0.h - dy);
      y = g0.y + g0.h - h;
    }
    geom.value = floating({ x, y, w, h });
  };
  const end = () => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", end);
    handle.removeEventListener("pointercancel", end);
    saveGeom();
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}
let saveTimer = 0;
function resized(el) {
  const g = geom.value;
  if (side.value !== "float" || embedded.value || !g || el.hidden) return;
  if (g.w === el.offsetWidth && g.h === el.offsetHeight) return;
  geom.value = { ...g, w: el.offsetWidth, h: el.offsetHeight };
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveGeom, 300);
}
const slot = (s) => s === "bottom" ? "bottom" : "side";
const remembered = (s) => {
  const m = recall("docksize", {});
  return s === "bottom" ? m.bottom : m.side ?? m.right ?? m.left;
};
function dockSize(s, want) {
  const vp = viewport(), across = s === "bottom" ? vp.h : vp.w;
  const n = want ?? remembered(s) ?? (s === "bottom" ? Math.round(vp.h * 0.42) : Math.max(300, Math.min(460, Math.round(vp.w * 0.36))));
  const least = Math.min(s === "bottom" ? 120 : 260, across / 2);
  return Math.round(Math.max(least, Math.min(n, across - (s === "bottom" ? 120 : 240))));
}
function startSize(e) {
  const s = side.value;
  if (s === "float" || e.button !== 0) return;
  const grip = e.currentTarget;
  grip.setPointerCapture(e.pointerId);
  e.preventDefault();
  let want = null, frame = 0;
  const move = (ev) => {
    const vp = viewport();
    want = s === "left" ? ev.clientX : s === "right" ? vp.w - ev.clientX : vp.h - ev.clientY;
    frame = frame || requestAnimationFrame(() => {
      frame = 0;
      size.value = dockSize(s, want);
    });
  };
  const end = () => {
    grip.removeEventListener("pointermove", move);
    grip.removeEventListener("pointerup", end);
    grip.removeEventListener("pointercancel", end);
    keep("docksize", { ...recall("docksize", {}), [slot(s)]: size.value });
  };
  grip.addEventListener("pointermove", move);
  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);
}
const panelStyle = computed(() => {
  if (embedded.value) return "";
  const s = side.value;
  if (s === "float") {
    const g = geom.value;
    return g ? `left:${g.x}px;top:${g.y}px;width:${g.w}px;height:${g.h}px` : "";
  }
  return s === "bottom" ? `left:0;right:0;bottom:0;height:${size.value}px` : `top:0;bottom:0;${s}:0;width:${size.value}px`;
});
const PAD = { left: "paddingLeft", right: "paddingRight", bottom: "paddingBottom" };
let reserved = null;
function reserve(s, n) {
  const de = document.documentElement;
  if (reserved && reserved.side !== s) release();
  if (!reserved) reserved = { side: s, before: de.style[PAD[s]] };
  de.style[PAD[s]] = n + "px";
  de.style.setProperty("--rtx-dock-" + s, n + "px");
}
function release() {
  if (!reserved) return;
  const de = document.documentElement;
  de.style[PAD[reserved.side]] = reserved.before;
  de.style.removeProperty("--rtx-dock-" + reserved.side);
  reserved = null;
}
effect(() => {
  const s = side.value, n = size.value;
  if (isOpen.value && !embedded.value && s !== "float") reserve(s, n);
  else release();
});
addEventListener("resize", () => {
  if (!isOpen.value || embedded.value) return;
  const m = chosenDock();
  if (m !== side.value) applyDock(m);
  else if (m === "float") {
    if (geom.value) geom.value = floating(geom.value);
  } else size.value = dockSize(m, size.value);
});
export {
  EDGES,
  FRAME,
  SIDES,
  SIDE_TITLES,
  applyDock,
  chosenDock,
  embedded,
  frameStyle,
  panelStyle,
  resized,
  setDock,
  setPageDock,
  side,
  startEdge,
  startMove,
  startSize
};
