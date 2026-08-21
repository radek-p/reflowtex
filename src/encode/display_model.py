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
# The node types whose named field *is* horizontal space, and the field for each.
# Whether such a gap is internal to the formula or outer (centring) space is a
# rendering question, decided in the viewer against the reader's configured
# minimum; the encoder only records which fields are gaps at all.
GAP_FIELD_BY_TYPE = {'glue': 'width', 'kern': 'kern', 'math': 'surround'}


def _display_items(data: dict) -> list[dict]:
    items = [item for item in data.get('content', [])
             if item.get('kind') == 'display']
    for footnote in data.get('footnotes', []):
        items.extend(item for item in footnote.get('content', [])
                     if item.get('kind') == 'display')
    return items


def has_displays(data: dict) -> bool:
    return bool(_display_items(data))


def _node_topology_error(a: dict, b: dict, path: str) -> str | None:
    ignored = set(NODE_GEOMETRY) | RATE_KEYS | set(CHILD_LISTS) | {'leader'}
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
    onto ``recv`` — the narrowest sample, which is the tree that is kept."""
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
    # varies with the measure, but it is not space — it is however wide the
    # box's contents came out — so flooring it would fence off a measure the
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
    compilation — paragraphs, colours, and any width a package baked into the
    page rather than into a display — belongs to the measure the document was
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
