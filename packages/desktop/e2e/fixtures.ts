/**
 * The shared Playwright fixture every E2E spec goes through (plan Step 4).
 *
 * HOW TO ADD A NEW E2E SPEC
 * -------------------------
 * 1. Create `packages/desktop/e2e/<name>.spec.ts` (`.spec.ts`, never
 *    `.test.ts` — Vitest owns that suffix under `src/`).
 * 2. Import the extended test, NOT `@playwright/test`:
 *        import { expect, test } from './fixtures.js';
 * 3. Destructure the `electronApp` fixture from the test args and get the
 *    renderer `Page` from the app's first window:
 *        test('my spec', async ({ electronApp }) => {
 *          const page = await electronApp.app.firstWindow();
 *          …
 *        });
 * 4. `electronApp.appDataDir` is the run's isolated `--user-data-dir`;
 *    `electronApp.libraryDir` is a fresh temp "library folder" for specs
 *    that need one (seed variants come from `support/temp-dirs.ts`).
 *
 * Specs must never call `_electron.launch()` themselves: launched bare,
 * Electron falls back to the developer's REAL userData directory, which the
 * non-destructive guarantee (DD-002 rule 5) forbids a test from touching.
 * This fixture is the one place `_electron` may be imported — a scoped
 * ESLint rule in the root `eslint.config.mjs` fails `pnpm -r lint` on any
 * `*.spec.ts` importing it directly, so every spec is mechanically routed
 * through temp-dir isolation (plan Defaults #4). Launch and cleanup
 * (app close + both temp dirs removed) run in fixture teardown regardless
 * of test outcome.
 */
import { _electron, type ElectronApplication, expect, test as base } from '@playwright/test';

import { resolveBuild } from './support/resolve-build.js';
import { createTempAppDataDir, createTempLibraryDir } from './support/temp-dirs.js';

export interface ElectronAppFixture {
  /** The launched packaged app payload (electron-builder --dir app.asar output). */
  app: ElectronApplication;
  /** This run's isolated Electron user-data directory (temp, auto-removed). */
  appDataDir: string;
  /** A fresh, empty temp "library folder" for this run (auto-removed). */
  libraryDir: string;
}

export const test = base.extend<{ electronApp: ElectronAppFixture }>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixture functions must destructure their (here empty) dependencies.
  electronApp: async ({}, use) => {
    const build = resolveBuild();
    const appData = await createTempAppDataDir();
    const library = await createTempLibraryDir();
    let app: ElectronApplication | undefined;
    try {
      const env = Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      );
      // Some agent shells set this so Electron behaves like plain Node; clear
      // it or Playwright's Electron/Chromium switches are rejected before boot.
      delete env['ELECTRON_RUN_AS_NODE'];
      app = await _electron.launch({
        args: [build.appPath, `--user-data-dir=${appData.path}`],
        env,
      });
      await use({ app, appDataDir: appData.path, libraryDir: library.path });
    } finally {
      // Teardown runs on failure too (Playwright always runs fixture teardown).
      await app?.close();
      await appData.cleanup();
      await library.cleanup();
    }
  },
});

export { expect };
