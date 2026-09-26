// SPDX-License-Identifier: AGPL-3.0-or-later
// reflowtex/companion – the browser side of the companion package
// (src/latex/reflowtex.sty). Import it on a page, and its kinds are drawn by
// it (the accordion, so far); import from it to draw kinds of one's own:
//
//   import { defineBlock, Typeset, useAttrs, html } from 'reflowtex/companion';
//
//   defineBlock('warning', () => html`
//     <p class="warning-title">Warning</p>
//     <${Typeset} />`);
//
// Preact, htm and Preact Signals are re-exported, so a page's own components
// use the same copy. Types: src/companion/src/*.ts, and the viewer's host
// API in src/viewer/src/host/types.ts.
import { h } from 'preact';
import htm from 'htm';
import { defineBlock } from './define.tsx';
import { Accordion } from './kinds/accordion.tsx';

export { h, render, Fragment, Component, createContext } from 'preact';
export { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, useContext } from 'preact/hooks';
export { signal, computed, effect, batch, useSignal, useComputed, useSignalEffect } from '@preact/signals';
/** HTML-like templates for components without a build step: html`<div>…</div>`. */
export const html = htm.bind(h);

export { onHost, whenHost } from './host.ts';
export type * from './host.ts';
export { defineBlock, type BlockProps, type BlockOptions } from './define.tsx';
export { Typeset, type TypesetProps } from './typeset.tsx';
export { useInstance, useAttrs, useBlockHost, useInstanceState, useAction, InstanceContext, type Action } from './context.ts';
export { readMotion, type Motion } from './motion.ts';
export { Accordion, findPane } from './kinds/accordion.tsx';
export { widget, Aside, InlineButton, PILL, Popover, marginNote } from './legacy.ts';

// The package's own kinds. A page may draw one differently: defineBlock
// again, with its own component.
defineBlock('accordion', Accordion);
