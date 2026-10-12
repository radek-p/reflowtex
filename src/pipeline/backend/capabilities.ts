// SPDX-License-Identifier: AGPL-3.0-or-later
// What a capture backend can do, as named flags with precise meanings.
//
// A backend publishes a Capabilities descriptor; the pipeline and hosts ask
// it instead of assuming LuaTeX. A flag is true only when the backend claims
// it, and the conformance suite (tests/backends) checks every claim; an
// unknown or absent flag reads as false. docs/backends.md has the table of
// every capability by backend.

/** Every capability, in the order the documentation lists them. */
export const CAPABILITY_NAMES = [
  'multiPass', 'widthResampling', 'singlePassDisplays',
  'opentypeFonts', 'classicFonts', 'protrusion', 'fontExpansion',
  'pictures', 'companion', 'batchParts',
  'tagging', 'mathml',
  'glyphSourceLines', 'glyphSourceMap', 'texBreaks',
  'incremental', 'inBrowser', 'shellEscape',
] as const;

export type CapabilityName = (typeof CAPABILITY_NAMES)[number];

/** A backend's descriptor: a flag per capability it has. What is absent it
 *  does not have. */
export type Capabilities = Partial<Record<CapabilityName, boolean>>;

/** What a document loses when a capability it needs is missing: `error`
 *  stops the build (the result would be wrong or incomplete), `warn` builds
 *  it with a warning (the result is right, but less refined). */
export type WhenMissing = 'error' | 'warn';

export interface CapabilityInfo {
  name: CapabilityName;
  /** what a backend claiming it promises */
  meaning: string;
  whenMissing: WhenMissing;
}

/** The meaning of each capability: the contract a claim is checked against. */
export const CAPABILITIES: readonly CapabilityInfo[] = [
  { name: 'multiPass', whenMissing: 'error',
    meaning: 'Runs the document again, up to the passes asked for, until the files TeX reads back (.aux, .toc, .lof, .lot) stop changing, so cross-references, citations and contents resolve.' },
  { name: 'widthResampling', whenMissing: 'warn',
    meaning: 'Compiles the same document with its text width widened by a given amount (CaptureRun.widthExtraSp) and reports the width it used (source_width). The pipeline models displays across widths by compiling a few such samples.' },
  { name: 'singlePassDisplays', whenMissing: 'warn',
    meaning: 'One run already gives every display its model across widths (the output is marked display_model), so the pipeline compiles no width samples.' },
  { name: 'opentypeFonts', whenMissing: 'error',
    meaning: 'OpenType fonts (fontspec, unicode-math) are captured with the font file each glyph comes from.' },
  { name: 'classicFonts', whenMissing: 'error',
    meaning: '8-bit TFM fonts (Computer Modern and the other Type 1 families) are captured with their font files, character codes and hyphenation as TeX made them.' },
  { name: 'protrusion', whenMissing: 'warn',
    meaning: "microtype's character protrusion: paragraphs carry protrude_chars and fonts each character's protrusion codes, so the browser hangs punctuation into the margin as TeX does." },
  { name: 'fontExpansion', whenMissing: 'warn',
    meaning: "microtype's font expansion: paragraphs carry adjust_spacing and fonts their expansion limits, step and per-character factors." },
  { name: 'pictures', whenMissing: 'error',
    meaning: 'TikZ pictures and included graphics are captured as picture nodes with TeX\'s box metrics, and the pipeline gets SVG for each (from the run\'s PDF pages, or from the backend\'s own picture source).' },
  { name: 'companion', whenMissing: 'error',
    meaning: 'The companion package (reflowtex.sty, reflowtex-lean.sty) works: streams, \\webtext slots, \\webwidget instances and parts, \\webspan marks, actions.' },
  { name: 'batchParts', whenMissing: 'error',
    meaning: 'Several parts compiled as one document (Pipeline.compileBatch) come back cut at each part, numbering and references carried across.' },
  { name: 'tagging', whenMissing: 'error',
    meaning: "The author's \\DocumentMetadata is honoured: LaTeX's tagging code runs, and the node lists are what they are without it." },
  { name: 'mathml', whenMissing: 'error',
    meaning: "Formulas carry LaTeX's own MathML (tagging with luamml) where the author enables it; nothing is converted by the pipeline." },
  { name: 'glyphSourceLines', whenMissing: 'warn',
    meaning: 'Every glyph carries the source file and line TeX was reading when it was set (glyph field src: { file, line }).' },
  { name: 'glyphSourceMap', whenMissing: 'warn',
    meaning: 'Every glyph carries its exact source position: file, line, column and length (glyph field src: { file, line, column, length }), so a click finds the character it came from.' },
  { name: 'texBreaks', whenMissing: 'warn',
    meaning: "Each paragraph also records TeX's own line breaks at the source width (paragraph field tex_breaks)." },
  { name: 'incremental', whenMissing: 'warn',
    meaning: 'One block of a document is recompiled from a saved state (the preamble run once), not the whole document.' },
  { name: 'inBrowser', whenMissing: 'error',
    meaning: 'The backend runs inside a browser (WebAssembly), with no native tools.' },
  { name: 'shellEscape', whenMissing: 'error',
    meaning: 'The backend can run with shell escape (\\write18) when the caller asks for it, asserting every document is trusted. Shell escape is off unless asked for, for every backend.' },
];

