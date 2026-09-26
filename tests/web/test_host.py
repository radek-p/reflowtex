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
