// SPDX-License-Identifier: AGPL-3.0-or-later
// Render report: a render test's pageless PDF (TeX) on the left, the page the
// browser reflowed on the right, and every glyph or rule that does not match
// boxed in red on both (see README.md).
//
// Both sides are in the frame vector-compare.ts measures in: pt from the left
// edge of the margin and from the top of the block. strip.svg (MuPDF's drawing
// of the PDF, vectors) and viewer.png are sized 2 px per pt in it; the live page
// is pinned as dom-dump.ts pins it, where the viewer also draws 2 px per pt.
import { html, render, useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from '/inspector/vendor/preact.js';

const BUILD = '/build/';
const PX_PER_PT = 2;
const RED = '#d93025', AMBER = '#e37400', BLUE = '#0b57d0';

// ── Data ───────────────────────────────────────────────────────────────────────
const getJson = async url => { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); };
const f3 = x => x.toFixed(3);
const signed = x => `${x >= 0 ? '+' : ''}${f3(x)}`;
const widthLabel = e => (e ? `${e > 0 ? '+' : ''}${e} pt` : 'own width');

/** A glyph's box from its origin: `size` pt tall (the font's), `w` wide – the
 *  browser's measure of it; a picture's glyph has neither. */
function glyphBox(x, y, w, size) {
    const s = size || 7, ww = w || s * .55;
    return { x, y: y - s * .78, w: ww, h: s };
}
const shift = (b, dx, dy) => ({ ...b, x: b.x + dx, y: b.y + dy });

/** Everything that does not match at these thresholds, top to bottom: each
 *  with its box on the TeX side (`strip`), the browser's (`viewer`), or both. */
function mismatches(v, glyphThr, ruleThr, rulesAllowed) {
    const out = [];
    for (const m of v.matched ?? []) {
        const off = Math.max(Math.abs(m.dx), Math.abs(m.dy));
        if (off <= glyphThr) continue;
        const b = glyphBox(m.x, m.y, m.w, m.size);
        out.push({ k: 'g', what: `${JSON.stringify(m.text)} ${m.font ?? ''}`, y: m.y, note: `${signed(m.dx)}, ${signed(m.dy)}`, off, viewer: b, strip: shift(b, m.dx, m.dy) });
    }
    for (const g of v.viewer_unmatched ?? [])
        out.push({ k: '+', what: `${JSON.stringify(g.text)} browser only`, y: g.y, note: 'no TeX glyph', viewer: glyphBox(g.x, g.y, g.w, g.size) });
    for (const p of v.strip_unmatched ?? [])
        out.push({ k: '−', what: 'glyph TeX only', y: p.y, note: 'not drawn', strip: glyphBox(p.x, p.y, 0, 0) });
    for (const r of v.rules ?? []) {
        const b = { x: r.x ?? 0, y: r.y, w: r.w ?? 1, h: r.h ?? 1 };
        if (r.unmatched) out.push({ k: '+', what: 'rule browser only', y: r.y, note: `${r.w} × ${r.h}`, viewer: b });
        else if (r.off > ruleThr) out.push({ k: 'r', what: 'rule', y: r.y, note: `corners ${f3(r.off)}`, off: r.off, viewer: b, strip: shift(b, r.dx, r.dy) });
    }
    const missing = v.rules_missing ?? [];
    for (const r of missing)
        out.push({ k: '−', what: 'rule TeX only', y: r.y, note: 'not drawn', allowed: missing.length <= rulesAllowed,
                   strip: { x: r.x, y: r.y, w: r.w ?? 2, h: r.h ?? 2 } });
    const x = it => (it.viewer ?? it.strip).x;
    return out.sort((a, b) => a.y - b.y || x(a) - x(b));
}

/** The boxes of one side as SVG markup, in pt: at least 3 pt across and a
 *  point clear of what they mark, so a hairline or a dot shows. */
function boxesSvg(items, side, sel) {
    let s = '';
    items.forEach((it, i) => {
        const b = it[side];
        if (!b) return;
        const w = Math.max(b.w, 3), h = Math.max(b.h, 3);
        const x = b.x - (w - b.w) / 2 - 1, y = b.y - (h - b.h) / 2 - 1;
        const on = i === sel;
        const colour = on ? BLUE : it.allowed ? AMBER : RED;
        s += `<rect x="${x}" y="${y}" width="${w + 2}" height="${h + 2}" fill="${on ? 'rgba(11,87,208,.15)' : 'none'}" stroke="${colour}"` +
             ` stroke-width="${on ? 2.5 : 1.5}" vector-effect="non-scaling-stroke"${it.allowed ? ' stroke-dasharray="4 3"' : ''}/>`;
    });
    return s;
}

