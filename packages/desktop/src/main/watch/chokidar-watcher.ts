/**
 * Real chokidar adapter (P1-09, DD-004 "watch mode: chokidar watches active
 * folders"). Thin wrapper: constructs `chokidar.watch(rootPath, options)`
 * with the fixed options this plan requires and re-exposes it through the
 * {@link WatcherLike} DI seam so `watch-manager.ts` never imports chokidar's
 * own types directly.
 *
 * Non-destructive (CLAUDE.md): this module only subscribes to chokidar's
 * `add`/`change`/`unlink`/`error` notifications — it never calls a write/
 * rename/unlink/move API. All actual file reads for cataloging happen in the
 * existing, unmodified `scan-job.ts` walker, triggered later via
 * `WatchManager`'s debounced `enqueueScan`.
 */
import { realpathSync } from 'node:fs';
import path from 'node:path';

import { SUPPORTED_EXTENSION_SET } from '@astrotracker/core';
import { watch as chokidarWatch } from 'chokidar';

import type { WatcherFactory, WatcherFactoryOptions, WatcherLike } from './types.js';

/**
 * Baked-in skip that caller-supplied `skipPatterns` extend (not replace) —
 * same baked-in default `scan-job.ts` applies.
 */
const ALWAYS_SKIP = ['node_modules'];

/**
 * Resolves `rootPath` to its OS-canonical form before it's handed to
 * chokidar's native fs-event backend, Windows-only (P1-09 CI fix). Windows
 * can hand back a directory in an 8.3 short-name form (e.g. a CI runner's
 * `RUNNER~1` alias for `runneradmin`) that doesn't case-insensitively match
 * the long-form path libuv later reports for an event under it — tripping a
 * native assertion (`fs-event.c:72`) that crashes the whole process, not
 * just the one watch. `realpathSync.native` resolves that 8.3 aliasing the
 * same way `GetFinalPathNameByHandle` would.
 *
 * Deliberately gated to `win32`: chokidar constructs every event's `filePath`
 * by joining the exact root it was given, so canonicalizing also changes
 * what callers see in `on('add'|'change'|'unlink', filePath)` (e.g. resolves
 * macOS's `/var` → `/private/var` symlink) — a real, if usually harmless,
 * behavior change. `WatchManager` never reads these paths (they only trigger
 * `scheduleDebounce`; the actual catalog walk is `scan-job.ts` re-rooted from
 * the DB's stored `folder.path`), so it's safe everywhere, but there's no
 * reason to pay for the surprise on platforms that don't have this bug.
 *
 * Falls back to the original `rootPath` if realpath resolution fails (e.g.
 * a race where the folder was removed between `watchFolders.add`'s
 * existence check and this call) — chokidar's own `'error'` handling covers
 * a subsequently-missing directory; this function must never throw.
 */
function toWatchablePath(rootPath: string): string {
  if (process.platform !== 'win32') {
    return rootPath;
  }
  try {
    return realpathSync.native(rootPath);
  } catch {
    return rootPath;
  }
}

/** Lowercased extension without leading dot, or `null` if the basename has none. */
function extensionOf(basename: string): string | null {
  const ext = path.extname(basename);
  if (ext === '') {
    return null;
  }
  return ext.slice(1).toLowerCase();
}

/**
 * True when any path segment *below `rootPath`* is hidden (dot-prefixed) or
 * matches a baked-in/caller-supplied skip name — mirrors `scan-job.ts`'s
 * per-dirent skip check, which only ever tests names it discovered by walking
 * under the root.
 *
 * Root-relative is load-bearing, not a detail. Testing the whole absolute path
 * meant a watch folder the user legitimately chose, like `~/.astro/lights`,
 * had a dot-prefixed *ancestor* and so ignored its own root and every event
 * under it: chokidar installed a watch that could never fire, while
 * `scan-job.ts` walked the identical tree happily. `enterWatching` still
 * reported mode `watching` and the catch-up-on-attach scan still ran, so the
 * folder looked alive and silently missed every frame captured afterwards.
 *
 * A path outside `rootPath` (which chokidar should never report) is treated as
 * skipped: `path.relative` escapes it with `..` segments, and something that is
 * not under the root has no business entering the pipeline.
 */
