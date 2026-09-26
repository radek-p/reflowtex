-- SPDX-License-Identifier: AGPL-3.0-or-later
-- The capture side of the pipeline, loaded by template.tex into LuaTeX: every
-- paragraph is recorded unbroken as TeX is about to break it, every display
-- in its finished form, and the main vertical list in document order; at the
-- end of the run they are written to output.json (the encoder turns that into
-- the protobuf the viewer reads). See docs/architecture.md.

-- ── JSON encoder ──────────────────────────────────────────────────────────
-- A Lua table does not say whether it is a list or a map, so a table can be
-- marked as one: json_array / json_object. An unmarked table is a list when
-- its keys are exactly 1..n – every node list, every record with string keys,
-- and so on, where that guess is always right. It is wrong for a map keyed by
-- numbers (font ids, 1..n by chance) and for an empty map, so those are
-- marked. An empty unmarked table is written as [].

local SHAPE = {}          -- metatable key: "array" | "object"

local function json_array(t)  return setmetatable(t or {}, { [SHAPE] = "array" })  end
local function json_object(t) return setmetatable(t or {}, { [SHAPE] = "object" }) end

local function json_encode(val)
    local t = type(val)
    if t == "nil" then
        return "null"
    elseif t == "boolean" then
        return val and "true" or "false"
    elseif t == "number" then
        return tostring(val)
    elseif t == "string" then
        return '"' ..
            val:gsub('\\', '\\\\')
               :gsub('"',  '\\"')
               :gsub('\n', '\\n')
               :gsub('\r', '\\r')
               :gsub('\t', '\\t')
            .. '"'
    elseif t == "table" then
        local mt = getmetatable(val)
        local shape = mt and mt[SHAPE]
        local is_array
        if shape then
            is_array = (shape == "array")
        else
            local count = 0
            for _ in pairs(val) do count = count + 1 end
            is_array = (count == #val)
        end
        if is_array then
            local parts = {}
            for _, v in ipairs(val) do parts[#parts + 1] = json_encode(v) end
            return "[" .. table.concat(parts, ",") .. "]"
        else
            local keys = {}
            for k in pairs(val) do keys[#keys + 1] = k end
            table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
            local parts = {}
            for _, k in ipairs(keys) do
                parts[#parts + 1] = json_encode(tostring(k)) .. ":" .. json_encode(val[k])
            end
            return "{" .. table.concat(parts, ",") .. "}"
        end
    else
        return '"[' .. t .. ']"'
    end
end

-- ── Font table ────────────────────────────────────────────────────────────
-- Collected lazily as glyphs are encountered.

local used_fonts = {}

local function note_font(font_id)
    if used_fonts[font_id] then return end
    local f = font.getfont(font_id)
    if not f then return end
    -- Extract just the filename from the full path.
    local filename = (f.filename or ""):match("([^/]+)$") or "unknown"
    used_fonts[font_id] = {
        name     = f.fullname or f.name or "unknown",
        size_sp  = f.size or 0,
        filename = filename,
    }
end

-- The characters each font was used for, so the microtypography pass below
-- only has to look those up.
local used_chars = {}

local function note_char(font_id, ch)
    local t = used_chars[font_id]
    if not t then
        t = {}
        used_chars[font_id] = t
    end
    t[ch] = true
end

-- ── Protrusion and expansion ──────────────────────────────────────────────
-- microtype (or a preamble using \lpcode, \rpcode and \expandglyphsinfont
-- directly) configures these on the engine's *internal* font structures after
-- the font is loaded. font.getfont returns the table the font was defined
-- from, which never learns of them; font.getcopy rebuilds a table from the
-- internal structure and does. So they are read once per font at the very end,
-- when everything is set, for the characters the document actually used.
-- Units are TeX's own: lp/rp are \lpcode/\rpcode (thousandths of the font's
-- quad), ef is \efcode (thousandths of the character's width, 1000 = like the
-- rest of the font), stretch/shrink/step are \expandglyphsinfont's three
-- arguments (thousandths). A breaker given these reproduces TeX's protruded
-- and expanded lines exactly; the viewer's own breaker keeps its own tables.
local function round_int(v)
    return math.floor((v or 0) + 0.5)
end

local function annotate_fonts()
    if not font.getcopy then return end
    for id, info in pairs(used_fonts) do
        local ok, f = pcall(font.getcopy, id)
        if ok and type(f) == "table" then
            local params = f.parameters or {}
            info.quad = round_int(params.quad or params[6] or f.size or 0)
            if (f.stretch or 0) ~= 0 or (f.shrink or 0) ~= 0 then
                info.expand_stretch = f.stretch or 0
                info.expand_shrink  = f.shrink or 0
                info.expand_step    = f.step or 0
            end
            local chars = f.characters or {}
            local cs = {}
            for c in pairs(used_chars[id] or {}) do cs[#cs + 1] = c end
            table.sort(cs)
            local codes = {}
            for _, c in ipairs(cs) do
                local ch = chars[c]
                if ch then
                    local lp = ch.left_protruding or 0
                    local rp = ch.right_protruding or 0
                    local ef = ch.expansion_factor or 1000
                    if lp ~= 0 or rp ~= 0 or ef ~= 1000 then
                        codes[#codes + 1] = { char = c, lp = lp, rp = rp, ef = ef }
                    end
                end
            end
            if #codes > 0 then info.codes = codes end
        end
    end
end

-- ── Colour tracking ───────────────────────────────────────────────────────
-- xcolor's \color emits pdf_colorstack whatsits (push/pop/set with a PDF
-- colour operator string). We simulate the stack during the document-order
-- walk and annotate glyph/rule nodes with the resolved colour as a CSS hex
-- string. nil means "default text colour" (black), which the renderer maps
-- to currentColor so dark mode keeps working; #000000 is normalised to nil.

local function parse_pdf_color(data)
    if not data or data == "" then return nil end
    local function hex(v) return string.format("%02x", math.floor(math.min(1, tonumber(v)) * 255 + 0.5)) end
    local r, g, b = data:match("^%s*([%d%.]+)%s+([%d%.]+)%s+([%d%.]+)%s+rg")
    if r then
        local col = "#" .. hex(r) .. hex(g) .. hex(b)
        return col ~= "#000000" and col or nil
    end
    local gray = data:match("^%s*([%d%.]+)%s+g")
    if gray then
        local h = hex(gray)
        local col = "#" .. h .. h .. h
        return col ~= "#000000" and col or nil
    end
    local c, m, y, k = data:match("^%s*([%d%.]+)%s+([%d%.]+)%s+([%d%.]+)%s+([%d%.]+)%s+k")
    if c then
        k = tonumber(k)
        local function chan(ink) return string.format("%02x", math.floor((1 - math.min(1, tonumber(ink) + k)) * 255 + 0.5)) end
        local col = "#" .. chan(c) .. chan(m) .. chan(y)
        return col ~= "#000000" and col or nil
    end
    return nil
end

-- Stack state is file-level: it persists across paragraphs, which are
-- captured in document order, so colours opened in one paragraph carry into
-- the next exactly as they do in the PDF.
--
-- There is more than one stack. The first, 0, is the page's colour stack,
-- which color/xcolor use; packages create others for graphics state that must
-- nest the same way – `transparent` pushes "/TRP.5 gs" on stack 1, TikZ's
-- opacity likewise. Each stack is kept apart, and only stack 0 gives the
-- text colour: taken as one stack, a transparency push read as "no colour"
-- and reset red text to the default until its pop. (Opacity itself is not
-- carried: the schema has no field for it yet.)
local TEXT_COLOR_STACK = 0
local color_stacks  = {}    -- stack number → { saved = {…}, current = colour or nil }
local current_color = nil   -- stack 0's colour: what glyphs and rules are painted with

-- A paragraph set inside a box (a minipage, a margin note, a footnote's
-- insertion) is captured on its own, but its colour changes cannot outlast the
-- box: the pop that ends a \color inside the box lands in the box's vertical
-- list, after the paragraph, where no capture sees it. Left in the running
-- state, one such push coloured the rest of a corpus paper red. So the state
-- is saved before such a paragraph and restored after it; the box itself is
-- replayed in order with the paragraph around it, if it is in one.
local function save_colors()
    local copy = {}
    for k, st in pairs(color_stacks) do
        local saved = {}
        for i, v in ipairs(st.saved) do saved[i] = v end
        copy[k] = { saved = saved, current = st.current }
    end
    return { stacks = copy, current = current_color }
end

local function restore_colors(s)
    color_stacks, current_color = s.stacks, s.current
end

local function handle_colorstack(n)
    local st = color_stacks[n.stack]
    if not st then
        st = { saved = {}, current = nil }
        color_stacks[n.stack] = st
    end
    if n.command == 1 then          -- push
        st.saved[#st.saved + 1] = st.current or false
        st.current = parse_pdf_color(n.data)
    elseif n.command == 2 then      -- pop
        local top = st.saved[#st.saved]
        if #st.saved > 0 then st.saved[#st.saved] = nil end
        st.current = top or nil
    elseif n.command == 0 then      -- set
        st.current = parse_pdf_color(n.data)
    end
    if n.stack == TEXT_COLOR_STACK then current_color = st.current end
end

-- ── Pictures ──────────────────────────────────────────────────────────────
-- Ordinary \includegraphics images arrive as subtype-2 rule nodes; captured
-- TikZ drawings arrive as empty hboxes with the same metrics as the original.
-- Neither node can name its source, so template.tex stamps a document-local id
-- and records the corresponding PDF/page metadata here.

local PIC_ATTR    = 902
local FOOTNOTE_MARK_ATTR = 906 -- glyphs of the superscript marker
local FOOTNOTE_INS_ATTR  = 907 -- the matching insertion node
local TIKZ_PIC_ATTR      = 908 -- placeholder hbox for an internally captured TikZ page
-- A cross-reference is stamped on *every* glyph of its printed text rather than
-- marked by boundary nodes, because the browser re-breaks the paragraph: a
-- start/end pair would have to be re-paired per line, and a reference split
-- across a line break would lose half of itself. An attribute rides on each
-- glyph wherever it lands, so the whole reference stays one link.
local LINK_ATTR          = 909 -- glyphs of a \ref/\eqref/\autoref's printed text
local ANCHOR_ATTR        = 910 -- the zero-size box \label leaves behind
local DISPLAY_ATTR       = 912 -- a display's box: the number Serializer.note_display recorded it under
local STREAM_ATTR        = 911 -- nodes typeset inside \begin{webstream} (reflowtex.sty): the stream id
-- A \webtext slot (reflowtex.sty): text a page may replace from JavaScript.
-- Stamped on every glyph and glue of the default text, like a link, so the
-- viewer can find the whole run wherever the line breaks fall.
local SLOT_ATTR          = 913
local ASIDE_ATTR         = 914 -- the insertion of a \webaside (reflowtex.sty): its stream id
local ASIDE_MARK_ATTR    = 915 -- the empty box a \webaside leaves where it stood: the same id
local RULE_IMAGE  = 2
local picture_files = {}
local source_width = 0
-- id → the label a reference points at / the label defined at a marker. Both are
-- document-local ids; the names only have to be resolved by whoever knows how
-- this document is published, which is not us.
local link_labels  = {}
local anchor_labels = {}
-- id → { name, space, stretch, shrink }: a \webtext slot's name, and the
-- interword glue of the font it was set in (\fontdimen2–4, sp), which the
-- viewer puts between the words of a replacement text.
local slot_table = {}

Serializer = Serializer or {}
-- A reference's destination is recorded as the *label* the author wrote, not as
-- hyperref's generated anchor name: the label is what the rest of the toolchain
-- can still recognise, and with `hypertexnames=false` the anchor name is an
-- opaque counter that means nothing outside this one compilation.
-- amsmath replays a display's label through \ltx@label after the display is
-- finished, and what arrives there still carries the brace group it was stored
-- in. A label can never legitimately be brace-wrapped, so unwrap one layer.
local function clean_label(label)
    return (tostring(label):match("^{(.*)}$")) or label
end
function Serializer.note_link(id, label)
    -- cleveref's \cref takes a comma-separated list and prints one run for all
    -- of them; jumping to the first is what following that run would do.
    label = clean_label(label):match("^[^,]*")
    link_labels[id] = { label = label }
end
-- An address the author wrote out in full. Nothing to resolve, so it is stored
-- as-is; it arrives here already processed by hyperref, with the catcode games
-- a URL needs already played out.
function Serializer.note_link_url(id, url)
    link_labels[id] = { url = tostring(url) }
end
-- A relative address (\href without a scheme, which hyperref would make a
-- file link): kept as written, with its anchor, for the page to resolve.
function Serializer.note_link_file(id, file, name)
    file, name = tostring(file), tostring(name or "")
    link_labels[id] = { url = (name ~= "") and (file .. "#" .. name) or file }
end
-- Not a destination but a control (\webaction in reflowtex.sty): the
-- glyphs trigger `action` in the page instead of navigating.
function Serializer.note_link_action(id, action)
    link_labels[id] = { action = tostring(action) }
end
function Serializer.note_slot(id, name, space, stretch, shrink, kind)
    slot_table[id] = { name = tostring(name), space = space, stretch = stretch, shrink = shrink,
                       kind = kind and tostring(kind) or nil }
end
function Serializer.note_label(id, label)
    anchor_labels[id] = clean_label(label)
end

-- The document's outline (template.tex, "Outline capture"): sections from
-- \addcontentsline{toc} (level 0 from TeX: the kind names it) and
-- theorem-like environments (level 9). `anchor` is the anchor the entry's
-- position is marked with. Titles stay TeX source here; the encoder turns
-- them into plain text.
local outline = {}
local OUTLINE_LEVELS = { part = 0, chapter = 0, section = 1, subsection = 2, subsubsection = 3 }
function Serializer.note_outline(anchor, kind, level, number, title)
    kind, number, title = tostring(kind), tostring(number or ""), tostring(title or "")
    if tonumber(level) == 9 then
        outline[#outline + 1] = { kind = "theorem", env = kind, level = 9,
                                  number = number, title = title, anchor = anchor }
        return
    end
    local lv = OUTLINE_LEVELS[kind]
    if not lv then return end                   -- \paragraph and deeper: not listed
    -- "\numberline {3.1}Title" (the number's braces may hold spaces)
    local num, rest = title:match("\\numberline%s*(%b{})%s*(.*)$")
    if num then number, title = num:sub(2, -2), rest end
    title = title:gsub("^\\protect%s*", "")
    -- \section*{X} followed by \addcontentsline{toc}{section}{X}: once.
    local last = outline[#outline]
    if last and last.kind == kind and last.number == "" and last.title == title then return end
    outline[#outline + 1] = { kind = kind, level = lv, number = number,
                              title = title, anchor = anchor }
end

-- A stream opened by \begin{webstream}{kind} (reflowtex.sty): `id` is
-- its number, which is also the value of attribute 911 on every node typeset
-- inside it, and `parent` the attribute's value when it opened – an unset
-- LuaTeX attribute reads as a large negative number, so anything non-positive
-- means the main flow. Footnotes join the same table when the flow walk meets
-- their insertions; the walk fills `content` (see walk_flow).
local streams = {}
local footnote_index = {}   -- template footnote id → stream index
--
-- `attrs` is the optional argument's key=value list, as written: split on
-- commas, each item on its first "=", both sides trimmed. A key without a
-- value is kept with an empty one. Keys are letters, digits and "-" (they
-- become data-KEY in the page); anything else is dropped.
local function parse_stream_attrs(text)
    local out = {}
    for item in tostring(text or ""):gmatch("[^,]+") do
        local k, v = item:match("^%s*([^=]-)%s*=%s*(.-)%s*$")
        if not k then k, v = item:match("^%s*(.-)%s*$"), "" end
        if k ~= "" and k:match("^[%w%-]+$") then
            -- A literal # reaches us doubled: \detokenize (how reflowtex.sty
            -- passes a colour like #c2410c) doubles parameter characters.
            out[#out + 1] = { key = k:lower(), value = (v:gsub("##", "#")) }
        end
    end
    return out
end
-- Text a stream carries untypeset (reflowtex.sty's lean environment reads
-- its body verbatim and hands it over here).
function Serializer.note_stream_text(id, text)
    id = tonumber(id)
    -- Without the blank lines at either end (the rest of the \\begin line,
    -- the line break before \\end).
    if streams[id] then
        streams[id].text = (tostring(text or ""):gsub("^%s*\n", ""):gsub("%s+$", ""))
    end
end
function Serializer.note_stream(id, kind, parent, attrs)
    id = tonumber(id); parent = tonumber(parent)
    streams[id] = { kind = tostring(kind), content = {},
                    attrs = parse_stream_attrs(attrs),
                    parent = (parent and parent > 0) and parent or nil }
end

-- What TeX had in hand when it opened a display (\everydisplay, template.tex):
-- \predisplaysize – where the line before the display ends, +2em, or
-- -\maxdimen when the display began its paragraph – and the four display
-- skips in force. TeX picks the full pair when the display's left edge is at
-- or left of that end (TeX §1203), the short pair otherwise. The renderer
-- re-breaks the line, so it must make that choice itself; see the viewer.
local display_notes = {}
local current_display = nil
local display_open = false
-- \addvspace after a display (template.tex): the least space LaTeX asked for
-- while the display's own below skip was the last thing on the list, by
-- display number. The viewer takes the larger of that and the skip it sets.
local addvspace_min = {}
local below_skip_of
function Serializer.note_addvspace(lastskip, amount)
    if current_display then below_skip_of(current_display) end
    local rec = current_display and display_notes[current_display]
    if rec and rec.below_used and lastskip == rec.below_used then
        addvspace_min[current_display] = math.max(addvspace_min[current_display] or 0, amount)
    end
end
function Serializer.note_display(id)
    current_display = id
    local function skip(name)
        local ok, v = pcall(function() return tex[name] end)
        return (ok and v and v.width) or 0
    end
    display_notes[id] = {
        pre_size    = tex.predisplaysize,
        above       = skip("abovedisplayskip"),
        above_short = skip("abovedisplayshortskip"),
        below       = skip("belowdisplayskip"),
        below_short = skip("belowdisplayshortskip"),
        -- the em TeX measures \predisplaysize with: the font current at the $$
        quad        = (font.getparameters(font.current()) or {}).quad or 0,
    }
    display_open = true
end
-- The display's math group has closed (\aftergroup, template.tex): math
-- converted from here on is the text after it.
function Serializer.note_display_end()
    display_open = false
end
-- The leading TeX appends the display box with. The box goes onto the
-- vertical list before the math group closes, so \baselineskip as set
-- *inside* the display counts – amsmath's \openup\jot in split and
-- multline, for one. The conversion of the display's own math list runs
-- at that point, in that group: read the parameters there. An alignment's
-- outer list is empty and never converted, so its cells' conversions (text
-- style, inside the same group, after amsmath opened the leading up) stand
-- in – the display's own conversion, when it comes, has the last word.
-- Only the shallowest group's: a cell's math converts its nested lists
-- first, and an array inside it (a pmatrix in a gather* row) has set
-- \baselineskip and \lineskip to zero in its own group (LaTeX's \@array).
local function note_display_leading(head, style, penalties)
    local rec = display_open and display_notes[current_display]
    local level = tex.currentgrouplevel
    if rec and (rec.bskip == nil or level < rec.level
                or (style == "display" and level <= rec.level)) then
        rec.level = level
        local function width(name)
            local ok, v = pcall(function() return tex[name] end)
            if not ok or v == nil then return 0 end
            return type(v) == "number" and v or (v.width or 0)
        end
        rec.bskip, rec.lskip, rec.lskiplimit = width("baselineskip"), width("lineskip"), width("lineskiplimit")
    end
    return node.mlist_to_hlist(head, style, penalties)
end
-- The below skip TeX appended after the display: the first glue after the
-- display's box on the vertical list, as it stands at the first \addvspace
-- (\addpenalty may have put a copy of it after a penalty by then, and the
-- page builder may have moved the earlier part onto the page – the list is
-- read back from its end, then the page from its end, to the last box).
below_skip_of = function(id)
    local rec = display_notes[id]
    if not rec or rec.below_used ~= nil then return end
    local function back(head, found)
        local n = head and node.tail(head)
        while n do
            local t = node.type(n.id)
            if t == "hlist" or t == "vlist" or t == "rule" then return found, true end
            if t == "glue" then found = n end
            n = n.prev
        end
        return found, false
    end
    local g, boxed = back(tex.nest[tex.nest.ptr].head, nil)
    if not boxed then g = back(tex.lists.page_head, g) end
    rec.below_used = g and (g.subtype == 5 or g.subtype == 7) and g.width or false
end

function Serializer.note_source_width(sp)
    source_width = tonumber(sp) or 0
end
function Serializer.note_picture(id, file)
    picture_files[id] = { file = file, externalized = true }
end

function Serializer.note_captured_picture(id, page)
    picture_files[id] = {
        file = tex.jobname .. ".pdf",
        page = page,
        generated = true,
    }
end

function Serializer.note_graphic(id, file, options)
    local resolved = kpse.find_file(file)
    if not resolved and not file:match("%.[^/]+$") then
        resolved = kpse.find_file(file .. ".pdf")
    end
    picture_files[id] = {
        file = resolved or file,
        page = tonumber(options:match("page%s*=%s*{?(%d+)")) or 1,
        externalized = false,
    }
end

-- ── Transforms ────────────────────────────────────────────────────────────
-- Rotation is not a node property: \rotatebox (and \reflectbox, \scalebox)
-- leave the box tree alone and emit three whatsits around the content –
-- pdf_save, pdf_setmatrix, pdf_restore – while adjusting the *enclosing* box
-- to the transformed bounding box. So the metrics are already right without
-- us; only the drawing needs the matrix. Dropping these whatsits is silent
-- and looks like a layout bug: the content renders unrotated in a box sized
-- for the rotated version.
--
-- pdf_setmatrix's `data` is "a b c d" and applies about the current point:
-- the backend emits translate(x,y) . [a b c d] . translate(-x,-y). The pair
-- is nested and well-formed, so it is folded here into one `transform` node
-- with the content as children, which keeps the concept whole in the schema
-- and leaves the renderer a single node type to handle.
-- node.whatsits() maps subtype number -> name, so it is inverted here. The
-- numbers are looked up rather than hardcoded because they are an internal
-- LuaTeX enum; a wrong constant silently strips the whatsit and un-rotates
-- the content rather than failing.
local WH = {}
for subtype, name in pairs(node.whatsits()) do WH[name] = subtype end
local WH_SETMATRIX = assert(WH.pdf_setmatrix, "no pdf_setmatrix whatsit subtype")
local WH_SAVE      = assert(WH.pdf_save,      "no pdf_save whatsit subtype")
local WH_RESTORE   = assert(WH.pdf_restore,   "no pdf_restore whatsit subtype")
local WH_COLORSTACK = assert(WH.pdf_colorstack, "no pdf_colorstack whatsit subtype")
local WHATSIT_ID    = node.id("whatsit")


-- ── Colour set between paragraphs ─────────────────────────────────────────
-- A colour change written in vertical mode (\color{blue} between two
-- paragraphs, or at the top of a center environment) is a whatsit on the
-- main vertical list, which the paragraph capture never walks; left alone,
-- the text after it came out in the previous colour. capture_flow applies
-- such whatsits as they are contributed, which is before the paragraph after
-- them is captured (TeX runs the page builder as each paragraph starts). A
-- colour change inside a box's own vertical list (a minipage) needs nothing:
-- the box is serialized with the paragraph around it, which replays its whole
-- contents in order. (Whatsits met while serializing are applied every time
-- they are met – a box can be used twice, and its colours go with it.)

local function parse_matrix(data)
    if not data then return nil end
    local a, b, c, d = data:match("^%s*(%-?[%d%.]+)%s+(%-?[%d%.]+)%s+(%-?[%d%.]+)%s+(%-?[%d%.]+)")
    if not a then return nil end
    return { a = tonumber(a), b = tonumber(b), c = tonumber(c), d = tonumber(d) }
end

-- ── Links and destinations from hyperref ─────────────────────────────────
-- template.tex wraps \ref and its relatives, \label, \url and \href, and
-- stamps LINK_ATTR/ANCHOR_ATTR on what they print. Everything else hyperref
-- links – \cite, \hyperref[label]{text}, \hyperlink/\hypertarget, and what
-- packages build on them – is caught here, from the nodes hyperref's driver
-- leaves: a pdf_start_link … pdf_end_link pair around the linked text (a
-- `goto` action naming a destination, or a URI), and a pdf_dest whatsit
-- where each destination is.
--
-- A glyph inside a link that no wrapper claimed gets the link, as the
-- wrappers' glyphs do: per glyph, so a line break keeps the link whole.
-- Footnote marks are left alone (hyperref links them to the footnote; the
-- viewer has its own popover for that). Destinations are recorded where they
-- stand – inline as the same empty box \label leaves, between paragraphs as
-- an anchor point – and at the end only those some link needs are kept.
-- A destination is named by the author's label when the .aux has one for it
-- (\newlabel's fourth field is hyperref's destination), so a link to a
-- \label'd section meets the anchor the wrapper already made; otherwise by
-- hyperref's own name (cite.knuth, a \hypertarget's name).
--
-- Both get provisional negative ids while the document is read; the final
-- ones follow the template's (resolve_hyperref).
local WH_START_LINK = WH.pdf_start_link
local WH_END_LINK   = WH.pdf_end_link
local WH_DEST       = WH.pdf_dest
local ACTION_GOTO, ACTION_USER = 1, 3

local hy_links = {}        -- k → { dest = name } or { url = address }; .used once a glyph has it
local hy_open  = {}        -- the links open where the serializer is: k, or false (not followed)
local hy_dests = {}        -- k → { name = destination, list = where it was put, item = what }

-- The address of a URI action, from hyperref's user action text
-- ("/Subtype/Link/A<</S/URI/URI(https://…)>>"), with PDF string escapes undone.
local function uri_of(data)
    local s = tostring(data or ""):match("/URI%s*(%b())")
    if not s then return nil end
    s = s:sub(2, -2)
    return (s:gsub("\\(.)", "%1"))
end

local function open_link(n)
    local a = n.action
    local entry
    if a and a.action_type == ACTION_GOTO and a.named_id == 1 and (a.file or "") == "" then
        entry = { dest = tostring(a.action_id) }
    elseif a and a.action_type == ACTION_USER then
        local url = uri_of(a.data)
        if url then entry = { url = url } end
    end
    if entry then
        hy_links[#hy_links + 1] = entry
        hy_open[#hy_open + 1] = #hy_links
    else
        hy_open[#hy_open + 1] = false
    end
end

local function close_link()
    if #hy_open > 0 then hy_open[#hy_open] = nil end
end

-- The provisional id for a glyph at this point, or nil.
local function open_link_id()
    local k = hy_open[#hy_open]
    if not k then return nil end
    hy_links[k].used = true
    return -k
end

local function note_dest(n, list, item)
    if n.named_id ~= 1 then return nil end
    hy_dests[#hy_dests + 1] = { name = tostring(n.dest_id), list = list, item = item }
    return -#hy_dests
end

-- ── Node serializer ───────────────────────────────────────────────────────

local function serialize_nodelist(head)
    local result = {}
    -- `cur` is the list being appended to: a pdf_save opens a frame that
    -- collects nodes until its pdf_restore, at which point the frame becomes
    -- a transform node (if a matrix was set) or is spliced back in flat (if
    -- not – plenty of saves carry no matrix at all).
    local cur = result
    local frames = {}

    for n in node.traverse(head) do
        local t = node.type(n.id)

        if t == "local_par" then
            -- skip

        elseif t == "whatsit" and n.subtype == WH_SAVE then
            local f = { parent = cur, list = {} }
            frames[#frames + 1] = f
            cur = f.list

        elseif t == "whatsit" and n.subtype == WH_SETMATRIX then
            local f = frames[#frames]
            if f then f.matrix = parse_matrix(n.data) end

        elseif t == "whatsit" and n.subtype == WH_RESTORE then
            local f = frames[#frames]
            if f then
                frames[#frames] = nil
                cur = f.parent
                if f.matrix then
                    local m = f.matrix
                    cur[#cur + 1] = {
                        type = "transform",
                        m_a = m.a, m_b = m.b, m_c = m.c, m_d = m.d,
                        children = f.list,
                    }
                else
                    for _, item in ipairs(f.list) do cur[#cur + 1] = item end
                end
            end

        elseif t == "whatsit" and n.subtype == WH_START_LINK then
            open_link(n)

        elseif t == "whatsit" and n.subtype == WH_END_LINK then
            close_link()

        elseif t == "whatsit" and n.subtype == WH_DEST and n.named_id == 1 then
            -- the empty box a \label leaves, standing for the destination
            local box = { type = "hlist", subtype = 2, width = 0, height = 0, depth = 0, shift = 0,
                          glue_set = 0, glue_sign = 0, glue_order = 0, children = {} }
            box.anchor = note_dest(n, cur, box)
            cur[#cur + 1] = box

        elseif t == "whatsit" and n.subtype == WH_COLORSTACK then
            -- pdf_colorstack whatsit: update colour state; nothing to emit
            -- (the resolved colour is baked into glyph/rule nodes).
            handle_colorstack(n)

        elseif t == "glyph" then
            note_font(n.font)
            note_char(n.font, n.char)
            local fdata = font.getfont(n.font)
            local cinfo = fdata and fdata.characters and fdata.characters[n.char]
            local g = {
                type   = "glyph",
                char   = n.char,
                gindex = cinfo and cinfo.index or nil,
                font   = n.font,
                width  = n.width,
                height = n.height,
                depth  = n.depth,
                color  = current_color,
                footnote   = node.get_attribute(n, FOOTNOTE_MARK_ATTR),
                link       = node.get_attribute(n, LINK_ATTR),
                slot       = node.get_attribute(n, SLOT_ATTR),
            }
            if not g.link and not g.footnote then g.link = open_link_id() end
            cur[#cur + 1] = g

        elseif t == "glue" then
            local g = {
                type         = "glue",
                width        = n.width,
                stretch      = n.stretch,
                shrink       = n.shrink,
                stretch_order = n.stretch_order,
                shrink_order  = n.shrink_order,
                subtype      = n.subtype,
                slot         = node.get_attribute(n, SLOT_ATTR),
            }
            -- Leader glue (\leaders, \cleaders, \xleaders, \gleaders) carries a
            -- box that TeX tiles across the glue's *set* width instead of
            -- leaving blank space. Extensible arrows are built this way:
            -- \xrightarrow is an arrow tail, a \cleaders run of en-dashes, and
            -- an arrowhead – so dropping the leader silently deletes the middle
            -- of every arrow and leaves the two ends floating apart.
            if n.leader then
                g.leader = serialize_nodelist(n.leader)[1]
            end
            cur[#cur + 1] = g

        elseif t == "kern" then
            cur[#cur + 1] = {
                type    = "kern",
                kern    = n.kern,
                subtype = n.subtype,
            }

        elseif t == "penalty" then
            cur[#cur + 1] = {
                type    = "penalty",
                penalty = n.penalty,
            }

        elseif t == "rule" and n.subtype == RULE_IMAGE then
            -- An included or externally supplied picture. Keep TeX's metrics –
            -- they are what lets the picture behave as an ordinary box
            -- everywhere – and carry the source file into the encode stage.
            local id = node.get_attribute(n, PIC_ATTR)
            local picture = id and picture_files[id] or nil
            cur[#cur + 1] = {
                type   = "picture",
                width  = n.width,
                height = n.height,
                depth  = n.depth,
                file   = picture and picture.file or nil,
                page   = picture and picture.page or nil,
                externalized = picture and picture.externalized or nil,
            }

        elseif t == "rule" then
            -- width = -1073741824 sp (-16384pt) is TeX's sentinel meaning
            -- "fill to the width of the enclosing box" (a running rule).
            -- We preserve the raw value; the renderer handles the sentinel.
            cur[#cur + 1] = {
                type   = "rule",
                width  = n.width,
                height = n.height,
                depth  = n.depth,
                color  = current_color,
            }

        elseif t == "disc" then
            local function sub(h) return h and serialize_nodelist(h) or {} end
            cur[#cur + 1] = {
                type    = "disc",
                subtype = n.subtype,
                pre     = sub(n.pre),
                post    = sub(n.post),
                replace = sub(n.replace),
            }

        elseif (t == "hlist" or t == "vlist")
                and node.get_attribute(n, TIKZ_PIC_ATTR) then
            -- template.tex replaced a completed, non-externalised TikZ box by
            -- this metric-identical placeholder after shipping a copy as a
            -- private page of the job PDF. Do not descend into the empty box;
            -- join it to that page by its document-local id.
            local id = node.get_attribute(n, TIKZ_PIC_ATTR)
            local picture = picture_files[id]
            cur[#cur + 1] = {
                type   = "picture",
                width  = n.width,
                height = n.height,
                depth  = n.depth,
                file   = picture and picture.file or nil,
                page   = picture and picture.page or nil,
                generated = picture and picture.generated or nil,
            }

        elseif t == "hlist" or t == "vlist" then
            -- Recurse into children; include shift for superscript/subscript boxes.
            -- glue_set/sign/order are TeX's pre-computed box glue setting: the PDF
            -- backend uses these directly rather than recomputing from children.
            cur[#cur + 1] = {
                type       = t,
                subtype    = n.subtype,
                width      = n.width,
                height     = n.height,
                depth      = n.depth,
                shift      = n.shift,
                glue_set   = n.glue_set,
                glue_sign  = n.glue_sign,
                glue_order = n.glue_order,
                -- \label typesets nothing, so it has no position of its own.
                -- template.tex leaves an empty, zero-sized box where it stood;
                -- that box flows with the text through line breaking, so where
                -- it comes to rest is where the label belongs. No special node
                -- kind is needed – it is an ordinary box that happens to be
                -- empty, and it draws and advances nothing either way.
                anchor     = node.get_attribute(n, ANCHOR_ATTR),
                -- A \webaside's mark, likewise an empty box: where the aside
                -- stood, for a page to place it by.
                aside      = node.get_attribute(n, ASIDE_MARK_ATTR),
                children   = n.head and serialize_nodelist(n.head) or {},
            }

        elseif t == "math" then
            -- Marks the start (subtype=0) and end (subtype=1) of inline math.
            -- `surround` is a thin space on each side for some formula types.
            cur[#cur + 1] = {
                type     = "math",
                subtype  = n.subtype,
                surround = n.surround,
            }

        else
            cur[#cur + 1] = { type = t }
        end
    end

    -- A save whose restore lands in a different list would strand its content
    -- inside an unclosed frame, i.e. drop it from the output. Nothing emits
    -- that today, but losing content silently is the wrong failure: splice the
    -- frames back untransformed so the text still renders.
    for i = #frames, 1, -1 do
        local f = frames[i]
        for _, item in ipairs(f.list) do f.parent[#f.parent + 1] = item end
    end
    return result
end

-- ── Paragraph capture ─────────────────────────────────────────────────────
-- Every pre_linebreak fire is captured *unbroken* so the browser can re-break
-- it. Note there is no groupcode filter: text preceding a display fires with
-- groupcode="math_shift" (TeX interrupts the paragraph, sets the part so far,
-- appends the display, then resumes), and dropping those fires would silently
-- discard the text around every display.
--
-- Each captured node is stamped with its paragraph index so the shipout walk
-- can recognise the resulting lines. Displays never pass through this
-- callback, so they stay unstamped – that is exactly how the walk tells text
-- apart from math.

local all_paragraphs = {}
local PARA_ATTR      = 900

local function stamp(head, idx)
    for n in node.traverse(head) do
        node.set_attribute(n, PARA_ATTR, idx)
        local t = node.type(n.id)
        if t == "hlist" or t == "vlist" then stamp(n.head, idx)
        elseif t == "disc" then
            stamp(n.pre, idx); stamp(n.post, idx); stamp(n.replace, idx)
        end
    end
end

local function find_para(n)
    local v = node.get_attribute(n, PARA_ATTR)
    if v then return v end
    local t = node.type(n.id)
    if t == "hlist" or t == "vlist" then
        for c in node.traverse(n.head) do
            local r = find_para(c)
            if r then return r end
        end
    end
    return nil
end

-- List indentation never appears in the node list. LaTeX's list environments
-- leave \leftskip at zero and indent via \parshape instead, whose first pair
-- is {indent, linewidth} – so an item at depth 1 reports {25pt, 320pt} of a
-- 345pt \hsize. The indent must be recorded here, while the paragraph is
-- being broken, and is an absolute typographic measure (\leftmargin), so the
-- renderer keeps it fixed and narrows the text column rather than scaling it.
-- Without it, item text starts at x=0 and the label – which hangs a fixed
-- distance to the *left* of the text – lands at negative x and is clipped.
-- The band this paragraph occupies: {indent, width}. Doubles as the band any
-- display inside it inherits (see the \displaywidth note below).
local function para_band()
    local ok, ps = pcall(function() return tex.parshape end)
    if ok and type(ps) == "table" and ps[1] and ps[1][1] and ps[1][2] then
        return ps[1][1], ps[1][2]
    end
    return 0, tex.hsize or 0
end

-- TeX's interline spacing parameters, active when this paragraph is broken. The
-- renderer re-breaks the paragraph but reproduces TeX's baseline-to-baseline rule
-- from these: advance = (baselineskip - prevDepth - height >= lineskiplimit)
-- ? baselineskip : prevDepth + height + lineskip. baselineskip and lineskip are
-- glue parameters (read their width); lineskiplimit is a dimen.
local function param_dimen(name)
    local ok, v = pcall(function() return tex[name] end)
    if not ok or v == nil then return 0 end
    if type(v) == "number" then return v end     -- dimen (lineskiplimit)
    return v.width or 0                            -- glue spec (baselineskip, lineskip)
end

-- Paragraph alignment, read from the \leftskip/\rightskip in force as it is
-- broken. LaTeX's alignment commands set these to \@flushglue (0pt plus 1fil):
-- \centering sets both, \raggedright only \rightskip, \raggedleft only
-- \leftskip. So an infinite stretch order on each side names the alignment;
-- neither (the normal case) is justified and returns nil, which the renderer
-- reads as "inherit the block alignment", keeping the wire form small.
local function glue_stretch_order(name)
    local ok, _, _, _, sto = pcall(tex.getglue, name)
    if ok and sto then return sto end
    return 0
end
local function para_align()
    local ls = glue_stretch_order("leftskip")  > 0
    local rs = glue_stretch_order("rightskip") > 0
    if ls and rs then return "center" end
    if rs then return "left"  end   -- ragged right: text flush left
    if ls then return "right" end   -- ragged left:  text flush right
    return nil                      -- justified (default)
end

-- Remove the empty boxes \label left behind, once their positions have been
-- recorded. Only top-level ones: a marker nested inside a box is already inside
-- something TeX has finished building, where it can no longer affect anything.
local function strip_anchor_markers(head)
    local n = head
    while n do
        local nxt = n.next
        if (node.type(n.id) == "hlist" or node.type(n.id) == "vlist")
                and node.get_attribute(n, ANCHOR_ATTR) then
            head = node.remove(head, n)
            node.free(n)
        end
        n = nxt
    end
    return head
end

-- The fixed part of a margin skip: every line of the paragraph is set that far
-- in from its band – a table of contents' entries are, with their numbers
-- hanging back into the \leftskip.
local function skip_width(name)
    local ok, w = pcall(tex.getglue, name)
    return (ok and w) or 0
end

local function capture_paragraph(head, groupcode)
    hy_open = {}                  -- a link never runs from one paragraph into the next
    -- nest 0 is the main vertical list, 1 this paragraph: deeper, it is in a box
    local in_box = tex.nest.ptr > 1
    local colors = in_box and save_colors() or nil
    local idx = #all_paragraphs + 1
    local indent, width = para_band()
    local ls, rs = skip_width("leftskip"), skip_width("rightskip")
    all_paragraphs[idx] = {
        index  = idx,
        -- where its text is set: the band less the margin skips' fixed parts
        indent = indent + ls,
        width  = width - ls - rs,
        -- the band itself, which a display inside the paragraph takes
        -- (TeX's \displayindent comes from \parshape alone); not encoded
        band_indent = indent,
        band_width  = width,
        baselineskip  = param_dimen("baselineskip"),
        lineskip      = param_dimen("lineskip"),
        lineskiplimit = param_dimen("lineskiplimit"),
        -- \adjustspacing and \protrudechars as the paragraph builder saw them
        -- (microtype sets both to 2). They select whether the font expansion
        -- and protrusion codes recorded per font (see annotate_fonts) are
        -- applied, and whether inside the breaker or only when a line is set.
        adjust_spacing = tex.adjustspacing or 0,
        protrude_chars = tex.protrudechars or 0,
        align  = para_align(),
        nodes  = serialize_nodelist(head),
    }
    if colors then restore_colors(colors) end
    stamp(head, idx)
    -- The captured copy above already holds every \label marker at its exact
    -- position, so the markers have done their job and are now taken back out
    -- of the list TeX is about to break. They are boxes, and a box interrupts
    -- the run of glyphs LuaTeX hyphenates: leaving one in mid-sentence costs
    -- the surrounding word its hyphenation points and re-breaks the paragraph.
    -- This callback runs before line breaking and before hyphenation, so
    -- removing them here means marking a label changes nothing TeX produces.
    head = strip_anchor_markers(head)
    return head
end

-- ── Pageless main vertical list ───────────────────────────────────────────
-- LuaTeX's page builder cannot be given a genuinely infinite \vsize: every TeX
-- dimension is capped at \maxdimen. Instead, copy each contribution before the
-- page builder consumes it, then zero only the vertical extent of the original
-- top-level nodes. The preserved copy retains TeX's real geometry; the page
-- builder sees a non-empty page whose height never grows, so delayed writes
-- still execute during normal (final or explicitly requested) shipouts.
local flow_head, flow_tail
-- Keep this distinct from the node annotations above: reusing one of theirs
-- can make a contribution look as if it has already been copied when that
-- attribute happens to propagate onto its top-level box. (903 and 904 were
-- the \lrcite citation attributes, now gone; leave them unused a while.)
local FLOW_ATTR = 905

local function append_flow(n)
    n.prev, n.next = flow_tail, nil
    if flow_tail then flow_tail.next = n else flow_head = n end
    flow_tail = n
end

local function capture_flow()
    local head = tex.lists.contrib_head
    if not head then return end

    -- The kernel's spacing macros read back the vertical list's tail:
    -- \addvspace/\addpenalty/\endtrivlist test \lastskip (and \unpenalty can
    -- pop a penalty to reach the glue behind it) to merge an environment's
    -- \topsep with the one the previous environment already contributed –
    -- that is what keeps a lemma→proof boundary at one \topsep, not two.
    -- Zeroing that glue in place makes those reads see 0.0pt, the merge
    -- silently no-ops, and every \addvspace-mediated boundary records its
    -- skip twice. Only the trailing run of discardables (glue/kern/penalty
    -- with no box after them) is reachable this way – \lastbox is illegal in
    -- outer vertical mode, so a box shields everything before it. Keep that
    -- run's dimensions real, and balance the page total with one negative
    -- kern inserted *before* the run: interior, hence unreachable, and
    -- pre-stamped so it never enters the pageless copy.
    local tail = nil
    for n in node.traverse(head) do
        local t = node.type(n.id)
        if t == "glue" or t == "kern" or t == "penalty" then
            if not tail then tail = n end
        else
            tail = nil
        end
    end

    local trailing_sp = 0
    local in_tail = false
    for n in node.traverse(head) do
        -- Held-over material can be offered again after an explicit page break.
        -- Stamp the original so the pageless copy contains every node once.
        if not node.get_attribute(n, FLOW_ATTR) then
            if n.id == WHATSIT_ID and n.subtype == WH_COLORSTACK then
                handle_colorstack(n)       -- see "Colour set between paragraphs"
            end
            append_flow(node.copy(n))
            node.set_attribute(n, FLOW_ATTR, 1)
        end

        if n == tail then in_tail = true end
        -- These are the only top-level node dimensions which advance TeX's
        -- page total. Children remain intact so delayed writes still ship.
        local t = node.type(n.id)
        if in_tail then
            -- Left readable; a later capture finds these interior (a box has
            -- arrived behind them) and zeroes them then. Their real extent is
            -- cancelled by the compensating kern below, so the page total
            -- never sees them either way.
            if t == "glue" then
                trailing_sp = trailing_sp + (n.width or 0)
            elseif t == "kern" then
                trailing_sp = trailing_sp + (n.kern or 0)
            end
        -- A box under a point tall is left as it is: it cannot fill a page,
        -- and packages use such boxes as markers they later recognise by size
        -- – revtex's page grid protects its penalties with a 1986sp box and
        -- repairs its dead cycles by it; zeroed, its \clearpage at the end of
        -- the document never settles and ships empty pages without end.
        elseif (t == "hlist" or t == "vlist" or t == "rule")
               and (n.height or 0) + (n.depth or 0) >= 65536 then
            n.height, n.depth = 0, 0
        elseif t == "glue" then
            n.width, n.stretch, n.shrink = 0, 0, 0
        elseif t == "kern" then
            n.kern = 0
        elseif t == "ins" then
            n.height = 0
        end
    end

    if trailing_sp ~= 0 then
        local k = node.new("kern")
        k.kern = -trailing_sp
        node.set_attribute(k, FLOW_ATTR, 1)
        tex.lists.contrib_head = node.insert_before(head, tail, k)
    end
end

-- ── Flow walk: the ordered content stream ─────────────────────────────────
-- Text is re-breakable and comes from the captures above; displays are taken in
-- their finished form. The encoder may later attach width derivatives recovered
-- from matching several finished trees. Only the vertical-list walk knows the
-- document order of the two, so it produces a stream of references:
--
--   {kind="paragraph", para=N}   → render all_paragraphs[N], re-broken
--   {kind="display",   box=...}  → render the box as-is (see below)
--   {kind="vspace",    amount=sp}
--
-- A display box is emitted as an ordinary serialized hlist, so the renderer
-- draws it through the same hlist path it already uses for inline boxes:
-- TeX's own glue setting is replayed rather than recomputed, which keeps
-- \hfill, \rlap, \mathclap and tabskips faithful to the PDF. TeX's centering
-- lives in the box's shift; the renderer ignores it and re-centres at the
-- reader's width.
--
-- Subtypes we key on (hlist): line=1, alignment=4, equation=6.
local HL_LINE, HL_ALIGNMENT, HL_EQUATION = 1, 4, 6
-- Vertical glue subtype 0 is userskip: the glue \vskip/\vspace/\addvspace insert,
-- and the before/after skips \@startsection puts around a section heading. That
-- is *explicit* spacing the author asked for, and it is preserved. So is
-- parskip (3): the glue TeX adds at every paragraph start is paragraph
-- spacing, not leading – zero in article's running text, but inside a list
-- it is \parsep, and dropping it pulled every item 4pt closer than TeX sets
-- them. Only baselineskip (2) and lineskip (1) are interline leading the
-- renderer re-derives per line, so those are dropped between text paragraphs.
local GLUE_USERSKIP = 0
local GLUE_PARSKIP  = 3
local GLUE_LINESKIP, GLUE_BASELINESKIP = 1, 2
local GLUE_ABOVEDISPLAY, GLUE_BELOWDISPLAY = 4, 5
local GLUE_ABOVEDISPLAYSHORT, GLUE_BELOWDISPLAYSHORT = 6, 7

-- A display's box width is not what it occupies. \[..\] packs at natural
-- width and is centred by its shift, while amsmath centres an alignment by
-- baking glue *inside* the row (so an align* row can report 204.78pt while
-- its ink sits at 140.22..204.78 of a 345pt \displaywidth). The invariant
-- across both is \displaywidth: the display occupies the band
-- [\displayindent, \displayindent+\displaywidth], and TeX has already placed
-- the ink correctly within it. So we record that band and let the renderer
-- centre *it*, preserving everything TeX decided inside.
--
-- \displaywidth itself is long gone by the vertical-list walk, but it does not
-- need to be captured: TeX derives it from the enclosing paragraph's shape (TeX82 §1145
-- – with no \parshape and no \hangindent, \displaywidth = \hsize and
-- \displayindent = 0; otherwise both come from \parshape). Since every
-- paragraph already records its \parshape band, a display simply inherits the
-- band of the paragraph it interrupts.
--
-- Reading the value from append_to_vlist_filter would be the obvious
-- alternative and is a trap: returning a box from that callback makes the
-- callback responsible for the interline glue, so hooking it silently drops
-- every baselineskip TeX would have inserted – it changes the document rather
-- than observing it.

local content   = {}
local seen_para = {}

-- amsmath leaves an empty paragraph behind after an alignment (a zero-content
-- fire that exists only to close the display group). Skip those, but retain a
-- paragraph whose only visible node is a picture: \mypic commonly expands to
-- exactly such a paragraph – or a rule: \noindent\rule{\textwidth}{0.4pt} is
-- a separator. A rule with no width, or no height and depth, is a strut and
-- draws nothing.
local RUNNING = -1073741824
local function inked_rule(n)
    return (n.width or 0) ~= 0
        and ((n.height or 0) ~= 0 or (n.depth or 0) ~= 0 or n.height == RUNNING or n.depth == RUNNING)
end
local function has_visible_nodes(nodes)
    for _, n in ipairs(nodes) do
        if n.type == "glyph" or n.type == "picture" then return true end
        if n.type == "rule" and inked_rule(n) then return true end
        if n.children and has_visible_nodes(n.children) then return true end
        if n.replace and has_visible_nodes(n.replace) then return true end
    end
    return false
end

-- The band of the most recent paragraph; displays inherit it. And its
-- leading, which a fixed box (emit_fixed) is set with.
local cur_band = { indent = 0, width = 0 }
local cur_leading = {}
-- What the flow last stacked – "line", "blank" (a line with no ink: the
-- indent box of a paragraph that opens with a display) or "display" – and
-- the display item the next below-display glue belongs to.
local last_box = nil
local last_display = nil

-- ── Streams ───────────────────────────────────────────────────────────────
-- Every item lands in exactly one content list: the main flow, a footnote's
-- body, or the content of a \begin{webstream} block (reflowtex.sty). The
-- walk carries a context: `out`, the list it is filling, and `base`, the
-- stream id whose nodes belong *directly* in that list – nil for the main
-- flow. A footnote written inside a stream inherits the stream's attribute on
-- all its nodes, so its own walk takes that id as home rather than as a block
-- nested in the footnote.
--
-- A node stamped with any other stream id belongs to that stream, which is
-- opened on first contact: a {kind="stream"} item goes into its parent's list
-- (recursively, so a stream whose parent has not been met yet opens the
-- parent first) at the position of the stream's first item, and the item
-- itself goes into the stream's own content. Document order is preserved on
-- every list, and each stream item appears exactly once.
local function stream_attr(n)
    local v = node.get_attribute(n, STREAM_ATTR)
    if v and v > 0 then return v end
    return nil
end

local function stream_out(ctx, sid)
    if sid == nil or sid == ctx.base then return ctx.out end
    local s = streams[sid]
    if not s then return ctx.out end        -- never noted: treat as unstamped
    if not s.opened then
        s.opened = true
        local parent_out = stream_out(ctx, s.parent)
        parent_out[#parent_out + 1] = { kind = "stream", stream = sid }
    end
    return s.content
end

local function reset_pending(pending)
    pending.sp = 0; pending.explicit = 0; pending.parts = nil
end

-- The vertical glue and kerns between two items, as TeX left them, for a
-- vspace item to carry (its `glue`): what the gap is made of – the author's
-- \vspace, a heading's skip, \parskip, a display's skip – for tools that
-- show it (the inspector). The widths of the parts kept add up to `amount`.
local function note_part(pending, n, t)
    local parts = pending.parts or {}
    pending.parts = parts
    if t == "glue" then
        local g = { type = "glue", subtype = n.subtype, width = n.width }
        if (n.stretch or 0) ~= 0 then g.stretch = n.stretch; g.stretch_order = n.stretch_order end
        if (n.shrink or 0) ~= 0 then g.shrink = n.shrink; g.shrink_order = n.shrink_order end
        parts[#parts + 1] = g
    else
        parts[#parts + 1] = { type = "kern", kern = n.kern, subtype = n.subtype }
    end
end

-- Where vertical space goes. A gap sits between two items, and belongs to the
-- innermost stream holding *both* of them: space between two paragraphs of a
-- box is the box's, space between a box and the text after it is the text's.
-- So the \topsep an environment puts before its first line or after its last
-- lands outside the environment's stream, even though TeX typeset that glue
-- inside the environment's group, and a box can simply open at \begin and end
-- with the group (reflowtex.sty's \DeclareWebBox). Between two panes of an
-- accordion it is the accordion's, where the viewer, laying panes out as
-- alternatives, ignores it.
--
-- ctx.last_sid is the stream of the last paragraph or display emitted (nil:
-- the list the walk is filling). Label anchors do not count as neighbours: a
-- \label at the top of a theorem opens its box ahead of the space before it,
-- and the space still goes before the box.
local function norm_sid(ctx, sid)
    if sid == nil or sid == ctx.base or not streams[sid] then return nil end
    return sid
end
local function stream_chain(ctx, sid)
    local c, seen = {}, {}
    sid = norm_sid(ctx, sid)
    while sid and not seen[sid] do
        c[#c + 1] = sid; seen[sid] = true
        sid = norm_sid(ctx, streams[sid].parent)
    end
    return c
end
local function common_stream(ctx, a, b)
    local in_a = {}
    for _, s in ipairs(stream_chain(ctx, a)) do in_a[s] = true end
    for _, s in ipairs(stream_chain(ctx, b)) do
        if in_a[s] then return s end
    end
    return nil
end
local function only_anchors(list)
    for _, it in ipairs(list) do
        if it.kind ~= "anchorpoint" then return false end
    end
    return true
end
-- `sp` is the full glue, `explicit` only the author's own; after a display the
-- full glue counts (it carries the display's below-skip). As everywhere, a gap
-- before anything at all is dropped. `parts` (note_part) are kept with it:
-- the explicit glue, or after a display all of it. A gap whose explicit glue
-- is all zero – article's \parskip, 0pt plus 1pt – is still an item, of
-- amount 0, so its glue is not lost to a tool that shows it.
local function place_gap(ctx, next_sid, sp, explicit, parts)
    local list = stream_out(ctx, common_stream(ctx, ctx.last_sid, next_sid))
    local pos = #list
    while pos > 0 do
        local it = list[pos]
        if it.kind == "anchorpoint"
                or (it.kind == "stream" and streams[it.stream]
                    and only_anchors(streams[it.stream].content)) then
            pos = pos - 1
        else
            break
        end
    end
    local after_display = ctx.last_kind == "display"
    local amount = after_display and sp or explicit
    local glue = {}
    for _, g in ipairs(parts or {}) do
        if after_display or (g.type == "glue" and (g.subtype == GLUE_USERSKIP or g.subtype == GLUE_PARSKIP)) then
            glue[#glue + 1] = g
        end
    end
    if pos > 0 and ((amount and amount ~= 0) or #glue > 0) then
        table.insert(list, pos + 1, { kind = "vspace", amount = amount or 0,
                                      glue = (#glue > 0) and glue or nil })
    end
end

-- ── What else the vertical list holds ─────────────────────────────────────
-- The walk knows lines of paragraphs, displays, label markers, boxes of lines
-- (vlists, walked into), insertions and spacing. Anything else that draws – a
-- rule set in vertical mode (\hrule, a class's title rules), a box set in
-- vertical mode (\hbox, \@makecaption's \hbox to\hsize) – used to be dropped
-- without a word, and the space it took with it. It is kept as a fixed display
-- instead: the box as TeX set it, at its place, which the viewer draws and
-- scrolls like any display. Losing content silently is the worst failure; a
-- box that does not reflow is a lesser one, and the log counts them.
local fixed_items = 0

-- A fixed box goes into the stream as a display does: the space before it,
-- then the item, placed at its shift from the left of the text.
--
-- Unlike a display it has no skips of its own, but TeX set interline glue
-- above a box (not a rule) from the depth of the line before, and below it
-- for the line after; the lines around it are broken again at another width,
-- so that glue must be redone there. The viewer redoes it for an equation
-- display, from the glue TeX used (display_interline_above/below) and the
-- leading in force – so the box is wrapped in one (hlist subtype 6), with
-- skips of zero, which makes its skip choice a no-op. A pre-display size of
-- -\maxdimen says no empty line stands above it: the depth above is the
-- previous item's own.
local HL_EQUATION_WRAP = 6
local function emit_fixed(n, box, pending, ctx)
    local gap = (pending.sp or 0) + ((last_box == "blank" and pending.blank_sp) or 0)
    place_gap(ctx, stream_attr(n), gap, gap, pending.parts)
    reset_pending(pending)
    pending.blank_sp = nil
    local out = stream_out(ctx, stream_attr(n))
    ctx.last_sid, ctx.last_kind = stream_attr(n), "display"
    out[#out + 1] = {
        kind = "display",
        display_width  = (source_width > 0) and source_width or box.width,
        display_indent = 0,
        display_shift  = n.shift or 0,
        display_pre_size    = -1073741823,
        display_above       = 0, display_above_short = 0,
        display_below       = 0, display_below_short = 0,
        display_used_above  = 0,
        display_interline_above = pending.interline,
        display_baselineskip  = cur_leading.bskip,
        display_lineskip      = cur_leading.lskip,
        display_lineskiplimit = cur_leading.lskiplimit,
        display_after_line  = false,
        box = { type = "hlist", subtype = HL_EQUATION_WRAP, width = box.width, height = box.height,
                depth = box.depth, shift = 0, glue_set = 0, glue_sign = 0, glue_order = 0,
                children = { box } },
    }
    last_display = out[#out]; last_box = "display"
    pending.above_skip = nil; pending.interline = nil
    fixed_items = fixed_items + 1
end

-- The node on its own, serialized (serialize_nodelist walks a whole list, so
-- it is given a copy without neighbours).
local function serialize_one(n)
    local c = node.copy(n)
    local out = serialize_nodelist(c)[1]
    node.flush_node(c)
    return out
end

-- A box that holds lines of a paragraph the stream already has is that text
-- again, packaged: multicols passes its column lines through the main list
-- (the walk emits them as paragraphs) and then its output routine puts the
-- balanced columns back as one \hbox. Kept, the text would show twice.
local function holds_emitted_lines(n)
    for x in node.traverse(n.head) do
        local p = node.get_attribute(x, PARA_ATTR)
        if p and seen_para[p] then return true end
        local t = node.type(x.id)
        if (t == "hlist" or t == "vlist") and x.head and holds_emitted_lines(x) then return true end
    end
    return false
end

local function fixed_box(n, t)
    if t ~= "rule" and holds_emitted_lines(n) then return nil end
    if t == "rule" then
        -- On a vertical list a rule's running width is the enclosing box's:
        -- the text width.
        local w = (n.width == RUNNING) and source_width or n.width
        local rule = { type = "rule", width = w, height = n.height, depth = n.depth, color = current_color }
        if not inked_rule(rule) then return nil end
        return { type = "hlist", subtype = 2, width = w, height = n.height, depth = n.depth,
                 shift = 0, glue_set = 0, glue_sign = 0, glue_order = 0, children = { rule } }
    end
    local s = serialize_one(n)
    if not s or not has_visible_nodes({ s }) then return nil end
    if s.type ~= "hlist" then          -- a picture (a captured TikZ box), or a vlist
        s = { type = "hlist", subtype = 2, width = n.width, height = n.height, depth = n.depth,
              shift = 0, glue_set = 0, glue_sign = 0, glue_order = 0, children = { s } }
    end
    s.shift = 0                        -- on a vertical list shift is horizontal: display_shift below
    return s
end

local function walk_flow(head, pending, ctx)
    ctx = ctx or { out = content, base = nil }
    for n in node.traverse(head) do
        local t = node.type(n.id)
        if (t == "hlist" or t == "vlist") and node.get_attribute(n, ANCHOR_ATTR) then
            -- A \label written straight after \sectioning (the usual place) is
            -- executed in vertical mode, so its marker box joins the vertical
            -- list instead of a paragraph and never reaches serialize_nodelist.
            -- Emit it into the content stream, where it lands between the two
            -- items it was written between – which is exactly the position a
            -- section label is meant to name.
            local out = stream_out(ctx, stream_attr(n))
            out[#out + 1] = { kind = "anchorpoint",
                              anchor = node.get_attribute(n, ANCHOR_ATTR) }
        elseif t == "hlist" and n.subtype == HL_LINE then
            local p = find_para(n)
            last_box = (p and has_visible_nodes(all_paragraphs[p].nodes)) and "line" or "blank"
            -- A blank line (a paragraph with nothing visible) is not an item,
            -- but the space down to it and its own height are real space. If
            -- a display follows – the display opened that empty paragraph, as
            -- \begin{equation} straight after \par does – they belong to the
            -- gap above the display (below). Before anything else the blank
            -- line's space is dropped with it, as ever.
            if last_box == "blank" then
                pending.blank_sp = (pending.blank_sp or 0) + (pending.sp or 0)
                                   + (n.height or 0) + (n.depth or 0)
            else
                pending.blank_sp = nil
            end
            pending.interline = nil
            if p then
                cur_band.indent = all_paragraphs[p].band_indent or all_paragraphs[p].indent
                cur_band.width  = all_paragraphs[p].band_width or all_paragraphs[p].width
                cur_leading = { bskip = all_paragraphs[p].baselineskip, lskip = all_paragraphs[p].lineskip,
                                lskiplimit = all_paragraphs[p].lineskiplimit }
            end
            if p and not seen_para[p] and has_visible_nodes(all_paragraphs[p].nodes) then
                seen_para[p] = true
                -- Abutting a display, keep TeX's full glue: above/belowdisplayskip
                -- carries the display's spacing. Between text paragraphs keep only
                -- explicit vspace: baselineskip leading is re-derived per line, but
                -- a \vspace or a section's before/after skip must survive.
                place_gap(ctx, stream_attr(n), pending.sp, pending.explicit, pending.parts)
                local out = stream_out(ctx, stream_attr(n))
                out[#out + 1] = { kind = "paragraph", para = p }
                ctx.last_sid, ctx.last_kind = stream_attr(n), "paragraph"
            end
            reset_pending(pending)
        elseif t == "hlist" and (n.subtype == HL_EQUATION or n.subtype == HL_ALIGNMENT) then
            local gap = (pending.sp or 0) + ((last_box == "blank" and pending.blank_sp) or 0)
            place_gap(ctx, stream_attr(n), gap, gap, pending.parts)
            reset_pending(pending)
            pending.blank_sp = nil
            local out = stream_out(ctx, stream_attr(n))
            ctx.last_sid, ctx.last_kind = stream_attr(n), "display"
            local note = display_notes[node.get_attribute(n, DISPLAY_ATTR) or -1]
            out[#out + 1] = {
                kind = "display",
                -- The band this display occupies, and where TeX put the box
                -- inside it. display_shift is carried out here rather than on
                -- the box because in a vertical list shift means a horizontal
                -- displacement, whereas the renderer reaches the box through
                -- its hlist path, where shift means a vertical offset –
                -- passing it through would push displays down the page.
                display_width  = cur_band.width > 0 and cur_band.width or n.width,
                display_indent = cur_band.indent,
                display_shift  = n.shift or 0,
                -- What TeX chose this display's skips with (Serializer.note_display),
                -- the above skip it did use (part of the vspace before the display;
                -- display_used_below, set when its glue comes, likewise after), and
                -- whether a set line of a paragraph stood directly before it.
                display_pre_size    = note and note.pre_size,
                display_above       = note and note.above,
                display_above_short = note and note.above_short,
                display_below       = note and note.below,
                display_below_short = note and note.below_short,
                display_used_above  = pending.above_skip,
                display_interline_above = pending.interline,
                display_quad        = note and note.quad,
                display_baselineskip  = note and note.bskip,
                display_lineskip      = note and note.lskip,
                display_lineskiplimit = note and note.lskiplimit,
                display_after_min   = addvspace_min[node.get_attribute(n, DISPLAY_ATTR) or -1],
                -- (-\maxdimen: the display opened an empty paragraph, whatever
                -- the flow holds before it – \noindent$$ after a paragraph)
                display_after_line  = last_box == "line" and (note == nil or note.pre_size > -1073741823),
                box  = {
                    type       = "hlist",
                    subtype    = n.subtype,
                    width      = n.width,
                    height     = n.height,
                    depth      = n.depth,
                    glue_set   = n.glue_set,
                    glue_sign  = n.glue_sign,
                    glue_order = n.glue_order,
                    children   = n.head and serialize_nodelist(n.head) or {},
                },
            }
            last_display = out[#out]; last_box = "display"; pending.above_skip = nil; pending.interline = nil
        elseif t == "whatsit" and n.subtype == WH_DEST and n.named_id == 1 then
            -- a destination between paragraphs (a section's, a \bibitem's): an
            -- anchor point, like a \label's (see "Links and destinations")
            local out = stream_out(ctx, stream_attr(n))
            local item = { kind = "anchorpoint" }
            item.anchor = note_dest(n, out, item)
            out[#out + 1] = item
        elseif t == "vlist" and node.get_attribute(n, TIKZ_PIC_ATTR) then
            -- a captured TikZ picture set in vertical mode: not a vlist of lines
            local box = fixed_box(n, t)
            if box then emit_fixed(n, box, pending, ctx) end
        elseif t == "vlist" then
            walk_flow(n.head, pending, ctx)
        elseif t == "rule" or t == "hlist" then
            -- neither a line nor a display (those are above): see fixed_box
            local box = fixed_box(n, t)
            if box then emit_fixed(n, box, pending, ctx) end
        elseif t == "ins" then
            -- A footnote is not part of the pageless main stream. Retain its
            -- fully typeset paragraphs/displays as a stream of kind "footnote"
            -- and link it to the superscript marker stamped by template.tex
            -- (see remap_footnote_refs). Keeping ContentItems (rather than
            -- flattening text) preserves inline math, colours, citations, and
            -- the ordinary browser reflow machinery.
            -- A \webaside is the same, into the stream it noted: its
            -- insertion's contents fill that stream, which is never opened in
            -- the flow, and is marked aside=true for the viewer.
            local aside = node.get_attribute(n, ASIDE_ATTR)
            local s = aside and aside > 0 and streams[aside] or nil
            local id = node.get_attribute(n, FOOTNOTE_INS_ATTR)
            local fn_content = {}
            local saved_band = { indent = cur_band.indent, width = cur_band.width }
            local saved_last = last_box
            walk_flow(n.head, { sp = 0, explicit = 0 },
                      s and { out = s.content, base = aside }
                        or { out = fn_content, base = stream_attr(n) })
            cur_band = saved_band
            last_box = saved_last
            if s then
                s.attrs[#s.attrs + 1] = { key = "aside", value = "true" }
            else
                streams[#streams + 1] = { kind = "footnote", content = fn_content }
                if id and id > 0 then footnote_index[id] = #streams end
            end
        elseif t == "glue" then
            note_part(pending, n, t)
            pending.sp = (pending.sp or 0) + (n.width or 0)
            if n.subtype == GLUE_ABOVEDISPLAY or n.subtype == GLUE_ABOVEDISPLAYSHORT then
                pending.above_skip = n.width or 0
            elseif (n.subtype == GLUE_BELOWDISPLAY or n.subtype == GLUE_BELOWDISPLAYSHORT) and last_display then
                last_display.display_used_below = n.width or 0
            elseif n.subtype == GLUE_BASELINESKIP or n.subtype == GLUE_LINESKIP then
                -- the interline glue TeX put before a box: the display's own
                -- when it comes next, the next line's after a display
                pending.interline = n.width or 0
                if last_box == "display" and last_display and last_display.display_interline_below == nil then
                    last_display.display_interline_below = n.width or 0
                end
            end
            if n.subtype == GLUE_USERSKIP or n.subtype == GLUE_PARSKIP then
                pending.explicit = (pending.explicit or 0) + (n.width or 0)
            end
        elseif t == "kern" then
            note_part(pending, n, t)
            pending.sp = (pending.sp or 0) + (n.kern or 0)
        end
    end
end

-- Every serialized node of a list, depth first: the one walk over everything a
-- node can hold, so that a pass over the output cannot forget a child list.
local function each_node(nodes, fn)
    for _, n in ipairs(nodes or {}) do
        fn(n)
        each_node(n.children, fn)
        each_node(n.pre, fn); each_node(n.post, fn); each_node(n.replace, fn)
        if n.leader then each_node({ n.leader }, fn) end
    end
end

-- The footnote marker's glyphs were serialized with the template's footnote id
-- (attribute 906); the wire format points them at the footnote's *stream*
-- instead, the same reference a glyph would carry for any other stream kind.
-- A hyperref link's provisional id (negative) becomes its final one.
-- Walked after the flow, when every footnote has its stream index.
local hy_link_ids = {}
local function remap_refs(n)
    if n.footnote then
        local idx = footnote_index[n.footnote]
        n.footnote = nil
        if idx then n.stream = idx end
    end
    if n.link and n.link < 0 then n.link = hy_link_ids[n.link] end
end
local function remap_footnote_refs(nodes)
    each_node(nodes, remap_refs)
end

-- ── Resolving hyperref's links (see "Links and destinations") ──────────────
-- hyperref's destination → the author's label, from \newlabel lines in the
-- .aux (and the .aux files it \@input s): {number}{page}{title}{destination}{…}.
local function aux_dest_labels()
    local map, seen = {}, {}
    local function read(name)
        if seen[name] then return end
        seen[name] = true
        local f = io.open(name, "r")
        if not f then return end
        local text = f:read("*a")
        f:close()
        for label, value in text:gmatch("\\newlabel(%b{})(%b{})") do
            local parts = {}
            for g in value:sub(2, -2):gmatch("%b{}") do parts[#parts + 1] = g:sub(2, -2) end
            local dest = parts[4]
            if dest and dest ~= "" and not map[dest] then map[dest] = label:sub(2, -2) end
        end
        for sub in text:gmatch("\\@input(%b{})") do read(sub:sub(2, -2)) end
    end
    read(tex.jobname .. ".aux")
    return map
end

local function max_id(t)
    local n = 0
    for k in pairs(t) do
        if type(k) == "number" and k > n then n = k end
    end
    return n
end

-- Give the links glyphs carry their final ids, after the template's; keep
-- the destinations some link needs – one anchor per label, and none where a
-- \label's anchor already stands – and take the others out again.
--
-- A link that cannot lead anywhere is dropped (its glyphs stay text): one to
-- a page (hyperref's page.N – a pageless document has no pages; LIPIcs links
-- its page range that way), and one to a destination hyperref named that is
-- not in this document and that no label stands for. A link to an author's
-- label is kept even when the label is not here: another block on the site
-- may define it.
local function resolve_hyperref()
    local dest_label = (#hy_links > 0) and aux_dest_labels() or {}
    local function label_of(name) return clean_label(dest_label[name] or name) end
    local have, here = {}, {}
    for _, l in pairs(anchor_labels) do have[l] = true end
    for _, d in ipairs(hy_dests) do here[d.name] = true end
    local wanted = {}
    local next_link, dropped = max_id(link_labels), 0
    for k, l in ipairs(hy_links) do
        if l.used and l.dest and (l.dest:match("^page%.%d+$")
                                  or not (dest_label[l.dest] or here[l.dest])) then
            dropped = dropped + 1
        elseif l.used then
            next_link = next_link + 1
            hy_link_ids[-k] = next_link
            if l.dest then
                local label = label_of(l.dest)
                link_labels[next_link] = { label = label }
                if not have[label] then wanted[label] = true end
            else
                link_labels[next_link] = { url = l.url }
            end
        end
    end
    local next_anchor = max_id(anchor_labels)
    local kept = 0
    for _, d in ipairs(hy_dests) do
        local label = label_of(d.name)
        if wanted[label] then
            wanted[label] = nil
            next_anchor = next_anchor + 1
            anchor_labels[next_anchor] = label
            d.item.anchor = next_anchor
            kept = kept + 1
        else
            for i = #d.list, 1, -1 do
                if d.list[i] == d.item then table.remove(d.list, i); break end
            end
        end
    end
    local n_links = 0
    for _ in pairs(hy_link_ids) do n_links = n_links + 1 end
    if n_links > 0 or kept > 0 then
        texio.write_nl(string.format("serializer: %d link(s) and %d destination(s) from hyperref", n_links, kept))
    end
    local missing = 0
    for _ in pairs(wanted) do missing = missing + 1 end
    if missing > 0 then
        texio.write_nl(string.format("serializer: %d link target(s) not in this document", missing))
    end
    if dropped > 0 then
        texio.write_nl(string.format("serializer: %d link(s) to a page or to nowhere left as text", dropped))
    end
end

Serializer = Serializer or {}   -- note_picture already added a table above; do not clobber it

-- The pageless main vertical list itself: every top-level node TeX
-- contributed, in order, with its real dimensions, as collected by
-- capture_flow. For tools that want to ship or measure the galley as one
-- continuous column (a reference rendering, say) rather than read the
-- content stream. Complete only once the document has ended.
function Serializer.flow_head()
    return flow_head
end

-- The id-keyed tables (links, anchors, slots) are lists on the wire: an id is
-- its entry's 1-based position. The ids come from counters in template.tex and
-- reflowtex.sty and so run 1..n; a gap (a counter stepped with nothing noted)
-- would otherwise turn the table into a map, which the encoder cannot read,
-- so it is filled with an empty entry, and reported.
local function dense(name, t, blank)
    local n = 0
    for k in pairs(t) do
        if type(k) == "number" and k > n then n = k end
    end
    local out, gaps = json_array({}), 0
    for i = 1, n do
        if t[i] == nil then
            out[i] = blank()
            gaps = gaps + 1
        else
            out[i] = t[i]
        end
    end
    if gaps > 0 then
        texio.write_nl(string.format("serializer: %d gap(s) among the %d %s ids, filled", gaps, n, name))
    end
    return out
end

local function write_output()
    hy_open = {}
    walk_flow(flow_head, { sp = 0, explicit = 0 })
    resolve_hyperref()
    for _, p in ipairs(all_paragraphs) do remap_footnote_refs(p.nodes) end
    -- Streams are written in index order (the ids reflowtex.sty assigned, then
    -- the footnotes in the order their insertions were met); a stream that
    -- ended up empty keeps its slot so the indices stay valid.
    local stream_list = {}
    for i = 1, #streams do
        local s = streams[i]
        for _, it in ipairs(s.content) do
            if it.box then remap_footnote_refs(it.box.children) end
        end
        stream_list[i] = { kind = s.kind, content = s.content, attrs = s.attrs or {}, text = s.text }
    end
    for _, it in ipairs(content) do
        if it.box then remap_footnote_refs(it.box.children) end
    end
    annotate_fonts()
    local f = assert(io.open("output.json", "w"))
    f:write(json_encode({
        source_width = source_width,
        fonts      = json_object(used_fonts),      -- keyed by LuaTeX font id
        paragraphs = json_array(all_paragraphs),
        content    = json_array(content),
        streams    = json_array(stream_list),
        links      = dense("link", link_labels, function() return json_object({}) end),
        anchors    = dense("anchor", anchor_labels, function() return "" end),
        slots      = dense("slot", slot_table, function() return json_object({ name = "" }) end),
        outline    = json_array(outline),
    }))
    f:close()
    local n_disp, n_fn = 0, 0
    for _, it in ipairs(content) do
        if it.kind == "display" then n_disp = n_disp + 1 end
    end
    for _, s in ipairs(stream_list) do
        if s.kind == "footnote" then n_fn = n_fn + 1 end
    end
    if fixed_items > 0 then
        texio.write_nl(string.format("serializer: %d box(es) or rule(s) outside any paragraph kept as fixed displays", fixed_items))
    end
    texio.write_nl(string.format(
        "serializer: wrote output.json (%d paragraph(s), %d item(s) in stream, %d display(s), %d stream(s) of which %d footnote(s))",
        #all_paragraphs, #content, n_disp, #stream_list, n_fn))
end

luatexbase.add_to_callback("pre_linebreak_filter",   capture_paragraph, "capture_paragraph")
-- (exclusive in luatexbase: another package's own conversion keeps its place
-- and the display leading is then not recorded; the viewer falls back)
pcall(luatexbase.add_to_callback, "mlist_to_hlist", note_display_leading, "note_display_leading")
luatexbase.add_to_callback("buildpage_filter",       capture_flow,      "capture_flow")
luatexbase.add_to_callback("finish_pdffile",         write_output,       "write_output")
