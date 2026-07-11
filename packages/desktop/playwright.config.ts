/**
 * Playwright E2E config (P0-08): drives the electron-builder `--dir` unpacked
 * packaged app (built by the `pree2e` script), never a dev-mode `electron .`
 * process — DD-001 scopes E2E to the packaged artifact.
 *
 * Deliberate defaults (plan Step 1):
 * - `workers: 1` / `fullyParallel: false` — launching a full packaged Electron
 *   app per test is heavy and this issue ships one spec; flip these once
 *   enough specs exist for parallelism to matter.
 * - `trace: 'retain-on-failure'` / `screenshot: 'only-on-failure'` — this is
 *   the project's first E2E harness; prioritize debuggability of the first
 *   flaky CI failure over trace-file size.
 * - `github` reporter in CI (native PR-check annotations), `list` locally.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  fullyParallel: false,
  reporter: process.env['CI'] ? 'github' : 'list',
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
