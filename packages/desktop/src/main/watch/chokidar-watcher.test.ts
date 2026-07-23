import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createChokidarWatcher, createIgnoredPredicate } from './chokidar-watcher.js';

describe('createIgnoredPredicate', () => {
  it('does not ignore a supported extension under a non-skipped directory', () => {
    const ignored = createIgnoredPredicate();
    expect(ignored('/mnt/astro/2026-01-15/Light_M31_L_300s_001.fits')).toBe(false);
    expect(ignored('/mnt/astro/2026-01-15/Light_M31_L_300s_002.CR2')).toBe(false);
  });

  it('does not ignore a plain directory path (no extension)', () => {
    const ignored = createIgnoredPredicate();
    expect(ignored('/mnt/astro/2026-01-15')).toBe(false);
  });

  it('ignores a dotfile anywhere in the path', () => {
    const ignored = createIgnoredPredicate();
    expect(ignored('/mnt/astro/.DS_Store')).toBe(true);
    expect(ignored('/mnt/astro/.git/config')).toBe(true);
  });

  it('ignores a node_modules entry', () => {
    const ignored = createIgnoredPredicate();
    expect(ignored('/mnt/astro/node_modules')).toBe(true);
    expect(ignored('/mnt/astro/node_modules/pkg/index.js')).toBe(true);
  });

  it('ignores an unsupported extension', () => {
    const ignored = createIgnoredPredicate();
    expect(ignored('/mnt/astro/notes.txt')).toBe(true);
    expect(ignored('/mnt/astro/readme.md')).toBe(true);
  });

  it('ignores a path matching a configured skipPattern', () => {
    const ignored = createIgnoredPredicate(['@eaDir', '$RECYCLE.BIN']);
    expect(ignored('/mnt/astro/@eaDir/thumb.fits')).toBe(true);
    expect(ignored('/mnt/astro/$RECYCLE.BIN/light.fits')).toBe(true);
    // Case-insensitive, matching scan-job.ts's basename comparison.
    expect(ignored('/mnt/astro/@EADIR/thumb.fits')).toBe(true);
  });

  it('does not ignore a file just because its directory name resembles a skip pattern substring', () => {
    const ignored = createIgnoredPredicate(['@eaDir']);
    // "@eaDirectory" is not an exact segment match for "@eaDir".
    expect(ignored('/mnt/astro/@eaDirectory/light.fits')).toBe(false);
  });
});

/**
 * P1-09 CI fix: `WatcherLike.ready()` must resolve once chokidar's own
 * `'ready'` event fires (verified against a real chokidar instance, not a
 * fake — the fake in `watch-manager.test.ts` only proves `WatchManager`
 * *consumes* `ready()` correctly, not that the real adapter implements it
 * correctly).
 *
 * Uses a plain `mkdtempSync(tmpdir())` path, not a pre-canonicalized one —
 * deliberately exercising `createChokidarWatcher`'s own `toWatchablePath`
 * normalization (see `chokidar-watcher.ts`), which is what keeps this block
 * from crashing the whole vitest worker on Windows CI (a native
 * `fs-event.c` assertion when the OS hands back a differently-cased/8.3
 * short-name form of the watched directory than what was passed in — see
 * that function's doc comment for the full explanation). If this block ever
 * starts failing that way again, the regression is in `toWatchablePath`,
 * not in this test.
 */
describe('createChokidarWatcher — ready()', () => {
  let dir: string | undefined;
  let watcher: ReturnType<typeof createChokidarWatcher> | undefined;

  afterEach(async () => {
    if (watcher !== undefined) {
      await watcher.close();
      watcher = undefined;
    }
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
      dir = undefined;
    }
  });

  it('resolves once chokidar has finished its initial setup', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'astro-p1-09-chokidar-ready-'));
    watcher = createChokidarWatcher(dir, {});

    // Must not hang: a real chokidar watcher against a real (empty) temp
    // directory settles quickly.
    await watcher.ready();
  });

  it('only reports an add/change/unlink event to a listener attached before ready() resolves once the write happens — no event is lost by attaching early', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'astro-p1-09-chokidar-ready-'));
    watcher = createChokidarWatcher(dir, {});

    const added: string[] = [];
    watcher.on('add', (filePath) => added.push(filePath));

    await watcher.ready();

    const target = path.join(dir, 'light.fits');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for add event')), 10_000);
      watcher?.on('add', () => {
        clearTimeout(timer);
        resolve();
      });
      writeFileSync(target, 'stub-bytes');
    });

    expect(added.some((p) => p === target)).toBe(true);
  });

  it('resolves ready() exactly once even if called/awaited from multiple places', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'astro-p1-09-chokidar-ready-'));
    watcher = createChokidarWatcher(dir, {});

    await Promise.all([watcher.ready(), watcher.ready(), watcher.ready()]);
  });
});