function isSkippedByName(
  rootPath: string,
  filePath: string,
  skipNames: ReadonlySet<string>,
): boolean {
  const relative = path.relative(rootPath, filePath);
  // The root itself: `path.relative(x, x)` is ''. Never skip the user's own
  // watch folder — chokidar tests the root before installing its watch.
  if (relative === '') {
    return false;
  }
  const segments = relative.split(/[\\/]/);
  return segments.some(
    (segment) =>
      segment !== '' &&
      (segment === '..' || segment.startsWith('.') || skipNames.has(segment.toLowerCase())),
  );
}

/**
 * Builds chokidar's `ignored` predicate from the union of
 * {@link SUPPORTED_EXTENSION_SET}, the folder's `skipPatterns`, and the
 * baked-in dotfile/`node_modules` skip (P1-09 Step 3). Extension-gating only
 * applies to basenames that actually have an extension — a directory path
 * (no extension) is never ignored on that basis, so the walk still descends
 * into it (mirrors `scan-job.ts`'s directory-vs-file branching).
 *
 * `rootPath` is required because the dotfile/skip-name test is root-relative:
 * see {@link isSkippedByName} for why testing the absolute path silently
 * disabled live watch for any folder with a dot-prefixed ancestor.
 *
 * Exported standalone so it's unit-testable without constructing a real
 * chokidar watcher or touching the filesystem.
 */
export function createIgnoredPredicate(
  rootPath: string,
  skipPatterns: readonly string[] = [],
): (filePath: string) => boolean {
  const skipNames = new Set([...ALWAYS_SKIP, ...skipPatterns].map((name) => name.toLowerCase()));
  return (filePath: string): boolean => {
    if (isSkippedByName(rootPath, filePath, skipNames)) {
      return true;
    }
    const ext = extensionOf(path.basename(filePath));
    if (ext === null) {
      return false;
    }
    return !SUPPORTED_EXTENSION_SET.has(ext);
  };
}

/**
 * Real {@link WatcherFactory} implementation. `ignoreInitial: true` (pre-
 * existing tree contents produce no events — `WatchManager` fires its own
 * catch-up scan instead); `followSymlinks: false` (matches `scan-job.ts`'s
 * cycle-avoidance policy); `awaitWriteFinish` with a short 2s stability
 * threshold solves the narrower "has this one file's bytes stopped changing"
 * problem — distinct from `WatchManager`'s own 30s debounce window.
 *
 * The returned {@link WatcherLike}'s `ready()` resolves on chokidar's own
 * `'ready'` event (P1-09 CI fix, see {@link WatcherLike.ready}'s doc comment)
 * — `.on('add'|'change'|'unlink'|'error', ...)` subscriptions are unaffected
 * and can be attached by the caller immediately, same tick as always;
 * `ready()` is a separate, additional listener pair that never removes or
 * shadows the caller's own subscriptions.
 *
 * `rootPath` is passed through {@link toWatchablePath} first (P1-09 CI fix)
 * so the native watch backend always installs its handle against an
 * OS-canonical path — see that function's doc comment.
 */
export const createChokidarWatcher: WatcherFactory = (
  rootPath: string,
  options: WatcherFactoryOptions,
): WatcherLike => {
  // Build the predicate against the SAME canonicalized root handed to
  // chokidar: it reports event paths by joining that exact root, so a
  // predicate rooted at the raw `rootPath` would compute bogus `..` relatives
  // on Windows 8.3 aliases (and on macOS `/var` -> `/private/var`).
  const watchablePath = toWatchablePath(rootPath);
  const ignored = createIgnoredPredicate(watchablePath, options.skipPatterns ?? []);
  const watcher = chokidarWatch(watchablePath, {
    ignoreInitial: true,
    followSymlinks: false,
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 },
    ignored: (filePath) => ignored(filePath),
  });
  // Resolves on 'ready', or on an 'error' fired before 'ready' (initial-scan
  // setup itself can fail, e.g. an immediate EMFILE/ENOSPC while chokidar is
  // still installing per-directory watches — see WatcherLike.ready's doc
  // comment for why this must not hang forever in that case). These are
  // *additional* `.once` listeners alongside whatever the caller attaches
  // via `.on(...)` right after this function returns — independent
  // registrations on the same EventEmitter, so neither set interferes with
  // or consumes events meant for the other.
  const ready = new Promise<void>((resolve) => {
    const onReady = (): void => {
      watcher.off('error', onError);
      resolve();
    };
    const onError = (): void => {
      watcher.off('ready', onReady);
      resolve();
    };
    watcher.once('ready', onReady);
    watcher.once('error', onError);
  });
  return Object.assign(watcher, { ready: () => ready });
};
