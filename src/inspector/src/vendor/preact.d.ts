// SPDX-License-Identifier: AGPL-3.0-or-later
// The panel's UI library as it imports it: '../vendor/preact.js', the
// vendored vendor/preact.js (make vendor-inspector), which the built panel
// modules import beside them. One ES module of Preact, htm and Preact
// Signals at the versions pinned there – the npm packages' own types, which
// are the same versions (package.json).
import type { VNode } from 'preact';

export { h, render, Fragment } from 'preact';
export { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'preact/hooks';
export { signal, computed, effect, batch, useSignal, useComputed, useSignalEffect } from '@preact/signals';
/** htm bound to Preact's h: a tagged template of markup, as JSX would be. */
export declare const html: (strings: TemplateStringsArray, ...values: unknown[]) => VNode | VNode[];
