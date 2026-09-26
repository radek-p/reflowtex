// SPDX-License-Identifier: AGPL-3.0-or-later
// The reader's highlighter: select some text and a small bar offers colours
// to mark it with, and an eraser. A highlight is a live mark (host.addMark):
// a band behind each of its lines, like the author's \webclass, kept through
// every reflow. Pressing highlighted text offers the same for that highlight.
//
// Declared in HTML:
//   <div data-rtx="highlighter"></div>
//   <div data-rtx="highlighter" data-colours="yellow green" data-store="false"></div>
//
// Each highlight's bands carry the classes `rtx-highlight rtx-highlight-NAME`
// in data-mark, and companion.css colours them from --rtx-highlight-NAME.
// Highlights are remembered per page (localStorage), by the positions of
// their glyphs and their text, so they come back on the next visit, and
// find their text again if the document has changed a little.
import { render } from 'preact';
import { useEffect, useMemo } from 'preact/hooks';
import { onHost, type Host, type LiveMark, type TextRange } from './host.ts';

export const HIGHLIGHT_COLOURS = ['yellow', 'green', 'pink', 'blue'];
const CLASS = 'rtx-highlight';
const KEY = 'reflowtex-highlights:';

const load = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const save = (k: string, v: string | null) => {
    try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode */ }
};

const classesOf = (colour: string) => `${CLASS} ${CLASS}-${colour}`;
const colourOf = (m: LiveMark) => (m.classes.match(new RegExp(`\\b${CLASS}-(\\S+)`)) || [])[1] || '';
const isHighlight = (m: LiveMark) => m.classes.split(/\s+/).includes(CLASS);
const overlap = (a: TextRange, b: TextRange) => a.block === b.block && a.from <= b.to && b.from <= a.to;

/** Highlight `ranges` in `colour`. Highlights they overlap are merged into
 *  the new one, which takes their places too. */
export function highlight(host: Host, ranges: readonly TextRange[], colour: string): LiveMark | null {
    let all = ranges.map(r => ({ ...r }));
    for (const m of host.liveMarks(ranges).filter(isHighlight)) {
        for (const r of m.ranges) {
            const into = all.find(q => overlap(q, r) || (q.block === r.block && (q.to + 1 === r.from || r.to + 1 === q.from)));
            if (into) { into.from = Math.min(into.from, r.from); into.to = Math.max(into.to, r.to); into.text = ''; }
            else all.push({ ...r });
        }
        m.remove();
    }
    all = all.map(r => ({ ...r, text: r.text || '' }));
    return host.addMark(all, { classes: classesOf(colour) });
}

/** Take `ranges` out of every highlight they touch: what is left of each
 *  stays, in its colour. */
export function erase(host: Host, ranges: readonly TextRange[]): void {
    for (const m of host.liveMarks(ranges).filter(isHighlight)) {
        const left: TextRange[] = [];
        for (const r of m.ranges) {
            let pieces: TextRange[] = [r];
            for (const q of ranges) {
                pieces = pieces.flatMap(p => {
                    if (!overlap(p, q)) return [p];
                    const out: TextRange[] = [];
                    if (p.from < q.from) out.push({ block: p.block, from: p.from, to: q.from - 1, text: '' });
                    if (q.to < p.to) out.push({ block: p.block, from: q.to + 1, to: p.to, text: '' });
                    return out;
                });
            }
            left.push(...pieces);
        }
        const classes = m.classes;
        m.remove();
        if (left.length) host.addMark(left, { classes });
    }
}

interface Saved { colour: string; ranges: TextRange[] }

/** Remember the page's highlights, and make them again when the page is
 *  opened: each once every block it reaches is on the page. */
function persist(host: Host, key: string): () => void {
    let pending: Saved[] = [];
    try { pending = JSON.parse(load(key) || '[]'); } catch { /* a broken entry: start afresh */ }
    if (!Array.isArray(pending)) pending = [];
    let restoring = false;
    const write = () => {
        if (restoring) return;
        const now: Saved[] = host.liveMarks().filter(isHighlight)
            .map(m => ({ colour: colourOf(m), ranges: m.ranges.slice() }));
        const all = [...now, ...pending];
        save(key, all.length ? JSON.stringify(all) : null);
    };
    const restore = () => {
        const keys = new Set(host.blocks().map(b => b.key));
        const ready = pending.filter(s => Array.isArray(s.ranges) && s.ranges.every(r => keys.has(r.block)));
        if (!ready.length) return;
        pending = pending.filter(s => !ready.includes(s));
        restoring = true;
        try { for (const s of ready) host.addMark(s.ranges, { classes: classesOf(s.colour || HIGHLIGHT_COLOURS[0]) }); }
        finally { restoring = false; }
        write();
    };
    document.addEventListener('reflowtex:marks', write);
    const off = host.onBlock(restore);
    return () => { document.removeEventListener('reflowtex:marks', write); off(); };
}

interface Target { ranges: TextRange[]; marks: LiveMark[]; rect: DOMRect }

