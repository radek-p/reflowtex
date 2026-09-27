// SPDX-License-Identifier: AGPL-3.0-or-later

// Copying from a block: a word the viewer hyphenated at a line's end is
// copied whole, as a screen reader reads it (runtime/a11y.js) – "paragraph",
// not "para-" and "graph". The hyphen is the line break's (a discretionary's
// pre-break text, marked data-break by the painter); a hyphen the author
// wrote ("well-known", data-break="keep") is text, and stays – the word is
// joined all the same.
//
// The browser's own copy stays in charge of everything else: for the
// moment of reading the selection, each marked hyphen's character is swapped
// for an invisible one of the same length (the selection's offsets do not
// move); each run of them is then taken out with the line break after it,
// or given back as it was where the hyphen is the author's.

const SENTINEL = '\u2063';     // INVISIBLE SEPARATOR
const JOIN = new RegExp(`${SENTINEL}+[ \\t]*(?:\\r?\\n[ \\t]*)?`, 'g');

/** The selection's text, with the words broken at line ends whole again. */
export function copiedText(sel) {
    const marks = [...document.querySelectorAll('.latex-block tspan[data-break]')]
        .filter(t => t.firstChild && sel.containsNode(t, true));
    if (!marks.length) return null;
    const kept = marks.map(t => ({ node: t.firstChild, data: t.firstChild.data, keep: t.dataset.break === 'keep' }));
    for (const k of kept) k.node.data = SENTINEL.repeat(k.data.length);
    let text;
    try { text = sel.toString(); } finally { for (const k of kept) k.node.data = k.data; }
    // the runs, in order: each is the next marks' characters (the selection
    // may take only part of the first or last)
    let i = 0;
    return text.replace(JOIN, run => {
        let n = run.replace(/[^\u2063]/g, '').length, out = '';
        while (n > 0 && i < kept.length) { const k = kept[i++]; if (k.keep) out += k.data.slice(0, n); n -= k.data.length; }
        return out;
    });
}

if (typeof document !== 'undefined') {
    document.addEventListener('copy', e => {
        const sel = document.getSelection();
        if (!sel || sel.isCollapsed || !e.clipboardData) return;
        const text = copiedText(sel);
        if (text === null) return;
        e.clipboardData.setData('text/plain', text);
        e.preventDefault();
    });
}
