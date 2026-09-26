---
title: HTML widgets
weight: 49
latexTitle: true
---

{{< latex preamble="webfirst" >}}
\pagetitle[Companion package]{HTML widgets}
\bigskip
\cs{webwidget} reserves a place in the text for the page's own HTML, such
as a status badge or a small control. The widget reports its size and where
it may be split, much like the hyphenation points of a word. The line
breaker then decides, together with the rest of the paragraph, whether and
where to split it; in a narrow column it may run over several lines. The
widget draws each part and marks the cut ends. In print it takes no space
unless it has a default:
\verb|\webwidget[|\emph{default}\verb|]{|\emph{name}\verb|}|.
Drag the edge of the result to see the badge split.
{{< /latex >}}

{{< latex preamble="webfirst" show-source="true" >}}
The sum of the first $n$ odd numbers is $n^2$ \webwidget{lean:sum_odd}.
The badge shows whether the Lean proof assistant has checked this. When
its status changes, the paragraph is broken again around it.
{{< /latex >}}

The page registers the widget. In outline (the page's source has the full
menu):

```js
reflowtex.host.define('lean', {           // \webwidget{lean:sum_odd}: kind lean, key sum_odd
  measure(instance, env) {  // the badge as segments, with a break point between each two
    const { segs, gaps } = segment(label());       // at spaces, and after . and _
    return {
      segments: segs.map(t => env.measure(text(t))),
      gaps: gaps.map(g => ({ width: g.space ? space : 0, penalty: g.space ? 100 : 300 })),
      ends: { left:  { cap: pad, cut: cutPad, overhang: 3.75 },    // closed and cut ends
              right: { cap: pad + chevron, cut: cutPad, overhang: 3.75 } },
    };
  },
  render(instance, host) {  // host.piece: { from, to, left: 'cap' | 'cut', right: 'cap' | 'cut' }
    const { from, to, left, right } = host.piece;
    host.el.innerHTML = badge(textOf(from, to), left, right);
    host.el.querySelector('button')?.addEventListener('click', e => openMenu(e.currentTarget, host.env));
  },
});
// The menu's "Show the declaration" changes the label, then env.invalidate():
// the badge is measured again and the paragraph broken again around it.
```

