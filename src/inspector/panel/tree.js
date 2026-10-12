// SPDX-License-Identifier: AGPL-3.0-or-later
// reflowtex inspector – GENERATED from src/inspector/src/panel/tree.js by esbuild (make build-inspector); sources sha256 152c7e31fa146b913af49077e450edf32e78e5c3228f524e44f6707e407fd2e6
import { html, signal, computed, useLayoutEffect, useRef, useEffect, useState } from "../vendor/preact.js";
import { call, got, MISSING } from "./bridge.js";
import { refs, menu, COPY_KEY, recall, keep, plain } from "./store.js";
import { Table, Action, Head, Muted, MenuBox, IconPick, closeMenu, copyText } from "./ui.js";
import { showGlyph } from "./resources.js";
const nodes = /* @__PURE__ */ new Map();
let roots = [];
const version = signal(0);
const bump = () => {
  version.value++;
};
const empty = signal(null);
const selected = signal(null);
const details = signal(null);
let scrollTo = null;
const remember = (list) => list.map((s) => {
  const n = nodes.get(s.id);
  if (n) n.s = s;
  else nodes.set(s.id, { s, kids: null, open: false });
  return s.id;
});
async function loadKids(id) {
  nodes.get(id).kids = remember(await call("children", id) || []);
}
async function refresh() {
  const list = await call("blocks");
  if (list === MISSING) {
    roots = [];
    nodes.clear();
    empty.value = "viewer";
    bump();
    return;
  }
  empty.value = list.length ? null : "none";
  roots = remember(list);
  const walk = async (ids) => {
    for (const id of ids) {
      const n = nodes.get(id);
      if (n && n.open && n.s.hasChildren) {
        await loadKids(id);
        await walk(n.kids);
      } else if (n) n.kids = null;
    }
  };
  await walk(roots);
  bump();
  if (selected.value != null) loadDetails(selected.value);
}
async function toggle(id, open) {
  const n = nodes.get(id);
  if (!n || !n.s.hasChildren) return;
  open = open ?? !n.open;
  if (open && !n.kids) await loadKids(id);
  n.open = open;
  bump();
}
async function select(id, { scroll = true, page = true } = {}) {
  selected.value = id;
  if (scroll) scrollTo = id;
  await call("select", id, { scroll: page });
  loadDetails(id);
}
async function reveal(path, { openLast = false, page = true } = {}) {
  if (!path || !path.length) return;
  if (!roots.includes(path[0])) await refresh();
  for (const id of openLast ? path : path.slice(0, -1)) {
    const n = nodes.get(id);
    if (!n) return;
    if (n.s.hasChildren) {
      if (!n.kids) await loadKids(id);
      n.open = true;
    }
  }
  bump();
  await select(path[path.length - 1], { page });
}
async function loadDetails(id) {
  const d = await call("details", id);
  if (selected.value === id) details.value = { id, d: got(d) ? d : null };
}
function forgetSelection() {
  selected.value = null;
  details.value = null;
}
async function copyXml(id) {
  if (id == null) return;
  const text = await call("xml", id);
  if (typeof text === "string") copyText(text, "XML");
}
const rows = computed(() => {
  version.value;
  const out = [];
  const plainGlyph = (id) => {
    const n = nodes.get(id);
    return n && n.s.type === "glyph" && !n.s.hasChildren;
  };
  const hyphen = (id) => {
    const n = nodes.get(id);
    return n && n.s.point === true;
  };
  const emit = (id, depth) => {
    const n = nodes.get(id);
    if (!n) return;
    out.push({ key: id, id, n, depth });
    if (n.open && n.kids) emitKids(n.kids, depth + 1);
  };
  const emitKids = (kids, depth) => {
    for (let i = 0; i < kids.length; ) {
      let j = i, letters = 0;
      while (j < kids.length && (plainGlyph(kids[j]) || hyphen(kids[j]))) {
        if (plainGlyph(kids[j])) letters++;
        j++;
      }
      if (j - i >= 2 && letters >= 1) {
        out.push({ key: "run" + kids[i], ids: kids.slice(i, j), depth });
        i = j;
      } else emit(kids[i++], depth);
    }
  };
  for (const r of roots) emit(r, 0);
  return out;
});
const order = computed(() => rows.value.flatMap((item, row) => item.ids ? item.ids.map((id, k) => ({ id, row, k, run: item.ids })) : [{ id: item.id, row }]));
const firstOf = (item) => item.ids ? item.ids[0] : item.id;
const indent = (depth) => `padding-left:${4 + depth * 14}px`;
function Row({ item, sel }) {
  const { id, n, depth } = item, s = n.s;
  return html`<div class=${`row t-${s.type}${id === sel ? " sel" : ""}${s.drawn === false ? " undrawn" : ""}`}
            role="treeitem" data-id=${id} aria-expanded=${s.hasChildren ? String(!!n.open) : void 0} style=${indent(depth)}>
        <span class="twisty">${s.hasChildren ? n.open ? "▾" : "▸" : ""}</span>
        <span class="label">${s.label}</span>
        ${s.affine && html`<span class="affine" title=${`Width-dependent: ${s.affine.join(", ")} recomputed for the reader's width – see the details`}>↔</span>`}
        <span class="note">${s.note}</span>
    </div>`;
}
function Run({ item, sel }) {
  const fonts = /* @__PURE__ */ new Set();
  let letters = 0;
  const chips = item.ids.map((id) => {
    const s = nodes.get(id).s, hyphen = s.point === true, m = /^font (\S+)/.exec(s.note);
    if (m) fonts.add(m[1]);
    if (!hyphen) letters++;
    return html`<span key=${id} class=${"chip" + (hyphen ? " disc" : "") + (id === sel ? " sel" : "") + (s.drawn === false ? " undrawn" : "")}
                role="treeitem" data-id=${id} title=${`${s.label}  ${s.note}`}>${hyphen ? "-" : s.label.replace(/^‘(.*)’$/su, "$1")}</span>`;
  });
  const hyphens = item.ids.length - letters;
  return html`<div class="row run t-glyph" role="group" style=${indent(item.depth)}>
        <span class="twisty"></span><span class="chips">${chips}</span>
        <span class="note">${`${letters} glyph${letters === 1 ? "" : "s"}` + (hyphens ? ` · ${hyphens} hyphenation point${hyphens === 1 ? "" : "s"}` : "") + (fonts.size ? ` · font ${[...fonts].join(", ")}` : "")}</span>
    </div>`;
}
let hoverKey = null;
function Tree() {
  const el = useRef(null), sel = selected.value;
  useLayoutEffect(() => {
    refs.tree = el.current;
  }, []);
  useLayoutEffect(() => {
    if (scrollTo == null) return;
    const row = el.current.querySelector(`[data-id="${scrollTo}"]`);
    scrollTo = null;
    if (row) row.scrollIntoView({ block: "nearest" });
  });
  const rowEl = (id) => el.current.querySelector(`[data-id="${id}"]`);
  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    const r = e.target.closest("[data-id]");
    if (!r) return;
    const id = +r.dataset.id;
    if (e.target.classList.contains("twisty") || e.detail === 2) toggle(id);
    else select(id, { scroll: false });
  };
  const onMouseMove = (e) => {
    const one = e.target.closest("[data-id]"), run = !one && e.target.closest(".row.run");
    const id = one ? +one.dataset.id : run ? [...run.querySelectorAll("[data-id]")].map((c) => +c.dataset.id) : null;
    const key = JSON.stringify(id);
    if (key !== hoverKey) {
      hoverKey = key;
      call("hover", id);
    }
  };
  const onMouseLeave = () => {
    hoverKey = null;
    call("hover", null);
  };
  const onContextMenu = (e) => {
    const r = e.target.closest("[data-id]");
    if (!r) return;
    e.preventDefault();
    const id = +r.dataset.id;
    select(id, { scroll: false });
    menu.value = { kind: "row", id, x: e.clientX, y: e.clientY };
  };
  const onKeyDown = (e) => {
    const id = selected.value;
    if ((e.metaKey || e.ctrlKey) && e.key === "c" && id != null) {
      e.preventDefault();
      copyXml(id);
      return;
    }
    if ((e.key === "ContextMenu" || e.shiftKey && e.key === "F10") && id != null) {
      e.preventDefault();
      const r = rowEl(id), b = r && r.getBoundingClientRect();
      if (b) menu.value = { kind: "row", id, x: b.left + 24, y: b.bottom };
      return;
    }
    const list = order.value, items = rows.value, me = list.find((o) => o.id === id);
    if (e.key === "ArrowDown") {
      const next = list.find((o) => !me || o.row > me.row);
      if (next) select(next.id);
    } else if (e.key === "ArrowUp") {
      if (me && me.row > 0) select(firstOf(items[me.row - 1]));
    } else if (e.key === "ArrowRight" && me) {
      if (me.run) {
        if (me.k < me.run.length - 1) select(me.run[me.k + 1]);
      } else toggle(id, true);
    } else if (e.key === "ArrowLeft" && me) {
      const n = nodes.get(id);
      if (me.run && me.k > 0) select(me.run[me.k - 1]);
      else if (!me.run && n && n.open) toggle(id, false);
      else {
        const depth = items[me.row].depth;
        for (let r = me.row - 1; r >= 0; r--) if (items[r].depth < depth) {
          select(firstOf(items[r]));
          break;
        }
      }
    } else return;
    e.preventDefault();
  };
  const why = empty.value;
  return html`<section class="tree" role="tree" tabindex="0" aria-label="Boxes and glue" ref=${el}
            onMouseDown=${onMouseDown} onMouseMove=${onMouseMove} onMouseLeave=${onMouseLeave}
            onContextMenu=${onContextMenu} onKeyDown=${onKeyDown} onScroll=${closeMenu}>
        ${why === "viewer" ? html`<div class="empty">No inspectable Reflow TeX blocks on this page yet. The viewer must
                have <code>reflowtex.inspect</code> (see the viewer README, “Inspection”).</div>` : why === "none" ? html`<div class="empty">No blocks on this page yet.</div>` : rows.value.map((item) => item.ids ? html`<${Run} key=${item.key} item=${item} sel=${sel}/>` : html`<${Row} key=${item.key} item=${item} sel=${sel}/>`)}
    </section>`;
}
const dtab = signal(recall("dtab", "props", plain) === "a11y" ? "a11y" : "props");
const a11yMode = signal(recall("a11yMode", "mathml", plain) === "spoken" ? "spoken" : "mathml");
const setDtab = (t) => {
  dtab.value = t;
  keep("dtab", t, plain);
};
const DTABS = [
  ["props", "Details", "Every field of the node"],
  ["a11y", "Accessibility", "What a screen reader is given for it: its text, and each formula as MathML or spelled out"]
];
function DetailTabs() {
  return html`<div class="dtabs" role="tablist">${DTABS.map(([t, label, title]) => html`<button type="button" role="tab" key=${t}
        data-dtab=${t} title=${title} aria-selected=${String(dtab.value === t)} onClick=${() => setDtab(t)}>${label}</button>`)}</div>`;
}
function AccessibleText({ id }) {
  const [a, setA] = useState(null);
  useEffect(() => {
    let live = true;
    call("accessible", id).then((r) => {
      if (live) setA(got(r) ? r : null);
    });
    return () => {
      live = false;
    };
  }, [id]);
  const mode = a11yMode.value;
  const setMode = (m) => {
    a11yMode.value = m;
    keep("a11yMode", m, plain);
  };
  const body = !a ? html`<${Muted}>…<//>` : !a.layer ? html`<${Muted}>This block has no accessible layer (build it with --a11y).<//>` : !a.pieces.length ? html`<${Muted}>Nothing in the accessible layer stands for this row.<//>` : a.pieces.map((p, k) => html`<section class="piece" key=${k} data-kind=${p.kind}>
            ${k > 0 && html`<hr/>`}
            <p class="said">${p.parts.map((x, q) => x.type === "text" ? html`<span key=${q}>${x.text}</span>` : mode === "spoken" ? html`<span class="spoken" key=${q} title="alttext">${x.alttext || "(no alttext)"}</span>` : html`<span class="mml" key=${q} title=${x.alttext} dangerouslySetInnerHTML=${{ __html: x.mathml }}></span>`)}</p>
        </section>`);
  return html`<div class="a11y">
        <div class="mode" role="group" aria-label="Formulas as">
            ${[["mathml", "MathML"], ["spoken", "Spoken"]].map(([m, label]) => html`<button type="button" key=${m} data-mode=${m}
                aria-pressed=${String(mode === m)} onClick=${() => setMode(m)}>${label}</button>`)}
        </div>
        ${body}
    </div>`;
}
function Details() {
  const x = details.value;
  if (selected.value == null || !x) return html`<aside class="details">
        <${Muted}>Select a row, or pick a box or glue in the page with <${IconPick}/>.<//></aside>`;
  const { id, d } = x;
  if (!d) return html`<aside class="details"><${Muted}>Gone – the layout changed.<//></aside>`;
  if (dtab.value === "a11y") return html`<aside class="details"><${DetailTabs}/><${AccessibleText} id=${id}/></aside>`;
  return html`<aside class="details"><${DetailTabs}/>
        <${Head} title=${`${d.summary.label}  ${d.summary.note}`}>
            ${d.glyph && html`<${Action} title=${`Show it in the glyph table of ${d.glyph.font} (Resources)`}
                onClick=${() => showGlyph(d.glyph.key, d.glyph.cp)}>In its font<//>`}
            <${Action} title=${`Copy this fragment – all it holds – as XML (${COPY_KEY} in the tree)`} onClick=${() => copyXml(id)}>Copy XML<//>
        <//>
        <${Table} rows=${d.rows}/>
    </aside>`;
}
function RowMenu({ id }) {
  const s = nodes.get(id) && nodes.get(id).s;
  const item = (label, hint, act) => html`<button type="button" role="menuitem"
            onClick=${async () => {
    closeMenu();
    await act();
    refs.tree.focus({ preventScroll: true });
  }}>
        <span>${label}</span><span class="hint">${hint}</span></button>`;
  return html`<${MenuBox} label="Copy">
        ${item("Copy XML", COPY_KEY, () => copyXml(id))}
        ${item("Copy text", "the characters", async () => {
    const t = await call("text", id);
    copyText(typeof t === "string" ? t : "", "text");
  })}
        ${item("Copy row", s ? s.label : "", () => copyText(s ? `${s.label}  ${s.note}`.trim() : "", "the row"))}
    <//>`;
}
export {
  Details,
  RowMenu,
  Tree,
  copyXml,
  forgetSelection,
  refresh,
  reveal,
  select,
  selected,
  toggle
};