const BY_NAME = new Map(CAPABILITIES.map(c => [c.name, c]));

export const capabilityInfo = (name: CapabilityName): CapabilityInfo => BY_NAME.get(name)!;

/** Whether `caps` claims `name`. Anything but an explicit true is false: an
 *  unknown name, an absent flag, a non-boolean value. */
export function supports(caps: Capabilities | Record<string, unknown> | undefined, name: string): boolean {
  return !!caps && (CAPABILITY_NAMES as readonly string[]).includes(name) && Object.hasOwn(caps, name) && (caps as Record<string, unknown>)[name] === true;
}

/** Every capability with its flag: true where claimed, false otherwise.
 *  Unknown keys in `caps` are dropped. */
export function fullCapabilities(caps: Capabilities | undefined): Record<CapabilityName, boolean> {
  return Object.fromEntries(CAPABILITY_NAMES.map(n => [n, supports(caps, n)])) as Record<CapabilityName, boolean>;
}

/** A capability a document needs, and why. */
export interface Need { capability: CapabilityName; reason: string }

/** What a document needs of a backend, read off its source: what it loads
 *  and asks for. Conservative – a need found is a need; one not found may
 *  still be there (a package loading another). `passes` is how many runs
 *  the caller asked for; `batch` is set for Pipeline.compileBatch. */
export function documentNeeds(content: string, preamble = '', o: { passes?: number; batch?: boolean } = {}): Need[] {
  const tex = `${preamble}\n${content}`.replace(/(?<!\\)%.*$/gm, '');
  const needs: Need[] = [];
  const need = (capability: CapabilityName, reason: string) => {
    if (!needs.some(n => n.capability === capability)) needs.push({ capability, reason });
  };
  const loads = (pkg: string) => new RegExp(`\\\\(?:usepackage|RequirePackage)\\s*(?:\\[[^\\]]*\\])?\\s*\\{[^}]*\\b${pkg}\\b[^}]*\\}`).test(tex);
  const metadata = /\\DocumentMetadata\s*\{([^}]*)\}/.exec(tex);
  if (metadata) {
    need('tagging', 'it sets \\DocumentMetadata');
    if (/tagging\s*=\s*on/.test(metadata[1]) && (/luamml/.test(tex) || loads('unicode-math')))
      need('mathml', 'it enables tagging with luamml (MathML for its formulas)');
  }
  if (loads('fontspec') || loads('unicode-math')) need('opentypeFonts', 'it loads fontspec or unicode-math');
  const mt = /\\(?:usepackage|RequirePackage)\s*(?:\[([^\]]*)\])?\s*\{[^}]*\bmicrotype\b[^}]*\}/.exec(tex);
  if (mt) {
    const opts = mt[1] ?? '';
    if (!/protrusion\s*=\s*(false|no)/.test(opts)) need('protrusion', 'it loads microtype (protrusion)');
    if (!/expansion\s*=\s*(false|no)/.test(opts)) need('fontExpansion', 'it loads microtype (expansion)');
  }
  if (/\\begin\s*\{tikzpicture\}|\\tikz\b|\\includegraphics\b/.test(tex)) need('pictures', 'it draws TikZ pictures or includes graphics');
  if (loads('reflowtex') || loads('reflowtex-lean')) need('companion', 'it loads the companion package');
  if ((o.passes ?? 1) > 1) need('multiPass', `${o.passes} passes were asked for`);
  if (o.batch) need('batchParts', 'it is compiled as a batch of parts');
  return needs;
}

/** The needs `caps` does not meet. */
export function unmetNeeds(needs: Need[], caps: Capabilities): Need[] {
  return needs.filter(n => !supports(caps, n.capability));
}
