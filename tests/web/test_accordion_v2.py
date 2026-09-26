# SPDX-License-Identifier: AGPL-3.0-or-later
"""The accordion drawn by the companion (v2, src/companion/src/kinds/
accordion.tsx): animated switching,
reduced motion, the keyboard, styling from LaTeX, print, nesting."""

ACC = '.latex-stream[data-kind="accordion"]'


def blocks(page):
    return page.locator('.latex-block[data-nodelist-b64]')


def state(page, n=0):
    return page.evaluate("""n => { const a = document.querySelectorAll('.rtx-accordion')[n];
      return { pane: a.dataset.pane, states: [...a.children].map(p => p.dataset.state),
               animating: 'animating' in a.dataset, height: a.getBoundingClientRect().height }; }""", n)


def press(page, action, n=0):
    """Click the n-th visible control sending `action` (prefix)."""
    page.locator(f'.rtx-pane[data-state="open"] rect.latex-link-hit[data-link-action^="{action}"]').nth(n).click(force=True)


def baselines(page, block=0):
    return page.evaluate("""n => {
      const b = document.querySelectorAll('.latex-block[data-nodelist-b64]')[n], top = b.getBoundingClientRect().top;
      // Drawn lines only: not a pane hidden the viewer's way (display: none)
      // or the companion's (closed).
      const ys = [...b.querySelectorAll('svg text tspan')]
        .filter(t => t.getClientRects().length && !t.closest('.rtx-pane:not([data-state="open"])'))
        .map(t => { const p = t.ownerSVGElement.createSVGPoint(); p.y = parseFloat(t.getAttribute('y'));
                    return Math.round((p.matrixTransform(t.getScreenCTM()).y - top) * 100) / 100; });
      return [...new Set(ys)].sort((a, b) => a - b);
    }""", block)


def test_drawn_by_the_companion(open_page):
    page = open_page('accordion-v2')
    s = state(page)
    assert s['pane'] == 'collapsed' and s['states'] == ['open', 'closed']
    assert page.locator(f'{ACC} > .rtx-accordion').count() == 4, 'every accordion (one nested) is the companion\'s'
    assert page.locator('.latex-stream[data-kind="pane"]').count() == 0, 'no pane drawn the old way'


def test_switch_animates_then_settles(open_page):
    page = open_page('accordion-v2')
    start = state(page)['height']
    press(page, 'pane:next')
    page.wait_for_timeout(90)
    mid = state(page)
    assert mid['animating'] and mid['states'] == ['leaving', 'open']
    page.wait_for_timeout(600)
    end = state(page)
    assert not end['animating'] and end['states'] == ['closed', 'open'] and end['pane'] == 'expanded'
    assert start < mid['height'] < end['height'], 'the height eases from one pane to the other'
    press(page, 'pane:prev')
    page.wait_for_timeout(600)
    assert state(page)['pane'] == 'collapsed'


def test_reduced_motion_cuts(open_page):
    page = open_page('accordion-v2', reduced_motion='reduce')
    press(page, 'pane:next')
    page.wait_for_timeout(30)
    s = state(page)
    assert not s['animating'] and s['states'] == ['closed', 'open']


def test_motion_none_from_css(open_page):
    page = open_page('accordion-v2')
    page.add_style_tag(content='.rtx-accordion { --rtx-accordion-motion: none; }')
    press(page, 'pane:next')
    page.wait_for_timeout(30)
    assert not state(page)['animating']


def test_what_follows_moves_with_it(open_page):
    page = open_page('accordion-v2')
    after = lambda: page.evaluate("""() => { const b = document.querySelector('.latex-block[data-nodelist-b64]');
      const ts = [...b.querySelectorAll(':scope > div > div > svg text tspan')];
      const t = ts[ts.length - 1], p = t.ownerSVGElement.createSVGPoint(); p.y = parseFloat(t.getAttribute('y'));
      return p.matrixTransform(t.getScreenCTM()).y; }""")
    y0 = after()
    press(page, 'pane:next')
    page.wait_for_timeout(700)
    y1 = after()
    assert y1 > y0 + 10, 'the text after the accordion moved down as the taller pane opened'


