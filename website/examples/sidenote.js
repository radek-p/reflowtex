// \mysidenote (latex-preambles/sidenote.tex): each note in the margin with
// its number beside it, on the note's first baseline. The viewer places the
// notes (kind sidenote, place=margin); this draws them.
import { html, useState, define, Typeset } from 'reflowtex/companion';

define('sidenote', ({ instance }) => {
  const [baseline, setBaseline] = useState(0);   // of the note, once laid out
  return html`
    <div class="sidenote">
      <svg class="sidenote-number" aria-hidden="true"><text y=${baseline}>${instance.attrs.n}</text></svg>
      <${Typeset} onMetrics=${m => setBaseline(m.firstBaseline)} />
    </div>`;
});