// ── Icons (the inspector's: 16px on a 20px grid) ─────────────────────────────────
const Svg = ({ children }) => html`<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">${children}</svg>`;
const stroke = { fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
const IconPrev = () => html`<${Svg}><path d="M12.5 4.5L7 10l5.5 5.5" ...${stroke}/><//>`;
const IconNext = () => html`<${Svg}><path d="M7.5 4.5L13 10l-5.5 5.5" ...${stroke}/><//>`;
const IconUp = () => html`<${Svg}><path d="M4.5 12.5L10 7l5.5 5.5" ...${stroke}/><//>`;
const IconDown = () => html`<${Svg}><path d="M4.5 7.5L10 13l5.5-5.5" ...${stroke}/><//>`;
const IconInspect = () => html`<${Svg}>
    <path d="M8.5 16.5h-4a2 2 0 0 1-2-2v-10a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v4" ...${stroke}/>
    <path d="M10 10l8 3.1-3.3 1.4-1.4 3.4z" fill="currentColor"/><//>`;
const IconReload = () => html`<${Svg}><path d="M15.5 10a5.5 5.5 0 1 1-1.6-3.9M15.5 3.5v3h-3" ...${stroke}/><//>`;
const IconArea = () => html`<${Svg}><rect x="3.5" y="4.5" width="13" height="11" rx="1" ...${stroke} stroke-dasharray="2.2 2"/><//>`;

const Seg = ({ value, options, onChange, title }) => html`<span class="seg" role="group" aria-label=${title} title=${title}>
    ${options.map(([v, label]) => html`<button type="button" aria-pressed=${String(v === value)} onClick=${() => onChange(v)}>${label}</button>`)}</span>`;

/** An error threshold in pt: what is further off is listed and boxed. Typed
 *  freely, applied when it is a number. */
function Threshold({ label, what, value, fallback, onChange }) {
    const [text, setText] = useState(String(value));
    useEffect(() => setText(String(value)), [value]);
    return html`<label class="field" title=${`${what} further off than this (pt) are listed and boxed; the case's ceiling is ${fallback}`}>${label}
        <input value=${text} inputmode="decimal" onInput=${e => { setText(e.target.value); const n = Number(e.target.value); if (e.target.value !== '' && n >= 0) onChange(n); }}/>
        ${value !== fallback ? html`<button type="button" class="reset" title="The case's ceiling" onClick=${() => onChange(fallback)}>↺</button>` : null}</label>`;
}
const IconLock = ({ on }) => html`<${Svg}><rect x="4.5" y="9" width="11" height="8" rx="1.5" ...${stroke}/>
    <path d=${on ? 'M7 9V6.5a3 3 0 0 1 6 0V9' : 'M7 9V6.5a3 3 0 0 1 5.8-1.1'} ...${stroke}/><//>`;
const IconView = () => html`<${Svg}><rect x="2.5" y="4" width="15" height="12" rx="1.5" ...${stroke}/><path d="M10 4v12" ...${stroke}/><//>`;
const Caret = () => html`<svg viewBox="0 0 8 8" width="8" height="8" aria-hidden="true"><path d="M1 2.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>`;

// ── Settings, kept in this browser ─────────────────────────────────────────────
const stored = (key, fallback) => { try { return localStorage.getItem(`render-report.${key}`) ?? fallback; } catch { return fallback; } };
const store = (key, v) => { try { localStorage.setItem(`render-report.${key}`, v); } catch { /* not kept */ } };
function useSetting(key, fallback) {
    const [v, set] = useState(() => stored(key, fallback));
    return [v, x => { store(key, x); set(x); }];
}
// The theme: index.html sets data-theme before the first paint; this follows
// the choice, and the system's while it is 'auto'.
function applyTheme(choice) {
    const dark = choice === 'dark' || (choice === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

/** The View menu: theme, split, scroll lock. */
function ViewMenu({ theme, setTheme, colours, setColours, split, setSplit, lock, setLock }) {
    const [open, setOpen] = useState(false);
    const box = useRef(null);
    useEffect(() => {
        if (!open) return;
        const away = e => { if (!box.current.contains(e.target)) setOpen(false); };
        const esc = e => { if (e.key === 'Escape') setOpen(false); };
        addEventListener('pointerdown', away, true); addEventListener('keydown', esc);
        return () => { removeEventListener('pointerdown', away, true); removeEventListener('keydown', esc); };
    }, [open]);
    const Radio = ({ value, set, v, label, hint }) => html`<button type="button" role="menuitemradio" aria-checked=${String(value === v)}
        onClick=${() => set(v)} title=${hint ?? ''}><span class="check">${value === v ? '✓' : ''}</span>${label}</button>`;
    return html`<span class="menuwrap" ref=${box}>
        <button class="ib text" aria-haspopup="menu" aria-expanded=${String(open)} title="Theme, split and scrolling" onClick=${() => setOpen(!open)}>
            <${IconView}/> View <${Caret}/></button>
        ${open ? html`<div class="menu" role="menu">
            <div class="mhead">Theme</div>
            <${Radio} value=${theme} set=${setTheme} v="auto" label="Auto" hint="As the system's"/>
            <${Radio} value=${theme} set=${setTheme} v="light" label="Light"/>
            <${Radio} value=${theme} set=${setTheme} v="dark" label="Dark"/>
            <div class="mhead">Page colours</div>
            <${Radio} value=${colours} set=${setColours} v="auto" label="Auto" hint="TeX, or TeX inverted while the report is dark"/>
            ${PAGE_COLOURS.map(([v, label, hint]) => html`<${Radio} value=${colours} set=${setColours} v=${v} label=${label} hint=${hint}/>`)}
            <div class="mhead">Split</div>
            <${Radio} value=${split} set=${setSplit} v="auto" label="Auto" hint="Side by side when there is more width than height, else stacked"/>
            <${Radio} value=${split} set=${setSplit} v="row" label="Side by side"/>
            <${Radio} value=${split} set=${setSplit} v="column" label="Stacked"/>
            <div class="mhead">Scrolling</div>
            <button type="button" role="menuitemcheckbox" aria-checked=${String(lock)} onClick=${() => setLock(!lock)}
                title="Both sides at the same x and y"><span class="check">${lock ? '✓' : ''}</span>Scroll together</button>
        </div>` : null}
    </span>`;
}

// ── The two sides ──────────────────────────────────────────────────────────────
// Each side is a scroll pane holding a stage of the same size – the page's
// width, and the longer side's height with a little more – so that with the
// scroll locked both are at the same x and y, and past the end of the shorter
// side its pane's pattern shows.
const TAIL_PT = 36;

/** An image's size in pt (2 px per pt): null while it loads, false if missing. */
function useImageSize(src) {
    const [size, setSize] = useState(null);
    useEffect(() => {
        setSize(null);
        if (!src) return;
        const i = new Image();
        i.onload = () => setSize([i.naturalWidth / PX_PER_PT, i.naturalHeight / PX_PER_PT]);
        i.onerror = () => setSize(false);
        i.src = src;
        return () => { i.onload = i.onerror = null; };
    }, [src]);
    return size;
}

// The pointer, drawn: four hairline arms clear of the point, and the point
// one pixel. It is drawn on both sides – where the pointer is (the system's is
// hidden over the panes, and in the live page: pinPage) and, as its ghost, at
// the same place on the other – in white with mix-blend-mode: difference, so
// it inverts whatever is under it: black on the paper, white on ink, and it
// shows on the pattern and inverted pages alike. One device pixel wide, on
// device pixels (crosshair()), so it is sharp on any screen.
const ARM_FROM = 3, ARM_TO = 10;               // CSS px from the point
function crosshair() {
    // (the point is a pixel's middle: the arms end on pixel edges, half a pixel on)
    const w = 1 / devicePixelRatio, a = ARM_FROM + w / 2, b = ARM_TO + w / 2;
    return `<path d="M${-b} 0H${-a}M${a} 0H${b}M0 ${-b}V${-a}M0 ${a}V${b}" fill="none" stroke="#fff" stroke-width="${w}"/>` +
        `<rect x="${-w / 2}" y="${-w / 2}" width="${w}" height="${w}" fill="#fff"/>`;
}
/** A point in CSS px, moved to the middle of the device pixel it is in. */
const onDevicePixel = v => (Math.floor(v * devicePixelRatio) + .5) / devicePixelRatio;

/** A side's pane. Over its content, the marks both sides share (makeMarks):
 *  the selected area (in pt), and the pointer and its ghost (in CSS px). The
 *  pointer counts anywhere in the pane, the page's margins and past its end
 *  too (in the stage's pt). With `capture`, a layer over the content takes the
 *  pointer (the live page would). */
const Pane = ({ paneRef, onScroll, stage, stagePt, side, marks, capture, children }) => html`<div class="scroll" ref=${paneRef} onScroll=${onScroll}
        onPointerMove=${e => marks.move(side, e)} onPointerLeave=${() => marks.leave(side)}
        onPointerDown=${e => marks.down(side, e)} onPointerUp=${e => marks.up(side, e)}>
    <div class="stage" style=${{ width: `${stage[0]}px`, height: `${stage[1]}px` }}>
        ${children}
        ${capture ? html`<div class="capture"></div>` : null}
        <div class="overlay" ref=${el => marks.attach(side, el)}>
            <svg class="marks" viewBox=${`0 0 ${stagePt[0]} ${stagePt[1]}`} width=${stage[0]} height=${stage[1]}><rect class="area"/></svg>
            <svg class="cursor" width=${stage[0]} height=${stage[1]}><g class="ghost"></g></svg>
        </div>
    </div></div>`;

/** The pointer and the selected area, kept in pt, drawn on both sides: the
 *  pointer where it is and its ghost at the same place on the other; an area
 *  dragged out on either, on both. Drawn straight into each side's overlay,
 *  not through a render: the pointer moves every frame. */
function makeMarks({ scale, status }) {
    let pointer = null, area = null, drag = null, ratio = 0;
    const svgs = {};
    const f2 = x => x.toFixed(2);
    function draw() {
        const s = scale();
        for (const [side, svg] of Object.entries(svgs)) {
            if (!svg?.isConnected) continue;
            const g = svg.querySelector('.ghost'), r = svg.querySelector('.area');
            // (drawn again for another screen's pixel density)
            if (ratio !== devicePixelRatio || !g.firstChild) g.innerHTML = crosshair();
            g.toggleAttribute('data-on', !!pointer);
            if (pointer) {
                // on the device pixel the point is in, on either side alike
                const box = svg.getBoundingClientRect();
                const x = onDevicePixel(box.left + pointer.x * s) - box.left, y = onDevicePixel(box.top + pointer.y * s) - box.top;
                g.setAttribute('transform', `translate(${x} ${y})`);
            }
            r.toggleAttribute('data-on', !!area);
            if (area) {
                r.setAttribute('x', Math.min(area.x0, area.x1)); r.setAttribute('y', Math.min(area.y0, area.y1));
                r.setAttribute('width', Math.abs(area.x1 - area.x0)); r.setAttribute('height', Math.abs(area.y1 - area.y0));
            }
        }
        ratio = devicePixelRatio;
        const el = status();
        if (el) el.textContent = [
            pointer && `x ${f2(pointer.x)}  y ${f2(pointer.y)} pt`,
            area && `area ${f2(Math.abs(area.x1 - area.x0))} × ${f2(Math.abs(area.y1 - area.y0))} pt at (${f2(Math.min(area.x0, area.x1))}, ${f2(Math.min(area.y0, area.y1))})`,
        ].filter(Boolean).join('   ·   ');
    }
    // (e.currentTarget: the pane; the point in its stage's pt)
    const at = e => {
        const r = e.currentTarget.querySelector('.stage').getBoundingClientRect(), s = scale();
        return [(e.clientX - r.left) / s, (e.clientY - r.top) / s];
    };
    const onScrollbar = e => {
        const p = e.currentTarget, r = p.getBoundingClientRect();
        return e.clientX - r.left >= p.clientLeft + p.clientWidth || e.clientY - r.top >= p.clientTop + p.clientHeight;
    };
    const point = (side, x, y) => {
        pointer = { side, x, y };
        if (drag && drag.side === side) { area = { ...area, x1: x, y1: y }; drag.moved ||= Math.hypot(x - area.x0, y - area.y0) * scale() > 3; }
        draw();
    };
    return {
        attach(side, el) { svgs[side] = el; if (el) draw(); },
        draw,
        move(side, e) { point(side, ...at(e)); },
        leave(side) { if (pointer?.side === side && !drag) { pointer = null; draw(); } },
        // a drag draws an area; a click with no drag clears it
        down(side, e) {
            if (e.button !== 0 || onScrollbar(e)) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            const [x, y] = at(e);
            drag = { side, moved: false, before: area };
            area = { x0: x, y0: y, x1: x, y1: y };
            draw();
        },
        up(side, e) {
            if (!drag) return;
            if (!drag.moved) area = null;
            drag = null;
            e.currentTarget.releasePointerCapture?.(e.pointerId);
            draw();
        },
        clear() { area = null; draw(); },
        hasArea: () => !!area,
        // the live page takes the pointer itself: its moves, in its own px (2 per pt)
        frame(win) {
            const d = win.document;
            d.addEventListener('pointermove', e => point('right', (e.clientX + win.scrollX) / PX_PER_PT, (e.clientY + win.scrollY) / PX_PER_PT), { passive: true });
            d.documentElement.addEventListener('mouseleave', () => { if (pointer?.side === 'right') { pointer = null; draw(); } });
        },
    };
}

/** An image of one side, with its boxes. */
function Sheet({ src, size, items, side, sel, scale }) {
    const svg = useMemo(() => boxesSvg(items, side, sel), [items, side, sel]);
    if (size === false) return html`<p class="empty">No image: run the test again (make test-render) to make one.</p>`;
    if (!size) return null;
    return html`<img class="sheet" src=${src} alt="" draggable="false" style=${{ width: `${size[0] * scale}px`, height: `${size[1] * scale}px` }}/>
        <svg class="boxes" viewBox=${`0 0 ${size[0]} ${size[1]}`} width=${size[0] * scale} height=${size[1] * scale}
            dangerouslySetInnerHTML=${{ __html: svg }}/>`;
}

// What dom-dump.ts does to the page, so that it is laid out as it was
// measured; and transparent past its end, so the pane's pattern shows there.
function pinPage(win, colPx, marginPx) {
    const doc = win.document;
    if (win.__setTheme) win.__setTheme('light');
    if (win.__zoom) win.__zoom(0);
    const css = doc.createElement('style');
    css.textContent = `:root { color-scheme: light !important }
        html, body { margin:0 !important; padding:0 !important; background: transparent !important }
        body > :not(#lt-content):not(#rr-overlay) { display:none !important }
        #lt-content > :not(.latex-block) { display:none !important }
        #lt-content { max-width:none !important; width:${colPx}px !important; margin:0 !important; padding:0 ${marginPx}px !important; background: var(--latex-page-bg, #fff) !important }
        .latex-block { margin:0 !important; width:${colPx}px !important }
        #rr-overlay { position:absolute; pointer-events:none; overflow:visible; z-index:2147483646 }
        html, html * { cursor: none !important }`;
    doc.head.appendChild(css);
    win.dispatchEvent(new Event('resize'));
}

// The page's colours. 'tex' is TeX's own: black on white, as the PDF is (the
// page's light theme is #333 on #fafaf9); four are the page's themes; 'inverted'
// is TeX's, inverted by a filter on both sides (report.css). 'auto': TeX, or
// inverted while the report is dark.
const PAGE_COLOURS = [['tex', 'TeX', 'Black on white, as TeX sets it'], ['light', 'Light', "The page's light theme"],
    ['dark', 'Dark', "The page's dark theme"], ['sepia', 'Sepia', "The page's sepia theme"], ['contrast', 'Contrast', "The page's high-contrast theme"],
    ['inverted', 'TeX inverted', "TeX's colours, inverted on both sides"]];
const resolvePageColours = mode => (mode !== 'auto' ? mode : document.documentElement.dataset.theme === 'dark' ? 'inverted' : 'tex');
/** Give the live page these colours: a theme of its own, or TeX's. */
function pageColours(win, mode) {
    const doc = win?.document;
    if (!doc?.head) return;
    const tex = mode === 'tex' || mode === 'inverted';
    if (win.__setTheme) win.__setTheme(tex ? 'light' : mode);
    let style = doc.getElementById('rr-colours');
    if (!style) { style = doc.createElement('style'); style.id = 'rr-colours'; doc.head.appendChild(style); }
    style.textContent = tex ? 'html { color: #000 !important; --latex-page-bg: #fff !important }' : '';
}

/** The page itself, as the test measured it: live, for the inspector. As tall
 *  as the stage and scaled to it, so it never scrolls on its own – the pane
 *  does. `onPage(win, block)` when it is ready; `onHeight(pt)` as it settles. */
function Live({ src, items, sel, scale, stagePt, marginPt, hsizePt, colours, frameRef, onPage, onHeight }) {
    // hidden until pinned: the page as it loads (its header and title, its own
    // layout) is not the page the test measured
    const [ready, setReady] = useState(false);
    const colPx = Math.round(hsizePt * PX_PER_PT), marginPx = Math.round(marginPt * PX_PER_PT);
    const place = useCallback(() => {
        const win = frameRef.current?.contentWindow, doc = win?.document;
        const block = doc?.querySelector('.latex-block');
        if (!block) return;
        let svg = doc.getElementById('rr-overlay');
        if (!svg) { svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.id = 'rr-overlay'; doc.body.appendChild(svg); }
        const r = block.getBoundingClientRect();
        const wPt = (colPx + 2 * marginPx) / PX_PER_PT, hPt = r.height / PX_PER_PT;
        Object.assign(svg.style, { left: `${r.left + win.scrollX - marginPx}px`, top: `${r.top + win.scrollY}px` });
        svg.setAttribute('width', wPt * PX_PER_PT); svg.setAttribute('height', hPt * PX_PER_PT);
        svg.setAttribute('viewBox', `0 0 ${wPt} ${hPt}`);
        svg.innerHTML = boxesSvg(items, 'viewer', sel);
        onHeight(hPt);
    }, [items, sel, colPx, marginPx]);
    useEffect(place, [place]);
    useEffect(() => pageColours(frameRef.current?.contentWindow, colours), [colours]);
    const onLoad = () => {
        const win = frameRef.current.contentWindow;
        pinPage(win, colPx, marginPx);
        pageColours(win, colours);
        requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)));
        requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)));
        // the block settles as its fonts arrive
        const block = win.document.querySelector('.latex-block');
        if (block) new win.ResizeObserver(() => place()).observe(block);
        setTimeout(place, 300);
        onPage(win, block);
    };
    const k = scale / PX_PER_PT;
    return html`<iframe class="page" ref=${frameRef} src=${src} title="The reflowed page" onLoad=${onLoad} scrolling="no"
        style=${{ width: `${colPx + 2 * marginPx}px`, height: `${stagePt[1] * PX_PER_PT}px`, transform: `scale(${k})`,
                 visibility: ready ? 'visible' : 'hidden' }}/>`;
}

