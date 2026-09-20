-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Line-break fixture capture.
--
-- Hooked into a normal lualatex run of a test document.  For every
-- paragraph the engine breaks, writes:
--   par-NNNN.txt       the exact input of ext_do_line_break: all parameters
--                      + the node list as seen by pre_linebreak_filter
--   par-NNNN.expected  the node list produced by the built-in breaker, as
--                      seen by post_linebreak_filter, plus resulting state
--
-- A breaker under test re-serializes its result in the same canonical
-- format; the files must match byte-for-byte.  See README.md.
--
-- Usage:  lualatex '\directlua{dofile("capture.lua")}\input{testmath.tex}'
-- Output dir: $REFLOWTEX_FIXDIR or ./fixtures

local fixdir = os.getenv("REFLOWTEX_FIXDIR") or "fixtures"
lfs.mkdir(fixdir)

local parno = 0
local pending -- input captured at pre_linebreak, awaiting the post capture

local DIRNUM = { TLT = 0, TRT = 1, LTL = 2, RTT = 3 }

local function dirnum(d)
  if type(d) == "number" then return d end
  if not d then return 0 end
  local s = d:gsub("[+-]", "")
  return DIRNUM[s] or 0
end

local function int(v)
  -- engine metrics are integer sp; luaotfload tables may hold floats
  return math.floor((v or 0) + 0.5)
end

local function fmt_glue_set(v)
  -- exact double bits, endian-independent
  local bits = string.unpack("<I8", string.pack("<d", v or 0))
  return string.format("%016x", bits)
end

-- ── canonical node-list serializer ─────────────────────────────────────────

