// SPDX-License-Identifier: AGPL-3.0-or-later

// ── Sliced layout ─────────────────────────────────────────────────────────────
// A block's re-break (its first layout, a width change, new live text) used to
// lay out every segment in one go: on a long block, a task of a hundred
// milliseconds and more, the page frozen meanwhile. Sliced, the layout lays out
// only the segments on the screen at once (layoutDocument, cache.sliced), and
// leaves every other segment it would have laid out *pending*: deferred, with
// its old geometry or an estimate. Those are then laid out here, nearest the
// screen first, in slices of idle time (requestIdleCallback; where there is
// none, a task after a frame), each slice within SLICE_MS. Painting follows the
// same order: the segments within a viewport of the screen, which the
// synchronous path paints at once, are painted in slices too, as is what the
// IntersectionObserver finds near the screen on a first visit (visibility.ts).
//
// A pending segment's height changes when it is laid out, and the content
// below it moves; above the reader, the browser's scroll anchoring holds the
// reading point (the layout's spacers and boxes are built for it, see
// layoutDocument), as it does for any reflow. The viewer never scrolls the
// page itself. A host that keeps the reader's place its own way listens to
// the events: each is sent in the same task as the change it reports, before
// the browser draws it.
//
// Events, on the block element (bubbling; Block.on in the host API):
//   reflowtex:layoutstart     a block has layout work left for later
//   reflowtex:layoutslice     a slice has laid out or painted some of it
//                             (detail.left: how many segments remain)
//   reflowtex:layoutcomplete  none is left: the block is as a synchronous
//                             layout would have left it
// A layout started while one is under way (the width changed again) carries
// on the same run: one layoutstart, one layoutcomplete. Block.layoutDone()
// resolves on layoutcomplete (at once when nothing is left); inspect.idle()
// waits for it too. The final step of a run lays the block out once more,
// every segment now from its cache, so that each segment's spacing and its
// rounding onto the layout grid are what one synchronous pass gives.
//
// Synchronous layout, as before slicing, is kept for a block that asks for it
// (data-latex-layout="sync", host.mount(el, { layout: 'sync' })) or for every
// block (host.setLayout('sync')), and for a block as wide as its text
// (data-latex-width="natural"). Print lays out and paints everything first.

import { layoutDocument, materializeSegment } from '../engine/layout/document.ts';
import { paintSegment } from '../engine/paint.ts';
import { blockData } from './blocks.ts';
import { announceLayout } from './block-data.ts';
import { frame, idleTask, track } from './pending.ts';
import type { Deadline } from './pending.ts';
import type { BlockData } from './block-data.ts';
import type { DomSegment, LayoutCache } from '../engine/layout/types.ts';
import type { Params } from './params.ts';

export type LayoutMode = 'sliced' | 'sync';

export const SLICE_MS = 8;

let pageMode: LayoutMode = 'sliced';
/** host.setLayout: the page's default. */
export function setPageLayout(mode: LayoutMode): void {
    if (mode !== 'sliced' && mode !== 'sync') throw new TypeError(`layout: 'sliced' or 'sync', not ${JSON.stringify(mode)}`);
    pageMode = mode;
    if (mode === 'sync') for (const data of [...runs.keys()]) flushBlock(data);
}
export const pageLayout = (): LayoutMode => pageMode;

/** Whether a block's layouts are sliced. */
export function slicedFor(data: BlockData | null | undefined): boolean {
    if (!data || data.naturalPt || data.el.dataset.latexWidth === 'natural') return false;
    // (its own setting, else the nearest element's above it, <html> included)
    const near = data.el.closest('[data-latex-layout]');
    const own = data.layoutMode || (near && near.getAttribute('data-latex-layout'));
    return (own === 'sync' || own === 'sliced' ? own : pageMode) === 'sliced';
}

/** layoutDocument for a block, sliced or not as the block is. */
export function layoutBlock(data: BlockData, widthPt: number, params: Params): HTMLElement {
    const cache = data.cache;
    cache.sliced = cache.lastSliced = slicedFor(data);
    try { return layoutDocument(data.fontInfo, data.doc, widthPt, params, cache); }
    finally { cache.sliced = false; }
}

// ── The queue ─────────────────────────────────────────────────────────────────
// Jobs, nearest the screen first: { data, cache, i, kind: 'layout' | 'paint',
// gen, dist }. A job is stale when its block has started another layout since
// (gen), when its segment no longer needs it, or when its block is gone.
interface Job {
    data: BlockData;
    cache: LayoutCache;
    i: number;
    kind: 'layout' | 'paint';
    /** The run's layout it belongs to; none for a paint the observer asked for. */
    gen?: number;
    dist: number;
}
interface Run { gen: number; resolve: () => void; promise: Promise<void>; left: number }
let queue: Job[] = [];
let scheduled = false;
let drained: { promise: Promise<void>; done: () => void } | null = null;   // resolves when the queue is empty (counted by pending.ts)
const runs = new Map<BlockData, Run>();      // a block's data → its run

