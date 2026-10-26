// SPDX-License-Identifier: AGPL-3.0-or-later
// The Log view: the page's log (the viewer's host.log), as Chrome's Console
// lists messages – every record, newest last: the warnings each block's data
// carries from the build, the viewer's own, the companion's and the page's.
// What the page alerts or shows its readers is the page's configuration; this
// lists everything. Above the list, the levels shown (a toggle each, with its
// count), a code, and a text to find; each record names its block, which
// hovering outlines on the page and Show block selects in the Boxes view.
import { html, signal, computed, useLayoutEffect, useRef } from '../vendor/preact.js';
import { call, got } from './bridge.js';
import { recall, keep } from './store.js';
import { Action } from './ui.js';
import { reveal } from './tree.js';
import { setView } from './app.js';
import { LOG_LEVELS, codesOf, countByLevel, isLogLevel, matchesFilter, type LogLevel, type LogRecord } from '../../../shared/log.ts';

/** Every record read so far, oldest first; null before the first answer, or
 *  with no log in the page. */
export const logRecords = signal<LogRecord[] | null>(null);
const levels = signal<Set<LogLevel>>(new Set(recall<string[]>('log-levels', []).filter(isLogLevel)));
const code = signal('');
const text = signal('');
const sel = signal<number | null>(null);             // the selected record's seq

/** Read the records logged since the last read (polled while the panel is
 *  open, so the tab's count follows). */
export async function loadLog(): Promise<void> {
    const last = () => { const h = logRecords.value; return h && h.length ? h[h.length - 1].seq : 0; };
    const r = await call('logs', last());
    if (!got(r)) { if (logRecords.value !== null) logRecords.value = null; return; }
    // (another read may have answered meanwhile: only what it did not bring)
    const have = logRecords.value, after = last(), fresh = r.filter(x => x.seq > after);
    if (have && !fresh.length) return;
    logRecords.value = have ? [...have, ...fresh] : fresh;
}
export function forgetLog(): void { logRecords.value = null; sel.value = null; }

/** The tab's count: every record, and the gravest level among them. */
export const logBadge = computed(() => {
    const rs = logRecords.value;
    if (!rs || !rs.length) return null;
    const n = countByLevel(rs);
    return { count: rs.length, level: n.error ? 'error' : n.warning ? 'warning' : 'info' };
});
const shownRecords = computed(() => (logRecords.value || []).filter(r =>
    matchesFilter(r, { levels: levels.value, code: code.value, text: text.value })));

function setLevel(l: LogLevel, only: boolean) {
    const s = new Set(levels.value);
    if (only) { levels.value = s.size === 1 && s.has(l) ? new Set() : new Set([l]); }
    else {
        // (none on is all on: turning one off from there leaves the others)
        if (!s.size) for (const x of LOG_LEVELS) s.add(x);
        if (s.has(l)) s.delete(l); else s.add(l);
        levels.value = s.size === LOG_LEVELS.length ? new Set() : s;
    }
    keep('log-levels', [...levels.value]);
}
async function blockPath(key: string): Promise<number[] | null> {
    const p = await call('logBlock', key);
    return got(p) ? p : null;
}
let hovered: string | null = null;
async function hoverBlock(key: string | null) {
    if (key === hovered) return;
    hovered = key;
    const path = key ? await blockPath(key) : null;
    if (hovered === key) call('hover', path ? path[path.length - 1] : null);
}
async function showBlock(key: string) {
    const path = await blockPath(key);
    if (!path) return;
    setView('tree');
    await reveal(path, { openLast: true });
}

