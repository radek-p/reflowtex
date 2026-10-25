// SPDX-License-Identifier: AGPL-3.0-or-later
// What a document may put on the page: the addresses its links go to and the
// markup of its pictures. Both come from the TeX source, which may be
// someone else's (a paper downloaded, an archive imported), so neither may run
// script in the page: a link's address is one of a few schemes, and a
// picture's SVG loses scripts, HTML islands, event handlers and addresses of
// other schemes. Pure functions, no DOM: the pipeline cleans a picture's
// markup where it is made (src/pipeline/pictures.ts, cleanSvgMarkup) and the
// viewer cleans the parsed tree again where it is inserted (engine/sink.ts,
// with the element rules below), so a page built by an older pipeline is safe
// too.
//
//   safeUrl(url)                  the address, or null when its scheme is not allowed
//   cleanSvgMarkup(markup)        SVG markup (an element's content) with what may run taken out
//   droppedElement(name, attrs)   whether an element goes, whole (the DOM cleaner's rule)
//   droppedAttribute(name, value, element)   whether an attribute goes (the DOM cleaner's rule)

/** Schemes a link may use; an address with no scheme (relative, `#label`) is always allowed. */
const LINK_SCHEMES = new Set(['http', 'https', 'mailto', 'tel', 'ftp']);
/** In a picture, a data: address only for an image, as the pipeline writes them. */
const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp|avif|svg\+xml)[;,]/i;

/** The address as the browser reads it: ASCII tab and newline removed anywhere, C0 controls and spaces at the ends. */
function asParsed(url: string): string {
    return url.replace(/[\t\n\r]/g, '').replace(/^[\u0000- ]+|[\u0000- ]+$/g, '');
}

/** `url` when it is relative, a fragment, or of an allowed scheme (`image`: also a data: image); else null. */
export function safeUrl(url: string | null | undefined, { image = false }: { image?: boolean } = {}): string | null {
    if (url == null) return null;
    const u = asParsed(String(url));
    const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(u);
    if (!m) {
        // no scheme: relative, or a fragment – unless something before the
        // first ':' is not a scheme the parser would skip (a control character)
        return /^[^/?#]*[\u0000-\u001f\u007f]/.test(u) ? null : String(url);
    }
    const scheme = m[1]!.toLowerCase();
    if (LINK_SCHEMES.has(scheme)) return String(url);
    if (image && scheme === 'data' && DATA_IMAGE.test(u)) return String(url);
    return null;
}

// ── Picture markup ──────────────────────────────────────────────────────────

/** Elements that go with everything in them: script, and the ways into HTML (or another document). */
const DROP = new Set(['script', 'foreignobject', 'iframe', 'embed', 'object', 'handler', 'listener']);
/** Animation elements, dropped only when they animate an address or a handler. */
const ANIMATE = new Set(['animate', 'set', 'animatetransform', 'animatemotion', 'animatecolor']);

const localName = (name: string) => name.slice(name.lastIndexOf(':') + 1).toLowerCase();

/** Whether an element named `name` (any prefix; its attributes' values, decoded) goes, whole. */
export function droppedElement(name: string, attr: (name: string) => string | null): boolean {
    const n = localName(name);
    if (DROP.has(n)) return true;
    if (ANIMATE.has(n)) {
        const target = (attr('attributeName') ?? '').trim();
        if (/(^|:)href$/i.test(target) || /^on/i.test(target)) return true;
    }
    return false;
}

const ADDRESS = new Set(['href', 'src', 'action', 'formaction']);
/** Elements whose address may be a data: image (an included bitmap). */
const IMAGE = new Set(['image', 'img', 'feimage']);

/** Whether an attribute `name` (as written, any prefix) of element `element`
 *  goes; `value` decoded, or null when it could not be (then any address or
 *  handler goes). */
export function droppedAttribute(name: string, value: string | null, element: string): boolean {
    const n = localName(name);
    if (n.startsWith('on')) return true;                  // an event handler
    if (!ADDRESS.has(n)) return false;
    return value === null || safeUrl(value, { image: IMAGE.has(localName(element)) }) === null;
}

const BASIC_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** An attribute's value decoded as the HTML parser would, or null when it holds
 *  a named reference this does not know (then the attribute is not trusted). */
function decode(raw: string): string | null {
    let unknown = false;
    const out = raw.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);?/g, (all, ref: string) => {
        if (ref[0] === '#') {
            const cp = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
            return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '�';
        }
        const v = BASIC_ENTITIES[ref];
        if (v !== undefined && all.endsWith(';')) return v;
        unknown = true;
        return all;
    });
    return unknown ? null : out;
}

interface Attr { name: string; raw: string; value: string | null; text: string }
interface Tag { name: string; attrs: Attr[]; selfClosing: boolean; end: number }

const isSpace = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';

