// SPDX-License-Identifier: AGPL-3.0-or-later
// The browser's scripts, built from their TypeScript where they are needed:
// the viewer (src/viewer/latex-viewer.js, and .min.js), the companion
// package (src/companion/companion.js) and the inspector (src/inspector/
// inspector.js, agent.js and panel/*.js). None of them is committed: every
// integration, the website's build and every test set-up calls
// ensureBundles(), which builds a bundle when it is missing or was built
// from other sources, in well under a second each (esbuild). `make
// build-viewer` (scripts/build-bundles.ts) builds them on demand; a release
// (.github/workflows/release.yml) attaches them, versioned.
//
// Each file's header names the version (REFLOWTEX_VERSION, else
// package.json's, else "dev") and the SHA-256 of what it was built from: its
// sources (path and contents, in byte order of the paths) – its own src/
// and src/shared/, which every bundle may import – this module and the
// version. A header that does not match is a bundle to build again.
import { buildSync, version as esbuildVersion, type BuildOptions } from 'esbuild';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('..', import.meta.url));
const REPO = join(SRC, '..');
const SELF = fileURLToPath(import.meta.url);

export type BundleName = 'viewer' | 'companion' | 'inspector';
export const BUNDLE_NAMES: BundleName[] = ['viewer', 'companion', 'inspector'];

/** The version the bundles' headers name. */
export function bundleVersion(): string {
  if (process.env.REFLOWTEX_VERSION) return process.env.REFLOWTEX_VERSION;
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')) as { version?: string };
  return pkg.version ?? 'dev';
}

interface Output { file: string; code: () => string }
interface Bundle {
  /** the folder its sources are in (src/), relative to `dir`, and what counts as one */
  dir: string; keep: (f: string) => boolean;
  /** its files, each given its header (`stamp`: version and sources' hash) */
  outputs: (stamp: string) => Output[];
}

const COMMON: BuildOptions = { charset: 'utf8', legalComments: 'none', logLevel: 'warning', write: false };
const bundled = (o: BuildOptions): string => {
  const r = buildSync({ ...COMMON, ...o });
  return r.outputFiles![0].text;
};

const VIEWER = join(SRC, 'viewer'), COMPANION = join(SRC, 'companion'), INSPECTOR = join(SRC, 'inspector'), SHARED = join(SRC, 'shared');
const tsOrJs = (f: string) => /\.(ts|tsx|js)$/.test(f) && !f.endsWith('.d.ts');

