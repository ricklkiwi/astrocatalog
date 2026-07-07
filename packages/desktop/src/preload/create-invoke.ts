/**
 * Whitelist-gated invoke factory for the preload bridge. Extracted from the
 * preload entry (which needs Electron's contextBridge/ipcRenderer) so the
 * gating logic is unit-testable under plain Node.
 */
import { IPC_CHANNELS, type AstroTrackerBridge } from '../ipc/contract.js';

const ALLOWED_CHANNELS: ReadonlySet<string> = new Set(IPC_CHANNELS);

/**
 * Wraps a raw `ipcRenderer.invoke` in a hard whitelist of contract channels.
 * Any channel outside the contract throws synchronously, BEFORE the call
 * reaches ipcRenderer — a compromised or buggy renderer fails closed.
 */
export function createInvoke(
  rawInvoke: (channel: string, ...args: unknown[]) => Promise<unknown>,
): AstroTrackerBridge['invoke'] {
  return ((channel: string, ...args: unknown[]) => {
    if (!ALLOWED_CHANNELS.has(channel)) {
      throw new Error(`IPC channel "${channel}" is not in the AstroTracker contract`);
    }
    return rawInvoke(channel, ...args);
  }) as AstroTrackerBridge['invoke'];
}
