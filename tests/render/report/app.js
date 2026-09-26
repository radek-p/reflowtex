// SPDX-License-Identifier: AGPL-3.0-or-later
// Render report: a render test's pageless PDF (TeX) on the left, the page the
// browser reflowed on the right, and every glyph or rule that does not match
// boxed in red on both (see README.md).
//
// Both sides are in the frame vector-compare.ts measures in: pt from the left
// edge of the margin and from the top of the block. strip.png and viewer.png
// are 2 px per pt in it; the live page is pinned as dom-dump.ts pins it, where
// the viewer also draws 2 px per pt.
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

const Seg = ({ value, options, onChange, title }) => html`<span class="seg" role="group" aria-label=${title} title=${title}>
    ${options.map(([v, label]) => html`<button type="button" aria-pressed=${String(v === value)} onClick=${() => onChange(v)}>${label}</button>`)}</span>`;

/** A threshold in pt: typed freely, applied when it is a number. */
function Threshold({ label, value, fallback, onChange }) {
    const [text, setText] = useState(String(value));
    useEffect(() => setText(String(value)), [value]);
    return html`<label class="field" title=${`${label}: boxed when off by more than this (pt); the case's ceiling is ${fallback}`}>${label}
        <input value=${text} inputmode="decimal" onInput=${e => { setText(e.target.value); const n = Number(e.target.value); if (e.target.value !== '' && n >= 0) onChange(n); }}/>pt
        ${value !== fallback ? html`<button type="button" class="reset" title="The case's ceiling" onClick=${() => onChange(fallback)}>↺</button>` : null}</label>`;
}

// ── The two sides ──────────────────────────────────────────────────────────────
/** An image of one side with its boxes; its scroll is the side's. */
function Sheet({ src, items, side, sel, scale, widthPt, scrollRef, onScroll, missing }) {
    const [size, setSize] = useState(null);          // the image's size in pt
    const img = useRef(null);
    const measure = () => { const i = img.current; if (i?.complete && i.naturalWidth) setSize([i.naturalWidth / PX_PER_PT, i.naturalHeight / PX_PER_PT]); };
    // a cached image may have loaded before onLoad was listening
    useLayoutEffect(() => { setSize(null); measure(); }, [src]);
    const svg = useMemo(() => boxesSvg(items, side, sel), [items, side, sel]);
    return html`<div class="scroll" ref=${scrollRef} onScroll=${onScroll}>
        ${missing ? html`<p class="empty">${missing}</p>` : html`
        <div class="sheet" style=${{ width: `${widthPt * scale}px` }}>
            <img ref=${img} src=${src} alt="" onLoad=${measure}
                onError=${() => setSize(false)}/>
            ${size ? html`<svg viewBox=${`0 0 ${size[0]} ${size[1]}`} width=${size[0] * scale} height=${size[1] * scale}
                dangerouslySetInnerHTML=${{ __html: svg }}/>` : null}
            ${size === false ? html`<p class="empty">No image: run the test again (make test-render) to make one.</p>` : null}
        </div>`}
    </div>`;
}

// What dom-dump.ts does to the page, so that it is laid out as it was measured.
function pinPage(win, colPx, marginPx) {
    const doc = win.document;
    if (win.__setTheme) win.__setTheme('light');
    if (win.__zoom) win.__zoom(0);
    const css = doc.createElement('style');
    css.textContent = `html, body { margin:0 !important; padding:0 !important }
        body > :not(#lt-content):not(#rr-overlay) { display:none !important }
        #lt-content > :not(.latex-block) { display:none !important }
        #lt-content { max-width:none !important; width:${colPx}px !important; margin:0 !important; padding:0 ${marginPx}px !important }
        .latex-block { margin:0 !important; width:${colPx}px !important }
        #rr-overlay { position:absolute; pointer-events:none; overflow:visible; z-index:2147483646 }`;
    doc.head.appendChild(css);
    win.dispatchEvent(new Event('resize'));
}

/** The page itself, as the test measured it: live, so the inspector can open
 *  on it. Scaled to the pane; its own scroll is the side's. */
function Live({ src, items, sel, scale, widthPt, marginPt, hsizePt, inspect, inspectorHost, frameRef, onScroll }) {
    const box = useRef(null);
    const [pane, setPane] = useState([0, 0]);
    const colPx = Math.round(hsizePt * PX_PER_PT), marginPx = Math.round(marginPt * PX_PER_PT);
    useLayoutEffect(() => {
        const ro = new ResizeObserver(([e]) => setPane([e.contentRect.width, e.contentRect.height]));
        ro.observe(box.current);
        return () => ro.disconnect();
    }, []);
    const k = scale / PX_PER_PT;
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
    }, [items, sel, colPx, marginPx]);
    useEffect(place, [place]);
    const onLoad = () => {
        const win = frameRef.current.contentWindow;
        pinPage(win, colPx, marginPx);
        win.addEventListener('scroll', onScroll, { passive: true });
        // the block settles as its fonts arrive
        const block = win.document.querySelector('.latex-block');
        if (block) new win.ResizeObserver(() => place()).observe(block);
        setTimeout(place, 300);
        if (inspect) openInspector(win, block, inspectorHost.current);
    };
    // re-bind the scroll handler when it changes (it closes over the scale)
    useEffect(() => {
        const win = frameRef.current?.contentWindow;
        if (!win) return;
        win.addEventListener('scroll', onScroll, { passive: true });
        return () => win.removeEventListener('scroll', onScroll);
    }, [onScroll]);
    const [pw, ph] = pane;
    // as wide as the page, or the pane when zoomed in past it: the page scrolls across
    // inside, its column pinned all the same
    return html`<div class="live" ref=${box}>
        ${pw ? html`<iframe ref=${frameRef} src=${src} title="The reflowed page" onLoad=${onLoad}
            style=${{ width: `${Math.min(colPx + 2 * marginPx, pw / k)}px`, height: `${ph / k}px`, transform: `scale(${k})`,
                      left: `${Math.max(0, (pw - widthPt * scale) / 2)}px` }}/>` : null}
    </div>`;
}

