/**
 * The main <-> worker `postMessage` protocol (P0-05). Kept as plain data
 * types with no imports from `@astrotracker/db`/Electron — the worker side
 * (`worker-entry.ts`) never touches SQLite (DD-002 Default 3: main process is
 * the sole writer; workers report results up over `postMessage`).
 *
 * `JobType` lives here, in `packages/desktop`, not `packages/db` — plan
 * Default 2: the DB layer only knows the closed `status` lifecycle;
 * `job_type` is an unconstrained TEXT column, and the union of concrete job
 * types is entirely the desktop package's worker-registry concern. Adding a
 * job type later (P1-06's `'scan'`) means adding a member here and a
 * registry entry in `worker-entry.ts` — not a schema or pool change.
 */

/** Every job type the worker registry knows how to run. `'scan'` added in P1-06. */
export type JobType = 'demo' | 'scan';

/** Payload shape for the `'demo'` job type — sleeps through N steps, reporting progress. */
export interface DemoJobPayload {
  /** Default 10 (plan Step 3). */
  totalSteps?: number;
  /** Default 500ms (plan Step 3). */
  stepMs?: number;
  /** Set on resume-after-restart dispatch; skip already-completed steps. */
  resumeFrom?: number;
}

/** Payload shape for the `'scan'` job type (P1-06 Stage 1) — a discovery walk of one watch folder. */
export interface ScanJobPayload {
  watchFolderId: string;
  rootPath: string;
  /** Lowercase extensions, no leading dot, e.g. ['fits','fit','xisf','cr2','cr3','nef','arw']. */
  extensions: string[];
  /** Additional basename patterns to skip, beyond the always-skipped hidden (dot-prefixed) entries. Case-insensitive exact basename match (e.g. 'node_modules', '@eaDir', '$RECYCLE.BIN', 'System Volume Information'). */
  skipPatterns?: string[];
}

/** One qualifying file found during a Stage 1 discovery walk. */
export interface DiscoveredFile {
  relativePath: string; // POSIX-style '/' separators, relative to rootPath, no leading slash
  filename: string;
  extension: string; // lowercase, no leading dot
  sizeBytes: number;
  fileMtimeMs: number | null; // epoch ms, or null if stat didn't report mtime
}

/** Main -> worker: start a job. */
export interface RunMessage {
  type: 'run';
  jobId: string;
  jobType: JobType;
  payload: unknown;
}

/** Main -> worker: cooperative cancel request (checked once per step, plan Default 6). */
export interface CancelMessage {
  type: 'cancel';
  jobId: string;
}

export type MainToWorkerMessage = RunMessage | CancelMessage;

/** Worker -> main: progress after a completed step. `total: null` = indeterminate. */
export interface ProgressMessage {
  type: 'progress';
  jobId: string;
  current: number;
  total: number | null;
  message: string | null;
}

/** Worker -> main: the job function returned normally (not cancelled). */
export interface DoneMessage {
  type: 'done';
  jobId: string;
}

/** Worker -> main: the job function threw, or the job type is unknown. */
export interface ErrorMessage {
  type: 'error';
  jobId: string;
  error: string;
}

/** Worker -> main: the job function exited early because `ctx.isCancelled()` tripped. */
export interface CancelledMessage {
  type: 'cancelled';
  jobId: string;
}

/** Worker -> main: a batch of newly-walked files, sent incrementally so main can upsert without buffering the whole tree. */
export interface DiscoveredMessage {
  type: 'discovered';
  jobId: string;
  files: DiscoveredFile[];
}

export type WorkerToMainMessage =
  ProgressMessage | DoneMessage | ErrorMessage | CancelledMessage | DiscoveredMessage;
