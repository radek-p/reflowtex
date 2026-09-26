# SPDX-License-Identifier: AGPL-3.0-or-later
"""Footnotes: the mark opens the note in a popover."""
POP = '#latex-footnote-pop'


def open_(page):
    return page.locator(POP).evaluate("p => p.classList.contains('latex-footnote-open')")


def test_hover_opens_and_leaving_closes(open_page):
    page = open_page('notes')
    mark = page.locator('[data-footnote]').first
    mark.hover()
    page.wait_for_timeout(200)
    assert open_(page)
    assert page.locator(f'{POP} svg text tspan').count() > 0, 'the popover shows no typeset text'
    box = page.locator(POP).bounding_box()
    vw = page.viewport_size['width']
    assert box['x'] >= 0 and box['x'] + box['width'] <= vw, 'the popover leaves the window'
    page.mouse.move(5, 5)
    page.wait_for_timeout(200)
    assert not open_(page)


def test_click_pins_and_escape_closes(open_page):
    page = open_page('notes')
    page.locator('[data-footnote]').first.click()
    page.mouse.move(5, 5)
    page.wait_for_timeout(200)
    assert open_(page), 'a clicked note stays open'
    page.keyboard.press('Escape')
    assert not open_(page)


def test_keyboard(open_page):
    page = open_page('notes')
    mark = page.locator('[data-footnote]').first
    assert mark.get_attribute('role') == 'button' and mark.get_attribute('tabindex') == '0'
    mark.focus()
    page.keyboard.press('Enter')
    assert open_(page)
