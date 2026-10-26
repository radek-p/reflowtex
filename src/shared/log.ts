// SPDX-License-Identifier: AGPL-3.0-or-later
// Reflow TeX's log: one record of every message the project gives – the
// pipeline's and the integrations' build lines, the warnings a block carries
// to the page, the viewer's own – each with a level and a stable code, so
// that what is shown, and to whom, is chosen by configuration rather than by
// the code that reports it.
//
// A Log keeps its records and hands each to its sinks: the build's console
// (consoleSink: the lines as printed), the viewer's page log (its alerts on
// the console and as an event, and the notices shown to readers), the
// inspector's Log tab. It imports nothing, so it runs anywhere: in Node, and
// bundled into the viewer, the companion and the inspector.

/** How much a record matters, least first. */
export type LogLevel = 'debug' | 'info' | 'warning' | 'error';
export const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warning', 'error'];
export const isLogLevel = (s: unknown): s is LogLevel => typeof s === 'string' && (LOG_LEVELS as readonly string[]).includes(s);

/** A record as it travels in a block's data (latex.proto, Warning; a
 *  Document's `warnings`): what the build found about that block. */
export interface Warning {
    level: 'error' | 'warning' | 'info';
    code: string;
    message: string;
    details: { [key: string]: string };
}

/** Where a record comes from: the build (a block's warnings, or a build
 *  line), the viewer in the page, the companion's components, or the page's
 *  own code (host.log.report). */
export type LogSource = 'pipeline' | 'viewer' | 'companion' | 'page';

/** One record of the log. */
export interface LogRecord {
    /** Its place in its log, from 1: a later record has a larger one. */
    seq: number;
    level: LogLevel;
    /** What kind of message it is, stable across versions and wordings
     *  (`font-load-failed`, `missing-char`): what configuration selects by. */
    code: string;
    /** The message in words, as a person reads it. */
    message: string;
    /** Its particulars, by name (a font, a character, a file): plain strings. */
    details: { [key: string]: string };
    source: LogSource;
    /** The block it is about (its key), or null for the page or the build. */
    block: string | null;
    /** When it was logged (ms since the epoch). */
    time: number;
}

/** What a record is made from: the rest is filled in by the log. */
export type LogEntry = Pick<LogRecord, 'level' | 'code' | 'message'> & Partial<Pick<LogRecord, 'source' | 'block' | 'time'>>
    & { /** Its particulars, made strings. */ details?: { [key: string]: unknown } };

/** Whether `level` is at `threshold` or above. `'none'` is above every level. */
export function atLeast(level: LogLevel, threshold: LogLevel | 'none'): boolean {
    return threshold !== 'none' && LOG_LEVELS.indexOf(level) >= LOG_LEVELS.indexOf(threshold);
}

// ── Selecting records ──────────────────────────────────────────────────────────

/** The alerted level (the viewer's option): records at it or above are
 *  alerted – written to the browser's console and sent as an event. */
export type AlertLevel = LogLevel | 'none';
export const isAlertLevel = (s: unknown): s is AlertLevel => s === 'none' || isLogLevel(s);

/** A selection of records by kind: each entry is a code (that kind of
 *  record) or a level's name (every record at that level or above). A
 *  record is selected when any entry selects it; [] selects none. */
export type LogSelection = readonly string[];
export function selects(selection: LogSelection, r: Pick<LogRecord, 'level' | 'code'>): boolean {
    return selection.some(s => (isLogLevel(s) ? atLeast(r.level, s) : s === r.code));
}
/** A selection written as text (a data attribute, a command-line flag):
 *  its entries separated by spaces or commas; `none` (or nothing) is []. */
export function parseSelection(text: string): string[] {
    return text.split(/[\s,]+/).filter(s => s && s !== 'none');
}

/** The Log tab's filter: levels shown (all, when empty), a code (exact) and
 *  a text found in the message, the code, a detail or the block's key (any
 *  case). Empty fields filter nothing. */
