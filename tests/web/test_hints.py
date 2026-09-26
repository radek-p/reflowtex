# SPDX-License-Identifier: AGPL-3.0-or-later
"""A hint: blurred, with a label over it, until pressed."""
HINT = '.latex-stream[data-kind="hint"]'


def state(page):
    page.wait_for_selector(HINT + '[role="button"]', state='attached')   # the kind has taken it over
    return page.locator(HINT).evaluate("""h => ({
      blur: getComputedStyle(h.firstElementChild).filter,
      label: getComputedStyle(h, '::after').content,
      revealed: h.classList.contains('latex-revealed'), pressed: h.getAttribute('aria-pressed') })""")


def test_hidden_then_revealed(open_page):
    page = open_page('notes')
    s = state(page)
    assert 'blur' in s['blur'] and s['label'] == '"Click to reveal"' and not s['revealed']
    page.locator(HINT).click()
    page.wait_for_timeout(300)                     # the blur eases out
    s = state(page)
    assert s['revealed'] and s['pressed'] == 'true' and 'blur' not in s['blur'] and s['label'] == 'none'
    page.locator(HINT).click()
    assert not state(page)['revealed']


def test_keyboard_and_label(open_page):
    page = open_page('notes')
    hint = page.locator(HINT)
    hint.focus()
    page.keyboard.press('Enter')
    page.wait_for_timeout(300)
    assert state(page)['revealed']
    assert page.evaluate("document.activeElement === document.querySelector('.latex-stream[data-kind=\"hint\"]')"), \
        'the hint lost the keyboard focus'
    page.evaluate("document.documentElement.style.setProperty('--latex-hint-label', '\"Show\"')")
    page.keyboard.press('Enter')
    page.wait_for_timeout(300)
    assert state(page)['label'] == '"Show"'