const vh = () => window.innerHeight || 800;
const needsPaint = (s: DomSegment | undefined): boolean => !!s && !!s.svg && (!s.painted || !!s.dirty);

function schedule() {
    if (scheduled || (!queue.length && !runs.size)) return;
    scheduled = true;
    if (!drained) {
        let done!: () => void;
        const promise = new Promise<void>(r => { done = r; });
        drained = { promise, done };
        track('layout slices', drained.promise);
    }
    idleTask('layout slice', slice, { fallbackMs: SLICE_MS - 2 });
}

function settleDrained() {
    if (!queue.length && !runs.size && !scheduled && drained) { const d = drained; drained = null; d.done(); }
}

function live(job: Job): boolean {
    const run = runs.get(job.data);
    if (blockData.get(job.data.el) !== job.data) return false;
    if (job.gen !== undefined && (!run || run.gen !== job.gen)) return false;
    return true;
}

function runJob(job: Job): boolean {
    const cache = job.cache, laid = cache.layout && cache.layout.laid;
    const s = cache.dom && cache.dom.segs[job.i];
    if (!laid || !s) return false;
    if (job.kind === 'layout') {
        if (!laid[job.i] || !laid[job.i].pending) return false;
        materializeSegment(cache, job.i);
        return true;
    }
    // A paint: only what is still near the screen and not yet drawn as laid
    // out (what was scrolled away from is painted when it comes back).
    if (!needsPaint(s) || s.intersecting === false) return false;
    paintSegment(cache.fontInfo!, cache, job.i);
    return true;
}

function slice(deadline: Deadline): void {
    scheduled = false;
    const t0 = performance.now();
    const budget = deadline.didTimeout ? SLICE_MS / 2 : Math.min(SLICE_MS, Math.max(1, deadline.timeRemaining()));
    const touched = new Set<BlockData>();
    let did = 0;
    while (queue.length && (did === 0 || performance.now() - t0 < budget)) {
        const job = queue.shift()!;
        if (!live(job)) continue;
        if (runJob(job)) { did++; touched.add(job.data); }
    }
    for (const data of runs.keys()) if (!touched.has(data) && leftOf(data) === 0) touched.add(data);
    for (const data of touched) afterSlice(data);
    const ms = performance.now() - t0;
    stats.slices++;
    stats.jobs += did;
    if (ms > stats.longest) stats.longest = ms;
    schedule();
    settleDrained();
}
const stats = { slices: 0, jobs: 0, longest: 0, finish: 0 };   // (inspect.slices: since the page loaded)

function leftOf(data: BlockData): number {
    let n = 0;
    for (const j of queue) if (j.data === data && j.gen !== undefined && live(j)) n++;
    return n;
}

function afterSlice(data: BlockData): void {
    const run = runs.get(data);
    if (!run) { announce(data); return; }
    const left = leftOf(data);
    run.left = left;
    if (left) {
        dispatch(data.el, 'layoutslice', { left });
        announce(data);
        return;
    }
    finishRun(data);
}

// No job left: lay the block out once more, every segment from its cache
// (or, should one have been invalidated meanwhile, a new pass), then say so.
function finishRun(data: BlockData): void {
    const run = runs.get(data);
    if (!run) return;
    const params = { ...data.params, align: data.lastAlign };
    const t0 = performance.now();
    layoutBlock(data, data.lastWidth, params);
    stats.finish = Math.max(stats.finish, performance.now() - t0);
    const more = collect(data, run.gen, false);
    if (more.length) { enqueue(more); dispatch(data.el, 'layoutslice', { left: more.length }); return; }
    dispatch(data.el, 'layoutslice', { left: 0 });
    runs.delete(data);
    announceLayout(data.el);
    dispatch(data.el, 'layoutcomplete', {});
    run.resolve();
}

// (quick: the accessible layer is placed a few times a second, not per slice)
function announce(data: BlockData): void { announceLayout(data.el, true); }

function dispatch(el: HTMLElement, name: string, detail: object): void {
    el.dispatchEvent(new CustomEvent('reflowtex:' + name, { bubbles: true, detail: { block: el, ...detail } }));
}

function enqueue(jobs: Job[]): void {
    if (!jobs.length) return;
    queue.push(...jobs);
    queue.sort((a, b) => a.dist - b.dist || (a.kind === b.kind ? 0 : a.kind === 'layout' ? -1 : 1));
    schedule();
}

