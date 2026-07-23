/**
 * The live-watch state machine (P1-09, DD-004 "watch mode"). Owns one
 * chokidar-backed watcher per actively-watched folder, a per-folder 30s
 * debounce timer (manual `setTimeout`, reset on every qualifying fs event),
 * and per-folder in-flight tracking so a scan job already queued/running for
 * a folder is never duplicated by a second debounce firing.
 *
 * Non-destructive (CLAUDE.md): this module never writes/moves/renames/
 * deletes anything. It only (a) subscribes to a {@link WatcherLike}'s
 * `add`/`change`/`unlink`/`error` notifications and (b) calls the injected
 * `enqueueScan` — the same function `orchestrator.enqueueScan` already is —
 * to hand real file reads off to the existing, unmodified `scan-job.ts`
 * walker. No fs write/rename/unlink/move call anywhere in this file.
 *
 * DB-free by design: this module never imports `@astrotracker/db`. It keeps
 * its own small in-memory registry of `{ id, rootPath, skipPatterns }`,
 * populated by `start()` (initial boot-time folders) and `registerFolder()`
 * (a folder added after boot) — both called from `main/index.ts`, the sole
 * place that talks to the database.
 */
import type { JobProgressEvent } from '../jobs/orchestrator.js';
import type { WatchMode, WatchStatusEvent } from '../../ipc/contract.js';
import type { WatcherFactory, WatcherLike } from './types.js';

/** Terminal `scan_jobs.status` values (DD-003 `infra.ts` CHECK constraint). */
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

/** chokidar error codes that mean "OS watcher-limit exhausted", not "root vanished". */
const WATCHER_LIMIT_ERROR_CODES = new Set(['ENOSPC', 'EMFILE', 'ENFILE']);

/** A folder's static identity, as far as `WatchManager` needs to know it. */
export interface WatchManagerFolder {
  id: string;
  rootPath: string;
  skipPatterns?: string[];
}

/** One `Enqueue`d watch-triggered scan's outcome, matching `JobQueueOrchestrator.enqueueScan`'s output. */
export interface EnqueueScanResult {
  jobId: string;
}

/** Matches `JobQueueOrchestrator.enqueueScan`'s input shape exactly — `main/index.ts` binds this directly to `orchestrator.enqueueScan`. */
export interface EnqueueScanInput {
  watchFolderId: string;
  rootPath: string;
  extensions: string[];
  skipPatterns?: string[];
}

export interface CreateWatchManagerOptions {
  /** Reset on every qualifying fs event; fires `enqueueScan` when quiet (DD-004 default 30_000). */
  debounceMs: number;
  /** Periodic-rescan interval used once a folder falls back from a watcher-limit error (default 300_000). */
  fallbackRescanIntervalMs: number;
  /** Real: `createChokidarWatcher`. Tests: a fake synthesizing events/errors. */
  createWatcher: WatcherFactory;
  /** Bound directly to `orchestrator.enqueueScan` in production. */
  enqueueScan(input: EnqueueScanInput): EnqueueScanResult;
  /** Bound directly to `orchestrator.onEvent` in production — used to detect in-flight/terminal status for jobs *this* manager enqueued. */
  onJobEvent(listener: (event: JobProgressEvent) => void): () => void;
  /** Invoked on every mode transition, `updatedAt` stamped with `new Date()` at call time. */
  onStatusChange(event: WatchStatusEvent): void;
  /** Lowercase extensions, no leading dot — defaults to every file type the scanner supports. Overridable for tests. */
  extensions: readonly string[];
}

export interface WatchManager {
  /** Registers every given folder and attaches a watcher (+ catch-up scan) for each with `enabled: true`. */
  start(folders: Array<WatchManagerFolder & { enabled: boolean }>): void;
  /** Registers a folder's metadata without attaching a watcher — for a folder added after `start()` (P1-09: new folders are created watch-disabled). */
  registerFolder(folder: WatchManagerFolder): void;
  /**
   * Toggles live watching for an already-registered folder. Idempotent.
   *
   * The returned promise resolves once the underlying watcher has confirmed
   * readiness (chokidar's own `'ready'` event, see `WatcherLike.ready`'s doc
   * comment) when `enabled` is `true` — immediately when `enabled` is
   * `false`. Callers that need "a file written right now will reliably be
   * seen" (e.g. `watchFolders.setLiveWatch`'s IPC handler) must await this
   * rather than treat the *call* returning as the folder being live: chokidar
   * itself needs to finish its initial recursive scan and OS watch-handle
   * setup first, which is not instantaneous — especially on Windows, where
   * `ReadDirectoryChangesW` setup plus slow CI-runner disk I/O can add
   * meaningful latency (P1-09 CI fix — a fast-following write lost this race
   * on Windows CI before this method awaited readiness).
   */
  setEnabled(watchFolderId: string, enabled: boolean): Promise<void>;
  /** Tears down a folder's watcher/timers and forgets it (used by `watchFolders.remove`). Does not cancel an in-flight scan job. */
  stop(watchFolderId: string): void;
  /** Tears down every folder's watcher/timers. Awaited on `before-quit`. */
  stopAll(): Promise<void>;
}

