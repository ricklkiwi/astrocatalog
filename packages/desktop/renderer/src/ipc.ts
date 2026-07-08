/**
 * Thin typed client over the preload bridge. All main-process access flows
 * through here; components never touch `window.astrotracker` directly.
 * Lazily forwards so tests can install a mocked bridge before first use.
 */
import type { AstroTrackerBridge } from '@astrotracker/desktop';

export const ipc: AstroTrackerBridge = {
  invoke: (channel, ...args) => window.astrotracker.invoke(channel, ...args),
};