local function ser_list(out, head)
  for n, id in node.traverse(head) do
    local t = node.type(id)
    if t == "glyph" then
      out[#out+1] = string.format("glyph %d %d %d", n.subtype or 0, n.font, n.char)
    elseif t == "glue" then
      out[#out+1] = string.format("glue %d %d %d %d %d %d", n.subtype or 0,
        n.width or 0, n.stretch or 0, n.stretch_order or 0,
        n.shrink or 0, n.shrink_order or 0)
    elseif t == "kern" then
      out[#out+1] = string.format("kern %d %d", n.subtype or 0, n.kern or 0)
    elseif t == "penalty" then
      out[#out+1] = string.format("penalty %d %d", n.subtype or 0, n.penalty or 0)
    elseif t == "disc" then
      out[#out+1] = string.format("disc %d %d", n.subtype or 0, n.penalty or 0)
      out[#out+1] = "(pre"
      ser_list(out, n.pre)
      out[#out+1] = ")"
      out[#out+1] = "(post"
      ser_list(out, n.post)
      out[#out+1] = ")"
      out[#out+1] = "(rep"
      ser_list(out, n.replace)
      out[#out+1] = ")"
    elseif t == "hlist" or t == "vlist" then
      out[#out+1] = string.format("%s %d %d %d %d %d %s %d %d %d", t,
        n.subtype or 0, n.width or 0, n.height or 0, n.depth or 0,
        n.shift or 0, fmt_glue_set(n.glue_set),
        n.glue_sign or 0, n.glue_order or 0, dirnum(n.dir))
      out[#out+1] = "("
      ser_list(out, n.list)
      out[#out+1] = ")"
    elseif t == "rule" then
      out[#out+1] = string.format("rule %d %d %d %d %d", n.subtype or 0,
        n.width or 0, n.height or 0, n.depth or 0, dirnum(n.dir))
    elseif t == "math" then
      out[#out+1] = string.format("math %d %d %d %d %d %d %d", n.subtype or 0,
        n.surround or 0, n.width or 0, n.stretch or 0, n.stretch_order or 0,
        n.shrink or 0, n.shrink_order or 0)
    elseif t == "local_par" then
      out[#out+1] = string.format("localpar %d", dirnum(n.dir))
    elseif t == "dir" then
      local sign = (n.dir:sub(1, 1) == "-") and 1 or 0
      out[#out+1] = string.format("dir %d %d %d %d", n.subtype or 0,
        dirnum(n.dir), sign, n.level or 0)
    elseif t == "margin_kern" then
      local g = n.glyph
      out[#out+1] = string.format("marginkern %d %d %d %d", n.subtype or 0,
        n.width or 0, g and g.font or -1, g and g.char or -1)
    elseif t == "boundary" then
      out[#out+1] = string.format("boundary %d %d", n.subtype or 0, n.value or 0)
    elseif t == "whatsit" then
      out[#out+1] = string.format("whatsit %d", n.subtype or 0)
    elseif t == "ins" then
      out[#out+1] = string.format("ins %d %d %d %d", n.subtype or 0,
        n.cost or 0, n.height or 0, n.depth or 0)
    elseif t == "mark" then
      out[#out+1] = string.format("mark %d %d", n.subtype or 0, n.class or 0)
    else
      out[#out+1] = string.format("OTHER %s %d", t, n.subtype or 0)
    end
  end
end

-- ── font metric collection (only chars that occur in this paragraph) ───────

local function collect_chars(used, head)
  for n, id in node.traverse(head) do
    local t = node.type(id)
    if t == "glyph" then
      used[n.font] = used[n.font] or {}
      used[n.font][n.char] = true
    elseif t == "disc" then
      collect_chars(used, n.pre)
      collect_chars(used, n.post)
      collect_chars(used, n.replace)
    elseif t == "hlist" or t == "vlist" then
      collect_chars(used, n.list)
    elseif t == "margin_kern" and n.glyph then
      used[n.glyph.font] = used[n.glyph.font] or {}
      used[n.glyph.font][n.glyph.char] = true
    end
  end
end

local function ser_fonts(out, used)
  local fids = {}
  for f in pairs(used) do fids[#fids+1] = f end
  table.sort(fids)
  for _, f in ipairs(fids) do
    local fnt = font.getfont(f) or font.fonts[f]
    local chars = fnt and fnt.characters or {}
    out[#out+1] = string.format("F %d", f)
    local cs = {}
    for c in pairs(used[f]) do cs[#cs+1] = c end
    table.sort(cs)
    for _, c in ipairs(cs) do
      local ch = chars[c]
      if ch then
        out[#out+1] = string.format("C %d %d %d %d %d", f, c,
          int(ch.width), int(ch.height), int(ch.depth))
      else
        out[#out+1] = string.format("C %d %d 0 0 0 MISSING", f, c)
      end
    end
  end
end

-- ── glue parameter serialization ───────────────────────────────────────────

local function ser_skip(out, name, sk)
  out[#out+1] = string.format("G %s %d %d %d %d %d", name,
    sk.width or 0, sk.stretch or 0, sk.stretch_order or 0,
    sk.shrink or 0, sk.shrink_order or 0)
end

local function ser_penalties(out, name, t)
  -- \interlinepenalties-style arrays; nil when unset
  if t and #t > 0 then
    local parts = {}
    for i = 1, #t do parts[#parts+1] = tostring(t[i]) end
    out[#out+1] = string.format("A %s %d %s", name, #t, table.concat(parts, " "))
  else
    out[#out+1] = string.format("A %s 0", name)
  end
end

-- ── the callbacks ──────────────────────────────────────────────────────────

local function capture_input(head, context)
  parno = parno + 1
  local out = {}
  local enclosing = tex.nest[tex.nest.ptr - 1]
  out[#out+1] = "REFLOWTEX-LINEBREAK-FIXTURE 1"
  out[#out+1] = "CONTEXT " .. tostring(context)
  out[#out+1] = "P pretolerance "  .. tex.pretolerance
  out[#out+1] = "P tolerance "     .. tex.tolerance
  out[#out+1] = "P looseness "     .. tex.looseness
  out[#out+1] = "P adjustspacing " .. (tex.adjustspacing or 0)
  out[#out+1] = "P adjdemerits "   .. tex.adjdemerits
  out[#out+1] = "P protrudechars " .. (tex.protrudechars or 0)
  out[#out+1] = "P linepenalty "   .. tex.linepenalty
  out[#out+1] = "P lastlinefit "   .. (tex.lastlinefit or 0)
  out[#out+1] = "P doublehyphendemerits " .. tex.doublehyphendemerits
  out[#out+1] = "P finalhyphendemerits "  .. tex.finalhyphendemerits
  out[#out+1] = "P hangindent "    .. tex.hangindent
  out[#out+1] = "P hsize "         .. tex.hsize
  out[#out+1] = "P hangafter "     .. tex.hangafter
  out[#out+1] = "P interlinepenalty " .. tex.interlinepenalty
  out[#out+1] = "P clubpenalty "   .. tex.clubpenalty
  out[#out+1] = "P widowpenalty "  .. tex.widowpenalty
  out[#out+1] = "P displaywidowpenalty " .. tex.displaywidowpenalty
  out[#out+1] = "P brokenpenalty " .. tex.brokenpenalty
  out[#out+1] = "P emergencystretch " .. tex.emergencystretch
  out[#out+1] = "P hbadness "       .. tex.hbadness
  out[#out+1] = "P hfuzz "          .. tex.hfuzz
  out[#out+1] = "P overfullrule "   .. tex.overfullrule
  out[#out+1] = "P tracingparagraphs " .. tex.tracingparagraphs
  out[#out+1] = "P lineskiplimit " .. tex.lineskiplimit
  out[#out+1] = "P prevgraf "      .. (enclosing and enclosing.prevgraf or 0)
  out[#out+1] = "P prevdepth "     .. (enclosing and enclosing.prevdepth or -65536000)
  out[#out+1] = "P bodydirection " .. dirnum(tex.bodydir or "TLT")
  ser_skip(out, "leftskip", tex.leftskip)
  ser_skip(out, "rightskip", tex.rightskip)
  ser_skip(out, "parfillskip", tex.parfillskip)
  ser_skip(out, "baselineskip", tex.baselineskip)
  ser_skip(out, "lineskip", tex.lineskip)
  ser_penalties(out, "interlinepenalties", tex.interlinepenalties)
  ser_penalties(out, "clubpenalties", tex.clubpenalties)
  ser_penalties(out, "widowpenalties", tex.widowpenalties)
  ser_penalties(out, "displaywidowpenalties", tex.displaywidowpenalties)
  local ps = tex.parshape
  if ps and #ps > 0 then
    local parts = {}
    for i = 1, #ps do
      parts[#parts+1] = string.format("%d %d", ps[i][1], ps[i][2])
    end
    out[#out+1] = string.format("SHAPE %d %s", #ps, table.concat(parts, " "))
  else
    out[#out+1] = "SHAPE 0"
  end
  local used = {}
  collect_chars(used, head)
  ser_fonts(out, used)
  out[#out+1] = "NODES"
  ser_list(out, head)
  out[#out+1] = "END"
  pending = { no = parno, input = table.concat(out, "\n") .. "\n" }
  local f = io.open(string.format("%s/par-%04d.txt", fixdir, parno), "wb")
  f:write(pending.input)
  f:close()
  return true
end

local function capture_output(head, context)
  if not pending then return true end
  local out = {}
  out[#out+1] = "REFLOWTEX-LINEBREAK-RESULT 1"
  out[#out+1] = "NODES"
  ser_list(out, head)
  out[#out+1] = "END"
  local enclosing = tex.nest[tex.nest.ptr]
  out[#out+1] = "STATE prevdepth " .. (enclosing and enclosing.prevdepth or 0)
  out[#out+1] = "STATE prevgraf "  .. (enclosing and enclosing.prevgraf or 0)
  local f = io.open(string.format("%s/par-%04d.expected", fixdir, pending.no), "wb")
  f:write(table.concat(out, "\n") .. "\n")
  f:close()
  pending = nil
  return true
end

luatexbase.add_to_callback("pre_linebreak_filter", capture_input, "reflowtex.capture_input")
luatexbase.add_to_callback("post_linebreak_filter", capture_output, "reflowtex.capture_output")

texio.write_nl("term and log", "[reflowtex capture active: " .. fixdir .. "]")
