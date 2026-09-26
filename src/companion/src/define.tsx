// SPDX-License-Identifier: AGPL-3.0-or-later
// defineBlock: a kind of block instance drawn by a Preact component.
import { Component, render, type ComponentType } from 'preact';
import { InstanceContext } from './context.ts';
import { onHost, type BlockHost, type Instance } from './host.ts';
import { Typeset } from './typeset.tsx';

export interface BlockProps {
    instance: Instance;
    /** The author's parameters (instance.attrs). */
    attrs: Readonly<Record<string, string>>;
    host: BlockHost;
}

export interface BlockOptions {
    /** Which edges of the block are framed – a border or padding, where
     *  TeX's interline glue to the text around gives way to the author's
     *  explicit space. 'auto' (the default): framed where the block's
     *  element has a border or padding, as its CSS decides, followed as it
     *  changes. */
    frame?: 'auto' | boolean | { top?: boolean; bottom?: boolean };
}

// A component that throws draws its instance plainly instead: the body.
class Boundary extends Component<{ kind: string; children: any }, { failed: boolean }> {
    state = { failed: false };
    componentDidCatch(error: unknown) {
        console.error(`[reflowtex/companion] kind "${this.props.kind}" failed, drawn plainly:`, error);
        this.setState({ failed: true });
    }
    render() { return this.state.failed ? <Typeset /> : this.props.children; }
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

/** Draw every block instance of `kind` (\begin{webstream}{kind}, and the
 *  package's environments) with `View`, in the element the viewer places in
 *  the flow. Instances already drawn are drawn again. Returns what undoes
 *  it. */
export function defineBlock(kind: string, View: ComponentType<BlockProps>, options: BlockOptions = {}): () => void {
    let undefine: (() => void) | null = null, cancelled = false;
    onHost(h => {
        if (cancelled) return;
        undefine = h.define(kind, {
            render(instance, host) {
                const f = options.frame ?? 'auto';
                const stopFrame = f === 'auto' ? autoFrame(host) : null;
                if (f !== 'auto') host.setFrame(f === true ? { top: true, bottom: true } : f === false ? {} : f);
                render(
                    <InstanceContext.Provider value={{ instance, host }}>
                        <Boundary kind={kind}><View instance={instance} attrs={instance.attrs} host={host} /></Boundary>
                    </InstanceContext.Provider>, host.el);
                return () => { stopFrame?.(); render(null, host.el); };
            },
        });
    });
    return () => { cancelled = true; undefine?.(); };
}
