// SPDX-License-Identifier: AGPL-3.0-or-later
// Lean beside a proof (reflowtex.sty's leanproof and leantheorem).
//
//   leanproof    parts tex (the TeX proof) and code (the Lean source,
//                carried as text): Proof and Lean switches on top.
//   leantheorem  parts statement (the theorem), tex and code: the switches
//                hang under the theorem's frame, in its colours.
// decl= and url= (the widget's parameters) name the declaration and link it.
//
// The switches are independent: neither part, either, or both – side by
// side from 44rem of width, else stacked. show=proof | lean | both | none
// is how it starts (leanproof: proof; leantheorem: none); the reader's
// choice then outlives redraws. Opening a part fades it in (sliding a little)
// while the widget's height eases to fit; closing fades it out, then the
// height eases shut. Tuned like every companion motion: --rtx-lean-motion
// (slide · fade · none), --rtx-lean-duration, --rtx-lean-easing, motion=;
// reduced motion cuts. Print shows every part and no switches.
//
// State for CSS: .rtx-lean[data-proof][data-lean] (the parts showing),
// .rtx-lean-part[data-part=tex|code][data-state=open|closed].
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { useInstanceState } from '../context.ts';
import type { BlockProps } from '../define.tsx';
import type { Surface } from '../host.ts';
import { animateHeight, fadeIn, fadeOut, readMotion } from '../motion.ts';
import { Typeset } from '../typeset.tsx';

// ── A small Lean 4 highlighter ────────────────────────────────────────────
// Comments, strings, numbers and keywords, as spans a page colours
// (.lean-com, .lean-str, .lean-num, .lean-kw; --code-* properties).
const KEYWORDS = new Set(('theorem lemma def example instance structure class inductive where by fun '
    + 'have show from at with match calc exact exacts intro intros induction cases rcases obtain simp simp_all '
    + 'rw rwa rfl apply refine use constructor omega norm_num linarith nlinarith ring ring_nf field_simp decide '
    + 'aesop sorry let in if then else do return namespace open section end variable noncomputable private '
    + 'protected abbrev deriving universe mutual termination_by decreasing_by nat_cases positivity gcongr '
    + 'unfold subst specialize contradiction exfalso trivial assumption tauto push_neg by_contra by_cases').split(' '));

export function highlightLean(code: string): string {
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const re = /(\/-[\s\S]*?-\/)|(--[^\n]*)|("(?:[^"\\]|\\.)*")|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_'.!?]*)/g;
    let out = '', last = 0, m: RegExpExecArray | null;
    while ((m = re.exec(code))) {
        out += esc(code.slice(last, m.index));
        const t = m[0];
        if (m[1] || m[2]) out += `<span class="lean-com">${esc(t)}</span>`;
        else if (m[3]) out += `<span class="lean-str">${esc(t)}</span>`;
        else if (m[4]) out += `<span class="lean-num">${esc(t)}</span>`;
        else if (KEYWORDS.has(t)) out += `<span class="lean-kw">${esc(t)}</span>`;
        else out += esc(t);
        last = re.lastIndex;
    }
    return out + esc(code.slice(last));
}

/** Lean source as highlighted, selectable code, under a header naming the
 *  declaration (linked, given a url). */
export function LeanCode({ code, decl, url }: { code: string; decl?: string; url?: string }) {
    return (
        <div class="rtx-lean-code">
            {decl && <div class="rtx-lean-head">
                {url ? <a href={url} target="_blank" rel="noopener">{decl}</a> : <span>{decl}</span>}
            </div>}
            <pre><code dangerouslySetInnerHTML={{ __html: highlightLean(code) }} /></pre>
        </div>
    );
}

type Show = { proof: boolean; lean: boolean };
const parseShow = (s: string): Show => {
    const v = s.toLowerCase();
    return { proof: v === 'proof' || v === 'both', lean: v === 'lean' || v === 'both' };
};

