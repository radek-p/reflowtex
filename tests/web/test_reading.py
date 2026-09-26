# SPDX-License-Identifier: AGPL-3.0-or-later
"""Reading options (the companion's reading.tsx): the corner button and its
panel, a card of them set into the page, and the page following the
reader's choices."""


def html_state(page):
    return page.evaluate("""() => { const h = document.documentElement;
      return { theme: h.getAttribute('data-theme'), classes: [...h.classList], width: h.getAttribute('data-width'),
               zoom: h.style.getPropertyValue('--rtx-zoom'), saved: localStorage.getItem('reflowtex-theme') }; }""")


def test_button_opens_panel_and_escape_closes(open_page):
    page = open_page('reading')
    button = page.locator('.rtx-reading-button')
    assert page.locator('.rtx-reading-panel').count() == 0
    button.click()
    page.wait_for_selector('.rtx-reading-panel')
    assert button.get_attribute('aria-expanded') == 'true'
    assert page.evaluate("document.activeElement.closest('.rtx-reading-panel') !== null"), 'focus not moved in'
    assert page.locator('.rtx-reading-panel [data-w]').count() == 4, 'data-width="true" offers the width'
    page.keyboard.press('Escape')
    page.wait_for_selector('.rtx-reading-panel', state='detached')
    assert page.evaluate("document.activeElement.classList.contains('rtx-reading-button')")


def test_theme_width_and_size_follow_and_are_kept(open_page):
    page = open_page('reading')
    page.locator('.rtx-reading-button').click()
    panel = page.locator('.rtx-reading-panel')
    panel.locator('[data-t="sepia"]').click()
    panel.locator('[data-w="wide"]').click()
    panel.locator('[data-z="in"]').click()
    s = html_state(page)
    assert s['theme'] == 'sepia' and 'sepia' in s['classes'] and s['saved'] == 'sepia'
    assert s['width'] == 'wide' and abs(float(s['zoom']) - 1.1) < 1e-6
    assert panel.locator('[data-t="sepia"]').get_attribute('aria-checked') == 'true'
    assert panel.locator('[data-z="reset"]').inner_text() == '110%'
    # The card set into the page shows the same state.
    card = page.locator('#inline-options')
    assert card.locator('[data-z="reset"]').inner_text() == '110%'
    assert card.locator('[data-t="sepia"]').get_attribute('aria-checked') == 'true'
    assert card.locator('[data-w]').count() == 0, 'no width unless asked'
    card.locator('[data-t="dark"]').click()
    s = html_state(page)
    assert s['theme'] == 'dark' and 'dark' in s['classes'] and 'sepia' not in s['classes']
    page.reload()
    page.wait_for_selector('.rtx-reading-button')
    assert html_state(page)['theme'] == 'dark', 'the choice is remembered'


def test_outside_click_closes(open_page):
    page = open_page('reading')
    page.locator('.rtx-reading-button').click()
    page.wait_for_selector('.rtx-reading-panel')
    page.mouse.click(5, 5)
    page.wait_for_selector('.rtx-reading-panel', state='detached')
