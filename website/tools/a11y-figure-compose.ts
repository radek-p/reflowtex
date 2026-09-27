// SPDX-License-Identifier: AGPL-3.0-or-later
// The Accessibility page's figure from what a live render gave (a11y-figure.ts
// captures it): for each line, the drawn glyphs as outlines with the layer's
// regions over them – hidden from screen readers, it is a picture – and under
// it what a screen reader is given for that line, as the page's own content:
// a row with the formulas as MathML (their spoken form in alttext), and a row
// with them spoken. The page shows the row of the reader's choice.

export interface Box { x: number; y: number; w: number; h: number }
export interface Part { kind: string; text?: string; mathml?: string; box: Box }
export interface Piece { display: boolean; lines: { parts: Part[] }[] }
export interface Glyph { ch: string; family: string; size: number; x: number; y: number; scale: number }
export interface Captured { mathml: Piece[]; spoken: Piece[]; glyphs: Glyph[]; rules: Box[] }

const PAD = 4;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const n = (x: number) => String(Math.round(x * 100) / 100);
const SPEAKER = '<span class="a11y-speaker" aria-hidden="true"><svg viewBox="0 0 20 20" width="1.1em" height="1.1em">'
  + '<path d="M3 7.5h3l4.5-3.5v12L6 12.5H3z" fill="currentColor"/>'
  + '<path d="M13.2 7a4.2 4.2 0 0 1 0 6M15.6 4.8a7.4 7.4 0 0 1 0 10.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></span>';

/** The figure's HTML. `outline(family, char)` is a glyph's path, drawn at
 *  1000 px, baseline at 0, y down. */
export function composeFigure(c: Captured, outline: (family: string, ch: string) => string): string {
  const all = c.mathml.flatMap(p => p.lines.flatMap(l => l.parts.map(q => q.box)));
  const left = Math.min(...all.map(b => b.x)), right = Math.max(...all.map(b => b.x + b.w));
  const width = right - left + 2 * PAD;
  const ids = new Map<string, string>(), defs: string[] = [];
  const glyphId = (g: Glyph) => {
    const key = `${g.family}\u0000${g.ch}`;
    let id = ids.get(key);
    if (!id) {
      id = `a11y-g${ids.size + 1}`;
      ids.set(key, id);
      defs.push(`<path id="${id}" d="${outline(g.family, g.ch)}"/>`);
    }
    return id;
  };

  const pieces = c.mathml.map((piece, k) => {
    const lines = piece.lines.map((line, j) => {
      const boxes = line.parts.map(p => p.box);
      const y0 = Math.min(...boxes.map(b => b.y)), y1 = Math.max(...boxes.map(b => b.y + b.h));
      const w = width, h = y1 - y0 + 2 * PAD;
      const X = (x: number) => n(x - left + PAD), Y = (y: number) => n(y - y0 + PAD);
      const mine = c.glyphs.filter(g => g.y >= y0 - 1 && g.y <= y1 + 1 && g.x >= left - 8 && g.x <= right + 8);
      const uses = mine.map(g => `<use href="#${glyphId(g)}" transform="translate(${X(g.x)} ${Y(g.y)}) scale(${(g.size * g.scale / 1000).toFixed(5)})"/>`);
      const rules = c.rules.filter(r => r.y + r.h / 2 >= y0 && r.y + r.h / 2 <= y1 && r.x >= left - 8 && r.x + r.w <= right + 8)
        .map(r => `<rect class="a11y-rule" x="${X(r.x)}" y="${Y(r.y)}" width="${n(r.w)}" height="${n(r.h)}"/>`);
      const regions = line.parts.map(p => `<rect class="a11y-region${p.kind === 'math' ? ' math' : ''}" x="${X(p.box.x)}" y="${Y(p.box.y)}" width="${n(p.box.w)}" height="${n(p.box.h)}"/>`);
      const svg = `<svg class="a11y-drawn" aria-hidden="true" focusable="false" viewBox="0 0 ${n(w)} ${n(h)}" width="${n(w)}" height="${n(h)}">`
        + uses.join('') + rules.join('') + regions.join('') + '</svg>';
      const withMath = line.parts.map(p => (p.kind === 'math' ? p.mathml ?? '' : esc(p.text ?? ''))).join('');
      const spokenLine = c.spoken[k]?.lines[j];
      const words = spokenLine ? spokenLine.parts.map(p => esc(p.text ?? '')).join('') : '';
      return `<div class="a11y-line">${svg}`
        + `<p class="a11y-said" data-mode="mathml">${SPEAKER}${withMath.trim()}</p>`
        + `<p class="a11y-said" data-mode="spoken">${SPEAKER}${words.trim()}</p></div>`;
    });
    return `<div class="a11y-piece${piece.display ? ' display' : ''}">${lines.join('')}</div>`;
  });

  // (as wide as its drawn lines: a longer reading row wraps under its line)
  return `<div class="a11y-reading-figure" data-mode="mathml" style="max-width:${n(width)}px">`
    + `<svg class="a11y-glyphs" width="0" height="0" aria-hidden="true" focusable="false"><defs>${defs.join('')}</defs></svg>`
    + pieces.join('') + '</div>\n';
}
