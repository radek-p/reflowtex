# SPDX-License-Identifier: AGPL-3.0-or-later
"""The host API (window.reflowtex.host, src/viewer/src/host/types.ts):
instances, parts and surfaces, used without the companion."""

TREE = """() => {
  const host = reflowtex.host, [b] = host.blocks();
  const show = i => ({ id: i.id, kind: i.kind, placement: i.placement, attrs: { ...i.attrs },
                       classes: [...i.presentation.classes], props: { ...i.presentation.properties },
                       parts: [...i.parts.keys()], parent: i.parent && i.parent.kind,
                       children: i.children.map(show) });
  return { version: host.version, blocks: host.blocks().length, key: b.key, roots: b.roots.map(show) };
}"""


def test_instance_tree(open_page):
    page = open_page('host')
    r = page.evaluate(TREE)
    assert r['version'] == 1 and r['blocks'] == 2
    roots = {i['kind']: i for i in r['roots']}
    acc = roots['accordion']
    assert acc['placement'] == 'block' and acc['attrs']['initial'] == 'collapsed'
    assert [c['kind'] for c in acc['children']] == ['pane', 'pane']
    assert [c['attrs']['name'] for c in acc['children']] == ['collapsed', 'expanded']
    fn = acc['children'][1]['children']
    assert [(c['kind'], c['placement'], c['parent']) for c in fn] == [('footnote', 'detached', 'pane')]
    assert roots['text']['placement'] == 'text' and roots['text']['attrs'] == {'name': 'clock'}
    w = roots['popover']
    assert w['placement'] == 'inline' and w['attrs'] == {'name': 'popover:1', 'key': '1'}
    assert sorted(w['parts']) == ['popover-label', 'popover-note'], "the widget's asides are its parts"
    assert roots['marginpar']['placement'] == 'detached' and roots['marginpar']['attrs'] == {'place': 'margin'}
    c = roots['callout']
    assert c['classes'] == ['fancy', 'big'] and c['props'] == {'--x-accent': 'red'}
    assert c['attrs'] == {'tone': 'warm'} and c['parts'] == ['body']
    ids = [i['id'] for i in r['roots']] + [x['id'] for x in acc['children']]
    assert len(set(ids)) == len(ids) and all(i.startswith(r['key'] + '/') for i in ids)


def test_data_part_and_query(open_page):
    page = open_page('host')
    r = page.evaluate("""() => {
      const h = reflowtex.host, code = h.instances('leancode')[0];
      return { text: code.part('text').data, type: code.part('text').type, parent: code.parent.kind,
               q: h.instances({ kind: 'pane', name: 'expanded' }).length,
               detached: h.instances({ placement: 'detached' }).map(i => i.kind).sort(),
               found: h.find(code.id) === code };
    }""")
    assert r['type'] == 'data' and 'theorem foo : 1 = 1' in r['text']
    assert r['parent'] == 'leanproof' and r['q'] == 1 and r['found']
    assert r['detached'] == ['footnote', 'marginpar']


def test_surface_follows_its_container(open_page):
    page = open_page('host')
    page.evaluate("""() => {
      const part = reflowtex.host.instances('callout')[0].part('body');
      const el = document.createElement('div'); el.style.width = '300px'; document.body.append(el);
      window.__el = el; window.__changes = 0;
      window.__s = part.mount(el);
      window.__s.onChange(() => window.__changes++);
    }""")
    first = page.evaluate('({ ...__s.metrics(), glyphs: __el.querySelectorAll("svg text tspan").length })')
    assert abs(first['width'] - 300) < 0.5 and first['height'] > 0 and first['glyphs'] > 0
    assert first['firstBaseline'] > 0
    page.evaluate("__el.style.width = '180px'")
    page.wait_for_function('__s.metrics().width < 181')
    second = page.evaluate('({ ...__s.metrics(), changes: __changes })')
    assert second['height'] > first['height'], 'narrower, so taller'
    assert second['changes'] >= 1
    page.evaluate('__s.dispose(); __el.style.width = "400px"')
    page.wait_for_timeout(150)
    assert page.evaluate('__el.childElementCount') == 0
    assert page.evaluate('__s.metrics().width') < 181, 'a disposed surface lays out no more'


