# SPDX-License-Identifier: AGPL-3.0-or-later
"""Fixtures: a server for the built pages, a browser, and `open_page`.

open_page(name, width=1200, height=900, theme=None, **context) loads a
fixture page and waits until every block is drawn and its fonts have loaded
(then puts `theme` on <html>, if given); `context` goes to the browser
context (color_scheme, …). Every test runs in Chromium and in WebKit
(Safari's engine). Besides errors, the viewer must stay quiet: a log, info or
warning line of its own ("[latex-viewer] …") fails the test too. Anything the page reports as an error – an uncaught
exception, a console.error, a request that failed or answered 4xx/5xx – is
collected, and fails the test at its end (unless the test takes the list
itself: page.errors).
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import web  # noqa: E402

from playwright.sync_api import sync_playwright  # noqa: E402


@pytest.fixture(scope='session')
def server():
    s = web.Server()
    yield s
    s.close()


@pytest.fixture(scope='session')
def playwright_():
    with sync_playwright() as p:
        yield p


@pytest.fixture(scope='session', params=['chromium', 'webkit'])
def browser(request, playwright_):
    b = getattr(playwright_, request.param).launch()
    yield b
    b.close()


@pytest.fixture
def open_page(browser, server):
    opened = []

    def open_(name, width=1200, height=900, theme=None, route=None, **context):
        ctx = browser.new_context(viewport={'width': width, 'height': height}, device_scale_factor=1, **context)
        if route:
            ctx.route(*route)
        page = ctx.new_page()
        page.errors = []
        page.on('pageerror', lambda e: page.errors.append(f'uncaught: {e}'))
        page.on('console', lambda m: (m.type == 'error' or (m.type in ('log', 'info', 'warning')
                                                                  and m.text.startswith('[latex-viewer]')))
                and page.errors.append(f'console.{m.type}: {m.text}'))
        page.on('requestfailed', lambda r: page.errors.append(f'request failed: {r.url}'))
        page.on('response', lambda r: r.status >= 400 and page.errors.append(f'{r.status}: {r.url}'))
        page.goto(name if '://' in name else server.page_url(name))
        page.wait_for_function(web.READY, timeout=20000)
        # The viewer draws every block again once its web fonts have loaded
        # (rerenderBlock): let that happen before a test interacts.
        page.evaluate('document.fonts.ready.then(() => new Promise(r => requestAnimationFrame(() => setTimeout(r, 50))))')
        if theme:
            # As a site's theme switch does: a class on <html> (dark, sepia, contrast).
            page.evaluate(f"document.documentElement.classList.add('{theme}')")
            page.wait_for_timeout(100)
        opened.append(page)
        return page

    yield open_
    errors = [e for p in opened for e in p.errors]
    for p in opened:
        p.context.close()
    assert not errors, 'the page reported errors:\n  ' + '\n  '.join(errors)
