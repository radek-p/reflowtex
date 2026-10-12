// SPDX-License-Identifier: AGPL-3.0-or-later
// reflowtex inspector – GENERATED from src/inspector/src/panel/app.js by esbuild (make build-inspector); sources sha256 b30f95facc87229bc842a9308d355dd27aedb7d8d243cf0bee13c268415c7181
import { html, render, useLayoutEffect, useRef, useState, Fragment } from "../vendor/preact.js";
import { call, got, useAsset, assetUrl, pageWindow, setPageWindow } from "./bridge.js";
import { isOpen, view, dark, guides, picking, blocks, noViewer, flash, menu, refs, keep, plain, say, SHORTCUT } from "./store.js";
import { IconButton, IconPick, IconClose, IconCheck, IconDock, Caret, MenuBox, toggleMenu, closeMenu, menuOpen } from "./ui.js";
import { SIDES, SIDE_TITLES, side, embedded, panelStyle, setDock, applyDock, chosenDock, setPageDock, startMove, startSize, resized, EDGES, frameStyle, startEdge } from "./dock.js";
import { Tree, Details, RowMenu, selected, refresh, reveal, forgetSelection } from "./tree.js";
import { ResourceList, ResourceDetails, loadResources, markUses, resSel, forgetResources } from "./resources.js";
import { ColourView, loadColours } from "./colours.js";
const TABS = [
  ["tree", "Boxes", "Blocks, lines, boxes and glue"],
  ["res", "Resources", "Fonts and their glyphs, pictures, instances, kinds, marks, streams (footnotes, popovers), links, citations, anchors, slots"],
  ["col", "Colours", "The page's colour maps: each TeX colour as each theme shows it, and as shown now"]
];
const OVERLAYS = [
  ["baselines", "Baselines", "The baseline of every line"],
  ["badness", "Badness", "A bar past every line, coloured by its badness: green decent, amber loose or tight, red 100 or more, purple overfull"],
  ["springs", "Springs", "Every display glue whose width is recomputed for the reader's width, drawn as a spring"],
  ["a11y", "Accessibility layer", "Where the hidden text a screen reader reads lies: each piece dashed, its runs of text orange, its formulas green"]
];
const LEGEND = [["box, glyph", "box"], ["glue", "glue"], ["kern", "kern"], ["math", "math"], ["penalty", "penalty"], ["line", "line-c"]];
function setView(v) {
  if (view.value === v) return null;
  view.value = v;
  keep("view", v, plain);
  const focus = (el) => requestAnimationFrame(() => el && el.focus({ preventScroll: true }));
  if (v === "res") {
    call("select", null);
    focus(refs.rbody);
    return loadResources();
  }
  if (v === "col") {
    call("select", null);
    return loadColours();
  }
  call("mark", null);
  if (selected.value != null) call("select", selected.value, { scroll: false });
  focus(refs.tree);
  return null;
}
function setGuide(key, on) {
  guides.value = { ...guides.value, [key]: on };
  keep("guides", guides.value);
  applyGuides();
}
const applyGuides = () => call("setOptions", { ...guides.value });
let showSel = null;
function setShowSel(on) {
  if (on === showSel) return;
  showSel = on;
  call("setOptions", { selection: on });
}
const NAV_KEYS = /^(Arrow(Up|Down|Left|Right)|Home|End|PageUp|PageDown)$/;
function Toolbar() {
  const g = guides.value, now = side.value;
  return html`<div class="bar" onPointerDown=${startMove}>
        <span class="tools">
            <${IconButton} class=${"pick" + (picking.value ? " on" : "")} title="Pick a box or glue in the page (Esc cancels)" onClick=${togglePick}>
                <${IconPick}/><//>
            <button type="button" class=${"ib text overlays" + (OVERLAYS.some(([k]) => g[k]) ? " on" : "")}
                    title="Page overlays: baselines, badness, springs, the accessibility layer" aria-haspopup="menu" aria-expanded=${String(menuOpen("overlays"))}
                    onClick=${(e) => toggleMenu("overlays", e.currentTarget)}><span>Overlays</span><${Caret}/></button>
            <span class="sep"></span>
            <span class="tabs" role="tablist">
                ${TABS.map(([v, label, title]) => html`<button type="button" role="tab" key=${v} data-view=${v} title=${title}
                    aria-selected=${String(view.value === v)} onClick=${() => setView(v)}><span>${label}</span></button>`)}
            </span>
        </span>
        <span class="fill"></span>
        <span class="corner">
            <span class="docks" role="group" aria-label="Dock side"><span class="sep"></span>
                ${SIDES.map((m) => html`<${IconButton} key=${m} data-dock=${m} title=${SIDE_TITLES[m]} aria-pressed=${String(now === m)}
                    onClick=${() => setDock(m)}><${IconDock} side=${m}/><//>`)}
            </span>
            <${IconButton} class="more" title="Dock side" aria-haspopup="menu" aria-expanded=${String(menuOpen("dock"))}
                onClick=${(e) => toggleMenu("dock", e.currentTarget)}><${IconDock} side=${now}/><${Caret}/><//>
            <${IconButton} class="close" title=${`Close (${SHORTCUT})`} onClick=${close}><${IconClose}/><//>
        </span>
    </div>`;
}
function OverlaysMenu() {
  const g = guides.value;
  const [, redraw] = useState(0);
  const rt = pageWindow() && pageWindow().reflowtex;
  const debug = rt && rt.setAccessibleDebug && pageWindow().document.querySelector(".latex-a11y") ? !!rt.accessibleDebug() : null;
  return html`<${MenuBox} label="Page overlays">
        ${OVERLAYS.map(([key, label, title]) => html`<button type="button" role="menuitemcheckbox" key=${key} data-overlay=${key}
                title=${title} aria-checked=${String(!!g[key])} onClick=${() => setGuide(key, !g[key])}>
            <span class="check"><${IconCheck}/></span><span class="label">${label}</span></button>`)}
        ${debug !== null && html`<button type="button" role="menuitemcheckbox" data-overlay="a11y-text"
                title="The text a screen reader reads, shown where it lies: each element tinted, to see its bounds (debugging)"
                aria-checked=${String(debug)} onClick=${() => {
    rt.setAccessibleDebug(!debug);
    redraw((n) => n + 1);
  }}>
            <span class="check"><${IconCheck}/></span><span class="label">Reader text, shown</span></button>`}
    <//>`;
}
function DockMenu() {
  const now = side.value;
  return html`<${MenuBox} label="Dock side">
        <div class="mrow"><span class="label">Dock side</span>
            <span class="docks" role="group" aria-label="Dock side">
                ${SIDES.map((m) => html`<${IconButton} key=${m} data-dock=${m} title=${SIDE_TITLES[m]} aria-pressed=${String(now === m)}
                    onClick=${() => {
    closeMenu();
    setDock(m);
  }}><${IconDock} side=${m}/><//>`)}
            </span>
        </div>
    <//>`;
}
function Menus() {
  const m = menu.value;
  if (!m) return null;
  if (m.kind === "overlays") return html`<${OverlaysMenu}/>`;
  if (m.kind === "dock") return html`<${DockMenu}/>`;
  if (m.kind === "row") return html`<${RowMenu} id=${m.id}/>`;
  return null;
}
function Foot() {
  const n = blocks.value;
  const status = picking.value ? "click in the page · Esc cancels" : flash.value || (noViewer.value ? "no inspectable viewer" : n == null ? "" : `${n} block${n === 1 ? "" : "s"}`);
  return html`<div class="foot">
        <div class="legend">${LEGEND.map(([name, c]) => html`<span class="key" key=${name}>
            <span class="sw" style=${`border-color:var(--${c});background:var(--${c})`}></span>${name}</span>`)}</div>
        <span class="status">${status}</span>
    </div>`;
}
function Panel() {
  const el = useRef(null), s = side.value, emb = embedded.value;
  useLayoutEffect(() => {
    refs.root = el.current;
    const ro = new ResizeObserver(() => resized(el.current));
    ro.observe(el.current);
    return () => ro.disconnect();
  }, []);
  const onPointerDownCapture = (e) => {
    if (menu.value && !e.target.closest(".menu")) closeMenu();
  };
  const onKeyDownCapture = (e) => {
    if (NAV_KEYS.test(e.key) && e.composedPath().some((x) => x === refs.tree || x === refs.rbody)) setShowSel(true);
  };
  const frame = frameStyle.value;
  return html`<${Fragment}><div ref=${el} role="dialog" aria-label="Reflow TeX inspector" hidden=${!isOpen.value}
            class=${"rtx" + (dark.value ? " dark" : "") + (emb ? " docked" : "")}
            data-view=${view.value} data-edge=${emb || s === "float" ? void 0 : s} style=${panelStyle}
            onPointerMove=${() => setShowSel(false)} onPointerDownCapture=${onPointerDownCapture} onKeyDownCapture=${onKeyDownCapture}>
        <${Toolbar}/>
        <div class="main"><${Tree}/><${Details}/><${ResourceList}/><${ResourceDetails}/><${ColourView}/></div>
        <${Foot}/>
        <div class="grip" aria-hidden="true" onPointerDown=${startSize}></div>
        <${Menus}/>
    </div>
    ${frame && html`<div class="frame" aria-hidden="true" style=${frame}>
        ${EDGES.map((d) => html`<div key=${d} data-edge=${d} onPointerDown=${startEdge}></div>`)}</div>`}<//>`;
}
function syncTheme() {
  const bg = (c) => {
    const m2 = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(c);
    return m2 && (m2[4] === void 0 || +m2[4] > 0) ? m2 : null;
  };
  const m = bg(getComputedStyle(document.body).backgroundColor) || bg(getComputedStyle(document.documentElement).backgroundColor);
  dark.value = m ? 0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3] < 110 : matchMedia("(prefers-color-scheme: dark)").matches;
}
let mirrored = -1;
function mirrorFonts() {
  const w = pageWindow();
  if (w === window) return;
  let css = "", n = 0;
  try {
    for (const sheet of w.document.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      const base = sheet.href || w.document.baseURI;
      for (const r of rules) {
        if (r.type !== CSSRule.FONT_FACE_RULE) continue;
        n++;
        css += r.cssText.replace(/url\((['"]?)([^'")]+)\1\)/g, (_, q, u) => `url("${new URL(u, base).href}")`) + "\n";
      }
    }
  } catch {
    return;
  }
  if (n === mirrored) return;
  mirrored = n;
  let style = document.getElementById("rtx-page-fonts");
  if (!style) {
    style = document.createElement("style");
    style.id = "rtx-page-fonts";
    document.head.appendChild(style);
  }
  style.textContent = css;
}
async function inspect(w) {
  if (isOpen.value) {
    call("cancelPick");
    call("clear");
  }
  setPageWindow(w);
  mirrored = -1;
  forgetSelection();
  forgetResources();
  blocks.value = null;
  lastPaints = null;
  if (!isOpen.value) return;
  mirrorFonts();
  try {
    await refresh();
  } catch (e) {
    say(String(e.message || e), 1e4);
    return;
  }
  if (view.value === "res") loadResources();
  if (view.value === "col") loadColours();
  applyGuides();
  poll();
}
async function togglePick() {
  const st = await call("status");
  if (!got(st)) return;
  await call(st.picking ? "cancelPick" : "pick");
  poll();
}
let pollTimer = 0, lastPickSeq = 0;
async function poll() {
  if (!isOpen.value) return;
  syncTheme();
  mirrorFonts();
  const st = await call("status");
  noViewer.value = !got(st);
  if (!got(st)) {
    picking.value = false;
    return;
  }
  picking.value = st.picking;
  if (blocks.value !== null && st.blocks !== blocks.value) {
    followReflow();
    if (view.value === "res") loadResources();
  }
  blocks.value = st.blocks;
  if (st.picked && st.picked.seq !== lastPickSeq) {
    lastPickSeq = st.picked.seq;
    setView("tree");
    reveal(st.picked.path);
  }
}
let lastPaints = null, refreshing = false, again = false;
function watchPaints() {
  if (!isOpen.value) return;
  const w = pageWindow(), p = w.reflowtex && w.reflowtex.inspect && w.reflowtex.inspect.paints;
  if (p !== void 0 && p !== lastPaints) {
    const first = lastPaints === null;
    lastPaints = p;
    if (!first) followReflow();
  }
  requestAnimationFrame(watchPaints);
}
async function followReflow() {
  if (refreshing) {
    again = true;
    return;
  }
  refreshing = true;
  try {
    do {
      again = false;
      await refresh();
      if (view.value === "res" && resSel.value) await markUses();
      await call("redraw");
    } while (again);
  } finally {
    refreshing = false;
  }
}
let host = null;
async function open(block, { dock: where, scroll = true } = {}) {
  if (where) setPageDock(where);
  if (!isOpen.value) {
    if (!embedded.value && host !== document.documentElement.lastElementChild) document.documentElement.appendChild(host);
    if (!embedded.value) applyDock(chosenDock());
    isOpen.value = true;
    syncTheme();
    pollTimer = setInterval(poll, 400);
    showSel = null;
    setShowSel(false);
    blocks.value = null;
    try {
      await refresh();
    } catch (e) {
      say(String(e.message || e), 1e4);
      return;
    }
    if (view.value === "res") loadResources();
    applyGuides();
    lastPaints = null;
    requestAnimationFrame(watchPaints);
    poll();
  }
  if (block) {
    setView("tree");
    let path = null;
    for (let k = 0; k < 40 && !(path = await call("blockPath", block)); k++) await new Promise((r) => setTimeout(r, 150));
    if (got(path)) await reveal(path, { openLast: true, page: scroll });
  }
  if (!embedded.value) requestAnimationFrame(() => refs.tree && refs.tree.focus({ preventScroll: true }));
}
function close() {
  if (!isOpen.value || embedded.value) return;
  isOpen.value = false;
  clearInterval(pollTimer);
  closeMenu();
  call("cancelPick");
  call("clear");
  call("setOptions", { baselines: false, badness: false, springs: false });
  forgetSelection();
  forgetResources();
}
const toggle = () => embedded.value ? refs.tree && refs.tree.focus() : isOpen.value ? close() : open();
async function embed(container, block) {
  embedded.value = true;
  host.style.cssText = "display:block;position:relative;z-index:2147483647;width:100%;height:100%";
  container.appendChild(host);
  await open(block);
}
function mount({ asset }) {
  useAsset(asset);
  host = document.createElement("div");
  host.setAttribute("data-rtx-ui", "");
  host.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647";
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("link");
  style.rel = "stylesheet";
  style.href = assetUrl("inspector.css");
  const into = document.createElement("div");
  into.style.display = "contents";
  shadow.append(style, into);
  document.documentElement.appendChild(host);
  host.addEventListener("click", (e) => e.stopPropagation());
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && isOpen.value && document.activeElement === host && !picking.value && !menu.value && !(e.composedPath()[0] instanceof HTMLInputElement)) close();
  }, true);
  render(html`<${Panel}/>`, into);
  return { open, close, toggle, setDock, dock: embed, inspect, isOpen: () => isOpen.value };
}
export {
  mount,
  setView
};
