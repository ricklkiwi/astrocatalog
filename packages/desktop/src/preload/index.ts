/**
 * Sandboxed preload (emitted as CJS — a `sandbox: true` preload cannot use
 * the ESM loader). Exposes exactly ONE global, `window.astrotracker`, whose
 * only member is a whitelist-gated `invoke` over the typed IPC contract.
 * Nothing else from Node or Electron is reachable from the page.
 */
import { contextBridge, ipcRenderer } from 'electron';

import type { AstroTrackerBridge } from '../ipc/contract.js';
import { createInvoke } from './create-invoke.js';
import { createListen } from './create-listen.js';

const bridge: AstroTrackerBridge = {
  invoke: createInvoke((channel, ...args) => ipcRenderer.invoke(channel, ...args)),
  on: createListen(
    (channel, listener) => ipcRenderer.on(channel, listener),
    (channel, listener) => ipcRenderer.removeListener(channel, listener),
  ),
};

contextBridge.exposeInMainWorld('astrotracker', bridge);
