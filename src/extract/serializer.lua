-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Experiment 07: JSON export with math support
--
-- Extends experiment 04's serializer with:
--   - hlist/vlist nodes now recurse into children and include `shift`
--   - math open/close nodes are included with their `surround` field
--   - a `fonts` table maps font ID → {name, size_sp, filename}
--     so the renderer can load the right OTF file at the right size

-- ── JSON encoder (unchanged from experiment 04) ───────────────────────────

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
        local count = 0
        for _ in pairs(val) do count = count + 1 end
        local is_array = (count == #val)
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
local color_stack   = {}
local current_color = nil

local function handle_colorstack(n)
    if n.command == 1 then          -- push
        color_stack[#color_stack + 1] = current_color or false
        current_color = parse_pdf_color(n.data)
    elseif n.command == 2 then      -- pop
        local top = color_stack[#color_stack]
        if #color_stack > 0 then color_stack[#color_stack] = nil end
        current_color = top or nil
    elseif n.command == 0 then      -- set
        current_color = parse_pdf_color(n.data)
    end
end

-- ── Pictures ──────────────────────────────────────────────────────────────
-- Ordinary \includegraphics images arrive as subtype-2 rule nodes; captured
-- TikZ drawings arrive as empty hboxes with the same metrics as the original.
-- Neither node can name its source, so template.tex stamps a document-local id
-- and records the corresponding PDF/page metadata here.

local PIC_ATTR    = 902
local CITE_ATTR   = 903   -- glyphs of a citation number \lrcite{...}
local CITETGT_ATTR = 904  -- glyphs of a bibliography label [n]
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
local RULE_IMAGE  = 2
local picture_files = {}
local source_width = 0
-- id → the label a reference points at / the label defined at a marker. Both are
-- document-local ids; the names only have to be resolved by whoever knows how
-- this document is published, which is not us.
local link_labels  = {}
local anchor_labels = {}

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
function Serializer.note_label(id, label)
    anchor_labels[id] = clean_label(label)
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
-- leave the box tree alone and emit three whatsits around the content —
-- pdf_save, pdf_setmatrix, pdf_restore — while adjusting the *enclosing* box
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

local function parse_matrix(data)
    if not data then return nil end
    local a, b, c, d = data:match("^%s*(%-?[%d%.]+)%s+(%-?[%d%.]+)%s+(%-?[%d%.]+)%s+(%-?[%d%.]+)")
    if not a then return nil end
    return { a = tonumber(a), b = tonumber(b), c = tonumber(c), d = tonumber(d) }
end

-- ── Node serializer ───────────────────────────────────────────────────────

local function serialize_nodelist(head)
    local result = {}
    -- `cur` is the list being appended to: a pdf_save opens a frame that
    -- collects nodes until its pdf_restore, at which point the frame becomes
    -- a transform node (if a matrix was set) or is spliced back in flat (if
    -- not — plenty of saves carry no matrix at all).
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

        elseif t == "whatsit" and n.stack ~= nil and n.command ~= nil then
            -- pdf_colorstack whatsit: update colour state; nothing to emit
            -- (the resolved colour is baked into glyph/rule nodes).
            handle_colorstack(n)

        elseif t == "glyph" then
            note_font(n.font)
            note_char(n.font, n.char)
            local fdata = font.getfont(n.font)
            local cinfo = fdata and fdata.characters and fdata.characters[n.char]
            cur[#cur + 1] = {
                type   = "glyph",
                char   = n.char,
                gindex = cinfo and cinfo.index or nil,
                font   = n.font,
                width  = n.width,
                height = n.height,
                depth  = n.depth,
                color  = current_color,
                -- Citation wiring: `cite` on a \lrcite number, `citetarget` on a
                -- bibliography [n] label. The browser links the two.
                cite       = node.get_attribute(n, CITE_ATTR),
                citetarget = node.get_attribute(n, CITETGT_ATTR),
                footnote   = node.get_attribute(n, FOOTNOTE_MARK_ATTR),
                link       = node.get_attribute(n, LINK_ATTR),
            }

        elseif t == "glue" then
            local g = {
                type         = "glue",
                width        = n.width,
                stretch      = n.stretch,
                shrink       = n.shrink,
                stretch_order = n.stretch_order,
                shrink_order  = n.shrink_order,
                subtype      = n.subtype,
            }
            -- Leader glue (\leaders, \cleaders, \xleaders, \gleaders) carries a
            -- box that TeX tiles across the glue's *set* width instead of
            -- leaving blank space. Extensible arrows are built this way:
            -- \xrightarrow is an arrow tail, a \cleaders run of en-dashes, and
            -- an arrowhead — so dropping the leader silently deletes the middle
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
            -- An included or externally supplied picture. Keep TeX's metrics —
            -- they are what lets the picture behave as an ordinary box
            -- everywhere — and carry the source file into the encode stage.
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
                -- kind is needed — it is an ordinary box that happens to be
                -- empty, and it draws and advances nothing either way.
                anchor     = node.get_attribute(n, ANCHOR_ATTR),
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
-- callback, so they stay unstamped — that is exactly how the walk tells text
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
-- is {indent, linewidth} — so an item at depth 1 reports {25pt, 320pt} of a
-- 345pt \hsize. The indent must be recorded here, while the paragraph is
-- being broken, and is an absolute typographic measure (\leftmargin), so the
-- renderer keeps it fixed and narrows the text column rather than scaling it.
-- Without it, item text starts at x=0 and the label — which hangs a fixed
-- distance to the *left* of the text — lands at negative x and is clipped.
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

local function capture_paragraph(head, groupcode)
    local idx = #all_paragraphs + 1
    local indent, width = para_band()
    all_paragraphs[idx] = {
        index  = idx,
        indent = indent,
        width  = width,
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
-- Keep this distinct from the public node annotations above. In particular,
-- 904 belongs to bibliography targets; reusing it here can make a contribution
-- look as if it has already been copied when an attribute happens to propagate
-- onto its top-level box.
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
    -- \topsep with the one the previous environment already contributed —
    -- that is what keeps a lemma→proof boundary at one \topsep, not two.
    -- Zeroing that glue in place makes those reads see 0.0pt, the merge
    -- silently no-ops, and every \addvspace-mediated boundary records its
    -- skip twice. Only the trailing run of discardables (glue/kern/penalty
    -- with no box after them) is reachable this way — \lastbox is illegal in
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
        elseif t == "hlist" or t == "vlist" or t == "rule" then
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
-- is *explicit* spacing the author asked for, and it is preserved. Every other
-- subtype here (baselineskip=2, lineskip=1, parskip=3) is interline leading the
-- renderer re-derives per line, so it is dropped between text paragraphs.
local GLUE_USERSKIP = 0

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
-- — with no \parshape and no \hangindent, \displaywidth = \hsize and
-- \displayindent = 0; otherwise both come from \parshape). Since every
-- paragraph already records its \parshape band, a display simply inherits the
-- band of the paragraph it interrupts.
--
-- Reading the value from append_to_vlist_filter would be the obvious
-- alternative and is a trap: returning a box from that callback makes the
-- callback responsible for the interline glue, so hooking it silently drops
-- every baselineskip TeX would have inserted — it changes the document rather
-- than observing it.

local content   = {}
local footnotes = {}
local seen_para = {}

-- amsmath leaves an empty paragraph behind after an alignment (a zero-content
-- fire that exists only to close the display group). Skip those, but retain a
-- paragraph whose only visible node is a picture: \mypic commonly expands to
-- exactly such a paragraph.
local function has_visible_nodes(nodes)
    for _, n in ipairs(nodes) do
        if n.type == "glyph" or n.type == "picture" then return true end
        if n.children and has_visible_nodes(n.children) then return true end
        if n.replace and has_visible_nodes(n.replace) then return true end
    end
    return false
end

local function emit_vspace(out, sp)
    if sp and sp ~= 0 and #out > 0 then
        out[#out + 1] = { kind = "vspace", amount = sp }
    end
end

-- The band of the most recent paragraph; displays inherit it.
local cur_band = { indent = 0, width = 0 }

local function walk_flow(head, pending, out)
    out = out or content
    for n in node.traverse(head) do
        local t = node.type(n.id)
        if (t == "hlist" or t == "vlist") and node.get_attribute(n, ANCHOR_ATTR) then
            -- A \label written straight after \sectioning (the usual place) is
            -- executed in vertical mode, so its marker box joins the vertical
            -- list instead of a paragraph and never reaches serialize_nodelist.
            -- Emit it into the content stream, where it lands between the two
            -- items it was written between — which is exactly the position a
            -- section label is meant to name.
            out[#out + 1] = { kind = "anchorpoint",
                              anchor = node.get_attribute(n, ANCHOR_ATTR) }
        elseif t == "hlist" and n.subtype == HL_LINE then
            local p = find_para(n)
            if p then
                cur_band.indent = all_paragraphs[p].indent
                cur_band.width  = all_paragraphs[p].width
            end
            if p and not seen_para[p] and has_visible_nodes(all_paragraphs[p].nodes) then
                seen_para[p] = true
                if out[#out] and out[#out].kind == "display" then
                    -- Abutting a display, keep TeX's full glue: above/belowdisplayskip
                    -- carries the display's spacing.
                    emit_vspace(out, pending.sp)
                else
                    -- Between text paragraphs keep only explicit vspace: baselineskip
                    -- leading is re-derived per line, but a \vspace or a section's
                    -- before/after skip must survive.
                    emit_vspace(out, pending.explicit)
                end
                out[#out + 1] = { kind = "paragraph", para = p }
            end
            pending.sp = 0
            pending.explicit = 0
        elseif t == "hlist" and (n.subtype == HL_EQUATION or n.subtype == HL_ALIGNMENT) then
            emit_vspace(out, pending.sp)
            pending.sp = 0
            pending.explicit = 0
            out[#out + 1] = {
                kind = "display",
                -- The band this display occupies, and where TeX put the box
                -- inside it. display_shift is carried out here rather than on
                -- the box because in a vertical list shift means a horizontal
                -- displacement, whereas the renderer reaches the box through
                -- its hlist path, where shift means a vertical offset —
                -- passing it through would push displays down the page.
                display_width  = cur_band.width > 0 and cur_band.width or n.width,
                display_indent = cur_band.indent,
                display_shift  = n.shift or 0,
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
        elseif t == "vlist" then
            walk_flow(n.head, pending, out)
        elseif t == "ins" then
            -- A footnote is not part of the pageless main stream. Retain its
            -- fully typeset paragraphs/displays in a separate stream and link
            -- it to the superscript marker stamped by template.tex. Keeping
            -- ContentItems (rather than flattening text) preserves inline math,
            -- colours, citations, and the ordinary browser reflow machinery.
            local id = node.get_attribute(n, FOOTNOTE_INS_ATTR)
            if not id or id == 0 then id = #footnotes + 1 end
            local fn_content = {}
            local saved_band = { indent = cur_band.indent, width = cur_band.width }
            walk_flow(n.head, { sp = 0, explicit = 0 }, fn_content)
            cur_band = saved_band
            footnotes[#footnotes + 1] = { id = id, content = fn_content }
        elseif t == "glue" then
            pending.sp = (pending.sp or 0) + (n.width or 0)
            if n.subtype == GLUE_USERSKIP then
                pending.explicit = (pending.explicit or 0) + (n.width or 0)
            end
        elseif t == "kern" then
            pending.sp = (pending.sp or 0) + (n.kern or 0)
        end
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

local function write_output()
    walk_flow(flow_head, { sp = 0, explicit = 0 })
    annotate_fonts()
    local f = assert(io.open("output.json", "w"))
    f:write(json_encode({
        source_width = source_width,
        fonts      = used_fonts,
        paragraphs = all_paragraphs,
        content    = content,
        footnotes  = footnotes,
        links      = link_labels,
        anchors    = anchor_labels,
    }))
    f:close()
    local n_disp = 0
    for _, it in ipairs(content) do
        if it.kind == "display" then n_disp = n_disp + 1 end
    end
    texio.write_nl(string.format(
        "serializer: wrote output.json (%d paragraph(s), %d item(s) in stream, %d display(s), %d footnote(s))",
        #all_paragraphs, #content, n_disp, #footnotes))
end

luatexbase.add_to_callback("pre_linebreak_filter",   capture_paragraph, "capture_paragraph")
luatexbase.add_to_callback("buildpage_filter",       capture_flow,      "capture_flow")
luatexbase.add_to_callback("finish_pdffile",         write_output,       "write_output")
