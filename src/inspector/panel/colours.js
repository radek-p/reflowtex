// SPDX-License-Identifier: AGPL-3.0-or-later
// The Colours view: the page's colour maps (#latex-color-maps), all at once,
// and an editor for them. Each map is a table: a row per colour TeX produced,
// a column per theme with what that theme shows instead (blank: the colour
// itself), and what it is shown as now, in the page's theme (that theme's
// column is marked). Then its tints: colours TeX mixed into the page,
// re-mixed against the page's background.
//
// Every edit applies at once (the viewer's host.setColorMaps: the colours are
// CSS custom properties, so nothing is laid out again). Export copies the
// maps as the island's JSON and downloads them; Import takes such JSON, from
// a file or pasted; Reset brings back the page's own.
import { html, signal, useRef } from '../vendor/preact.js';
import { call, got } from './bridge.js';
import { Action, Muted, copyText } from './ui.js';
import { say } from './store.js';

const data = signal(null);
const pasting = signal(false);

export async function loadColours() {
    const r = await call('colourMaps');
    data.value = got(r) ? r : { theme: null, maps: [], edited: false };
}
async function run(what, ...args) {
    const r = await call(what, ...args);
    if (r !== 'ok') say(got(r) ? String(r) : 'the page did not answer');
    await loadColours();
    return r === 'ok';
}
const HEX = /^#[0-9a-f]{6}$/i;

const Swatch = ({ c }) => c
    ? html`<span class="swatch" title=${c}><i style=${{ background: c }}></i><code>${c}</code></span>`
    : html`<span class="swatch none">–</span>`;

// One theme's colour for one TeX colour: a picker (for #rrggbb) and a field
// (any CSS colour); empty or × drops the mapping.
function Cell({ map, theme, src, value }) {
    const set = v => run('setMapColour', map, theme, src, v);
    return html`<span class="ccell">
        <input type="color" value=${value && HEX.test(value) ? value : src} title=${`${theme}: pick a colour`}
               onInput=${e => set(e.currentTarget.value)}/>
        <input type="text" class="cval" value=${value || ''} placeholder=${src} spellcheck="false"
               title="Any CSS colour; empty: the colour as TeX set it" onChange=${e => set(e.currentTarget.value.trim() || null)}/>
        ${value ? html`<button type="button" class="x" title="Drop this mapping" onClick=${() => set(null)}>×</button>` : null}
    </span>`;
}

function ColourMap({ m, theme }) {
    const add = useRef(null), tint = useRef(null);
    const addColour = () => {
        const v = add.current.value.trim().toLowerCase();
        if (!HEX.test(v)) { say('a TeX colour is #rrggbb'); return; }
        run('setMapColour', m.name, theme || 'light', v, v).then(ok => { if (ok) add.current.value = ''; });
    };
    const addTint = () => {
        const [hex, base, pct] = [...tint.current.querySelectorAll('input')].map(i => i.value.trim());
        run('setMapTint', m.name, hex, base, pct);
    };
    return html`<section class="cmap">
        <h3>${m.name} <span class="muted">${m.used.length ? `used by ${m.used.join(', ')}` : 'used by no block on this page'}</span></h3>
        <table class="cgrid"><thead><tr><th>TeX</th>
            ${m.themes.map(t => html`<th key=${t} class=${t === theme ? 'now' : ''}>${t}</th>`)}<th>shown now</th></tr></thead>
            <tbody>${m.colors.map(c => html`<tr key=${c.src}><td><${Swatch} c=${c.src}/></td>
                ${m.themes.map(t => html`<td key=${t} class=${t === theme ? 'now' : ''}><${Cell} map=${m.name} theme=${t} src=${c.src} value=${c.by[t]}/></td>`)}
                <td><${Swatch} c=${c.now}/></td></tr>`)}
            <tr class="add"><td colspan=${m.themes.length + 2}>
                <input ref=${add} type="text" placeholder="#rrggbb" spellcheck="false" title="A colour TeX produced, to map"
                       onKeyDown=${e => { if (e.key === 'Enter') addColour(); }}/>
                <button type="button" onClick=${addColour}>Add colour</button></td></tr></tbody></table>
        <table class="cgrid tints"><thead><tr><th>tint (as TeX baked it)</th><th>of</th><th>%</th><th>shown now</th><th></th></tr></thead>
            <tbody>${m.tints.map(t => html`<tr key=${t.hex}><td><${Swatch} c=${t.hex}/></td>
                <td><input type="color" value=${t.base} title="The colour mixed in" onInput=${e => run('setMapTint', m.name, t.hex, e.currentTarget.value, t.pct)}/>
                    <code>${t.base}</code></td>
                <td><input type="number" class="pct" min="0" max="100" value=${t.pct} onChange=${e => run('setMapTint', m.name, t.hex, t.base, e.currentTarget.value)}/></td>
                <td><${Swatch} c=${t.now}/></td>
                <td><button type="button" class="x" title="Drop this tint" onClick=${() => run('setMapTint', m.name, t.hex, null)}>×</button></td></tr>`)}
            <tr class="add" ref=${tint}><td><input type="text" placeholder="#rrggbb" spellcheck="false"/></td>
                <td><input type="text" placeholder="base #rrggbb" spellcheck="false"/></td>
                <td><input type="number" class="pct" min="0" max="100" placeholder="20"/></td>
                <td colspan="2"><button type="button" onClick=${addTint}>Add tint</button></td></tr></tbody></table>
    </section>`;
}

function Paste() {
    const box = useRef(null);
    const load = async () => { if (await run('importColourMaps', box.current.value)) { pasting.value = false; say('colour maps imported'); } };
    return html`<div class="cpaste">
        <textarea ref=${box} spellcheck="false" placeholder='{ "site": { "colors": { "dark": { "#000000": "#e7e5e4" } }, "tints": {} } }'></textarea>
        <span><button type="button" onClick=${load}>Import</button><button type="button" onClick=${() => { pasting.value = false; }}>Cancel</button></span>
    </div>`;
}

export function ColourView() {
    const d = data.value, file = useRef(null);
    const exportJson = async () => {
        const json = await call('exportColourMaps');
        if (!got(json)) return;
        copyText(json, 'colour maps');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        a.download = 'color-maps.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    const fromFile = async e => {
        const f = e.currentTarget.files && e.currentTarget.files[0];
        if (f && await run('importColourMaps', await f.text())) say(`imported ${f.name}`);
        e.currentTarget.value = '';
    };
    return html`<div class="colours">
        <div class="cbar">
            <${Action} title="Copy the colour maps as JSON, and download them as color-maps.json" onClick=${exportJson}>Export<//>
            <${Action} title="Replace the colour maps with those of a JSON file" onClick=${() => file.current.click()}>Import file<//>
            <${Action} title="Replace the colour maps with pasted JSON" onClick=${() => { pasting.value = !pasting.value; }}>Paste JSON<//>
            <${Action} title="The page's own colour maps again" onClick=${() => run('resetColourMaps')}>Reset<//>
            ${d && d.edited ? html`<span class="muted">edited – not saved to the page's files</span>` : null}
            <input ref=${file} type="file" accept="application/json,.json" hidden onChange=${fromFile}/>
        </div>
        ${pasting.value ? html`<${Paste}/>` : null}
        ${!d ? html`<${Muted}>reading…<//>`
          : !d.maps.length ? html`<${Muted}>This page has no colour maps (#latex-color-maps): every colour is drawn as TeX set it. Import or paste some to try them.<//>`
          : d.maps.map(m => html`<${ColourMap} key=${m.name} m=${m} theme=${d.theme}/>`)}
    </div>`;
}
