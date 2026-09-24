# SPDX-License-Identifier: AGPL-3.0-or-later
"""Recover a width-parametric display tree from three LuaTeX compilations.

The samples are ordinary serializer output at increasing ``\textwidth`` values.
No amsmath environment or node shape is special-cased: topology must match, and
every geometric scalar in the finished display tree must be affine across the
three widths.  The newest tree is retained and sparse ``*_rate`` derivatives
are attached to the fields which change.
"""

from __future__ import annotations

from typing import Any


NODE_GEOMETRY = (
    'width', 'height', 'depth', 'stretch', 'shrink', 'kern', 'shift',
    'glue_set', 'surround', 'm_a', 'm_b', 'm_c', 'm_d',
)
ITEM_GEOMETRY = ('display_width', 'display_indent', 'display_shift')
CHILD_LISTS = ('children', 'pre', 'post', 'replace')
RATE_KEYS = {f'{name}_rate' for name in NODE_GEOMETRY}
# model annotations, like the rates: not part of a node's identity
FLOOR_KEYS = {f'{name}_floor' for name in NODE_GEOMETRY}
# The node types whose named field *is* horizontal space, and the field for each.
# Whether such a gap is internal to the formula or outer (centring) space is a
# rendering question, decided in the viewer against the reader's configured
# minimum; the encoder only records which fields are gaps at all.
GAP_FIELD_BY_TYPE = {'glue': 'width', 'kern': 'kern', 'math': 'surround'}


def _display_items(data: dict) -> list[dict]:
    items = [item for item in data.get('content', [])
             if item.get('kind') == 'display']
    for stream in data.get('streams', []):
        items.extend(item for item in stream.get('content', [])
                     if item.get('kind') == 'display')
    return items


def has_displays(data: dict) -> bool:
    return bool(_display_items(data))


def _node_topology_error(a: dict, b: dict, path: str) -> str | None:
    # How a box's glue was set is geometry, not identity: a formula TeX had to
    # shrink to fit beside its number at one measure is set at its natural
    # width at a wider one, the same tree in both. The affine check on
    # glue_set still rejects a setting that does not vary affinely.
    ignored = set(NODE_GEOMETRY) | RATE_KEYS | FLOOR_KEYS | set(CHILD_LISTS) | {'leader', 'glue_sign', 'glue_order'}
    sa = {k: v for k, v in a.items() if k not in ignored}
    sb = {k: v for k, v in b.items() if k not in ignored}
    if sa != sb:
        return f'{path}: node identity changed ({sa!r} != {sb!r})'
    for key in CHILD_LISTS:
        aa, bb = a.get(key, []), b.get(key, [])
        if len(aa) != len(bb):
            return f'{path}.{key}: node count changed ({len(aa)} != {len(bb)})'
        for i, (na, nb) in enumerate(zip(aa, bb)):
            err = _node_topology_error(na, nb, f'{path}.{key}[{i}]')
            if err:
                return err
    la, lb = a.get('leader'), b.get('leader')
    if bool(la) != bool(lb):
        return f'{path}.leader: presence changed'
    if la:
        return _node_topology_error(la, lb, f'{path}.leader')
    return None


def _affine_error(a: float, b: float, c: float,
                  xa: int, xb: int, xc: int, *, integral: bool) -> float:
    predicted = b + (b - a) * (xc - xb) / (xb - xa)
    return abs(c - predicted)


def _node_affine_error(a: dict, b: dict, c: dict,
                       xa: int, xb: int, xc: int, path: str) -> str | None:
    for field in NODE_GEOMETRY:
        va, vb, vc = a.get(field, 0), b.get(field, 0), c.get(field, 0)
        err = _affine_error(va, vb, vc, xa, xb, xc,
                            integral=field not in {'glue_set', 'm_a', 'm_b', 'm_c', 'm_d'})
        tol = 3.0 if field not in {'glue_set', 'm_a', 'm_b', 'm_c', 'm_d'} \
            else 1e-6 * max(1.0, abs(va), abs(vb), abs(vc))
        if err > tol:
            return f'{path}.{field}: non-affine residual {err:g} (tolerance {tol:g})'
    for key in CHILD_LISTS:
        for i, (na, nb, nc) in enumerate(zip(a.get(key, []), b.get(key, []), c.get(key, []))):
            err = _node_affine_error(na, nb, nc, xa, xb, xc,
                                     f'{path}.{key}[{i}]')
            if err:
                return err
    if a.get('leader'):
        return _node_affine_error(a['leader'], b['leader'], c['leader'],
                                  xa, xb, xc, f'{path}.leader')
    return None


