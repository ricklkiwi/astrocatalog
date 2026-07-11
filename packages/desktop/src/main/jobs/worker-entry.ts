/**
 * The actual `worker_threads` script (P0-05 plan Step 3). Wraps
 * `runDemoJob` (and, later, other registry entries — P1-06's `'scan'` is a
 * one-line addition) in a `parentPort.on('message', ...)` loop, translating
 * `ctx.reportProgress`/completion/errors into `postMessage` calls per
 * `protocol.ts`. Reacts to an incoming `{type:'cancel'}` message by flipping
 * an internal flag `ctx.isCancelled()` reads.
 *
 * No `@astrotracker/db`, no `better-sqlite3`, no fs — this file (and every
 * job runner it dispatches to) is DB- and filesystem-free by construction
 * (DD-002 Default 3: the main process is the sole SQLite writer).
 */
import { parentPort } from 'node:worker_threads';

import { runDemoJob, type JobContext } from './demo-job.js';
import type {
  CancelledMessage,
  DemoJobPayload,
  DoneMessage,
  ErrorMessage,
  JobType,
  MainToWorkerMessage,
  ProgressMessage,
  RunMessage,
} from './protocol.js';

type JobRunner = (payload: unknown, ctx: JobContext) => Promise<void>;

/** `{ demo: runDemoJob }` today; a future `'scan'` entry is additive, not a pool/orchestrator change. */
const registry: Record<JobType, JobRunner> = {
  demo: (payload, ctx) => runDemoJob(payload as DemoJobPayload, ctx),
};

if (parentPort === null) {
  throw new Error('worker-entry.ts must be run inside a worker_threads Worker');
}
const port = parentPort;

/** Cooperative-cancel flag for the job currently running, reset per `'run'` message. */
let cancelled = false;

port.on('message', (message: MainToWorkerMessage) => {
  if (message.type === 'cancel') {
    cancelled = true;
    return;
  }
  cancelled = false;
  const runner: JobRunner | undefined = registry[message.jobType];
  if (runner === undefined) {
    // An unrecognized job type reaching a worker means the main process and
    // this worker's registry have drifted (a dispatch bug, not a
    // recoverable per-job condition) — thrown synchronously here, OUTSIDE
    // runJob's try/catch, so it's a genuine uncaught exception: the pool's
    // `worker.on('error', ...)` crash-recovery path applies (fail the
    // in-flight job, respawn the slot), the same path a real runner bug
    // takes if it somehow escapes runDemoJob's own error handling.
    throw new Error(`Unknown job type "${message.jobType}"`);
  }
  void runJob(message, runner);
});

async function runJob(message: RunMessage, runner: JobRunner): Promise<void> {
  const { jobId, payload } = message;
  const ctx: JobContext = {
    isCancelled: () => cancelled,
    reportProgress: (current, total, progressMessage) => {
      const progress: ProgressMessage = {
        type: 'progress',
        jobId,
        current,
        total,
        message: progressMessage,
      };
      port.postMessage(progress);
    },
  };

  try {
    await runner(payload, ctx);
    if (cancelled) {
      const cancelledMsg: CancelledMessage = { type: 'cancelled', jobId };
      port.postMessage(cancelledMsg);
    } else {
      const done: DoneMessage = { type: 'done', jobId };
      port.postMessage(done);
    }
  } catch (caught) {
    const error: ErrorMessage = {
      type: 'error',
      jobId,
      error: caught instanceof Error ? caught.message : String(caught),
    };
    port.postMessage(error);
  }
}
