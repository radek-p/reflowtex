-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Pageless PDF: ship the captured galley as a few very tall pages.
--
-- The public serializer's capture_flow copies every node TeX contributes to
-- the main vertical list, with its real dimensions, before the page builder
-- sees it (Serializer.flow_head()). That list *is* the pageless document:
-- one continuous column, exactly the geometry the browser viewer is meant to
-- reproduce. This module ships it, at the end of the run, as consecutive
-- pages of up to `limit` (default 16000pt, just under \maxdimen), cutting
-- only inside top-level glue or kerns so that nothing TeX placed is moved:
-- a cut glue simply ends one page and begins the next, and stacking the
-- pages edge to edge (stack.py) gives the single strip back, with every
-- distance between two boxes exactly what TeX computed. Cuts are placed so
-- that each page's height is a multiple of `align` (default 0.5pt), so a
-- raster at a multiple of 144.54 dpi has page boundaries on pixel rows.
--
-- Recompiling the engine with wider dimensions was considered and rejected:
-- scaled arithmetic is 32-bit throughout TeX (glue setting, badness,
-- packaging, the PDF backend's coordinate output), so nothing short of a
-- fork would survive, while cutting inside glue is exact and needs nothing.
--
-- Captured TikZ pictures are empty placeholder boxes in the galley (the
-- template ships each picture as a private page and leaves a metric-identical
-- empty box). Their positions in the strip are recorded so stack.py can draw
-- the private pages back into place.
--
-- Load this file right after serializer.lua (it wraps
-- Serializer.note_captured_picture to learn the private page numbers), and
-- call Pageless.ship() from the `enddocument/afterlastpage` hook with
-- \pdfvariable horigin set to the margin and vorigin to 0pt:
--
--   \AddToHook{enddocument/afterlastpage}{%
--     \pdfvariable horigin=36pt \pdfvariable vorigin=0pt
--     \directlua{Pageless.ship{margin = tex.sp("36pt")}}}
--
-- Output: the pages, appended to the job's PDF, and pageless.json describing
-- them (page numbers, heights, picture placements), all in sp.

Pageless = Pageless or {}

local TIKZ_PIC_ATTR = 908

-- private page of each captured picture, by document-local id
local picture_pages = {}
local orig_note = Serializer.note_captured_picture
function Serializer.note_captured_picture(id, page)
    picture_pages[tonumber(id)] = tonumber(page)
    return orig_note(id, page)
end

local function ntype(p) return node.type(p.id) end

-- vertical extent a top-level node adds to the galley
local function extent(p)
    local t = ntype(p)
    if t == "hlist" or t == "vlist" or t == "rule" then
        return (p.height or 0) + (p.depth or 0)
    elseif t == "glue" then
        return p.width or 0
    elseif t == "kern" then
        return p.kern or 0
    end
    return 0
end

local function adjustable(p)
    local t = ntype(p)
    return t == "glue" or t == "kern"
end

local function set_extent(p, v)
    if ntype(p) == "glue" then p.width = v else p.kern = v end
end

-- ── picture placement inside a box tree ─────────────────────────────────────
-- x/y are strip coordinates in sp: x from the page's left edge (margin
-- included), y from the strip's top, growing downwards.

local function set_glue(g, box)
    local w = g.width or 0
    local sign, set = box.glue_sign or 0, box.glue_set or 0
    if sign == 1 and (g.stretch_order or 0) == (box.glue_order or 0) then
        w = w + set * (g.stretch or 0)
    elseif sign == 2 and (g.shrink_order or 0) == (box.glue_order or 0) then
        w = w - set * (g.shrink or 0)
    end
    return w
end

local find_in_vlist

local function note_placeholder(out, c, x, y_top)
    local id = node.get_attribute(c, TIKZ_PIC_ATTR)
    out[#out + 1] = {
        id = id, page = picture_pages[id],
        x = math.floor(x + 0.5), y = math.floor(y_top + 0.5),
        width = c.width, height = c.height, depth = c.depth,
    }
end