/** A start tag at `i` (s[i] is '<', a letter follows), read as the HTML tokenizer reads one; null when it never ends. */
function readTag(s: string, i: number): Tag | null {
    let j = i + 1;
    while (j < s.length && !isSpace(s[j]) && s[j] !== '/' && s[j] !== '>') j++;
    const name = s.slice(i + 1, j);
    const attrs: Attr[] = [];
    let selfClosing = false;
    for (;;) {
        while (j < s.length && (isSpace(s[j]) || s[j] === '/')) { selfClosing = s[j] === '/'; j++; }
        if (j >= s.length) return null;
        if (s[j] === '>') return { name, attrs, selfClosing, end: j + 1 };
        selfClosing = false;
        const a0 = j;
        j++;                                                // (a name may start with '=')
        while (j < s.length && !isSpace(s[j]) && s[j] !== '/' && s[j] !== '>' && s[j] !== '=') j++;
        const aname = s.slice(a0, j);
        let k = j;
        while (k < s.length && isSpace(s[k])) k++;
        let raw = '';
        if (s[k] === '=') {
            k++;
            while (k < s.length && isSpace(s[k])) k++;
            const q = s[k];
            if (q === '"' || q === "'") {
                const e = s.indexOf(q, k + 1);
                if (e < 0) return null;
                raw = s.slice(k + 1, e);
                k = e + 1;
            } else {
                const v0 = k;
                while (k < s.length && !isSpace(s[k]) && s[k] !== '>') k++;
                raw = s.slice(v0, k);
            }
            j = k;
        }
        attrs.push({ name: aname, raw, value: decode(raw), text: s.slice(a0, j) });
    }
}

/** The end of the element whose start tag ends at `from`: past its matching end tag (same name, nested ones counted), else the end. */
function skipElement(s: string, name: string, from: number): number {
    const re = new RegExp(`<(/?)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[\\s/>])`, 'gi');
    re.lastIndex = from;
    let depth = 1, m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
        const close = s.indexOf('>', m.index);
        if (close < 0) return s.length;
        if (m[1]) { if (--depth === 0) return close + 1; }
        else if (s[close - 1] !== '/') depth++;
        re.lastIndex = close + 1;
    }
    return s.length;
}

/** SVG markup with what may run taken out: script and foreignObject (and
 *  iframe, embed, object) with their content, animations of an address or a
 *  handler, event-handler attributes, and addresses (href, src) of other
 *  schemes than a link may use or, for an image, data:image. Comments,
 *  CDATA sections, processing instructions and declarations go too. A tag
 *  that keeps everything is left byte for byte as it was; one that loses an
 *  attribute is written again with the rest as they were. Read as the HTML
 *  parser reads markup in an <svg> (unquoted values, '/' between attributes),
 *  since that is how the viewer inserts it. */
export function cleanSvgMarkup(s: string): string {
    let out = '', i = 0;
    while (i < s.length) {
        const lt = s.indexOf('<', i);
        if (lt < 0) { out += s.slice(i); break; }
        out += s.slice(i, lt);
        if (s.startsWith('<!--', lt)) {
            // the earliest end the HTML parser accepts (<!--> and <!---> end at once)
            const e1 = s.indexOf('-->', lt + 2), e2 = s.indexOf('--!>', lt + 2);
            const ends = [e1 < 0 ? Infinity : e1 + 3, e2 < 0 ? Infinity : e2 + 4];
            i = Math.min(...ends);
            if (i === Infinity) break;
            continue;
        }
        if (s.startsWith('<![CDATA[', lt)) {
            const e = s.indexOf(']]>', lt);
            if (e < 0) break;
            i = e + 3;
            continue;
        }
        const c = s[lt + 1];
        if (c === '!' || c === '?') {                     // a declaration or processing instruction (a bogus comment)
            const e = s.indexOf('>', lt);
            if (e < 0) break;
            i = e + 1;
            continue;
        }
        if (c === '/') {
            const e = s.indexOf('>', lt);
            if (e < 0) break;
            const name = s.slice(lt + 2, e).trim().split(/[\s/]/)[0] ?? '';
            if (/^[A-Za-z]/.test(name) && !DROP.has(localName(name))) out += `</${name}>`;
            i = e + 1;
            continue;
        }
        if (!c || !/[A-Za-z]/.test(c)) { out += '&lt;'; i = lt + 1; continue; }   // text, as the parser takes it
        const tag = readTag(s, lt);
        if (!tag) break;                                    // a tag that never ends: nothing after it is kept
        const get = (n: string) => {
            const a = tag.attrs.find(x => x.name.toLowerCase() === n.toLowerCase());
            return a ? a.value ?? '' : null;
        };
        if (droppedElement(tag.name, get)) {
            i = tag.selfClosing ? tag.end : skipElement(s, tag.name, tag.end);
            continue;
        }
        const keep = tag.attrs.filter(a => !droppedAttribute(a.name, a.value, tag.name));
        if (keep.length === tag.attrs.length) out += s.slice(lt, tag.end);
        else out += `<${tag.name}${keep.map(a => ' ' + a.text).join('')}${tag.selfClosing ? '/' : ''}>`;
        i = tag.end;
    }
    return out;
}
