/**
 * Placeholder export proving the `desktop` package sits at the right place in
 * the dependency graph (desktop -> core + db). No Electron dependency yet —
 * the Electron entry point, preload, and typed IPC land in P0-03.
 */
import { coreVersion } from '@astrotracker/core';
import { dbVersion } from '@astrotracker/db';

export const desktopVersion = '0.1.0';

/** Returns a human-readable identifier including the workspace deps it was built against. */
export function describeDesktop(): string {
  return `desktop@${desktopVersion} (core@${coreVersion}, db@${dbVersion})`;
}