function Bar({ host, target, colours, done }: { host: Host; target: Target; colours: string[]; done: () => void }) {
    const current = target.marks.length === 1 && !target.ranges.length ? colourOf(target.marks[0]) : '';
    const ranges = target.ranges.length ? target.ranges : target.marks.flatMap(m => m.ranges);
    const pick = (c: string) => {
        if (!target.ranges.length) for (const m of target.marks) m.setClasses(classesOf(c));
        else highlight(host, ranges, c);
        getSelection()?.removeAllRanges();
        done();
    };
    const remove = () => {
        if (!target.ranges.length) for (const m of target.marks) m.remove();
        else erase(host, ranges);
        getSelection()?.removeAllRanges();
        done();
    };
    return (
        // Pressing a button must not take the selection away.
        <div class="rtx-highlighter" role="toolbar" aria-label="Highlight" onPointerDown={e => e.preventDefault()}
             onMouseDown={e => e.preventDefault()}>
            {colours.map(c => (
                <button type="button" class={`rtx-highlighter-colour ${CLASS}-${c}`} aria-label={`Highlight: ${c}`}
                        aria-pressed={c === current} title={c} onClick={() => pick(c)} />))}
            {target.marks.length > 0 && (
                <button type="button" class="rtx-highlighter-erase" aria-label="Remove highlight" title="Remove"
                        onClick={remove}>
                    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                        <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
                    </svg>
                </button>)}
        </div>);
}

export interface HighlighterProps {
    /** The colours offered, by name (space-separated in HTML). */
    colours?: string | string[];
    /** Remember highlights per page (default true), under this key or
     *  the page's path. */
    store?: boolean | string;
}

export function Highlighter({ colours = HIGHLIGHT_COLOURS, store = true }: HighlighterProps) {
    const list = typeof colours === 'string' ? colours.split(/\s+/).filter(Boolean) : colours;
    const box = useMemo(() => document.createElement('div'), []);
    useEffect(() => {
        document.body.appendChild(box);
        let host: Host | null = null, target: Target | null = null, timer = 0, unpersist = () => {};
        const hide = () => { target = null; render(null, box); };
        const show = (t: Target) => {
            target = t;
            render(<Bar host={host!} target={t} colours={list} done={hide} />, box);
            const bar = box.firstElementChild as HTMLElement | null;
            if (!bar) return;
            const r = t.rect, w = bar.offsetWidth, h = bar.offsetHeight;
            const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8));
            const top = r.top - h - 8 >= 8 ? r.top - h - 8 : r.bottom + 8;
            bar.style.left = left + 'px';
            bar.style.top = top + 'px';
        };
        // The selection's box; WebKit gives an SVG text range none, so then
        // its highlighted glyphs' own.
        const rectOf = (range: Range): DOMRect => {
            const r = range.getBoundingClientRect();
            if (r.width || r.height) return r;
            const rs = [...range.getClientRects()].filter(x => x.width || x.height);
            return rs[0] || r;
        };
        const fromSelection = () => {
            timer = 0;
            if (!host) return;
            const sel = getSelection();
            if (!sel || sel.isCollapsed || !sel.rangeCount) { if (target && target.ranges.length) hide(); return; }
            const range = sel.getRangeAt(0), ranges = host.rangesOf(range);
            if (!ranges.length) { hide(); return; }
            show({ ranges, marks: host.liveMarks(ranges).filter(isHighlight), rect: rectOf(range) });
        };
        const onSelection = () => { clearTimeout(timer); timer = window.setTimeout(fromSelection, 120); };
        // Pressing highlighted text (no selection): the bar for that highlight.
        const onClick = (e: MouseEvent) => {
            if (!host || box.contains(e.target as Node)) return;
            const sel = getSelection();
            if (sel && !sel.isCollapsed) return;
            const el = e.target as Element;
            const marks = el && el.closest && el.closest('tspan[data-rtx-marks]')
                ? host.liveMarks(el).filter(isHighlight) : [];
            if (!marks.length) { if (target) hide(); return; }
            const rects = marks.flatMap(m => m.rects());
            const hit = rects.find(r => e.clientY >= r.top - 4 && e.clientY <= r.bottom + 4) || rects[0];
            show({ ranges: [], marks, rect: hit || new DOMRect(e.clientX, e.clientY, 0, 0) });
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && target) hide(); };
        const onScroll = () => { if (target && !target.ranges.length) hide(); else if (target) onSelection(); };
        onHost(h => {
            host = h;
            if (store) unpersist = persist(h, KEY + (typeof store === 'string' ? store : location.pathname));
        });
        document.addEventListener('selectionchange', onSelection);
        document.addEventListener('click', onClick);
        document.addEventListener('keydown', onKey);
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => {
            clearTimeout(timer);
            unpersist();
            document.removeEventListener('selectionchange', onSelection);
            document.removeEventListener('click', onClick);
            document.removeEventListener('keydown', onKey);
            window.removeEventListener('scroll', onScroll);
            render(null, box);
            box.remove();
        };
    }, [box, list.join(' '), store]);
    return null;
}
