// SPDX-License-Identifier: AGPL-3.0-or-later

// ── Work still to come ───────────────────────────────────────────────────────
// Much of what the viewer does waits: for a frame (a reflow after a resize, the
// repaint once the web fonts are in, the selection's bands), for a timer (the
// settling pass after a resize), for a promise (a block's set-up, a face to
// load). Each of these goes through here, named, so that a tool can ask
// whether anything is still to come, and wait until nothing is: a test
// harness, instead of waiting a fixed time and hoping (inspect.idle,
// host/inspect.js). Frames can be held back for seconds on a busy machine, so
// no fixed time is ever enough.

const waiting = new Map();      // a token → its name
const frameTokens = new Map();  // a frame's id → its token, while it waits
const timerTokens = new Map();  // a timer's id → its token, while it waits

/** requestAnimationFrame, counted. Returns the frame's id (for cancelFrame). */
export function frame(name, cb) {
    const token = { name };
    waiting.set(token, name);
    const id = requestAnimationFrame(t => { waiting.delete(token); frameTokens.delete(id); cb(t); });
    frameTokens.set(id, token);
    return id;
}
export function cancelFrame(id) {
    const token = frameTokens.get(id);
    if (token) { waiting.delete(token); frameTokens.delete(id); }
    cancelAnimationFrame(id);
}

/** setTimeout, counted. Returns the timer's id (for cancelLater). */
export function later(name, cb, ms) {
    const token = { name };
    waiting.set(token, name);
    const id = setTimeout(() => { waiting.delete(token); timerTokens.delete(id); cb(); }, ms);
    timerTokens.set(id, token);
    return id;
}
export function cancelLater(id) {
    const token = timerTokens.get(id);
    if (token) { waiting.delete(token); timerTokens.delete(id); }
    clearTimeout(id);
}

/** A promise, counted until it settles. Returns it. */
export function track(name, promise) {
    const token = { name };
    waiting.set(token, name);
    promise.finally(() => waiting.delete(token)).catch(() => {});
    return promise;
}

/** The names of what is still to come: what waits here, a web font still
 *  loading, and an animation still running on the page (a Web Animation or a
 *  CSS transition – the companion's panes and hints ease with them); one that
 *  never ends, a spinner, is not waited for. */
export function pending() {
    const names = [...waiting.values()];
    if (document.fonts && document.fonts.status !== 'loaded') names.push('fonts loading');
    for (const a of document.getAnimations ? document.getAnimations() : []) {
        if (a.playState === 'running' && a.effect && a.effect.getComputedTiming().endTime !== Infinity)
            names.push(`animation ${a.animationName || a.transitionProperty || a.id || ''}`.trim());
    }
    return names;
}

/** Resolves once nothing is to come, over three frames running. Frames,
 *  because some work starts only in one: a ResizeObserver reports in the
 *  frame after a size changed, an IntersectionObserver in a task after it
 *  (hence the task after each frame), and an animation may begin a frame or
 *  two after what started it. Three, so that what one frame started is seen
 *  by a later look. */
export async function idle() {
    for (let quiet = 0; quiet < 3;) {
        await new Promise(r => requestAnimationFrame(r));
        await new Promise(r => setTimeout(r, 0));
        quiet = pending().length ? 0 : quiet + 1;
    }
}
