/**
 * P1-08 acceptance E2E: after a scan completes, the background 'hash' job
 * (DD-004 Stage 5a) must auto-trigger and populate every discovered file's
 * `sha256` through the full renderer -> main -> worker -> DB round trip.
 *
 * This closes a real gap the P1-08 PR's own tests missed: every orchestrator
 * unit/integration test constructs its own `JobQueueOrchestrator` and wires
 * `watchFolders` explicitly, so they never caught that `main/index.ts` (the
 * actual production wiring) omitted it — which silently made the hash job
 * unable to resolve any file's absolute path, so hashing never progressed in
 * the real packaged app despite every automated test passing. Only running
 * the real app against real data surfaced it.
 */
import type { AstroTrackerBridge, FileRecord } from '../src/ipc/contract.js';
import { createTempLibraryDir } from './support/temp-dirs.js';
import { expect, test } from './fixtures.js';

declare const window: { astrotracker: AstroTrackerBridge };

const SEED_FIXTURES = ['fits/apt/apt-ccd-light.fits', 'xisf/minimal-unit.xisf'] as const;

test('scanning a watch folder auto-triggers background hashing for every discovered file', async ({
  electronApp,
}) => {
  const page = await electronApp.app.firstWindow();
  const seeded = await createTempLibraryDir(SEED_FIXTURES);

  try {
    const folder = await page.evaluate(
      (folderPath) => window.astrotracker.invoke('watchFolders.add', { path: folderPath }),
      seeded.path,
    );

    await page.evaluate(
      (watchFolderId) => window.astrotracker.invoke('jobs.enqueueScan', { watchFolderId }),
      folder.id,
    );

    // 1. Wait for discovery (Stage 1) to surface every seeded file.
    await expect
      .poll(
        async () => {
          const { files } = await page.evaluate(
            (watchFolderId) =>
              window.astrotracker.invoke('files.listByWatchFolder', { watchFolderId }),
            folder.id,
          );
          return files.length;
        },
        { timeout: 30_000, intervals: [250, 500, 1000, 2000] },
      )
      .toBe(SEED_FIXTURES.length);

    // 2. The background hash job auto-enqueues after the scan completes
    // (orchestrator.ts onDone -> enqueueHashIfBacklog) — no manual trigger
    // exists or is needed here. Wait for every row's sha256 to populate.
    let files: FileRecord[] = [];
    await expect
      .poll(
        async () => {
          const result = await page.evaluate(
            (watchFolderId) =>
              window.astrotracker.invoke('files.listByWatchFolder', { watchFolderId }),
            folder.id,
          );
          files = result.files;
          return files.filter((f) => f.sha256 !== null).length;
        },
        { timeout: 30_000, intervals: [250, 500, 1000, 2000] },
      )
      .toBe(SEED_FIXTURES.length);

    for (const file of files) {
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(file.status).toBe('present');
    }
  } finally {
    await seeded.cleanup();
  }
});