def test_natural_fixed_and_several_at_once(open_page):
    page = open_page('host')
    r = page.evaluate("""() => {
      const part = reflowtex.host.instances('popover')[0].part('popover-label');
      const a = document.createElement('div'), b = document.createElement('div');
      document.body.append(a, b);
      const s1 = part.mount(a, { width: 'natural' }), s2 = part.mount(b, { width: 250 });
      return { natural: part.naturalWidth(), w1: s1.metrics().width, w2: s2.metrics().width,
               both: a.querySelectorAll('tspan').length > 0 && b.querySelectorAll('tspan').length > 0 };
    }""")
    assert 5 < r['natural'] < 100 and r['w1'] == r['natural'] and r['w2'] == 250 and r['both']


def test_hidden_surface_paints_when_shown(open_page):
    page = open_page('host')
    page.evaluate("""() => {
      const el = document.createElement('div'); el.style.cssText = 'width:300px;display:none';
      document.body.prepend(el); window.__el = el;
      reflowtex.host.instances('callout')[0].part('body').mount(el, { width: 300 });
    }""")
    page.wait_for_timeout(100)
    assert page.evaluate('__el.querySelectorAll("tspan").length') == 0, 'painted while hidden'
    page.evaluate("__el.style.display = 'block'")
    page.wait_for_function('__el.querySelectorAll("tspan").length > 0')


def test_identity_survives_relayout(open_page):
    page = open_page('host')
    page.evaluate("window.__ids = reflowtex.host.instances().map(i => i.id); window.__one = reflowtex.host.instances('callout')[0]")
    page.locator('.latex-block[data-nodelist-b64]').first.evaluate("b => { b.style.width = '320px'; }")
    page.wait_for_timeout(400)
    r = page.evaluate("({ same: JSON.stringify(reflowtex.host.instances().map(i => i.id)) === JSON.stringify(__ids),"
                      "  obj: reflowtex.host.instances('callout')[0] === __one })")
    assert r['same'] and r['obj']


def test_on_block_and_layout(open_page):
    page = open_page('host')
    r = page.evaluate("""() => new Promise(done => {
      const seen = []; reflowtex.host.onBlock(b => seen.push(b.key));
      const b = reflowtex.host.blocks()[0];
      const off = b.on('layout', () => { off(); done({ seen, layout: true }); });
      b.el.style.width = '300px';
    })""")
    assert len(r['seen']) == 2 and r['layout']


def test_anchors(open_page):
    page = open_page('host')
    r = page.evaluate("""() => {
      const h = reflowtex.host, at = k => { const a = h.instances(k)[0].anchor(); return a && [a.x, a.y]; };
      return { margin: at('marginpar'), text: at('text'), block: at('accordion') };
    }""")
    assert r['margin'] is not None
    assert r['text'] is None and r['block'] is None


# ── Block kinds (host.define) ────────────────────────────────────────────────

# The baselines of the first block's lines, from its top, px: every drawn
# glyph's baseline, deduplicated.
BASELINES = """() => {
  const b = reflowtex.host.blocks()[0].el, top = b.getBoundingClientRect().top;
  const ys = [...b.querySelectorAll('svg text tspan')].map(t => {
    const p = t.ownerSVGElement.createSVGPoint(); p.y = parseFloat(t.getAttribute('y'));
    return Math.round((p.matrixTransform(t.getScreenCTM()).y - top) * 100) / 100; });
  return [...new Set(ys)].sort((a, b) => a - b);
}"""

DEFINE_CALLOUT = """() => {
  window.__renders = 0; window.__undos = 0;
  window.__undefine = reflowtex.host.define('callout', {
    render(instance, host) {
      window.__renders++;
      const d = document.createElement('div'); d.className = 'mine';
      host.el.append(d);
      window.__surface = instance.part('body').mount(d);
      window.__host = host;
      return () => { window.__undos++; };
    },
  });
}"""


def settle(page, ms=250):
    page.wait_for_timeout(ms)


