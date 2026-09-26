# SPDX-License-Identifier: AGPL-3.0-or-later
"""The Hugo integration, on a small site served under a subpath (/hugo/):
what a Hugo site's readers get."""
import re

PAGES = ['hugo/alpha/', 'hugo/beta/']


def text(page):
    return ''.join(page.locator('.latex-block svg text tspan').all_text_contents())


def test_pages_load_under_a_subpath(open_page):
    """Scripts and fonts are found under the site's subpath (8de3e92):
    conftest fails on any 404."""
    for url in PAGES:
        open_page(url)


def test_references_resolve(open_page):
    """\\ref and \\eqref print numbers, not ?? (b7d65b3)."""
    page = open_page('hugo/alpha/')
    assert '??' not in text(page)
    assert page.evaluate("document.getElementById('eq:one') !== null")


def test_reference_to_another_page(open_page):
    """A label on another page resolves through the link map, to that page."""
    page = open_page('hugo/beta/')
    link = page.locator('rect.latex-link-hit').first
    link.click(force=True)
    page.wait_for_url(re.compile(r'/hugo/alpha/(index\.html)?#eq:one$'))


def test_example_controls(open_page):
    """An example's text size stays when its theme is changed or its text
    clicked: the stored size once shared the buttons' attribute, so every
    click shrank the text (1d3a850)."""
    page = open_page('hugo/alpha/')
    fig = page.locator('figure.latex-example')
    level = lambda: fig.evaluate("f => (f.querySelector('[data-latex-zoom-level]') || f).dataset.latexZoomLevel")
    start = level()
    fig.locator('[data-latex-zoom="out"]').click()
    page.wait_for_timeout(100)
    smaller = level()
    assert smaller != start, 'the smaller-text button did nothing'
    fig.locator('[data-latex-theme-choice="dark"]').click()
    fig.locator('.latex-example-preview').click(position={'x': 20, 'y': 60})
    page.wait_for_timeout(300)
    assert level() == smaller, 'the text size changed on a click elsewhere'
    assert fig.locator('[data-latex-theme="dark"]').count() > 0, 'the theme did not change'


def test_example_handle(open_page):
    """The example's handle narrows the result, which breaks into more lines;
    the page never scrolls sideways (1adde61)."""
    page = open_page('hugo/alpha/')
    fig = page.locator('figure.latex-example')
    blk = fig.locator('.latex-example-preview .latex-block')
    h0 = blk.evaluate('b => b.getBoundingClientRect().height')
    handle = fig.locator('.latex-example-handle')
    handle.focus()
    for _ in range(12):
        page.keyboard.press('ArrowLeft')
    page.wait_for_timeout(400)
    assert blk.evaluate('b => b.getBoundingClientRect().height') > h0
    assert page.evaluate('document.documentElement.scrollWidth - innerWidth') <= 1
