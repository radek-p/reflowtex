// SPDX-License-Identifier: AGPL-3.0-or-later
// The normaliser: a decoded document's streams, slots and marks, as the
// instances of the host API (types.ts). This is the only place that knows
// how today's schema spells them – which keys of a stream's attrs are the
// viewer's own, how an aside is recognised, how a widget's asides find it –
// so when the schema grows explicit parts and roles, only this file changes.
//
// Where each instance comes from:
//   a stream item in some content (ContentItem.stream)   → 'block'
//   a stream a glyph refers to (Node.stream: footnote)     → 'detached'
//   a stream marked aside=true (\webaside, \marginpar)     → 'detached'
//   a slot of kind widget (\webwidget{name})               → 'inline'
//   any other slot (\webtext{name}{…})                     → 'text'
// A stream reached none of these ways (an aside set in vertical mode, which
// leaves no mark) is still an instance: detached, at the top level.
//
// Parents follow the text: an instance's parent is the stream whose content
// holds the paragraph, display or item it came from.
//
// Stopgap until \webwidget takes parameters (plan stage 6): a widget named
// "kind:key" is an instance of `kind` with attrs { name, key }, and every
// aside of its block with for=key becomes one of its parts, by the aside's
// kind (\mypopover's popover-label and popover-note).

import type {
    Action, Block, DataPart, Instance, InstanceQuery, Part, Placement, Presentation, TypesetPart,
} from './types.ts';
import { onAction } from './actions.ts';

/** Set by the viewer's slots (slots.js): a text instance's own text. */
export const textHooks = { set: (_id: string, _text: string | null) => {} };

// The decoded document, as far as the normaliser reads it (protobuf.js
// objects: unset fields absent, enums as lowercase names).
export interface DocNode {
    type?: string;
    stream?: number; slot?: number; aside?: number; link?: number;
    children?: DocNode[]; replace?: DocNode[]; pre?: DocNode[]; post?: DocNode[];
}
export interface DocItem { kind?: string; para?: number; box?: DocNode; stream?: number; amount?: number }
export interface DocStream { kind?: string; content?: DocItem[]; attrs?: { key?: string; value?: string }[]; text?: string }
export interface DocSlot { name?: string; kind?: string }
export interface Doc {
    paragraphs: { nodes?: DocNode[] }[];
    content?: DocItem[];
    streams?: DocStream[];
    slots?: DocSlot[];
}

/** What the normaliser needs from the rest of the viewer, per part. */
export interface PartFactory {
    typeset(instance: Instance, role: string, stream: DocStream): TypesetPart;
}
/** And per instance: where it stood. */
export type AnchorOf = (source: AnchorSource) => DOMRect | null;
export type AnchorSource =
    | { type: 'aside'; stream: number }        // Node.aside mark
    | { type: 'glyph'; stream: number }        // Node.stream reference
    | { type: 'widget'; slot: number }
    | { type: 'none' };

export class InstanceImpl implements Instance {
    readonly children: InstanceImpl[] = [];
    readonly parts = new Map<string, Part>();
    spaceBefore = 0;
    /** Internal: the stream (1-based) or slot index it was made from. */
    stream = 0;
    slot = 0;
    constructor(
        readonly id: string,
        readonly kind: string,
        readonly attrs: Readonly<Record<string, string>>,
        readonly presentation: Presentation,
        readonly placement: Placement,
        readonly parent: InstanceImpl | null,
        readonly block: Block,
        private readonly source: AnchorSource,
        private readonly anchorOf: AnchorOf,
    ) {}
    part(role: string) { return this.parts.get(role); }
    onAction(verb: string, fn: (a: Action) => boolean | void) { return onAction(this, verb, fn); }
    setText(text: string | null) {
        if (this.placement !== 'text') throw new TypeError(`setText: ${this.id} is not a \\webtext`);
        textHooks.set(this.id, text === null || text === undefined ? null : String(text));
    }
    anchor() { return this.source.type === 'none' ? null : this.anchorOf(this.source); }
}

/** Split a stream's attrs into the author's parameters and presentation,
 *  dropping the keys that only say what the stream is (aside). */
export function splitAttrs(list: DocStream['attrs']): { attrs: Record<string, string>; presentation: Presentation; aside: boolean } {
    const attrs: Record<string, string> = {};
    const classes: string[] = [];
    const properties: Record<string, string> = {};
    let aside = false;
    for (const a of list || []) {
        const k = a.key || '', v = a.value || '';
        if (!/^[a-z0-9-]+$/i.test(k)) continue;
        if (k === 'aside') aside = v === 'true';
        else if (k === 'class') classes.push(...v.split(/\s+/).filter(Boolean));
        else if (k.startsWith('--')) properties[k] = v;
        else attrs[k] = v;
    }
    return { attrs, presentation: { classes, properties }, aside };
}

const NO_PRESENTATION: Presentation = Object.freeze({ classes: Object.freeze([]) as readonly string[], properties: Object.freeze({}) });

/** Build a block's instance tree. `key` prefixes every id; `spToPx`
 *  converts TeX's scaled points to CSS px. */
