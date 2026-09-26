# SPDX-License-Identifier: AGPL-3.0-or-later
"""The companion plugin: an InlineButton with a typeset label opening a
Popover (the pattern of \\mypopover)."""
import web


def test_button_fits_its_label_on_the_baseline(open_page):
    page = open_page('companion')
    page.wait_for_selector('.rtx-button svg text tspan', state='attached')
    page.wait_for_timeout(100)
    r = page.evaluate("""() => {
      const b = document.querySelector('.rtx-button'), lab = reflowtex.asides({ kind: 'popover-label' })[0];
      const base = t => { const p = t.ownerSVGElement.createSVGPoint(); p.y = parseFloat(t.getAttribute('y'));
                          return p.matrixTransform(t.getScreenCTM()).y; };
      const own = base(b.querySelector('svg text tspan'));
      const text = [...b.closest('.latex-block').querySelectorAll('svg text tspan')].filter(t => !b.contains(t)).map(base);
      return { width: b.getBoundingClientRect().width, label: lab.width(),
               off: Math.min(...text.map(y => Math.abs(y - own))) };
    }""")
    assert r['label'] < r['width'] < r['label'] + 40
    assert r['off'] < 0.5, f"the label is {r['off']:.2f} px off the line's baseline"


def test_popover_opens_and_closes(open_page):
    page = open_page('companion')
    button = page.locator('.rtx-button')
    button.click()
    page.wait_for_selector('.rtx-popover svg text tspan', state='attached')
    assert button.get_attribute('aria-expanded') == 'true'
    page.keyboard.press('Escape')
    page.wait_for_selector('.rtx-popover', state='detached')     # Preact re-renders on its own time
    button.click()
    page.wait_for_selector('.rtx-popover', state='attached')
    box = page.locator('.rtx-popover').bounding_box()
    assert box and box['width'] > 100 and box['height'] > 20, f'the reopened popover has no size: {box}'
    page.mouse.click(5, 5)
    page.wait_for_selector('.rtx-popover', state='detached')
