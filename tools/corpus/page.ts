// SPDX-License-Identifier: AGPL-3.0-or-later
// A paper's page on the website: the very page that was measured (the
// vanilla page site-from-run.ts writes, with the block TeX's run made), with
// what a reader needs around it – the paper's title, authors and licence, the
// links to where it was published, its source and the comparison – and a
// table of contents. Nothing is added inside the block: the header is a
// sibling of it in #lt-content and the contents a sibling of #lt-content, which
// the comparison (dom-dump.ts) and the render report both hide, so the page
// measured and the page read are one.
//
// The contents are the viewer's outline of the document (the
// `reflowtex:outline` event: its sections and the like, as the paper's
// headings make them), on the right where the window is wide enough, and
// folded under the header where it is not.
import { escapeHtml } from '../../src/pipeline/site.ts';

export interface PageInfo {
  title: string; authors: string[]; venue: string; year: number; field: string;
  licence: string; licence_url: string; attribution: string;
  original_page: string; original_url: string; source_url: string;
  /** relative to the page: the comparison, the site's home, the accuracy summary */
  compare?: string; home: string;
  /** e.g. "placement 99.98 %, no vertical jump" */
  measured?: string;
  /** where the page's shared scripts are, relative to it ('' beside it) */
  assets?: string;
}

const CSS = `<style id="corpus-page-css">
  .corpus-head { font-size: .95rem; line-height: 1.45; margin: 0 0 2.5rem; padding-bottom: 1.25rem;
    border-bottom: 1px solid color-mix(in srgb, currentColor 18%, transparent); }
  .corpus-head .crumbs { font-size: .85rem; opacity: .7; margin: 0 0 .75rem; }
  .corpus-head h1 { font-size: 1.45rem; line-height: 1.25; margin: 0 0 .4rem; font-weight: 650; }
  .corpus-head p { margin: .25rem 0; }
  .corpus-head .muted { opacity: .72; }
  .corpus-head .links { display: flex; flex-wrap: wrap; gap: .35rem 1rem; margin-top: .6rem; }
  .corpus-head a { color: inherit; text-decoration-color: color-mix(in srgb, currentColor 40%, transparent); text-underline-offset: .15em; }
  .corpus-head .credit { font-size: .82rem; opacity: .72; margin-top: .75rem; }
  .corpus-toc-fold { margin-top: .9rem; }
  .corpus-toc-fold[hidden] { display: none; }
  .corpus-toc-fold summary { cursor: pointer; font-size: .9rem; }
  .corpus-toc ul, .corpus-toc-fold ul { list-style: none; margin: .3rem 0; padding-left: .9rem; }
  .corpus-toc > nav > ul, .corpus-toc-fold > ul { padding-left: 0; }
  .corpus-toc li, .corpus-toc-fold li { margin: .15rem 0; }
  .corpus-toc a, .corpus-toc-fold a { color: inherit; text-decoration: none; opacity: .78; font-size: .85rem; line-height: 1.35; display: block; }
  .corpus-toc a:hover, .corpus-toc-fold a:hover { opacity: 1; text-decoration: underline; }
  .corpus-toc a.current { opacity: 1; font-weight: 600; }
  .corpus-toc { position: fixed; top: 3rem; right: 1.25rem; width: 15rem; max-height: calc(100vh - 6rem); overflow: auto; display: none; }
  .corpus-toc p { font-size: .8rem; text-transform: uppercase; letter-spacing: .06em; opacity: .6; margin: 0 0 .4rem; }
  @media (min-width: 84rem) {
    html:not([data-width="wide"]) .corpus-toc.has-entries { display: block; }
    html:not([data-width="wide"]) .corpus-toc-fold { display: none; }
  }
</style>`;

