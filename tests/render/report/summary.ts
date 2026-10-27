// SPDX-License-Identifier: AGPL-3.0-or-later
// The report's summary of a test: its `problems` (result.json), lines of
// text, sorted into groups – lines and steps, glyphs, rules – with the places
// they name picked out, so that the report can list them and go to each; and
// a headline of a few numbers for the line above the two sides (app.ts).
//
// The lines are written by render.ts's problems(), and by other tools that
// fill result.json in the same words; their text is the format, and is read
// as it is. A line of a shape not known here is kept whole, under Other, and
// a known one whose list of places does not read is shown whole too.
// Pure functions, no DOM: app.ts shows them; tests/unit tests them.

export type GroupKey = 'lines' | 'glyphs' | 'rules' | 'other';
export const GROUP_TITLES: Record<GroupKey, string> = { lines: 'Lines and steps', glyphs: 'Glyphs', rules: 'Rules', other: 'Other' };
const ORDER: GroupKey[] = ['lines', 'glyphs', 'rules', 'other'];

/** A place a line names, at y (pt, in the frame both sides are in). */
export interface Place { y: number; label: string }
/** A line saying something: its words up to the places it lists (all of it
 *  when it lists none), and those places. */
export interface Fact { text: string; head: string; places: Place[] }
/** Where the browser's lines stand at another height to TeX's from one line
 *  on: at browser y `y`, TeX y `texY`; dy (browser − TeX) before and after,
 *  as written; the change in pt; the line's first characters. */
export interface Step { text: string; word: string; y: number; texY: number; before: string; after: string; change: number; quote: string; first: boolean }
export interface Group { key: GroupKey; title: string; facts: Fact[]; steps: Step[] }
export interface Summary {
    groups: Group[];
    /** A few numbers for the line above the two sides: the most telling line
     *  of each group, shortened, in the order the lines came. */
    headline: string[];
}

// a number as the lines write them: 12, -0.5, 1.2e-5
const N = String.raw`-?\d+(?:\.\d+)?(?:e[-+]?\d+)?`;
const re = (s: string, flags = '') => new RegExp(s, flags);

/** A known shape of line: its group; how telling it is for the headline
 *  (lower is more); its short form; and how the places it lists read. */
interface Shape { group: GroupKey; match: RegExp; rank: number; short: (m: RegExpMatchArray) => string; places?: (rest: string) => Place[] }

const all = (s: string, pattern: string, label: (m: RegExpMatchArray) => string): Place[] =>
    [...s.matchAll(re(pattern, 'g'))].map(m => ({ y: Number(m[1]), label: label(m) }));

