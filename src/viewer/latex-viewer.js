// SPDX-License-Identifier: AGPL-3.0-or-later
// reflowtex latex-viewer.js – GENERATED from src/viewer/src/ by esbuild@0.28.2 (make build-viewer); sources sha256 8fdd4ddddceddc96d793690a4f405732afffdc006631705670514e6d9909bdcc
'use strict';
"use strict";
(() => {
  // src/engine/core.js
  var ZOOM = 2;
  var SP_TO_PX = ZOOM / 65536;
  var RUNNING_RULE = -1073741824;
  var DEFAULT_ALIGN = "justify";
  var DEFAULT_LINE_PENALTY = 10;
  var DEFAULT_ADJ_DEMERITS = 1e4;
  var DEFAULT_DOUBLE_HYPHEN_DEMERITS = 1e4;
  var DEFAULT_FINAL_HYPHEN_DEMERITS = 5e3;
  var DEFAULT_PRETOLERANCE = 100;
  var DEFAULT_TOLERANCE = 200;
  var DEFAULT_TOLERANCE_2 = 500;
  var DEFAULT_EMERGENCY_TOLERANCE = 1e4;
  var DEFAULT_LAST_LINE_MIN = 0;
  var DEFAULT_LAST_LINE_PENALTY = 1e5;
  var DEFAULT_MAX_EXPAND = 0.02;
  var DEFAULT_MAX_SHRINK = 0.02;
  var DEFAULT_MIN_GAP = 16;
  var DEFAULT_PAD = 2;
  var DEFAULT_DISPLAY_MIN_SPACE = 10;
  var DEFAULT_DISPLAY_OVERFLOW_TOLERANCE = 2;
  var DEFAULT_USE_PROTRUSION = true;
  var DEFAULT_USE_EXPANSION = true;
  var DEFAULT_WIDTH_PT = 400;
  var RIGHT_PROTRUSION = { 44: 0.7, 46: 0.7, 58: 0.5, 59: 0.5, 45: 0.5, 8208: 0.5, 8722: 0.5, 33: 0.3, 63: 0.3 };
  var LEFT_PROTRUSION = { 40: 0.3, 8220: 0.7, 8216: 0.7 };
  var glyphMetrics = null;
  function useGlyphMetrics(table) {
    glyphMetrics = table || [];
    for (const m of glyphMetrics) {
      if (m.width === void 0) m.width = 0;
      if (m.height === void 0) m.height = 0;
      if (m.depth === void 0) m.depth = 0;
    }
  }
  var gW = (n) => n.width !== void 0 ? n.width : glyphMetrics[n.metrics - 1].width;
  function glyphExpandScale(fontInfo, n, er) {
    if (!er || n.text !== void 0) return 1;
    const fi = fontInfo && fontInfo[String(n.font)];
    if (!fi || !fi.expand) return 1;
    const c = fi.codes.get(n.char);
    const ef = c && c.ef !== void 0 ? c.ef : 1e3;
    return ef > 0 ? 1 + er * ef / 1e3 : 1;
  }
  function kernExpandScale(fontInfo, l, r, er) {
    if (!er || !l || !r || l.type !== "glyph" || r.type !== "glyph") return 1;
    const fl = fontInfo && fontInfo[String(l.font)], fr = fontInfo && fontInfo[String(r.font)];
    const ml = fl && fl.expand ? 1 : 0, mr = fr && fr.expand ? 1 : 0;
    if (!ml && !mr) return 1;
    const efOf = (fi, n) => {
      const c = fi && fi.codes && fi.codes.get(n.char);
      return c && c.ef !== void 0 ? c.ef : 1e3;
    };
    return 1 + er * ((efOf(fl, l) + efOf(fr, r)) / 2 / 1e3) * ((ml + mr) / 2);
  }
  function expandableSp(fontInfo, ns, i) {
    const n = ns[i];
    if (n.type === "glyph") return gW(n) * (glyphExpandScale(fontInfo, n, 1) - 1);
    if (n.type === "kern" && (n.subtype || 0) === 0)
      return n.kern * (kernExpandScale(fontInfo, ns[i - 1], ns[i + 1], 1) - 1);
    return 0;
  }
  var gH = (n) => n.height !== void 0 ? n.height : glyphMetrics[n.metrics - 1].height;
  var gD = (n) => n.depth !== void 0 ? n.depth : glyphMetrics[n.metrics - 1].depth;
  function nodeWidthSp(n) {
    switch (n.type) {
      case "glyph":
        return gW(n);
      case "picture":
        return n.width;
      case "kern":
        return n.kern;
      case "glue":
        return n.width;
      case "disc":
        return sumWidthSp(n.replace);
      case "wdisc":
        return sumWidthSp(n.replace);
      // a widget, unbroken
      case "widget":
        return n.width;
      // A transform is drawing-only and has no metrics of its own; its
      // children advance the pen just as they did before being grouped.
      case "transform":
        return sumWidthSp(n.children);
      case "hlist":
      case "vlist":
        return n.width;
      case "math":
        return n.surround;
      default:
        return 0;
    }
  }
  function sumWidthSp(nodes) {
    return nodes.reduce((a, n) => a + nodeWidthSp(n), 0);
  }
  function fillInfo(nodes) {
    let order = 0, stretch = 0;
    for (const n of nodes) {
      if (n.type === "glue" && (n.stretch_order || 0) > 0) {
        const o = n.stretch_order;
        if (o > order) {
          order = o;
          stretch = n.stretch;
        } else if (o === order) stretch += n.stretch;
      }
    }
    return { order, stretch };
  }
  function setGlue(g, ratio, fillOrder) {
    let w = g.width;
    if (ratio > 0 && (g.stretch_order || 0) === fillOrder && g.stretch) w += ratio * g.stretch;
    else if (ratio < 0 && (g.shrink_order || 0) === fillOrder && g.shrink) w += ratio * g.shrink;
    return w;
  }
  function vlistGlueRatio(box) {
    if (box.glue_sign === 1 && box.glue_set > 0) return { ratio: box.glue_set, fillOrder: box.glue_order || 0 };
    if (box.glue_sign === 2 && box.glue_set > 0) return { ratio: -box.glue_set, fillOrder: box.glue_order || 0 };
    return { ratio: 0, fillOrder: 0 };
  }
  function hlistGlueRatio(box) {
    if (box.glue_sign === 1 && box.glue_set > 0) return { ratio: box.glue_set, fillOrder: box.glue_order || 0 };
    if (box.glue_sign === 2 && box.glue_set > 0) return { ratio: -box.glue_set, fillOrder: box.glue_order || 0 };
    if (box.glue_set !== void 0 && box.glue_set !== null) return { ratio: 0, fillOrder: 0 };
    const nodes = box.children;
    let natural = 0;
    const stretch = [0, 0, 0, 0], shrink = [0, 0, 0, 0];
    for (const n of nodes) {
      if (n.type === "glue") {
        natural += n.width;
        stretch[n.stretch_order || 0] += n.stretch;
        shrink[n.shrink_order || 0] += n.shrink;
      } else {
        natural += nodeWidthSp(n);
      }
    }
    const slack = box.width - natural;
    if (slack > 0) {
      for (let o = 3; o >= 0; o--) if (stretch[o] > 0) return { ratio: slack / stretch[o], fillOrder: o };
    } else if (slack < 0) {
      for (let o = 3; o >= 0; o--) if (shrink[o] > 0) return { ratio: slack / shrink[o], fillOrder: o };
    }
    return { ratio: 0, fillOrder: 0 };
  }

  // src/runtime/page.js
  var SCRIPT_URL = document.currentScript?.src;
  var BUILD = (SCRIPT_URL?.match(/v=([a-f0-9]+)/) || [])[1] || "unversioned";
  var api = window.reflowtex = window.reflowtex || {};
  if (/[?&]reflowtex-debug\b/.test(location.search)) api.debug = true;
  var debugLog = (...a) => {
    if (api.debug) console.debug(...a);
  };
  debugLog(`[latex-viewer] build ${BUILD}`);

  // src/host/actions.ts
  var handlers = /* @__PURE__ */ new WeakMap();
  function onAction(instance, verb, fn) {
    let byVerb = handlers.get(instance);
    if (!byVerb) handlers.set(instance, byVerb = /* @__PURE__ */ new Map());
    let set = byVerb.get(verb);
    if (!set) byVerb.set(verb, set = /* @__PURE__ */ new Set());
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  }
  function parseAction(text) {
    const i = text.indexOf(":");
    return { verb: i < 0 ? text : text.slice(0, i), arg: i < 0 ? "" : text.slice(i + 1) };
  }
  function dispatchAction(source, text) {
    const { verb, arg } = parseAction(text);
    const marked = source.closest("[data-instance]");
    const origin = marked && host.find(marked.dataset.instance || "") || null;
    const action = { verb, arg, action: text, instance: origin, source };
    let handled = false;
    for (let i = origin; i && !handled; i = i.parent) {
      for (const fn of handlers.get(i)?.get(verb) || []) {
        let r;
        try {
          r = fn(action);
        } catch (e) {
          console.error(`[latex-viewer] action "${text}":`, e);
          r = void 0;
        }
        if (r !== false) {
          handled = true;
          break;
        }
      }
    }
    source.dispatchEvent(new CustomEvent("reflowtex:action", {
      bubbles: true,
      detail: { ...action, handled }
    }));
  }

  // src/host/instances.ts
  var textHooks = { set: (_id, _text) => {
  } };
  var InstanceImpl = class {
    constructor(id, kind, attrs, presentation, placement, parent, block, source, anchorOf) {
      this.id = id;
      this.kind = kind;
      this.attrs = attrs;
      this.presentation = presentation;
      this.placement = placement;
      this.parent = parent;
      this.block = block;
      this.source = source;
      this.anchorOf = anchorOf;
    }
    id;
    kind;
    attrs;
    presentation;
    placement;
    parent;
    block;
    source;
    anchorOf;
    children = [];
    parts = /* @__PURE__ */ new Map();
    spaceBefore = 0;
    /** Internal: the stream (1-based) or slot index it was made from. */
    stream = 0;
    slot = 0;
    part(role) {
      return this.parts.get(role);
    }
    onAction(verb, fn) {
      return onAction(this, verb, fn);
    }
    setText(text) {
      if (this.placement !== "text") throw new TypeError(`setText: ${this.id} is not a \\webtext`);
      textHooks.set(this.id, text === null || text === void 0 ? null : String(text));
    }
    anchor() {
      return this.source.type === "none" ? null : this.anchorOf(this.source);
    }
  };
  function splitAttrs(list) {
    const attrs = {};
    const classes = [];
    const properties = {};
    let aside = false;
    for (const a of list || []) {
      const k = a.key || "", v = a.value || "";
      if (!/^[a-z0-9-]+$/i.test(k)) continue;
      if (k === "aside") aside = v === "true";
      else if (k === "class") classes.push(...v.split(/\s+/).filter(Boolean));
      else if (k.startsWith("--")) properties[k] = v;
      else attrs[k] = v;
    }
    return { attrs, presentation: { classes, properties }, aside };
  }
  var NO_PRESENTATION = Object.freeze({ classes: Object.freeze([]), properties: Object.freeze({}) });
  function normalise(doc, block, key, parts, anchorOf, spToPx = 0) {
    const streams = doc.streams || [];
    const slots = doc.slots || [];
    const roots = [];
    const seenStream = /* @__PURE__ */ new Set();
    const seenSlot = /* @__PURE__ */ new Set();
    const widgetsByKey = /* @__PURE__ */ new Map();
    const pendingAsides = [];
    const adopt = (inst, parent) => {
      (parent ? parent.children : roots).push(inst);
    };
    const streamInstance = (index, placement, parent, source) => {
      seenStream.add(index);
      const s = streams[index - 1];
      const { attrs, presentation } = splitAttrs(s.attrs);
      const inst = new InstanceImpl(
        `${key}/s${index}`,
        s.kind || "",
        Object.freeze(attrs),
        presentation,
        placement,
        parent,
        block,
        source,
        anchorOf
      );
      inst.stream = index;
      inst.parts.set("body", parts.typeset(inst, "body", s));
      if (s.text !== void 0) {
        const data = { type: "data", role: "text", instance: inst, data: s.text };
        inst.parts.set("text", data);
      }
      adopt(inst, parent);
      walkContent(s.content || [], inst);
      return inst;
    };
    const slotInstance = (index, parent) => {
      seenSlot.add(index);
      const slot = slots[index - 1] || {};
      const name = slot.name || "";
      if (slot.kind === "widget") {
        const colon = name.indexOf(":");
        const kind = colon >= 0 ? name.slice(0, colon) : name;
        const attrs = { name };
        if (colon >= 0) attrs.key = name.slice(colon + 1);
        const inst = new InstanceImpl(
          `${key}/w${index}`,
          kind,
          Object.freeze(attrs),
          NO_PRESENTATION,
          "inline",
          parent,
          block,
          { type: "widget", slot: index },
          anchorOf
        );
        inst.slot = index;
        if (attrs.key !== void 0 && !widgetsByKey.has(attrs.key)) widgetsByKey.set(attrs.key, inst);
        adopt(inst, parent);
      } else {
        const inst = new InstanceImpl(
          `${key}/t${index}`,
          "text",
          Object.freeze({ name }),
          NO_PRESENTATION,
          "text",
          parent,
          block,
          { type: "none" },
          anchorOf
        );
        inst.slot = index;
        adopt(inst, parent);
      }
    };
    const walkNodes = (nodes, parent) => {
      for (const n of nodes || []) {
        if (n.slot && !seenSlot.has(n.slot)) slotInstance(n.slot, parent);
        if (n.aside && !seenStream.has(n.aside)) {
          pendingAsides.push({ index: n.aside, parent });
          seenStream.add(n.aside);
        }
        if (n.stream && !seenStream.has(n.stream) && streams[n.stream - 1])
          streamInstance(n.stream, "detached", parent, { type: "glyph", stream: n.stream });
        walkNodes(n.children, parent);
        walkNodes(n.replace, parent);
        walkNodes(n.pre, parent);
        walkNodes(n.post, parent);
      }
    };
    function walkContent(items, parent) {
      let space = 0;
      for (const it of items) {
        if (it.kind === "vspace") {
          space += it.amount || 0;
          continue;
        }
        const before = space;
        space = 0;
        if (it.kind === "stream") {
          if (it.stream && !seenStream.has(it.stream) && streams[it.stream - 1])
            streamInstance(it.stream, "block", parent, { type: "none" }).spaceBefore = before * spToPx;
        } else if (it.kind === "display") {
          walkNodes(it.box ? [it.box] : [], parent);
        } else if (!it.kind || it.kind === "paragraph") {
          if (it.para) walkNodes(doc.paragraphs[it.para - 1]?.nodes, parent);
        }
      }
    }
    walkContent(doc.content || [], null);
    streams.forEach((s, i) => {
      if (!seenStream.has(i + 1) && splitAttrs(s.attrs).aside) pendingAsides.push({ index: i + 1, parent: null });
    });
    for (const { index, parent } of pendingAsides) {
      const s = streams[index - 1];
      const { attrs } = splitAttrs(s.attrs);
      const owner = attrs.for !== void 0 ? widgetsByKey.get(attrs.for) : void 0;
      if (owner && !owner.parts.has(s.kind || "")) {
        owner.parts.set(s.kind || "", parts.typeset(owner, s.kind || "", s));
        continue;
      }
      seenStream.delete(index);
      streamInstance(index, "detached", parent, { type: "aside", stream: index });
    }
    streams.forEach((_, i) => {
      if (!seenStream.has(i + 1)) streamInstance(i + 1, "detached", null, { type: "none" });
    });
    return roots;
  }
  function* walk(list) {
    for (const i of list) {
      yield i;
      yield* walk(i.children);
    }
  }
  function matches(inst, query) {
    if (query === void 0) return true;
    if (typeof query === "string") return inst.kind === query;
    for (const [k, v] of Object.entries(query)) {
      if (v === void 0) continue;
      const have = k === "kind" ? inst.kind : k === "placement" ? inst.placement : inst.attrs[k];
      if (have !== String(v)) return false;
    }
    return true;
  }

  // src/engine/layout/lines.js
  function lineProfile(fontInfo, nodes, xStart, ratio, expandRatio) {
    const items = [];
    function walk2(ns, x, r, er) {
      for (let i = 0; i < ns.length; i++) {
        const n = ns[i];
        switch (n.type) {
          case "glyph": {
            const w = gW(n) * glyphExpandScale(fontInfo, n, er) * SP_TO_PX;
            const h = gH(n) * SP_TO_PX, d = gD(n) * SP_TO_PX;
            items.push({ x1: x, x2: x + w, h, d });
            x += w;
            break;
          }
          case "glue": {
            let w = n.width;
            if (r > 0 && !(n.stretch_order || 0) && n.stretch) w += r * n.stretch;
            else if (r < 0 && !(n.shrink_order || 0) && n.shrink) w += r * n.shrink;
            x += w * SP_TO_PX;
            break;
          }
          case "kern":
            x += n.kern * ((n.subtype || 0) === 0 ? kernExpandScale(fontInfo, ns[i - 1], ns[i + 1], er) : 1) * SP_TO_PX;
            break;
          case "disc":
          case "wdisc":
            x = walk2(n.replace, x, 0, er);
            break;
          case "math":
            x += n.surround * SP_TO_PX;
            break;
          case "widget":
          case "picture": {
            const w = (n.width ?? 0) * SP_TO_PX;
            items.push({ x1: x, x2: x + w, h: (n.height ?? 0) * SP_TO_PX, d: (n.depth ?? 0) * SP_TO_PX });
            x += w;
            break;
          }
          case "hlist":
          case "vlist": {
            const w = (n.width ?? 0) * SP_TO_PX, shift = (n.shift ?? 0) * SP_TO_PX;
            items.push({ x1: x, x2: x + w, h: Math.max(0, (n.height ?? 0) * SP_TO_PX - shift), d: Math.max(0, (n.depth ?? 0) * SP_TO_PX + shift) });
            x += w;
            break;
          }
        }
      }
      return x;
    }
    walk2(nodes, xStart, ratio, expandRatio);
    return items;
  }
  function minRequiredAdvance(upper, lower) {
    let req = 0;
    for (const u of upper) {
      if (u.d <= 0) continue;
      for (const l of lower) {
        if (l.h <= 0) continue;
        if (u.x2 > l.x1 && l.x2 > u.x1) req = Math.max(req, u.d + l.h);
      }
    }
    return req;
  }
  function texInterlineAdvance(prevDepth, thisAscent, m) {
    return m.bskip - prevDepth - thisAscent >= m.lskiplimit ? m.bskip : prevDepth + thisAscent + m.lskip;
  }
  function texInterlineGlue(prevDepth, thisAscent, m) {
    return texInterlineAdvance(prevDepth, thisAscent, m) - prevDepth - thisAscent;
  }

  // src/engine/breaker.js
  function protSkipable(n) {
    switch (n.type) {
      case "penalty":
      case "local_par":
        return true;
      case "glue":
        return !n.width && !n.stretch && !n.shrink;
      case "kern":
        return !n.kern || (n.subtype || 0) === 0;
      case "math":
        return !n.surround;
      case "disc":
        return !(n.pre || []).length && !(n.post || []).length && !(n.replace || []).length;
      default:
        return false;
    }
  }
  function findLastGlyph(nodes, idx) {
    for (let k = idx - 1; k >= 0; k--) {
      const n = nodes[k];
      if (protSkipable(n)) continue;
      if (n.type === "hlist") {
        const kids = n.children || [];
        if (kids.every(protSkipable)) continue;
        return findLastGlyph(kids, kids.length);
      }
      return n.type === "glyph" ? n : null;
    }
    return null;
  }
  function findFirstGlyph(nodes, idx) {
    let k = idx;
    const emptyBox = (n) => n.type === "hlist" && !(n.children || []).length && !n.width && !n.height && !n.depth;
    while (k < nodes.length - 1 && emptyBox(nodes[k])) k++;
    for (; k < nodes.length; k++) {
      const n = nodes[k];
      if (protSkipable(n)) continue;
      if (n.type === "hlist" && (n.children || []).length) return findFirstGlyph(n.children, 0);
      return n.type === "glyph" ? n : null;
    }
    return null;
  }
  function roundXnOverD(x, n, d) {
    const s = x < 0 ? -1 : 1;
    return s * Math.floor((Math.abs(x) * n + Math.floor(d / 2)) / d);
  }
  function protrusionOf(fontInfo, para, g, left) {
    if (!g) return 0;
    const fi = fontInfo && fontInfo[String(g.font)];
    if (fi && fi.quad > 0) {
      if (!(para && para.protrude_chars > 0)) return 0;
      const c = fi.codes && fi.codes.get(g.char);
      const code = c ? (left ? c.lp : c.rp) || 0 : 0;
      return code ? roundXnOverD(fi.quad, code, 1e3) : 0;
    }
    return ((left ? LEFT_PROTRUSION : RIGHT_PROTRUSION)[g.char] || 0) * gW(g);
  }
  function efCodeOf(fi, n) {
    const c = fi && fi.codes && fi.codes.get(n.char);
    return c && c.ef !== void 0 ? c.ef : 1e3;
  }
  function expandLimit(fontInfo, n, shrink) {
    const fi = fontInfo && fontInfo[String(n.font)];
    return fi && fi.expand ? (shrink ? fi.expand.shrink : fi.expand.stretch) || 0 : 0;
  }
  function fontStretchSp(fontInfo, ns, i, shrink) {
    const n = ns[i];
    if (n.type === "glyph") {
      const m = expandLimit(fontInfo, n, shrink);
      if (!(m > 0) || n.text !== void 0) return 0;
      const ef = efCodeOf(fontInfo[String(n.font)], n);
      if (!(ef > 0)) return 0;
      const w = gW(n);
      const dw = shrink ? w - roundXnOverD(w, 1e3 - m, 1e3) : roundXnOverD(w, 1e3 + m, 1e3) - w;
      return dw > 0 ? roundXnOverD(dw, ef, 1e3) : 0;
    }
    if (n.type === "kern" && (n.subtype || 0) === 0 && n.kern) {
      const l = ns[i - 1], r = ns[i + 1];
      if (!l || !r || l.type !== "glyph" || r.type !== "glyph") return 0;
      const m = Math.trunc((expandLimit(fontInfo, l, shrink) + expandLimit(fontInfo, r, shrink)) / 2);
      if (!m) return 0;
      const w = n.kern, d = roundXnOverD(w, shrink ? 1e3 - m : 1e3 + m, 1e3);
      const e = Math.trunc((efCodeOf(fontInfo[String(l.font)], l) + efCodeOf(fontInfo[String(r.font)], r)) / 2);
      const x = shrink ? w - d : d - w;
      return e === 1e3 ? x : roundXnOverD(x, e, 1e3);
    }
    return 0;
  }
  function paragraphExpansion(fontInfo, nodes) {
    const walk2 = (ns) => {
      for (const n of ns || []) {
        if (n.type === "glyph") {
          const fi = fontInfo && fontInfo[String(n.font)];
          if (fi && fi.expand && fi.expand.step > 0) return fi.expand;
        } else if (n.type === "disc") {
          const e = walk2(n.pre) || walk2(n.post) || walk2(n.replace);
          if (e) return e;
        }
      }
      return null;
    };
    return walk2(nodes);
  }
  var PRECEDES_BREAK = /* @__PURE__ */ new Set(["glyph", "hlist", "vlist", "rule", "disc", "wdisc", "picture", "widget", "transform"]);
  function buildBreakCandidates(nodes, fontInfo, para) {
    para = para || {};
    const adjust = para.adjust_spacing || 0;
    const fsOf = (ns, i, shrink) => adjust > 0 ? fontStretchSp(fontInfo, ns, i, shrink) : 0;
    const part = (ns) => {
      const r = { w: 0, g: 0, fs: 0, fz: 0 };
      for (let i = 0; i < (ns || []).length; i++) {
        r.w += nodeWidthSp(ns[i]);
        r.g += expandableSp(fontInfo, ns, i);
        r.fs += fsOf(ns, i, false);
        r.fz += fsOf(ns, i, true);
      }
      return r;
    };
    const prot = (g, left) => protrusionOf(fontInfo, para, g, left);
    const NONE = { w: 0, g: 0, fs: 0, fz: 0 };
    let cumW = 0, cumS = 0, cumZ = 0, cumGlyphW = 0, cumFS = 0, cumFZ = 0, cumFill = 0;
    const cand = (kind, i, penalty, extra) => ({
      kind,
      nodeIdx: i,
      penalty,
      pre: NONE,
      post: NONE,
      replace: NONE,
      leadW: 0,
      leadS: 0,
      leadZ: 0,
      trailW: 0,
      trailN: 0,
      cumW,
      cumS,
      cumZ,
      cumGlyphW,
      cumFS,
      cumFZ,
      cumFill,
      rightProtrusion: 0,
      leftProtrusion: 0,
      ...extra
    });
    const lead = (from) => {
      let W = 0, S = 0, Z = 0, k = from;
      for (; k < nodes.length; k++) {
        const m = nodes[k];
        if (m.type === "kern") W += m.kern;
        else if (m.type === "glue" && m.subtype !== 15) {
          W += m.width;
          S += !m.stretch_order ? m.stretch : 0;
          Z += !m.shrink_order ? m.shrink : 0;
        } else if (m.type !== "penalty") break;
      }
      return { leadW: W, leadS: S, leadZ: Z, leftProtrusion: prot(findFirstGlyph(nodes, k), true) };
    };
    const bcs = [cand("start", -1, 0, { leftProtrusion: prot(findFirstGlyph(nodes, 0), true) })];
    bcs.expansion = adjust > 0 ? paragraphExpansion(fontInfo, nodes) : null;
    bcs.adjustSpacing = bcs.expansion ? adjust : 0;
    let inMath = false;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.type === "local_par") continue;
      if (n.type === "glue" && n.subtype === 15) {
        bcs.push(cand("end", i, -1e4, { packRightProtrusion: prot(findLastGlyph(nodes, i), false) }));
        break;
      }
      if (n.type === "glue" && n.stretch_order > 0) {
        cumW += n.width;
        cumFill += 1;
        continue;
      }
      if (n.type === "glue") {
        const prev = nodes[i - 1];
        let ok = false, trailN = 0;
        if (!inMath && prev) {
          if (PRECEDES_BREAK.has(prev.type)) ok = true;
          else if (prev.type === "kern" && ((prev.subtype || 0) === 0 || prev.subtype === 2)) ok = true;
          else if (prev.type === "kern" && (prev.subtype === 1 || prev.subtype === 3) || prev.type === "math") {
            ok = true;
            trailN = 1;
          }
        }
        if (ok) {
          const trailW = trailN ? nodeWidthSp(prev) : 0;
          bcs.push(cand("space", i, 0, {
            trailW,
            trailN,
            rightProtrusion: prot(findLastGlyph(nodes, i - trailN), false),
            ...lead(i)
          }));
        }
        cumW += n.width;
        cumS += !n.stretch_order ? n.stretch : 0;
        cumZ += !n.shrink_order ? n.shrink : 0;
      } else if (n.type === "disc") {
        const pre = part(n.pre), post = part(n.post), replace = part(n.replace);
        const preGs = (n.pre || []).filter((x) => x.type === "glyph"), postGs = (n.post || []).filter((x) => x.type === "glyph");
        bcs.push(cand("disc", i, n.penalty ?? 50, {
          pre,
          post,
          replace,
          explicit: (n.subtype || 0) <= 2,
          rightProtrusion: prot(preGs.length > 0 ? preGs[preGs.length - 1] : findLastGlyph(nodes, i), false),
          leftProtrusion: prot(postGs.length > 0 ? postGs[0] : findFirstGlyph(nodes, i + 1), true)
        }));
        cumW += replace.w;
        cumGlyphW += replace.g;
        cumFS += replace.fs;
        cumFZ += replace.fz;
      } else if (n.type === "wdisc") {
        const replace = { ...NONE, w: sumWidthSp(n.replace) };
        for (const o of n.options) {
          bcs.push(cand("disc", i, o.penalty, {
            preNodes: o.pre,
            postNodes: o.post,
            pre: { ...NONE, w: sumWidthSp(o.pre) },
            post: { ...NONE, w: sumWidthSp(o.post) },
            replace
          }));
        }
        cumW += replace.w;
      } else if (n.type === "penalty" && n.penalty < 1e4) {
        bcs.push(cand("penalty", i, n.penalty, { rightProtrusion: prot(findLastGlyph(nodes, i), false), ...lead(i + 1) }));
      } else {
        if (n.type === "math") inMath = (n.subtype || 0) === 0;
        cumW += nodeWidthSp(n);
        cumGlyphW += expandableSp(fontInfo, nodes, i);
        cumFS += fsOf(nodes, i, false);
        cumFZ += fsOf(nodes, i, true);
      }
    }
    return bcs;
  }
  function lineMetrics(a, b, p) {
    const protrude = p.useProtrusion ? a.leftProtrusion + b.rightProtrusion : 0;
    const from = (key, lead) => a[key] + (a.kind === "disc" ? a.replace[lead] - a.post[lead] : 0);
    const upto = (key, part) => b[key] + (b.kind === "disc" ? b.pre[part] : 0);
    const on = p.useExpansion !== false;
    return {
      w: upto("cumW", "w") - b.trailW - from("cumW", "w") - a.leadW - protrude,
      s: b.cumS - a.cumS - a.leadS,
      z: b.cumZ - a.cumZ - a.leadZ,
      g: on ? upto("cumGlyphW", "g") - from("cumGlyphW", "g") : 0,
      fs: on ? upto("cumFS", "fs") - from("cumFS", "fs") : 0,
      fz: on ? upto("cumFZ", "fz") - from("cumFZ", "fz") : 0
    };
  }
  function rawBadness(shortage, total) {
    if (shortage === 0) return 0;
    if (total <= 0) return 1e7;
    const r = shortage / total;
    return Math.min(1e7, 100 * r * r * r);
  }
  function badness(t, s) {
    t = Math.round(t);
    s = Math.round(s);
    if (t <= 0) return 0;
    if (s <= 0) return 1e4;
    let r;
    if (t <= 7230584) r = Math.floor(t * 297 / s);
    else if (s >= 1663497) r = Math.floor(t / Math.floor(s / 297));
    else r = t;
    return r > 1290 ? 1e4 : Math.floor((r * r * r + 131072) / 262144);
  }
  function expansionShortfall(shortfall, m, ex) {
    if (!ex || shortfall === 0) return shortfall;
    if (shortfall > 0 && m.fs > 0)
      return m.fs > shortfall ? Math.trunc(Math.trunc(m.fs / Math.max(1, Math.trunc(ex.stretch / ex.step))) / 2) : shortfall - m.fs;
    if (shortfall < 0 && m.fz > 0)
      return m.fz > -shortfall ? Math.trunc(Math.trunc(m.fz / Math.max(1, Math.trunc(ex.shrink / ex.step))) / 2) : shortfall + m.fz;
    return shortfall;
  }
  function kpPass(bcs, lineWidthSp, threshold, firstPass, p, final) {
    const N = bcs.length;
    const dp = Array.from({ length: N }, () => [null, null, null, null]);
    const alive = final ? dp.map(() => [true, true, true, true]) : null;
    dp[0][2] = { demerits: 0, prev_j: -1, prev_fc: -1, hyphenated: false };
    let minRejectedBadness = null;
    const ex = bcs.adjustSpacing > 1 ? bcs.expansion : null;
    const lastForced = new Array(N).fill(-1);
    for (let k = 1, lf = -1; k < N; k++) {
      lastForced[k] = lf;
      if (bcs[k].kind === "penalty" && bcs[k].penalty <= -1e4) lf = k;
    }
    for (let j2 = 1; j2 < N; j2++) {
      const bcJ = bcs[j2];
      if (firstPass && bcJ.kind === "disc" && !bcJ.explicit) continue;
      if (bcJ.penalty >= 1e4) continue;
      const isEnd = bcJ.kind === "end";
      let feasibleAtJ = false;
      const onlyStart = (i, fc2) => {
        for (let k = Math.max(0, lastForced[j2]); k < j2; k++) for (let f = 0; f < 4; f++)
          if (dp[k][f] && alive[k][f] && !(k === i && f === fc2)) return false;
        return true;
      };
      for (let i = 0; i < j2; i++) {
        if (i < lastForced[j2]) continue;
        if (bcs[i].nodeIdx === bcJ.nodeIdx) continue;
        let m = null;
        for (let fc_i = 0; fc_i < 4; fc_i++) {
          const si = dp[i][fc_i];
          if (!si) continue;
          if (final && !alive[i][fc_i]) continue;
          if (!m) m = lineMetrics(bcs[i], bcJ, p);
          const hasFill = isEnd || p.ragged || bcJ.cumFill > bcs[i].cumFill;
          const shortfall = expansionShortfall(lineWidthSp - m.w, m, ex);
          let b, fc_j;
          if (shortfall > 0) {
            if (hasFill) {
              b = 0;
              fc_j = 2;
            } else {
              b = badness(shortfall, m.s);
              fc_j = b > 99 ? 0 : b > 12 ? 1 : 2;
            }
          } else if (shortfall < 0) {
            if (-shortfall > m.z) {
              if (final) {
                alive[i][fc_i] = false;
                if (!feasibleAtJ && onlyStart(i, fc_i) && (!dp[j2][3] || si.demerits <= dp[j2][3].demerits))
                  dp[j2][3] = { demerits: si.demerits, prev_j: i, prev_fc: fc_i, hyphenated: bcJ.kind === "disc", overfull: true };
              }
              continue;
            }
            b = badness(-shortfall, m.z);
            fc_j = b > 12 ? 3 : 2;
          } else {
            b = 0;
            fc_j = 2;
          }
          if (b > threshold) {
            if (minRejectedBadness === null || b < minRejectedBadness) minRejectedBadness = b;
            continue;
          }
          feasibleAtJ = true;
          const emergency = threshold >= 1e4;
          const bd = emergency && !(hasFill && shortfall >= 0) ? rawBadness(Math.abs(shortfall), shortfall >= 0 ? m.s : m.z) : b;
          const lp = p.linePenalty + bd;
          let d = emergency ? lp * lp : Math.abs(lp) >= 1e4 ? 1e8 : lp * lp;
          if (bcJ.penalty > 0) d += bcJ.penalty * bcJ.penalty;
          else if (bcJ.penalty > -1e4) d -= bcJ.penalty * bcJ.penalty;
          if (si.hyphenated) {
            if (bcJ.kind === "disc") d += p.doubleHyphenDemerits;
            else if (isEnd) d += p.finalHyphenDemerits;
          }
          if (Math.abs(fc_j - fc_i) > 1) d += p.adjDemerits;
          if (isEnd && p.lastLineMin > 0 && m.w < p.lastLineMin * lineWidthSp) d += p.lastLinePenalty;
          const td = si.demerits + d;
          if (!dp[j2][fc_j] || td <= dp[j2][fc_j].demerits) dp[j2][fc_j] = { demerits: td, prev_j: i, prev_fc: fc_i, hyphenated: bcJ.kind === "disc" };
        }
      }
    }
    const endIdx = N - 1;
    if (bcs[endIdx].kind !== "end") return { breaks: null, minRejectedBadness };
    let bestFc = -1, bestD = Infinity;
    for (let fc2 = 0; fc2 < 4; fc2++) if (dp[endIdx][fc2] && dp[endIdx][fc2].demerits < bestD) {
      bestD = dp[endIdx][fc2].demerits;
      bestFc = fc2;
    }
    if (bestFc === -1) return { breaks: null, minRejectedBadness };
    const breaks = [];
    let j = endIdx, fc = bestFc, overfull = false;
    while (j > 0) {
      breaks.push({ bcIdx: j, fc, demerits: dp[j][fc].demerits });
      if (dp[j][fc].overfull) overfull = true;
      const pj = dp[j][fc].prev_j, pfc = dp[j][fc].prev_fc;
      j = pj;
      fc = pfc;
    }
    breaks.reverse();
    return { breaks, minRejectedBadness, overfull };
  }
  function packLine(bcs, a, b, lineWidthSp, p, hasFill) {
    const m = lineMetrics(a, b, p);
    const x = lineWidthSp - m.w + (p.useProtrusion ? b.packRightProtrusion || 0 : 0);
    if (x === 0 || hasFill && x > 0) return { ratio: 0, expand: 0 };
    let expand = 0, rest = x;
    const ex = bcs.expansion;
    const f = x > 0 ? m.fs : m.fz;
    if (ex && f > 0 && m.g > 0) {
      const limit = x > 0 ? ex.stretch : ex.shrink;
      const r = Math.max(-1e3, Math.min(1e3, Math.round(x * 1e3 / f)));
      let e = Math.abs(Math.round(r * limit / 1e3));
      if (e > limit) e = limit;
      else if (ex.step > 1 && e % ex.step) e = ex.step * roundXnOverD(e, 1, ex.step);
      expand = (x > 0 ? e : -e) / 1e3;
      rest = x - expand * m.g;
    }
    const ratio = rest > 0 ? hasFill || !(m.s > 0) ? 0 : rest / m.s : rest < 0 ? m.z > 0 ? Math.max(-1, rest / m.z) : 0 : 0;
    return { ratio, expand };
  }
  function extractLineNodes(startBC, endBC, nodes) {
    const result = [];
    let from;
    if (startBC.kind === "start") {
      from = 0;
    } else {
      if (startBC.kind === "disc") for (const pn of startBC.postNodes || nodes[startBC.nodeIdx].post) result.push(pn);
      from = startBC.nodeIdx + 1;
    }
    if (startBC.kind !== "start" && result.length === 0) {
      while (from < endBC.nodeIdx && (nodes[from].type === "glue" || nodes[from].type === "kern" || nodes[from].type === "penalty")) from++;
    }
    const to = endBC.nodeIdx - (endBC.trailN || 0);
    for (let i = from; i < to; i++) if (nodes[i].type !== "local_par") result.push(nodes[i]);
    if (endBC.kind === "disc") for (const pn of endBC.preNodes || nodes[endBC.nodeIdx].pre) result.push(pn);
    return result;
  }
  function greedyFallback(bcs, nodes, lineWidthSp, p) {
    const breaks = [];
    let s = 0;
    for (let j = 1; j < bcs.length; j++) {
      const { w } = lineMetrics(bcs[s], bcs[j], p);
      if (bcs[j].kind === "end") {
        breaks.push({ bcIdx: j, fc: 2, demerits: 0 });
        break;
      }
      if (w > lineWidthSp && j > s + 1) {
        breaks.push({ bcIdx: j - 1, fc: 2, demerits: 0 });
        s = j - 1;
      }
    }
    return breaks;
  }
  function kpBreak(bcs, nodes, lineWidthSp, p) {
    let breaks = null;
    if (p.pretolerance >= 0)
      breaks = kpPass(bcs, lineWidthSp, p.pretolerance, true, p).breaks;
    let texBreaks = null;
    if (!breaks) {
      const r = kpPass(bcs, lineWidthSp, p.tolerance, false, p, !!p.texFinalPass);
      if (!r.overfull || p.texFinalPass === "strict") breaks = r.breaks;
      else texBreaks = r.breaks;
    }
    if (!breaks) breaks = kpPass(bcs, lineWidthSp, p.tolerance2, false, p).breaks;
    if (!breaks) breaks = kpPass(bcs, lineWidthSp, p.emergencyTolerance, false, p).breaks;
    if (!breaks) breaks = texBreaks;
    if (!breaks) breaks = greedyFallback(bcs, nodes, lineWidthSp, p);
    const lines = [];
    for (let k = 0; k < breaks.length; k++) {
      const startBC = k === 0 ? bcs[0] : bcs[breaks[k - 1].bcIdx], endBC = bcs[breaks[k].bcIdx];
      const hasFill = endBC.kind === "end" || p.ragged || endBC.cumFill > startBC.cumFill;
      const { ratio, expand } = packLine(bcs, startBC, endBC, lineWidthSp, p, hasFill);
      const rightProtrusion = (endBC.kind === "end" ? endBC.packRightProtrusion : endBC.rightProtrusion) || 0;
      lines.push({ nodes: extractLineNodes(startBC, endBC, nodes), ratio, expand, fitness: breaks[k].fc, leftProtrusion: startBC.leftProtrusion, rightProtrusion });
    }
    return lines;
  }

  // src/host/kinds.ts
  var kinds = /* @__PURE__ */ new Map();
  var listeners = /* @__PURE__ */ new Set();
  var kindDef = (kind) => kinds.get(kind);
  function onKindChange(fn) {
    listeners.add(fn);
  }
  function changed(kind) {
    for (const fn of listeners) {
      try {
        fn(kind);
      } catch (e) {
        console.error(`[latex-viewer] redrawing kind "${kind}":`, e);
      }
    }
  }
  function defineKind(kind, def) {
    if (!def || typeof def.render !== "function")
      throw new TypeError(`host.define("${kind}"): render(instance, host) is required`);
    kinds.set(kind, def);
    changed(kind);
    return () => {
      if (kinds.get(kind) !== def) return;
      kinds.delete(kind);
      changed(kind);
    };
  }

  // src/defaults/margin-notes.ts
  var MARGIN = { gap: 28, min: 150, max: 260 };
  function marginHost(it, instance, again) {
    return {
      type: "margin",
      el: it.note,
      instance,
      setEdges(e) {
        it.edges = { ...it.edges, ...e };
        again();
      }
    };
  }
  function undraw(it) {
    if (it.undo) {
      try {
        it.undo();
      } catch (e) {
        console.error("[latex-viewer] margin note:", e);
      }
    }
    it.surface?.dispose();
    it.undo = null;
    it.surface = null;
    it.edges = {};
    it.note.replaceChildren();
    it.def = null;
  }
  function draw(it, instance, width, again) {
    const def = kindDef(instance.kind);
    if (it.def !== null && it.def !== def) undraw(it);
    if (it.def === null) {
      it.def = def;
      if (def) {
        try {
          const u = def.render(instance, marginHost(it, instance, again));
          it.undo = typeof u === "function" ? u : null;
          return;
        } catch (e) {
          console.error(`[latex-viewer] kind "${instance.kind}": render failed, drawn by default:`, e);
          it.note.replaceChildren();
        }
      }
      const body = instance.part("body");
      if (body && body.type === "typeset") it.surface = body.mount(it.note, { width });
    } else if (it.surface && it.width !== width) {
      it.surface.setWidth(width);
    }
  }
  function edgeOf(it, instance, blockEl) {
    if (it.edges.top !== void 0) return it.edges.top;
    if (it.surface) return it.surface;
    const body = instance.part("body");
    for (const s of surfacesOf(blockEl))
      if (s.part === body && it.note.contains(s.el)) return s;
    return null;
  }
  function removeMarginNotes(data) {
    const M = data && data.margin;
    if (!M) return;
    for (const it of M.items.values()) undraw(it);
    M.layer.remove();
    data.margin = null;
  }
  function placeMarginNotes(data) {
    const el = data && data.el;
    if (!el || !el.isConnected) return;
    const block = blockOf(el);
    const notes = block ? block.instances({ placement: "detached", place: "margin" }) : [];
    if (!notes.length) return;
    const again = () => requestAnimationFrame(() => placeMarginNotes(data));
    const M = data.margin = data.margin || { layer: document.createElement("div"), items: /* @__PURE__ */ new Map() };
    M.layer.className = "latex-margin";
    if (M.layer.parentNode !== el) el.appendChild(M.layer);
    if (getComputedStyle(el).position === "static") el.style.position = "relative";
    const br = el.getBoundingClientRect(), k = br.width / el.offsetWidth || 1;
    const cs = getComputedStyle(el), px = (v, d) => {
      const n = parseFloat(v);
      return isFinite(n) ? n : d;
    };
    const gap = px(cs.getPropertyValue("--latex-margin-gap"), MARGIN.gap);
    const set = px(cs.getPropertyValue("--latex-margin-width"), null);
    const room = set !== null ? set : (document.documentElement.clientWidth - br.right) / k - gap;
    const width = Math.floor(Math.min(set !== null ? set : MARGIN.max, room));
    const wide = set !== null ? width > 0 : room >= MARGIN.min;
    const placed = [];
    for (const a of notes) {
      let it = M.items.get(a.id);
      if (!it) {
        const note = document.createElement("div");
        note.className = "latex-margin-note";
        note.dataset.kind = a.kind;
        const mark = document.createElement("button");
        mark.type = "button";
        mark.className = "latex-margin-mark";
        mark.textContent = "*";
        mark.setAttribute("aria-label", "Note");
        registerFootnoteSource(mark, a.stream);
        it = { note, mark, width: 0, def: null, undo: null, surface: null, edges: {} };
        M.items.set(a.id, it);
        M.layer.append(note, mark);
      }
      const at = a.anchor();
      it.note.hidden = !(wide && at);
      it.mark.hidden = !(!wide && at);
      if (!at) continue;
      const x = (at.left - br.left) / k, y = (at.top - br.top) / k;
      if (!wide) {
        it.mark.style.left = x + "px";
        it.mark.style.top = y + "px";
        continue;
      }
      it.note.style.left = el.offsetWidth + gap + "px";
      it.note.style.width = width + "px";
      draw(it, a, width, again);
      it.width = width;
      const edge = edgeOf(it, a, el);
      const baseline = edge && edge.el.isConnected ? (edge.el.getBoundingClientRect().top - it.note.getBoundingClientRect().top) / k + edge.metrics().firstBaseline : 0;
      placed.push({ note: it.note, top: y - baseline });
    }
    placed.sort((p, q) => p.top - q.top);
    let bottom = -Infinity, reach = 0;
    for (const p of placed) {
      const top = Math.max(p.top, bottom);
      p.note.style.top = top + "px";
      bottom = top + p.note.offsetHeight + 8;
      reach = Math.max(reach, top + p.note.offsetHeight);
    }
    el.style.paddingBottom = "";
    const over = reach - el.offsetHeight;
    el.style.paddingBottom = over > 0 ? Math.ceil(over) + "px" : "";
  }
  window.addEventListener("resize", () => {
    for (const d of allData) if (d.margin) placeMarginNotes(d);
  });
  onKindChange(() => {
    for (const d of allData) if (d.margin) placeMarginNotes(d);
  });

  // src/host/links.js
  var linkMap = {};
  var pageLabels = /* @__PURE__ */ new Set();
  var linkTargets = /* @__PURE__ */ new Map();
  var siteBase = document.currentScript && document.currentScript.src ? new URL(".", document.currentScript.src).href : typeof location !== "undefined" ? location.href : "/";
  function loadLinkMap() {
    const el = document.getElementById("latex-link-map");
    if (!el || !el.textContent.trim()) return;
    try {
      const d = JSON.parse(el.textContent);
      if (d && typeof d === "object") linkMap = d;
    } catch {
    }
  }
  function linkHref(link) {
    if (!link) return null;
    if (link.url) return link.url;
    const label = link.label;
    if (!label) return null;
    if (linkTargets.has(label) || pageLabels.has(label)) return "#" + label;
    const rel = linkMap[label];
    if (!rel) return null;
    try {
      return new URL(rel, siteBase).href;
    } catch {
      return rel;
    }
  }
  function setLinkState(key, cls, on) {
    if (!key) return;
    const els = document.querySelectorAll(`[data-link="${CSS.escape(key)}"]`);
    for (const el of els) el.classList.toggle(cls, on);
    drawLinkUnderline(key, els);
  }
  function drawLinkUnderline(key, els) {
    for (const old of document.querySelectorAll(".latex-link-underline")) old.remove();
    const hover = [...els].filter((el) => el.classList.contains("latex-link-hover") && !el.classList.contains("latex-link-hit"));
    if (!hover.length) return;
    const lines = [];
    for (const el of hover) {
      const svg = el.ownerSVGElement, ctm = el.getScreenCTM(), sctm = svg?.getScreenCTM();
      if (!svg || !ctm || !sctm) continue;
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      const inv = sctm.inverse();
      const at = (x, y) => new DOMPoint(x, y).matrixTransform(inv);
      const q = new DOMPoint(+el.getAttribute("x"), +el.getAttribute("y")).matrixTransform(ctm);
      const base = at(q.x, q.y).y;
      const left = at(r.left, r.top).x, right = at(r.right, r.top).x;
      const em = (+el.getAttribute("font-size") || 12) * Math.hypot(ctm.a, ctm.b) / Math.hypot(sctm.a, sctm.b);
      let line = lines.find((l) => l.svg === svg && Math.abs(l.base - base) < 0.6 * Math.max(l.em, em));
      if (!line) lines.push(line = { svg, base, left, right, em, colour: getComputedStyle(el).fill });
      line.base = Math.max(line.base, base);
      line.em = Math.max(line.em, em);
      line.left = Math.min(line.left, left);
      line.right = Math.max(line.right, right);
    }
    for (const l of lines) {
      const y = l.base + 0.13 * l.em;
      const u = svgEl("line", { x1: l.left, x2: l.right, y1: y, y2: y, "stroke-width": Math.max(0.065 * l.em, 1) });
      u.setAttribute("class", "latex-link-underline");
      u.style.cssText = `stroke:${l.colour};pointer-events:none`;
      l.svg.appendChild(u);
    }
  }
  var hot = null;
  var held = null;
  var linkRestoreQueued = false;
  var hotWidget = null;
  var heldWidget = null;
  function restoreLinkStates() {
    if (!hot && !held && !hotWidget && !heldWidget || linkRestoreQueued) return;
    linkRestoreQueued = true;
    queueMicrotask(() => {
      linkRestoreQueued = false;
      setLinkState(held, "latex-link-active", true);
      setLinkState(hot, "latex-link-hover", true);
      setWidgetState(heldWidget, "latex-widget-active", true);
      setWidgetState(hotWidget, "latex-widget-hover", true);
    });
  }
  function setWidgetState(key, cls, on) {
    if (!key) return;
    for (const el of document.querySelectorAll(`foreignObject[data-widget="${CSS.escape(key)}"]`))
      el.classList.toggle(cls, on);
  }
  function installWidgetStates() {
    const keyAt = (t) => t && t.closest ? t.closest("foreignObject[data-widget]")?.dataset.widget || null : null;
    document.addEventListener("pointerover", (e) => {
      const key = keyAt(e.target);
      if (key === hotWidget) return;
      setWidgetState(hotWidget, "latex-widget-hover", false);
      hotWidget = key;
      setWidgetState(hotWidget, "latex-widget-hover", true);
    }, { passive: true });
    document.addEventListener("pointerout", (e) => {
      if (keyAt(e.relatedTarget) === hotWidget) return;
      setWidgetState(hotWidget, "latex-widget-hover", false);
      hotWidget = null;
    }, { passive: true });
    document.addEventListener("pointerdown", (e) => {
      heldWidget = keyAt(e.target);
      setWidgetState(heldWidget, "latex-widget-active", true);
    }, { passive: true });
    const release = () => {
      setWidgetState(heldWidget, "latex-widget-active", false);
      heldWidget = null;
    };
    document.addEventListener("pointerup", release, { passive: true });
    document.addEventListener("pointercancel", release, { passive: true });
  }
  function installLinks() {
    loadLinkMap();
    const linkAt = (t) => t && t.closest ? t.closest("[data-link]") : null;
    document.addEventListener("pointerover", (e) => {
      const el = linkAt(e.target), key = el?.dataset.link || null;
      if (key === hot) return;
      setLinkState(hot, "latex-link-hover", false);
      hot = key;
      setLinkState(hot, "latex-link-hover", true);
    }, { passive: true });
    document.addEventListener("pointerout", (e) => {
      if (linkAt(e.relatedTarget)?.dataset.link === hot) return;
      setLinkState(hot, "latex-link-hover", false);
      hot = null;
    }, { passive: true });
    document.addEventListener("pointerdown", (e) => {
      held = linkAt(e.target)?.dataset.link || null;
      setLinkState(held, "latex-link-active", true);
    }, { passive: true });
    const release = () => {
      setLinkState(held, "latex-link-active", false);
      held = null;
    };
    document.addEventListener("pointerup", release, { passive: true });
    document.addEventListener("pointercancel", release, { passive: true });
    document.addEventListener("click", (e) => {
      const el = linkAt(e.target);
      if (el && el.dataset.linkAction) {
        e.preventDefault();
        dispatchAction(el, el.dataset.linkAction);
        return;
      }
      const href = el && el.dataset.linkHref;
      if (!href) return;
      e.preventDefault();
      const local = el.dataset.linkLabel && linkTargets.get(el.dataset.linkLabel);
      if (local) {
        local.scrollIntoView({ behavior: "smooth", block: "start" });
        history.pushState(null, "", href);
      } else {
        window.location.href = href;
      }
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const el = linkAt(e.target);
      if (!el) return;
      e.preventDefault();
      el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  }
  function registerLinkGlyph(el, id, cache) {
    const link = cache.links?.[id - 1];
    const action = link && link.action;
    const href = action ? null : linkHref(link);
    if (!href && !action) return;
    el.classList.add("latex-link");
    el.dataset.link = `${cache.blockKey}:${id}`;
    if (action) {
      el.classList.add("latex-action");
      el.dataset.linkAction = action;
    } else el.dataset.linkHref = href;
    if (link.label) el.dataset.linkLabel = link.label;
    if (!document.querySelector(`[data-link="${CSS.escape(el.dataset.link)}"]`)) {
      el.setAttribute("role", action ? "button" : "link");
      el.setAttribute("tabindex", "0");
    }
  }

  // src/runtime/colour.js
  function colorFill(c) {
    return `var(--latex-color-${c.slice(1)}, ${c})`;
  }
  var colorMapsInstalled = false;
  function installColorMaps() {
    if (colorMapsInstalled) return;
    colorMapsInstalled = true;
    const island = document.getElementById("latex-color-maps");
    let maps = {};
    if (island) {
      try {
        maps = JSON.parse(island.textContent);
      } catch (e) {
        console.error("[latex-viewer] malformed #latex-color-maps JSON", e);
      }
    }
    let css = ":root { --latex-color-ffffff: var(--latex-page-bg, Canvas); }\n";
    for (const [name, map] of Object.entries(maps)) {
      const sel = `.latex-block[data-color-map=${JSON.stringify(name)}]`;
      for (const [theme, entries] of Object.entries(map.colors ?? {})) {
        const decls = Object.entries(entries).map(([src, dst]) => `  --latex-color-${src.slice(1)}: ${dst};`);
        if (decls.length === 0) continue;
        const scoped = theme === "light" ? sel : `:root.${theme} ${sel}`;
        css += scoped + " {\n" + decls.join("\n") + "\n}\n";
      }
      const allSrc = /* @__PURE__ */ new Set();
      for (const entries of Object.values(map.colors ?? {})) for (const src of Object.keys(entries)) allSrc.add(src);
      if (allSrc.size) {
        const themes = /* @__PURE__ */ new Set(["light", ...Object.keys(map.colors ?? {})]);
        for (const theme of themes) {
          const entries = (map.colors ?? {})[theme] ?? {};
          const decls = [...allSrc].map((src) => `  --latex-color-${src.slice(1)}: ` + (entries[src] ?? (src === "#000000" ? "currentColor" : src)) + ";");
          css += `:root [data-latex-theme=${JSON.stringify(theme)}] ${sel} {
` + decls.join("\n") + "\n}\n";
        }
      }
      const tintDecls = Object.entries(map.tints ?? {}).map(([hex, [base, pct]]) => `  --latex-color-${hex.slice(1)}: color-mix(in srgb, var(--latex-color-${base.slice(1)}, ${base}) ${pct}%, var(--latex-page-bg, Canvas));`);
      if (tintDecls.length) css += sel + " {\n" + tintDecls.join("\n") + "\n}\n";
    }
    css += "html .latex-block svg text, html .latex-block svg tspan { fill: var(--latex-color-000000, currentColor); }\n";
    const s = document.createElement("style");
    s.textContent = css;
    document.head.appendChild(s);
    document.documentElement.setAttribute("data-latex-viewer", BUILD);
  }

  // src/runtime/visibility.js
  var observedBlocks = /* @__PURE__ */ new Set();
  var segRef = /* @__PURE__ */ new WeakMap();
  var segIO = new IntersectionObserver((entries) => {
    const painted = /* @__PURE__ */ new Set();
    for (const e of entries) {
      const ref = segRef.get(e.target);
      const s = ref && ref.cache.dom && ref.cache.dom.segs[ref.i];
      if (!s) continue;
      s.intersecting = e.isIntersecting;
      if (e.isIntersecting && (!s.painted || s.dirty)) {
        paintSegment(ref.cache.fontInfo, ref.cache, ref.i);
        const block = ref.cache.dom.root.closest("[data-nodelist-b64]");
        if (block) painted.add(block);
      }
    }
    for (const block of painted) announceLayout(block);
  }, { rootMargin: "100% 0px" });
  function observeSegments(cache) {
    const segs = cache.dom.segs;
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (s.observed || !s.svg) continue;
      segRef.set(s.svg, { cache, i });
      segIO.observe(s.svg);
      s.observed = true;
    }
  }
  function paintVisibleNow(fontInfo, cache) {
    if (!cache.dom) return 0;
    cache.stats = { created: 0, moved: 0, repositioned: 0, removed: 0 };
    const segs = cache.dom.segs;
    const vh = window.innerHeight || 800, M = vh;
    const todo = [], nested = [];
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (!s.svg) {
        if (s.sub) nested.push(s.sub);
        continue;
      }
      if (s.painted && !s.dirty) continue;
      if (!s.svg.getClientRects().length) continue;
      const r = s.svg.getBoundingClientRect();
      if (r.bottom > -M && r.top < vh + M) todo.push(i);
    }
    for (const i of todo) paintSegment(fontInfo, cache, i);
    let n = todo.length;
    for (const c of nested) n += paintVisibleNow(fontInfo, c);
    return n;
  }
  var vpScheduled = false;
  function scheduleViewportPaint() {
    if (vpScheduled) return;
    vpScheduled = true;
    requestAnimationFrame(() => {
      vpScheduled = false;
      for (const el of observedBlocks) {
        const data = blockData.get(el);
        if (data) paintVisibleNow(data.fontInfo, data.cache);
      }
    });
  }
  window.addEventListener("resize", scheduleViewportPaint, { passive: true });
  window.addEventListener("beforeprint", () => {
    for (const el of observedBlocks) {
      const data = blockData.get(el);
      if (data) paintDocument(data.fontInfo, data.cache);
    }
  });

  // src/host/slots.js
  var slotValues = /* @__PURE__ */ new Map();
  var slotBlocks = /* @__PURE__ */ new Set();
  var slotMeasure = null;
  var slotScheduled = false;
  function measureSlotText(fi, text) {
    slotMeasure = slotMeasure || document.createElement("canvas").getContext("2d");
    slotMeasure.font = `${fi.size_px}px ${JSON.stringify(fi.family)}`;
    return Math.round(slotMeasure.measureText(text).width / SP_TO_PX);
  }
  function slotNodes(fontInfo, slot, id, run, text) {
    const glyphs = [];
    const walk2 = (ns) => {
      for (const n of ns) {
        if (n.type === "glyph") glyphs.push(n);
        else if (n.type === "disc") walk2(n.replace || []);
      }
    };
    walk2(run);
    const t = glyphs[0];
    if (!t) return run;
    const fi = fontInfo[String(t.font)];
    if (!fi || fi.unresolved) return run;
    const height = Math.max(...glyphs.map(gH)), depth = Math.max(...glyphs.map(gD));
    const spec = `${fi.size_px}px ${JSON.stringify(fi.family)}`;
    if (document.fonts && !document.fonts.check(spec, text)) {
      document.fonts.load(spec, text).then(() => scheduleSlots(), () => {
      });
    }
    const out = [];
    for (const part of String(text).split(/([^\S\u00A0\u202F]+)/)) {
      if (!part) continue;
      if (/^[^\S\u00A0\u202F]+$/.test(part)) {
        out.push({
          type: "glue",
          subtype: 13,
          width: slot.space || 0,
          stretch: slot.stretch || 0,
          shrink: slot.shrink || 0,
          slot: id
        });
      } else {
        out.push({
          type: "glyph",
          text: part,
          font: t.font,
          color: t.color,
          slot: id,
          width: measureSlotText(fi, part),
          height,
          depth
        });
      }
    }
    return out;
  }
  function applySlots(fontInfo, doc) {
    const slots = doc.slots || [];
    if (!doc.slotParas) {
      doc.slotParas = [];
      (doc.paragraphs || []).forEach((para, i) => {
        if ((para.nodes || []).some((n) => n.slot)) doc.slotParas.push({ index: i + 1, para, orig: para.nodes, made: [] });
      });
    }
    useGlyphMetrics(doc.glyph_metrics);
    const changed2 = /* @__PURE__ */ new Set();
    for (const sp of doc.slotParas) {
      const orig = sp.orig, out = [], made = [];
      for (let i = 0; i < orig.length; i++) {
        const id = orig[i].slot, slot = id && slots[id - 1];
        const isWidget = slot && slot.kind === "widget";
        const text = slot && !isWidget ? textOf(doc, id, slot) : void 0;
        if (!slot || !isWidget && text === void 0) {
          out.push(orig[i]);
          continue;
        }
        let j = i;
        for (let k = i + 1; k < orig.length; k++) if (orig[k].slot === id) j = k;
        const run = orig.slice(i, j + 1);
        const nodes = isWidget ? widgetNodes(fontInfo, slot, id, run, orig.slice(0, i), orig.slice(j + 1), doc) : slotNodes(fontInfo, slot, id, run, text);
        if (!nodes) {
          out.push(orig[i]);
          continue;
        }
        out.push(...nodes);
        made.push(...nodes);
        i = j;
      }
      const key = made.map((n) => n.text !== void 0 ? n.text + "" + n.width : n.type === "wdisc" || n.type === "widget" ? "w" + JSON.stringify([n.slot, n.version ?? (n.run && n.run.version) ?? n.replace[0].version, n.width ?? n.replace[0].width, n.options && n.options.map((o) => [o.pre[0].width, o.post[0].width])]) : n.type === "disc" && n.slot ? "d" + JSON.stringify([n.slot, n.penalty, n.pre.map((x) => x.width), n.post.map((x) => x.width), n.replace.map((x) => x.width)]) : " ").join("");
      if (key === sp.key && sp.made.length === made.length) continue;
      sp.key = key;
      sp.stale = sp.made;
      sp.made = made;
      sp.para.nodes = made.length ? out : orig;
      changed2.add(sp.index);
    }
    return changed2;
  }
  function invalidateParagraphs(cache, changed2, stale) {
    if (!cache || !cache.dom || !cache.layoutCtx) return;
    for (const i of changed2) cache.bcs && cache.bcs.delete(i);
    for (const n of stale) {
      disposePiece(cache.dom.byNode.get(n));
      cache.dom.byNode.delete(n);
    }
    cache.layoutCtx.segs.forEach((seg, i) => {
      const s = cache.dom.segs[i];
      if (!s) return;
      if (s.sub) invalidateParagraphs(s.sub, changed2, stale);
      if (seg.items && seg.items.some((it) => changed2.has(it.index))) {
        s.hc = null;
        if (s.painted) s.dirty = true;
      }
    });
  }
  function refreshSlots(el) {
    const data = blockData.get(el);
    if (!data || !data.cache.dom) return;
    const changed2 = applySlots(data.fontInfo, data.doc);
    if (!changed2.size) return;
    const parts = (n) => n.type === "wdisc" ? [...n.replace, ...n.options.flatMap((o) => [...o.pre, ...o.post])] : n.run ? [...n.run.merged.values()] : [n];
    const stale = data.doc.slotParas.flatMap((sp) => (sp.stale || []).flatMap(parts));
    data.doc.slotParas.forEach((sp) => {
      sp.stale = null;
    });
    invalidateParagraphs(data.cache, changed2, stale);
    const params = { ...data.params, align: data.lastAlign };
    layoutDocument(data.fontInfo, data.doc, data.lastWidth, params, data.cache);
    paintVisibleNow(data.fontInfo, data.cache);
  }
  function scheduleSlots() {
    if (slotScheduled) return;
    slotScheduled = true;
    requestAnimationFrame(() => {
      slotScheduled = false;
      for (const el of slotBlocks) refreshSlots(el);
    });
  }
  var instanceTexts = /* @__PURE__ */ new Map();
  function setSlotText(name, text) {
    if (text === null || text === void 0) slotValues.delete(String(name));
    else slotValues.set(String(name), String(text));
    scheduleSlots();
  }
  textHooks.set = (id, text) => {
    if (text === null) instanceTexts.delete(id);
    else instanceTexts.set(id, text);
    scheduleSlots();
  };
  function textOf(doc, id, slot) {
    const key = ((docData.get(doc) || {}).cache || {}).blockKey;
    const own = key && instanceTexts.get(`${key}/t${id}`);
    return own !== void 0 && own !== null ? own : slotValues.get(slot.name);
  }

  // src/host/inline.ts
  var versions = /* @__PURE__ */ new Map();
  var inlineVersion = (instance) => versions.get(instance.id) || 0;
  function inlineOf(blockEl, index) {
    const block = blockEl && blockOf(blockEl);
    const instance = block && block.find(`${block.key}/w${index}`);
    const def = instance && kindDef(instance.kind);
    return instance && def && typeof def.measure === "function" ? { instance, def } : null;
  }
  function inlineEnv(instance, fontSize, color) {
    return {
      fontSize,
      color,
      measure(content) {
        if (typeof content !== "function") return measureHTML(content, fontSize);
        const el = document.createElement("span");
        content(el);
        return measureHTML(el, fontSize);
      },
      invalidate() {
        versions.set(instance.id, inlineVersion(instance) + 1);
        scheduleSlots();
      }
    };
  }
  var undo = /* @__PURE__ */ new WeakMap();
  var byCache = /* @__PURE__ */ new WeakMap();
  function renderPiece(n, el, box, cache) {
    const { instance, def, env } = n.inline;
    const host2 = { type: "piece", el: box, instance, piece: n.part, env };
    try {
      const u = def.render(instance, host2);
      if (typeof u === "function") {
        undo.set(el, u);
        let set = byCache.get(cache);
        if (!set) byCache.set(cache, set = /* @__PURE__ */ new Set());
        set.add(el);
      }
    } catch (e) {
      console.error(`[latex-viewer] kind "${instance.kind}": drawing a piece failed:`, e);
    }
  }
  function disposePiece(el) {
    const u = el && undo.get(el);
    if (!u) return;
    undo.delete(el);
    try {
      u();
    } catch (e) {
      console.error("[latex-viewer] ending a piece failed:", e);
    }
  }
  function disposePieces(cache) {
    if (!cache) return;
    for (const el of byCache.get(cache) || []) disposePiece(el);
    byCache.delete(cache);
    for (const s of cache.dom && cache.dom.segs || []) if (s.sub) disposePieces(s.sub);
  }
  onKindChange((kind) => {
    let any = false;
    for (const el of document.querySelectorAll("[data-nodelist-b64]")) {
      const block = blockOf(el);
      for (const i of block ? block.instances({ kind, placement: "inline" }) : []) {
        versions.set(i.id, inlineVersion(i) + 1);
        any = true;
      }
    }
    if (any) scheduleSlots();
  });

  // src/engine/paint.js
  function svgEl(tag, attrs) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
    return el;
  }
  function svgMatrixOf(n, x, y) {
    return { a: n.m_a ?? 1, b: -(n.m_b ?? 0), c: -(n.m_c ?? 0), d: n.m_d ?? 1, x, y };
  }
  function affineOf(t) {
    return [
      t.a,
      t.b,
      t.c,
      t.d,
      t.x - (t.a * t.x + t.c * t.y),
      t.y - (t.b * t.x + t.d * t.y)
    ];
  }
  function affineMul(m1, m2) {
    if (!m1) return m2;
    if (!m2) return m1;
    const [a1, b1, c1, d1, e1, f1] = m1, [a2, b2, c2, d2, e2, f2] = m2;
    return [
      a1 * a2 + c1 * b2,
      b1 * a2 + d1 * b2,
      a1 * c2 + c1 * d2,
      b1 * c2 + d1 * d2,
      a1 * e2 + c1 * f2 + e1,
      b1 * e2 + d1 * f2 + f1
    ];
  }
  function reconcileSink(byNode, used, stats, cache) {
    let textParent = null, auxParent = null, lastTspan = null, lastRect = null;
    const stack = [];
    const linkRuns = /* @__PURE__ */ new Map();
    function place(parent, last, el, isNew) {
      const expected = last ? last.nextSibling : parent.firstChild;
      if (el !== expected) {
        parent.insertBefore(el, expected);
        if (!isNew) stats.moved++;
      }
    }
    return {
      beginLine(textEl, auxEl) {
        textParent = textEl;
        auxParent = auxEl;
        lastTspan = null;
        lastRect = null;
      },
      // Rotated glyphs cannot go in the line's shared <text>: a tspan takes
      // no transform of its own (SVG 1.1), and x/y on a tspan would fight
      // the group's matrix anyway. So a transform gets its own <g> holding
      // its own <text>, and sits in the aux parent next to rules and
      // pictures. Nesting works because the parents are stacked.
      beginTransform(n, tf) {
        let g = byNode.get(n);
        const isNew = !g;
        if (isNew) {
          g = svgEl("g", {});
          const t = svgEl("text", {});
          t.style.cssText = "font-weight:normal;font-style:normal";
          g.appendChild(t);
          byNode.set(n, g);
          stats.created++;
        } else {
          stats.repositioned++;
        }
        const [a, b, c, d, e, f] = affineOf(tf);
        g.setAttribute("transform", `matrix(${a} ${b} ${c} ${d} ${e} ${f})`);
        place(auxParent, lastRect, g, isNew);
        used.add(g);
        lastRect = g;
        stack.push({ textParent, auxParent, lastTspan, lastRect });
        textParent = g.firstChild;
        auxParent = g;
        lastTspan = null;
        lastRect = g.firstChild;
      },
      endTransform() {
        const s = stack.pop();
        textParent = s.textParent;
        auxParent = s.auxParent;
        lastTspan = s.lastTspan;
        lastRect = s.lastRect;
      },
      glyph(n, x, y, fi) {
        if (fi?.unresolved) {
          this.missing(n, x, y);
          return;
        }
        let el = byNode.get(n), isNew = !el;
        if (isNew) {
          el = svgEl("tspan", { x, y, "font-family": fi?.family ?? "serif", "font-size": fi?.size_px ?? 12 });
          el.textContent = n.text !== void 0 ? n.text : String.fromCodePoint(n.char);
          if (n.color) el.style.fill = colorFill(n.color);
          if (n.stream) registerStreamSource(el, n.stream, cache);
          if (n.link) registerLinkGlyph(el, n.link, cache);
          if (n.slot && cache.slotNames && cache.slotNames[n.slot - 1] !== void 0)
            el.dataset.slot = cache.slotNames[n.slot - 1];
          byNode.set(n, el);
          stats.created++;
        } else {
          el.setAttribute("x", x);
          el.setAttribute("y", y);
          stats.repositioned++;
        }
        place(textParent, lastTspan, el, isNew);
        used.add(el);
        lastTspan = el;
        if (el.dataset.link && !stack.length) {
          const x1 = x + gW(n) * SP_TO_PX, top = y - gH(n) * SP_TO_PX, bottom = y + gD(n) * SP_TO_PX;
          const r = linkRuns.get(el.dataset.link);
          if (!r) linkRuns.set(el.dataset.link, { el, x0: x, x1, top, bottom });
          else {
            r.x0 = Math.min(r.x0, x);
            r.x1 = Math.max(r.x1, x1);
            r.top = Math.min(r.top, top);
            r.bottom = Math.max(r.bottom, bottom);
          }
        }
      },
      // The references' extents on the line just drawn; starts afresh.
      takeLinkRuns() {
        const runs = [...linkRuns.values()];
        linkRuns.clear();
        return runs;
      },
      // A glyph whose font could not be loaded: draw its TeX metric boxes – the
      // advance width by the height above the baseline, and by the depth below –
      // as two outlined rects, so the missing ink's place and size are visible.
      missing(n, x, y) {
        let el = byNode.get(n), isNew = !el;
        const w = gW(n) * SP_TO_PX;
        const h = gH(n) * SP_TO_PX;
        const d = gD(n) * SP_TO_PX;
        const boxes = [];
        if (h > 0) boxes.push([x, y - h, w, h]);
        if (d > 0) boxes.push([x, y, w, d]);
        if (isNew) {
          el = svgEl("g", { class: "latex-missing-glyph" });
          for (const [bx, by, bw, bh] of boxes) {
            const r = svgEl("rect", { x: bx, y: by, width: bw, height: bh });
            r.style.fill = "none";
            r.style.stroke = "var(--latex-color-ff0000, #cc0000)";
            r.style.strokeWidth = "1";
            r.style.opacity = "0.55";
            el.appendChild(r);
          }
          byNode.set(n, el);
          stats.created++;
        } else {
          const rects = el.children;
          boxes.forEach(([bx, by, bw, bh], i) => {
            rects[i].setAttribute("x", bx);
            rects[i].setAttribute("y", by);
            rects[i].setAttribute("width", bw);
            rects[i].setAttribute("height", bh);
          });
          stats.repositioned++;
        }
        place(auxParent, lastRect, el, isNew);
        used.add(el);
        lastRect = el;
      },
      space(n, x, y) {
        let el = byNode.get(n), isNew = !el;
        if (isNew) {
          el = svgEl("tspan", { x, y });
          el.textContent = " ";
          el.style.pointerEvents = "none";
          byNode.set(n, el);
          stats.created++;
        } else {
          el.setAttribute("x", x);
          el.setAttribute("y", y);
          stats.repositioned++;
        }
        place(textParent, lastTspan, el, isNew);
        used.add(el);
        lastTspan = el;
      },
      rule(n, x, y, w, h) {
        let el = byNode.get(n), isNew = !el;
        if (isNew) {
          el = svgEl("rect", { x, y, width: w, height: h });
          el.style.fill = n.color ? colorFill(n.color) : "var(--latex-color-000000, currentColor)";
          byNode.set(n, el);
          stats.created++;
        } else {
          el.setAttribute("x", x);
          el.setAttribute("y", y);
          el.setAttribute("width", w);
          el.setAttribute("height", h);
          stats.repositioned++;
        }
        place(auxParent, lastRect, el, isNew);
        used.add(el);
        lastRect = el;
      },
      // Where a \webaside stood (see Asides): an empty rect at the pen
      // position on the baseline, drawing nothing, for aside.anchor().
      aside(n, x, y) {
        let el = byNode.get(n), isNew = !el;
        if (isNew) {
          el = svgEl("rect", { x, y, width: 0, height: 0 });
          el.setAttribute("class", "latex-aside-mark");
          el.dataset.aside = n.aside;
          byNode.set(n, el);
          stats.created++;
        } else {
          el.setAttribute("x", x);
          el.setAttribute("y", y);
          stats.repositioned++;
        }
        place(auxParent, lastRect, el, isNew);
        used.add(el);
        lastRect = el;
      },
      // A widget part (see Widgets): HTML in a foreignObject over the part's
      // box, so it moves with the text on every reflow. Drawn by the widget
      // once, when the element is made: a new measurement makes new nodes.
      widget(n, x, y) {
        let el = byNode.get(n), isNew = !el;
        const h = n.height * SP_TO_PX, d = n.depth * SP_TO_PX, w = n.width * SP_TO_PX;
        if (isNew) {
          el = svgEl("foreignObject", { width: w, height: h + d });
          el.setAttribute("class", "latex-widget");
          el.dataset.widget = `${cache.blockKey}:${n.slot}`;
          el.style.overflow = "visible";
          el.style.pointerEvents = "auto";
          const box = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
          box.style.cssText = `width:${w}px;height:${h + d}px;font-size:${n.fontPx}px;line-height:normal;color:${n.color ? colorFill(n.color) : "currentColor"};display:flex;align-items:baseline;user-select:none;-webkit-user-select:none`;
          el.appendChild(box);
          renderPiece(n, el, box, cache);
          byNode.set(n, el);
          stats.created++;
        } else {
          stats.repositioned++;
        }
        el.setAttribute("x", x);
        el.setAttribute("y", y - h);
        place(auxParent, lastRect, el, isNew);
        used.add(el);
        lastRect = el;
      },
      // A precompiled TikZ box or included PDF page. Its markup never changes,
      // so reflowing is only a new transform – the drawing is built once.
      picture(n, x, y) {
        let el = byNode.get(n), isNew = !el;
        const pic = n.pic;
        if (isNew) {
          el = svgEl("g", { class: "latex-picture" });
          if (pic) el.innerHTML = pic.svg;
          el.setAttribute("fill", "var(--latex-color-000000, currentColor)");
          byNode.set(n, el);
          stats.created++;
        } else {
          stats.repositioned++;
        }
        const s = pic && pic.vb_w ? n.width * SP_TO_PX / pic.vb_w : 1;
        el.setAttribute(
          "transform",
          `translate(${x} ${y - n.height * SP_TO_PX}) scale(${s})`
        );
        place(auxParent, lastRect, el, isNew);
        used.add(el);
        lastRect = el;
      }
    };
  }
  var GLUE_CLEADERS = 101;
  var GLUE_XLEADERS = 102;
  function deepCloneNode(o) {
    if (Array.isArray(o)) return o.map(deepCloneNode);
    if (o && typeof o === "object") {
      const r = {};
      for (const k of Object.keys(o)) r[k] = deepCloneNode(o[k]);
      return r;
    }
    return o;
  }
  function leaderCopies(n, count) {
    if (!n._leaderCopies || n._leaderCopies.length !== count) {
      n._leaderCopies = [];
      for (let i = 0; i < count; i++) n._leaderCopies.push(deepCloneNode(n.leader));
    }
    return n._leaderCopies;
  }
  function renderLeaders(fontInfo, sink, n, x, baselineY, wSp) {
    const L = n.leader;
    if (!L || wSp <= 0) return;
    if (L.type === "rule") {
      const h = (L.height === RUNNING_RULE ? 0 : L.height ?? 0) * SP_TO_PX;
      const d = (L.depth === RUNNING_RULE ? 0 : L.depth ?? 0) * SP_TO_PX;
      if (h + d > 0) sink.rule(L, x, baselineY - h, wSp * SP_TO_PX, h + d);
      return;
    }
    const Lw = L.width ?? 0;
    if (Lw <= 0) return;
    const count = Math.floor(wSp / Lw);
    if (count < 1) return;
    const slack = wSp - count * Lw;
    let start, step = Lw;
    if (n.subtype === GLUE_XLEADERS) {
      const gap = slack / (count + 1);
      start = gap;
      step = Lw + gap;
    } else if (n.subtype === GLUE_CLEADERS) {
      start = slack / 2;
    } else {
      start = 0;
    }
    const copies = leaderCopies(n, count);
    for (let i = 0; i < count; i++) {
      renderNodes(fontInfo, sink, [copies[i]], x + (start + i * step) * SP_TO_PX, baselineY, 0, 0, 0);
    }
  }
  function renderVlistBody(fontInfo, sink, n, vlistX, refY) {
    const { ratio: vr, fillOrder: vfo } = vlistGlueRatio(n);
    const vlistW = n.width;
    let curY = refY - n.height * SP_TO_PX;
    for (const child of n.children) {
      const y0 = curY;
      if (child.type === "kern") {
        curY += child.kern * SP_TO_PX;
      } else if (child.type === "glue") {
        curY += setGlue(child, vr, vfo) * SP_TO_PX;
      } else if (child.type === "rule") {
        const rw = (child.width === RUNNING_RULE ? vlistW : child.width) * SP_TO_PX;
        const rh = (child.height + child.depth) * SP_TO_PX;
        sink.rule(child, vlistX, curY, rw, rh);
        curY += rh;
      } else if (child.type === "hlist") {
        const cb = curY + child.height * SP_TO_PX;
        const { ratio: hr, fillOrder: hfo } = hlistGlueRatio(child);
        renderNodes(fontInfo, sink, child.children, vlistX + (child.shift ?? 0) * SP_TO_PX, cb, hr, 0, hfo, child.height, child.depth);
        curY += (child.height + child.depth) * SP_TO_PX;
      } else if (child.type === "vlist") {
        renderVlistBody(fontInfo, sink, child, vlistX + (child.shift ?? 0) * SP_TO_PX, curY + child.height * SP_TO_PX);
        curY += (child.height + child.depth) * SP_TO_PX;
      }
      if (sink.vnode) sink.vnode(child, vlistX, y0, curY - y0);
    }
  }
  function renderNodes(fontInfo, sink, nodes, x, baselineY, ratio, expandRatio, fillOrder, runH, runD) {
    ratio = ratio || 0;
    expandRatio = expandRatio || 0;
    fillOrder = fillOrder || 0;
    runH = runH || 0;
    runD = runD || 0;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i], x0 = x;
      switch (n.type) {
        case "rule": {
          const w = n.width === RUNNING_RULE ? 0 : n.width ?? 0;
          const h = n.height === RUNNING_RULE ? runH : n.height ?? 0;
          const d = n.depth === RUNNING_RULE ? runD : n.depth ?? 0;
          const hp = h * SP_TO_PX, dp = d * SP_TO_PX;
          if (w > 0 && hp + dp > 0) sink.rule(n, x, baselineY - hp, w * SP_TO_PX, hp + dp);
          x += w * SP_TO_PX;
          break;
        }
        case "glyph": {
          sink.glyph(n, x, baselineY, fontInfo[String(n.font)]);
          x += gW(n) * glyphExpandScale(fontInfo, n, expandRatio) * SP_TO_PX;
          break;
        }
        case "glue": {
          let w = n.width;
          if (ratio > 0 && (n.stretch_order || 0) === fillOrder && n.stretch) w += ratio * n.stretch;
          else if (ratio < 0 && (n.shrink_order || 0) === fillOrder && n.shrink) w += ratio * n.shrink;
          if (n.leader) renderLeaders(fontInfo, sink, n, x, baselineY, w);
          if (n.subtype === 13) sink.space(n, x, baselineY);
          if (sink.gap) sink.gap(n, "width", x, w * SP_TO_PX);
          x += w * SP_TO_PX;
          break;
        }
        case "kern": {
          const w = n.kern * ((n.subtype || 0) === 0 ? kernExpandScale(fontInfo, nodes[i - 1], nodes[i + 1], expandRatio) : 1) * SP_TO_PX;
          if (sink.gap) sink.gap(n, "kern", x, w);
          x += w;
          break;
        }
        case "picture": {
          sink.picture(n, x, baselineY);
          x += n.width * SP_TO_PX;
          break;
        }
        case "transform": {
          sink.beginTransform(n, svgMatrixOf(n, x, baselineY));
          x = renderNodes(fontInfo, sink, n.children, x, baselineY, ratio, expandRatio, fillOrder, runH, runD);
          sink.endTransform();
          break;
        }
        case "disc":
          x = renderNodes(fontInfo, sink, n.replace, x, baselineY, 0, expandRatio, 0, runH, runD);
          break;
        case "wdisc":
          x = renderNodes(fontInfo, sink, n.replace, x, baselineY, 0, 0, 0, runH, runD);
          break;
        case "widget":
          if (sink.widget) sink.widget(n, x, baselineY);
          x += n.width * SP_TO_PX;
          break;
        case "math": {
          const w = n.surround * SP_TO_PX;
          if (sink.gap) sink.gap(n, "surround", x, w);
          x += w;
          break;
        }
        case "hlist": {
          if (n.aside && sink.aside) sink.aside(n, x, baselineY);
          const { ratio: hr, fillOrder: hfo } = hlistGlueRatio(n);
          renderNodes(fontInfo, sink, n.children, x, baselineY + (n.shift ?? 0) * SP_TO_PX, hr, 0, hfo, n.height, n.depth);
          x += n.width * SP_TO_PX;
          break;
        }
        case "vlist":
          renderVlistBody(fontInfo, sink, n, x, baselineY + (n.shift ?? 0) * SP_TO_PX);
          x += n.width * SP_TO_PX;
          break;
      }
      if (sink.node) sink.node(n, x0, baselineY, x - x0);
    }
    return x;
  }
  var paintCount = 0;
  function paintSegment(fontInfo, cache, i) {
    paintCount++;
    restoreLinkStates();
    materializeSegment(cache, i);
    useGlyphMetrics(cache.metrics);
    const dom = cache.dom;
    const L = cache.layout.laid[i];
    const s = dom.segs[i];
    const stats = cache.stats || (cache.stats = { created: 0, moved: 0, repositioned: 0, removed: 0 });
    const used = /* @__PURE__ */ new Set();
    const sink = reconcileSink(dom.byNode, used, stats, cache);
    const linkRuns = [];
    while (s.pairs.length < L.lines.length) {
      const g = svgEl("g", { "aria-hidden": "true", style: "user-select:none;pointer-events:none" });
      const text = svgEl("text", {});
      text.style.cssText = "font-weight:normal;font-style:normal";
      s.pairs.push({ g, text, attached: false });
    }
    for (let j = 0; j < s.pairs.length; j++) {
      const pair = s.pairs[j];
      if (j < L.lines.length && !pair.attached) {
        s.svg.appendChild(pair.g);
        s.svg.appendChild(pair.text);
        pair.attached = true;
      } else if (j >= L.lines.length && pair.attached) {
        pair.g.remove();
        pair.text.remove();
        pair.attached = false;
      }
    }
    for (let j = 0; j < L.lines.length; j++) {
      const { ratio, er, x0, fillRatio, fillOrder } = L.lrp[j];
      sink.beginLine(s.pairs[j].text, s.pairs[j].g);
      renderNodes(
        fontInfo,
        sink,
        L.lines[j].nodes,
        x0,
        L.baselineYs[j],
        fillOrder ? fillRatio : ratio,
        er,
        fillOrder || 0
      );
      linkRuns.push(...sink.takeLinkRuns());
    }
    paintLinkHits(s, linkRuns);
    if (s.live) {
      for (const el of s.live) if (!used.has(el)) {
        el.remove();
        stats.removed++;
      }
    }
    s.live = used;
    s.painted = true;
    s.dirty = false;
    if (s.wrap && s.svg.parentNode === s.wrap) {
      updateDisplayOverflowCue(s.wrap);
    }
  }
  function paintLinkHits(s, runs) {
    if (!runs.length && !s.hits) return;
    if (!s.hits) {
      s.hits = svgEl("g", { "aria-hidden": "true" });
      s.svg.insertBefore(s.hits, s.svg.firstChild);
    }
    s.hits.replaceChildren(...runs.map((r) => {
      const rect = svgEl("rect", {
        x: r.x0,
        y: r.top,
        width: Math.max(0, r.x1 - r.x0),
        height: Math.max(0, r.bottom - r.top)
      });
      rect.setAttribute("class", "latex-link-hit");
      for (const k of ["link", "linkHref", "linkLabel", "linkAction"])
        if (r.el.dataset[k] !== void 0) rect.dataset[k] = r.el.dataset[k];
      rect.style.cssText = "fill:transparent;cursor:pointer";
      return rect;
    }));
  }
  function paintDocument(fontInfo, cache) {
    if (!cache.layout) return;
    cache.stats = { created: 0, moved: 0, repositioned: 0, removed: 0 };
    for (let i = 0; i < cache.layout.laid.length; i++) {
      const s = cache.dom.segs[i];
      if (!s.svg) {
        if (s.sub) paintDocument(fontInfo, s.sub);
        continue;
      }
      paintSegment(fontInfo, cache, i);
    }
  }

  // src/runtime/params.js
  function alignFromEl(el) {
    const css = getComputedStyle(el).getPropertyValue("--latex-align").trim();
    return css || el.dataset.align || DEFAULT_ALIGN;
  }
  function paramsFromEl(el) {
    const d = el.dataset;
    const num2 = (key, def) => key in d ? parseFloat(d[key]) : def;
    const bool = (key, def) => key in d ? d[key] !== "false" : def;
    return {
      linePenalty: num2("linePenalty", DEFAULT_LINE_PENALTY),
      adjDemerits: num2("adjDemerits", DEFAULT_ADJ_DEMERITS),
      doubleHyphenDemerits: num2("doubleHyphenDemerits", DEFAULT_DOUBLE_HYPHEN_DEMERITS),
      finalHyphenDemerits: num2("finalHyphenDemerits", DEFAULT_FINAL_HYPHEN_DEMERITS),
      pretolerance: num2("pretolerance", DEFAULT_PRETOLERANCE),
      tolerance: num2("tolerance", DEFAULT_TOLERANCE),
      tolerance2: num2("tolerance2", DEFAULT_TOLERANCE_2),
      emergencyTolerance: num2("emergencyTolerance", DEFAULT_EMERGENCY_TOLERANCE),
      lastLineMin: num2("lastLineMin", DEFAULT_LAST_LINE_MIN),
      lastLinePenalty: num2("lastLinePenalty", DEFAULT_LAST_LINE_PENALTY),
      maxExpand: num2("maxExpand", DEFAULT_MAX_EXPAND),
      maxShrink: num2("maxShrink", DEFAULT_MAX_SHRINK),
      minGapPt: num2("minGap", DEFAULT_MIN_GAP),
      padPt: num2("pad", DEFAULT_PAD),
      displayMinSpacePt: num2("displayMinSpace", DEFAULT_DISPLAY_MIN_SPACE),
      displayOverflowTolerancePx: num2("displayOverflowTolerance", DEFAULT_DISPLAY_OVERFLOW_TOLERANCE),
      useProtrusion: bool("protrusion", DEFAULT_USE_PROTRUSION),
      useExpansion: bool("expansion", DEFAULT_USE_EXPANSION),
      // true: TeX's final pass unless it sets an overfull line; 'strict':
      // TeX's, overfull lines too; false: the viewer's fallbacks (see kpBreak)
      texFinalPass: "texFinalPass" in d ? d.texFinalPass === "strict" ? "strict" : d.texFinalPass !== "false" : true,
      align: alignFromEl(el)
    };
  }

  // src/runtime/settle.js
  var SETTLE_MS = 150;
  var unsettled = /* @__PURE__ */ new Set();
  var settleTimer = 0;
  function scheduleSettle(el) {
    unsettled.add(el);
    clearTimeout(settleTimer);
    settleTimer = setTimeout(settleAll, SETTLE_MS);
  }
  function settleAll() {
    settleTimer = 0;
    const els = [...unsettled].filter((el) => el.isConnected);
    unsettled.clear();
    if (!els.length) return;
    const t0 = performance.now();
    const scroller = scrollerOf(els[0]);
    const viewTop = scroller === document.scrollingElement ? 0 : scroller.getBoundingClientRect().top;
    let anchor = null;
    for (const el of els) {
      const data = blockData.get(el);
      const a = data && firstSegmentOnScreen(data.cache, viewTop);
      if (a && (!anchor || a.top < anchor.top)) anchor = a;
    }
    const restore = holdScrollAnchoring(scroller);
    for (const el of els) settleBlock(el);
    if (anchor) {
      const d = anchor.el.getBoundingClientRect().top - anchor.top;
      if (d) scroller.scrollTop += d;
    }
    requestAnimationFrame(restore);
    debugLog(`[latex-viewer] settled ${els.length} block(s) in ${(performance.now() - t0).toFixed(1)} ms`);
  }
  function settleBlock(el) {
    const data = blockData.get(el);
    if (!data || !data.cache.layout) return;
    const params = { ...data.params, align: data.lastAlign };
    layoutDocument(data.fontInfo, data.doc, data.lastWidth, params, data.cache);
    paintVisibleNow(data.fontInfo, data.cache);
  }
  function firstSegmentOnScreen(cache, viewTop) {
    if (!cache.dom) return null;
    for (const s of cache.dom.segs) {
      if (!s.box.getClientRects().length) continue;
      const r = s.box.getBoundingClientRect();
      if (r.bottom <= viewTop) continue;
      if (r.top >= viewTop + (window.innerHeight || 800)) return null;
      return s.sub && firstSegmentOnScreen(s.sub, viewTop) || { el: s.box, top: r.top };
    }
    return null;
  }
  function scrollerOf(el) {
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY;
      if ((oy === "auto" || oy === "scroll" || oy === "overlay") && p.scrollHeight > p.clientHeight) return p;
    }
    return document.scrollingElement || document.documentElement;
  }
  function holdScrollAnchoring(scroller) {
    const els = scroller === document.scrollingElement ? [document.documentElement, document.body] : [scroller];
    const was = els.map((e) => e.style.overflowAnchor);
    for (const e of els) e.style.overflowAnchor = "none";
    return () => els.forEach((e, k) => {
      e.style.overflowAnchor = was[k];
    });
  }

  // src/runtime/blocks.js
  var blockData = /* @__PURE__ */ new WeakMap();
  var quickLayout = false;
  var NATURAL_PROBE_PT = 5e3;
  function naturalWidthPt(el, fontInfo, cache, probePt) {
    paintDocument(fontInfo, cache);
    const root = el.firstElementChild;
    if (!root) return probePt;
    const left = root.getBoundingClientRect().left;
    let right = 0;
    for (const svg of root.querySelectorAll("svg")) {
      const ctm = svg.getScreenCTM();
      if (!ctm || !ctm.a) continue;
      const inv = ctm.inverse(), at = (svg.getBoundingClientRect().left - left) / ctm.a;
      for (const e of svg.querySelectorAll("text, foreignObject"))
        right = Math.max(right, at + new DOMPoint(e.getBoundingClientRect().right, 0).matrixTransform(inv).x);
    }
    return right ? right / ZOOM + 0.5 : probePt;
  }
  function reflowBlock(el, quick = false) {
    const data = blockData.get(el);
    if (!data) return false;
    if (el.clientWidth === 0 && !el.dataset.latexWidth) return false;
    const newWidth = data.naturalPt || (el.dataset.latexWidth ? parseInt(el.dataset.latexWidth) : el.clientWidth / ZOOM || DEFAULT_WIDTH_PT);
    const newAlign = alignFromEl(el);
    if (Math.abs(newWidth - data.lastWidth) < 0.5 && newAlign === data.lastAlign) return false;
    data.lastWidth = newWidth;
    data.lastAlign = newAlign;
    const params = { ...data.params, align: newAlign };
    const t0 = performance.now();
    quickLayout = quick && !!data.cache.layout;
    let root;
    try {
      root = layoutDocument(data.fontInfo, data.doc, newWidth, params, data.cache);
      if (root !== el.firstElementChild) el.replaceChildren(root);
      remeasureStreams(data.fontInfo, data.doc, newWidth, params, data.cache);
    } finally {
      if (quickLayout) scheduleSettle(el);
      quickLayout = false;
    }
    markDirty(data.cache);
    const tp = performance.now();
    const repainted = paintVisibleNow(data.fontInfo, data.cache);
    const st = data.cache.stats || {};
    const ls = data.cache.layoutStats || {};
    debugLog(`[latex-viewer] re-render at ${newWidth.toFixed(0)}pt: layout ${(tp - t0).toFixed(1)} ms, paint ${(performance.now() - tp).toFixed(1)} ms (${repainted} visible segment(s); ${st.repositioned || 0} repositioned, ${st.created || 0} created; segments: ${ls.computed || 0} laid out, ${ls.reused || 0} reused, ${ls.deferred || 0} deferred to scroll)`);
    announceLayout(el);
    return true;
  }
  function rerenderBlock(el) {
    const data = blockData.get(el);
    if (!data) return;
    unobserveAll(data.cache);
    disposePieces(data.cache);
    data.cache.dom = null;
    data.cache.layout = null;
    const params = { ...data.params, align: data.lastAlign };
    el.replaceChildren(layoutDocument(data.fontInfo, data.doc, data.lastWidth, params, data.cache));
    remeasureStreams(data.fontInfo, data.doc, data.lastWidth, params, data.cache);
    paintVisibleNow(data.fontInfo, data.cache);
    rerenderSurfaces(el);
    announceLayout(el);
  }
  function markDirty(cache) {
    if (!cache.dom) return;
    for (const s of cache.dom.segs) {
      if (s.painted) s.dirty = true;
      if (s.sub) markDirty(s.sub);
    }
  }
  function unobserveAll(cache) {
    if (!cache.dom) return;
    for (const s of cache.dom.segs) {
      if (s.svg) segIO.unobserve(s.svg);
      if (s.sub) unobserveAll(s.sub);
    }
  }
  function remeasureStreams(fontInfo, doc, widthPt, params, cache) {
    if (!cache.streamsUnmeasured) return;
    cache.streamsUnmeasured = false;
    layoutDocument(fontInfo, doc, widthPt, params, cache);
  }
  var fontRepaintScheduled = false;
  function scheduleFontRepaint() {
    if (fontRepaintScheduled) return;
    fontRepaintScheduled = true;
    requestAnimationFrame(() => {
      fontRepaintScheduled = false;
      for (const el of observedBlocks) rerenderBlock(el);
      if (document.fonts && document.fonts.status === "loaded" && document.fonts.removeEventListener) {
        document.fonts.removeEventListener("loadingdone", scheduleFontRepaint);
      }
    });
  }
  var roPending = /* @__PURE__ */ new Set();
  var roScheduled = false;
  var ro = new ResizeObserver((entries) => {
    for (const entry of entries) roPending.add(entry.target);
    if (roScheduled) return;
    roScheduled = true;
    requestAnimationFrame(() => {
      roScheduled = false;
      const els = [...roPending];
      roPending.clear();
      for (const el of els) reflowBlock(el, true);
    });
  });

  // src/runtime/block-data.js
  var docData = /* @__PURE__ */ new WeakMap();
  var allData = [];
  function announceLayout(el) {
    placeMarginNotes(blockData.get(el));
    el.dispatchEvent(new CustomEvent("reflowtex:layout", { bubbles: true, detail: { block: el } }));
  }

  // src/host/widgets.js
  var widgetMeasure = /* @__PURE__ */ new Map();
  function measureHTML(html, fontPx) {
    const probe = document.createElement("div");
    probe.style.cssText = `position:absolute;left:-10000px;top:0;visibility:hidden;white-space:nowrap;font-size:${fontPx}px;line-height:normal`;
    const mark = document.createElement("span");
    mark.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
    const body = document.createElement("span");
    body.style.cssText = "display:inline-block;vertical-align:baseline";
    if (typeof html === "string") body.innerHTML = html;
    else body.appendChild(html);
    probe.append(mark, body);
    document.body.appendChild(probe);
    const base = mark.getBoundingClientRect().top;
    const rs = [...body.children].map((c) => c.getBoundingClientRect());
    const r = rs.length ? {
      left: Math.min(...rs.map((x) => x.left)),
      right: Math.max(...rs.map((x) => x.right)),
      top: Math.min(...rs.map((x) => x.top)),
      bottom: Math.max(...rs.map((x) => x.bottom))
    } : body.getBoundingClientRect();
    probe.remove();
    return { width: r.right - r.left, height: Math.max(0, base - r.top), depth: Math.max(0, r.bottom - base) };
  }
  function widgetNodes(fontInfo, slot, id, run, before, after, doc) {
    const found = inlineOf((docData.get(doc) || {}).el, id);
    if (!found) return null;
    const { instance, def } = found;
    const glyph = (ns) => {
      for (const n of ns) {
        if (n.type === "glyph") return n;
        if (n.type === "disc") {
          const g = glyph(n.replace || []);
          if (g) return g;
        }
      }
      return null;
    };
    const t = glyph(run) || glyph([...before].reverse()) || glyph(after);
    const fi = t && fontInfo[String(t.font)];
    const fontPx = fi ? fi.size_px : 20;
    const version = inlineVersion(instance);
    const env = inlineEnv(instance, fontPx, t && t.color ? colorFill(t.color) : null);
    const inline = { instance, def, env };
    const key = `${fontPx}|${version}`, kept = widgetMeasure.get(instance.id);
    let m = kept && kept.key === key ? kept.m : null;
    if (!m) {
      try {
        m = def.measure(instance, env);
      } catch (e) {
        console.error(`[latex-viewer] kind "${instance.kind}": measure failed:`, e);
        return null;
      }
      if (!m) return null;
      widgetMeasure.set(instance.id, { key, m });
    }
    const sp = (v) => Math.round((+v || 0) / SP_TO_PX);
    const part = (dims, which) => ({
      type: "widget",
      slot: id,
      part: which,
      inline,
      fontPx,
      color: t && t.color,
      width: sp(dims.width),
      height: sp(dims.height),
      depth: sp(dims.depth),
      version
    });
    if (m.segments && m.segments.length) return widgetSegmentNodes(m, slot, id, inline, fontPx, t, version, sp);
    const whole = part(m, "whole");
    if (!m.splits || !m.splits.length) return [whole];
    const hang = (o) => o && +o.overhang ? [{ type: "kern", subtype: 1, kern: -sp(o.overhang) }] : [];
    return [{
      type: "wdisc",
      slot: id,
      replace: [whole],
      options: m.splits.map((s, i) => ({
        penalty: s.penalty ?? 100,
        pre: [part(s.first, { split: i, piece: "first" }), ...hang(s.first)],
        post: [...hang(s.second), part(s.second, { split: i, piece: "second" })]
      }))
    }];
  }
  function widgetSegmentNodes(m, slot, id, inline, fontPx, t, version, sp) {
    const segs = m.segments, gaps = m.gaps || [];
    const H = Math.max(...segs.map((g) => sp(g.height))), D = Math.max(...segs.map((g) => sp(g.depth)));
    const run = { slot: id, inline, fontPx, color: t && t.color, version, merged: /* @__PURE__ */ new Map(), height: H, depth: D };
    const piece = (role, w, seg) => ({ type: "widget", run, role, seg, width: sp(w), height: H, depth: D });
    const ends = m.ends || {};
    const L = ends.left || {}, R = ends.right || {};
    const hang = (e) => e && +e.overhang ? [{ type: "kern", subtype: 1, kern: -sp(e.overhang) }] : [];
    const out = [piece("capL", L.cap || 0, 0)];
    segs.forEach((g, i) => {
      out.push(piece("seg", g.width, i));
      if (i < segs.length - 1) {
        const gap = gaps[i] || {};
        out.push({
          type: "disc",
          penalty: gap.penalty ?? 100,
          slot: id,
          replace: gap.width ? [piece("gap", gap.width, i)] : [],
          pre: [piece("cutR", R.cut || 0, i), ...hang(R)],
          post: [...hang(L), piece("cutL", L.cut || 0, i + 1)]
        });
      }
    });
    out.push(piece("capR", R.cap || 0, segs.length - 1));
    return out;
  }
  function mergeWidgetRuns(nodes) {
    if (!nodes.some((n) => n.type === "widget" && n.run || n.type === "disc" && n.slot)) return nodes;
    nodes = nodes.flatMap((n) => n.type === "disc" && n.slot ? n.replace : [n]);
    const out = [];
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (!(n.type === "widget" && n.run)) {
        out.push(n);
        continue;
      }
      let j = i, w = 0;
      while (j < nodes.length && nodes[j].type === "widget" && nodes[j].run === n.run) {
        w += nodes[j].width;
        j++;
      }
      const run = nodes.slice(i, j), segs = run.filter((x) => x.role === "seg").map((x) => x.seg);
      const part = {
        from: segs.length ? Math.min(...segs) : run[0].seg,
        to: segs.length ? Math.max(...segs) : run[0].seg,
        left: run[0].role === "cutL" ? "cut" : "cap",
        right: run[run.length - 1].role === "cutR" ? "cut" : "cap"
      };
      const key = `${part.from}|${part.to}|${part.left}|${part.right}|${w}`;
      let merged = n.run.merged.get(key);
      if (!merged) {
        merged = {
          type: "widget",
          slot: n.run.slot,
          part,
          inline: n.run.inline,
          fontPx: n.run.fontPx,
          color: n.run.color,
          version: n.run.version,
          width: w,
          height: n.run.height,
          depth: n.run.depth
        };
        n.run.merged.set(key, merged);
      }
      out.push(merged);
      i = j - 1;
    }
    return out;
  }

  // src/engine/layout/text.js
  function contentStream(doc) {
    if (doc.content && doc.content.length) return doc.content;
    return doc.paragraphs.map((_, i) => ({ kind: "paragraph", para: i + 1 }));
  }
  var HL_ALIGNMENT = 4;
  var HL_EQUATION = 6;
  var anchorIdsCache = /* @__PURE__ */ new WeakMap();
  function anchorIdsOf(key, roots) {
    let ids = anchorIdsCache.get(key);
    if (ids) return ids;
    ids = [];
    (function walk2(ns) {
      for (const n of ns || []) {
        if (n.anchor) ids.push(n.anchor);
        walk2(n.children);
        walk2(n.pre);
        walk2(n.post);
        walk2(n.replace);
        if (n.leader) walk2([n.leader]);
      }
    })(roots);
    anchorIdsCache.set(key, ids);
    return ids;
  }
  var figureParaCache = /* @__PURE__ */ new WeakMap();
  function isFigureParagraph(para) {
    let v = figureParaCache.get(para);
    if (v !== void 0) return v;
    let hasPicture = false, hasGlyph = false;
    (function walk2(ns) {
      for (const n of ns || []) {
        if (n.type === "picture") hasPicture = true;
        else if (n.type === "glyph") hasGlyph = true;
        walk2(n.children);
        walk2(n.pre);
        walk2(n.post);
        walk2(n.replace);
        if (n.leader) walk2([n.leader]);
      }
    })(para.nodes);
    const top = para.nodes || [];
    const boxOnly = !top.some((n) => n.type === "glyph" || n.type === "disc") && top.some((n) => (n.type === "hlist" || n.type === "vlist") && (n.width || 0) > 0 && (n.children || []).length);
    v = hasPicture && !hasGlyph || boxOnly;
    figureParaCache.set(para, v);
    return v;
  }
  function segmentsOf(doc) {
    const segs = [];
    const pendingAnchors = [];
    const own = (seg, ids) => {
      if (ids.length) (seg.anchors ||= []).push(...ids);
    };
    let text = null, gap = 0, vsp = null;
    for (const item of contentStream(doc)) {
      if (item.kind === "vspace") {
        gap = (item.amount || 0) * SP_TO_PX;
        vsp = item;
        continue;
      }
      if (item.kind === "anchorpoint") {
        const owner = segs[segs.length - 1];
        if (owner) (owner.anchors ||= []).push(item.anchor);
        else pendingAnchors.push(item.anchor);
        continue;
      }
      if (item.kind === "stream") {
        const stream = doc.streams && doc.streams[item.stream - 1];
        if (stream) {
          segs.push({ kind: "stream", stream, index: item.stream, gapBefore: gap, vspace: vsp });
          text = null;
          gap = 0;
          vsp = null;
        }
        continue;
      }
      if (item.kind === "display") {
        const isAlign = item.box.subtype === HL_ALIGNMENT;
        const last = segs[segs.length - 1];
        if (isAlign && last && last.kind === "display" && last.isAlign) {
          last.rows.push({ item, gap, vspace: vsp });
        } else {
          segs.push({ kind: "display", isAlign, rows: [{ item, gap: 0 }], gapBefore: gap, vspace: vsp });
        }
        own(segs[segs.length - 1], anchorIdsOf(item.box, item.box.children));
        text = null;
        gap = 0;
        vsp = null;
        continue;
      }
      const para = doc.paragraphs[item.para - 1];
      if (!para) continue;
      if (isFigureParagraph(para)) {
        const fig = {
          kind: "text",
          isFigure: true,
          items: [{ index: item.para, para }],
          gapBefore: gap,
          vspace: vsp
        };
        segs.push(fig);
        own(fig, anchorIdsOf(para, para.nodes));
        text = null;
        gap = 0;
        vsp = null;
        continue;
      }
      if (!text || gap) {
        text = { kind: "text", items: [], gapBefore: gap, vspace: vsp };
        segs.push(text);
        vsp = null;
      }
      text.items.push({ index: item.para, para, vspace: vsp });
      own(text, anchorIdsOf(para, para.nodes));
      gap = 0;
      vsp = null;
    }
    if (pendingAnchors.length && segs.length) own(segs[0], pendingAnchors);
    segs.trailingGap = gap;
    return segs;
  }
  var paraEval = /* @__PURE__ */ new WeakMap();
  function nodesHaveRates(ns) {
    for (const n of ns || []) {
      for (const k in n) if (k.endsWith("_rate")) return true;
      if (nodesHaveRates(n.children) || nodesHaveRates(n.pre) || nodesHaveRates(n.post) || nodesHaveRates(n.replace) || n.leader && nodesHaveRates([n.leader])) return true;
    }
    return false;
  }
  function paragraphFloorWidth(n, sourceWidthSp) {
    let minimum = 0;
    for (const field of ["width", "kern", "surround"]) {
      const rate = n[`${field}_rate`];
      if (n[`${field}_floor`] && rate > 0) minimum = Math.max(minimum, sourceWidthSp - (n[field] || 0) / rate);
    }
    if (n.glue_set_floor && n.glue_set_rate > 0)
      minimum = Math.max(minimum, sourceWidthSp - (n.glue_set || 0) / n.glue_set_rate);
    for (const key of AFFINE_CHILD_LISTS)
      for (const c of n[key] || []) minimum = Math.max(minimum, paragraphFloorWidth(c, sourceWidthSp));
    if (n.leader) minimum = Math.max(minimum, paragraphFloorWidth(n.leader, sourceWidthSp));
    return Math.min(minimum, sourceWidthSp);
  }
  function paragraphAtWidth(para, widthSp, sourceWidthSp) {
    if (!(sourceWidthSp > 0)) return para.nodes;
    let memo = paraEval.get(para);
    if (!memo) {
      memo = { rated: nodesHaveRates(para.nodes) };
      paraEval.set(para, memo);
    }
    if (!memo.rated) return para.nodes;
    const box = { type: "hlist", children: para.nodes };
    if (memo.floorSp === void 0) memo.floorSp = paragraphFloorWidth(box, sourceWidthSp);
    const deltaSp = Math.max(widthSp, memo.floorSp) - sourceWidthSp;
    if (memo.deltaSp !== deltaSp) {
      memo.deltaSp = deltaSp;
      memo.nodes = affineDisplayNode(box, deltaSp).children || para.nodes;
    }
    return memo.nodes;
  }
  function layoutTextSegment(fontInfo, seg, widthPt, p, cache) {
    const widthSp = Math.round(widthPt * 65536);
    const columnPx = widthPt * ZOOM;
    const lines = [], lrp = [], meta = [];
    const itemStarts = [];
    let maxRightPx = columnPx;
    for (const { index, para } of seg.items) {
      itemStarts.push(lines.length);
      const nodes = paragraphAtWidth(para, widthSp, cache.sourceWidthSp);
      let bcs = nodes === para.nodes ? cache.bcs.get(index) : null;
      if (!bcs) {
        bcs = buildBreakCandidates(nodes, fontInfo, para);
        if (nodes === para.nodes) cache.bcs.set(index, bcs);
      }
      const align = para.align || p.align;
      const justify = align === "justify";
      const lineMeta = para.baselineskip ? {
        bskip: para.baselineskip * SP_TO_PX,
        lskip: (para.lineskip || 0) * SP_TO_PX,
        lskiplimit: (para.lineskiplimit || 0) * SP_TO_PX
      } : null;
      const indentSp = para.indent || 0;
      const indentPx = indentSp * SP_TO_PX;
      const rightSp = cache.sourceWidthSp > 0 && para.width > 0 ? Math.max(0, cache.sourceWidthSp - indentSp - para.width) : 0;
      const availSp = Math.max(
        1,
        widthSp - indentSp - rightSp,
        seg.isFigure ? sumWidthSp(nodes) : 0
      );
      const availPx = columnPx - indentPx - rightSp * SP_TO_PX;
      const ext = typeof window !== "undefined" && typeof window.reflowtexBreak === "function" ? window.reflowtexBreak(nodes, availSp, p, {
        gW,
        gH,
        gD,
        align,
        bskip: para.baselineskip || 0,
        lskip: para.lineskip || 0,
        font: (fid) => fontInfo[String(fid)] || null,
        adjustSpacing: para.adjust_spacing || 0,
        protrudeChars: para.protrude_chars || 0
      }) : null;
      for (const ln of ext || kpBreak(bcs, nodes, availSp, justify ? p : { ...p, ragged: true })) {
        ln.nodes = mergeWidgetRuns(ln.nodes);
        const ratio = justify ? ln.ratio : Math.min(0, ln.ratio);
        const er = ln.expand !== void 0 ? ln.expand : p.useExpansion && !ln.exact ? ratio * p.maxExpand : 0;
        const protX = -(p.useProtrusion ? ln.leftProtrusion * SP_TO_PX : 0);
        const natSp = sumWidthSp(ln.nodes);
        const natPx = natSp * SP_TO_PX;
        let x0, fillRatio = 0, fillOrder = 0;
        if (ratio < 0 || natPx > availPx) {
          x0 = protX;
        } else {
          const lpPx = -protX;
          const rpPx = p.useProtrusion ? (ln.rightProtrusion || 0) * SP_TO_PX : 0;
          switch (align) {
            case "right":
              x0 = availPx - natPx + rpPx;
              break;
            case "center":
              x0 = (availPx - natPx + lpPx + rpPx) / 2 - lpPx;
              break;
            default:
              x0 = protX;
              break;
          }
          const fi = fillInfo(ln.nodes);
          if (fi.order > 0 && fi.stretch > 0) {
            const leftKernSp = p.useProtrusion ? ln.leftProtrusion || 0 : 0;
            const slackSp = availSp - (natSp - leftKernSp);
            if (slackSp > 0) {
              fillRatio = slackSp / fi.stretch;
              fillOrder = fi.order;
              x0 = protX;
            }
          }
        }
        maxRightPx = Math.max(maxRightPx, x0 + indentPx + natPx);
        lines.push(ln);
        lrp.push({ ratio, er, x0: x0 + indentPx, fillRatio, fillOrder });
        meta.push(lineMeta);
      }
    }
    return {
      lines,
      lrp,
      meta,
      itemStarts,
      W: Math.ceil(maxRightPx),
      preDisplaySizeSp: preDisplaySizeSp(fontInfo, lines, lrp)
    };
  }

  // src/engine/layout/display.js
  function inkExtentOf(fontInfo, box) {
    let min = Infinity, max = -Infinity;
    let M = null;
    const stack = [];
    const note = (x, w, yTop, yBot) => {
      if (!M) {
        if (x < min) min = x;
        if (x + w > max) max = x + w;
        return;
      }
      const [a, b, c, d, e, f] = M;
      for (const [px, py] of [[x, yTop], [x + w, yTop], [x, yBot], [x + w, yBot]]) {
        const tx = a * px + c * py + e;
        if (tx < min) min = tx;
        if (tx > max) max = tx;
      }
    };
    renderNodes(fontInfo, {
      beginLine() {
      },
      beginTransform(n, tf) {
        stack.push(M);
        M = affineMul(M, affineOf(tf));
      },
      endTransform() {
        M = stack.pop();
      },
      glyph(n, x, y) {
        note(x, gW(n) * SP_TO_PX, y - gH(n) * SP_TO_PX, y + gD(n) * SP_TO_PX);
      },
      space() {
      },
      // inter-word glue is not ink
      rule(n, x, y, w, h) {
        note(x, w, y, y + h);
      },
      picture(n, x, y) {
        note(x, n.width * SP_TO_PX, y - n.height * SP_TO_PX, y + n.depth * SP_TO_PX);
      }
    }, [box], 0, 0, 0, 0, 0);
    return isFinite(min) ? { min, max } : { min: 0, max: 0 };
  }
  var AFFINE_NODE_FIELDS = [
    "width",
    "height",
    "depth",
    "stretch",
    "shrink",
    "kern",
    "shift",
    "glue_set",
    "surround",
    "m_a",
    "m_b",
    "m_c",
    "m_d"
  ];
  var AFFINE_CHILD_LISTS = ["children", "pre", "post", "replace"];
  function affineDisplayNode(n, deltaSp) {
    let out = n, changed2 = false;
    const edit = () => {
      if (!changed2) {
        out = { ...n };
        Object.defineProperty(out, "affineSource", { value: n.affineSource || n });
        changed2 = true;
      }
    };
    for (const field of AFFINE_NODE_FIELDS) {
      const rate = n[`${field}_rate`];
      if (rate !== void 0) {
        edit();
        out[field] = (n[field] || 0) + rate * deltaSp;
      }
    }
    for (const key of AFFINE_CHILD_LISTS) {
      if (!n[key]?.length) continue;
      const children = n[key].map((child) => affineDisplayNode(child, deltaSp));
      if (children.some((child, i) => child !== n[key][i])) {
        edit();
        out[key] = children;
      }
    }
    if (n.leader) {
      const leader = affineDisplayNode(n.leader, deltaSp);
      if (leader !== n.leader) {
        edit();
        out.leader = leader;
      }
    }
    return out;
  }
  function affineDisplayItem(item, deltaSp) {
    const out = { ...item, box: affineDisplayNode(item.box, deltaSp) };
    for (const field of ["display_width", "display_indent", "display_shift"]) {
      const rate = item[`${field}_rate`];
      if (rate !== void 0) out[field] = (item[field] || 0) + rate * deltaSp;
    }
    return out;
  }
  var displayGapKinds = /* @__PURE__ */ new WeakMap();
  function classifyDisplayGaps(fontInfo, item) {
    const cached = displayGapKinds.get(item);
    if (cached) return cached;
    const kinds2 = /* @__PURE__ */ new Map();
    const gaps = [];
    let inkMin = Infinity, inkMax = -Infinity;
    const ink = (x, w) => {
      if (x < inkMin) inkMin = x;
      if (x + w > inkMax) inkMax = x + w;
    };
    renderNodes(fontInfo, {
      beginLine() {
      },
      // A gap's kind is about horizontal neighbours, and a transform's children
      // advance the pen untransformed (see renderNodes), so the plain pen
      // positions are the ones to compare. No matrix bookkeeping is needed.
      beginTransform() {
      },
      endTransform() {
      },
      glyph(n, x) {
        ink(x, gW(n) * SP_TO_PX);
      },
      space() {
      },
      // Zero-width rules never reach this sink (renderNodes skips them), so a
      // strut – which is exactly that – correctly does not count as ink.
      rule(n, x, y, w) {
        ink(x, w);
      },
      picture(n, x) {
        ink(x, n.width * SP_TO_PX);
      },
      gap(n, field, x, w) {
        if (n[`${field}_floor`]) gaps.push({ n, field, x1: x, x2: x + w });
      }
    }, [item.box], 0, 0, 0, 0, 0);
    const ABUT = SP_TO_PX;
    for (const g of gaps) {
      const internal = inkMin <= g.x1 + ABUT && inkMax >= g.x2 - ABUT;
      let fields = kinds2.get(g.n);
      if (!fields) kinds2.set(g.n, fields = {});
      fields[g.field] = internal;
    }
    displayGapKinds.set(item, kinds2);
    return kinds2;
  }
  function affineFloorWidthNode(n, sourceWidthSp, floorSp, kinds2) {
    let minimum = 0;
    const fields = kinds2.get(n);
    if (fields) {
      for (const field of ["width", "kern", "surround"]) {
        const rate = n[`${field}_rate`];
        if (fields[field] === void 0 || !(rate > 0)) continue;
        const floor = fields[field] ? floorSp : 0;
        minimum = Math.max(
          minimum,
          sourceWidthSp + (floor - (n[field] || 0)) / rate
        );
      }
    }
    for (const key of AFFINE_CHILD_LISTS) {
      for (const child of n[key] || []) {
        minimum = Math.max(minimum, affineFloorWidthNode(child, sourceWidthSp, floorSp, kinds2));
      }
    }
    if (n.leader) minimum = Math.max(minimum, affineFloorWidthNode(n.leader, sourceWidthSp, floorSp, kinds2));
    return minimum;
  }
  function affineFloorWidthItem(fontInfo, item, sourceWidthSp, floorSp) {
    const kinds2 = classifyDisplayGaps(fontInfo, item);
    let minimum = affineFloorWidthNode(item.box, sourceWidthSp, floorSp, kinds2);
    if (item.display_shift_floor && item.display_shift_rate > 0) {
      minimum = Math.max(
        minimum,
        sourceWidthSp - (item.display_shift || 0) / item.display_shift_rate
      );
    }
    return Math.min(minimum, sourceWidthSp);
  }
  function preDisplaySizeSp(fontInfo, lines, lrp) {
    const k = lines.length - 1;
    if (k < 0) return null;
    const ln = lines[k], L = lrp[k];
    const MAX = 1073741823;
    let x = L.x0, w = null, unknown = false, mathOn = false, font = null, anyFont = null;
    const found = () => {
      w = unknown ? MAX : x;
    };
    const walk2 = (ns, glueSet) => {
      for (let i = 0; i < ns.length; i++) {
        const n = ns[i];
        switch (n.type) {
          case "glyph":
            x += gW(n) * glyphExpandScale(fontInfo, n, L.er) * SP_TO_PX;
            found();
            if (!mathOn) font = n.font;
            anyFont = n.font;
            break;
          case "hlist":
          case "vlist":
          case "picture":
            x += (n.width ?? 0) * SP_TO_PX;
            found();
            break;
          case "rule":
            x += (n.width === RUNNING_RULE ? 0 : n.width ?? 0) * SP_TO_PX;
            found();
            break;
          case "glue": {
            let g = n.width;
            const so = n.stretch_order || 0, sho = n.shrink_order || 0;
            if (glueSet) {
              if (L.ratio > 0 && !so && n.stretch) {
                g += L.ratio * n.stretch;
                unknown = true;
              } else if (L.ratio < 0 && !sho && n.shrink) {
                g += L.ratio * n.shrink;
                unknown = true;
              } else if (L.fillRatio > 0 && so === L.fillOrder && n.stretch) unknown = true;
            }
            x += g * SP_TO_PX;
            if (n.leader) found();
            break;
          }
          case "kern":
            x += n.kern * ((n.subtype || 0) === 0 ? kernExpandScale(fontInfo, ns[i - 1], ns[i + 1], L.er) : 1) * SP_TO_PX;
            break;
          case "math":
            x += (n.surround || 0) * SP_TO_PX;
            mathOn = n.subtype === 0;
            break;
          case "disc":
            walk2(n.replace || [], false);
            break;
        }
      }
    };
    walk2(ln.nodes, true);
    const fi = fontInfo[String(font ?? anyFont)];
    return { w: w === null ? -MAX : w === MAX ? MAX : Math.round(w / SP_TO_PX), quad: fi && fi.quad || 0 };
  }
  function displaySkipsFull(L, prev) {
    const rows = L.seg.rows;
    const item = rows && rows[0] && rows[0].item;
    if (!item || item.display_above === void 0 || item.display_above === null) return null;
    if (item.box && item.box.subtype === HL_ALIGNMENT) return true;
    if (!item.box || item.box.subtype !== HL_EQUATION) return null;
    if (L.atSourceWidth && item.display_used_above != null) return item.display_used_above === item.display_above;
    const MAX = 1073741823;
    const captured = item.display_pre_size ?? 0;
    const pre = prev && prev.preDisplaySizeSp;
    let pds = captured;
    if (item.display_after_line && captured > -MAX && pre) {
      pds = Math.abs(pre.w) === MAX ? pre.w : pre.w + 2 * (item.display_quad || pre.quad);
    }
    const left = L.displayLeftSp ?? (item.display_shift || 0);
    return left <= pds;
  }
  function displaySkipAdjust(L, prev) {
    let delta = 0;
    if (L.seg.kind === "display") {
      const full = displaySkipsFull(L, prev);
      L.displayFull = full;
      if (full !== null) {
        const it = L.seg.rows[0].item;
        delta += ((full ? it.display_above : it.display_above_short) - (it.display_used_above || 0)) * SP_TO_PX;
        const meta = it.display_baselineskip != null ? {
          bskip: it.display_baselineskip * SP_TO_PX,
          lskip: (it.display_lineskip || 0) * SP_TO_PX,
          lskiplimit: (it.display_lineskiplimit || 0) * SP_TO_PX
        } : prev && prev.firstMeta;
        if (it.display_interline_above != null && prev && meta && L.firstAscent != null) {
          const blankLine = !it.display_after_line && it.display_pre_size !== -1073741823;
          const depthAbove = blankLine ? 0 : prev.lastDepth;
          delta += texInterlineGlue(depthAbove, L.firstAscent, meta) - it.display_interline_above * SP_TO_PX;
        }
      }
    }
    if (prev && prev.seg.kind === "display" && prev.displayFull !== null && prev.displayFull !== void 0) {
      const it = prev.seg.rows[prev.seg.rows.length - 1].item;
      const floor = it.display_after_min || 0;
      const below = Math.max(prev.displayFull ? it.display_below : it.display_below_short, floor);
      delta += (below - Math.max(it.display_used_below || 0, floor)) * SP_TO_PX;
      if (it.display_interline_below != null && L.firstMeta && L.firstAscent != null) {
        delta += texInterlineGlue(prev.lastDepth, L.firstAscent, L.firstMeta) - it.display_interline_below * SP_TO_PX;
      }
    }
    return delta;
  }
  function placeEquationNumber(item) {
    const b = item.box;
    if (!b || b.subtype !== HL_EQUATION || !b.children || b.children.length !== 4) return item;
    const [k0, f0, k1, num2] = b.children;
    if (k0.type !== "kern" || f0.type !== "hlist" || k1.type !== "kern" || num2.type !== "hlist" || num2.subtype !== 7) return item;
    const z = item.display_width || 0, e = num2.width || 0;
    if (!(z > 0) || !(e > 0)) return item;
    let f = f0, w = 0;
    const shrink = [0, 0, 0, 0];
    for (const n of f0.children || []) {
      w += nodeWidthSp(n);
      if (n.type === "glue") shrink[n.shrink_order || 0] += n.shrink || 0;
    }
    const q = e + (item.display_quad || 0);
    if (w + q > z) {
      const order = shrink[3] ? 3 : shrink[2] ? 2 : shrink[1] ? 1 : 0;
      if (!(order > 0) && w - shrink[0] + q > z) return item;
      const target = z - q;
      f = {
        ...f0,
        width: target,
        glue_sign: 2,
        glue_order: order,
        glue_set: shrink[order] > 0 ? Math.min(order > 0 ? Infinity : 1, (w - target) / shrink[order]) : 0
      };
      w = target;
    } else if (f0.glue_sign || Math.abs((f0.width || 0) - w) > 2) {
      f = { ...f0, width: w, glue_sign: 0, glue_order: 0, glue_set: 0 };
    }
    let d = Math.round((z - w) / 2);
    if (d < 2 * e) {
      d = Math.round((z - w - e) / 2);
      const first = f.children && f.children[0];
      if (first && first.type === "glue") d = 0;
    }
    const children = [{ ...k0, kern: d }, f, { ...k1, kern: z - w - e - d }, num2];
    return { ...item, box: { ...b, children } };
  }
  function displayForm(item, targetSp, sourceWidthSp) {
    if (item.display_wide && item.display_wide_from && targetSp >= item.display_wide_from)
      return { item: item.display_wide, anchorSp: item.display_wide_width || sourceWidthSp };
    return { item, anchorSp: sourceWidthSp };
  }
  function layoutDisplaySegment(fontInfo, seg, widthPt, displayModel) {
    const targetSp = Math.round(widthPt * 65536);
    const floorSp = Math.max(0, displayModel.minSpacePt) * 65536;
    const forms = seg.rows.map((r) => displayForm(r.item, targetSp, displayModel.sourceWidthSp));
    const minWidthSp = Math.max(0, ...forms.map((f) => affineFloorWidthItem(fontInfo, f.item, f.anchorSp, floorSp)));
    const evaluatedSp = Math.max(targetSp, minWidthSp);
    const kinds2 = forms.map((f) => classifyDisplayGaps(fontInfo, f.item));
    seg = { ...seg, rows: seg.rows.map((r, i) => ({
      ...r,
      item: placeEquationNumber(affineDisplayItem(forms[i].item, evaluatedSp - forms[i].anchorSp))
    })) };
    const columnPx = widthPt * ZOOM;
    const rows = seg.rows.map((r) => ({
      ...r,
      x0: (r.item.display_shift || 0) * SP_TO_PX,
      ink: inkExtentOf(fontInfo, r.item.box)
    }));
    let right = Math.max(columnPx, evaluatedSp * SP_TO_PX);
    for (const r of rows) right = Math.max(right, r.x0 + r.ink.max);
    return {
      lines: rows.map((r) => ({ nodes: [r.item.box], ratio: 0, fitness: 2, leftProtrusion: 0 })),
      lrp: rows.map((r) => ({ ratio: 0, er: 0, x0: r.x0 })),
      gaps: rows.map((r) => r.gap || null),
      W: Math.ceil(right),
      // the display's left edge at this width, for displaySkipsFull: the
      // shift plus the kern LuaTeX opens a numbered formula's box with
      displayLeftSp: (rows[0].item.display_shift || 0) + ((c) => c && c.type === "kern" ? c.kern || 0 : 0)((rows[0].item.box.children || [])[0]),
      atSourceWidth: Math.abs(evaluatedSp - displayModel.sourceWidthSp) < 32768,
      // How the width model was applied, for api.inspect: the measure TeX
      // compiled at, the one asked for, the narrowest the gaps allow, and
      // the one evaluated at (the larger); each row's gap kinds, and each
      // row's item as evaluated (its display_width and indent at this width).
      affine: {
        sourceWidthSp: displayModel.sourceWidthSp,
        targetSp,
        minWidthSp,
        evaluatedSp,
        floorSp,
        kinds: kinds2,
        items: seg.rows.map((r) => r.item)
      }
    };
  }
  function updateDisplayOverflowCue(wrap) {
    const EPS = 1;
    wrap.classList.toggle("latex-overflow-left", wrap.scrollLeft > EPS);
    wrap.classList.toggle(
      "latex-overflow-right",
      wrap.scrollLeft + wrap.clientWidth < wrap.scrollWidth - EPS
    );
  }

  // src/host/block-hosts.ts
  var records = /* @__PURE__ */ new Set();
  var byBox = /* @__PURE__ */ new WeakMap();
  var pending = /* @__PURE__ */ new Set();
  var frame = 0;
  function relayoutSoon(owner) {
    if (!owner.relayout) return;
    pending.add(owner.relayout);
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const fns = [...pending];
      pending.clear();
      for (const fn of fns) fn();
    });
  }
  function currentEdges(rec) {
    if (rec.edges) return { top: rec.edges.top ?? null, bottom: rec.edges.bottom ?? null };
    const body = rec.instance.part("body");
    let found = null;
    for (const s of surfacesOf(rec.instance.block.el)) {
      if (s.part === body && !s.isDisposed && rec.box.contains(s.el)) {
        found = s;
        break;
      }
    }
    return { top: found, bottom: found };
  }
  function edgeValues(rec) {
    const { top, bottom } = currentEdges(rec);
    const t = top && !top.isDisposed ? top.edges() : null;
    const b = bottom && !bottom.isDisposed ? bottom.edges() : null;
    return {
      firstAscent: t ? t.firstAscent : 0,
      firstMeta: t ? t.firstMeta : null,
      textFirst: !!(t && t.textFirst),
      lastDepth: b ? b.lastDepth : 0,
      textLast: !!(b && b.textLast)
    };
  }
  var sameEdges = (a, b) => !!a && a.firstAscent === b.firstAscent && a.lastDepth === b.lastDepth && a.firstMeta === b.firstMeta && a.textFirst === b.textFirst && a.textLast === b.textLast;
  function surfaceChanged(s) {
    for (let el = s.el; el; el = el.parentElement) {
      const rec = byBox.get(el);
      if (!rec) continue;
      if (rec.laid && !sameEdges(rec.laid, edgeValues(rec))) relayoutSoon(rec.owner);
      return;
    }
  }
  function disposeHosts(cache) {
    for (const rec of [...records]) if (rec.owner.hosts === cache.hosts) dispose(rec);
  }
  function dispose(rec) {
    records.delete(rec);
    rec.owner.hosts?.delete(rec.index);
    if (rec.undo) {
      try {
        rec.undo();
      } catch (e) {
        console.error(`[latex-viewer] kind "${rec.kind}": undoing render failed:`, e);
      }
    }
    rec.undo = null;
  }
  function makeRecord(box, index, instance, def, owner) {
    const rec = {
      box,
      index,
      instance,
      kind: instance.kind,
      def,
      owner,
      undo: null,
      laid: null,
      failed: false,
      frame: { top: false, bottom: false },
      edges: null
    };
    rec.host = {
      type: "block",
      el: box,
      instance,
      setFrame(f) {
        const next = { top: !!f.top, bottom: !!f.bottom };
        if (next.top === rec.frame.top && next.bottom === rec.frame.bottom) return;
        rec.frame = next;
        if (rec.laid) relayoutSoon(owner);
      },
      spacing() {
        const segs = owner.dom && owner.dom.segs || [];
        const i = segs.findIndex((sg) => sg.box === box);
        const px = (el) => el && parseFloat(el.style.height) || 0;
        return { before: i >= 0 ? px(segs[i].gap) : 0, after: i >= 0 && i + 1 < segs.length ? px(segs[i + 1].gap) : 0 };
      },
      setEdges(e) {
        rec.edges = { ...rec.edges || {}, ...e };
        if (rec.laid && !sameEdges(rec.laid, edgeValues(rec))) relayoutSoon(owner);
      }
    };
    return rec;
  }
  function keptHostBox(cache, index) {
    const rec = cache.hosts && cache.hosts.get(index);
    return rec && !rec.failed ? rec.box : null;
  }
  function layoutHostedSegment(s, seg, widthPt, cache) {
    const def = kindDef(seg.stream.kind || "");
    if (!def || !cache.blockEl) return null;
    const hosts = cache.hosts || (cache.hosts = /* @__PURE__ */ new Map());
    let rec = hosts.get(seg.index);
    if (rec && rec.failed) return null;
    if (!rec) {
      const block = blockOf(cache.blockEl);
      const instance = block && block.find(`${block.key}/s${seg.index}`);
      if (!instance) return null;
      rec = makeRecord(s.box, seg.index, instance, def, cache);
      hosts.set(seg.index, rec);
      records.add(rec);
      byBox.set(s.box, rec);
      try {
        const undo2 = def.render(instance, rec.host);
        rec.undo = typeof undo2 === "function" ? undo2 : null;
      } catch (e) {
        console.error(`[latex-viewer] kind "${rec.kind}": render failed, drawn by default:`, e);
        rec.failed = true;
        records.delete(rec);
        s.box.replaceChildren();
        return null;
      }
    }
    const E = rec.laid = edgeValues(rec);
    const fa = E.textFirst ? `${E.firstAscent}px` : "var(--latex-cap-height, 0px)";
    const ld = E.textLast ? `${E.lastDepth}px` : "0px";
    if (s.box.style.getPropertyValue("--latex-first-ascent") !== fa) s.box.style.setProperty("--latex-first-ascent", fa);
    if (s.box.style.getPropertyValue("--latex-last-depth") !== ld) s.box.style.setProperty("--latex-last-depth", ld);
    return {
      seg,
      lines: [],
      H: s.box.offsetHeight,
      W: widthPt * ZOOM,
      firstAscent: E.firstAscent,
      lastDepth: E.lastDepth,
      firstMeta: E.firstMeta,
      alts: null,
      frameTop: rec.frame.top,
      frameBottom: rec.frame.bottom,
      gapBefore: seg.gapBefore || 0
    };
  }
  function redraw(kind) {
    for (const rec of [...records]) if (rec.kind === kind) dispose(rec);
    for (const el of document.querySelectorAll("[data-nodelist-b64]")) {
      const block = blockOf(el);
      if (block && blockData.get(el) && block.instances({ kind, placement: "block" }).length) rerenderBlock(el);
    }
  }
  onKindChange(redraw);

  // src/engine/layout/stream.js
  function layoutStreamSegment(fontInfo, doc, s, seg, widthPt, p, cache) {
    const hosted = layoutHostedSegment(s, seg, widthPt, cache);
    if (hosted) return hosted;
    if (!s.sub) {
      s.sub = {
        bcs: cache.bcs,
        dom: null,
        layout: null,
        stats: null,
        hosts: cache.hosts,
        blockEl: cache.blockEl,
        relayout: cache.relayout
      };
    }
    let innerPx = 0, frameTop = false, frameBottom = false;
    if (s.box.isConnected) {
      const cs = getComputedStyle(s.box);
      innerPx = s.box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      frameTop = parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth) > 0;
      frameBottom = parseFloat(cs.paddingBottom) + parseFloat(cs.borderBottomWidth) > 0;
    }
    let w = widthPt;
    if (innerPx > 0) w = innerPx / ZOOM;
    else cache.streamsUnmeasured = true;
    const root = layoutDocument(fontInfo, { ...doc, content: seg.stream.content }, w, p, s.sub);
    if (root.parentNode !== s.box) s.box.replaceChildren(root);
    const laid = s.sub.layout.laid;
    const first = laid[0];
    const last = laid[laid.length - 1];
    const textAt = (L) => L && L.seg && L.seg.kind === "text";
    const fa = textAt(first) ? `${first.firstAscent}px` : "var(--latex-cap-height, 0px)";
    const ld = textAt(last) ? `${last.lastDepth}px` : "0px";
    if (s.box.style.getPropertyValue("--latex-first-ascent") !== fa) s.box.style.setProperty("--latex-first-ascent", fa);
    if (s.box.style.getPropertyValue("--latex-last-depth") !== ld) s.box.style.setProperty("--latex-last-depth", ld);
    return {
      seg,
      lines: [],
      H: root.offsetHeight,
      W: widthPt * ZOOM,
      firstAscent: first ? first.firstAscent : 0,
      lastDepth: last ? last.lastDepth : 0,
      firstMeta: first ? first.firstMeta : null,
      frameTop,
      frameBottom,
      gapBefore: seg.gapBefore || 0
    };
  }

  // src/engine/layout/document.js
  var blockSeq = 0;
  var isTextLike = (kind) => kind === "text" || kind === "stream";
  var onLayoutGrid = (px) => Math.round(px * 64) / 64;
  function onGridCarried(px, carry) {
    const exact = px + carry;
    const r = onLayoutGrid(exact);
    return { r, carry: exact - r };
  }
  function spaceAbove(L, prev) {
    let margin = L.gapBefore || 0;
    if (prev && L.seg.kind === "text" && isTextLike(prev.seg.kind) && L.firstMeta && !(prev.frameBottom && L.gapBefore)) {
      margin += texInterlineGlue(prev.lastDepth, L.firstAscent, L.firstMeta);
    }
    return margin + displaySkipAdjust(L, prev);
  }
  function sizeSegment(s, L, prev, columnPx, p) {
    if (L.seg.kind === "stream") {
      let margin2 = L.gapBefore || 0;
      const framed = L.frameTop || prev?.frameBottom;
      if (prev && isTextLike(prev.seg.kind) && L.firstMeta && !(framed && L.gapBefore)) {
        margin2 += texInterlineGlue(prev.lastDepth, L.firstAscent, L.firstMeta);
      }
      margin2 += displaySkipAdjust(L, prev);
      const g = onGridCarried(margin2, prev?.gridCarry || 0);
      setStyle(s.gap, "height", `${g.r}px`);
      L.gridCarry = g.carry;
      return { mount: s.box.firstElementChild, overflows: false };
    }
    const tolerancePx = Math.max(0, p.displayOverflowTolerancePx || 0);
    const scrollable = L.seg.kind === "display" || L.seg.isFigure;
    const overflows = scrollable && L.W > columnPx + tolerancePx;
    const surfaceW = overflows ? L.W : columnPx;
    const margin = spaceAbove(L, prev);
    const gap = onGridCarried(margin, prev?.gridCarry || 0);
    const box = onGridCarried(L.H, gap.carry);
    const H = box.r;
    L.gridCarry = box.carry;
    if (!L.held) {
      s.svg.setAttribute("width", surfaceW);
      s.svg.setAttribute("height", H);
      s.svg.setAttribute("viewBox", `0 0 ${surfaceW} ${H}`);
    }
    setStyle(s.box, "overflowX", L.held ? "clip" : "");
    let mount = s.svg;
    if (overflows) {
      if (!s.wrap) {
        s.wrap = document.createElement("div");
        s.wrap.addEventListener(
          "scroll",
          () => updateDisplayOverflowCue(s.wrap),
          { passive: true }
        );
      }
      s.wrap.classList.add("latex-display", "latex-overflow-right");
      if (s.svg.parentNode !== s.wrap) s.wrap.replaceChildren(s.svg);
      mount = s.wrap;
    } else if (s.wrap && s.svg.parentNode === s.wrap) {
      s.wrap.classList.remove("latex-overflow-left", "latex-overflow-right");
      s.svg.remove();
    }
    setStyle(s.gap, "height", `${gap.r}px`);
    setStyle(s.svg, "marginTop", "");
    if (s.wrap) {
      setStyle(s.wrap, "marginTop", "");
      setStyle(s.wrap, "marginBottom", "");
    }
    if (mount === s.wrap) {
      const BLEED_PAD = 6;
      setStyle(mount, "paddingTop", `${BLEED_PAD}px`);
      setStyle(mount, "paddingBottom", `${BLEED_PAD}px`);
      setStyle(mount, "marginTop", `${-BLEED_PAD}px`);
      setStyle(mount, "marginBottom", `${-BLEED_PAD}px`);
      setStyle(mount, "overflowAnchor", "none");
    } else {
      setStyle(mount, "marginTop", "");
    }
    return { mount, overflows };
  }
  var newBlockKey = () => `b${++blockSeq}`;
  function layoutDocument(fontInfo, doc, widthPt, p, cache) {
    useGlyphMetrics(doc.glyph_metrics);
    cache.metrics = doc.glyph_metrics;
    cache.sourceWidthSp = doc.source_width || 0;
    cache.fontInfo = fontInfo;
    const columnPx = widthPt * ZOOM;
    const displayModel = {
      sourceWidthSp: doc.source_width || 0,
      minSpacePt: p.displayMinSpacePt
    };
    cache.links = doc.links || [];
    cache.slotNames = (doc.slots || []).map((x) => x.name);
    cache.anchors = doc.anchors || [];
    cache.streams = doc.streams || [];
    cache.hosts = cache.hosts || /* @__PURE__ */ new Map();
    cache.blockKey = cache.blockKey || newBlockKey();
    const minGapPx = p.minGapPt * ZOOM;
    const padPx = p.padPt * ZOOM;
    cache.bcs = cache.bcs || /* @__PURE__ */ new Map();
    const segs = segmentsOf(doc);
    if (!cache.dom) {
      const root = document.createElement("div");
      cache.dom = {
        root,
        segs: [],
        byNode: /* @__PURE__ */ new Map(),
        live: /* @__PURE__ */ new Set(),
        anchors: /* @__PURE__ */ new Map()
      };
    }
    const dom = cache.dom;
    dom.root.style.visibility = "";
    const layoutOne = (seg, i) => {
      const geom = seg.kind === "display" ? layoutDisplaySegment(fontInfo, seg, widthPt, displayModel) : layoutTextSegment(fontInfo, seg, widthPt, p, cache);
      const profiles = geom.lines.map(
        (ln, j) => lineProfile(fontInfo, ln.nodes, geom.lrp[j].x0, geom.lrp[j].ratio, geom.lrp[j].er)
      );
      const ascent = (profiles[0] ?? []).reduce((m, it) => Math.max(m, it.h), 0);
      const baselineYs = [ascent];
      for (let j = 1; j < geom.lines.length; j++) {
        const gap = geom.gaps && geom.gaps[j];
        let advance;
        if (gap) {
          const prevDepth = profiles[j - 1].reduce((m, it) => Math.max(m, it.d), 0);
          const rowAscent = profiles[j].reduce((m, it) => Math.max(m, it.h), 0);
          advance = prevDepth + gap + rowAscent;
        } else {
          const prevDepth = profiles[j - 1].reduce((m, it) => Math.max(m, it.d), 0);
          const thisAsc = profiles[j].reduce((m, it) => Math.max(m, it.h), 0);
          const lm = geom.meta && geom.meta[j];
          if (lm) {
            advance = texInterlineAdvance(prevDepth, thisAsc, lm);
          } else {
            const needed = minRequiredAdvance(profiles[j - 1], profiles[j]);
            advance = needed > minGapPx ? needed + padPx : minGapPx;
          }
        }
        baselineYs.push(baselineYs[j - 1] + advance);
      }
      const firstAscent = ascent;
      const lastDepth = (profiles[profiles.length - 1] ?? []).reduce((m, it) => Math.max(m, it.d), 0);
      const H = baselineYs[baselineYs.length - 1] + lastDepth;
      return {
        ...geom,
        seg,
        profiles,
        baselineYs,
        H,
        firstAscent,
        lastDepth,
        firstMeta: geom.meta && geom.meta[0] || null,
        gapBefore: seg.gapBefore || 0
      };
    };
    while (dom.segs.length < segs.length) {
      const seg = segs[dom.segs.length];
      if (seg.kind === "stream" && keptHostBox(cache, seg.index)) {
        const gap2 = document.createElement("div");
        gap2.style.cssText = "height:0px;overflow-anchor:none";
        dom.segs.push({ svg: null, box: keptHostBox(cache, seg.index), gap: gap2, wrap: null, pairs: [], sub: null });
        continue;
      }
      if (seg.kind === "stream") {
        const box2 = document.createElement("div");
        box2.className = "latex-stream";
        box2.dataset.kind = seg.stream.kind || "";
        const bk = blockKeyOf(cache.blockEl);
        if (bk) box2.dataset.instance = `${bk}/s${seg.index}`;
        for (const a of seg.stream.attrs || []) {
          if (!a.key || !/^[a-z0-9-]+$/.test(a.key)) continue;
          if (a.key === "class") box2.classList.add(...(a.value || "").split(/\s+/).filter(Boolean));
          else if (a.key.startsWith("--")) box2.style.setProperty(a.key, a.value || "");
          else box2.setAttribute("data-" + a.key, a.value || "");
        }
        const gap2 = document.createElement("div");
        gap2.style.cssText = "height:0px;overflow-anchor:none";
        dom.segs.push({ svg: null, box: box2, gap: gap2, wrap: null, pairs: [], sub: null });
        continue;
      }
      const svg = svgEl("svg", { xmlns: "http://www.w3.org/2000/svg", "xmlns:xlink": "http://www.w3.org/1999/xlink" });
      svg.style.cssText = "display:block;overflow:visible;max-width:none;font-weight:normal;font-style:normal;overflow-anchor:none;direction:ltr;unicode-bidi:isolate";
      const box = document.createElement("div");
      box.appendChild(svg);
      const gap = document.createElement("div");
      gap.style.cssText = "height:0px;overflow-anchor:none";
      dom.segs.push({ svg, box, gap, wrap: null, pairs: [] });
    }
    const paramsKey = JSON.stringify(p);
    cache.layoutCtx = { layoutOne, segs, widthPt, p, columnPx, paramsKey };
    const stats = cache.layoutStats = { computed: 0, reused: 0, deferred: 0, materialized: 0 };
    const prevLaid = cache.layout && cache.layout.laid.length === segs.length ? cache.layout.laid : null;
    const laid = segs.map((seg, i) => {
      const s = dom.segs[i];
      if (seg.kind === "stream") {
        stats.computed++;
        return layoutStreamSegment(fontInfo, doc, s, seg, widthPt, p, cache);
      }
      const hc = segLayoutCache(s, paramsKey);
      const exact = hc.exact.get(widthPt);
      if (exact) {
        stats.reused++;
        return { ...exact, seg };
      }
      if (!s.intersecting) {
        const cached = cachedGeometry(hc, widthPt);
        const g = cached || quickLayout && prevLaid && prevLaid[i];
        if (g) {
          stats.deferred++;
          return {
            seg,
            deferred: true,
            held: !cached,
            lines: [],
            H: g.H,
            W: g.W,
            firstAscent: g.firstAscent,
            lastDepth: g.lastDepth,
            firstMeta: g.firstMeta,
            gapBefore: seg.gapBefore || 0,
            preDisplaySizeSp: g.preDisplaySizeSp,
            displayLeftSp: g.displayLeftSp,
            atSourceWidth: g.atSourceWidth
          };
        }
      }
      const L = layoutOne(seg, i);
      rememberLayout(hc, widthPt, L);
      stats.computed++;
      return L;
    });
    const want = [];
    laid.forEach((L, i) => {
      const s = dom.segs[i];
      const { mount, overflows } = sizeSegment(s, L, laid[i - 1], columnPx, p);
      s.mount = mount;
      for (const id of L.seg.anchors || []) {
        const label = cache.anchors[id - 1];
        if (!label) continue;
        let a = dom.anchors.get(label);
        if (!a) {
          a = document.createElement("div");
          a.className = "latex-anchor";
          a.id = label;
          dom.anchors.set(label, a);
          linkTargets.set(label, a);
        }
        want.push(a);
      }
      if (mount && mount.parentNode !== s.box) s.box.replaceChildren(mount);
      want.push(s.gap, s.box);
      if (overflows) {
        requestAnimationFrame(() => updateDisplayOverflowCue(s.wrap));
      }
    });
    if (segs.trailingGap) {
      if (!dom.trail) {
        dom.trail = document.createElement("div");
        dom.trail.style.cssText = "overflow-anchor:none";
      }
      setStyle(dom.trail, "height", `${segs.trailingGap}px`);
      want.push(dom.trail);
    }
    syncChildren(dom.root, want);
    cache.layout = { laid };
    observeSegments(cache);
    return dom.root;
  }
  function syncChildren(parent, want) {
    let k = 0;
    for (const el of want) {
      const cur = parent.childNodes[k];
      if (cur !== el) parent.insertBefore(el, cur || null);
      k++;
    }
    while (parent.childNodes.length > k) parent.lastChild.remove();
  }
  function setStyle(el, prop, v) {
    if (el.style[prop] !== v) el.style[prop] = v;
  }
  function segLayoutCache(s, key) {
    if (!s.hc || s.hc.key !== key) s.hc = { key, exact: /* @__PURE__ */ new Map(), obs: [] };
    return s.hc;
  }
  var EXACT_LAYOUTS_KEPT = 3;
  function rememberLayout(hc, w, L) {
    hc.exact.set(w, L);
    if (hc.exact.size > EXACT_LAYOUTS_KEPT) hc.exact.delete(hc.exact.keys().next().value);
    const o = {
      w,
      H: L.H,
      W: L.W,
      firstAscent: L.firstAscent,
      lastDepth: L.lastDepth,
      firstMeta: L.firstMeta,
      preDisplaySizeSp: L.preDisplaySizeSp,
      displayLeftSp: L.displayLeftSp,
      atSourceWidth: L.atSourceWidth
    };
    const obs = hc.obs;
    let k = 0;
    while (k < obs.length && obs[k].w < w) k++;
    if (k < obs.length && obs[k].w === w) obs[k] = o;
    else obs.splice(k, 0, o);
  }
  function cachedGeometry(hc, w) {
    const obs = hc.obs;
    let k = 0;
    while (k < obs.length && obs[k].w < w) k++;
    if (k < obs.length && obs[k].w === w) return obs[k];
    if (k === 0 || k === obs.length) return null;
    const a = obs[k - 1], b = obs[k];
    if (a.H !== b.H) return null;
    return w - a.w <= b.w - w ? a : b;
  }
  function materializeSegment(cache, i) {
    const laid = cache.layout && cache.layout.laid;
    const L = laid && laid[i];
    if (!L || !L.deferred) return;
    const ctx = cache.layoutCtx;
    useGlyphMetrics(cache.metrics);
    const s = cache.dom.segs[i];
    const real = ctx.layoutOne(ctx.segs[i], i);
    rememberLayout(segLayoutCache(s, ctx.paramsKey), ctx.widthPt, real);
    laid[i] = real;
    const remount = (seg, R, prev) => {
      const { mount, overflows } = sizeSegment(seg, R, prev, ctx.columnPx, ctx.p);
      if (mount.parentNode !== seg.box) seg.box.replaceChildren(mount);
      seg.mount = mount;
      if (overflows) requestAnimationFrame(() => updateDisplayOverflowCue(seg.wrap));
    };
    remount(s, real, laid[i - 1]);
    if (laid[i + 1]) remount(cache.dom.segs[i + 1], laid[i + 1], real);
    if (cache.layoutStats) cache.layoutStats.materialized++;
  }

  // src/host/surface.ts
  var live = /* @__PURE__ */ new WeakMap();
  var all = /* @__PURE__ */ new Set();
  function edgesOf(cache) {
    const laid = cache.layout && cache.layout.laid || [];
    const first = laid[0], last = laid[laid.length - 1];
    const textAt = (L) => !!(L && L.seg && L.seg.kind === "text");
    return {
      firstAscent: first ? first.firstAscent : 0,
      firstMeta: first ? first.firstMeta : null,
      textFirst: textAt(first),
      lastDepth: last ? last.lastDepth : 0,
      textLast: textAt(last)
    };
  }
  function surfacesOf(blockEl) {
    return live.get(blockEl) || [];
  }
  var TypesetPartImpl = class {
    constructor(role, instance, data, stream) {
      this.role = role;
      this.instance = instance;
      this.data = data;
      this.doc = { ...data.doc, content: stream.content || [] };
    }
    role;
    instance;
    data;
    type = "typeset";
    natural = null;
    doc;
    /** Lay the part out at `px` into a fresh cache (or the one given). */
    layout(px, cache = this.newCache()) {
      const root = layoutDocument(this.data.fontInfo, this.doc, px / ZOOM, this.data.params, cache);
      return { cache, root };
    }
    newCache(relayout) {
      return { bcs: null, dom: null, layout: null, stats: null, blockEl: this.data.el, relayout };
    }
    naturalWidth() {
      if (this.natural === null) {
        const { cache } = this.layout(NATURAL_PROBE_PT * ZOOM);
        let w = 0;
        for (const L of cache.layout.laid)
          (L.lines || []).forEach((ln, j) => {
            w = Math.max(w, (L.lrp && L.lrp[j] ? L.lrp[j].x0 : 0) + sumWidthSp(ln.nodes) * SP_TO_PX);
          });
        this.natural = Math.ceil(w + 0.5);
      }
      return this.natural;
    }
    mount(el, options = {}) {
      return new SurfaceImpl(this, el, options.width ?? "container");
    }
  };
  var SurfaceImpl = class {
    constructor(part, el, width) {
      this.part = part;
      this.el = el;
      this.width = width;
      this.cache = part.newCache(() => this.relayout(true));
      this.box.className = "latex-block latex-part";
      this.box.dataset.instance = part.instance.id;
      this.box.style.margin = "0";
      let set = live.get(part.data.el);
      if (!set) live.set(part.data.el, set = /* @__PURE__ */ new Set());
      set.add(this);
      all.add(this);
      this.apply();
    }
    part;
    el;
    width;
    box = document.createElement("div");
    cache;
    px = 0;
    // the measure last laid out at
    listeners = /* @__PURE__ */ new Set();
    ro = null;
    frame = 0;
    disposed = false;
    last = { width: 0, height: 0, firstBaseline: 0, lastDepth: 0 };
    measure() {
      const w = this.width;
      if (typeof w === "number") return w;
      if (w === "natural") return this.part.naturalWidth();
      const cs = getComputedStyle(this.el);
      const inner = this.el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      return inner > 0 ? inner : this.px || this.part.data.el.clientWidth || 600;
    }
    apply() {
      if (this.width === "container") {
        if (!this.ro) {
          this.ro = new ResizeObserver(() => {
            if (this.frame) return;
            this.frame = requestAnimationFrame(() => {
              this.frame = 0;
              this.relayout();
            });
          });
          this.ro.observe(this.el);
        }
      } else if (this.ro) {
        this.ro.disconnect();
        this.ro = null;
      }
      this.relayout(true);
    }
    relayout(force = false) {
      if (this.disposed) return;
      const px = this.measure();
      if (!force && Math.abs(px - this.px) < 0.5) return;
      this.px = px;
      const { root } = this.part.layout(px, this.cache);
      this.box.style.width = `${px}px`;
      if (root.parentNode !== this.box) this.box.replaceChildren(root);
      if (this.box.parentNode !== this.el) this.el.replaceChildren(this.box);
      markDirty(this.cache);
      paintVisibleNow(this.part.data.fontInfo, this.cache);
      const laid = this.cache.layout.laid;
      const first = laid[0], lastL = laid[laid.length - 1];
      this.last = {
        width: px,
        height: this.box.offsetHeight,
        firstBaseline: first ? first.firstAscent : 0,
        lastDepth: lastL ? lastL.lastDepth : 0
      };
      this.box.dataset.baseline = String(this.last.firstBaseline);
      for (const fn of [...this.listeners]) {
        try {
          fn(this.last);
        } catch (e) {
          console.error("[latex-viewer] surface listener:", e);
        }
      }
      surfaceChanged(this);
    }
    edges() {
      return edgesOf(this.cache);
    }
    /** Every segment, on screen or not (print). */
    paintAll() {
      if (!this.disposed) paintDocument(this.part.data.fontInfo, this.cache);
    }
    get isDisposed() {
      return this.disposed;
    }
    /** New elements for every glyph (the face that just loaded), same layout. */
    rerender() {
      if (this.disposed) return;
      unobserveAll(this.cache);
      disposePieces(this.cache);
      this.cache.dom = null;
      this.cache.layout = null;
      this.relayout(true);
    }
    metrics() {
      return this.last;
    }
    setWidth(width) {
      this.width = width ?? "container";
      this.apply();
    }
    onChange(fn) {
      this.listeners.add(fn);
      return () => {
        this.listeners.delete(fn);
      };
    }
    dispose() {
      if (this.disposed) return;
      this.disposed = true;
      if (this.ro) this.ro.disconnect();
      if (this.frame) cancelAnimationFrame(this.frame);
      unobserveAll(this.cache);
      disposePieces(this.cache);
      disposeHosts(this.cache);
      this.listeners.clear();
      if (this.box.parentNode === this.el) this.el.removeChild(this.box);
      live.get(this.part.data.el)?.delete(this);
      all.delete(this);
      surfaceChanged(this);
    }
  };
  function disposeSurfaces(blockEl) {
    for (const s of [...live.get(blockEl) || []]) s.dispose();
  }
  function rerenderSurfaces(blockEl) {
    for (const s of live.get(blockEl) || []) s.rerender();
  }
  window.addEventListener("beforeprint", () => {
    for (const s of all) s.paintAll();
  });

  // src/host/host.ts
  function screenPoint(el, x, y) {
    const ctm = el && el.getScreenCTM && el.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(x, y).matrixTransform(ctm);
    return new DOMRect(p.x, p.y, 0, 0);
  }
  var num = (el, a) => parseFloat(el.getAttribute(a) || "0") || 0;
  var BlockImpl = class {
    constructor(data) {
      this.data = data;
    }
    data;
    _roots = null;
    byId = null;
    get el() {
      return this.data.el;
    }
    get key() {
      return this.data.cache.blockKey || "";
    }
    get roots() {
      if (!this._roots) {
        this._roots = normalise(
          this.data.doc,
          this,
          this.key,
          { typeset: (inst, role, stream) => new TypesetPartImpl(role, inst, this.data, stream) },
          (src) => this.anchor(src),
          SP_TO_PX
        );
      }
      return this._roots;
    }
    instances(query) {
      return [...walk(this.roots)].filter((i) => matches(i, query));
    }
    find(id) {
      if (!this.byId) this.byId = new Map([...walk(this.roots)].map((i) => [i.id, i]));
      return this.byId.get(id);
    }
    destroy() {
      destroyBlock(this.el);
    }
    on(event, fn) {
      const h = (e) => {
        if (e.detail?.block === this.el) fn();
      };
      this.el.addEventListener("reflowtex:" + event, h);
      return () => this.el.removeEventListener("reflowtex:" + event, h);
    }
    anchor(src) {
      const el = this.el;
      if (src.type === "aside") {
        const m = el.querySelector(`.latex-aside-mark[data-aside="${src.stream}"]`);
        return m && screenPoint(m, num(m, "x"), num(m, "y"));
      }
      if (src.type === "glyph") {
        const g = el.querySelector(`[data-footnote="${src.stream}"]`);
        return g && screenPoint(g, num(g, "x"), num(g, "y"));
      }
      if (src.type === "widget") {
        const w = el.querySelector(`.latex-widget[data-widget="${CSS.escape(`${this.key}:${src.slot}`)}"]`);
        return w ? w.getBoundingClientRect() : null;
      }
      return null;
    }
  };
  var blockKeyOf = (el) => el && blockOf(el)?.key || "";
  var blocks = [];
  var byEl = /* @__PURE__ */ new WeakMap();
  function blockOf(el) {
    let b = byEl.get(el);
    if (!b) {
      const data = blockData.get(el);
      if (!data) return void 0;
      byEl.set(el, b = new BlockImpl(data));
    }
    return b;
  }
  var blockListeners = /* @__PURE__ */ new Set();
  var host = {
    version: 1,
    define: defineKind,
    setText: (name, text) => setSlotText(name, text),
    blocks: () => blocks.slice(),
    block: (el) => blocks.includes(byEl.get(el)) ? byEl.get(el) : void 0,
    instances: (query) => blocks.flatMap((b) => b.instances(query)),
    find: (id) => {
      const b = blocks.find((b2) => id.startsWith(b2.key + "/"));
      return b && b.find(id);
    },
    async mount(el) {
      await mountBlock(el);
      const b = blockOf(el);
      if (!b) throw new Error("host.mount: not a block (no data-nodelist-b64, or it failed to render)");
      return b;
    },
    onBlock(fn) {
      blockListeners.add(fn);
      for (const b of blocks) fn(b);
      return () => {
        blockListeners.delete(fn);
      };
    }
  };
  function unregisterBlock(el) {
    const b = byEl.get(el);
    if (!b) return;
    const i = blocks.indexOf(b);
    if (i >= 0) blocks.splice(i, 1);
    byEl.delete(el);
  }
  function registerBlock(data) {
    const b = blockOf(data.el);
    if (!b || blocks.includes(b)) return;
    blocks.push(b);
    for (const fn of [...blockListeners]) {
      try {
        fn(b);
      } catch (e) {
        console.error("[latex-viewer] onBlock listener:", e);
      }
    }
  }
  function installHost() {
    api.host = host;
    document.dispatchEvent(new CustomEvent("reflowtex:host", { detail: { host } }));
  }

  // src/defaults/footnotes.js
  var footnotePop = null;
  var footnoteBody = null;
  var footnoteArrow = null;
  var pinnedFootnote = null;
  var hoverFootnote = null;
  function installFootnotes() {
    if (footnotePop) return;
    const style = document.createElement("style");
    style.textContent = `
      .latex-footnote-source { cursor: pointer; pointer-events: auto; }
      /* A frosted panel: the page's colour, mostly opaque, over a blur of
         what lies behind (a page may set --latex-popover-background). No
         arrow: the panel opens right by its mark. */
      #latex-footnote-pop { position: fixed; z-index: 2147483000; display: none;
        width: max-content; max-width: calc(100vw - 16px); max-height: calc(100vh - 16px);
        overflow: auto; box-sizing: border-box; padding: 1.05rem 1.25rem 1.15rem;
        border: .5px solid color-mix(in srgb, currentColor 16%, transparent); border-radius: 16px;
        background: var(--latex-popover-background,
          color-mix(in srgb, var(--latex-page-bg, Canvas) 84%, transparent));
        -webkit-backdrop-filter: saturate(180%) blur(20px); backdrop-filter: saturate(180%) blur(20px);
        color: inherit;
        box-shadow: 0 18px 50px rgb(0 0 0 / .18), 0 2px 6px rgb(0 0 0 / .08); }
      #latex-footnote-pop.latex-footnote-open { display: block;
        animation: latex-footnote-in .16s cubic-bezier(.2, .9, .25, 1.05); }
      @keyframes latex-footnote-in { from { opacity: 0; transform: translateY(-4px) scale(.98); } }
      @media (prefers-reduced-motion: reduce) { #latex-footnote-pop.latex-footnote-open { animation: none; } }
      #latex-footnote-pop .latex-footnote-arrow { display: none; }
      #latex-footnote-pop .latex-footnote-content { margin: 0; overflow: visible; }
      #latex-footnote-pop .latex-footnote-content svg { max-width: 100%; }
    `;
    document.head.appendChild(style);
    footnotePop = document.createElement("div");
    footnotePop.id = "latex-footnote-pop";
    footnotePop.setAttribute("role", "tooltip");
    footnoteArrow = document.createElement("div");
    footnoteArrow.className = "latex-footnote-arrow";
    footnoteBody = document.createElement("div");
    footnoteBody.className = "latex-block latex-footnote-content";
    footnotePop.append(footnoteArrow, footnoteBody);
    document.body.appendChild(footnotePop);
    const sourceAt = (t) => t && t.closest ? t.closest("[data-footnote]") : null;
    document.addEventListener("pointerover", (e) => {
      if (pinnedFootnote) return;
      const el = sourceAt(e.target);
      if (el) openFootnote(el, false);
    });
    document.addEventListener("pointerout", (e) => {
      if (pinnedFootnote) return;
      const from = sourceAt(e.target);
      if (!from) return;
      const to = sourceAt(e.relatedTarget);
      if (!to || to.dataset.footnote !== from.dataset.footnote) closeFootnote();
    });
    document.addEventListener("focusin", (e) => {
      if (!pinnedFootnote) {
        const el = sourceAt(e.target);
        if (el) openFootnote(el, false);
      }
    });
    document.addEventListener("focusout", (e) => {
      if (!pinnedFootnote && !footnotePop.contains(e.relatedTarget)) closeFootnote();
    });
    document.addEventListener("click", (e) => {
      const el = sourceAt(e.target);
      if (el) {
        e.preventDefault();
        const block = el.closest("[data-nodelist-b64]");
        const id = el.dataset.footnote;
        if (pinnedFootnote && pinnedFootnote.block === block && pinnedFootnote.id === id) {
          closeFootnote();
        } else {
          openFootnote(el, true);
        }
      } else if (pinnedFootnote && !footnotePop.contains(e.target)) {
        closeFootnote();
      }
    });
    document.addEventListener("keydown", (e) => {
      const el = sourceAt(e.target);
      if (el && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        openFootnote(el, true);
      } else if (e.key === "Escape" && (pinnedFootnote || hoverFootnote)) {
        closeFootnote();
      }
    });
    const reposition = () => {
      const active = pinnedFootnote || hoverFootnote;
      if (active) positionFootnote(active.anchor);
    };
    const reflow = () => {
      const active = pinnedFootnote || hoverFootnote;
      if (active) {
        renderFootnote(active.block, active.id);
        positionFootnote(active.anchor);
      }
    };
    window.addEventListener("scroll", reposition, { passive: true });
    window.addEventListener("resize", reflow);
  }
  function footnoteGroupRect(el) {
    const id = el.dataset.footnote;
    const same = (e) => e && e.dataset && e.dataset.footnote === id;
    const kin = [el];
    for (let p = el.previousElementSibling; same(p); p = p.previousElementSibling) kin.push(p);
    for (let n = el.nextElementSibling; same(n); n = n.nextElementSibling) kin.push(n);
    let L = Infinity, T = Infinity, R = -Infinity, B = -Infinity;
    for (const k of kin) {
      const b = glyphScreenRect(k);
      L = Math.min(L, b.left);
      T = Math.min(T, b.top);
      R = Math.max(R, b.right);
      B = Math.max(B, b.bottom);
    }
    return isFinite(L) ? { left: L, top: T, right: R, bottom: B, width: R - L, height: B - T } : el.getBoundingClientRect();
  }
  var shown = null;
  function undraw2() {
    if (!shown) return;
    if (shown.undo) {
      try {
        shown.undo();
      } catch (e) {
        console.error("[latex-viewer] popover:", e);
      }
    }
    if (shown.surface) shown.surface.dispose();
    shown = null;
  }
  function renderFootnote(block, id) {
    const b = blockOf(block);
    const instance = b && b.find(`${b.key}/s${Number(id)}`);
    if (!instance || instance.placement !== "detached") return false;
    const widthPx = Math.min(420, Math.max(220, document.documentElement.clientWidth - 32));
    footnoteBody.style.width = widthPx + "px";
    const key = instance.id;
    if (shown && shown.key === key) {
      if (shown.surface) shown.surface.setWidth(widthPx);
      return true;
    }
    undraw2();
    footnoteBody.replaceChildren();
    shown = { key, instance };
    const def = kindDef(instance.kind);
    if (def) {
      try {
        const u = def.render(instance, { type: "popover", el: footnoteBody, instance, setEdges() {
        } });
        shown.undo = typeof u === "function" ? u : null;
        return true;
      } catch (e) {
        console.error(`[latex-viewer] kind "${instance.kind}": render failed, drawn by default:`, e);
        footnoteBody.replaceChildren();
      }
    }
    const body = instance.part("body");
    if (body && body.type === "typeset") shown.surface = body.mount(footnoteBody, { width: widthPx });
    return true;
  }
  function positionFootnote(anchor) {
    const r = footnoteGroupRect(anchor);
    const gap = 9, vw = document.documentElement.clientWidth, vh = window.innerHeight;
    const pw = footnotePop.offsetWidth, ph = footnotePop.offsetHeight;
    const cx = r.left + r.width / 2;
    const left = Math.max(8, Math.min(cx - pw / 2, vw - pw - 8));
    const above = r.bottom + gap + ph > vh && r.top - gap - ph > 0;
    const rawTop = above ? r.top - ph - gap : r.bottom + gap;
    const top = Math.max(8, Math.min(rawTop, vh - ph - 8));
    footnotePop.classList.toggle("latex-footnote-above", above);
    footnotePop.style.left = left + "px";
    footnotePop.style.top = top + "px";
    const box = footnotePop.getBoundingClientRect();
    footnoteArrow.style.left = Math.max(12, Math.min(box.width - 12, cx - box.left)) + "px";
  }
  function openFootnote(anchor, pin) {
    const block = anchor.closest("[data-nodelist-b64]");
    const id = anchor.dataset.footnote;
    if (!block || !renderFootnote(block, id)) return;
    footnotePop.classList.add("latex-footnote-open");
    footnotePop.classList.toggle("latex-footnote-pinned", pin);
    positionFootnote(anchor);
    const active = { block, id, anchor };
    if (pin) {
      pinnedFootnote = active;
      hoverFootnote = null;
    } else hoverFootnote = active;
  }
  function closeFootnote() {
    pinnedFootnote = null;
    hoverFootnote = null;
    undraw2();
    if (footnotePop) footnotePop.classList.remove(
      "latex-footnote-open",
      "latex-footnote-pinned",
      "latex-footnote-above"
    );
  }
  function registerFootnoteSource(el, id) {
    el.classList.add("latex-footnote-source");
    el.dataset.footnote = id;
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-describedby", "latex-footnote-pop");
  }
  function registerStreamSource(el, idx, cache) {
    if ((cache.streams || [])[idx - 1]) registerFootnoteSource(el, idx);
  }
  function glyphScreenRect(el) {
    const svg = el.ownerSVGElement;
    const ctm = el.getScreenCTM && el.getScreenCTM();
    const x = parseFloat(el.getAttribute("x"));
    const y = parseFloat(el.getAttribute("y"));
    const fs = parseFloat(el.getAttribute("font-size"));
    if (!svg || !ctm || !svg.createSVGPoint || !isFinite(x) || !isFinite(y) || !isFinite(fs)) {
      return el.getBoundingClientRect();
    }
    const x0 = x, x1 = x + fs * 0.5, y0 = y - fs * 0.72, y1 = y + fs * 0.1;
    const pt = svg.createSVGPoint();
    let L = Infinity, T = Infinity, R = -Infinity, B = -Infinity;
    for (const [px, py] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
      pt.x = px;
      pt.y = py;
      const p = pt.matrixTransform(ctm);
      L = Math.min(L, p.x);
      R = Math.max(R, p.x);
      T = Math.min(T, p.y);
      B = Math.max(B, p.y);
    }
    return { left: L, top: T, right: R, bottom: B, width: R - L, height: B - T };
  }

  // src/host/inspect.js
  var inspectable = /* @__PURE__ */ new Set();
  api.inspect = {
    version: 1,
    spToPx: SP_TO_PX,
    // scaled points → svg user units
    blocks: () => [...inspectable].filter((el) => el.isConnected),
    state: (el) => blockData.get(el),
    get paints() {
      return paintCount;
    },
    replay(el, i, sink, cache) {
      const data = blockData.get(el);
      cache = cache || data && data.cache;
      const L = cache && cache.layout && cache.layout.laid[i];
      if (!L || L.deferred || !L.lines || !L.lrp) return false;
      useGlyphMetrics(cache.metrics);
      const noop = () => {
      };
      const s = {
        glyph: noop,
        missing: noop,
        space: noop,
        rule: noop,
        picture: noop,
        beginTransform: noop,
        endTransform: noop,
        node: sink.node,
        vnode: sink.vnode
      };
      for (let j = 0; j < L.lines.length; j++) {
        const { ratio, er, x0, fillRatio, fillOrder } = L.lrp[j];
        if (sink.line) sink.line(j, L.lines[j], x0, L.baselineYs[j]);
        renderNodes(
          data.fontInfo,
          s,
          L.lines[j].nodes,
          x0,
          L.baselineYs[j],
          fillOrder ? fillRatio : ratio,
          er,
          fillOrder || 0
        );
      }
      return true;
    }
  };

  // src/runtime/decode.js
  var sharedDocType = null;
  function b64ToBytes(b64) {
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  }
  function loadSchema() {
    const el = document.getElementById("latex-schema");
    if (!el?.dataset.schemaB64) throw new Error("#latex-schema element with data-schema-b64 not found");
    const protoText = new TextDecoder().decode(b64ToBytes(el.dataset.schemaB64));
    const root = protobuf.parse(protoText, { keepCase: true }).root;
    sharedDocType = root.lookupType("latex.Document");
  }
  function decodeBlock(b64) {
    const msg = sharedDocType.decode(b64ToBytes(b64));
    return sharedDocType.toObject(msg, { defaults: false, arrays: true, enums: String, longs: Number });
  }

  // src/runtime/fonts.js
  var registeredFontFaces = /* @__PURE__ */ new Set();
  var fontUrlMap = {};
  var fontBase = SCRIPT_URL ? new URL("fonts/", SCRIPT_URL).href : "/fonts/";
  var fontsPending = false;
  async function registerFonts(fontsData) {
    const fontInfo = {};
    const fileToFamily = {};
    let css = "";
    for (const f of Object.values(fontsData)) {
      const file = f.filename;
      if (fileToFamily[file]) continue;
      if (!file || file === "unknown") {
        fileToFamily[file] = "serif";
        continue;
      }
      const family = file.replace(/\.otf$/i, "").replace(/[^a-zA-Z0-9]/g, "_");
      const servedFile = fontUrlMap[file] || file;
      if (!registeredFontFaces.has(file)) {
        css += `@font-face { font-family: '${family}'; src: url('${fontBase}${servedFile}'); }
`;
        registeredFontFaces.add(file);
      }
      fileToFamily[file] = family;
    }
    if (css) {
      const s = document.createElement("style");
      s.textContent = css;
      document.head.appendChild(s);
    }
    for (const [idStr, f] of Object.entries(fontsData)) {
      fontInfo[idStr] = {
        family: fileToFamily[f.filename],
        size_px: f.size_sp / 65536 * ZOOM,
        // A font with no OTF to load: its glyphs are drawn as metric boxes
        // (see the sink's glyph handler) so the missing ink is visible.
        unresolved: !f.filename || f.filename === "unknown",
        // Microtypography as TeX had it (FontInfo in latex.proto): the
        // quad protrusion is relative to, \expandglyphsinfont's three
        // arguments (null = the font does not expand), and per-character
        // \lpcode/\rpcode/\efcode for the characters that have any. Handed
        // to an external breaker through the hook's helpers; the built-in
        // breaker keeps its own protrusion table and expansion limits.
        quad: f.quad || 0,
        expand: f.expand_stretch || f.expand_shrink ? {
          stretch: f.expand_stretch || 0,
          shrink: f.expand_shrink || 0,
          step: f.expand_step || 0
        } : null,
        codes: new Map((f.codes || []).map((c) => [c.char, c]))
      };
    }
    const families = [...new Set(Object.values(fileToFamily))].filter((fam) => fam !== "serif");
    const check = (fam) => {
      try {
        return document.fonts.check(`12px '${fam}'`);
      } catch {
        return false;
      }
    };
    if (document.fonts && families.some((fam) => !check(fam))) fontsPending = true;
    await Promise.allSettled(families.map((fam) => document.fonts.load(`12px '${fam}'`)));
    if (document.fonts) {
      const failed = [];
      for (const face of document.fonts) {
        const fam = String(face.family).replace(/^['"]|['"]$/g, "");
        if (face.status === "error" && families.includes(fam)) {
          const file = Object.keys(fileToFamily).find((k) => fileToFamily[k] === fam);
          failed.push(file ? file.replace(/\.otf$/i, "").replace(/\.reflowtex-[0-9a-f]+$/, "") : fam);
        }
      }
      if (failed.length) reportFontFailure(failed);
    }
    return fontInfo;
  }
  var failedFonts = /* @__PURE__ */ new Set();
  var fontWarning = null;
  function reportFontFailure(names) {
    for (const n of names) failedFonts.add(n);
    if (api.fontWarning === false || !document.body) return;
    if (!fontWarning) {
      const st = document.createElement("style");
      st.textContent = `
          .latex-font-warning { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%);
            z-index: 2147483000; box-sizing: border-box; width: min(44rem, calc(100vw - 32px));
            display: flex; align-items: center; gap: 12px; padding: 12px 14px 12px 18px;
            font: 14px/1.45 ui-sans-serif, system-ui, sans-serif; color: #fff; background: #2b2622;
            border-radius: 12px; box-shadow: 0 8px 28px rgba(0,0,0,.28); }
          .latex-font-warning p { margin: 0; flex: 1; }
          .latex-font-warning strong { color: #ffcf8a; }
          .latex-font-warning button { font: inherit; font-weight: 600; color: inherit; cursor: pointer;
            border: 1px solid rgba(255,255,255,.35); background: none; border-radius: 8px; padding: 6px 12px; }
          .latex-font-warning button:hover { background: rgba(255,255,255,.12); }
          .latex-font-warning button[data-act="close"] { border: 0; padding: 6px 8px; font-size: 18px; line-height: 1; opacity: .8; }
          @media print { .latex-font-warning { display: none; } }`;
      document.head.appendChild(st);
      fontWarning = document.createElement("div");
      fontWarning.className = "latex-font-warning";
      fontWarning.setAttribute("role", "alert");
      fontWarning.innerHTML = '<p></p><button type="button" data-act="reload">Reload</button><button type="button" data-act="close" aria-label="Dismiss">×</button>';
      fontWarning.addEventListener("click", (e) => {
        const act = e.target.closest("button")?.dataset.act;
        if (act === "reload") location.reload();
        if (act === "close") fontWarning.hidden = true;
      });
      document.body.appendChild(fontWarning);
    }
    const list = [...failedFonts];
    const shown2 = list.slice(0, 4).join(", ") + (list.length > 4 ? ` and ${list.length - 4} more` : "");
    fontWarning.querySelector("p").innerHTML = `<strong>Some fonts could not be downloaded</strong> (${shown2.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c])}). Text may appear in a stand-in font, and mathematics may be missing.`;
  }
  function loadFontMap() {
    const el = document.getElementById("latex-font-map");
    if (!el) return;
    const base = el.getAttribute("data-fonts-base");
    if (base) {
      const withSlash = base.endsWith("/") ? base : base + "/";
      try {
        fontBase = new URL(withSlash, SCRIPT_URL).href;
      } catch {
      }
    }
    if (!el.textContent.trim()) return;
    try {
      fontUrlMap = JSON.parse(el.textContent);
    } catch {
      fontUrlMap = {};
    }
  }

  // src/runtime/init.js
  var docSeq = 0;
  function resolvePictures(doc) {
    const pics = doc.pictures;
    if (!pics || !pics.length) return;
    const walk2 = (nodes) => {
      for (const n of nodes) {
        if (n.type === "picture" && n.picture) n.pic = pics[n.picture - 1];
        for (const k of ["children", "replace", "pre", "post"]) {
          if (n[k]) walk2(n[k]);
        }
      }
    };
    for (const p of doc.paragraphs) walk2(p.nodes);
    for (const it of doc.content || []) if (it.box) walk2(it.box.children || []);
    for (const st of doc.streams || []) {
      for (const it of st.content || []) if (it.box) walk2(it.box.children || []);
    }
  }
  async function initBlock(el) {
    const nodelistB64 = el.dataset.nodelistB64;
    if (!nodelistB64) throw new Error("Missing data-nodelist-b64 attribute");
    const t0 = performance.now();
    const doc = decodeBlock(nodelistB64);
    resolvePictures(doc);
    for (const label of doc.anchors || []) pageLabels.add(label);
    const t1 = performance.now();
    const fontsData = Object.fromEntries(doc.fonts.map((f) => [String(f.id), f]));
    const fontInfo = await registerFonts(fontsData);
    const t2 = performance.now();
    const params = paramsFromEl(el);
    const natural = el.dataset.latexWidth === "natural";
    let widthPt = natural ? NATURAL_PROBE_PT : el.dataset.latexWidth ? parseInt(el.dataset.latexWidth) : el.clientWidth / ZOOM || DEFAULT_WIDTH_PT;
    const cache = {
      bcs: null,
      dom: null,
      layout: null,
      stats: null,
      blockEl: el,
      blockKey: newBlockKey(),
      relayout: () => {
        if (blockData.get(el)) {
          blockData.get(el).lastWidth = -1;
          reflowBlock(el);
        }
      }
    };
    const data = {
      doc,
      fontInfo,
      lastWidth: widthPt,
      lastAlign: params.align,
      params,
      cache,
      painted: false,
      seq: ++docSeq,
      el
    };
    blockData.set(el, data);
    docData.set(doc, data);
    allData.push(data);
    inspectable.add(el);
    if (doc.slots && doc.slots.length) {
      slotBlocks.add(el);
      applySlots(fontInfo, doc);
    }
    el.replaceChildren(layoutDocument(fontInfo, doc, widthPt, params, cache));
    if (natural) {
      widthPt = data.naturalPt = naturalWidthPt(el, fontInfo, cache, widthPt);
      data.lastWidth = widthPt;
      el.style.width = widthPt * ZOOM + "px";
      el.replaceChildren(layoutDocument(fontInfo, doc, widthPt, params, cache));
    }
    remeasureStreams(fontInfo, doc, widthPt, params, cache);
    if (doc.outline && doc.outline.length) {
      const entries = doc.outline.map((e) => ({
        kind: e.kind || "",
        env: e.env || "",
        level: e.level || 0,
        number: e.number || "",
        title: e.title || "",
        id: (doc.anchors || [])[(e.anchor || 0) - 1] || null
      }));
      el.reflowtexOutline = entries;
      el.dispatchEvent(new CustomEvent("reflowtex:outline", { bubbles: true, detail: { block: el, entries } }));
    }
    const t3 = performance.now();
    paintVisibleNow(fontInfo, cache);
    data.painted = true;
    announceLayout(el);
    registerBlock(data);
    observedBlocks.add(el);
    const t4 = performance.now();
    ro.observe(el);
    const segTotal = cache.dom.segs.length;
    const segPainted = cache.dom.segs.reduce((n, s) => n + (s.painted ? 1 : 0), 0);
    return {
      decode: t1 - t0,
      fonts: t2 - t1,
      layout: t3 - t2,
      paint: t4 - t3,
      total: t4 - t0,
      segTotal,
      segPainted
    };
  }
  var installed = false;
  function installPage() {
    if (installed) return;
    installed = true;
    installColorMaps();
    installFootnotes();
    installViewerStyles();
    installLinks();
    installWidgetStates();
    loadSchema();
    loadFontMap();
  }
  var watchingFonts = false;
  function watchFonts() {
    if (watchingFonts || !fontsPending || !document.fonts) return;
    watchingFonts = true;
    if (document.fonts.addEventListener) document.fonts.addEventListener("loadingdone", scheduleFontRepaint);
    if (document.fonts.ready) document.fonts.ready.then(scheduleFontRepaint);
  }
  var rendering = /* @__PURE__ */ new WeakMap();
  function renderOnce(el) {
    if (blockData.get(el)) return Promise.resolve(null);
    let p = rendering.get(el);
    if (!p) {
      p = initBlock(el).finally(() => rendering.delete(el));
      rendering.set(el, p);
    }
    return p;
  }
  async function mountBlock(el) {
    installPage();
    await renderOnce(el);
    watchFonts();
  }
  async function init() {
    const blocks2 = [...document.querySelectorAll("[data-nodelist-b64]")];
    if (blocks2.length === 0) return;
    const tStart = performance.now();
    installPage();
    let idx = 0, segPainted = 0, segTotal = 0;
    for (const el of blocks2) {
      try {
        const t = await renderOnce(el);
        if (!t) continue;
        segPainted += t.segPainted;
        segTotal += t.segTotal;
        debugLog(`[latex-viewer] block ${++idx}/${blocks2.length}: ${t.total.toFixed(1)} ms (decode ${t.decode.toFixed(1)}, fonts ${t.fonts.toFixed(1)}, layout ${t.layout.toFixed(1)}, paint ${t.paint.toFixed(1)}) – ${t.segPainted}/${t.segTotal} segments painted`);
      } catch (e) {
        el.textContent = `Render error: ${e.message}`;
        console.error(e);
      }
    }
    const segDeferred = segTotal - segPainted;
    debugLog(`[latex-viewer] ${blocks2.length} block(s) in ${(performance.now() - tStart).toFixed(1)} ms · ${segPainted}/${segTotal} segments painted` + (segDeferred ? `, ${segDeferred} deferred (painted on scroll)` : ""));
    watchFonts();
  }
  function destroyBlock(el) {
    const data = blockData.get(el);
    if (!data) return;
    closeFootnote();
    removeMarginNotes(data);
    disposeSurfaces(el);
    disposeHosts(data.cache);
    disposePieces(data.cache);
    unobserveAll(data.cache);
    ro.unobserve(el);
    observedBlocks.delete(el);
    slotBlocks.delete(el);
    inspectable.delete(el);
    const i = allData.indexOf(data);
    if (i >= 0) allData.splice(i, 1);
    docData.delete(data.doc);
    blockData.delete(el);
    unregisterBlock(el);
    el.replaceChildren();
    el.style.removeProperty("width");
    el.style.removeProperty("padding-bottom");
  }

  // src/index.js
  function installViewerStyles() {
    const st = document.createElement("style");
    st.textContent = `
      /* One TeX point in CSS px, for styles that size by TeX's measures. */
      :root { --latex-pt: ${ZOOM}px; }
      /* Margin notes (placeMarginNotes): the layer is the block's, the notes
         beside it; where there is no room, a mark in the text opens one. */
      .latex-margin { position: absolute; left: 0; top: 0; width: 0; height: 0; }
      .latex-margin-note { position: absolute; }
      .latex-margin-note .latex-block { margin: 0; }
      .latex-margin-mark { position: absolute; transform: translate(-15%, -120%); margin: 0; padding: 0 .15em;
        border: 0; border-radius: 3px; background: none; color: inherit; opacity: .7; cursor: pointer;
        font: 600 .75em/1 ui-sans-serif, system-ui, sans-serif; }
      .latex-margin-mark:hover, .latex-margin-mark:focus-visible { opacity: 1; background: color-mix(in srgb, currentColor 10%, transparent); }
      .latex-margin-mark[hidden], .latex-margin-note[hidden] { display: none; }
      @media print {
        .latex-margin { display: none; }
        /* Controls do nothing on paper. More specific than the page's
           .latex-block svg .latex-link colour rule, which is also !important. */
        .latex-block svg .latex-link.latex-action { fill: transparent !important; }
      }
    `;
    document.head.appendChild(st);
  }
  installHost();
  document.addEventListener("DOMContentLoaded", init);
})();
