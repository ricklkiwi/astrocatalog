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

import { app, BrowserWindow, ipcMain } from 'electron';

import { createIpcHandlers, registerIpcHandlers } from './ipc/register.js';

/** Set by electron-vite dev; absent in packaged/preview builds. */
const devServerUrl = process.env['ELECTRON_RENDERER_URL'];

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
  registerIpcHandlers(
    ipcMain,
    createIpcHandlers({
      appVersion: app.getVersion(),
      platform: process.platform,
      versions: process.versions,
    }),
  );

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