const TOC_SCRIPT = `<script>
(function () {
  var aside = document.getElementById('corpus-toc'), fold = document.getElementById('corpus-toc-fold'), size = 0, flat = [];
  function label(e) { return (e.number ? e.number + ' ' : '') + e.title; }
  function list(entries) {
    var root = document.createElement('ul'), stack = [];
    entries.forEach(function (e) {
      var level = Math.max(1, e.level || 1);
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      var top = stack[stack.length - 1], parent = root;
      if (top) parent = top.li.querySelector(':scope > ul') || top.li.appendChild(document.createElement('ul'));
      var li = document.createElement('li'), a = document.createElement('a');
      a.href = '#' + e.id; a.textContent = label(e); li.appendChild(a); parent.appendChild(li);
      stack.push({ level: level, li: li });
      flat.push({ id: e.id, a: a });
    });
    return root;
  }
  function spy() {
    var line = window.innerHeight * 0.25, cur = null;
    for (var i = 0; i < flat.length; i++) { var t = document.getElementById(flat[i].id); if (t && t.getBoundingClientRect().top <= line) cur = flat[i]; else if (t) break; }
    flat.forEach(function (f) { f.a.classList.toggle('current', f === cur); });
  }
  document.addEventListener('reflowtex:outline', function (ev) {
    var entries = ev.detail.entries.filter(function (e) { return e.id && e.kind !== 'theorem'; });
    if (entries.length <= size) return;
    size = entries.length; flat = [];
    aside.querySelector('nav').replaceChildren(list(entries));
    var marks = flat; flat = [];
    fold.replaceChildren(fold.querySelector('summary'), list(entries));
    flat = marks;
    aside.classList.add('has-entries'); fold.hidden = false;
    spy();
  });
  window.addEventListener('scroll', function () { requestAnimationFrame(spy); }, { passive: true });
})();
</script>`;

const a = (href: string, text: string) => `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;

/** The measured page (site-from-run's index.html) made the paper's page. */
export function paperPage(measured: string, p: PageInfo): string {
  const assets = p.assets ?? '';
  const header = `<header class="corpus-head">
<p class="crumbs">${a(p.home, 'Reflow TeX')}, paper corpus</p>
<h1>${escapeHtml(p.title)}</h1>
<p>${escapeHtml(p.authors.join(', '))}</p>
<p class="muted">${escapeHtml(`${p.venue}, ${p.year}`)}</p>
<p class="muted">${escapeHtml(p.field)}</p>
${p.measured ? `<p class="muted">Against TeX's own typesetting: ${escapeHtml(p.measured)}.</p>` : ''}
<p class="links">${a(p.original_page, 'Where it was published')} ${a(p.original_url, 'The authors\' PDF')} ${a(p.source_url, 'Source')}${p.compare ? ` ${a(p.compare, 'Compare with TeX')}` : ''}</p>
<p class="credit">${escapeHtml(p.attribution)} ${a(p.licence_url, p.licence)}.</p>
<details class="corpus-toc-fold" id="corpus-toc-fold" hidden><summary>Contents</summary></details>
</header>`;
  let page = measured;
  const title = /<title>[^<]*<\/title>/;
  if (!title.test(page)) throw new Error('paper page: the measured page has no <title>');
  page = page.replace(title, () => `<title>${escapeHtml(p.title)}</title>`);
  page = page.replace('</head>', () => `${CSS}\n</head>`);
  const h1 = /(<main id="lt-content">\s*)<h1>[^<]*<\/h1>/;
  if (!h1.test(page)) throw new Error('paper page: no heading in #lt-content to replace');
  page = page.replace(h1, (_, open: string) => `${open}${header}`);
  page = page.replace('</body>', () => `<aside class="corpus-toc" id="corpus-toc" aria-label="Contents of the paper"><p>Contents</p><nav></nav></aside>\n${TOC_SCRIPT}\n</body>`);
  if (assets) for (const s of ['protobuf.min.js', 'latex-viewer.js'])
    page = page.replace(`<script src="${s}"></script>`, () => `<script src="${assets}${s}"></script>`);
  return page;
}

/** A page that sends the reader on to `to` (relative). */
export function redirectPage(to: string, title: string): string {
  const t = escapeHtml(to);
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<meta http-equiv="refresh" content="0; url=${t}"><link rel="canonical" href="${t}"></head>
<body><p><a href="${t}">${escapeHtml(title)}</a></p><script>location.replace(${JSON.stringify(to).replace(/</g, '\\u003c')});</script></body></html>\n`;
}
