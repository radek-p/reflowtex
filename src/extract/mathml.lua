-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Which formula is which, for the MathML LaTeX writes.
--
-- Loaded by serializer.lua when the pipeline puts this file next to it. The
-- MathML itself is LaTeX's: with tagging on and luamml loaded (the template's
-- \DocumentMetadata, \tagpdfsetup{math/mathml/luamml/load=true}), LaTeX
-- converts every formula with luamml – amsmath alignments, cases and matrices
-- as tables, with their intents – and writes each top-level formula to
-- <jobname>-luamml-mathml.html, numbered \mml 1, 2, … in document order (its
-- counter \g__math_math_total_int). Nothing here converts or changes it: this
-- only notes, for each formula, its number there –
--
--   * an inline formula: attribute MATHML_ATTR on its begin-math node (the
--     serializer copies it into output.json as the node's `mathml`);
--   * a display: the template's display count against the number (output.json
--     `mathml`: a list of {n, display}).
--
-- src/pipeline/mathml.ts reads the file and puts each formula's MathML where
-- its number is.

local MATHML_ATTR = 930
local math_t = node.id'math'

local function count(name)
    local ok, v = pcall(function() return tex.count[name] end)
    return ok and v or nil
end

-- Which environment the formula is LaTeX's: "math" for an inline formula,
-- else the display's (equation*, align, …) – an alignment's cells are
-- ordinary inline math inside it.
local function env()
    local ok, v = pcall(token.get_macro, 'g__math_grabbed_env_tl')
    return ok and v or nil
end

-- Whether this math is typeset inside a formula still being built: LaTeX
-- sets an accent's base in a box of its own inside the formula (luamml 0.9
-- converts it too), at the same count and level, before the formula ends.
local math_mode
for k, v in pairs(tex.getmodevalues and tex.getmodevalues() or {}) do
    if v == 'math' then math_mode = k end
end
local function inside_formula()
    for i = 0, tex.nest.ptr - 1 do
        if math.abs(tex.nest[i].mode) == math_mode then return true end
    end
    return false
end

local displays, seen, given = {}, {}, {}
luatexbase.add_to_callback('pre_mlist_to_hlist_filter', function(mlist, style)
    local n, level = count('g__math_math_total_int'), count('@math@level')
    if not n or n < 1 or not level or level < 1 then return true end
    -- a display: its environment's formulas all belong to it (an alignment's
    -- cells are math inside it, a level down)
    if style == 'display' or (env() and env() ~= 'math') then
        if not seen[n] then
            seen[n] = true
            displays[#displays + 1] = { n = n, display = tex.count['reflowtexDisplayCount'] }
        end
    -- an inline formula: only a top-level one has an entry of its own (one in
    -- \text is part of the formula around it)
    -- A number already given is not this math's: math LaTeX does not count
    -- as a formula (the url package sets a URL in math mode, for its breaks)
    -- leaves the counter at the formula before.
    -- An accent's base, boxed inside the formula, is not the formula either.
    elseif level == 1 and not given[n] and not inside_formula() then
        local startmath = tex.nest.top.tail
        if startmath and startmath.id == math_t and startmath.subtype == 0 then
            given[n] = true
            node.set_attribute(startmath, MATHML_ATTR, n)
        end
    end
    return true
end, 'reflowtex_mathml')
-- (after luamml's own, which may register later: a rule may name it first)
pcall(luatexbase.declare_callback_rule, 'pre_mlist_to_hlist_filter', 'luamml.to_mathml', 'before', 'reflowtex_mathml')

return {
    ATTR = MATHML_ATTR,
    formulas = displays,
}