const SHAPES: Shape[] = [
    // lines and steps
    { group: 'lines', rank: 1, match: re(String.raw`^vertical: (\d+) jump\(s\)(?:.*?largest (${N}) pt)?`),
      short: m => (m[1] === '0' ? 'no jumps' : `${m[1]} jump(s)${m[2] !== undefined ? `, largest ${m[2]} pt` : ''}`) },
    { group: 'lines', rank: 2, match: re(String.raw`^lines: (\d+) of (\d+) browser lines matched[^;]*(?:; (\d+) step\(s\))?`),
      short: m => `${m[1]} of ${m[2]} lines matched${m[3] !== undefined ? `, ${m[3]} step(s)` : ''}` },
    // glyphs
    { group: 'glyphs', rank: 0, match: /^the PDF has no glyphs/, short: () => 'the PDF has no glyphs' },
    { group: 'glyphs', rank: 1, match: re(String.raw`^placement (${N} %)`), short: m => `placement ${m[1]}` },
    { group: 'glyphs', rank: 2, match: re(String.raw`^glyphs TeX \d+ / drawn \d+ / matched \d+.*?within (${N}) pt: (${N} %)`),
      short: m => `${m[2]} of glyphs within ${m[1]} pt` },
    { group: 'glyphs', rank: 3, match: re(String.raw`^(\d+) glyphs off by more than (${N}) pt`),
      short: m => `${m[1]} glyphs off by more than ${m[2]} pt`,
      places: s => [...s.matchAll(re(String.raw`("(?:[^"\\]|\\.)*") at y (${N}) off by \(([^)]*)\)`, 'g'))]
          .map(m => ({ y: Number(m[2]), label: `${m[1]} ${m[3]}` })) },
    { group: 'glyphs', rank: 4, match: /^the browser drew (\d+) glyphs, TeX (\d+)/, short: m => `browser ${m[1]} glyphs, TeX ${m[2]}` },
    { group: 'glyphs', rank: 5, match: /^(\d+) of the browser's glyphs have no glyph in the PDF/, short: m => `${m[1]} browser glyphs without a partner` },
    { group: 'glyphs', rank: 6, match: re(String.raw`^across\b.*?: (\d+) of (\d+) glyphs beyond (${N}) pt`), short: m => `${m[1]} of ${m[2]} glyphs off across` },
    { group: 'glyphs', rank: 7, match: re(String.raw`^absolute\b.*?: (${N} %) within`), short: m => `absolute ${m[1]}` },
    // rules
    { group: 'rules', rank: 1, match: /^(\d+) rules in the PDF the browser did not draw \((\d+) allowed\)/,
      short: m => `${m[1]} rules not drawn (${m[2]} allowed)`, places: s => all(s, String.raw`at y (${N})`, () => 'not drawn') },
    { group: 'rules', rank: 2, match: /^(\d+) rules drawn by the browser are not in the PDF/, short: m => `${m[1]} rules not in the PDF` },
    { group: 'rules', rank: 3, match: re(String.raw`^(\d+) rules off by more than (${N}) pt`),
      short: m => `${m[1]} rules off by more than ${m[2]} pt`, places: s => all(s, String.raw`at y (${N}) \(([^)]*)\)`, m => m[2]) },
];
const STEP = re(String.raw`^(step|jump) at browser y (${N}) \(TeX y (${N})\)(, before the first line)?: dy (\S+) → (\S+) \(([+-]?${N}) pt\)\s*(.*)$`, 's');

/** A quoted line's characters: the JSON string read, or as written. */
function unquote(s: string): string {
    try { const v: unknown = JSON.parse(s); return typeof v === 'string' ? v : s; } catch { return s; }
}

export function summarise(problems: readonly string[]): Summary {
    const groups = new Map<GroupKey, Group>(ORDER.map(key => [key, { key, title: GROUP_TITLES[key], facts: [], steps: [] }]));
    const best = new Map<GroupKey, { rank: number; at: number; short: string }>();
    problems.forEach((text, at) => {
        const s = STEP.exec(text);
        if (s) {
            groups.get('lines')!.steps.push({ text, word: s[1], y: Number(s[2]), texY: Number(s[3]), first: !!s[4], before: s[5], after: s[6],
                                              change: Number(s[7]), quote: unquote(s[8].trim()) });
            return;
        }
        for (const shape of SHAPES) {
            const m = text.match(shape.match);
            if (!m) continue;
            // the places listed after the line's head (past its colon)
            const colon = text.indexOf(': ', m[0].length);
            const places = shape.places && colon >= 0 ? shape.places(text.slice(colon + 2)) : [];
            groups.get(shape.group)!.facts.push({ text, head: places.length ? text.slice(0, colon) : text, places });
            const b = best.get(shape.group);
            if (!b || shape.rank < b.rank) best.set(shape.group, { rank: shape.rank, at, short: shape.short(m) });
            return;
        }
        groups.get('other')!.facts.push({ text, head: text, places: [] });
    });
    const headline = [...best.values()].sort((a, b) => a.at - b.at).map(b => b.short);
    return { groups: [...groups.values()].filter(g => g.facts.length || g.steps.length), headline };
}