interface FolderState {
  rootPath: string;
  skipPatterns?: string[];
  mode: WatchMode;
  watcher: WatcherLike | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  fallbackTimer: ReturnType<typeof setInterval> | null;
  /** jobId of a watch-triggered scan not yet at a terminal status, or `null`. */
  inFlightJobId: string | null;
  /** Set when a firing is suppressed because a watch-triggered scan is already in flight. */
  pendingRescan: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createWatchManager(options: CreateWatchManagerOptions): WatchManager {
  const { debounceMs, fallbackRescanIntervalMs, createWatcher, enqueueScan, extensions } = options;
  const folders = new Map<string, FolderState>();

  function emitStatus(id: string, mode: WatchMode, message: string | null): void {
    options.onStatusChange({ watchFolderId: id, mode, message, updatedAt: nowIso() });
  }

  /**
   * The single in-flight-guarded entry point every scan trigger (debounce
   * fire, catch-up-on-attach, fallback tick, deferred-after-terminal) routes
   * through: at most one watch-triggered `enqueueScan` in flight per folder
   * at a time; a firing while one is already in flight just requests a
   * deferred rerun instead of dropping or duplicating it.
   */
  function requestScan(id: string): void {
    const state = folders.get(id);
    if (state === undefined) {
      return;
    }
    if (state.inFlightJobId !== null) {
      state.pendingRescan = true;
      return;
    }
    const { jobId } = enqueueScan({
      watchFolderId: id,
      rootPath: state.rootPath,
      extensions: [...extensions],
      ...(state.skipPatterns !== undefined ? { skipPatterns: state.skipPatterns } : {}),
    });
    state.inFlightJobId = jobId;
    state.pendingRescan = false;
  }

  function scheduleDebounce(id: string): void {
    const state = folders.get(id);
    if (state === undefined) {
      return;
    }
    if (state.debounceTimer !== null) {
      clearTimeout(state.debounceTimer);
    }
    state.debounceTimer = setTimeout(() => {
      state.debounceTimer = null;
      requestScan(id);
    }, debounceMs);
  }

  function clearFolderTimers(state: FolderState): void {
    if (state.debounceTimer !== null) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
    }
    if (state.fallbackTimer !== null) {
      clearInterval(state.fallbackTimer);
      state.fallbackTimer = null;
    }
  }

