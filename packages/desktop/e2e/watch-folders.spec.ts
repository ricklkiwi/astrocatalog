/**
 * P1-06 acceptance E2E: add a watch folder pointing at a directory seeded with
 * real capture fixtures, enqueue a scan for it, and assert that a `files` row
 * appears for each seeded file — the full renderer→main→worker→DB round trip
 * exercised entirely over the typed IPC contract.
 *
 * The seeded temp dir is created via the same `support/temp-dirs.ts` helper the
 * fixture uses (copying named fixtures from the repo's `fixtures/` tree under
 * their basename), so a scan sees a flat directory of known files.
 */
import { stat } from 'node:fs/promises';
import path from 'node:path';

import type { AstroTrackerBridge } from '../src/ipc/contract.js';
import { createTempLibraryDir } from './support/temp-dirs.js';
import { expect, test } from './fixtures.js';

/** The preload's one exposed global, as visible inside `page.evaluate`. */
declare const window: { astrotracker: AstroTrackerBridge };

const SEED_FIXTURES = [
  'fits/apt/apt-ccd-light.fits',
  'xisf/minimal-unit.xisf',
  'raw/canon-6d-light.cr2',
] as const;

test('adding a watch folder and scanning it surfaces a files row per seeded file', async ({
  electronApp,
}) => {
  const page = await electronApp.app.firstWindow();
  const seeded = await createTempLibraryDir(SEED_FIXTURES);

  try {
    const expectedByFilename = new Map<string, number>();
    for (const fixture of SEED_FIXTURES) {
      const basename = path.basename(fixture);
      const { size } = await stat(path.join(seeded.path, basename));
      expectedByFilename.set(basename, size);
    }

    // 1. Add the seeded directory as a watch folder.
    const folder = await page.evaluate(
      (folderPath) => window.astrotracker.invoke('watchFolders.add', { path: folderPath }),
      seeded.path,
    );
    expect(folder.path).toBe(seeded.path);
    expect(folder.id).toEqual(expect.any(String));

    // 2. Enqueue a scan of it.
    const { jobId } = await page.evaluate(
      (watchFolderId) => window.astrotracker.invoke('jobs.enqueueScan', { watchFolderId }),
      folder.id,
    );
    expect(jobId).toEqual(expect.any(String));

    // 3. Poll until a files row exists for each seeded fixture.
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

    // 4. Assert the discovered rows match the seeded files (name + size).
    const { files } = await page.evaluate(
      (watchFolderId) => window.astrotracker.invoke('files.listByWatchFolder', { watchFolderId }),
      folder.id,
    );

    for (const file of files) {
      expect(file.watchFolderId).toBe(folder.id);
      expect(file.relativePath).toBe(file.filename);
      const expectedSize = expectedByFilename.get(file.filename);
      expect(expectedSize, `unexpected discovered file ${file.filename}`).not.toBeUndefined();
      expect(file.sizeBytes).toBe(expectedSize);
    }
    expect(new Set(files.map((file) => file.filename))).toEqual(new Set(expectedByFilename.keys()));
  } finally {
    await seeded.cleanup();
  }
});
