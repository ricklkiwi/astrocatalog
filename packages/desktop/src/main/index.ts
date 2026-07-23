/**
 * Electron main-process entry (P0-03).
 *
 * Security posture (DD-002: the renderer is a pure UI client):
 * - contextIsolation + sandbox on, nodeIntegration off, webSecurity untouched (on)
 * - all window.open requests denied; navigation locked to the app's own origin
 * - dev loads the electron-vite dev-server URL; packaged loads the bundled
 *   renderer index.html resolved relative to this module (never process.cwd()).
 */
import path from 'node:path';
import os from 'node:os';
import { stat } from 'node:fs/promises';

import { SUPPORTED_EXTENSIONS } from '@astrotracker/core';
import { openDatabase, type AstroDatabase, type WatchFolder } from '@astrotracker/db';
import { app, BrowserWindow, ipcMain } from 'electron';

import type { WatchFolderRecord } from '../ipc/contract.js';
import { detectDriveLabel } from './drive-label.js';

import { createJobQueueOrchestrator, type JobQueueOrchestrator } from './jobs/orchestrator.js';
import { createWorkerPool, type WorkerPool } from './jobs/pool.js';
import { broadcastIpcEvent, toIpcJobProgressEvent } from './ipc/broadcast.js';
import { createIpcHandlers, registerIpcHandlers } from './ipc/register.js';
import { runNativeSmoke } from './native-smoke.js';
import { createChokidarWatcher } from './watch/chokidar-watcher.js';
import { createWatchManager, type WatchManager } from './watch/watch-manager.js';

// Packaged builds already get this from electron-builder's `productName`
// (read from the bundle's metadata before this module runs). Unpackaged
// `pnpm dev` has no such metadata, so Electron falls back to the nearest
// package.json's `name` — the scoped `@astrotracker/desktop`, which macOS
// treats the `/` in as a path separator, splitting `app.getPath('userData')`
// into a nested `@astrotracker/desktop/` folder instead of `AstroTracker/`.
// Setting it explicitly keeps the userData location (and therefore
// astrotracker.db's path) identical between `pnpm dev` and a packaged build.
// Must run before any `app.getPath(...)` call, which caches the resolved path.
app.setName('AstroTracker');

/** Set by electron-vite dev; absent in packaged/preview builds. */
const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
let database: AstroDatabase | undefined;
let orchestrator: JobQueueOrchestrator | undefined;
let pool: WorkerPool | undefined;
let watchManager: WatchManager | undefined;

/** DD-004 defaults: 30s debounce, 5min fallback rescan interval. */
const DEFAULT_WATCH_DEBOUNCE_MS = 30_000;
const DEFAULT_WATCH_FALLBACK_INTERVAL_MS = 300_000;

/**
 * Reads a positive-integer override from `process.env[name]`, falling back
 * to `fallback` on a missing or invalid (non-numeric, non-positive) value —
 * the same single-env-var-override pattern already used for
 * `ELECTRON_RENDERER_URL` below. Lets tests/E2E shrink the debounce/fallback
 * windows without a real 30s/5min wait.
 */
function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

/** Parses the JSON `skip_patterns` column defensively — `null` when unset or unparseable. */
function readSkipPatterns(row: WatchFolder): string[] | null {
  if (typeof row.skipPatterns !== 'string') {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(row.skipPatterns);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === 'string') : null;
  } catch {
    return null;
  }
}