  function handleWatcherError(id: string, error: unknown): void {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === undefined || !WATCHER_LIMIT_ERROR_CODES.has(code)) {
      // Disconnected/missing root (typically ENOENT) or any other error: log
      // only, no mode transition, no fallback — matches the plan's Edge
      // Cases "disconnected/missing watch-folder root" handling.
      console.error(`[watch] folder ${id}: watcher error (no fallback)`, error);
      return;
    }
    enterFallback(id, `Live watch disabled after a ${code} error; periodic rescanning instead.`);
  }

  /**
   * Attaches (or, if already watching, no-ops on) a folder's watcher.
   *
   * State transitions (mode → 'watching', the status event, the immediate
   * catch-up scan) all happen synchronously, same as before P1-09's CI fix —
   * changing that would ripple into every timing-sensitive test in this
   * file for no behavioral gain. What's new is the *returned* promise: it
   * resolves only once the watcher itself confirms readiness, so a caller
   * that needs to know "is it now actually safe to assume a write will be
   * seen" (`setEnabled` → `watchFolders.setLiveWatch`'s IPC handler) has a
   * signal to await, instead of racing chokidar's own async setup.
   */
  function attachWatcher(id: string): Promise<void> {
    const state = folders.get(id);
    if (state === undefined) {
      return Promise.resolve();
    }
    if (state.mode === 'watching') {
      // Already watching: idempotent, no duplicate chokidar instance.
      return state.watcher?.ready() ?? Promise.resolve();
    }
    clearFolderTimers(state);
    const watcher = createWatcher(state.rootPath, { skipPatterns: state.skipPatterns });
    watcher.on('add', () => scheduleDebounce(id));
    watcher.on('change', () => scheduleDebounce(id));
    watcher.on('unlink', () => scheduleDebounce(id));
    watcher.on('error', (error) => handleWatcherError(id, error));
    state.watcher = watcher;
    state.mode = 'watching';
    emitStatus(id, 'watching', null);
    // ignoreInitial: true means chokidar reports nothing for pre-existing
    // tree contents at attach time — fire one immediate catch-up scan
    // (Edge Cases: "app restarted / live-watch just toggled on").
    requestScan(id);
    return watcher.ready();
  }

  function enterFallback(id: string, message: string): void {
    const state = folders.get(id);
    if (state === undefined) {
      return;
    }
    if (state.watcher !== null) {
      void state.watcher.close();
      state.watcher = null;
    }
    clearFolderTimers(state);
    state.mode = 'fallback';
    state.fallbackTimer = setInterval(() => requestScan(id), fallbackRescanIntervalMs);
    emitStatus(id, 'fallback', message);
  }

  function deactivate(id: string): void {
    const state = folders.get(id);
    if (state === undefined) {
      return;
    }
    if (state.watcher !== null) {
      void state.watcher.close();
      state.watcher = null;
    }
    clearFolderTimers(state);
    const wasOff = state.mode === 'off';
    state.mode = 'off';
    if (!wasOff) {
      emitStatus(id, 'off', null);
    }
  }

  // Detects in-flight → terminal transitions for jobs *this manager*
  // enqueued (JobProgressEvent carries no watchFolderId — see plan Edge
  // Cases — so we track by jobId ourselves).
  options.onJobEvent((event) => {
    if (!TERMINAL_STATUSES.has(event.status)) {
      return;
    }
    for (const [id, state] of folders) {
      if (state.inFlightJobId !== event.jobId) {
        continue;
      }
      state.inFlightJobId = null;
      if (state.pendingRescan) {
        state.pendingRescan = false;
        requestScan(id);
      }
      break;
    }
  });

  function upsertFolder(folder: WatchManagerFolder): FolderState {
    const existing = folders.get(folder.id);
    if (existing !== undefined) {
      existing.rootPath = folder.rootPath;
      existing.skipPatterns = folder.skipPatterns;
      return existing;
    }
    const state: FolderState = {
      rootPath: folder.rootPath,
      skipPatterns: folder.skipPatterns,
      mode: 'off',
      watcher: null,
      debounceTimer: null,
      fallbackTimer: null,
      inFlightJobId: null,
      pendingRescan: false,
    };
    folders.set(folder.id, state);
    return state;
  }

  return {
    start(inputFolders): void {
      for (const folder of inputFolders) {
        upsertFolder(folder);
        if (folder.enabled) {
          // Boot-time attachment: fire-and-forget, same as before P1-09's CI
          // fix — nothing here needs to block app startup on chokidar's
          // per-folder readiness. (Callers that need the readiness signal —
          // `setEnabled` below — get it via its own returned promise.)
          void attachWatcher(folder.id);
        }
      }
    },

    registerFolder(folder): void {
      upsertFolder(folder);
    },

    setEnabled(watchFolderId, enabled): Promise<void> {
      if (enabled) {
        return attachWatcher(watchFolderId);
      }
      deactivate(watchFolderId);
      return Promise.resolve();
    },

    stop(watchFolderId): void {
      const state = folders.get(watchFolderId);
      if (state === undefined) {
        return;
      }
      if (state.watcher !== null) {
        void state.watcher.close();
      }
      clearFolderTimers(state);
      folders.delete(watchFolderId);
    },

    async stopAll(): Promise<void> {
      const closes: Array<Promise<void>> = [];
      for (const state of folders.values()) {
        clearFolderTimers(state);
        if (state.watcher !== null) {
          closes.push(state.watcher.close());
          state.watcher = null;
        }
      }
      folders.clear();
      await Promise.all(closes);
    },
  };
}