-- baseline: y of the hlist's baseline; x0: x of its left edge
local function find_in_hlist(out, box, x0, baseline)
    if not box.head then return end
    for c in node.traverse(box.head) do
        local t = ntype(c)
        if t == "hlist" or t == "vlist" then
            local x = x0 + node.dimensions(box.glue_set or 0, box.glue_sign or 0,
                                           box.glue_order or 0, box.head, c)
            local shift = c.shift or 0
            if node.get_attribute(c, TIKZ_PIC_ATTR) then
                note_placeholder(out, c, x, baseline + shift - (c.height or 0))
            elseif t == "hlist" then
                find_in_hlist(out, c, x, baseline + shift)
            else
                find_in_vlist(out, c, x, baseline + shift - (c.height or 0))
            end
        end
    end
end

-- y_top: y of the vlist's top edge; x0: x of its left edge
find_in_vlist = function(out, box, x0, y_top)
    if not box.head then return end
    local y = y_top
    for c in node.traverse(box.head) do
        local t = ntype(c)
        if t == "hlist" or t == "vlist" then
            local x = x0 + (c.shift or 0)
            if node.get_attribute(c, TIKZ_PIC_ATTR) then
                note_placeholder(out, c, x, y)
            elseif t == "hlist" then
                find_in_hlist(out, c, x, y + (c.height or 0))
            else
                find_in_vlist(out, c, x, y)
            end
            y = y + (c.height or 0) + (c.depth or 0)
        elseif t == "rule" then
            y = y + (c.height or 0) + (c.depth or 0)
        elseif t == "glue" then
            y = y + set_glue(c, box)
        elseif t == "kern" then
            y = y + (c.kern or 0)
        end
    end
end

-- ── side effects a second shipout must not repeat ───────────────────────────
-- The galley is a copy of nodes TeX has already shipped once. Shipping a
-- copy re-executes what a shipout executes: delayed \write whatsits (every
-- \label's \newlabel line would land in the .aux a second time, and the
-- copied token lists come out garbled), file open/close, late Lua, PDF
-- destinations and annotations. Drop those, recursively through the boxes;
-- keep what only draws (colour stack, literals, transformation matrices) and
-- what nothing acts on (user-defined). Inserts and marks are page-builder
-- material that a shipped box ignores anyway; drop them too.

local WH = {}
for subtype, name in pairs(node.whatsits()) do WH[name] = subtype end
local DROP_WHATSIT = {}
for _, name in ipairs({ "open", "write", "close", "late_lua", "pdf_refobj",
                        "pdf_annot", "pdf_start_link", "pdf_end_link", "pdf_dest",
                        "pdf_action", "pdf_thread", "pdf_start_thread",
                        "pdf_end_thread", "pdf_link_state", "save_pos" }) do
    if WH[name] then DROP_WHATSIT[WH[name]] = true end
end

local function drops(p)
    local t = ntype(p)
    if t == "whatsit" then return DROP_WHATSIT[p.subtype] end
    return t == "ins" or t == "mark" or t == "adjust"
end

local function strip_side_effects(head)
    local p = head
    while p do
        local nxt = p.next
        if drops(p) then
            head = node.remove(head, p)
            node.free(p)
        else
            local t = ntype(p)
            if (t == "hlist" or t == "vlist") and p.head then
                p.head = strip_side_effects(p.head)
            elseif t == "disc" then
                if p.pre then p.pre = strip_side_effects(p.pre) end
                if p.post then p.post = strip_side_effects(p.post) end
                if p.replace then p.replace = strip_side_effects(p.replace) end
            end
        end
        p = nxt
    end
    return head
end

