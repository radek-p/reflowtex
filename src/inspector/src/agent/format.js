// SPDX-License-Identifier: AGPL-3.0-or-later
// Describing TeX's values: points, glue, the width model's fields, badness.

// ── Describing ─────────────────────────────────────────────────────────────────
// A display's geometry is compiled at several widths, and the fields that
// vary carry a rate (`width_rate`, …): the viewer evaluates each as
// v₀ + rate × (w − w₀) at the reader's measure w (w₀ the width TeX compiled
// at), a node copy per display, remembering its source (affineSource).
export const AFFINE_FIELDS = ['width', 'height', 'depth', 'stretch', 'shrink', 'kern', 'shift',
                       'glue_set', 'surround', 'm_a', 'm_b', 'm_c', 'm_d'];
export const affineFields = n => AFFINE_FIELDS.filter(f => n[`${f}_rate`] !== undefined);
export const DIMENSIONLESS = new Set(['glue_set', 'm_a', 'm_b', 'm_c', 'm_d']);
// A line's badness as TeX rates it: 100·r³ of its glue ratio r (capped at
// 10000), 0 on a line set with infinite glue (the last of a paragraph); an
// overfull line, shrunk past its shrink, is flagged. And TeX's fitness class.
export function badnessOf(lrp) {
    if (!lrp || lrp.fillOrder) return { b: 0, fit: 'decent' };
    const r = lrp.ratio || 0;
    if (r < -1) return { b: 10000, fit: 'overfull', overfull: true };
    const b = Math.min(10000, Math.round(100 * Math.abs(r) ** 3));
    return { b, fit: b <= 12 ? 'decent' : r > 0 ? (b >= 100 ? 'very loose' : 'loose') : 'tight' };
}
export const pt = sp => (sp / 65536).toFixed(2).replace(/\.?0+$/, '') + 'pt';
export const ORDER = ['', 'fil', 'fill', 'filll'];
export const GLUE_SUB = { 0: '', 1: 'lineskip', 2: 'baselineskip', 3: 'parskip', 4: 'abovedisplayskip',
    5: 'belowdisplayskip', 6: 'abovedisplayshortskip', 7: 'belowdisplayshortskip', 8: 'leftskip',
    9: 'rightskip', 10: 'topskip', 11: 'splittopskip', 12: 'tabskip', 13: 'spaceskip', 14: 'xspaceskip',
    15: 'parfillskip', 16: 'mathskip', 17: 'thinmuskip', 18: 'medmuskip', 19: 'thickmuskip',
    98: 'conditionalmathskip', 99: 'muglue', 100: 'leaders', 101: 'cleaders', 102: 'xleaders', 103: 'gleaders' };
export const KERN_SUB = { 0: 'font', 1: 'user', 2: 'accent', 3: 'italic correction' };
export const glueSpec = n => pt(n.width || 0)
    + (n.stretch ? ` plus ${n.stretch_order ? (n.stretch / 65536).toFixed(2) + ORDER[n.stretch_order] : pt(n.stretch)}` : '')
    + (n.shrink ? ` minus ${n.shrink_order ? (n.shrink / 65536).toFixed(2) + ORDER[n.shrink_order] : pt(n.shrink)}` : '');
export function childLists(n) {
    if (n.type === 'disc' || n.type === 'wdisc') return n.replace || [];
    if (n.children && n.children.length) return n.children;
    if (n.leader) return [n.leader];
    return [];
}
export const maxOf = (items, f) => (items || []).reduce((m, it) => Math.max(m, it[f]), 0);
export const kb = n => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`);
