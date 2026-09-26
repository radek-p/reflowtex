# SPDX-License-Identifier: AGPL-3.0-or-later
"""Every page, at a desktop and a phone width: it loads without an error
(conftest fails the test on any), every block is drawn, and nothing makes
the page scroll sideways."""
import pytest
import web


@pytest.mark.parametrize('width', [1200, 360])
@pytest.mark.parametrize('name', web.names())
def test_loads(open_page, name, width):
    page = open_page(name, width=width)
    wide = page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
    assert wide <= 1, f'the page scrolls sideways by {wide} px at {width} px'


def test_reflows_when_narrower(open_page):
    """A block made narrower is broken into more lines, none wider than it."""
    page = open_page('notes')
    block = page.locator('.latex-block[data-nodelist-b64]').first
    wide = block.evaluate(web.LINES_JS)
    block.evaluate("b => { b.style.width = '240px'; }")
    page.wait_for_timeout(400)
    narrow = block.evaluate(web.LINES_JS)
    assert len(narrow) > len(wide)
    over = block.evaluate("""b => { const r = b.getBoundingClientRect().right;
      return Math.max(0, ...[...b.querySelectorAll('svg text tspan')].map(t => t.getBoundingClientRect().right - r)); }""")
    assert over <= 2, f'a glyph reaches {over:.1f} px past the block'