export function normalise(doc: Doc, block: Block, key: string, parts: PartFactory, anchorOf: AnchorOf,
                          spToPx = 0): InstanceImpl[] {
    const streams = doc.streams || [];
    const slots = doc.slots || [];
    const roots: InstanceImpl[] = [];
    const seenStream = new Set<number>();     // 1-based stream indices made into instances
    const seenSlot = new Set<number>();
    const widgetsByKey = new Map<string, InstanceImpl>();
    const pendingAsides: { index: number; parent: InstanceImpl | null }[] = [];

    const adopt = (inst: InstanceImpl, parent: InstanceImpl | null) => {
        (parent ? parent.children : roots).push(inst);
    };

    const streamInstance = (index: number, placement: Placement, parent: InstanceImpl | null, source: AnchorSource) => {
        seenStream.add(index);
        const s = streams[index - 1];
        const { attrs, presentation } = splitAttrs(s.attrs);
        const inst = new InstanceImpl(`${key}/s${index}`, s.kind || '', Object.freeze(attrs), presentation,
                                      placement, parent, block, source, anchorOf);
        inst.stream = index;
        inst.parts.set('body', parts.typeset(inst, 'body', s));
        if (s.text !== undefined) {
            const data: DataPart = { type: 'data', role: 'text', instance: inst, data: s.text };
            inst.parts.set('text', data);
        }
        adopt(inst, parent);
        walkContent(s.content || [], inst);
        return inst;
    };

    const slotInstance = (index: number, parent: InstanceImpl | null) => {
        seenSlot.add(index);
        const slot = slots[index - 1] || {};
        const name = slot.name || '';
        if (slot.kind === 'widget') {
            const colon = name.indexOf(':');
            const kind = colon >= 0 ? name.slice(0, colon) : name;
            const attrs: Record<string, string> = { name };
            if (colon >= 0) attrs.key = name.slice(colon + 1);
            const inst = new InstanceImpl(`${key}/w${index}`, kind, Object.freeze(attrs), NO_PRESENTATION,
                                          'inline', parent, block, { type: 'widget', slot: index }, anchorOf);
            inst.slot = index;
            if (attrs.key !== undefined && !widgetsByKey.has(attrs.key)) widgetsByKey.set(attrs.key, inst);
            adopt(inst, parent);
        } else {
            const inst = new InstanceImpl(`${key}/t${index}`, 'text', Object.freeze({ name }), NO_PRESENTATION,
                                          'text', parent, block, { type: 'none' }, anchorOf);
            inst.slot = index;
            adopt(inst, parent);
        }
    };

    // The marks and references in a run of nodes, in order.
    const walkNodes = (nodes: DocNode[] | undefined, parent: InstanceImpl | null) => {
        for (const n of nodes || []) {
            if (n.slot && !seenSlot.has(n.slot)) slotInstance(n.slot, parent);
            if (n.aside && !seenStream.has(n.aside)) {
                pendingAsides.push({ index: n.aside, parent });
                seenStream.add(n.aside);
            }
            if (n.stream && !seenStream.has(n.stream) && streams[n.stream - 1])
                streamInstance(n.stream, 'detached', parent, { type: 'glyph', stream: n.stream });
            walkNodes(n.children, parent);
            walkNodes(n.replace, parent);
            walkNodes(n.pre, parent);
            walkNodes(n.post, parent);
        }
    };
    function walkContent(items: DocItem[], parent: InstanceImpl | null) {
        let space = 0;                       // the vspace items just before
        for (const it of items) {
            if (it.kind === 'vspace') { space += it.amount || 0; continue; }
            const before = space;
            space = 0;
            if (it.kind === 'stream') {
                if (it.stream && !seenStream.has(it.stream) && streams[it.stream - 1])
                    streamInstance(it.stream, 'block', parent, { type: 'none' }).spaceBefore = before * spToPx;
            } else if (it.kind === 'display') {
                walkNodes(it.box ? [it.box] : [], parent);
            } else if (!it.kind || it.kind === 'paragraph') {
                if (it.para) walkNodes(doc.paragraphs[it.para - 1]?.nodes, parent);
            }
        }
    }
    walkContent(doc.content || [], null);

    // Asides: seen by their marks (in order), then any left unmarked.
    streams.forEach((s, i) => {
        if (!seenStream.has(i + 1) && splitAttrs(s.attrs).aside) pendingAsides.push({ index: i + 1, parent: null });
    });
    for (const { index, parent } of pendingAsides) {
        const s = streams[index - 1];
        const { attrs } = splitAttrs(s.attrs);
        const owner = attrs.for !== undefined ? widgetsByKey.get(attrs.for) : undefined;
        if (owner && !owner.parts.has(s.kind || '')) {
            // The stopgap above: this aside is a part of its widget.
            owner.parts.set(s.kind || '', parts.typeset(owner, s.kind || '', s));
            continue;
        }
        seenStream.delete(index);
        streamInstance(index, 'detached', parent, { type: 'aside', stream: index });
    }
    // Anything else not reached (should not happen; kept visible, not lost).
    streams.forEach((_, i) => {
        if (!seenStream.has(i + 1)) streamInstance(i + 1, 'detached', null, { type: 'none' });
    });
    return roots;
}

/** Depth first, document order. */
export function* walk(list: readonly Instance[]): Generator<Instance> {
    for (const i of list) { yield i; yield* walk(i.children); }
}

export function matches(inst: Instance, query?: InstanceQuery): boolean {
    if (query === undefined) return true;
    if (typeof query === 'string') return inst.kind === query;
    for (const [k, v] of Object.entries(query)) {
        if (v === undefined) continue;
        const have = k === 'kind' ? inst.kind : k === 'placement' ? inst.placement : inst.attrs[k];
        if (have !== String(v)) return false;
    }
    return true;
}
