/**
 * Placeholder export proving the `renderer` package builds independently of
 * core/db/desktop — the renderer only ever reaches the main process over the
 * typed IPC contract (added in P0-03), so it has no workspace dependency edges.
 * React/Vite tooling lands in P0-03.
 */
export const rendererVersion = '0.1.0';

/** Returns a human-readable identifier for the UI package. */
export function describeRenderer(): string {
  return `renderer@${rendererVersion}`;
}
