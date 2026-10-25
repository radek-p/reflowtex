// SPDX-License-Identifier: AGPL-3.0-or-later

// Copying from a block: the text copied is the text the glyphs say
// (src/shared/glyph-text.ts), as a screen reader reads it (runtime/a11y.ts).
//  * A glyph drawn by a code point that is not its text – a private-use
//    code, which says nothing; a ligature, which is its letters – is marked
//    by the painter with its text (data-text), and copied as that.
//  * A word the viewer hyphenated at a line's end is copied whole –
//    "paragraph", not "para-" and "graph". The hyphen is the line break's (a
//    discretionary's pre-break text, marked data-break by the painter); a
//    hyphen the author wrote ("well-known", data-break="keep") is text, and
//    stays – the word is joined all the same.
//
// The browser's own copy stays in charge of everything else: for the
// moment of reading the selection, each marked glyph's character is swapped
// for an invisible one of the same length (the selection's offsets do not
// move); each run of them is then given its glyphs' text, or – a hyphen's –
// taken out with the line break after it, or given back as it was where the
// hyphen is the author's.

const BREAK = '⁣';        // INVISIBLE SEPARATOR
const TEXT = '⁤';         // INVISIBLE PLUS
const JOIN = new RegExp(`${BREAK}+[ \\t]*(?:\\r?\\n[ \\t]*)?`, 'g');
const TEXTS = new RegExp(`${TEXT}+`, 'g');

/** Whether some of a glyph element's text is in the selection: one it
 *  starts at the end of, or ends at the start of, is touched but not taken. */
function taken(sel: Selection, el: Element): boolean {
    const t = el.firstChild;
    if (!t || !sel.containsNode(el, true)) return false;
    for (let i = 0; i < sel.rangeCount; i++) {
        const r = sel.getRangeAt(i);
        if (!r.intersectsNode(el)) continue;
        if (r.startContainer === t && r.startOffset >= (t.textContent || '').length) continue;
        if ((r.endContainer === t || r.endContainer === el) && r.endOffset === 0) continue;
        return true;
    }
    return false;
}

/** The selection's text: each glyph's own, and the words broken at line
 *  ends whole again; null when the browser's own copy is that already. */
export function copiedText(sel: Selection): string | null {
    const marked = (which: string) => [...document.querySelectorAll<SVGTSpanElement>(`.latex-block tspan${which}`)]
        .filter(t => taken(sel, t))
        .map(t => ({ node: t.firstChild as Text, data: (t.firstChild as Text).data, keep: t.dataset.break === 'keep', text: t.dataset.text ?? '' }));
    const breaks = marked('[data-break]'), texts = marked('[data-text]:not([data-break])');
    if (!breaks.length && !texts.length) return null;
    for (const k of breaks) k.node.data = BREAK.repeat(k.data.length);
    for (const k of texts) k.node.data = TEXT.repeat(k.data.length);
    let text: string;
    try { text = sel.toString(); } finally { for (const k of [...breaks, ...texts]) k.node.data = k.data; }
    // the runs, in order: each is the next marks' characters (the selection
    // may take only part of the first or last)
    let i = 0, j = 0;
    return text.replace(TEXTS, run => {
        let n = run.length, out = '';
        while (n > 0 && i < texts.length) { const k = texts[i++]; out += k.text; n -= k.data.length; }
        return out;
    }).replace(JOIN, run => {
        let n = run.replace(/[^⁣]/g, '').length, out = '';
        while (n > 0 && j < breaks.length) { const k = breaks[j++]; if (k.keep) out += k.data.slice(0, n); n -= k.data.length; }
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
