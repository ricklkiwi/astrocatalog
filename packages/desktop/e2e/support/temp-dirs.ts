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
import { copyFile, mkdtemp, realpath, rm } from 'node:fs/promises';
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

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

interface SeedCopy {
  source: string;
  destination: string;
}

async function preflightSeedCopies(dir: string, seedFiles: readonly string[]): Promise<SeedCopy[]> {
  const realFixturesDir = await realpath(fixturesDir);
  const destinationBasenames = new Map<string, string>();
  const copies: SeedCopy[] = [];

  for (const seedFile of seedFiles) {
    if (path.isAbsolute(seedFile)) {
      throw new Error(`Fixture seed path must be relative: ${seedFile}`);
    }

    const source = path.resolve(fixturesDir, seedFile);
    if (!isWithin(fixturesDir, source)) {
      throw new Error(`Fixture seed path escapes fixtures/: ${seedFile}`);
    }

    const basename = path.basename(seedFile);
    if (basename === '' || basename === '.' || basename === '..') {
      throw new Error(`Fixture seed path must name a file: ${seedFile}`);
    }

    // Windows and default macOS filesystems are case-insensitive. Treat a
    // case-only duplicate as a collision on every host for deterministic CI.
    const collisionKey = basename.toLocaleLowerCase('en-US');
    const priorSeed = destinationBasenames.get(collisionKey);
    if (priorSeed !== undefined) {
      throw new Error(
        `Fixture seed basename collision for "${basename}": ${priorSeed} and ${seedFile}`,
      );
    }
    destinationBasenames.set(collisionKey, seedFile);

    const realSource = await realpath(source);
    if (!isWithin(realFixturesDir, realSource)) {
      throw new Error(`Fixture seed resolves outside fixtures/ through a symlink: ${seedFile}`);
    }

    copies.push({ source, destination: path.join(dir, basename) });
  }

  return copies;
}

async function cleanupAfterFailure(cleanup: () => Promise<void>, error: unknown): Promise<never> {
  try {
    await cleanup();
  } catch (cleanupError) {
    throw new AggregateError(
      [error, cleanupError],
      'Temp library setup failed and its partial directory could not be cleaned up',
      { cause: error },
    );
  }
  throw error;
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
    const copies = await preflightSeedCopies(dir, seedFiles ?? []);
    for (const { source, destination } of copies) {
      await copyFile(source, destination);
    }
  } catch (error) {
    return cleanupAfterFailure(cleanup, error);
  }
  return { path: dir, cleanup };
}