const BUNDLES: Record<BundleName, Bundle> = {
  viewer: {
    dir: VIEWER, keep: tsOrJs,
    outputs: stamp => {
      const entry = join(VIEWER, 'src/index.ts');
      return [
        { file: join(VIEWER, 'latex-viewer.js'), code: () => '// SPDX-License-Identifier: AGPL-3.0-or-later\n'
            + `// reflowtex latex-viewer.js – GENERATED from src/viewer/src/ by esbuild ${esbuildVersion} (make build-viewer); ${stamp}\n`
            + "'use strict';\n" + bundled({ entryPoints: [entry], bundle: true, format: 'iife', absWorkingDir: VIEWER }) },
        // (the integrations ship this one, under the name latex-viewer.js)
        { file: join(VIEWER, 'latex-viewer.min.js'), code: () =>
            `/* SPDX-License-Identifier: AGPL-3.0-or-later; reflowtex latex-viewer.js, minified by esbuild ${esbuildVersion}; ${stamp} */\n`
            + bundled({ entryPoints: [entry], bundle: true, format: 'iife', minify: true, absWorkingDir: VIEWER }) },
      ];
    },
  },
  companion: {
    dir: COMPANION, keep: tsOrJs,
    outputs: stamp => [{ file: join(COMPANION, 'companion.js'), code: () => '// SPDX-License-Identifier: AGPL-3.0-or-later\n'
        + `// reflowtex/companion – GENERATED from src/companion/src/ by esbuild ${esbuildVersion} (make build-companion); ${stamp}\n`
        + '// Bundles preact and @preact/signals (MIT) and htm (Apache-2.0): see THIRD-PARTY-LICENSES.md.\n'
        + bundled({ entryPoints: [join(COMPANION, 'src/index.ts')], bundle: true, format: 'esm', minify: true,
                    jsx: 'automatic', jsxImportSource: 'preact', target: 'es2022', absWorkingDir: COMPANION }) }],
  },
  inspector: {
    dir: INSPECTOR, keep: tsOrJs,
    outputs: stamp => {
      const head = (from: string) => '// SPDX-License-Identifier: AGPL-3.0-or-later\n'
        + `// reflowtex inspector – GENERATED from src/inspector/${from} by esbuild ${esbuildVersion} (make build-inspector); ${stamp}\n`;
      const panels = readdirSync(join(INSPECTOR, 'src/panel')).filter(tsOrJs).sort();
      return [
        { file: join(INSPECTOR, 'inspector.js'), code: () => head('src/inspector.ts')
            + bundled({ entryPoints: [join(INSPECTOR, 'src/inspector.ts')], bundle: true, format: 'iife', absWorkingDir: INSPECTOR }) },
        // The agent's last statement installs it, so that the file's value,
        // evaluated as a script, is the result ('ok', or 'no-api' without an
        // inspectable viewer).
        { file: join(INSPECTOR, 'agent.js'), code: () => head('src/agent/')
            + bundled({ entryPoints: [join(INSPECTOR, 'src/agent/index.ts')], bundle: true, format: 'iife', absWorkingDir: INSPECTOR })
            + 'window.__rtxInspectorInstall();\n' },
        // the panel: one ES module each, importing each other and Preact
        // (vendor/) as they are; what they use of src/shared/ is inlined
        ...panels.map(f => ({ file: join(INSPECTOR, 'panel', f.replace(/\.(ts|tsx|js)$/, '.js')), code: () => head(`src/panel/${f}`)
            + bundled({ entryPoints: [join(INSPECTOR, 'src/panel', f)], bundle: true, external: ['./*', '../vendor/*'], format: 'esm', absWorkingDir: INSPECTOR }) })),
      ];
    },
  },
};

/** What a bundle is built from, as the stamp its files' headers carry. */
function stampOf(b: Bundle, version: string): string {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (b.keep(f)) files.push(relative(b.dir, p).split(sep).join('/'));
    }
  };
  walk(join(b.dir, 'src'));
  walk(SHARED);
  files.sort((a, c) => Buffer.compare(Buffer.from(a), Buffer.from(c)));
  const h = createHash('sha256');
  for (const f of files) { h.update(`${f}\n`); h.update(readFileSync(join(b.dir, f))); }
  h.update(readFileSync(SELF)); h.update(`${version}\n${esbuildVersion}\n`);
  return `version ${version}; sources sha256 ${h.digest('hex')}`;
}

const headerOf = (file: string) => existsSync(file) ? readFileSync(file, 'utf8').slice(0, 600).split('\n').slice(0, 2).join('\n') : '';

/** A file written whole or not at all: several builds may run at once (the
 *  web tests build their pages in parallel), and each writes the same bytes. */
function writeAtomic(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

/** Build each of `only` (all, by default) that is missing or was built from
 *  other sources; `force`: build them all the same. Returns the names built. */
export function ensureBundles({ only = BUNDLE_NAMES, force = false, log = console.log }:
  { only?: BundleName[]; force?: boolean; log?: (s: string) => void } = {}): BundleName[] {
  const version = bundleVersion(), built: BundleName[] = [];
  for (const name of only) {
    const b = BUNDLES[name], stamp = stampOf(b, version), outputs = b.outputs(stamp);
    if (!force && outputs.every(o => headerOf(o.file).includes(stamp))) continue;
    if (name === 'inspector') {
      // a panel module whose source went goes too
      const keep = new Set(outputs.map(o => basename(o.file)));
      const panel = join(INSPECTOR, 'panel');
      if (existsSync(panel)) for (const f of readdirSync(panel)) if (!keep.has(f)) rmSync(join(panel, f));
    }
    for (const o of outputs) writeAtomic(o.file, o.code());
    log(`  built ${name}: ${outputs.map(o => relative(REPO, o.file)).join(', ')}`);
    built.push(name);
  }
  return built;
}

/** The files ensureBundles writes, relative to the repository: none of them
 *  is tracked by git. */
export function bundleFiles(): string[] {
  return BUNDLE_NAMES.flatMap(n => BUNDLES[n].outputs('').map(o => relative(REPO, o.file).split(sep).join('/')));
}
