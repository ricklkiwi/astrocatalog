/**
 * `WorkerPool` (P0-05 plan Step 4) — a fixed-size pool of real
 * `worker_threads` instances, each running `worker-entry.ts`. Owns
 * dispatch/cancel/crash-recovery/`terminateAll`; the pump loop (orchestrator)
 * decides WHEN to dispatch — this module never reads or writes the DB
 * (DD-002 Default 3).
 *
 * `worker-entry.ts` is referenced via electron-vite's documented `?modulePath`
 * import suffix (plan Default 7) — no manual `electron.vite.config.ts`
 * multi-entry configuration; electron-vite discovers and bundles the worker
 * file because it's a static import. (Under plain `vitest`, where
 * electron-vite's own build plugin isn't loaded, `vitest-worker-module-path-
 * plugin.ts` stands in so this same import resolves to a real, freshly
 * bundled worker script — see that file's header comment.)
 */
import { Worker } from 'node:worker_threads';

import workerEntryPath from './worker-entry?modulePath';
import type {
  CancelMessage,
  DiscoveredFile,
  JobType,
  RunMessage,
  WorkerToMainMessage,
} from './protocol.js';

export interface DispatchJob {
  id: string;
  jobType: JobType;
  payload: unknown;
}

/** Injected by the orchestrator; every callback persists via `repos.scanJobs`. */
export interface WorkerPoolCallbacks {
  onProgress(jobId: string, current: number, total: number | null, message: string | null): void;
  /** A batch of newly-walked files from a `'scan'` job, forwarded for upsert (P1-06 Stage 1). */
  onDiscovered(jobId: string, files: DiscoveredFile[]): void;
  onDone(jobId: string): void;
  /** Also fired for a worker crash (uncaught exception) on its in-flight job. */
  onError(jobId: string, error: string): void;
  onCancelled(jobId: string): void;
}

export interface WorkerPool {
  readonly size: number;
  /** Number of slots not currently running a job. */
  idleCount(): number;
  /** Dispatches to an idle slot; returns false (no-op) if the pool is fully busy. */
  dispatch(job: DispatchJob): boolean;
  /** Forwards a cancel to the worker running `jobId`; returns false if no slot is running it. */
  cancel(jobId: string): boolean;
  /** Terminates every worker (app shutdown); best-effort, never throws. */
  terminateAll(): Promise<void>;
}

interface Slot {
  worker: Worker;
  busy: boolean;
  jobId: string | null;
}

export function createWorkerPool(
  size: number,
  callbacks: WorkerPoolCallbacks,
  workerScriptPath: string = workerEntryPath,
): WorkerPool {
  function spawnWorker(): Worker {
    return new Worker(workerScriptPath);
  }

  function attachHandlers(slot: Slot): void {
    slot.worker.on('message', (message: WorkerToMainMessage) => {
      switch (message.type) {
        case 'progress':
          callbacks.onProgress(message.jobId, message.current, message.total, message.message);
          break;
        case 'discovered':
          callbacks.onDiscovered(message.jobId, message.files);
          break;
        case 'done':
          slot.busy = false;
          slot.jobId = null;
          callbacks.onDone(message.jobId);
          break;
        case 'error':
          slot.busy = false;
          slot.jobId = null;
          callbacks.onError(message.jobId, message.error);
          break;
        case 'cancelled':
          slot.busy = false;
          slot.jobId = null;
          callbacks.onCancelled(message.jobId);
          break;
      }
    });

    // Genuine crash (uncaught exception in the worker thread) — not a
    // graceful `{type:'error'}` protocol message. Fail the in-flight job (if
    // any) and respawn the slot so pool capacity isn't permanently lost.
    slot.worker.on('error', (error: unknown) => {
      const failedJobId = slot.jobId;
      slot.busy = false;
      slot.jobId = null;
      if (failedJobId !== null) {
        callbacks.onError(failedJobId, error instanceof Error ? error.message : String(error));
      }
      slot.worker = spawnWorker();
      attachHandlers(slot);
    });
  }

  const slots: Slot[] = Array.from({ length: size }, () => {
    const slot: Slot = { worker: spawnWorker(), busy: false, jobId: null };
    attachHandlers(slot);
    return slot;
  });

  return {
    size,

    idleCount(): number {
      return slots.filter((slot) => !slot.busy).length;
    },

    dispatch(job: DispatchJob): boolean {
      const slot = slots.find((s) => !s.busy);
      if (slot === undefined) {
        return false;
      }
      slot.busy = true;
      slot.jobId = job.id;
      const run: RunMessage = {
        type: 'run',
        jobId: job.id,
        jobType: job.jobType,
        payload: job.payload,
      };
      slot.worker.postMessage(run);
      return true;
    },

    cancel(jobId: string): boolean {
      const slot = slots.find((s) => s.jobId === jobId);
      if (slot === undefined) {
        return false;
      }
      const cancel: CancelMessage = { type: 'cancel', jobId };
      slot.worker.postMessage(cancel);
      return true;
    },

    async terminateAll(): Promise<void> {
      await Promise.all(
        slots.map(async (slot) => {
          try {
            await slot.worker.terminate();
          } catch {
            // Best-effort (plan Step 7 / spec "before-quit"): shutdown never throws.
          }
        }),
      );
    },
  };
}
