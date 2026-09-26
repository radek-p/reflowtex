# SPDX-License-Identifier: AGPL-3.0-or-later
"""Cross-references: a \\eqref goes to its equation."""


def test_eqref_jumps(open_page):
    page = open_page('notes', height=300)
    link = page.locator('[data-link-href="#eq:basel"], [data-link="eq:basel"]').last
    assert link.count() > 0 or page.locator('[data-link]').count() > 0
    target = page.evaluate("document.getElementById('eq:basel') !== null")
    assert target, 'no anchor for the label'
    page.locator('[data-link]').last.click()
    page.wait_for_timeout(300)
    assert page.evaluate('location.hash') == '#eq:basel'
