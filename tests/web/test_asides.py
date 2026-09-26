# SPDX-License-Identifier: AGPL-3.0-or-later
"""Asides (\\webaside, \\marginpar): the API, and side notes."""
import web


def test_query_width_render_anchor(open_page):
    page = open_page('asides')
    r = page.evaluate("""() => {
      const all = reflowtex.asides(), plain = reflowtex.asides({ kind: 'plain', for: 'y' });
      const el = document.createElement('div'); document.body.append(el);
      const drawn = plain[0].render(el);
      const a = plain[0].anchor();
      return { kinds: all.map(a => a.kind).sort(), plain: plain.length, width: plain[0].width(),
               drawn, drawnWidth: el.firstElementChild.getBoundingClientRect().width,
               anchor: a && [a.x, a.y], block: plain[0].block === document.querySelectorAll('.latex-block[data-nodelist-b64]')[1] };
    }""")
    assert r['kinds'] == ['custom', 'marginpar', 'marginpar', 'plain']
    assert r['plain'] == 1 and r['block']
    assert 50 < r['width'] < 600, 'natural width of one line'
    assert abs(r['drawn']['width'] - r['width']) < 0.5 and r['drawn']['baseline'] > 0
    assert r['anchor'] is not None, 'an aside written in text has a mark'


def test_anchor_on_its_line(open_page):
    page = open_page('asides')
    r = page.evaluate("""() => {
      const a = reflowtex.asides({ kind: 'plain' })[0], at = a.anchor();
      const lines = [...a.block.querySelectorAll('svg text tspan')].map(t => {
        const p = t.ownerSVGElement.createSVGPoint(); p.y = parseFloat(t.getAttribute('y'));
        return p.matrixTransform(t.getScreenCTM()).y; });
      return Math.min(...lines.map(y => Math.abs(y - at.y)));
    }""")
    assert r < 0.5, f'the mark is {r:.2f} px from the nearest baseline'


def test_layout_event(open_page):
    page = open_page('asides')
    page.evaluate("window.__n = 0; document.addEventListener('reflowtex:layout', () => window.__n++)")
    page.locator('.latex-block[data-nodelist-b64]').first.evaluate("b => { b.style.width = '300px'; }")
    page.wait_for_timeout(400)
    assert page.evaluate('window.__n') >= 1


def notes(page):
    return page.evaluate("""() => [...document.querySelectorAll('.latex-margin-note:not([hidden])')].map(n => {
      const r = n.getBoundingClientRect(), t = n.querySelector('svg text tspan');
      const p = t.ownerSVGElement.createSVGPoint(); p.y = parseFloat(t.getAttribute('y'));
      return { kind: n.dataset.kind, left: r.left, top: r.top, bottom: r.bottom, base: p.matrixTransform(t.getScreenCTM()).y,
               right: n.closest('.latex-block').getBoundingClientRect().right }; })""")


def test_side_notes_in_the_margin(open_page):
    page = open_page('asides', width=1400)
    ns = notes(page)
    assert sorted(n['kind'] for n in ns) == ['custom', 'marginpar', 'marginpar']
    for n in ns:
        assert n['left'] >= n['right'], 'a note over the text'
    anchors = page.evaluate("reflowtex.asides({ place: 'margin' }).map(a => a.anchor().y)")
    first = min(ns, key=lambda n: n['top'])
    assert abs(first['base'] - min(anchors)) < 0.5, 'the first note is not on its line'
    ordered = sorted(ns, key=lambda n: n['top'])
    for a, b in zip(ordered, ordered[1:]):
        assert b['top'] >= a['bottom'], 'notes overlap'


def test_no_margin_marks_open_the_note(open_page):
    page = open_page('asides', width=1400)
    page.evaluate("""() => { for (const b of document.querySelectorAll('.latex-block')) b.style.setProperty('--latex-margin-width', '0');
      window.dispatchEvent(new Event('resize')); }""")
    page.wait_for_timeout(300)
    assert page.locator('.latex-margin-note:not([hidden])').count() == 0
    marks = page.locator('.latex-margin-mark:not([hidden])')
    assert marks.count() == 3
    marks.first.click()
    assert page.locator('#latex-footnote-pop.latex-footnote-open svg text tspan').count() > 0
