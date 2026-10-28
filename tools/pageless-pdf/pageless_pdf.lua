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
-- pages edge to edge (stack.ts) gives the single strip back, with every
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
-- empty box). The strip has the pictures themselves: a copy of each captured
-- box is kept, and the copied galley's placeholders are filled with it, so
-- TeX's backend draws each picture where it is, through whatever is around
-- it – a \resizebox's or \rotatebox's matrix, a colour, a clip – as it drew
-- it on the document's page.
--
-- The strip's pages have an origin of their own: the margin across, nothing
-- down. What moved the document's pages on the paper – \hoffset and \voffset
-- (a class's \advance\hoffset-1in, geometry's hoffset) and the PDF origin –
-- placed the page, not the text in the column, and is set aside before the
-- strip is shipped.
--
-- Load this file right after serializer.lua (it wraps
-- Serializer.note_captured_picture to keep each picture's box), and
-- call Pageless.ship() when the document has ended: from \@@end, the
-- primitive \end every \enddocument ends in (a class's own \enddocument,
-- as LaTeX's was before 2020, runs no end-of-document hook), after the last
-- \clearpage has put every float into the galley:
--
--   \expandafter\let\expandafter\reflowtexPagelessEnd\csname @@end\endcsname
--   \expandafter\def\csname @@end\endcsname{%
--     \directlua{Pageless.ship{margin = tex.sp("36pt")}}\reflowtexPagelessEnd}
--
-- Output: the pages, appended to the job's PDF, and pageless.json describing
-- them (page numbers, heights), all in sp.

Pageless = Pageless or {}

-- the serializer's attribute numbers and box subtypes
local ids = Serializer.ids
local TIKZ_PIC_ATTR = ids.TIKZ_PIC_ATTR

-- each captured picture's box, by document-local id: the template's capture
-- box still holds it when the private page has been shipped
local picture_boxes = {}
local orig_note = Serializer.note_captured_picture
function Serializer.note_captured_picture(id, page)
    local box = tex.getbox("reflowtexTikzBox")
    if box then picture_boxes[tonumber(id)] = node.copy(box) end
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

-- ── pictures ──────────────────────────────────────────────────────────────
-- A placeholder in a copied chunk gets the picture's own list and glue
-- setting (its size is the picture's already), wherever it is in the tree.
local function fill_pictures(head)
    local filled = 0
    for p in node.traverse(head) do
        local t = ntype(p)
        if t == "hlist" or t == "vlist" then
            local id = node.get_attribute(p, TIKZ_PIC_ATTR)
            local pic = id and picture_boxes[id]
            if pic then
                node.flush_list(p.head)
                p.head = pic.head and node.copy_list(pic.head) or nil
                p.glue_set, p.glue_sign, p.glue_order = pic.glue_set, pic.glue_sign, pic.glue_order
                filled = filled + 1
            elseif p.head then
                filled = filled + fill_pictures(p.head)
            end
        elseif t == "disc" then
            for _, f in ipairs({ "pre", "post", "replace" }) do
                if p[f] then filled = filled + fill_pictures(p[f]) end
            end
        end
    end
    return filled
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

-- ── the ends ───────────────────────────────────────────────────────────────
-- What a forced page break put into the galley – the empty box LaTeX sets
-- before a request to its output routine, the \topskip glue an output
-- routine gives back, the interline glue TeX set below them – the serializer
-- has already left out of it, and set the next line's interline glue again
-- (capture_flow, "Forced page breaks: seams"): the galley is the document
-- with no page breaks.
--
-- \maketitle's `\null\vskip 2em` and \end{document}'s \clearpage leave glue
-- and boxes that draw nothing before the first line and after the last (a
-- class's title block can open with ink-less boxes and net negative space);
-- paged, the top becomes the page's \topskip and the bottom is blank page.
-- The document's top is the first node that draws – a line, a rule, a box
-- with ink in it – as for the serializer's walk, which drops the space
-- before it (Serializer.draws: one rule for both); the strip is trimmed to
-- the first and the last node that draws.
local function trim_galley(nodes)
    local first, last = nil, nil
    for k, p in ipairs(nodes) do
        if Serializer.draws(p) then
            first = first or k
            last = k
        end
    end
    if not first then return nodes end
    local out = {}
    for k = first, last do out[#out + 1] = nodes[k] end
    if #out < #nodes then
        texio.write_nl(string.format("pageless: trimmed %d node(s) before the first that draws and %d after the last",
                                     first - 1, #nodes - last))
    end
    return out
end

-- ── text the galley has twice ──────────────────────────────────────────────
-- multicols passes its column lines through the main vertical list, one by
-- one, and its output routine then puts the balanced columns back as one
-- \hbox: the galley has that text twice. The serializer's walk shows the
-- lines and leaves out a box that holds lines of a paragraph it has already
-- shown (holds_emitted_lines), space and all; the strip leaves out the same
-- boxes, so both have the text once. As in the walk: a line marks its
-- paragraph shown, a \vbox is walked into, and the boxes looked at are those
-- shown as they are (an \hbox that is no line, display or alignment, a
-- picture). The paragraph of a line and the test of a box are the walk's own
-- (Serializer.find_para, Serializer.holds_lines); the strip ships before the
-- walk runs, so it marks what is shown itself.
local HL_LINE, HL_ALIGNMENT, HL_EQUATION = ids.HL_LINE, ids.HL_ALIGNMENT, ids.HL_EQUATION

local function shown_as_is(p)
    local t = ntype(p)
    if node.get_attribute(p, TIKZ_PIC_ATTR) then return t == "hlist" or t == "vlist" end
    return t == "hlist" and p.subtype ~= HL_LINE and p.subtype ~= HL_ALIGNMENT and p.subtype ~= HL_EQUATION
end

local function drop_text_twice(nodes)
    local shown, out = {}, {}
    local function mark(p)
        local t = ntype(p)
        if t == "hlist" and p.subtype == HL_LINE then
            local para = Serializer.find_para(p)
            if para then shown[para] = true end
        elseif t == "vlist" and p.head and not node.get_attribute(p, TIKZ_PIC_ATTR) then
            for c in node.traverse(p.head) do mark(c) end
        end
    end
    for _, p in ipairs(nodes) do
        if shown_as_is(p) and p.head and Serializer.holds_lines(p, shown) then
            -- left out
        else
            mark(p)
            out[#out + 1] = p
        end
    end
    if #out < #nodes then
        texio.write_nl(string.format("pageless: left out %d box(es) holding lines already in the galley", #nodes - #out))
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
    nodes = drop_text_twice(nodes)
    if opts.trim ~= false then nodes = trim_galley(nodes) end

    -- the origin: the margin, and none of the document's offsets
    tex.hoffset, tex.voffset = 0, 0
    pdf.setorigin(margin, 0)

    local chunks, pictures = {}, 0
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
        pictures = pictures + fill_pictures(list_head)
        list_head = strip_side_effects(list_head)
        local count = 0
        for _ in node.traverse(list_head) do count = count + 1 end
        local box = node.vpack(list_head)

        tex.pagewidth  = width + 2 * margin
        tex.pageheight = box.height + box.depth
        tex.box[255] = box
        tex.shipout(255)
        chunks[#chunks + 1] = {
            page = status.total_pages,
            y0 = y0, height = box.height, depth = box.depth,
            nodes = count,
        }
        y0 = y0 + box.height + box.depth
        i = last + 1
    end

    -- describe it all for stack.ts
    local f = assert(io.open(jsonname, "w"))
    f:write(Serializer.json_encode({
        unit = "sp", sp_per_pt = 65536, page_width = width + 2 * margin, hsize = width,
        margin = margin, total_height = y0, chunks = chunks,
    }))
    f:close()
    texio.write_nl(string.format("pageless: shipped %d page(s), %.1fpt tall in all, %d picture(s); wrote %s",
        #chunks, y0 / 65536, pictures, jsonname))
end
