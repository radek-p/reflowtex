-- SPDX-License-Identifier: AGPL-3.0-or-later
-- MathML for every formula, from TeX's own math lists.
--
-- Loaded by serializer.lua when the pipeline puts this file next to it. Each
-- math list is handed, as TeX is about to typeset it, to luamml's converter
-- (the LaTeX Project's LuaTeX math → MathML, which tagged PDF uses too) and
-- returned untouched: typesetting does not change. What is recorded:
--
--   * the formula's tree, as luamml built it, in plain tables the serializer
--     writes to output.json (`mathml`, a list: {tree, display?});
--   * which formula is which: the begin-math node of an inline formula gets
--     attribute MATHML_ATTR = its number (attributes survive node.copy, so
--     the serializer's copies carry it); a display is keyed by the template's
--     display count;
--   * each box luamml could not read (a \vcenter holding cases, a matrix, the
--     strut in \big) becomes {name = "mglyph", box = k}, and the box node gets
--     MATHML_BOX_ATTR = k, so the pipeline finds it in the node tree.
--
-- Everything else – reading those boxes (an alignment becomes a table), an
-- alignment's rows read as one display, cleanup for speech, serialisation –
-- is src/pipeline/mathml.ts's.

local ok, convert = pcall(require, 'luamml-convert')
if not ok then
    texio.write_nl('log', 'reflowtex: luamml not found, no MathML: ' .. tostring(convert))
    return nil
end
local legacy = require'luamml-legacy-mappings'

local MATHML_ATTR     = 930
local MATHML_BOX_ATTR = 931
local math_t = node.id'math'
local properties = node.get_properties_table()

local mmode
for k, v in next, tex.getmodevalues() do if v == 'math' then mmode = k end end

-- ── Fonts ────────────────────────────────────────────────────────────────────
-- An OpenType maths font (unicode-math) needs nothing. The classic 8-bit fonts
-- put their glyphs at codes of their own: each family is mapped to Unicode by
-- what its font is, found by name, so a family any package allocates
-- (\mathbb, \mathfrak, \mathbf) is covered. A text family (the operators'
-- cmr: \operatorname, \mathrm) lets luamml join its letters into one word.

local function alphabet(upper, lower, digits, exceptions)
    local m = {}
    for i = 0, 25 do
        m[0x41 + i] = exceptions and exceptions[0x41 + i] or (upper and upper + i or 0x41 + i)
        if lower then m[0x61 + i] = exceptions and exceptions[0x61 + i] or lower + i end
    end
    if digits then for i = 0, 9 do m[0x30 + i] = digits + i end end
    return m
end
-- OT1 (cmr and friends): codes 0–10 are the upright Greek capitals; what maths
-- takes from it otherwise is ASCII.
local function ot1(letters)
    local m = {}
    for c = 0x21, 0x7E do m[c] = c end
    for c, u in next, letters or {} do m[c] = u end
    for i, cp in ipairs{0x393, 0x394, 0x398, 0x39B, 0x39E, 0x3A0, 0x3A3, 0x3A5, 0x3A6, 0x3A8, 0x3A9} do m[i - 1] = cp end
    return m
end
local MAPPINGS = {
    oml = { legacy.oml, false },
    oms = { legacy.oms, false },
    omx = { legacy.omx, false },
    ot1 = { ot1(), true },
    ot1bold = { ot1(alphabet(0x1D400, 0x1D41A, 0x1D7CE)), false },
    msbm = { alphabet(0x1D538, nil, nil, { [0x43] = 0x2102, [0x48] = 0x210D, [0x4E] = 0x2115,
        [0x50] = 0x2119, [0x51] = 0x211A, [0x52] = 0x211D, [0x5A] = 0x2124 }), false },
    eufm = { alphabet(0x1D504, 0x1D51E, nil, { [0x43] = 0x212D, [0x48] = 0x210C, [0x49] = 0x2111,
        [0x52] = 0x211C, [0x5A] = 0x2128 }), false },
}
-- font name (without its size) → mapping; Computer Modern and Latin Modern
local BY_NAME = {
    { '^[cl]mmib?%d', 'oml' }, { '^[cl]mb?sy%d', 'oms' }, { '^[cl]mex%d', 'omx' },
    { '^[cl]mbx%d', 'ot1bold' }, { '^[cl]mr%d', 'ot1' }, { '^rm%-lmr%d', 'ot1' },
    { '^msbm%d', 'msbm' }, { '^eufm%d', 'eufm' },
}

local family_font, text_family = {}, {}
local function map_families()
    for fam = 0, 255 do
        local fid = node.family_font(fam, 0)
        if fid and fid > 0 and family_font[fam] ~= fid then
            family_font[fam] = fid
            local f = font.getfont(fid)
            if f and f.MathConstants and next(f.MathConstants) then
                text_family[fam] = false
            else
                local name, mapping = f and f.name or '', nil
                for _, p in ipairs(BY_NAME) do
                    if name:match(p[1]) then mapping = MAPPINGS[p[2]]; break end
                end
                if mapping then convert.register_family(fam, mapping[1]) end
                text_family[fam] = mapping == nil or mapping[2]
            end
        end
    end
end
local text_families = setmetatable({}, { __index = function(_, fam) return fam and text_family[fam] end })

-- ── Trees ────────────────────────────────────────────────────────────────────
-- luamml's element: [0] = name, [1..n] = children (strings or elements),
-- string keys = attributes (those with a colon are its own bookkeeping).

local box_count = 0
local function plain(t)
    if type(t) ~= 'table' then
        -- a control character can only be a glyph no mapping covered
        return (tostring(t):gsub('[%z\1-\8\11\12\14-\31]', '\u{FFFD}'))
    end
    local out = { name = t[0] }
    local box = t['tex:box']
    if box then
        local p = properties[box] or {}
        properties[box] = p
        if not p.reflowtex_box then
            box_count = box_count + 1
            p.reflowtex_box = box_count
            node.set_attribute(box, MATHML_BOX_ATTR, box_count)
        end
        out.box = p.reflowtex_box
        return out
    end
    for k, v in next, t do
        if type(k) == 'string' and not k:find(':', 1, true) and k ~= 'xmlns' then
            out.attrs = out.attrs or {}
            out.attrs[k] = tostring(v)
        end
    end
    if t[1] ~= nil then
        out.children = {}
        for i = 1, #t do out.children[i] = plain(t[i]) end
    end
    return out
end

-- ── The callback ─────────────────────────────────────────────────────────────

local formulas = {}

luatexbase.add_to_callback('pre_mlist_to_hlist_filter', function(mlist, style)
    if tex.nest.top.mode == mmode then return true end -- an \eqno/\leqno label
    local display = style == 'display'
    local startmath = tex.nest.top.tail
    map_families()
    local ok, tree = pcall(convert.process, mlist, display and 0 or 2, text_families)
    if not ok then
        texio.write_nl('log', 'reflowtex: no MathML for a formula: ' .. tostring(tree))
        return true
    end
    local entry = { tree = plain(tree) }
    if display then
        entry.display = tex.count['reflowtexDisplayCount']
    elseif startmath and startmath.id == math_t and startmath.subtype == 0 then
        -- luamml splices the saved tree into a formula whose \text holds this one
        local p = properties[startmath] or {}
        properties[startmath] = p
        p.saved_mathml_table = tree
        node.set_attribute(startmath, MATHML_ATTR, #formulas + 1)
    else
        return true
    end
    formulas[#formulas + 1] = entry
    return true
end, 'reflowtex_mathml')

return {
    ATTR = MATHML_ATTR,
    BOX_ATTR = MATHML_BOX_ATTR,
    formulas = formulas,
}