function LeanWidget({ instance, attrs, host, statement }: BlockProps & { statement: boolean }) {
    const stmt = statement ? instance.part('statement') : undefined, tex = instance.part('tex');
    const codePart = instance.part('code'), code = codePart && codePart.type === 'data' ? codePart.data : null;
    // What the switches say (the reader's choice), and what is drawn: a part
    // being closed stays drawn while it fades.
    const show = useInstanceState<Show>('show', () => parseShow(attrs.show || (statement ? 'none' : 'proof')));
    const [drawn, setDrawn] = useState<Show>(show.value);
    const body = useRef<HTMLDivElement>(null), row = useRef<HTMLDivElement>(null);
    const parts = { proof: useRef<HTMLDivElement>(null), lean: useRef<HTMLDivElement>(null) };
    const surfaces = useRef<{ stmt?: Surface; tex?: Surface }>({});
    const opened = useRef<keyof Show | null>(null);
    const from = useRef<number | null>(null);
    const motion = () => readMotion(host.el, 'lean', 'slide', attrs.motion);

    const toggle = async (k: keyof Show) => {
        const next = { ...show.value, [k]: !show.value[k] };
        show.value = next;
        const el = body.current!;
        if (next[k]) {                              // opening: in, and the height eases open
            from.current = el.offsetHeight;
            opened.current = k;
            setDrawn(d => ({ ...d, [k]: true }));
        } else {                                    // closing: out first, then the height eases shut
            const part = parts[k].current;
            if (part) await fadeOut(part, motion());
            if (show.value[k]) return;              // reopened meanwhile
            from.current = el.offsetHeight;
            opened.current = null;
            setDrawn(d => ({ ...d, [k]: false }));
        }
    };

    useLayoutEffect(() => {
        const f = from.current, el = body.current;
        from.current = null;
        if (f === null || !el) return;
        const m = motion();
        const k = opened.current;
        opened.current = null;
        if (k && parts[k].current) fadeIn(parts[k].current!, m);
        animateHeight(el, f, m);
    }, [drawn.proof, drawn.lean]);

    // The widget's edges in the text, for TeX's spacing: the statement's
    // lines at the top (leantheorem), else the proof's while it shows; at the
    // bottom the proof's, when it is the last thing drawn.
    useLayoutEffect(() => {
        const s = surfaces.current;
        host.setEdges({
            top: stmt ? s.stmt ?? null : drawn.proof ? s.tex ?? null : null,
            bottom: drawn.proof && !drawn.lean ? s.tex ?? null : null,
        });
    }, [drawn.proof, drawn.lean]);

    // The space TeX put between the statement and the proof.
    const texSpace = tex && tex.type === 'typeset' ? tex.spaceBefore : undefined;
    // TeX's space after the widget is the space after the proof. While the
    // proof is hidden, what follows should stand where the space after the
    // statement (leantheorem) or before the widget (leanproof) puts it: the
    // widget's bottom margin takes back the difference. Again after every
    // layout, which may change the space around it.
    useLayoutEffect(() => {
        const adjust = () => {
            host.el.style.marginBottom = '';
            if (drawn.proof || host.type !== 'block') return;
            const { before, after } = host.spacing();
            const want = stmt ? (texSpace ?? after) : before;
            if (want < after) host.el.style.marginBottom = `${want - after}px`;
        };
        adjust();
        return instance.block.on('layout', adjust);
    }, [drawn.proof]);

    // Hanging under a boxed theorem, the switches take its colours (a box's
    // own accent= and background= are set on it, not inherited).
    useLayoutEffect(() => {
        const thm = row.current?.parentElement?.querySelector<HTMLElement>('.latex-stream[data-kind="theorem"]');
        if (!thm || !row.current) return;
        row.current.classList.add('rtx-lean-hang');
        for (const v of ['--latex-box-accent', '--latex-box-background']) {
            const val = thm.style.getPropertyValue(v);
            if (val) row.current.style.setProperty(v, val);
        }
    }, []);

    const switches = (
        <div ref={row} class="rtx-lean-switches" role="group" aria-label="Show the proof, its Lean code, or both">
            {(['proof', 'lean'] as const).map(k => (
                <button type="button" aria-pressed={show.value[k]} onClick={() => toggle(k)}>
                    {k === 'proof' ? 'Proof' : 'Lean'}
                </button>))}
        </div>);

    return (
        <div class="rtx-lean" data-proof={drawn.proof ? '' : undefined} data-lean={drawn.lean ? '' : undefined}>
            {stmt ? <div class="rtx-lean-statement">
                <Typeset part={stmt} onMetrics={(_, s) => { surfaces.current.stmt = s; }} />
                {switches}
            </div> : switches}
            <div ref={body} class="rtx-lean-body">
                <div class="rtx-lean-pair" data-both={drawn.proof && drawn.lean ? '' : undefined}>
                    {tex && <div ref={parts.proof} class="rtx-lean-part" data-part="tex" data-state={drawn.proof ? 'open' : 'closed'}>
                        <Typeset part={tex} onMetrics={(_, s) => { surfaces.current.tex = s; }} />
                    </div>}
                    {code !== null && <div ref={parts.lean} class="rtx-lean-part" data-part="code" data-state={drawn.lean ? 'open' : 'closed'}>
                        <LeanCode code={code} decl={attrs.decl} url={attrs.url} />
                    </div>}
                </div>
            </div>
        </div>
    );
}

export const LeanProof = (p: BlockProps) => <LeanWidget {...p} statement={false} />;
export const LeanTheorem = (p: BlockProps) => <LeanWidget {...p} statement={true} />;