def test_define_late_keeps_tex_spacing(open_page):
    page = open_page('host')
    before = page.evaluate(BASELINES)
    page.evaluate(DEFINE_CALLOUT)
    settle(page)
    r = page.evaluate("""() => ({ renders: __renders,
      mine: document.querySelectorAll('.latex-stream[data-kind="callout"] > .mine .latex-part').length,
      classes: document.querySelector('.latex-stream[data-kind="callout"]').className,
      tone: document.querySelector('.latex-stream[data-kind="callout"]').dataset.tone })""")
    assert r['renders'] == 1 and r['mine'] == 1
    assert 'fancy' in r['classes'] and r['tone'] == 'warm', 'the host keeps its parameters'
    after = page.evaluate(BASELINES)
    assert len(after) == len(before)
    worst = max(abs(a - b) for a, b in zip(before, after))
    assert worst < 0.5, f'a line moved by {worst:.2f} px when the page drew the callout'


def test_render_once_across_relayout(open_page):
    page = open_page('host')
    page.evaluate(DEFINE_CALLOUT)
    settle(page)
    page.evaluate("document.querySelector('.latex-stream[data-kind=\"callout\"]').dataset.tag = 'same'")
    block = page.locator('.latex-block[data-nodelist-b64]').first
    for w in ('320px', '500px', '260px'):
        block.evaluate(f"b => {{ b.style.width = '{w}'; }}")
        settle(page, 300)
    r = page.evaluate("""() => ({ renders: __renders, undos: __undos,
      tag: document.querySelector('.latex-stream[data-kind="callout"]').dataset.tag,
      width: __surface.metrics().width })""")
    assert r['renders'] == 1 and r['undos'] == 0 and r['tag'] == 'same'
    assert r['width'] < 262, 'the body follows the narrower column'


def test_content_height_moves_what_follows(open_page):
    page = open_page('host')
    page.evaluate(DEFINE_CALLOUT)
    settle(page)
    full = page.evaluate(BASELINES)
    page.evaluate("document.querySelector('.mine').style.display = 'none'")
    settle(page)
    hidden = page.evaluate(BASELINES)
    assert hidden[-1] < full[-1] - 20, 'the text after the callout moved up'
    page.evaluate("document.querySelector('.mine').style.display = ''")
    settle(page)
    back = page.evaluate(BASELINES)
    assert max(abs(a - b) for a, b in zip(full, back)) < 0.5


def test_undefine_draws_by_default_again(open_page):
    page = open_page('host')
    before = page.evaluate(BASELINES)
    page.evaluate(DEFINE_CALLOUT)
    settle(page)
    page.evaluate('__undefine()')
    settle(page)
    r = page.evaluate("""() => ({ undos: __undos, mine: document.querySelectorAll('.mine').length,
      glyphs: document.querySelectorAll('.latex-stream[data-kind="callout"] tspan').length })""")
    assert r['undos'] == 1 and r['mine'] == 0 and r['glyphs'] > 0
    after = page.evaluate(BASELINES)
    assert max(abs(a - b) for a, b in zip(before, after)) < 0.5


def test_throwing_renderer_falls_back(open_page):
    page = open_page('host')
    page.evaluate("reflowtex.host.define('callout', { render() { throw new Error('boom'); } })")
    settle(page)
    glyphs = page.evaluate("document.querySelectorAll('.latex-stream[data-kind=\"callout\"] tspan').length")
    assert glyphs > 0, 'drawn by default'
    assert any('render failed' in e for e in page.errors)
    page.errors.clear()


def test_edges_decide_the_glue(open_page):
    page = open_page('host')
    page.evaluate(DEFINE_CALLOUT)
    settle(page)
    before = page.evaluate(BASELINES)
    # No line of text at either edge: no interline glue to the text around.
    page.evaluate("__host.setEdges({ top: null, bottom: null })")
    settle(page)
    after = page.evaluate(BASELINES)
    assert after != before, 'the edges changed nothing'
    page.evaluate("__host.setEdges({ top: __surface, bottom: __surface })")
    settle(page)
    assert max(abs(a - b) for a, b in zip(before, page.evaluate(BASELINES))) < 0.5