// The jobs a block's layout left: its pending segments, and the segments
// within a viewport of the screen still to be painted, nearest first.
// Distances are the layout's own estimate of where each segment stands
// (L.estTop: in the window, from the block's top and the heights above):
// reading the boxes' rects would make the browser lay the page out again,
// in this task, for an order.
function collect(data: BlockData, gen: number, paints = true): Job[] {
    const cache = data.cache, laid = cache.layout && cache.layout.laid, segs = cache.dom && cache.dom.segs;
    if (!laid || !segs) return [];
    const jobs: Job[] = [], h = vh();
    for (let i = 0; i < laid.length; i++) {
        const s = segs[i], L = laid[i];
        if (!s || !s.svg || !L) continue;
        const near = paints && needsPaint(s) && s.intersecting !== false;
        if (!L.pending && !near) continue;
        const top = L.estTop ?? 0, bottom = top + (L.H || 0);
        const dist = bottom < 0 ? -bottom : top > h ? top - h : 0;
        if (L.pending) jobs.push({ data, cache, i, kind: 'layout', gen, dist });
        if (near && dist < h) jobs.push({ data, cache, i, kind: 'paint', gen, dist });
    }
    return jobs;
}

/** After a sliced layout of a block (and its paint of what is on the screen):
 *  queue what it left. Starts a run, or carries on the one under way. */
export function startSlices(data: BlockData): void {
    if (!data.cache.layout) return;
    let run = runs.get(data);
    const gen = (run ? run.gen : 0) + 1;
    const jobs = collect(data, gen);
    if (!jobs.length && !run) return;
    if (!run) {
        let resolve!: () => void;
        const promise = new Promise<void>(r => { resolve = r; });
        run = { gen, resolve, promise, left: 0 };
        runs.set(data, run);
        dispatch(data.el, 'layoutstart', {});
    }
    run.gen = gen;
    run.left = jobs.length;
    // (the jobs of the layout before are stale now: dropped when reached)
    queue = queue.filter(j => j.data !== data || j.gen === undefined);
    if (jobs.length) enqueue(jobs);
    else schedule();          // (nothing left: the run is finished in the next slice)
}

/** A segment the IntersectionObserver found near the screen, but not on it:
 *  painted in a slice. */
export function paintLater(data: BlockData, cache: LayoutCache, i: number, dist: number): void {
    enqueue([{ data, cache, i, kind: 'paint', dist }]);
}

// The reader may scroll onto a segment before its slice comes: in the next
// frame, what is on the screen and still waits to be painted is painted (laid
// out first, if it is pending), as the observer would have painted it.
let scrollCheck = 0;
function onScroll(): void {
    if (scrollCheck || !queue.some(j => j.kind === 'paint')) return;
    scrollCheck = frame('slices: on the screen', () => { scrollCheck = 0; paintOnScreen(); });
}
document.addEventListener('scroll', onScroll, { capture: true, passive: true });
function paintOnScreen(): void {
    const h = vh(), now: Job[] = [];
    for (const job of queue) {
        if (job.kind !== 'paint' || !live(job)) continue;
        const seg = job.cache.dom && job.cache.dom.segs[job.i];
        if (!seg || !seg.svg || !seg.svg.isConnected) continue;
        const r = seg.svg.getBoundingClientRect();
        if (r.bottom > 0 && r.top < h) now.push(job);
    }
    if (!now.length) return;
    queue = queue.filter(j => !now.includes(j));
    const touched = new Set<BlockData>();
    for (const job of now) if (runJob(job)) touched.add(job.data);
    for (const data of touched) afterSlice(data);
    settleDrained();
}

/** Block.layoutDone. */
export function layoutDone(data: BlockData): Promise<void> {
    const run = runs.get(data);
    return run ? run.promise : Promise.resolve();
}

/** Everything a block has left, now (print, Block.flushLayout). */
export function flushBlock(data: BlockData): void {
    for (let round = 0; round < 8; round++) {
        const mine = queue.filter(j => j.data === data);
        queue = queue.filter(j => j.data !== data);
        for (const job of mine) if (live(job)) runJob(job);
        if (!runs.has(data)) break;
        finishRun(data);                  // (a new pass may have left more)
        if (!runs.has(data)) break;
    }
    settleDrained();
}
export function flushAll(): void {
    for (const data of new Set(queue.map(j => j.data))) flushBlock(data);
    for (const data of [...runs.keys()]) flushBlock(data);
}

/** From destroyBlock: drop what the block had left; its run ends, unreported. */
export function dropSlices(data: BlockData): void {
    queue = queue.filter(j => j.data !== data);
    const run = runs.get(data);
    if (run) { runs.delete(data); run.resolve(); }
    settleDrained();
}

/** For tests and tools: what is left, per block element, and how many
 *  slices ran and the longest (ms), and the longest last pass of a run
 *  (`finish`, ms, part of its slice); `reset`: those counted afresh after. */
export interface SliceState {
    queued: number; slices: number; jobs: number; longest: number; finish: number;
    runs: { block: HTMLElement; gen: number; left: number }[];
}
export function sliceState(reset = false): SliceState {
    const counted = { ...stats };
    if (reset) Object.assign(stats, { slices: 0, jobs: 0, longest: 0, finish: 0 });
    return { queued: queue.length, ...counted, runs: [...runs].map(([d, r]) => ({ block: d.el, gen: r.gen, left: r.left })) };
}
