# SPDX-License-Identifier: AGPL-3.0-or-later
"""Live text (\\webtext) and widgets (\\webwidget)."""
import web

SLOT = '[data-slot="apples"]'


def words(page):
    return ''.join(page.locator(SLOT).all_text_contents()).replace(' ', '')


def test_set_text_and_back(open_page):
    page = open_page('live')
    assert words(page) == 'noapplesatall'
    page.evaluate("reflowtex.setText('apples', 'a great many apples indeed')")
    page.wait_for_timeout(300)
    assert words(page) == 'agreatmanyapplesindeed'
    page.evaluate("reflowtex.setText('apples', null)")
    page.wait_for_timeout(300)
    assert words(page) == 'noapplesatall'


def test_widget_drawn_and_split(open_page):
    page = open_page('live')
    assert page.locator('foreignObject.latex-widget .badge').count() >= 1, 'not drawn'
    block = page.locator('.latex-block[data-nodelist-b64]').nth(1)
    block.evaluate("b => { b.style.width = '170px'; }")
    page.wait_for_timeout(400)
    assert page.locator('.badge.cut-right').count() >= 1, 'not split in a narrow column'
    assert page.locator('.badge.cut-left').count() >= 1


def test_invalidate_measures_again(open_page):
    page = open_page('live')
    before = page.evaluate("reflowtex.widgets.badge && document.querySelector('.badge').textContent")
    page.evaluate("""() => { const w = reflowtex.widgets.badge;
      const orig = w.measure; w.measure = ctx => { ctx.state.label = 'short'; window.__ctx = ctx; return orig(ctx); };
      reflowtex.refreshWidgets && reflowtex.refreshWidgets(); }""")
    page.wait_for_timeout(300)
    page.evaluate("window.__ctx && window.__ctx.invalidate()")
    page.wait_for_timeout(400)
    after = page.locator('.badge').all_text_contents()
    assert ''.join(after) != before
