// SPDX-License-Identifier: AGPL-3.0-or-later
// reflowtex/companion – the browser side of the companion package
// (src/latex/reflowtex.sty). Import it on a page, and its kinds are drawn by
// it (the accordion, the hint, leanproof and leantheorem); import from it to draw kinds of one's own:
//
//   import { define, defineInline, Typeset, html } from 'reflowtex/companion';
//
//   define('warning', () => html`              a block (or a margin note)
//     <p class="warning-title">Warning</p>
//     <${Typeset} />`);
//   defineInline('badge', { size, View })       a widget in a line of text
//
// Preact, htm and Preact Signals are re-exported, so a page's own components
// use the same copy. Types: src/companion/src/*.ts, and the viewer's host
// API in src/viewer/src/host/types.ts.
import { h } from 'preact';
import htm from 'htm';
import { define } from './define.tsx';
import { Accordion } from './kinds/accordion.tsx';
import { LeanProof, LeanTheorem } from './kinds/lean.tsx';
import { Hint } from './kinds/hint.tsx';
import { ReadingButton, ReadingOptions } from './reading.tsx';
import { registerElement } from './mount.ts';

export { h, render, Fragment, Component, createContext } from 'preact';
export { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, useContext } from 'preact/hooks';
export { signal, computed, effect, batch, useSignal, useComputed, useSignalEffect } from '@preact/signals';
/** HTML-like templates for components without a build step: html`<div>…</div>`. */
export const html = htm.bind(h);

export { onHost, whenHost } from './host.ts';
export type * from './host.ts';
export { define, defineInline, type BlockProps, type BlockOptions, type PieceProps } from './define.tsx';
export { Typeset, type TypesetProps } from './typeset.tsx';
export { useInstance, useAttrs, useHost, useBlockHost, useNoteHost, usePiece, useInstanceState, useAction, InstanceContext, type Action } from './context.ts';
export { readMotion, animateHeight, fadeIn, fadeOut, type Motion } from './motion.ts';
export { Accordion, findPane } from './kinds/accordion.tsx';
export { LeanProof, LeanTheorem, LeanCode, highlightLean } from './kinds/lean.tsx';
export { Hint } from './kinds/hint.tsx';
export { InlineButton, PILL, Popover } from './controls.tsx';
export { reading, ReadingOptions, ReadingButton, THEMES, WIDTHS, type Theme, type ReadingOptionsProps } from './reading.tsx';
export { registerElement, mountAll } from './mount.ts';

// The package's own kinds. A page may draw one differently: define
// again, with its own component.
define('accordion', Accordion);
define('leanproof', LeanProof);
define('leantheorem', LeanTheorem);
define('hint', Hint);

// Its elements declared in HTML (mount.ts): <div data-rtx="reading-button">.
registerElement('reading-button', ReadingButton);
registerElement('reading-options', ReadingOptions);