def check_samples(a: dict, b: dict, c: dict) -> tuple[bool, str | None]:
    """Return whether three increasing-width samples have one affine topology."""
    xa, xb, xc = (int(d.get('source_width', 0)) for d in (a, b, c))
    if not (0 < xa < xb < xc):
        return False, f'source widths are not strictly increasing: {xa}, {xb}, {xc}'
    da, db, dc = map(_display_items, (a, b, c))
    if not (len(da) == len(db) == len(dc)):
        return False, f'display count changed: {len(da)}, {len(db)}, {len(dc)}'
    for i, (ia, ib, ic) in enumerate(zip(da, db, dc)):
        err = _node_topology_error(ia['box'], ib['box'], f'display[{i}].box')
        if not err:
            err = _node_topology_error(ib['box'], ic['box'], f'display[{i}].box')
        if err:
            return False, err
        for field in ITEM_GEOMETRY:
            va, vb, vc = ia.get(field, 0), ib.get(field, 0), ic.get(field, 0)
            residual = _affine_error(va, vb, vc, xa, xb, xc, integral=True)
            if residual > 3:
                return False, f'display[{i}].{field}: non-affine residual {residual:g}'
        err = _node_affine_error(ia['box'], ib['box'], ic['box'],
                                 xa, xb, xc, f'display[{i}].box')
        if err:
            return False, err
    return True, None


def _attach_node_rates(recv: dict, previous: dict, newest: dict, dx: int) -> None:
    """Measure each field's slope between the two wider samples, and write it
    onto ``recv`` – the narrowest sample, which is the tree that is kept."""
    for field in NODE_GEOMETRY:
        delta = newest.get(field, 0) - previous.get(field, 0)
        if delta:
            recv[f'{field}_rate'] = delta / dx
    for key in CHILD_LISTS:
        for r, old_child, new_child in zip(recv.get(key, []),
                                           previous.get(key, []),
                                           newest.get(key, [])):
            _attach_node_rates(r, old_child, new_child, dx)
    if previous.get('leader'):
        _attach_node_rates(recv['leader'], previous['leader'], newest['leader'], dx)


def _mark_node_floors(oldest: dict, previous: dict, newest: dict, dx: int) -> None:
    # Only a gap can be floored, and only these node types carry one: a glue's
    # set width, a kern, and the space a math node surrounds itself with are the
    # horizontal space *between* pieces of a display. A box's ``width`` also
    # varies with the measure, but it is not space – it is however wide the
    # box's contents came out – so flooring it would fence off a measure the
    # contents never asked for. Other sampled fields (box height, vertical
    # shift, glue_set, transform coefficients) may legitimately cross zero and
    # define no horizontal validity boundary at all.
    field = GAP_FIELD_BY_TYPE.get(newest.get('type'))
    if field:
        va, vb, vc = oldest.get(field, 0), previous.get(field, 0), newest.get(field, 0)
        rate = (vc - vb) / dx
        if rate > 0 and va >= 0 and vb >= 0 and vc >= 0:
            oldest[f'{field}_floor'] = True
    for key in CHILD_LISTS:
        for na, nb, nc in zip(oldest.get(key, []), previous.get(key, []), newest.get(key, [])):
            _mark_node_floors(na, nb, nc, dx)
    if oldest.get('leader'):
        _mark_node_floors(oldest['leader'], previous['leader'], newest['leader'], dx)


def attach_model(oldest: dict, previous: dict, newest: dict) -> dict:
    """Attach sparse derivatives after ``check_samples`` succeeds, and return the
    **narrowest** sample as the document of record.

    The wider samples exist only to measure slopes with. Everything else in a
    compilation – paragraphs, colours, and any width a package baked into the
    page rather than into a display – belongs to the measure the document was
    actually written for. Keeping a wider sample would silently publish those at
    that width: a listings background, drawn as a rule across ``\linewidth``,
    would stretch as far as the widest probe reached. Slopes are derivatives, so
    they are the same law wherever it is anchored; anchoring it at the narrowest
    sample costs nothing and keeps the rest of the document honest.
    """
    xp, xn = int(previous['source_width']), int(newest['source_width'])
    dx = xn - xp
    for first_item, old_item, new_item in zip(_display_items(oldest),
                                               _display_items(previous),
                                               _display_items(newest)):
        for field in ITEM_GEOMETRY:
            delta = new_item.get(field, 0) - old_item.get(field, 0)
            if delta:
                first_item[f'{field}_rate'] = delta / dx
        _attach_node_rates(first_item['box'], old_item['box'], new_item['box'], dx)
        _mark_node_floors(first_item['box'], old_item['box'], new_item['box'], dx)
        # A natural-width display carries its centring in display_shift. Its
        # zero crossing is the point where the formula itself fills the column.
        shifts = (first_item.get('display_shift', 0), old_item.get('display_shift', 0),
                  new_item.get('display_shift', 0))
        shift_rate = (shifts[2] - shifts[1]) / dx
        if shift_rate > 0 and all(v >= 0 for v in shifts):
            first_item['display_shift_floor'] = True
    oldest['display_model'] = True
    return oldest


