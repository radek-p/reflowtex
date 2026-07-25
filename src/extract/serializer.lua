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
-- An externalised tikzpicture arrives as a rule node of subtype 2 (an image)
-- carrying TeX's own width/height/depth. The node cannot name its own file,
-- so template.tex stamps attribute 902 on it and records the id → filename
-- here; the two are joined when the node is serialized. prebuild.py then
-- converts each PDF to SVG.

local PIC_ATTR    = 902
local CITE_ATTR   = 903   -- glyphs of a citation number \lrcite{...}
local CITETGT_ATTR = 904  -- glyphs of a bibliography label [n]
local RULE_IMAGE  = 2
local picture_files = {}

Serializer = Serializer or {}
function Serializer.note_picture(id, file)
    picture_files[id] = file
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
            -- An externalised picture. Keep TeX's metrics — they are what lets
            -- the picture behave as an ordinary box everywhere — and carry the
            -- source file across for prebuild.py to turn into SVG.
            local id = node.get_attribute(n, PIC_ATTR)
            cur[#cur + 1] = {
                type   = "picture",
                width  = n.width,
                height = n.height,
                depth  = n.depth,
                file   = id and picture_files[id] or nil,
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
        align  = para_align(),
        nodes  = serialize_nodelist(head),
    }
    stamp(head, idx)
    return head
end

-- ── Shipout walk: the ordered content stream ──────────────────────────────
-- Text is re-breakable and comes from the captures above; displays are rigid
-- and must be taken in their finished form. Only the page walk knows the
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
-- \displaywidth itself is long gone by shipout, but it does not need to be
-- captured: TeX derives it from the enclosing paragraph's shape (TeX82 §1145
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
local seen_para = {}

-- amsmath leaves an empty paragraph behind after an alignment (a zero-content
-- fire that exists only to close the display group). It has no glyphs, so it
-- would render as an empty line; skip such paragraphs entirely.
local function has_glyphs(nodes)
    for _, n in ipairs(nodes) do
        if n.type == "glyph" then return true end
        if n.children and has_glyphs(n.children) then return true end
        if n.replace and has_glyphs(n.replace) then return true end
    end
    return false
end

local function emit_vspace(sp)
    if sp and sp ~= 0 and #content > 0 then
        content[#content + 1] = { kind = "vspace", amount = sp }
    end
end

-- The band of the most recent paragraph; displays inherit it.
local cur_band = { indent = 0, width = 0 }

local function walk_page(head, pending)
    for n in node.traverse(head) do
        local t = node.type(n.id)
        if t == "hlist" and n.subtype == HL_LINE then
            local p = find_para(n)
            if p then
                cur_band.indent = all_paragraphs[p].indent
                cur_band.width  = all_paragraphs[p].width
            end
            if p and not seen_para[p] and has_glyphs(all_paragraphs[p].nodes) then
                seen_para[p] = true
                if not pending.body_seen then
                    -- First body line on this page: the glue above it is page
                    -- furniture — the top margin, the running header, and \headsep —
                    -- which TeX discards at the top of a page. We shipout-walk whole
                    -- pages and concatenate them, so discard it here too; otherwise
                    -- it surfaces as a ~40pt gap at every page break in the reflowed
                    -- output (16pt top margin + 25pt \headsep, say).
                    pending.body_seen = true
                    -- One exception: if the previous page ended with a display, its
                    -- \belowdisplayskip was discarded at the break along with the
                    -- furniture. In the reflowed (pageless) output the display and
                    -- this paragraph are adjacent, so restore that skip — TeX's own
                    -- parameter, not a guessed constant — or they abut too tightly.
                    if content[#content] and content[#content].kind == "display" then
                        emit_vspace(content[#content].below_skip or 0)
                    end
                elseif content[#content] and content[#content].kind == "display" then
                    -- Abutting a display, keep TeX's full glue: above/belowdisplayskip
                    -- carries the display's spacing.
                    emit_vspace(pending.sp)
                else
                    -- Between text paragraphs keep only explicit vspace: baselineskip
                    -- leading is re-derived per line, but a \vspace or a section's
                    -- before/after skip must survive.
                    emit_vspace(pending.explicit)
                end
                content[#content + 1] = { kind = "paragraph", para = p }
            end
            pending.sp = 0
            pending.explicit = 0
        elseif t == "hlist" and (n.subtype == HL_EQUATION or n.subtype == HL_ALIGNMENT) then
            if pending.body_seen then
                emit_vspace(pending.sp)
            elseif content[#content] and content[#content].kind == "paragraph" then
                -- Display first on a page after a paragraph on the previous page:
                -- its \abovedisplayskip was discarded with the furniture at the
                -- break. Restore it (the symmetric case to belowdisplayskip above).
                emit_vspace(param_dimen("abovedisplayskip"))
            elseif content[#content] and content[#content].kind == "display" then
                -- Two displays split by a page break (no glyph-bearing paragraph
                -- between them, so they are adjacent in the stream). In continuous
                -- flow TeX separates them by \belowdisplayskip + \abovedisplayskip;
                -- both were discarded at the break (one as the page-bottom breakpoint
                -- glue, the other as top-of-page furniture), so without this the two
                -- displays abut. Restore the pair so the join matches unbroken flow.
                emit_vspace((content[#content].below_skip or 0) + param_dimen("abovedisplayskip"))
            end
            pending.body_seen = true
            pending.sp = 0
            pending.explicit = 0
            content[#content + 1] = {
                kind = "display",
                -- \belowdisplayskip in force here, so a page break that discards it
                -- (see the paragraph branch) can restore TeX's own value.
                below_skip = param_dimen("belowdisplayskip"),
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
            walk_page(n.head, pending)
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

function Serializer.shipout(boxnum)
    local b = tex.box[boxnum]
    if not b then
        texio.write_nl("serializer: shipout box " .. tostring(boxnum) .. " is nil")
        return
    end
    walk_page(b.head, { sp = 0, explicit = 0, body_seen = false })
end

local function write_output()
    local f = assert(io.open("output.json", "w"))
    f:write(json_encode({
        fonts      = used_fonts,
        paragraphs = all_paragraphs,
        content    = content,
    }))
    f:close()
    local n_disp = 0
    for _, it in ipairs(content) do
        if it.kind == "display" then n_disp = n_disp + 1 end
    end
    texio.write_nl(string.format(
        "serializer: wrote output.json (%d paragraph(s), %d item(s) in stream, %d display(s))",
        #all_paragraphs, #content, n_disp))
end

luatexbase.add_to_callback("pre_linebreak_filter",   capture_paragraph, "capture_paragraph")
luatexbase.add_to_callback("finish_pdffile",         write_output,       "write_output")