<style>
  /* The badge: a pill on the text's baseline, the chevron a segment of its own. */
  .lean-badge { position: relative; display: inline-flex; align-items: center; white-space: nowrap;
    border-radius: calc(.8em - 1px); overflow: hidden; cursor: default;
    font: 600 .6em/1.75 ui-sans-serif, system-ui, sans-serif; letter-spacing: .01em;
    background: var(--lt-primary); color: #fff; transition: background-color .15s ease; }
  html.dark .lean-badge { color: #0c0a09; }
  .lean-badge .t { padding: 1px .6em; }
  /* Still checking: the text's own colour on a faint wash of it – in the dark
     theme too, where a filled badge's text is dark – and a ring turning
     before the words. */
  .lean-badge.checking, html.dark .lean-badge.checking {
    background: color-mix(in srgb, currentColor 13%, transparent); color: inherit; }
  .lean-badge .spin { flex: none; box-sizing: border-box; width: .8em; height: .8em; margin-left: .6em;
    border: .14em solid color-mix(in srgb, currentColor 25%, transparent); border-top-color: currentColor;
    border-radius: 50%; animation: lean-spin .8s linear infinite; }
  .lean-badge .spin + .t { padding-left: .45em; }
  @keyframes lean-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .lean-badge .spin { animation-duration: 2.4s; } }
  /* hover and press mark every part of a split badge at once (the viewer's
     latex-widget-hover / -active on each part) */
  .latex-widget-hover .lean-badge:not(.checking) { background: var(--lt-primary-strong); }
  .latex-widget-active .lean-badge:not(.checking) { background: color-mix(in srgb, var(--lt-primary-strong) 82%, #000); }
  /* the chevron: centred in a full-height segment, clear of the rounded end */
  .lean-badge button { align-self: stretch; display: inline-flex; align-items: center; justify-content: center;
    margin: 0; padding: 0 .55em 0 .45em; border: 0; color: inherit; background: none; cursor: pointer;
    box-shadow: inset 1px 0 0 color-mix(in srgb, currentColor 30%, transparent);
    transition: background-color .15s ease; }
  .lean-badge button svg { width: .8em; height: .8em; transform: translateY(1.5px); transition: transform .15s ease; }
  .lean-badge button:hover { background: color-mix(in srgb, currentColor 16%, transparent); }
  .lean-badge button:active,
  .lean-badge button[aria-expanded="true"] { background: color-mix(in srgb, #000 18%, transparent); }
  .lean-badge button[aria-expanded="true"] svg { transform: translateY(1.5px) rotate(180deg); }
  .lean-badge button:focus-visible { outline: 2px solid currentColor; outline-offset: -3px; border-radius: .6em; }
  /* Broken across lines: a cut end gets small corners and a perforation –
     a middle piece has one on each side. */
  .lean-badge.cut-right { border-top-right-radius: 4px; border-bottom-right-radius: 4px; }
  .lean-badge.cut-left  { border-top-left-radius: 4px;  border-bottom-left-radius: 4px; }
  .lean-badge.cut-right::after, .lean-badge.cut-left::before { content: ''; position: absolute; top: 3px; bottom: 3px;
    border-left: 1.5px dashed color-mix(in srgb, currentColor 55%, transparent); }
  .lean-badge.cut-right::after { right: 3px; }
  .lean-badge.cut-left::before { left: 3px; }
  .lean-badge.checking.cut-right::after, .lean-badge.checking.cut-left::before {
    border-left-color: color-mix(in srgb, currentColor 22%, transparent); }
  .lean-badge.cut-right .t { padding-right: .75em; }
  .lean-badge.cut-left .t  { padding-left: .75em; }
  .lean-menu { position: fixed; z-index: 2147482000; min-width: 15rem; padding: 6px; margin: 0; list-style: none;
    background: var(--latex-page-bg, #fff); color: inherit; border-radius: 10px;
    border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
    box-shadow: 0 10px 30px -8px rgba(0,0,0,.28), 0 2px 6px rgba(0,0,0,.08);
    font: 13px/1.4 ui-sans-serif, system-ui, sans-serif; }
  .lean-menu .head { padding: 6px 10px 8px; opacity: .65; font-size: 12px; }
  .lean-menu .head code { font-size: 12px; }
  .lean-menu button, .lean-menu a { display: flex; gap: .6em; width: 100%; box-sizing: border-box; padding: 7px 10px;
    border: 0; border-radius: 6px; background: none; color: inherit; font: inherit; text-align: left;
    text-decoration: none; cursor: pointer; }
  .lean-menu button:hover, .lean-menu a:hover, .lean-menu button:focus-visible, .lean-menu a:focus-visible {
    background: color-mix(in srgb, var(--lt-primary) 12%, transparent); outline: none; }
  .lean-menu .tick { width: 1em; color: var(--lt-primary); }
</style>
<script>
  (function () {
    var DECL = 'Nat.sum_odd_eq_sq';
    var status = 'checking', showDecl = true, menu = null;
    function label() {
      if (status === 'checking') return 'checking in Lean…';
      // the tick keeps to its word (a no-break space): the badge splits only at a space
      return showDecl ? '✓\u00a0Lean: ' + DECL : '✓\u00a0formalised in Lean';
    }
    // The badge as a row of segments, with a break point between each two:
    // at a space (as words break; the space shows only when the line does
    // not break there), or – costlier, for a really narrow column – after a
    // dot or an underscore inside the declaration's name: Nat. sum_ odd_ …
    function segment(text) {
      var segs = [''], gaps = [];
      for (var k = 0; k < text.length; k++) {
        var c = text[k];
        if (c === ' ') { segs.push(''); gaps.push({ space: true, penalty: 100 }); continue; }
        segs[segs.length - 1] += c;
        if ((c === '.' || c === '_') && k + 1 < text.length && text[k + 1] !== ' ') {
          segs.push(''); gaps.push({ space: false, penalty: 300 });
        }
      }
      return { segs: segs, gaps: gaps };
    }
    function esc(s) { return s.replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }
    var CHEVRON = '<button type="button" aria-haspopup="menu" aria-expanded="false" aria-label="Lean status menu">'
      + '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" '
      + 'stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>';
    // One drawn part: the text of segments from..to, and its two ends.
    function badge(text, left, right) {
      var checking = status === 'checking';
      return '<span class="lean-badge' + (checking ? ' checking' : '') + (left === 'cut' ? ' cut-left' : '')
        + (right === 'cut' ? ' cut-right' : '') + '">'
        + (checking && left !== 'cut' ? '<span class="spin" aria-hidden="true"></span>' : '')
        + '<span class="t">' + esc(text) + '</span>'
        + (right !== 'cut' && !checking ? CHEVRON : '') + '</span>';
    }
    function textOf(sg, from, to) {
      var t = sg.segs[from];
      for (var i = from; i < to; i++) t += (sg.gaps[i].space ? ' ' : '') + sg.segs[i + 1];
      return t;
    }
    var opener = null;
    function closeMenu() {
      if (menu) { menu.remove(); menu = null; }
      if (opener) { opener.setAttribute('aria-expanded', 'false'); opener = null; }
    }
    function openMenu(btn, env) {
      if (menu) { closeMenu(); return; }
      opener = btn; btn.setAttribute('aria-expanded', 'true');
      menu = document.createElement('div');
      menu.className = 'lean-menu'; menu.setAttribute('role', 'menu');
      menu.innerHTML = '<div class="head">Checked by Lean 4 · <code>' + DECL + '</code></div>'
        + '<button type="button" role="menuitemcheckbox" aria-checked="' + showDecl + '" data-act="decl">'
        + '<span class="tick">' + (showDecl ? '✓' : '') + '</span>Show the declaration</button>'
        + '<button type="button" role="menuitem" data-act="copy"><span class="tick"></span>Copy the declaration name</button>'
        + '<a role="menuitem" href="../lean/"><span class="tick"></span>See the theorem and its proof →</a>';
      document.body.appendChild(menu);
      var r = btn.getBoundingClientRect(), mw = menu.offsetWidth;
      menu.style.left = Math.max(8, Math.min(r.left - 10, window.innerWidth - mw - 8)) + 'px';
      menu.style.top = (r.bottom + 6) + 'px';
      menu.addEventListener('click', function (e) {
        var b = e.target.closest('[data-act]'); if (!b) return;
        if (b.dataset.act === 'decl') { showDecl = !showDecl; closeMenu(); env.invalidate(); }
        if (b.dataset.act === 'copy') { if (navigator.clipboard) navigator.clipboard.writeText(DECL); closeMenu(); }
      });
      menu.querySelector('button').focus();
    }
    document.addEventListener('pointerdown', function (e) {
      if (menu && !menu.contains(e.target) && !e.target.closest('.lean-badge button')) closeMenu();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });
    window.addEventListener('scroll', closeMenu, { passive: true });

    // \webwidget{lean:sum_odd}: an inline instance of kind "lean".
    var timer = null;
    function define(host) { host.define('lean', {
      measure: function (instance, env) {
        if (!timer) timer = setTimeout(function () { status = 'done'; env.invalidate(); }, 2500);
        var sg = segment(label()), em = 0.6 * env.fontSize;       // the badge's own font size
        var text = function (t) { return env.measure('<span class="lean-badge"><span style="white-space:pre">' + esc(t) + '</span></span>'); };
        var whole = env.measure(badge(textOf(sg, 0, sg.segs.length - 1), 'cap', 'cap'));
        var chevron = status === 'checking' ? 0 : env.measure('<span class="lean-badge">' + CHEVRON + '</span>').width;
        var space = text('a b').width - text('ab').width;
        return {
          segments: sg.segs.map(function (t) { var m = text(t); return { width: m.width, height: whole.height, depth: whole.depth }; }),
          gaps: sg.gaps.map(function (g) { return { width: g.space ? space : 0, penalty: g.penalty }; }),
          // closed ends: the text's padding (and, on the left, the spinner
          // while checking; on the right, the chevron once checked);
          // cut ends: a little more padding, for the perforation, which
          // hangs past the margin by 3.75px – its middle on the margin
          ends: { left:  { cap: (status === 'checking' ? 0.6 + 0.8 + 0.45 : 0.6) * em, cut: 0.75 * em, overhang: 3.75 },
                  right: { cap: 0.6 * em + chevron, cut: 0.75 * em, overhang: 3.75 } },
        };
      },
      render: function (instance, host) {
        var part = host.piece;
        closeMenu();
        host.el.innerHTML = badge(textOf(segment(label()), part.from, part.to), part.left, part.right);
        // Only the chevron opens the menu.
        var btn = host.el.querySelector('button');
        if (btn) btn.addEventListener('click', function (e) { openMenu(e.currentTarget, host.env); });
      },
    }); }
    if (window.reflowtex && reflowtex.host) define(reflowtex.host);
    else document.addEventListener('reflowtex:host', function (e) { define(e.detail.host); }, { once: true });
  })();
</script>