def anchor_model(first: dict, previous: dict, newest: dict) -> tuple[dict, int]:
    """``attach_model`` with the document of record fixed to ``first``: the sample
    at the width the document was written for, when *that* sample failed the
    affine check and the stable triple was found further up.

    What breaks the affine law between the document's own width and the wider
    samples is the width itself: a display skip that turns short, a kern that
    jumps, a box that shrinks only at the narrower measure. Anchoring the model
    at the first sample that happened to pass would publish the document as
    compiled at that wider width – different display skips, different
    breaks – and the page would not match the document at its own width, which
    is the one width it is expected to match exactly. So the slopes measured
    between the two wider samples are attached to ``first`` instead, to every
    display whose tree has the same shape there as in ``previous``; a display
    whose shape differs keeps its geometry fixed – it renders as TeX set it and
    does not reflow. Returns the document and the number of displays left fixed.
    """
    xp, xn = int(previous['source_width']), int(newest['source_width'])
    dx = xn - xp
    fixed = 0
    for i, (first_item, old_item, new_item) in enumerate(zip(_display_items(first),
                                                             _display_items(previous),
                                                             _display_items(newest))):
        if _node_topology_error(first_item['box'], old_item['box'], f'display[{i}].box'):
            fixed += 1
            continue
        for field in ITEM_GEOMETRY:
            delta = new_item.get(field, 0) - old_item.get(field, 0)
            if delta:
                first_item[f'{field}_rate'] = delta / dx
        _attach_node_rates(first_item['box'], old_item['box'], new_item['box'], dx)
        _mark_node_floors(first_item['box'], old_item['box'], new_item['box'], dx)
        shifts = (first_item.get('display_shift', 0), old_item.get('display_shift', 0),
                  new_item.get('display_shift', 0))
        shift_rate = (shifts[2] - shifts[1]) / dx
        if shift_rate > 0 and all(v >= 0 for v in shifts):
            first_item['display_shift_floor'] = True
    first['display_model'] = True
    return first, fixed


# ── Two forms: a display whose narrow sample was set another way ─────────────
#
# anchor_model keeps the document's own width exact by putting the stable
# triple's rates on the first sample. For a display the first sample does not
# agree with – amsmath moved its tag, or had no room to centre the body –
# that anchors the wider regime at the wrong value, and every width above the
# document's is off by the size of the bend. Such a display gets two forms:
# its tree at the document's width (as now), and the stable triple's own tree
# with its own rates (``display_wide``, anchored at ``display_wide_width``),
# used from ``display_wide_from`` on – the width where TeX changes regime,
# found by compiling between the two (``probe``).

WIDE_RESOLUTION_SP = 2 * 65536          # bisect the switch width to within 2 pt


def _display_agrees(item: dict, prev: dict, new: dict, x: int, xb: int, xc: int) -> bool:
    """Whether ``item`` (compiled at width x < xb) lies on the affine law the
    wider pair ``prev`` (xb) and ``new`` (xc) describe."""
    if _node_topology_error(item['box'], prev['box'], 'box'):
        return False
    for field in ITEM_GEOMETRY:
        if _affine_error(item.get(field, 0), prev.get(field, 0), new.get(field, 0),
                         x, xb, xc, integral=True) > 3:
            return False
    return _node_affine_error(item['box'], prev['box'], new['box'], x, xb, xc, 'box') is None


def _clear_rates(n: dict) -> None:
    for k in [k for k in n if k.endswith('_rate') or k.endswith('_floor')]:
        del n[k]
    for key in CHILD_LISTS:
        for c in n.get(key, []):
            _clear_rates(c)
    if n.get('leader'):
        _clear_rates(n['leader'])


def _has_pictures(n: dict) -> bool:
    return n.get('type') == 'picture' or any(
        _has_pictures(c) for key in CHILD_LISTS for c in n.get(key, [])) or \
        bool(n.get('leader') and _has_pictures(n['leader']))


