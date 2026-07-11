/**
 * Per-run temp-directory helpers (plan Step 3). Every E2E run gets a fresh
 * `fs.mkdtemp` directory under the OS temp root — never a real user-data or
 * library path (non-destructive guarantee, DD-002 rule 5):
 *
 * - `createTempAppDataDir()` — passed to Electron as `--user-data-dir=<path>`
 *   (a Chromium switch Electron honors out of the box), isolating the app's
 *   profile/singleton-lock/preferences from the real OS user-data location
 *   and from parallel CI jobs.
 * - `createTempLibraryDir(seedFiles?)` — the folder a future library-folder
 *   setting points the app at; later scanning/cataloging specs seed it with
 *   real FITS/XISF/RAW files copied from the repo's `fixtures/` directory.
 *
 * Cleanup tolerates transient `EBUSY`/`EPERM` with a bounded retry — Windows
 * can hold a brief file lock (e.g. on `SingletonLock`) for a few hundred ms
 * after the Electron process exits.
 */
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

/** Repo-root `fixtures/` directory (seed-file source for the library dir). */
const fixturesDir = path.join(import.meta.dirname, '../../../../fixtures');

const CLEANUP_MAX_ATTEMPTS = 5;
const CLEANUP_RETRY_BASE_MS = 100;

export interface TempDir {
  /** Absolute path of the freshly created directory. */
  path: string;
  /** Recursively removes the directory (bounded EBUSY/EPERM retry). */
  cleanup: () => Promise<void>;
}

function isTransientFsError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'EBUSY' || code === 'EPERM';
}

function makeCleanup(dir: string): () => Promise<void> {
  return async () => {
    for (let attempt = 1; ; attempt += 1) {
      try {
        await rm(dir, { recursive: true, force: true });
        return;
      } catch (error) {
        if (attempt >= CLEANUP_MAX_ATTEMPTS || !isTransientFsError(error)) {
          throw error;
        }
        await delay(CLEANUP_RETRY_BASE_MS * attempt);
      }
    }
  };
}

/**
 * Fresh temp directory for Electron's `--user-data-dir` switch — unique per
 * call, so concurrent/sequential runs can never collide or see each other.
 */
export async function createTempAppDataDir(): Promise<TempDir> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'astrotracker-e2e-appdata-'));
  return { path: dir, cleanup: makeCleanup(dir) };
}

/**
 * Fresh temp directory representing a user's image-library folder, optionally
 * seeded by copying the named files from the repo's `fixtures/` directory
 * (e.g. `['fits/nina/…', 'xisf/minimal-unit.xisf']`; each lands in the temp
 * dir under its basename). A missing seed file rejects loudly (`ENOENT` from
 * `copyFile`) — it is never silently skipped.
 */
export async function createTempLibraryDir(seedFiles?: readonly string[]): Promise<TempDir> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'astrotracker-e2e-library-'));
  const cleanup = makeCleanup(dir);
  try {
    for (const seedFile of seedFiles ?? []) {
      await copyFile(path.join(fixturesDir, seedFile), path.join(dir, path.basename(seedFile)));
    }
  } catch (error) {
    await cleanup();
    throw error;
  }
  return { path: dir, cleanup };
}