-- ── what the page builder would have removed ────────────────────────────────
-- The galley is what TeX *contributed*; a paged run's output routine then
-- takes things back out of it. Two of those matter for a strip meant to
-- stand for the document:
--
-- Floats. For every float met in vertical mode LaTeX contributes
-- `\penalty-10004`, an empty `\vbox{}` (so the output routine can find the
-- spot with \lastbox) and `\penalty-10003`; the empty box draws interline
-- glue before it, and the penalty fires the output routine, after which the
-- page builder starts a "page" with \topskip glue. Paged, all of it goes:
-- the float is moved elsewhere, the marker box removed, the page's topskip
-- is at the page top. In the galley it stays — 2 × (9.5 + 10)pt around two
-- empty figures of testmath — so here the empty box, the interline glue
-- before it, and the topskip after it are dropped. The user skips around
-- them stay, as they do in the paged run.
--
-- The ends. \maketitle's `\null\vskip 2em` and \end{document}'s \clearpage
-- leave glue and an empty box before the first line and after the last;
-- paged, the top one becomes the page's \topskip and the bottom is blank
-- page. The viewer starts at its first line's ascent and ends at its last
-- depth, so the strip is trimmed to its first and last non-empty box.
local GLUE_LINESKIP, GLUE_BASELINESKIP, GLUE_TOPSKIP = 1, 2, 10

local function empty_box(p)
    local t = ntype(p)
    return (t == "hlist" or t == "vlist") and p.head == nil
        and p.width == 0 and p.height == 0 and p.depth == 0
end

