// \mysidenote (latex-preambles/sidenote.tex): each note in the margin with
// its number beside it, on the note's first baseline. The viewer places the
// notes; this draws them.
import { html, useState, marginNote, Aside } from 'reflowtex/companion';

marginNote('sidenote', ({ aside, width }) => {
  const [baseline, setBaseline] = useState(0);   // of the note, once drawn
  return html`
    <div class="sidenote">
      <svg class="sidenote-number" aria-hidden="true"><text y=${baseline}>${aside.attrs.n}</text></svg>
      <${Aside} aside=${aside} width=${width - 20} onDrawn=${drawn => setBaseline(drawn.baseline)} />
    </div>`;
});
