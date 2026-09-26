// SPDX-License-Identifier: AGPL-3.0-or-later
// reflowtex-companion: the browser side of the companion package
// (src/latex/reflowtex.sty), on top of the viewer's public API. An ES module;
// pages import it by the name the site's import map gives it:
//
//   import { html, useState, widget, Aside, InlineButton, Popover }
//     from 'reflowtex/companion';
//
// It re-exports Preact, htm and Preact Signals (vendor/preact.js), so a page
// writes its own parts as components with HTML-like templates, and adds a
// few of its own:
//
//   widget(name, { size(ctx), render })  a \webwidget drawn by a component;
//                                        render gets { ctx, part }
//   <Aside aside width>                  a \webaside, typeset: width in px,
//                                        "natural" (one line; the default)
//                                        or "fill" (its container's width)
//   <InlineButton ctx onPress pressed class metrics>…</InlineButton>
//                                        a pill in a line of text, for a widget,
//                                        around anything (an <Aside>, say);
//                                        InlineButton.size(ctx, contentWidth)
//   <Popover anchor onClose>             a panel below an element, closed by
//                                        Escape, a click outside, or scrolling
//   marginNote(kind, Component)          draws the viewer's margin notes of a
//                                        kind (place=margin): Component gets
//                                        { aside, width }
//
// None of these needs another: an aside may go in a popover, a margin, or a
// widget; a widget may draw what it likes.
import { html, render, h, Fragment, useState, useEffect, useLayoutEffect, useRef, useMemo,
         useCallback, signal, computed, effect, batch, useSignal, useComputed } from './preact.js';
export { html, render, h, Fragment, useState, useEffect, useLayoutEffect, useRef, useMemo,
         useCallback, signal, computed, effect, batch, useSignal, useComputed };

const rtx = window.reflowtex = window.reflowtex || {};
rtx.widgets = rtx.widgets || {};

// ── Widgets ─────────────────────────────────────────────────────────────────
// A widget whose drawing is a component. size(ctx) → { width, height, depth }
// in px, as the viewer's widgets measure; the component is drawn in each part.
export function widget(name, { size, render: Component, splits }) {
    rtx.widgets[name] = {
        measure: ctx => ({ ...size(ctx), ...(splits ? { splits: splits(ctx) } : {}) }),
        render: (el, part, ctx) => render(html`<${Component} ctx=${ctx} part=${part} />`, el),
    };
    if (rtx.refreshWidgets) rtx.refreshWidgets();
}

// ── Asides ──────────────────────────────────────────────────────────────────
// An aside, typeset where the component stands. The viewer lays it out anew
// whenever the width changes.
export function Aside({ aside, width = 'natural', onDrawn }) {
    const ref = useRef(null);
    useLayoutEffect(() => {
        const el = ref.current;
        if (!aside || !el) return;
        let w = width === 'natural' ? undefined : width;
        if (width === 'fill') {
            const box = el.parentElement, cs = getComputedStyle(box);
            w = box.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        }
        const drawn = aside.render(el, w);
        if (onDrawn) onDrawn(drawn, el);
    }, [aside, width]);
    return html`<div class="rtx-aside" ref=${ref}></div>`;
}

// ── A button in a line of text ──────────────────────────────────────────────
// A pill for a widget, around its children. Its box is metrics.up em above the
// text's baseline and metrics.down below, and its content metrics.side em from
// either end; a typeset child (an <Aside>) has its baseline put on the text's.
// The look is CSS: the class rtx-button, its custom properties (see
// companion.css), and any class given as `class`.
export const PILL = { up: 0.9, down: 0.45, side: 0.55 };
export function InlineButton({ ctx, onPress, pressed, label, class: cls = '', metrics = PILL, children }) {
    const em = ctx.fontSize, inside = useRef(null);
    useLayoutEffect(() => {
        // Measured, not worked out: where the label's baseline is against where
        // it should be (metrics.up em below the button's top edge), the
        // content moved by the difference – whatever the border, zoom or
        // rounding in between.
        // A widget is drawn before the viewer puts it in the page: measure
        // once it is there.
        const fit = () => {
            const el = inside.current, box = el && el.querySelector('.latex-aside[data-baseline]');
            if (!box || !el.isConnected) return false;
            const button = el.parentElement, k = button.getBoundingClientRect().height / button.offsetHeight || 1;
            const want = button.getBoundingClientRect().top + metrics.up * em * k;
            const have = box.getBoundingClientRect().top + parseFloat(box.dataset.baseline) * k;
            el.style.top = (parseFloat(el.style.top) || 0) + (want - have) / k + 'px';
            return true;
        };
        if (!fit()) { const f = requestAnimationFrame(() => fit()); return () => cancelAnimationFrame(f); }
    });
    return html`
      <button type="button" class=${'rtx-button ' + cls} onClick=${onPress} aria-label=${label}
              aria-expanded=${pressed === undefined ? undefined : String(!!pressed)}>
        <span class="rtx-button-content" ref=${inside} style=${{ left: metrics.side * em + 'px' }}>${children}</span>
      </button>`;
}
InlineButton.size = (ctx, contentWidth, metrics = PILL) => {
    const em = ctx.fontSize;
    return { width: contentWidth + 2 * metrics.side * em, height: metrics.up * em, depth: metrics.down * em };
};

// ── A popover ───────────────────────────────────────────────────────────────
// A panel below `anchor` (an element), at the top of the page, with the
// children in it. Closed by Escape, a click outside it and the anchor, or
// scrolling; onClose is told, and the owner stops rendering it.
export function Popover({ anchor, onClose, children, className = '' }) {
    const host = useMemo(() => document.createElement('div'), []);
    useLayoutEffect(() => {
        document.body.appendChild(host);
        return () => { render(null, host); host.remove(); };
    }, [host]);
    useLayoutEffect(() => {
        render(html`<div class=${'rtx-popover ' + className} role="dialog">${children}</div>`, host);
        const panel = host.firstChild, r = anchor.getBoundingClientRect();
        panel.style.left = Math.max(8, Math.min(r.left, window.innerWidth - panel.offsetWidth - 8)) + 'px';
        panel.style.top = r.bottom + 6 + 'px';
    });
    // Before the first paint, so a key pressed as soon as it shows counts.
    useLayoutEffect(() => {
        const away = e => { if (!host.contains(e.target) && !anchor.contains(e.target)) onClose(); };
        const key = e => { if (e.key === 'Escape') { onClose(); anchor.focus && anchor.focus(); } };
        document.addEventListener('pointerdown', away);
        document.addEventListener('keydown', key);
        window.addEventListener('scroll', onClose, { passive: true });
        return () => {
            document.removeEventListener('pointerdown', away);
            document.removeEventListener('keydown', key);
            window.removeEventListener('scroll', onClose);
        };
    }, [anchor, onClose]);
    return null;
}

// ── Margin notes ────────────────────────────────────────────────────────────
// The viewer sets every aside with place=margin in the margin (or behind a
// mark, where there is none), drawing it plainly; this draws those of one
// kind with a component instead, given { aside, width }. Its <Aside> is the
// part whose baseline goes on the line.
export function marginNote(kind, Component) {
    rtx.marginNotes = rtx.marginNotes || {};
    rtx.marginNotes[kind] = (el, aside, width) => render(html`<${Component} aside=${aside} width=${width} />`, el);
}
