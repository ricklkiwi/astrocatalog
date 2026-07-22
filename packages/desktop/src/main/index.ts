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

/** Set by electron-vite dev; absent in packaged/preview builds. */
const devServerUrl = process.env['ELECTRON_RENDERER_URL'];
let database: AstroDatabase | undefined;
let orchestrator: JobQueueOrchestrator | undefined;
let pool: WorkerPool | undefined;

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
          return toWatchFolderRecord(row);
        },
        remove: (id) => database!.repos.watchFolders.remove(id),
      },
      files: {
        listByWatchFolder: (watchFolderId) =>
          database!.repos.files.list().filter((file) => file.watchFolderId === watchFolderId),
      },
    }),
  );

  orchestrator.start();
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
  void pool?.terminateAll();
  try {
    database?.close();
  } catch {
    // Best effort shutdown; orphaned running jobs are requeued at next boot.
  }
});
