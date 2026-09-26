// \mypopover (latex-preambles/popover.tex): \webwidget{popover:N} is an inline
// instance of kind popover, and its asides with for=N are its parts. It is
// a button with its label in it; pressing it opens the note below.
import { html, useState, defineInline, InlineButton, Popover, Typeset } from 'reflowtex/companion';

defineInline('popover', {
  size: (instance, env) => InlineButton.size(env, instance.part('popover-label').naturalWidth()),
  View: ({ env }) => {
    const [button, setButton] = useState(null);   // the button, while open
    return html`
      <${InlineButton} env=${env} pressed=${!!button}
                       onPress=${e => setButton(button ? null : e.currentTarget)}>
        <${Typeset} part="popover-label" width="natural" />
      </${InlineButton}>
      ${button && html`
        <${Popover} anchor=${button} onClose=${() => setButton(null)}>
          <${Typeset} part="popover-note" />
        </${Popover}>`}`;
  },
});
