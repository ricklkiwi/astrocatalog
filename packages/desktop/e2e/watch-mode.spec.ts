/**
 * P1-09 acceptance E2E: live watch mode (chokidar). Both of the issue's
 * verbatim acceptance criteria, each proven end-to-end over the real typed
 * IPC contract against the packaged app — never a real 30s/5min wait, via
 * the `electronEnv` fixture shrinking `ASTROTRACKER_WATCH_DEBOUNCE_MS` /
 * `ASTROTRACKER_WATCH_FALLBACK_INTERVAL_MS` for this spec only.
 *
 * Files are dropped directly on disk with Node's `fs/promises` — never via
 * `jobs.enqueueScan` — so a `files` row appearing can only be explained by
 * the live watcher's own debounce → `enqueueScan` path, not a scan the test
 * itself triggered.
 *
 * Does NOT modify `watch-folders.spec.ts` — a separate spec file, per the
 * plan.
 */
import { copyFile } from 'node:fs/promises';
import path from 'node:path';

import type { AstroTrackerBridge } from '../src/ipc/contract.js';
import { createTempLibraryDir } from './support/temp-dirs.js';
import { expect, test } from './fixtures.js';

/** The preload's one exposed global, as visible inside `page.evaluate`. */
declare const window: { astrotracker: AstroTrackerBridge };

/** Repo-root `fixtures/` directory (same resolution as `temp-dirs.spec.ts`). */
const fixturesDir = path.join(import.meta.dirname, '../../../fixtures');

/** Shrunk well below the DD-004 defaults (30s / 5min) so polls settle in seconds, not minutes. */
test.use({
  electronEnv: {
    ASTROTRACKER_WATCH_DEBOUNCE_MS: '300',
    ASTROTRACKER_WATCH_FALLBACK_INTERVAL_MS: '2000',
  },
});

async function dropFixture(destDir: string, fixtureRelativePath: string): Promise<string> {
  const basename = path.basename(fixtureRelativePath);
  await copyFile(path.join(fixturesDir, fixtureRelativePath), path.join(destDir, basename));
  return basename;
}

test('dropping a file into a live-watched folder auto-catalogs it without a manual rescan', async ({
  electronApp,
}) => {
  // chokidar's awaitWriteFinish stability threshold (2s, fixed — see
  // chokidar-watcher.ts) plus the shrunk debounce and polling overhead can
  // comfortably approach Playwright's 30s default; give this spec headroom.
  test.setTimeout(60_000);
  const page = await electronApp.app.firstWindow();
  const seeded = await createTempLibraryDir(); // empty — nothing pre-seeded

  try {
    const folder = await page.evaluate(
      (folderPath) => window.astrotracker.invoke('watchFolders.add', { path: folderPath }),
      seeded.path,
    );

    await page.evaluate(
      (id) => window.astrotracker.invoke('watchFolders.setLiveWatch', { id, enabled: true }),
      folder.id,
    );

    // Drop one fixture file straight onto disk — no jobs.enqueueScan call
    // anywhere in this test body.
    const basename = await dropFixture(seeded.path, 'fits/apt/apt-ccd-light.fits');

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
        { timeout: 20_000, intervals: [200, 500, 1000, 2000] },
      )
      .toBe(1);

    const { files } = await page.evaluate(
      (watchFolderId) => window.astrotracker.invoke('files.listByWatchFolder', { watchFolderId }),
      folder.id,
    );
    expect(files[0]?.filename).toBe(basename);
    expect(files[0]?.watchFolderId).toBe(folder.id);
  } finally {
    await seeded.cleanup();
  }
});

test('a burst of writes within one debounce window produces exactly one scan job', async ({
  electronApp,
}) => {
  test.setTimeout(60_000);
  const page = await electronApp.app.firstWindow();
  const seeded = await createTempLibraryDir(); // empty — nothing pre-seeded

  try {
    const folder = await page.evaluate(
      (folderPath) => window.astrotracker.invoke('watchFolders.add', { path: folderPath }),
      seeded.path,
    );

    await page.evaluate(
      (id) => window.astrotracker.invoke('watchFolders.setLiveWatch', { id, enabled: true }),
      folder.id,
    );

    // Let the immediate catch-up scan WatchManager fires on enable (against
    // the still-empty directory) reach a terminal status before measuring
    // the burst's job-count delta, so the catch-up job is never counted as
    // part of the burst's own +1.
    await expect
      .poll(
        async () => {
          const jobs = await page.evaluate(() => window.astrotracker.invoke('jobs.list'));
          return jobs.filter(
            (job) => job.jobType === 'scan' && job.status !== 'queued' && job.status !== 'running',
          ).length;
        },
        { timeout: 20_000, intervals: [200, 500, 1000, 2000] },
      )
      .toBeGreaterThanOrEqual(1);

    const jobsBefore = await page.evaluate(() => window.astrotracker.invoke('jobs.list'));
    const scanCountBefore = jobsBefore.filter((job) => job.jobType === 'scan').length;

    // Rapid burst of 3 file drops, well within the 300ms shrunk debounce window.
    const burstFixtures = [
      'fits/apt/apt-ccd-light.fits',
      'xisf/minimal-unit.xisf',
      'raw/canon-6d-light.cr2',
    ] as const;
    await Promise.all(burstFixtures.map((fixture) => dropFixture(seeded.path, fixture)));

    // Cataloging happened: one files row per burst file.
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
        { timeout: 20_000, intervals: [200, 500, 1000, 2000] },
      )
      .toBe(burstFixtures.length);

    // Debounced into exactly one pipeline batch, not one job per file.
    await expect
      .poll(
        async () => {
          const jobs = await page.evaluate(() => window.astrotracker.invoke('jobs.list'));
          return jobs.filter((job) => job.jobType === 'scan').length - scanCountBefore;
        },
        { timeout: 20_000, intervals: [200, 500, 1000, 2000] },
      )
      .toBe(1);
  } finally {
    await seeded.cleanup();
  }
});
