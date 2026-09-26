// SPDX-License-Identifier: AGPL-3.0-or-later
// A colour picker of the panel's own, in place of the browser's (the system
// dialog on a Mac is a separate window, far from the colour it edits): a
// swatch button opening a small popover with a saturation/brightness square,
// a hue strip, the hex, and the colours already in the map to pick from.
// Dragging edits live; Escape puts back the colour it opened with.
import { html, useState, useRef, useEffect } from '../vendor/preact.js';

const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

export function hexToHsv(hex) {
    const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
    let h = 0;
    if (d) h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: h * 60, s: max ? d / max : 0, v: max };
}
export function hsvToHex({ h, s, v }) {
    const f = k => { const x = (k + h / 60) % 6; return v - v * s * clamp(Math.min(x, 4 - x)); };
    return '#' + [f(5), f(3), f(1)].map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
}

// Pointer drags on an element: fn(x, y) in 0..1 of its box.
function drag(el, fn) {
    return e => {
        e.preventDefault();
        el.current.setPointerCapture(e.pointerId);
        const at = ev => { const r = el.current.getBoundingClientRect();
            fn(clamp((ev.clientX - r.left) / r.width), clamp((ev.clientY - r.top) / r.height)); };
        at(e);
        const move = ev => at(ev), up = () => { el.current.removeEventListener('pointermove', move); el.current.removeEventListener('pointerup', up); };
        el.current.addEventListener('pointermove', move);
        el.current.addEventListener('pointerup', up);
    };
}

function Popover({ value, swatches, onInput, onClose, anchor }) {
    const start = useRef(value);
    const [hsv, setHsv] = useState(() => hexToHsv(HEX.test(value) ? value : '#000000'));
    const [text, setText] = useState(value);
    const box = useRef(null), sv = useRef(null), hue = useRef(null);
    const set = next => { setHsv(next); const hex = hsvToHex(next); setText(hex); onInput(hex); };
    const setHex = hex => { if (!HEX.test(hex)) return; setHsv(hexToHsv(hex)); setText(hex.toLowerCase()); onInput(hex.toLowerCase()); };

    // Placed below the swatch (above, when there is no room), inside the
    // panel. The panel is a size container, so it (not the window) is what
    // position: fixed is relative to, and it clips: the offset of the box
    // drawn at 0, 0 turns window coordinates into the panel's.
    const [pos, setPos] = useState(null);
    useEffect(() => {
        const r = anchor.getBoundingClientRect(), o = box.current.getBoundingClientRect();
        const p = (box.current.closest('.rtx') || document.documentElement).getBoundingClientRect();
        const w = o.width, h = o.height;
        const top = r.bottom + 4 + h > p.bottom ? Math.max(p.top + 4, r.top - 4 - h) : r.bottom + 4;
        const left = clamp(r.left, p.left + 4, Math.max(p.left + 4, p.right - w - 4));
        setPos({ left: left - o.left, top: top - o.top });
        const outside = e => { if (!e.composedPath().includes(box.current) && !e.composedPath().includes(anchor)) onClose(); };
        document.addEventListener('pointerdown', outside, true);
        box.current.querySelector('.pk-sv').focus();
        return () => document.removeEventListener('pointerdown', outside, true);
    }, []);
    const keys = e => {
        if (e.key === 'Escape') { e.stopPropagation(); onInput(start.current); onClose(); return; }
        if (e.key === 'Enter' && e.target.tagName !== 'INPUT') { onClose(); return; }
        const step = e.shiftKey ? 0.1 : 0.02, d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
        if (!d || e.target.tagName === 'INPUT') return;
        e.preventDefault();
        if (e.target.classList.contains('pk-hue')) set({ ...hsv, h: clamp(hsv.h + (d[0] || d[1]) * step * 360, 0, 360) });
        else set({ ...hsv, s: clamp(hsv.s + d[0] * step), v: clamp(hsv.v + d[1] * step) });
    };
    const pure = hsvToHex({ h: hsv.h, s: 1, v: 1 });
    return html`<div ref=${box} class="picker" role="dialog" aria-label="Colour" onKeyDown=${keys}
                     style=${pos ? { left: pos.left + 'px', top: pos.top + 'px' } : { left: 0, top: 0, visibility: 'hidden' }}>
        <div ref=${sv} class="pk-sv" tabindex="0" role="slider" aria-label="Saturation and brightness"
             aria-valuetext=${`saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
             style=${{ backgroundColor: pure }} onPointerDown=${drag(sv, (x, y) => set({ ...hsv, s: x, v: 1 - y }))}>
            <i style=${{ left: hsv.s * 100 + '%', top: (1 - hsv.v) * 100 + '%', background: hsvToHex(hsv) }}></i>
        </div>
        <div ref=${hue} class="pk-hue" tabindex="0" role="slider" aria-label="Hue" aria-valuemin="0" aria-valuemax="360"
             aria-valuenow=${Math.round(hsv.h)} onPointerDown=${drag(hue, x => set({ ...hsv, h: x * 360 }))}>
            <i style=${{ left: hsv.h / 3.6 + '%', background: pure }}></i>
        </div>
        <div class="pk-row">
            <span class="pk-now" style=${{ background: hsvToHex(hsv) }}></span>
            <input type="text" class="pk-hex" value=${text} spellcheck="false" aria-label="Hex"
                   onInput=${e => { setText(e.currentTarget.value); setHex(e.currentTarget.value.trim()); }}
                   onKeyDown=${e => { if (e.key === 'Enter') onClose(); }}/>
        </div>
        ${swatches.length ? html`<div class="pk-swatches">${swatches.map(c => html`<button type="button" key=${c} title=${c}
            style=${{ background: c }} onClick=${() => setHex(c)}></button>`)}</div>` : null}
    </div>`;
}

/** A swatch button that opens the picker. value: #rrggbb (else `fallback`
 *  is shown); onInput(hex) on every change; swatches: colours to offer. */
export function ColourPicker({ value, fallback = '#000000', swatches = [], title, onInput }) {
    const [open, setOpen] = useState(false);
    const btn = useRef(null);
    const shown = value && HEX.test(value) ? value : fallback;
    return html`<button ref=${btn} type="button" class="pk-swatch" title=${title} aria-haspopup="dialog" aria-expanded=${open}
                        style=${{ background: shown }} onClick=${() => setOpen(!open)}></button>
        ${open ? html`<${Popover} value=${shown} swatches=${swatches} onInput=${onInput} anchor=${btn.current}
                                  onClose=${() => { setOpen(false); btn.current && btn.current.focus(); }}/>` : null}`;
}