/** The inspector, loaded into the page and docked beside the list: it reads
 *  the page's blocks and highlights on the page, and draws its panel here. */
function openInspector(win, block, host) {
    const go = () => {
        try { win.reflowtex.inspector.dock(host, block); }
        catch { win.reflowtex.inspector.open(block, { dock: 'float' }); }
    };
    if (win.reflowtex?.inspector) { go(); return; }
    const s = win.document.createElement('script');
    s.src = '/inspector/inspector.js';
    s.onload = go;
    win.document.head.appendChild(s);
}

// ── The page ───────────────────────────────────────────────────────────────────
const idFromHash = () => decodeURIComponent(location.hash.slice(1));
const inField = e => /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);

function App() {
    const [report, setReport] = useState(null), [error, setError] = useState(null);
    const [id, setId] = useState(idFromHash());
    const [vec, setVec] = useState(null);
    const [thr, setThr] = useState({});                   // per test: [glyph, rule]
    const [zoom, setZoom] = useState('fit');
    const [mode, setMode] = useState('live');
    const [inspect, setInspect] = useState(false);
    const [sel, setSel] = useState(-1);
    const [fitScale, setFitScale] = useState(1);
    const left = useRef(null), right = useRef(null), frame = useRef(null), main = useRef(null), insp = useRef(null);

    const load = () => getJson(`${BUILD}report.json`).then(setReport, e => setError(String(e)));
    useEffect(() => { load(); }, []);
    useEffect(() => { const h = () => setId(idFromHash()); addEventListener('hashchange', h); return () => removeEventListener('hashchange', h); }, []);

    const results = report?.results ?? [];
    const idx = Math.max(0, results.findIndex(r => r.id === id));
    const r = results[idx];
    const go = i => { const t = results[(i + results.length) % results.length]; if (t) location.hash = encodeURIComponent(t.id); };

    useEffect(() => {
        setVec(null); setSel(-1);
        if (!r || r.status === 'error') return;
        getJson(`${BUILD}${r.dir}/vector/vector.json`).then(setVec, e => setVec({ error: String(e) }));
    }, [r?.id, r?.at]);

    const glyphThr = thr[r?.id]?.[0] ?? r?.tolerance ?? 0.05;
    const ruleThr = thr[r?.id]?.[1] ?? r?.rule_tolerance ?? r?.tolerance ?? 0.05;
    const setGlyphThr = n => setThr({ ...thr, [r.id]: [n, ruleThr] });
    const setRuleThr = n => setThr({ ...thr, [r.id]: [glyphThr, n] });
    const items = useMemo(() => (vec && !vec.error ? mismatches(vec, glyphThr, ruleThr, r?.rules_missing ?? 0) : []), [vec, glyphThr, ruleThr]);

    // the page's width in pt: the column and a margin either side
    const marginPt = vec?.margin_pt ?? 36, hsizePt = vec?.hsize_pt ?? r?.hsize_pt ?? 345;
    const widthPt = hsizePt + 2 * marginPt;
    useLayoutEffect(() => {
        if (!main.current) return;
        const ro = new ResizeObserver(() => {
            const w = Math.min(...[...main.current.querySelectorAll('.side')].map(s => s.clientWidth)) - 18;
            setFitScale(Math.max(.2, w / widthPt));
        });
        ro.observe(main.current);
        return () => ro.disconnect();
    }, [widthPt, !!report, inspect]);
    const scale = zoom === 'fit' ? fitScale : zoom;

    // one scroll for both sides, in pt
    const syncing = useRef(null);
    const rightWin = () => (mode === 'live' ? frame.current?.contentWindow : null);
    const setScroll = (who, xPt, yPt) => {
        if (who !== 'left' && left.current) { left.current.scrollTop = yPt * scale; left.current.scrollLeft = xPt * scale; }
        if (who !== 'right') {
            const w = rightWin();
            if (w) w.scrollTo(xPt * PX_PER_PT, yPt * PX_PER_PT);
            else if (right.current) { right.current.scrollTop = yPt * scale; right.current.scrollLeft = xPt * scale; }
        }
    };
    const scrolled = who => () => {
        if (syncing.current && syncing.current !== who) return;
        syncing.current = who;
        requestAnimationFrame(() => requestAnimationFrame(() => { if (syncing.current === who) syncing.current = null; }));
        if (who === 'left') setScroll('left', left.current.scrollLeft / scale, left.current.scrollTop / scale);
        else if (rightWin()) setScroll('right', rightWin().scrollX / PX_PER_PT, rightWin().scrollY / PX_PER_PT);
        else setScroll('right', right.current.scrollLeft / scale, right.current.scrollTop / scale);
    };
    const onLeft = useCallback(scrolled('left'), [scale, mode]);
    const onRight = useCallback(scrolled('right'), [scale, mode]);
    // show a mismatch: in the middle of both sides
    const reveal = i => {
        setSel(i);
        const it = items[i];
        if (!it || !left.current) return;
        const view = left.current.clientHeight / scale;
        syncing.current = 'reveal';
        setScroll('reveal', 0, Math.max(0, it.y - view / 2));
        requestAnimationFrame(() => { syncing.current = null; });
        document.querySelector(`.list .row[data-i="${i}"]`)?.scrollIntoView({ block: 'nearest' });
    };

    useEffect(() => {
        const key = e => {
            if (inField(e) || e.metaKey || e.ctrlKey || e.altKey) return;
            if (e.key === 'ArrowLeft') { go(idx - 1); e.preventDefault(); }
            else if (e.key === 'ArrowRight') { go(idx + 1); e.preventDefault(); }
            else if (e.key === 'n' || e.key === 'j') reveal(Math.min(items.length - 1, sel + 1));
            else if (e.key === 'p' || e.key === 'k') reveal(Math.max(0, sel - 1));
        };
        addEventListener('keydown', key);
        return () => removeEventListener('keydown', key);
    });

    if (error) return html`<p class="empty">Could not read the report: ${error}. Run <kbd>make test-render</kbd>, then <kbd>make render-report</kbd>.</p>`;
    if (!report) return html`<p class="empty">Loading…</p>`;
    if (!results.length) return html`<p class="empty">No results yet: run <kbd>make test-render</kbd> (or one case), then reload.</p>`;

    const counts = results.reduce((a, x) => ({ ...a, [x.status]: (a[x.status] ?? 0) + 1 }), {});
    const stamp = `?t=${encodeURIComponent(r.at)}`;
    const vdir = `${BUILD}${r.dir}/vector/`;
    const noVec = r.status === 'error' ? 'The test stopped before a comparison: see above.' : vec?.error ? `No comparison: ${vec.error}` : null;
    const liveSrc = r.page ? `${BUILD}${r.page}/index.html` : null;
    const shown = items.slice(0, 2000);

    return html`<div class="rep">
        <div class="bar">
            <button class="ib" title="Previous test (←)" aria-label="Previous test" onClick=${() => go(idx - 1)}><${IconPrev}/></button>
            <span class="pick"><select aria-label="Test" value=${r.id} onChange=${e => { location.hash = encodeURIComponent(e.target.value); }}>
                ${results.map(x => html`<option value=${x.id}>${({ pass: '✓', fail: '✗', known: '○', fixed: '!', error: '⚠' })[x.status] ?? '·'} ${x.id}</option>`)}
            </select></span>
            <button class="ib" title="Next test (→)" aria-label="Next test" onClick=${() => go(idx + 1)}><${IconNext}/></button>
            <span class=${`st ${r.status}`} title=${r.known ? `known: ${r.known}` : ''}>${({ pass: 'Pass', fail: 'Fail', known: 'Known failure', fixed: 'Passes – take the known mark off', error: 'Error' })[r.status]}</span>
            <span class="muted mono">${idx + 1} / ${results.length}</span>
            <span class="sep"></span>
            <${Threshold} label="Glyph" value=${glyphThr} fallback=${r.tolerance} onChange=${setGlyphThr}/>
            <${Threshold} label="Rule" value=${ruleThr} fallback=${r.rule_tolerance ?? r.tolerance} onChange=${setRuleThr}/>
            <span class="sep"></span>
            <${Seg} title="Zoom" value=${zoom} onChange=${setZoom} options=${[['fit', 'Fit'], [1, '1×'], [2, '2×'], [4, '4×']]}/>
            <span class="sep"></span>
            <${Seg} title="The browser's side: the page itself, or the screenshot the test compared" value=${mode}
                onChange=${m => { setMode(m); if (m !== 'live') setInspect(false); }} options=${[['live', 'Live page'], ['snapshot', 'Snapshot']]}/>
            <button class=${`ib text ${inspect ? 'on' : ''}`} aria-pressed=${String(inspect)} disabled=${!liveSrc}
                title="Open the inspector on the reflowed page (boxes, glue, every glyph)"
                onClick=${() => { setMode('live'); setInspect(!inspect); }}><${IconInspect}/> Inspect</button>
            <span class="fill"></span>
            <span class="muted">${Object.entries(counts).map(([k, n]) => html`<span class=${`st ${k}`} style="font-weight:400">${n}</span>`)}</span>
            <button class="ib" title="Read the report again (after a test run)" aria-label="Reload" onClick=${load}><${IconReload}/></button>
        </div>
        ${r.problems?.length ? html`<ul class=${`problems ${r.status}`}>${r.problems.map(p => html`<li>${p}</li>`)}</ul>` : null}
        <div class="main" ref=${main}>
            <section class="side">
                <h2>TeX · pageless PDF <span class="mono">${r.case} at ${f3(hsizePt)} pt (${widthLabel(r.extra)})</span></h2>
                <${Sheet} src=${`${vdir}strip.png${stamp}`} items=${items} side="strip" sel=${sel} scale=${scale} widthPt=${widthPt}
                    scrollRef=${left} onScroll=${onLeft} missing=${noVec}/>
            </section>
            <section class="side">
                <h2>Browser · reflowed <span class="mono">${mode === 'live' ? 'live page' : 'as the test saw it'}</span></h2>
                ${mode === 'live' && liveSrc && !noVec
                    ? html`<${Live} key=${`${r.id}|${r.at}|${inspect}`} src=${liveSrc} items=${items} sel=${sel} scale=${scale} widthPt=${widthPt}
                        marginPt=${marginPt} hsizePt=${hsizePt} inspect=${inspect} inspectorHost=${insp} frameRef=${frame} onScroll=${onRight}/>`
                    : html`<${Sheet} src=${`${vdir}viewer.png${stamp}`} items=${items} side="viewer" sel=${sel} scale=${scale} widthPt=${widthPt}
                        scrollRef=${right} onScroll=${onRight} missing=${noVec}/>`}
            </section>
            <section class="list">
                <h2>
                    <span class="fill">${items.length ? `${items.length} not matching` : vec ? 'Everything matches' : ''}</span>
                    <button class="ib" title="Previous (p)" aria-label="Previous mismatch" disabled=${!items.length} onClick=${() => reveal(Math.max(0, sel - 1))}><${IconUp}/></button>
                    <button class="ib" title="Next (n)" aria-label="Next mismatch" disabled=${!items.length} onClick=${() => reveal(Math.min(items.length - 1, sel + 1))}><${IconDown}/></button>
                </h2>
                <div class="rows" role="listbox" aria-label="Mismatches">
                    ${shown.map((it, i) => html`<div class=${`row ${it.allowed ? 'allowed' : ''}`} role="option" data-i=${i} aria-selected=${String(i === sel)}
                        onClick=${() => reveal(i)} title=${`y ${it.y} pt`}>
                        <span class="k">${it.k === 'g' ? '◆' : it.k === 'r' ? '▬' : it.k}</span>
                        <span class="what">${it.what}</span><span class="muted">${it.note}</span></div>`)}
                    ${items.length > shown.length ? html`<div class="more">and ${items.length - shown.length} more</div>` : null}
                </div>
            </section>
            ${inspect ? html`<section class="insp"><div ref=${insp}></div></section>` : null}
        </div>
        <div class="foot">
            <span class="key"><span class="sw"></span>off, or on one side only</span>
            <span class="key"><span class="sw dash"></span>TeX's rule not drawn, within the case's allowance</span>
            <span class="key"><span class="sw sel"></span>selected</span>
            <span class="fill"></span>
            <span>${vec?.glyphs ? `glyphs: TeX ${vec.glyphs.strip}, browser ${vec.glyphs.viewer}, matched ${vec.glyphs.matched}` : ''}</span>
            <span>ran ${new Date(r.at).toLocaleString()}</span>
            <a href=${`${BUILD}${r.dir}/pageless.pdf`} target="_blank">pageless.pdf</a>
            <a href=${`${vdir}vector.json`} target="_blank">vector.json</a>
            ${liveSrc ? html`<a href=${liveSrc} target="_blank">page</a>` : null}
        </div>
    </div>`;
}

render(html`<${App}/>`, document.getElementById('app'));
