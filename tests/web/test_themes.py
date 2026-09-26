# SPDX-License-Identifier: AGPL-3.0-or-later
"""Themes: the typeset text follows the page's colour scheme."""


def fill(page):
    return page.locator('.latex-block svg text tspan').first.evaluate('t => getComputedStyle(t).fill')


def test_dark_changes_the_ink(open_page):
    light = fill(open_page('notes'))
    dark = fill(open_page('notes', theme='dark'))
    assert light != dark
