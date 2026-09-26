// SPDX-License-Identifier: AGPL-3.0-or-later
// define / defineInline: a kind drawn by a Preact component, through the
// viewer's one registry (host.define, types.ts KindDef).
import { Component, render, type ComponentType } from 'preact';
import { InstanceContext } from './context.ts';
import { onHost, type BlockHost, type InlineEnv, type InlineMetrics, type Instance, type PieceHost } from './host.ts';
import { Typeset } from './typeset.tsx';

export interface BlockProps {
    instance: Instance;
    /** The author's parameters (instance.attrs). */
    attrs: Readonly<Record<string, string>>;
    /** host.type: 'block' (in the flow) or 'margin' (a margin note). */
    host: BlockHost;
}

export interface BlockOptions {
    /** Which edges of a block are framed – a border or padding, where TeX's
     *  interline glue to the text around gives way to the author's explicit
     *  space. 'auto' (the default): framed where the element has a border or
     *  padding, as its CSS decides, followed as it changes. */
    frame?: 'auto' | boolean | { top?: boolean; bottom?: boolean };
}

// A component that throws draws its instance plainly instead: the body.
class Boundary extends Component<{ kind: string; plain: boolean; children: any }, { failed: boolean }> {
    state = { failed: false };
    componentDidCatch(error: unknown) {
        console.error(`[reflowtex/companion] kind "${this.props.kind}" failed, drawn plainly:`, error);
        this.setState({ failed: true });
    }
    render() { return this.state.failed ? (this.props.plain ? <Typeset /> : null) : this.props.children; }
}

// frame: 'auto' – the element's own border and padding, read whenever its size
// changes (a class added, a media query, the stylesheet arriving).
function autoFrame(host: BlockHost): () => void {
    const read = () => {
        const cs = getComputedStyle(host.el), px = (v: string) => parseFloat(v) || 0;
        host.setFrame({ top: px(cs.paddingTop) + px(cs.borderTopWidth) > 0,
                        bottom: px(cs.paddingBottom) + px(cs.borderBottomWidth) > 0 });
    };
    const ro = new ResizeObserver(read);
    ro.observe(host.el);
    read();
    return () => ro.disconnect();
}

function mount(kind: string, instance: Instance, host: BlockHost | PieceHost, view: any, plain: boolean) {
    render(
        <InstanceContext.Provider value={{ instance, host }}>
            <Boundary kind={kind} plain={plain}>{view}</Boundary>
        </InstanceContext.Provider>, host.el);
    return () => render(null, host.el);
}

function register(kind: string, def: Parameters<import('./host.ts').Host['define']>[1]): () => void {
    let undefine: (() => void) | null = null, cancelled = false;
    onHost(h => { if (!cancelled) undefine = h.define(kind, def); });
    return () => { cancelled = true; undefine?.(); };
}

/** Draw every instance of `kind` – a block in the flow (\begin{webstream}{kind}
 *  and the package's environments), or a note in the margin
 *  (\webaside[place=margin]{kind}) – with `View`, in the element the viewer
 *  gives it (props.host.el). Instances already drawn are drawn again.
 *  Returns what undoes it. */
export function define(kind: string, View: ComponentType<BlockProps>, options: BlockOptions = {}): () => void {
    return register(kind, {
        render(instance, host) {
            if (host.type === 'piece') return;                 // an inline kind: defineInline
            const f = options.frame ?? 'auto';
            const stopFrame = host.type === 'block' && f === 'auto' ? autoFrame(host) : null;
            if (f !== 'auto') host.setFrame(f === true ? { top: true, bottom: true } : f === false ? {} : f);
            const unmount = mount(kind, instance, host,
                                  <View instance={instance} attrs={instance.attrs} host={host} />, true);
            return () => { stopFrame?.(); unmount(); };
        },
    });
}

export interface PieceProps {
    instance: Instance;
    attrs: Readonly<Record<string, string>>;
    /** Which part of the widget this piece shows: 'whole', a split's
     *  'first' or 'second', or segments from..to (host.piece). */
    piece: PieceHost['piece'];
    env: InlineEnv;
    host: PieceHost;
}

/** Draw every inline instance of `kind` (\webwidget{kind:key}) with `View`,
 *  one component per piece – the whole widget, or its part on each line it
 *  is broken across. `size(instance, env)` says how big it is and where it
 *  may break (types.ts InlineMetrics); env.measure measures HTML, or a
 *  function filling an element, at the text's size. State shared by the
 *  pieces belongs to the instance (useInstanceState). Returns what undoes
 *  it. */
export function defineInline(kind: string, { size, View }: {
    size: (instance: Instance, env: InlineEnv) => InlineMetrics;
    View: ComponentType<PieceProps>;
}): () => void {
    return register(kind, {
        measure: size,
        render(instance, host) {
            if (host.type !== 'piece') return;
            return mount(kind, instance, host, <View instance={instance} attrs={instance.attrs}
                                                     piece={host.piece} env={host.env} host={host} />, false);
        },
    });
}
