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

import { openDatabase, type AstroDatabase } from '@astrotracker/db';
import { app, BrowserWindow, ipcMain } from 'electron';

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