/** Maps a DB `watch_folders` row to the IPC-facing record (parsing `skip_patterns`). */
function toWatchFolderRecord(row: WatchFolder): WatchFolderRecord {
  return {
    id: row.id,
    path: row.path,
    driveLabel: row.driveLabel,
    isActive: row.isActive,
    lastScanAt: row.lastScanAt,
    skipPatterns: readSkipPatterns(row),
    liveWatchEnabled: row.liveWatchEnabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function isAllowedNavigation(url: string): boolean {
  if (devServerUrl !== undefined) {
    try {
      return new URL(url).origin === new URL(devServerUrl).origin;
    } catch {
      return false;
    }
  }
  // Packaged: only the bundled renderer files may be navigated to.
  return url.startsWith('file://');
}

function createWindow(): void {
  const window = new BrowserWindow({
    width: 960,
    height: 640,
    show: false,
    webPreferences: {
      preload: path.join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  // Deny every new-window request; the app is single-window.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Deny navigation away from the app's own origin (dev server or file://).
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) {
      event.preventDefault();
    }
  });

  window.on('ready-to-show', () => {
    window.show();
  });

  if (devServerUrl !== undefined) {
    void window.loadURL(devServerUrl);
  } else {
    // Resolved relative to the bundled main module inside the asar, never cwd.
    void window.loadFile(path.join(import.meta.dirname, '../renderer/index.html'));
  }
}

void app.whenReady().then(() => {
  database = openDatabase({ filePath: path.join(app.getPath('userData'), 'astrotracker.db') });
  orchestrator = createJobQueueOrchestrator({
    scanJobs: database.repos.scanJobs,
    files: database.repos.files,
    frames: database.repos.frames,
    watchFolders: database.repos.watchFolders,
    transaction: (fn) => database!.transaction(() => fn()),
    createPool: (callbacks) => {
      pool = createWorkerPool(Math.min(4, Math.max(1, os.cpus().length - 1)), callbacks);
      return pool;
    },
  });
  orchestrator.onEvent((event) => {
    broadcastIpcEvent(
      () => BrowserWindow.getAllWindows().map((window) => window.webContents),
      'jobs.progress',
      toIpcJobProgressEvent(event),
    );
  });

  watchManager = createWatchManager({
    debounceMs: readPositiveIntEnv('ASTROTRACKER_WATCH_DEBOUNCE_MS', DEFAULT_WATCH_DEBOUNCE_MS),
    fallbackRescanIntervalMs: readPositiveIntEnv(
      'ASTROTRACKER_WATCH_FALLBACK_INTERVAL_MS',
      DEFAULT_WATCH_FALLBACK_INTERVAL_MS,
    ),
    createWatcher: createChokidarWatcher,
    enqueueScan: (input) => orchestrator!.enqueueScan(input),
    onJobEvent: (listener) => orchestrator!.onEvent(listener),
    onStatusChange: (event) => {
      broadcastIpcEvent(
        () => BrowserWindow.getAllWindows().map((window) => window.webContents),
        'watch.status',
        event,
      );
    },
    extensions: SUPPORTED_EXTENSIONS,
  });

  registerIpcHandlers(
    ipcMain,
    createIpcHandlers({
      appVersion: app.getVersion(),
      platform: process.platform,
      versions: process.versions,
      nativeSmoke: runNativeSmoke,
      jobs: {
        enqueueDemo: (input) => orchestrator!.enqueueDemo(input),
        cancel: (jobId) => orchestrator!.cancel(jobId),
        list: () => orchestrator!.list(),
        enqueueScan: ({ watchFolderId }) => {
          const folder = database!.repos.watchFolders.getById(watchFolderId);
          if (folder === undefined) {
            throw new Error(`Unknown watch folder: ${watchFolderId}`);
          }
          const skipPatterns = readSkipPatterns(folder);
          return orchestrator!.enqueueScan({
            watchFolderId: folder.id,
            rootPath: folder.path,
            extensions: [...SUPPORTED_EXTENSIONS],
            skipPatterns: skipPatterns ?? undefined,
          });
        },
      },
      watchFolders: {
        list: () => database!.repos.watchFolders.list().map(toWatchFolderRecord),
        add: async ({ path: folderPath, skipPatterns }) => {
          let stats;
          try {
            stats = await stat(folderPath);
          } catch {
            throw new Error(`Watch-folder path does not exist or is not accessible: ${folderPath}`);
          }
          if (!stats.isDirectory()) {
            throw new Error(`Watch-folder path is not a directory: ${folderPath}`);
          }
          const driveLabel = await detectDriveLabel(folderPath);
          const row = database!.repos.watchFolders.insert({
            path: folderPath,
            driveLabel,
            isActive: true,
            lastScanAt: null,
            skipPatterns: skipPatterns === undefined ? null : JSON.stringify(skipPatterns),
          });
          // Register the folder's rootPath/skipPatterns with WatchManager so
          // a later setLiveWatch(id, true) call (no restart needed) can
          // resolve them — every new folder is created watch-disabled
          // (P1-09: watchFolders.add gains no liveWatchEnabled field).
          watchManager?.registerFolder({
            id: row.id,
            rootPath: row.path,
            skipPatterns: readSkipPatterns(row) ?? undefined,
          });
          return toWatchFolderRecord(row);
        },
        remove: (id) => {
          // Tear down the runtime watcher/timers before removing the row —
          // no watcher left running against a folder whose row no longer
          // exists.
          watchManager?.stop(id);
          return database!.repos.watchFolders.remove(id);
        },
        setLiveWatch: (id, enabled) => {
          const updated = database!.repos.watchFolders.update(id, { liveWatchEnabled: enabled });
          if (updated === undefined) {
            throw new Error(`Unknown watch folder: ${id}`);
          }
          watchManager?.setEnabled(id, enabled);
          return toWatchFolderRecord(updated);
        },
      },
      files: {
        listByWatchFolder: (watchFolderId) =>
          database!.repos.files.list().filter((file) => file.watchFolderId === watchFolderId),
      },
    }),
  );

  orchestrator.start();
  // Every isActive watch-folder row is registered (so a later setLiveWatch
  // can resolve its rootPath); only isActive && liveWatchEnabled ones get a
  // live watcher attached (P1-09).
  const bootFolders = database.repos.watchFolders
    .list()
    .filter((folder) => folder.isActive)
    .map((folder) => ({
      id: folder.id,
      rootPath: folder.path,
      skipPatterns: readSkipPatterns(folder) ?? undefined,
      enabled: folder.liveWatchEnabled,
    }));
  watchManager.start(bootFolders);
  createWindow();

  // macOS convention: re-create the window on dock activation.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// macOS convention: closing all windows does not quit the app.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  void watchManager?.stopAll();
  void pool?.terminateAll();
  try {
    database?.close();
  } catch {
    // Best effort shutdown; orphaned running jobs are requeued at next boot.
  }
});
