// SPDX-License-Identifier: AGPL-3.0-or-later
// The notice bar: how the page's log presents a record to readers – those
// the page's configuration shows (log.ts: `show`, by code or level; the
// fonts that failed to download, unless set). A bar at the bottom of the
// window, as a cookie notice is, with a line per kind of record (its latest
// message: the font line names every font that failed so far), Reload and
// Dismiss. A new record shows it again; a line whose cause has gone is changed
// or taken away (amendNotice). A page styles it with .latex-notice.
import type { LogRecord } from '../../../shared/log.ts';

let bar: HTMLDivElement | null = null;
const lines = new Map<string, string>();               // code → its latest message

const CSS = `
  .latex-notice { position: fixed; left: 50%; bottom: 16px; transform: translateX(-50%);
    z-index: 2147483000; box-sizing: border-box; width: min(44rem, calc(100vw - 32px));
    display: flex; align-items: center; gap: 12px; padding: 12px 14px 12px 18px;
    font: 14px/1.45 ui-sans-serif, system-ui, sans-serif; color: #fff; background: #2b2622;
    border-radius: 12px; box-shadow: 0 8px 28px rgba(0,0,0,.28); }
  /* display: flex above would outrank the hidden attribute Dismiss sets */
  .latex-notice[hidden] { display: none; }
  .latex-notice .latex-notice-text { flex: 1; }
  .latex-notice p { margin: 0; }
  .latex-notice p + p { margin-top: .4em; }
  .latex-notice button { font: inherit; font-weight: 600; color: inherit; cursor: pointer;
    border: 1px solid rgba(255,255,255,.35); background: none; border-radius: 8px; padding: 6px 12px; }
  .latex-notice button:hover { background: rgba(255,255,255,.12); }
  .latex-notice button[data-act="close"] { border: 0; padding: 6px 8px; font-size: 18px; line-height: 1; opacity: .8; }
  @media print { .latex-notice { display: none; } }`;

/** Show a record to readers. */
export function presentNotice(r: LogRecord): void {
    if (!document.body) return;
    if (!bar) {
        const st = document.createElement('style');
        st.textContent = CSS;
        document.head.appendChild(st);
        bar = document.createElement('div');
        bar.className = 'latex-notice';
        bar.setAttribute('role', 'alert');
        bar.innerHTML = '<div class="latex-notice-text"></div><button type="button" data-act="reload">Reload</button>'
            + '<button type="button" data-act="close" aria-label="Dismiss">×</button>';
        bar.addEventListener('click', e => {
            const act = (e.target as Element).closest('button')?.dataset.act;
            if (act === 'reload') location.reload();
            if (act === 'close') bar!.hidden = true;
        });
        document.body.appendChild(bar);
    }
    lines.set(r.code, r.message);
    drawLines();
    bar.hidden = false;
}

/** Change the line a kind of record has in the bar, when it has one: to
 *  `message`, or (null) take it away, and the bar with its last line. Not a
 *  new record: a bar the reader dismissed stays dismissed. */
export function amendNotice(code: string, message: string | null): void {
    if (!bar || !lines.has(code)) return;
    if (message === null) lines.delete(code);
    else lines.set(code, message);
    drawLines();
    if (!lines.size) bar.hidden = true;
}

function drawLines(): void {
    bar!.querySelector('.latex-notice-text')!.replaceChildren(...[...lines].map(([code, message]) => {
        const p = document.createElement('p');
        p.dataset.code = code;
        p.textContent = message;
        return p;
    }));
}