export interface LogFilter {
    levels?: ReadonlySet<LogLevel> | readonly LogLevel[];
    code?: string;
    text?: string;
}
export function matchesFilter(r: LogRecord, f: LogFilter): boolean {
    const levels = f.levels ? [...f.levels] : [];
    if (levels.length && !levels.includes(r.level)) return false;
    if (f.code && r.code !== f.code) return false;
    const q = (f.text || '').trim().toLowerCase();
    if (!q) return true;
    const hay = [r.message, r.code, r.block || '', ...Object.entries(r.details).map(([k, v]) => `${k} ${v}`)];
    return hay.some(s => s.toLowerCase().includes(q));
}
/** The codes among some records, sorted (the Log tab's code menu). */
export const codesOf = (records: readonly LogRecord[]): string[] => [...new Set(records.map(r => r.code))].sort();
/** How many records there are of each level. */
export function countByLevel(records: readonly LogRecord[]): Record<LogLevel, number> {
    const n: Record<LogLevel, number> = { debug: 0, info: 0, warning: 0, error: 0 };
    for (const r of records) n[r.level]++;
    return n;
}

// ── The log ────────────────────────────────────────────────────────────────────

/** Given every record as it is logged, and what it was reported with that
 *  is not data (an exception, for a console to show with its stack). */
export type LogSink = (r: LogRecord, cause?: unknown) => void;

/** The wire form's details: a map that decodes as absent when empty. */
const detailsOf = (d: { [key: string]: unknown } | null | undefined): { [key: string]: string } =>
    Object.fromEntries(Object.entries(d ?? {}).map(([k, v]) => [k, String(v)]));

export class Log {
    private readonly list: LogRecord[] = [];
    private readonly sinks = new Set<LogSink>();
    private seq = 0;
    private readonly source: LogSource;
    /** `source`: what records logged here come from unless they say. */
    constructor(source: LogSource, sinks: Iterable<LogSink> = []) {
        this.source = source;
        for (const s of sinks) this.sinks.add(s);
    }
    /** Add a record; every sink is given it, with `cause` (a sink that
     *  throws is skipped). */
    add(e: LogEntry, cause?: unknown): LogRecord {
        const r: LogRecord = {
            seq: ++this.seq, level: e.level, code: e.code, message: e.message, details: detailsOf(e.details),
            source: e.source ?? this.source, block: e.block ?? null, time: e.time ?? Date.now(),
        };
        this.list.push(r);
        for (const s of [...this.sinks]) {
            try { s(r, cause); } catch { /* a sink's failure is not the reporter's */ }
        }
        return r;
    }
    debug(code: string, message: string, details?: LogEntry['details']): LogRecord { return this.add({ level: 'debug', code, message, details }); }
    info(code: string, message: string, details?: LogEntry['details']): LogRecord { return this.add({ level: 'info', code, message, details }); }
    warn(code: string, message: string, details?: LogEntry['details']): LogRecord { return this.add({ level: 'warning', code, message, details }); }
    error(code: string, message: string, details?: LogEntry['details']): LogRecord { return this.add({ level: 'error', code, message, details }); }
    /** A block's warnings, as its data carries them. */
    addWarnings(warnings: readonly Partial<Warning>[] | null | undefined, block: string | null, source: LogSource = 'pipeline'): LogRecord[] {
        return (warnings ?? []).map(w => this.add({
            level: isLogLevel(w.level) ? w.level : 'warning', code: w.code || 'unknown', message: w.message || '',
            details: w.details, source, block,
        }));
    }
    /** Every record so far, oldest first (a copy); with `after`, those after
     *  that seq. */
    records(after = 0): LogRecord[] { return after ? this.list.filter(r => r.seq > after) : this.list.slice(); }
    /** Be given every record from now on; returns the call that stops it. */
    subscribe(sink: LogSink): () => void {
        this.sinks.add(sink);
        return () => { this.sinks.delete(sink); };
    }
}

/** A record in the wire form a block's data carries (debug is not carried). */
export function toWarning(r: Pick<LogRecord, 'level' | 'code' | 'message' | 'details'>): Warning {
    return { level: r.level === 'debug' ? 'info' : r.level, code: r.code, message: r.message, details: { ...r.details } };
}

/** The console as a build's sink: each record's message as one line, as the
 *  build has always printed it – an error on stderr (console.error), the
 *  rest on stdout (console.log). `debug`: whether debug records print. */
export function consoleSink({ debug = false }: { debug?: boolean } = {}): LogSink {
    return r => {
        if (r.level === 'debug' && !debug) return;
        if (r.level === 'error') console.error(r.message);
        else console.log(r.message);
    };
}

/** A build's log (the pipeline's, an integration's): its records printed as
 *  the build has always printed them (consoleSink). */
export const consoleLog = (o: { debug?: boolean } = {}): Log => new Log('pipeline', [consoleSink(o)]);