local function drop_float_leftovers(nodes)
    local drop = {}
    for k, p in ipairs(nodes) do
        if empty_box(p) then
            drop[k] = true
            local q = nodes[k - 1]
            if q and ntype(q) == "glue" and (q.subtype == GLUE_BASELINESKIP or q.subtype == GLUE_LINESKIP) then
                drop[k - 1] = true
            end
            -- the topskip the page builder put after the output routine ran:
            -- within the next few non-box nodes
            for m = k + 1, math.min(#nodes, k + 4) do
                local r = nodes[m]
                local t = ntype(r)
                if t == "hlist" or t == "vlist" then break end
                if t == "glue" and r.subtype == GLUE_TOPSKIP then drop[m] = true; break end
            end
        end
    end
    local out, dropped = {}, 0
    for k, p in ipairs(nodes) do
        if drop[k] then dropped = dropped + 1 else out[#out + 1] = p end
    end
    if dropped > 0 then texio.write_nl(string.format("pageless: dropped %d float/marker node(s)", dropped)) end
    return out
end

local function trim_galley(nodes)
    local first, last = nil, nil
    for k, p in ipairs(nodes) do
        local t = ntype(p)
        if (t == "hlist" or t == "vlist") and not empty_box(p) then
            first = first or k
            last = k
        end
    end
    if not first then return nodes end
    local out = {}
    for k = first, last do out[#out + 1] = nodes[k] end
    if #out < #nodes then
        texio.write_nl(string.format("pageless: trimmed %d node(s) before the first box and %d after the last",
                                     first - 1, #nodes - last))
    end
    return out
end

-- ── shipping ────────────────────────────────────────────────────────────────

local function relink(list)
    for i, p in ipairs(list) do
        p.prev = list[i - 1]
        p.next = list[i + 1]
    end
    return list[1]
end

function Pageless.ship(opts)
    opts = opts or {}
    local limit  = opts.limit  or tex.sp("16000pt")
    local align  = opts.align  or 32768          -- 0.5pt
    local margin = opts.margin or tex.sp("36pt")
    local width  = opts.width  or tex.hsize
    local jsonname = opts.json or "pageless.json"

    local head = Serializer.flow_head()
    if not head then
        texio.write_nl("pageless: no captured galley; nothing shipped")
        return
    end

    -- The galley stays untouched: the serializer walks it later (its output
    -- pass runs at finish_pdffile), and a shipout frees the box it ships. So
    -- each chunk is a deep copy of a run of the galley, with the glue cut at
    -- either end copied twice, once per side, at its two partial widths.
    local nodes = {}
    for p in node.traverse(head) do nodes[#nodes + 1] = p end
    if opts.floats ~= false then nodes = drop_float_leftovers(nodes) end
    if opts.trim ~= false then nodes = trim_galley(nodes) end

    local chunks, pictures = {}, {}
    local y0 = 0
    local i, n = 1, #nodes
    local carry = nil                       -- the far side of the last cut glue
    while i <= n or carry do
        -- extend the chunk while it fits; remember the last cuttable node
        local h, j = carry and extent(carry) or 0, i
        local cut_k, cut_h = nil, nil
        while j <= n do
            local p = nodes[j]
            local e = extent(p)
            if h + e > limit and (j > i or carry) then break end
            if adjustable(p) then cut_k, cut_h = j, h end
            h = h + e
            j = j + 1
        end
        local last, split_a = j - 1, nil
        if j <= n and cut_k then
            -- cut inside nodes[cut_k] so the chunk's height is a multiple of `align`
            local w = extent(nodes[cut_k])
            local target = math.floor((cut_h + w) / align) * align
            local a = target - cut_h
            if a >= 0 and a <= w then split_a = a end
            last = cut_k
        end

        -- copied node by node from the array, not with copy_list along the
        -- galley's links: the array is the galley minus what was dropped
        -- above, and the links still run through the dropped nodes
        local list_head, list_tail = carry, carry
        for k = i, last do
            local c = node.copy(nodes[k])
            c.prev, c.next = list_tail, nil
            if list_tail then list_tail.next = c else list_head = c end
            list_tail = c
        end
        if split_a then
            set_extent(node.tail(list_head), split_a)
            carry = node.copy(nodes[last])
            set_extent(carry, extent(nodes[last]) - split_a)
        else
            carry = nil
        end
        list_head = strip_side_effects(list_head)
        local list = {}
        for p in node.traverse(list_head) do list[#list + 1] = p end
        local box = node.vpack(list_head)
        -- picture placeholders, with the strip position of each
        local y = y0
        for _, c in ipairs(list) do
            local t = ntype(c)
            if t == "hlist" or t == "vlist" then
                local x = margin + (c.shift or 0)
                if node.get_attribute(c, TIKZ_PIC_ATTR) then
                    note_placeholder(pictures, c, x, y)
                elseif t == "hlist" then
                    find_in_hlist(pictures, c, x, y + (c.height or 0))
                else
                    find_in_vlist(pictures, c, x, y)
                end
            end
            y = y + extent(c)
        end

        tex.pagewidth  = width + 2 * margin
        tex.pageheight = box.height + box.depth
        tex.box[255] = box
        tex.shipout(255)
        chunks[#chunks + 1] = {
            page = status.total_pages,
            y0 = y0, height = box.height, depth = box.depth,
            nodes = #list,
        }
        y0 = y0 + box.height + box.depth
        i = last + 1
    end

    -- describe it all for stack.py
    local function q(s) return '"' .. tostring(s):gsub('"', '\\"') .. '"' end
    local parts = { '{"unit":"sp","sp_per_pt":65536,' ..
                    '"page_width":' .. (width + 2 * margin) .. ',"hsize":' .. width ..
                    ',"margin":' .. margin .. ',"total_height":' .. y0 ..
                    ',"chunks":[' }
    for k, c in ipairs(chunks) do
        parts[#parts + 1] = string.format('%s{"page":%d,"y0":%d,"height":%d,"depth":%d,"nodes":%d}',
            k > 1 and "," or "", c.page, c.y0, c.height, c.depth, c.nodes)
    end
    parts[#parts + 1] = '],"pictures":['
    for k, p in ipairs(pictures) do
        parts[#parts + 1] = string.format('%s{"id":%d,"page":%s,"x":%d,"y":%d,"width":%d,"height":%d,"depth":%d}',
            k > 1 and "," or "", p.id, p.page and tostring(p.page) or "null",
            p.x, p.y, p.width, p.height, p.depth)
    end
    parts[#parts + 1] = ']}'
    local f = assert(io.open(jsonname, "w"))
    f:write(table.concat(parts))
    f:close()
    texio.write_nl(string.format("pageless: shipped %d page(s), %.1fpt tall in all, %d picture(s); wrote %s",
        #chunks, y0 / 65536, #pictures, jsonname))
end
