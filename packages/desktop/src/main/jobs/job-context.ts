/**
 * The injected context every job runner receives (P0-05 shape, extended in
 * P1-06). A plain callback bag — `worker-entry.ts` wires it to real
 * `postMessage` calls and a `cancelled` flag; unit tests supply a fake — so
 * job runners stay directly testable with no real `worker_threads` instance.
 *
 * Lives in its own module (rather than `demo-job.ts`) so both `runDemoJob`
 * and `runScanJob` can depend on it without a job-to-job import.
 *
 * No fs, no `@astrotracker/db`, no Electron import here (DD-002 Default 3):
 * the context is pure callbacks; the main process remains the sole SQLite
 * writer and workers report results up over `postMessage`.
 */
import type { DiscoveredFile } from './protocol.js';

export interface JobContext {
  /** Report progress after a completed unit of work. `total` is `null` for indeterminate progress. */
  reportProgress(current: number, total: number | null, message: string | null): void;
  /** Emit a batch of discovered files. No-op for job types that never call it (e.g. demo). */
  reportDiscovered(files: DiscoveredFile[]): void;
  /**
   * Checked cooperatively (plan Default 6 — not preemptive): a runner polls
   * this between units of work and returns early once it trips, which
   * `worker-entry.ts` translates into a `'cancelled'` message.
   */
  isCancelled(): boolean;
}
