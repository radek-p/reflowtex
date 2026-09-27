// SPDX-License-Identifier: AGPL-3.0-or-later
// A note, shown once, on what this site keeps in the browser: the reader's
// settings (theme, text size, column width, the inspector's place, the render
// tests page's view). They are in the browser's local storage, not cookies,
// stay on the device, and are never sent anywhere; nothing on the site tracks
// the reader. Its OK is remembered the same way. Loaded by every page of the
// site (layouts/_default/baseof.html) and by the render tests page
// (build.sh adds it there).
(() => {
    const KEY = 'reflowtex-privacy-notice';
    // (the site's root: this file is at it, on every page)
    const about = new URL('about/', document.currentScript?.src ?? location.href).href;
    try { if (localStorage.getItem(KEY)) return; } catch { return; }      // (no storage: nothing is kept either)
    const show = () => {
        const box = document.createElement('div');
        box.className = 'rtx-privacy';
        box.setAttribute('role', 'note');
        box.innerHTML = '<p>This site remembers your settings – theme, text size, column width and the like – ' +
            'in your browser, for your next visit. They stay on your device, and nothing on this site tracks you. ' +
            `<a href="${about}">More</a></p>` +
            '<button type="button">OK</button>';
        const style = document.createElement('style');
        // (clear of the inspector when it is docked: it publishes its size)
        style.textContent = `.rtx-privacy { position: fixed; left: calc(12px + var(--rtx-dock-left, 0px)); bottom: calc(40px + var(--rtx-dock-bottom, 0px));
            z-index: 2147483000; max-width: 22rem;
            display: flex; align-items: flex-end; gap: .75rem; padding: .7rem .8rem; border-radius: 8px;
            font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
            background: var(--bg, var(--latex-page-bg, Canvas)); color: var(--fg, inherit);
            border: 1px solid color-mix(in srgb, currentColor 18%, transparent); box-shadow: 0 6px 24px rgba(0,0,0,.18); }
          .rtx-privacy p { margin: 0; }
          .rtx-privacy a { color: inherit; }
          .rtx-privacy button { flex: none; font: inherit; font-weight: 600; padding: .3rem .8rem; border: 0; border-radius: 6px;
            cursor: pointer; color: #fff; background: var(--accent, var(--lt-primary, #0b57d0)); }
          @media print { .rtx-privacy { display: none; } }`;
        box.querySelector('button').addEventListener('click', () => {
            try { localStorage.setItem(KEY, 'ok'); } catch { /* shown again next time */ }
            box.remove(); style.remove();
        });
        document.head.appendChild(style);
        document.body.appendChild(box);
    };
    if (document.body) show(); else addEventListener('DOMContentLoaded', show);
})();