def test_keyboard_moves_focus_to_the_new_pane(open_page):
    page = open_page('accordion-v2')
    ctl = page.locator('.rtx-pane[data-state="open"] .latex-action[tabindex]').first
    ctl.focus()
    page.keyboard.press('Enter')
    page.wait_for_timeout(600)
    r = page.evaluate("""() => { const a = document.activeElement;
      return { inOpen: !!a.closest('.rtx-pane[data-state="open"]'), action: a.dataset.linkAction || '' }; }""")
    assert r['inOpen'] and r['action'].startswith('pane:'), r


def test_styled_from_latex(open_page):
    page = open_page('accordion-v2')
    r = page.evaluate("""() => { const h = document.querySelectorAll('.latex-stream[data-kind="accordion"]')[1];
      const cs = getComputedStyle(h);
      return { variant: h.dataset.variant, motion: h.dataset.motion, cls: h.classList.contains('faq'),
               accent: cs.getPropertyValue('--rtx-accent').trim(), pad: parseFloat(cs.paddingTop),
               border: parseFloat(cs.borderTopWidth), pane: h.querySelector('.rtx-accordion').dataset.pane }; }""")
    assert r['variant'] == 'card' and r['motion'] == 'fade' and r['cls']
    assert r['accent'] == '#c2410c' and r['pad'] > 0 and r['border'] > 0
    assert r['pane'] == 'two', 'initial= by name'


def test_actions_by_name_and_number(open_page):
    page = open_page('accordion-v2')
    acc = page.locator('.rtx-accordion').nth(1)
    acc.locator('.rtx-pane[data-state="open"] rect.latex-link-hit[data-link-action="pane:next"]').click(force=True)
    page.wait_for_timeout(600)
    assert state(page, 1)['pane'] == 'three'
    acc.locator('.rtx-pane[data-state="open"] rect.latex-link-hit[data-link-action="pane:first"]').first.click(force=True)
    page.wait_for_timeout(600)
    assert state(page, 1)['pane'] == 'one'


def test_nested_accordions_act_alone(open_page):
    page = open_page('accordion-v2')
    outer = page.locator('.rtx-accordion').nth(2)
    inner = outer.locator('.rtx-accordion')
    inner.locator('.rtx-pane[data-state="open"] rect.latex-link-hit[data-link-action="pane:next"]').click(force=True)
    page.wait_for_timeout(600)
    r = page.evaluate("""() => { const o = document.querySelectorAll('.rtx-accordion')[2];
      return { outer: o.dataset.pane, inner: o.querySelector('.rtx-accordion').dataset.pane }; }""")
    assert r == {'outer': 'outer-a', 'inner': 'inner-b'}


def test_state_survives_relayout(open_page):
    page = open_page('accordion-v2')
    press(page, 'pane:next')
    page.wait_for_timeout(600)
    blocks(page).first.evaluate("b => { b.style.width = '320px'; }")
    page.wait_for_timeout(400)
    assert state(page)['pane'] == 'expanded'


def test_print_shows_the_print_pane(open_page):
    page = open_page('accordion-v2')
    page.emulate_media(media='print')
    page.evaluate("window.dispatchEvent(new Event('beforeprint'))")
    page.wait_for_timeout(100)
    r = page.evaluate("""() => [...document.querySelectorAll('.rtx-accordion')[1].children].map(p => ({
      shown: getComputedStyle(p).display !== 'none', glyphs: p.querySelectorAll('tspan').length }))""")
    assert [x['shown'] for x in r] == [False, False, True], 'print= defaults to the last pane'
    assert r[2]['glyphs'] > 0, 'painted for print'


def test_a_throwing_component_draws_the_body(open_page):
    page = open_page('accordion-v2')
    page.evaluate("""async () => {
      const { define } = await import('reflowtex/companion');
      define('accordion', () => { throw new Error('boom'); });
    }""")
    page.wait_for_timeout(400)
    r = page.evaluate("""() => { const h = document.querySelector('.latex-stream[data-kind="accordion"]');
      return { ours: h.querySelectorAll('.rtx-accordion').length, glyphs: h.querySelectorAll('tspan').length }; }""")
    assert r['ours'] == 0 and r['glyphs'] > 0
    assert any('failed, drawn plainly' in e for e in page.errors)
    page.errors.clear()
