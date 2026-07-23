/**
 * The DI seam between `watch-manager.ts` and the real chokidar adapter
 * (`chokidar-watcher.ts`) vs. a fake for unit tests (P1-09). `WatchManager`
 * depends only on these interfaces, never on chokidar's own types, so its
 * tests never spin a real filesystem watcher or touch disk.
 */

/** The fs-change event names `WatchManager` subscribes to. */
export type WatchFsEvent = 'add' | 'change' | 'unlink';

/**
 * Minimal surface `WatchManager` needs from a chokidar-like watcher instance.
 * Non-destructive by construction: this interface exposes no write/rename/
 * unlink capability — only change *notifications* and lifecycle teardown.
 */
export interface WatcherLike {
  on(event: WatchFsEvent, listener: (path: string) => void): void;
  /**
   * A chokidar `'error'` event. `error` is `unknown` (matching chokidar's own
   * error-handler typing) — the caller narrows to `NodeJS.ErrnoException` to
   * read `.code` (`ENOSPC`/`EMFILE`/`ENFILE` trigger the fallback path).
   */
  on(event: 'error', listener: (error: unknown) => void): void;
  /**
   * Resolves once the watcher's initial setup has settled — for the real
   * chokidar adapter, chokidar's own `'ready'` event (initial recursive scan
   * + OS watch-handle setup, e.g. `ReadDirectoryChangesW` on Windows), or an
   * `'error'` during that setup, whichever comes first (so a caller awaiting
   * this can never hang forever on a setup failure). Before this resolves,
   * event delivery for a file written into the tree isn't reliably
   * guaranteed — `WatchManager` awaits it before reporting a folder as
   * `'watching'`, closing a race where a fast-following write loses to slow
   * watch-handle setup (observed on Windows CI runners, P1-09).
   */
  ready(): Promise<void>;
  /** Stops watching and releases OS resources. Never throws for a normal close. */
  close(): Promise<void>;
}

/** Options passed to a {@link WatcherFactory} when constructing a folder's watcher. */
export interface WatcherFactoryOptions {
  /**
   * Additional basename skip patterns beyond the built-in defaults
   * (hidden/dot-prefixed entries, `node_modules`) — mirrors `scan-job.ts`'s
   * `payload.skipPatterns` (P1-06, DD-004).
   */
  skipPatterns?: string[];
}

/**
 * Constructs a {@link WatcherLike} rooted at `rootPath`. The real
 * implementation (`chokidar-watcher.ts`) wraps `chokidar.watch(...)`; unit
 * tests inject a fake that synthesizes events/errors without any real
 * filesystem watcher.
 */
export type WatcherFactory = (rootPath: string, options: WatcherFactoryOptions) => WatcherLike;
