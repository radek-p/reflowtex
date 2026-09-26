# SPDX-License-Identifier: AGPL-3.0-or-later
"""Every glyph the browser draws, against TeX's (see README.md).

    make test-render            # everything but the slow cases
    make test-render-all        # testmath too
    .venv/bin/python3 -m pytest tests/render -k displays   # one case
"""
import pytest
import render

CASES = render.cases()

def marks(case):
    out = [pytest.mark.slow] if case.get('slow') else []
    if case.get('known'):
        # strict: once it passes, the suite fails until the mark is removed
        out.append(pytest.mark.xfail(reason=case['known'], strict=True))
    return out


PARAMS = [pytest.param(name, extra, id=f'{name}@{extra:+d}pt' if extra else f'{name}@own', marks=marks(case))
          for name, case in CASES.items() for extra in case['widths']]


@pytest.fixture(scope='session')
def server():
    s = render.Server()
    yield s
    s.close()


@pytest.mark.parametrize('name,extra', PARAMS)
def test_glyphs(name, extra, server, request):
    case = CASES[name]
    v = render.compare(case, extra, server.url)
    # for the summary at the end of the run (conftest.py)
    request.config.stash.setdefault(render.WORST, []).append((request.node.callspec.id, case, render.worst(v)))
    found = render.problems(v, case['tolerance'], case.get('rule_tolerance'))
    assert not found, (f'{name} at {v["hsize_pt"]} pt:\n  ' + '\n  '.join(found)
                       + f'\n  report: {render.build_dir(case, extra) / "vector" / "vector.json"}')
