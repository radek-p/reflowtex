# SPDX-License-Identifier: AGPL-3.0-or-later
"""leanproof and leantheorem drawn by the companion (src/companion/src/kinds/
lean.tsx): switches, parts opening and closing with motion, side by side,
the text around moving, the code, print."""

THM, PRF = '.latex-stream[data-kind="leantheorem"]', '.latex-stream[data-kind="leanproof"]'


def state(page, sel):
    return page.evaluate("""s => { const w = document.querySelector(s), r = w.querySelector('.rtx-lean');
      const parts = Object.fromEntries([...w.querySelectorAll('.rtx-lean-part')].map(p => [p.dataset.part, p.dataset.state]));
      const b = w.querySelector('.rtx-lean-body');
      return { proof: 'proof' in r.dataset, lean: 'lean' in r.dataset, parts,
               pressed: [...w.querySelectorAll('.rtx-lean-switches button')].map(b => b.getAttribute('aria-pressed')),
               animating: 'animating' in b.dataset, height: b.getBoundingClientRect().height }; }""", sel)


def press(page, sel, label):
    page.locator(f'{sel} .rtx-lean-switches button', has_text=label).click()


def last_line_y(page, block):
    return page.evaluate("""n => { const b = document.querySelectorAll('.latex-block[data-nodelist-b64]')[n];
      const ts = [...b.querySelectorAll(':scope > div > div > svg text tspan')], t = ts[ts.length - 1];
      const p = t.ownerSVGElement.createSVGPoint(); p.y = parseFloat(t.getAttribute('y'));
      return p.matrixTransform(t.getScreenCTM()).y; }""", block)


def test_drawn_by_the_companion_with_their_defaults(open_page):
    page = open_page('lean-v2')
    t, p = state(page, THM), state(page, PRF)
    assert t['parts'] == {'tex': 'closed', 'code': 'closed'} and t['pressed'] == ['false', 'false'], 'leantheorem: show=none'
    assert p['parts'] == {'tex': 'open', 'code': 'closed'} and p['pressed'] == ['true', 'false'], 'leanproof: show=proof'
    assert page.locator(f'{THM} .rtx-lean-switches.rtx-lean-hang').count() == 1, 'hanging under the theorem'


def test_opening_animates_and_moves_the_text_after(open_page):
    page = open_page('lean-v2')
    y0, h0 = last_line_y(page, 0), state(page, THM)['height']
    press(page, THM, 'Proof')
    page.wait_for_timeout(110)
    mid = state(page, THM)
    assert mid['animating'] and mid['parts']['tex'] == 'open' and mid['pressed'][0] == 'true'
    page.wait_for_timeout(700)
    end = state(page, THM)
    assert not end['animating'] and h0 <= mid['height'] < end['height']
    assert last_line_y(page, 0) > y0 + 20, 'the text after the widget moved down'


def test_closing_fades_then_collapses(open_page):
    page = open_page('lean-v2')
    press(page, PRF, 'Proof')
    page.wait_for_timeout(60)
    s = state(page, PRF)
    assert s['pressed'][0] == 'false' and s['parts']['tex'] == 'open', 'still drawn while it fades'
    page.wait_for_timeout(800)
    s = state(page, PRF)
    assert s['parts']['tex'] == 'closed' and not s['animating'] and s['height'] < 2


def test_reduced_motion_cuts(open_page):
    page = open_page('lean-v2', reduced_motion='reduce')
    press(page, THM, 'Lean')
    page.wait_for_timeout(30)
    s = state(page, THM)
    assert s['parts']['code'] == 'open' and not s['animating']


def test_side_by_side_when_wide(open_page):
    page = open_page('lean-v2', width=1400)
    press(page, THM, 'Proof')
    press(page, THM, 'Lean')
    page.wait_for_timeout(900)
    r = page.evaluate("""s => { const w = document.querySelector(s);
      const [a, b] = ['tex', 'code'].map(k => w.querySelector(`.rtx-lean-part[data-part="${k}"]`).getBoundingClientRect());
      return { sameTop: Math.abs(a.top - b.top) < 1, sameHeight: Math.abs(a.height - b.height) < 1, beside: b.left > a.right }; }""", THM)
    assert r == {'sameTop': True, 'sameHeight': True, 'beside': True}


def test_stacked_when_narrow(open_page):
    page = open_page('lean-v2', width=600)
    press(page, PRF, 'Lean')
    page.wait_for_timeout(900)
    r = page.evaluate("""s => { const w = document.querySelector(s);
      const [a, b] = ['tex', 'code'].map(k => w.querySelector(`.rtx-lean-part[data-part="${k}"]`).getBoundingClientRect());
      return b.top >= a.bottom; }""", PRF)
    assert r


def test_the_code(open_page):
    page = open_page('lean-v2')
    press(page, THM, 'Lean')
    page.wait_for_timeout(700)
    r = page.evaluate("""s => { const c = document.querySelector(s + ' .rtx-lean-code');
      return { head: c.querySelector('.rtx-lean-head a')?.getAttribute('href'),
               kw: [...c.querySelectorAll('.lean-kw')].map(e => e.textContent).slice(0, 3),
               comment: c.querySelector('.lean-com')?.textContent, text: c.querySelector('code').textContent }; }""", THM)
    assert r['head'] == 'https://example.org/sum_odd'
    assert r['kw'][:1] == ['theorem'] and r['comment'] == '-- the last term'
    assert '    ∑ i ∈ Finset.range n' in r['text'], 'indentation kept'


def test_choice_survives_relayout(open_page):
    page = open_page('lean-v2')
    press(page, THM, 'Lean')
    page.wait_for_timeout(700)
    page.locator('.latex-block[data-nodelist-b64]').first.evaluate("b => { b.style.width = '360px'; }")
    page.wait_for_timeout(400)
    assert state(page, THM)['parts'] == {'tex': 'closed', 'code': 'open'}


def test_print_shows_every_part(open_page):
    page = open_page('lean-v2')
    page.emulate_media(media='print')
    page.evaluate("window.dispatchEvent(new Event('beforeprint'))")
    page.wait_for_timeout(100)
    r = page.evaluate("""() => ({ parts: [...document.querySelectorAll('.rtx-lean-part')].map(p => getComputedStyle(p).display !== 'none'),
      switches: [...document.querySelectorAll('.rtx-lean-switches')].map(s => getComputedStyle(s).display) })""")
    assert all(r['parts']) and set(r['switches']) == {'none'}


def test_space_after_a_hidden_proof_is_taken_back(open_page):
    """TeX's space after the widget is the space after the proof; while the
    proof is hidden the widget gives back the difference (host.spacing(),
    instance.spaceBefore)."""
    page = open_page('lean-v2')
    closed = page.evaluate(f"parseFloat(document.querySelector('{THM}').style.marginBottom) || 0")
    press(page, THM, 'Proof')
    page.wait_for_timeout(800)
    opened = page.evaluate(f"parseFloat(document.querySelector('{THM}').style.marginBottom) || 0")
    assert closed < -2 and opened == 0