def test_frame_keeps_glue_without_explicit_space(open_page):
    # A framed edge drops TeX's glue only where the author left explicit
    # space; the callout has none, so framing it moves nothing.
    page = open_page('host')
    page.evaluate(DEFINE_CALLOUT)
    settle(page)
    before = page.evaluate(BASELINES)
    page.evaluate("__host.setFrame({ top: true, bottom: true })")
    settle(page)
    assert max(abs(a - b) for a, b in zip(before, page.evaluate(BASELINES))) < 0.5


def test_defined_before_the_viewer(open_page):
    """Kinds defined before the viewer runs draw their instances; an action
    pressed in a page-drawn pane goes up the instance tree to a handler on
    the accordion around it (instance.onAction), with no companion."""
    page = open_page('host-defined')
    r = page.evaluate("""() => ({ renders: __renders,
      marks: [...document.querySelectorAll('.latex-stream[data-kind="pane"] > .mine')].map(m => m.textContent) })""")
    assert r['renders'] == 2 and r['marks'] == ['collapsed', 'expanded']
    page.evaluate("""() => { window.__got = [];
      const acc = reflowtex.host.instances('accordion')[0];
      acc.onAction('pane', a => { __got.push([a.arg, a.instance && a.instance.kind]); });
      document.addEventListener('reflowtex:action', e => __got.push(['dom', e.detail.handled])); }""")
    page.locator('.latex-stream[data-kind="pane"] rect.latex-link-hit[data-link-action="pane:next"]').first.click(force=True)
    page.wait_for_timeout(100)
    assert page.evaluate('__got') == [['next', 'pane'], ['dom', True]]
    assert page.evaluate('__renders') == 2


def test_action_passed_outward_and_unhandled(open_page):
    page = open_page('host-defined')
    page.evaluate("""() => { window.__got = [];
      const acc = reflowtex.host.instances('accordion')[0], pane = reflowtex.host.instances('pane')[0];
      pane.onAction('pane', a => { __got.push('pane'); return false; });     // passes it on
      acc.onAction('pane', a => { __got.push('accordion'); });
      acc.onAction('other', a => { __got.push('never'); });
      document.addEventListener('reflowtex:action', e => __got.push(e.detail.verb + ':' + e.detail.handled)); }""")
    page.locator('.latex-stream[data-kind="pane"] rect.latex-link-hit[data-link-action="pane:next"]').first.click(force=True)
    page.wait_for_timeout(100)
    assert page.evaluate('__got') == ['pane', 'accordion', 'pane:true']


# ── Boxed theorems: nested frames ────────────────────────────────────────────

FRAMES = """() => [...document.querySelectorAll('.latex-stream[data-kind="theorem"], .latex-stream[data-kind="proof"]')]
  .map(b => { const r = b.getBoundingClientRect();
              let depth = 0; for (let e = b.parentElement; e; e = e.parentElement)
                if (e.matches && e.matches('.latex-stream[data-kind="theorem"], .latex-stream[data-kind="proof"]')) depth++;
              return { depth, left: r.left, right: r.right }; })"""


def test_nested_boxes_end_flush_start_stepped(open_page):
    page = open_page('boxes')
    fs = page.evaluate(FRAMES)
    proof = [f for f in fs if f['depth'] == 0][1]          # the outer proof (after the theorem)
    inner = [f for f in fs if f['depth'] >= 1]
    assert len(inner) == 2, fs                              # the claim, and its proof
    for f in inner:
        assert abs(f['right'] - proof['right']) < 0.5, 'a nested box stops short of the right edge'
        assert f['left'] > proof['left'] + 5, 'a nested box is not set in on the left'


def test_nested_boxes_mirror_right_to_left(open_page):
    page = open_page('boxes')
    page.evaluate("document.documentElement.dir = 'rtl'")
    page.wait_for_timeout(400)
    fs = page.evaluate(FRAMES)
    proof = [f for f in fs if f['depth'] == 0][1]
    for f in [f for f in fs if f['depth'] >= 1]:
        assert abs(f['left'] - proof['left']) < 0.5, 'right to left: the end (left) edges stand flush'
        assert f['right'] < proof['right'] - 5, 'right to left: set in at the start (right)'