def _font_remap(first: dict, other: dict) -> dict[str, str]:
    """Font ids of ``other``'s compilation → ids in ``first``'s table, matched
    by file, name and size; a font only ``other`` loaded is added."""
    fonts = first.get('fonts')
    if not isinstance(fonts, dict):
        fonts = first['fonts'] = {}
    ofonts = other.get('fonts') if isinstance(other.get('fonts'), dict) else {}
    key = lambda f: (f.get('filename'), f.get('name'), f.get('size_sp'))
    by_key = {key(f): fid for fid, f in fonts.items()}
    remap = {}
    for fid, f in ofonts.items():
        k = key(f)
        if k not in by_key:
            new = str(max([int(i) for i in fonts] + [0]) + 1)
            fonts[new] = dict(f)
            by_key[k] = new
        remap[fid] = by_key[k]
    return remap


def _apply_font_remap(n: dict, remap: dict) -> None:
    if n.get('type') == 'glyph' and str(n.get('font')) in remap:
        n['font'] = int(remap[str(n['font'])])
    for key in CHILD_LISTS:
        for c in n.get(key, []):
            _apply_font_remap(c, remap)
    if n.get('leader'):
        _apply_font_remap(n['leader'], remap)


def wide_variants(first: dict, previous: dict, newest: dict, probe) -> tuple[int, int]:
    """Give each display of ``first`` (already anchored by anchor_model) that
    disagrees with the stable pair ``previous``/``newest`` a wide form, used
    from the width where TeX changes regime. ``probe(width_sp)`` compiles the
    document at that \\textwidth and returns its data (or None). Returns (the
    number of displays given a wide form, the number of compilations made)."""
    import copy
    x0 = int(first['source_width'])
    xb, xc = int(previous['source_width']), int(newest['source_width'])
    dx = xc - xb
    firsts, prevs, news = _display_items(first), _display_items(previous), _display_items(newest)
    if not (len(firsts) == len(prevs) == len(news)):
        return 0, 0
    todo = [i for i, (a, b, c) in enumerate(zip(firsts, prevs, news))
            if not _display_agrees(a, b, c, x0, xb, xc) and not _has_pictures(b['box'])]
    if not todo:
        return 0, 0
    probes: dict[int, dict | None] = {}

    def sample(w: int) -> dict | None:
        if w not in probes:
            probes[w] = probe(w)
        return probes[w]

    # the switch lies in (lo, hi]: at lo the display is set the narrow way,
    # at hi on the wide law; bisected together, sharing compilations
    lo = {i: x0 for i in todo}
    hi = {i: xb for i in todo}
    lo_data: dict[int, dict] = {}
    while True:
        open_ = [i for i in todo if hi[i] - lo[i] > WIDE_RESOLUTION_SP]
        if not open_:
            break
        w = (lo[open_[0]] + hi[open_[0]]) // 2
        d = sample(w)
        items = _display_items(d) if d else []
        for i in open_:
            if not (lo[i] < w < hi[i]):
                continue
            if len(items) == len(firsts) and _display_agrees(items[i], prevs[i], news[i], w, xb, xc):
                hi[i] = w
            else:
                lo[i] = w
                if len(items) == len(firsts):
                    lo_data[i] = items[i]
    remap = _font_remap(first, previous)
    for i in todo:
        item, prev_item, new_item = firsts[i], prevs[i], news[i]
        wide = copy.deepcopy(prev_item)
        _clear_rates(wide['box'])
        for field in ITEM_GEOMETRY:
            delta = new_item.get(field, 0) - prev_item.get(field, 0)
            if delta:
                wide[f'{field}_rate'] = delta / dx
        _attach_node_rates(wide['box'], prev_item['box'], new_item['box'], dx)
        _mark_node_floors(wide['box'], prev_item['box'], new_item['box'], dx)
        _apply_font_remap(wide['box'], remap)
        for k in ('display_wide', 'display_wide_from', 'display_wide_width'):
            wide.pop(k, None)
        item['display_wide'] = wide
        item['display_wide_width'] = xb
        item['display_wide_from'] = hi[i]
        # The narrow form's own law, where a compilation in its regime exists:
        # measured on the narrow side, not borrowed from the wide one.
        near = lo_data.get(i)
        if near is not None and not _node_topology_error(item['box'], near['box'], 'box'):
            dn = lo[i] - x0
            _clear_rates(item['box'])
            for field in ITEM_GEOMETRY:
                item.pop(f'{field}_rate', None)
                delta = near.get(field, 0) - item.get(field, 0)
                if delta:
                    item[f'{field}_rate'] = delta / dn
            _attach_node_rates(item['box'], item['box'], near['box'], dn)
    return len(todo), len(probes)
