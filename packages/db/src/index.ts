/**
 * Placeholder export proving the `db` package builds against `core` via the
 * workspace protocol (dependency direction: db -> core, never the reverse).
 * Real Drizzle schema/migrations/repositories land in P0-04.
 */
import { coreVersion } from '@astrotracker/core';

export const dbVersion = '0.1.0';

/** Returns a human-readable identifier including the core version db was built against. */
export function describeDb(): string {
  return `db@${dbVersion} (core@${coreVersion})`;
}
