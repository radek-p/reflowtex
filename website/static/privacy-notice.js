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
        // A bar across the bottom of the window (clear of the inspector when it
        // is docked: it publishes its size).
        style.textContent = `.rtx-privacy { position: fixed; z-index: 2147483000;
            left: var(--rtx-dock-left, 0px); right: var(--rtx-dock-right, 0px); bottom: var(--rtx-dock-bottom, 0px);
            display: flex; align-items: center; justify-content: center; gap: 1.5rem; flex-wrap: wrap;
            padding: 1.1rem 1.5rem calc(1.1rem + env(safe-area-inset-bottom));
            font: 17px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
            background: var(--bg, var(--latex-page-bg, Canvas)); color: var(--fg, inherit);
            border-top: 1px solid color-mix(in srgb, currentColor 18%, transparent); box-shadow: 0 -6px 24px rgba(0,0,0,.14); }
          .rtx-privacy p { margin: 0; max-width: 46rem; }
          .rtx-privacy a { color: inherit; }
          /* the home page's primary button (layouts/partials/head.html): square, the
             accent's fill, and in a dark theme the page's dark as its text */
          .rtx-privacy button { flex: none; font: inherit; font-weight: 600; padding: .5rem 1.6rem; border: 1px solid transparent;
            border-radius: 0; cursor: pointer; color: #fff; background: var(--lt-primary, var(--accent, #0b57d0));
            transition: background .15s ease; }
          .rtx-privacy button:hover { background: var(--lt-primary-strong, var(--lt-primary, var(--accent, #0b57d0))); }
          html.dark .rtx-privacy button { color: #0c0a09; }
          :root[data-theme="dark"]:not(.dark) .rtx-privacy button { color: #1f2023; }   /* (the render tests page) */
          @media (max-width: 600px) { .rtx-privacy { font-size: 16px; gap: .8rem; } }
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
