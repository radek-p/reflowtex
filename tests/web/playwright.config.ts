// SPDX-License-Identifier: AGPL-3.0-or-later
// The web tests (README.md): every *.spec.ts in Chromium and in WebKit.
//     npx playwright test -c tests/web [-g footnote] [--project webkit]
import { defineConfig } from '@playwright/test';

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
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
});
