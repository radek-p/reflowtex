// \mypopover (latex-preambles/popover.tex): the widget popover:N is a button
// with its label in it; pressing it opens the note below. The label and the
// note are the block's asides whose for= is N.
import { html, useState, widget, Aside, InlineButton, Popover } from 'reflowtex/companion';

const aside = (ctx, kind) => ctx.asides({ kind, for: ctx.name.slice('popover:'.length) })[0];

widget('popover:*', {
  size: ctx => InlineButton.size(ctx, aside(ctx, 'popover-label').width()),
  render: ({ ctx }) => {
    const [button, setButton] = useState(null);   // the button, while open
    return html`
      <${InlineButton} ctx=${ctx} pressed=${!!button}
                       onPress=${e => setButton(button ? null : e.currentTarget)}>
        <${Aside} aside=${aside(ctx, 'popover-label')} />
      </${InlineButton}>
      ${button && html`
        <${Popover} anchor=${button} onClose=${() => setButton(null)}>
          <${Aside} aside=${aside(ctx, 'popover-note')} width="fill" />
        </${Popover}>`}`;
  },
});
