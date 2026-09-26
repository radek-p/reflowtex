// \mypopover (latex-preambles/popover.tex): \webwidget{popover} is an inline
// instance of kind popover, with two parts, label and note (\webpart). It is
// a button with its label in it; pressing it opens the note below.
import { html, useState, defineInline, InlineButton, Popover, Typeset } from 'reflowtex/companion';

defineInline('popover', {
  size: (instance, env) => InlineButton.size(env, instance.part('label').naturalWidth()),
  View: ({ env }) => {
    const [button, setButton] = useState(null);   // the button, while open
    return html`
      <${InlineButton} env=${env} pressed=${!!button}
                       onPress=${e => setButton(button ? null : e.currentTarget)}>
        <${Typeset} part="label" width="natural" />
      </${InlineButton}>
      ${button && html`
        <${Popover} anchor=${button} onClose=${() => setButton(null)}>
          <${Typeset} part="note" />
        </${Popover}>`}`;
  },
});
