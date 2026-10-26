// SPDX-License-Identifier: AGPL-3.0-or-later
// Reflow TeX inspector – the page-side half (see README.md).
//
// Runs in the inspected page, where it installs window.__rtxInspector: the
// inspector's panel (panel/bridge.js) loads it as a script, and any other tool – a
// browser devtools panel, a test – may evaluate it there. Everything a panel
// shows comes from here as plain JSON; everything drawn on the page (the
// overlay) is drawn from here. It reads the viewer through window.reflowtex.inspect – the viewer's
// own geometry, replayed without touching the DOM – and never changes what
// the viewer drew.
//
// The built agent.js ends by installing (build.sh), so the file's value, when
// evaluated as a script, is the result: 'ok', or 'no-api' when the page has
// no inspectable viewer yet. window.__rtxInspectorInstall() tries again.
//
// The parts: ids for what the panel names (ids.ts), resolved to the viewer's
// layout (resolve.ts) and measured (geometry.ts, rects.ts); described as
// rows (describe.ts, vspace.ts, format.ts) and as text (text.ts); drawn over
// the page (overlay.ts) and picked from it (pick.ts); the resources the
// blocks draw with (census.ts, resources.ts, fonts.ts), their colour maps
// (colours.ts) and their accessible layer (a11y.ts).
import { setInspect } from './context.ts';
import { blockId } from './ids.ts';
import { pathTo } from './paths.ts';
import { children, details, summary } from './describe.ts';
import { textOf, xmlOf } from './text.ts';
import { accessible } from './a11y.ts';
import { guidesPaints, listen, options, redraw, schedule, scrollIntoViewIfNeeded, state } from './overlay.ts';
import { elementOf, fromElement, startPick, stopPick } from './pick.ts';
import { fontGlyphs } from './fonts.ts';
import { openPopover, resource, resources, uses } from './resources.ts';
import { logBlock, logs } from './log.ts';
import { colourMaps, exportColourMaps, importColourMaps, resetColourMaps, setMapColour, setMapTint, setPageTheme } from './colours.ts';
import type { ViewerInspect } from './context.ts';
import type { AgentApi } from '../protocol.ts';

window.__rtxInspectorInstall = (): 'ok' | 'no-api' => {
const AGENT = 8;
const prev = window.__rtxInspector;
if (prev && prev.agent === AGENT) return 'ok';
const I = window.reflowtex && window.reflowtex.inspect as ViewerInspect | undefined;
// No viewer yet (or one that predates the inspection API): install nothing,
// so the panel can try again later.
if (!I) return 'no-api';
// Another copy (an older version, another tool's) gives way: its outlines go.
if (prev) try { prev.cancelPick(); prev.clear(); } catch { /* not ours to fix */ }
setInspect(I);
listen();

const api: AgentApi = {
    agent: AGENT,
    // Page-wide guides: { baselines, badness, springs, a11y }, any of them.
    setOptions(o) { Object.assign(options, o); redraw(); },
    // Draw the outlines again, for the layout as it is now (after a reflow).
    redraw() { redraw(); },
    // A fragment as XML (see "As text"): the node with this id and all it holds.
    xml: id => xmlOf(id).join('\n'),
    text: id => textOf(id),
    status: () => ((options.baselines || options.badness || options.springs) && guidesPaints !== I.paints && schedule(), {
        api: true, version: I.version, blocks: I.blocks().length, paints: I.paints, picking: state.picking, picked: state.picked && { id: state.picked.id, path: state.picked.path, seq: state.picked.seq },
    }),
    blocks: () => I.blocks().map(el => summary(blockId(el))),
    children, details,
    hover(id) { state.hovered = id; redraw(); },          // an id, a list of ids, or null
    // (scroll: false – a selection given back, which stays where it is)
    select(id, { scroll = true } = {}) { state.selected = id; redraw(); if (scroll) scrollIntoViewIfNeeded(id); },
    clear() { state.hovered = state.selected = null; state.marked = []; redraw(); },
    pick() { startPick(); return true; },
    cancelPick() { stopPick(); redraw(); },
    fromElement, elementOf,
    // The path to a block element (the panel's open(block)).
    blockPath: el => (I.state(el) ? [blockId(el as HTMLElement)] : null),
    // Resources (see "Resources"): the page's list; one in full; the ids of
    // its things on the current layout; a font's glyphs (a promise); the rows
    // down to an id; outlining a list of ids until told otherwise; opening a
    // footnote's popover.
    resources, resource, uses, fontGlyphs, pathTo,
    mark(ids) { state.marked = ids || []; redraw(); },
    // Accessibility: what the accessible layer holds for a row.
    accessible,
    openPopover, colourMaps, setPageTheme, setMapColour, setMapTint, importColourMaps, exportColourMaps, resetColourMaps,
    // The page's log (the Log tab): its records after a seq; a block's row by its key.
    logs, logBlock,
};
window.__rtxInspector = api;
return 'ok';
};
