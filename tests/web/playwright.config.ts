// SPDX-License-Identifier: AGPL-3.0-or-later
// The web tests (README.md): every *.spec.ts in Chromium, WebKit and Firefox.
//     npx playwright test -c tests/web [-g footnote] [--project webkit]
// Without Firefox installed (npx playwright install firefox), leave it out:
//     REFLOWTEX_FIREFOX=0 npx playwright test -c tests/web
// Tests tagged @timing measure how long the viewer's tasks take, which only
// means something on a machine doing nothing else: they run in projects of
// their own (timing-chromium, …), after every other test, one engine after
// another. Alone:
//     npx playwright test -c tests/web --project timing-webkit --no-deps
import { defineConfig } from '@playwright/test';

const engines: ('chromium' | 'webkit' | 'firefox')[] = [
  'chromium', 'webkit',
  ...(process.env.REFLOWTEX_FIREFOX === '0' ? [] : ['firefox' as const]),
];

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: 'build/test-results',
  globalSetup: './setup.ts',
  timeout: 60000,
  fullyParallel: true,
  // the tests wait on the viewer's timers (a resize settles after 150 ms):
  // a machine kept busy by too many workers makes them flaky
  workers: 4,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  projects: [
    ...engines.map(name => ({ name, use: { browserName: name }, grepInvert: /@timing/ })),
    ...engines.map((name, k) => ({
      name: `timing-${name}`, use: { browserName: name }, grep: /@timing/,
      dependencies: k ? [`timing-${engines[k - 1]}`] : [...engines],
    })),
  ],
});
