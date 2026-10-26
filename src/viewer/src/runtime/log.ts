// SPDX-License-Identifier: AGPL-3.0-or-later
// The page's log (src/shared/log.ts): every record the viewer has – the
// warnings each block's data carries from the build, and the viewer's own –
// and what becomes of each, which the page configures:
//
//   - alerted (`alert`, the alerted level; 'error' unless set): a record at
//     that level or above is written to the browser's console and sent as
//     `reflowtex:log` on document. Below it, a record is only in the log
//     (host.log, the inspector's Log tab).
//   - shown to readers (`show`, a selection by code or level;
//     ['font-load-failed'] unless set): such a record is presented in the
//     notice bar at the bottom of the window (notice.ts).
//
// Each is set by the page's #latex-log-config island ({"alert": …, "show":
// […]}), read once the page has loaded, or by host.log.setAlertLevel and
// setShown, which win over it. Debug records (timings) are made only while
// window.reflowtex.debug is on, and then also printed.
import { Log, atLeast, isAlertLevel, parseSelection, selects, type AlertLevel, type LogLevel, type LogRecord, type LogSource } from '../../../shared/log.ts';
import { presentNotice } from './notice.ts';

export const pageLog = new Log('viewer');

export const DEFAULT_ALERT: AlertLevel = 'error';
export const DEFAULT_SHOW: readonly string[] = ['font-load-failed'];

// ── Configuration ─────────────────────────────────────────────────────────────
interface Config { alert?: AlertLevel; show?: string[] }
let island: Config | null = null;                    // read once the page has loaded
let alertSet: AlertLevel | null = null, showSet: string[] | null = null;
function config(): Config {
    if (island) return island;
    const el = document.getElementById('latex-log-config');
    let c: Config = {};
    if (el && el.textContent!.trim()) {
        try {
            const raw = JSON.parse(el.textContent!) as { alert?: unknown; show?: unknown };
            if (isAlertLevel(raw.alert)) c.alert = raw.alert;
            if (Array.isArray(raw.show)) c.show = raw.show.filter((s): s is string => typeof s === 'string');
            else if (typeof raw.show === 'string') c.show = parseSelection(raw.show);
        } catch (e) {
            c = {};
            island = c;
            report('error', 'log-config-malformed', 'malformed #latex-log-config JSON', { error: e });
        }
    }
    if (document.readyState !== 'loading') island = c;
    return c;
}
/** The alerted level in force. */
export const alertLevel = (): AlertLevel => alertSet ?? config().alert ?? DEFAULT_ALERT;
/** host.log.setAlertLevel: null goes back to the page's configuration. */
export function setAlertLevel(level: AlertLevel | null): void {
    if (level !== null && !isAlertLevel(level)) throw new TypeError(`alert level: 'none', 'error', 'warning', 'info' or 'debug', not ${JSON.stringify(level)}`);
    alertSet = level;
}
/** What is shown to readers. window.reflowtex.fontWarning = false (the
 *  switch from before the log) leaves font-load-failed out. */
export function shown(): string[] {
    const s = showSet ?? config().show ?? [...DEFAULT_SHOW];
    return window.reflowtex?.fontWarning === false ? s.filter(x => x !== 'font-load-failed') : s;
}
/** host.log.setShown: null goes back to the page's configuration. */
export function setShown(selection: readonly string[] | null): void {
    if (selection !== null && (!Array.isArray(selection) || selection.some(s => typeof s !== 'string')))
        throw new TypeError('shown: a list of codes and level names, or null');
    showSet = selection && [...selection];
}

// ── Sinks ─────────────────────────────────────────────────────────────────────
const CONSOLE: Record<LogLevel, 'debug' | 'info' | 'warn' | 'error'> = { debug: 'debug', info: 'info', warning: 'warn', error: 'error' };
// Alerted: on the console (with its cause, an exception's stack), and as an
// event. A debug record is printed while debugging, and alerted only at 'debug'.
pageLog.subscribe((r, cause) => {
    const alerted = atLeast(r.level, alertLevel());
    if (!alerted && !(r.level === 'debug' && window.reflowtex?.debug)) return;
    const line = `[${r.source === 'companion' ? 'reflowtex/companion' : 'latex-viewer'}] ${r.message}`;
    if (cause !== undefined) console[CONSOLE[r.level]](line, cause);
    else console[CONSOLE[r.level]](line);
    if (alerted) document.dispatchEvent(new CustomEvent('reflowtex:log', { detail: { record: r } }));
});
// Shown to readers: the notice bar.
pageLog.subscribe(r => { if (selects(shown(), r)) presentNotice(r); });

// ── Reporting ─────────────────────────────────────────────────────────────────
/** Log a record of the viewer's (or, through host.log.report, the page's):
 *  `details` are its particulars; an `error` among them is kept as its
 *  message, and given to the console as it is. */
export function report(level: LogLevel, code: string, message: string, details: Record<string, unknown> = {},
                       o: { block?: string | null; source?: LogSource } = {}): LogRecord {
    const { error, ...rest } = details;
    const all = error === undefined ? rest : { ...rest, error: error instanceof Error ? error.message : String(error) };
    return pageLog.add({ level, code, message, source: o.source, block: o.block ?? null,
        details: Object.fromEntries(Object.entries(all).map(([k, v]) => [k, String(v)])) }, error);
}