const LABEL: Record<LogLevel, string> = { error: 'Errors', warning: 'Warnings', info: 'Info', debug: 'Debug' };
const ORDER: LogLevel[] = ['error', 'warning', 'info', 'debug'];
const time = (ms: number) => { const d = new Date(ms); return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0'); };

function LogRow({ r, selected }: { r: LogRecord; selected: boolean }) {
    const details = Object.entries(r.details);
    return html`<div class=${`row lrow l-${r.level}${selected ? ' sel' : ''}`} role="option" aria-selected=${String(selected)}
            data-seq=${r.seq} data-level=${r.level} data-code=${r.code} data-block=${r.block || undefined}>
        <span class="lvl" title=${r.level}>${r.level === 'warning' ? 'warn' : r.level}</span>
        <span class="lmain">
            <span class="lmsg">${r.message}</span>
            ${details.length ? html`<span class="ldetails">${details.map(([k, v]) => html`<span key=${k}><i>${k}</i> ${v}</span>`)}</span>` : null}
        </span>
        <span class="lmeta">
            <span class="lcode" title="Its code">${r.code}</span>
            <span class="note" title=${`From the ${r.source}, at ${new Date(r.time).toLocaleString()}`}>${r.source} · ${time(r.time)}</span>
            ${r.block ? html`<button type="button" class="lblock" data-key=${r.block} title=${`Select block ${r.block} in the Boxes view`}>Show block</button>` : null}
        </span>
    </div>`;
}

export function LogView() {
    const body = useRef<HTMLDivElement>(null), all = logRecords.value, rs = shownRecords.value, on = levels.value;
    const n = countByLevel(all || []), codes = codesOf(all || []);
    // Newest last; the list keeps to its end while it is there.
    const atEnd = useRef(true);
    useLayoutEffect(() => { const el = body.current!; if (atEnd.current) el.scrollTop = el.scrollHeight; }, [rs.length]);
    const onScroll = () => { const el = body.current!; atEnd.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 4; };
    const onClick = (e: MouseEvent) => {
        const b = (e.target as Element).closest<HTMLElement>('.lblock');
        if (b) { showBlock(b.dataset.key!); return; }
        const row = (e.target as Element).closest<HTMLElement>('[data-seq]');
        if (row) sel.value = +row.dataset.seq!;
    };
    const onMouseMove = (e: MouseEvent) => {
        const row = (e.target as Element).closest<HTMLElement>('[data-seq]');
        hoverBlock(row && row.dataset.block ? row.dataset.block : null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
        const i = rs.findIndex(r => r.seq === sel.value);
        if (e.key === 'ArrowDown' && i < rs.length - 1) sel.value = rs[i + 1].seq;
        else if (e.key === 'ArrowUp' && i > 0) sel.value = rs[i - 1].seq;
        else if (e.key === 'Enter' && i >= 0 && rs[i].block) showBlock(rs[i].block!);
        else return;
        e.preventDefault();
    };
    const onFilterKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && text.value) { e.stopPropagation(); text.value = ''; } };
    const filtered = !!(on.size || code.value || text.value.trim());
    return html`<section class="logs">
        <div class="rtools ltools">
            <input type="search" class="filter" placeholder="Filter" aria-label="Filter the log by text" spellcheck="false"
                value=${text.value} onInput=${(e: Event & { currentTarget: HTMLInputElement }) => { text.value = e.currentTarget.value; }} onKeyDown=${onFilterKey}/>
            <select class="lcodes" aria-label="Show one code" title="Show the records of one code" value=${code.value}
                    onChange=${(e: Event & { currentTarget: HTMLSelectElement }) => { code.value = e.currentTarget.value; }}>
                <option value="">All codes</option>
                ${codes.map(c => html`<option key=${c} value=${c}>${c}</option>`)}
            </select>
            <span class="levels" role="group" aria-label="Levels shown">
                ${ORDER.map(l => html`<button type="button" key=${l} class=${'lvlbtn l-' + l} data-level=${l}
                        aria-pressed=${String(!on.size || on.has(l))} title=${`Show ${LABEL[l].toLowerCase()} (Alt-click: only these)`}
                        onClick=${(e: MouseEvent) => setLevel(l, e.altKey)}>${LABEL[l]} <span class="count">${n[l]}</span></button>`)}
            </span>
            ${filtered ? html`<${Action} title="Show every record" onClick=${() => { levels.value = new Set(); keep('log-levels', []); code.value = ''; text.value = ''; }}>Clear filter<//>` : null}
        </div>
        <div class="rbody lbody" role="listbox" tabindex="0" aria-label="Log" ref=${body}
                onScroll=${onScroll} onClick=${onClick} onMouseMove=${onMouseMove} onMouseLeave=${() => hoverBlock(null)} onKeyDown=${onKeyDown}>
            ${all === null ? html`<div class="empty">This page's viewer keeps no log.</div>`
            : !all.length ? html`<div class="empty">Nothing logged.</div>`
            : !rs.length ? html`<div class="empty">Nothing matches (${all.length} record${all.length === 1 ? '' : 's'} in all).</div>`
            : rs.map(r => html`<${LogRow} key=${r.seq} r=${r} selected=${r.seq === sel.value}/>`)}
        </div>
        ${all && all.length ? html`<div class="lfoot muted">${filtered ? `${rs.length} of ${all.length}` : `${all.length}`} record${all.length === 1 ? '' : 's'}</div>` : null}
    </section>`;
}