// ── The page ───────────────────────────────────────────────────────────────────
const idFromHash = () => decodeURIComponent(location.hash.slice(1));
const inField = e => /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
const inspector = () => window.reflowtex?.inspector;
const STATUS = { pass: 'Pass', fail: 'Fail', known: 'Known failure', fixed: 'Passes – take the known mark off', error: 'Error' };
const MARK = { pass: '✓', fail: '✗', known: '○', fixed: '!', error: '⚠' };

function App() {
    const [report, setReport] = useState(null), [error, setError] = useState(null);
    const [id, setId] = useState(idFromHash());
    const [vec, setVec] = useState(null);
    const [thr, setThr] = useState({});                   // per test: [glyph, rule]
    const [zoom, setZoom] = useState('fit');
    const [mode, setMode] = useState('live');
    const [theme, setThemeKept] = useSetting('theme', 'auto');
    const [split, setSplit] = useSetting('split', 'auto');
    const [coloursKept, setColours] = useSetting('colours', 'auto');
    const [lockKept, setLockKept] = useSetting('lock', 'on');
    const lock = lockKept === 'on', setLock = on => setLockKept(on ? 'on' : 'off');
    const [inspecting, setInspecting] = useState(false);
    const [sel, setSel] = useState(-1);
    const [fitScale, setFitScale] = useState(1);
    const [liveH, setLiveH] = useState(0);
    const [autoDir, setAutoDir] = useState('row');
    const left = useRef(null), right = useRef(null), frame = useRef(null), compare = useRef(null);
    const page = useRef(null);                            // the live page: [win, block]
    const [areaTool, setAreaTool] = useState(false);   // drawing an area on the live page
    const scaleRef = useRef(1), statusRef = useRef(null);
    const marks = useMemo(() => makeMarks({ scale: () => scaleRef.current, status: () => statusRef.current }), []);
    const inspectorUsed = useRef(false);

    const setTheme = t => { setThemeKept(t); applyTheme(t); };
    const colours = resolvePageColours(coloursKept);
    // (a render when the system turns dark or light: the page's colours may follow)
    const [, setSystemDark] = useState(false);
    useEffect(() => {
        const mq = matchMedia('(prefers-color-scheme: dark)');
        const follow = () => { applyTheme(stored('theme', 'auto')); setSystemDark(mq.matches); };
        mq.addEventListener('change', follow);
        return () => mq.removeEventListener('change', follow);
    }, []);

    const load = () => getJson(`${BUILD}report.json`).then(setReport, e => setError(String(e)));
    useEffect(() => { load(); }, []);
    useEffect(() => { const h = () => setId(idFromHash()); addEventListener('hashchange', h); return () => removeEventListener('hashchange', h); }, []);

    const results = report?.results ?? [];
    const idx = Math.max(0, results.findIndex(r => r.id === id));
    const r = results[idx];
    const go = i => { const t = results[(i + results.length) % results.length]; if (t) location.hash = encodeURIComponent(t.id); };

    useEffect(() => {
        setVec(null); setSel(-1); setLiveH(0);
        if (!r || r.status === 'error') return;
        getJson(`${BUILD}${r.dir}/vector/vector.json`).then(setVec, e => setVec({ error: String(e) }));
    }, [r?.id, r?.at]);

    const glyphThr = thr[r?.id]?.[0] ?? r?.tolerance ?? 0.05;
    const ruleThr = thr[r?.id]?.[1] ?? r?.rule_tolerance ?? r?.tolerance ?? 0.05;
    const setGlyphThr = n => setThr({ ...thr, [r.id]: [n, ruleThr] });
    const setRuleThr = n => setThr({ ...thr, [r.id]: [glyphThr, n] });
    const items = useMemo(() => (vec && !vec.error ? mismatches(vec, glyphThr, ruleThr, r?.rules_missing ?? 0) : []), [vec, glyphThr, ruleThr]);

    const stamp = r ? `?t=${encodeURIComponent(r.at)}` : '';
    const vdir = r ? `${BUILD}${r.dir}/vector/` : '';
    const noVec = !r ? null : r.status === 'error' ? 'The test stopped before a comparison: see above.' : vec?.error ? `No comparison: ${vec.error}` : null;
    const stripSrc = r && !noVec ? `${vdir}strip.svg${stamp}` : null, viewerSrc = r && !noVec ? `${vdir}viewer.png${stamp}` : null;
    const stripSize = useImageSize(stripSrc), viewerSize = useImageSize(viewerSrc);

    // the page's width in pt: the column and a margin either side; the stage's
    // height: the longer side's, and a tail
    const marginPt = vec?.margin_pt ?? 36, hsizePt = vec?.hsize_pt ?? r?.hsize_pt ?? 345;
    const widthPt = hsizePt + 2 * marginPt;
    const stagePt = [widthPt, Math.max(stripSize?.[1] ?? 0, viewerSize?.[1] ?? 0, liveH) + TAIL_PT];

    // side by side or stacked: 'auto' by the shape of the room for the two
    const dir = split === 'auto' ? autoDir : split;
    useLayoutEffect(() => {
        if (!compare.current) return;
        const ro = new ResizeObserver(() => {
            const c = compare.current;
            if (!c) return;
            setAutoDir(c.clientWidth >= c.clientHeight ? 'row' : 'column');
            const pane = c.querySelector('.scroll');
            if (pane) setFitScale(Math.max(.2, (pane.clientWidth - 18) / widthPt));
        });
        ro.observe(compare.current);
        for (const p of compare.current.querySelectorAll('.scroll')) ro.observe(p);
        return () => ro.disconnect();
    }, [widthPt, !!report, dir, !!noVec]);
    const scale = zoom === 'fit' ? fitScale : zoom;
    scaleRef.current = scale;
    useEffect(() => marks.draw());
    const stage = [stagePt[0] * scale, stagePt[1] * scale];

    // Scrolling together: the same x and y on both, the stages being alike.
    const follow = (from, to) => () => {
        if (!lock || !from.current || !to.current) return;
        const a = from.current, b = to.current;
        if (b.scrollTop !== a.scrollTop) b.scrollTop = a.scrollTop;
        if (b.scrollLeft !== a.scrollLeft) b.scrollLeft = a.scrollLeft;
    };
    const onLeft = follow(left, right), onRight = follow(right, left);
    useEffect(() => { if (lock) onLeft(); }, [lock]);
    // at another zoom, the same point stays at the top
    const lastScale = useRef(scale);
    useLayoutEffect(() => {
        const f = scale / lastScale.current;
        lastScale.current = scale;
        if (f !== 1) for (const p of [left.current, right.current]) if (p) { p.scrollTop *= f; p.scrollLeft *= f; }
    }, [scale]);
    // show a mismatch: in the middle of both sides
    const reveal = i => {
        setSel(i);
        const it = items[i];
        if (!it) return;
        for (const p of [left.current, right.current]) if (p) p.scrollTop = Math.max(0, it.y * scale - p.clientHeight / 2);
        document.querySelector(`.list .row[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest' });
    };

    // The inspector: one panel, in this page, docked or floating as the
    // inspector does anywhere; it inspects the live page, whichever test is
    // shown.
    const onPage = (win, block) => {
        page.current = [win, block];
        marks.frame(win);
        if (inspectorUsed.current) inspector()?.inspect(win);
    };
    const toggleInspector = async () => {
        const api = inspector();
        if (!api) return;
        if (await api.isOpen()) { api.close(); setInspecting(false); return; }
        if (mode !== 'live') { setMode('live'); return; }     // opened by onPage when it is there
        const [win, block] = page.current ?? [];
        if (!win) return;
        inspectorUsed.current = true;
        await api.inspect(win);
        await api.open(block, { dock: 'auto', scroll: false });
        setInspecting(true);
    };
    useEffect(() => {                                     // (it has its own close button)
        const t = setInterval(async () => { const api = inspector(); if (api && inspectorUsed.current) setInspecting(await api.isOpen()); }, 500);
        return () => clearInterval(t);
    }, []);
    const setSide = m => { setMode(m); if (m !== 'live' && inspecting) { inspector()?.close(); setInspecting(false); } };

    useEffect(() => {
        const key = e => {
            if (inField(e) || e.metaKey || e.ctrlKey || e.altKey) return;
            if (e.key === 'ArrowLeft') { go(idx - 1); e.preventDefault(); }
            else if (e.key === 'ArrowRight') { go(idx + 1); e.preventDefault(); }
            else if (e.key === 'n' || e.key === 'j') reveal(Math.min(items.length - 1, sel + 1));
            else if (e.key === 'p' || e.key === 'k') reveal(Math.max(0, sel - 1));
            else if (e.key === 'm') setAreaTool(!areaTool);
            else if (e.key === 'Escape' && marks.hasArea()) marks.clear();
        };
        addEventListener('keydown', key);
        return () => removeEventListener('keydown', key);
    });

    if (error) return html`<p class="empty">Could not read the report: ${error}. Run <kbd>make test-render</kbd>, then <kbd>make render-report</kbd>.</p>`;
    if (!report) return html`<p class="empty">Loading…</p>`;
    if (!results.length) return html`<p class="empty">No results yet: run <kbd>make test-render</kbd> (or one case), then reload.</p>`;

    const counts = results.reduce((a, x) => ({ ...a, [x.status]: (a[x.status] ?? 0) + 1 }), {});
    const liveSrc = r.page ? `${BUILD}${r.page}/index.html` : null;
    const shown = items.slice(0, 2000);
    const empty = noVec ? html`<p class="empty">${noVec}</p>` : null;

    return html`<div class="rep">
        <div class="bar">
            <div class="group start" role="group" aria-label="Tests">
                <button class="ib" title="Previous test (←)" aria-label="Previous test" onClick=${() => go(idx - 1)}><${IconPrev}/></button>
                <span class="pick"><select aria-label="Test" value=${r.id} onChange=${e => { location.hash = encodeURIComponent(e.target.value); }}>
                    ${results.map(x => html`<option value=${x.id}>${MARK[x.status] ?? '·'} ${x.id}</option>`)}
                </select></span>
                <button class="ib" title="Next test (→)" aria-label="Next test" onClick=${() => go(idx + 1)}><${IconNext}/></button>
                <span class=${`st ${r.status}`} title=${r.known ? `known: ${r.known}` : ''}>${STATUS[r.status]}</span>
                <span class="muted mono">${idx + 1} / ${results.length}</span>
            </div>
            <div class="group middle" role="group" aria-label="Both sides">
                <${Seg} title="Zoom" value=${zoom} onChange=${setZoom} options=${[['fit', 'Fit'], [1, '1×'], [2, '2×'], [4, '4×']]}/>
                <button class=${`ib ${lock ? 'on' : ''}`} aria-pressed=${String(lock)} title=${lock ? 'Scrolling together: both sides at the same x and y' : 'Scrolling apart'}
                    aria-label="Scroll together" onClick=${() => setLock(!lock)}><${IconLock} on=${lock}/></button>
                <button class=${`ib ${areaTool ? 'on' : ''}`} aria-pressed=${String(areaTool)} aria-label="Select an area"
                    title="Select an area on the live page too (M): drag on either side, and the area shows on both; a click or Esc clears it. On the PDF and the snapshot a drag always does."
                    onClick=${() => setAreaTool(!areaTool)}><${IconArea}/></button>
            </div>
            <div class="group end" role="group" aria-label="Tools">
                <button class=${`ib text ${inspecting ? 'on' : ''}`} aria-pressed=${String(inspecting)} disabled=${!liveSrc}
                    title=${`The inspector on the reflowed page: boxes, glue, every glyph (${inspector()?.shortcut ?? 'Alt+Shift+I'})`}
                    onClick=${toggleInspector}><${IconInspect}/> Inspect</button>
                <${ViewMenu} theme=${theme} setTheme=${setTheme} colours=${coloursKept} setColours=${setColours} split=${split} setSplit=${setSplit} lock=${lock} setLock=${setLock}/>
                <span class="sep"></span>
                <span class="totals" title="All tests, by status">${Object.entries(counts).map(([k, n]) => html`<span class=${`st ${k}`}>${n}</span>`)}</span>
                <button class="ib" title="Read the report again (after a test run)" aria-label="Reload" onClick=${load}><${IconReload}/></button>
            </div>
        </div>
        ${r.problems?.length ? html`<ul class=${`problems ${r.status}`}>${r.problems.map(p => html`<li>${p}</li>`)}</ul>` : null}
        <div class="main">
            <div class=${`compare${colours === 'inverted' ? ' inverted' : ''}`} ref=${compare} data-dir=${dir}>
                <section class="side">
                    <h2><span class="title">TeX · pageless PDF <span class="mono">${r.case} at ${f3(hsizePt)} pt (${widthLabel(r.extra)})</span></span></h2>
                    ${empty ?? html`<${Pane} paneRef=${left} onScroll=${onLeft} stage=${stage} stagePt=${stagePt} side="left" marks=${marks}>
                        <${Sheet} src=${stripSrc} size=${stripSize} items=${items} side="strip" sel=${sel} scale=${scale}/><//>`}
                </section>
                <section class="side">
                    <h2><span class="title">Browser · reflowed</span>
                        <${Seg} title="The browser's side: the page itself (the inspector works on it), or the screenshot the test compared" value=${mode}
                            onChange=${setSide} options=${[['live', 'Live page'], ['snapshot', 'Snapshot']]}/></h2>
                    ${empty ?? html`<${Pane} paneRef=${right} onScroll=${onRight} stage=${stage} stagePt=${stagePt} side="right" marks=${marks}
                        capture=${areaTool && mode === 'live' && !!liveSrc}>
                        ${mode === 'live' && liveSrc
                            ? html`<${Live} key=${`${r.id}|${r.at}`} src=${liveSrc} items=${items} sel=${sel} scale=${scale} stagePt=${stagePt}
                                marginPt=${marginPt} hsizePt=${hsizePt} colours=${colours} frameRef=${frame} onPage=${onPage} onHeight=${setLiveH}/>`
                            : html`<${Sheet} src=${viewerSrc} size=${viewerSize} items=${items} side="viewer" sel=${sel} scale=${scale}/>`}<//>`}
                </section>
            </div>
            <section class="list">
                <h2>
                    <span class="fill">${items.length ? `${items.length} not matching` : vec && !vec.error ? 'Everything matches' : ''}</span>
                    <button class="ib" title="Previous (p)" aria-label="Previous mismatch" disabled=${!items.length} onClick=${() => reveal(Math.max(0, sel - 1))}><${IconUp}/></button>
                    <button class="ib" title="Next (n)" aria-label="Next mismatch" disabled=${!items.length} onClick=${() => reveal(Math.min(items.length - 1, sel + 1))}><${IconDown}/></button>
                </h2>
                <div class="filters" role="group" aria-label="Error thresholds">
                    <span class="caption muted" title="What is further off is listed here and boxed on both sides; ↺ goes back to the case's ceiling">Error threshold (pt)</span>
                    <${Threshold} label="glyph" what="Glyphs" value=${glyphThr} fallback=${r.tolerance} onChange=${setGlyphThr}/>
                    <${Threshold} label="rule" what="Rules" value=${ruleThr} fallback=${r.rule_tolerance ?? r.tolerance} onChange=${setRuleThr}/>
                </div>
                <div class="rows" role="listbox" aria-label="Mismatches">
                    ${shown.map((it, i) => html`<div class=${`row ${it.allowed ? 'allowed' : ''}`} role="option" data-i=${i} aria-selected=${String(i === sel)}
                        onClick=${() => reveal(i)} title=${`y ${it.y} pt`}>
                        <span class="k">${it.k === 'g' ? '◆' : it.k === 'r' ? '▬' : it.k}</span>
                        <span class="what">${it.what}</span><span class="muted">${it.note}</span></div>`)}
                    ${items.length > shown.length ? html`<div class="more">and ${items.length - shown.length} more</div>` : null}
                </div>
            </section>
        </div>
        <div class="foot">
            <span class="key" title="A glyph or rule further off than the error threshold, or on one side only"><span class="sw"></span>error</span>
            <span class="key" title="A rule of TeX's the browser did not draw, within the case's rules_missing"><span class="sw dash"></span>allowed</span>
            <span class="key"><span class="sw sel"></span>selected</span>
            <span class="where mono" ref=${statusRef}></span>
            <span class="fill"></span>
            <span>${vec?.glyphs ? `glyphs: TeX ${vec.glyphs.strip}, browser ${vec.glyphs.viewer}, matched ${vec.glyphs.matched}` : ''}</span>
            <span>ran ${new Date(r.at).toLocaleString()}</span>
            <a href=${`${BUILD}${r.dir}/pageless.pdf`} target="_blank">pageless.pdf</a>
            <a href=${`${vdir}vector.json`} target="_blank">vector.json</a>
            ${liveSrc ? html`<a href=${liveSrc} target="_blank">page</a>` : null}
        </div>
    </div>`;
}

applyTheme(stored('theme', 'auto'));
render(html`<${App}/>`, document.getElementById('app'));
