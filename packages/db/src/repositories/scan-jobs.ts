import { and, asc, desc, eq } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';

import { scanJobs } from '../schema/index.js';
import {
  createCrudRepository,
  insertStamp,
  type CrudRepository,
  type DrizzleDb,
} from './shared.js';

export type ScanJob = InferSelectModel<typeof scanJobs>;

/**
 * The closed five-state lifecycle enforced by the `scan_jobs_status_check`
 * CHECK constraint. Declared explicitly (not derived from the schema column,
 * which — matching this codebase's convention for status columns, e.g.
 * `files.status` — is plain `text()` with no `.$type<...>()` literal).
 */
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

/** Caller-facing payload for `enqueue` — the repo stamps every queue bookkeeping column. */
export interface EnqueueJobInput {
  jobType: string;
  watchFolderId?: string | null;
  /** Arbitrary job-shaped JSON (e.g. demo job's totalSteps/stepMs/resumeFrom). */
  payloadJson?: string | null;
  priority?: number;
}

export interface ProgressUpdate {
  current: number;
  /** `null` = indeterminate; `undefined` (omitted) = leave the stored total unchanged. */
  total?: number | null;
  message?: string | null;
}

/**
 * Queue primitives on top of the base CRUD skeleton (P0-05). Every
 * terminal/claim transition below guards its UPDATE with a `WHERE status IN
 * (...)` clause rather than reading-then-deciding in application code, so a
 * late call on an already-terminal row is a no-op, not a race or a throw
 * (spec: "Core Invariants" / "terminal-no-op" test hint).
 */
export interface ScanJobsRepository extends CrudRepository<typeof scanJobs> {
  /** Insert a new queued job; stamps status='queued', progress_current=0, priority/cancel defaults. */
  enqueue(input: EnqueueJobInput): ScanJob;
  /**
   * Transactionally-equivalent claim (single-writer, synchronous
   * better-sqlite3 — DD-002 Default 3): picks the highest-priority, oldest
   * (`created_at` ASC, UUIDv7 same-millisecond-stable) queued row, flips it
   * to `'running'`, stamps `workerId`/`claimedAt`/`startedAt`-if-unset.
   * Returns `undefined` if the queue is empty.
   */
  claimNext(workerId: string): ScanJob | undefined;
  updateProgress(id: string, progress: ProgressUpdate): ScanJob | undefined;
  /** Running row: sets `cancelRequested`. Queued row: transitions straight to `'cancelled'`. */
  requestCancel(id: string): ScanJob | undefined;
  /** The running→cancelled terminal transition, called once a worker acknowledges. */
  markCancelled(id: string): ScanJob | undefined;
  complete(id: string): ScanJob | undefined;
  fail(id: string, error: string): ScanJob | undefined;
  /**
   * Resets every `'running'` row to `'queued'` at boot (no `worker_threads`
   * instance survives a process restart) — preserves `progressCurrent`/
   * `progressTotal`/`payloadJson`/`cancelRequested` (a job mid-cancel when the
   * app died must still honor that cancel on resume). Returns the requeued rows.
   */
  requeueOrphaned(): ScanJob[];
}

/** Validated-JSON guard for `payloadJson` (spec: "validated as parseable JSON before write"). */
function assertParseableJson(value: string | null | undefined, field: string): void {
  if (value === null || value === undefined) {
    return;
  }
  try {
    JSON.parse(value);
  } catch (cause) {
    throw new Error(`${field} must be valid JSON`, { cause });
  }
}

export function createScanJobsRepository(db: DrizzleDb): ScanJobsRepository {
  const base = createCrudRepository(db, scanJobs);

  function getByIdOrUndefined(id: string): ScanJob | undefined {
    return db.select().from(scanJobs).where(eq(scanJobs.id, id)).get();
  }

  return {
    ...base,

    enqueue(input: EnqueueJobInput): ScanJob {
      assertParseableJson(input.payloadJson, 'payloadJson');
      const row = {
        ...insertStamp(),
        watchFolderId: input.watchFolderId ?? null,
        jobType: input.jobType,
        status: 'queued' as const,
        filesSeen: 0,
        filesAdded: 0,
        filesUpdated: 0,
        payloadJson: input.payloadJson ?? null,
        progressCurrent: 0,
        progressTotal: null,
        progressMessage: null,
        priority: input.priority ?? 0,
        workerId: null,
        claimedAt: null,
        cancelRequested: false,
        startedAt: null,
        finishedAt: null,
        error: null,
      };
      return db.insert(scanJobs).values(row).returning().get();
    },

    claimNext(workerId: string): ScanJob | undefined {
      const candidate = db
        .select()
        .from(scanJobs)
        .where(eq(scanJobs.status, 'queued'))
        // priority desc, then created_at asc (FIFO) drives the composite
        // index; `id` asc is a tie-breaker for same-millisecond inserts —
        // UUIDv7 is strictly lexically increasing per process (@astrotracker/
        // core), so it stays a correct secondary sort where created_at alone
        // (millisecond resolution) can't distinguish insertion order.
        .orderBy(desc(scanJobs.priority), asc(scanJobs.createdAt), asc(scanJobs.id))
        .limit(1)
        .get();
      if (candidate === undefined) {
        return undefined;
      }
      const now = new Date();
      return db
        .update(scanJobs)
        .set({
          status: 'running',
          workerId,
          claimedAt: now,
          startedAt: candidate.startedAt ?? now,
          updatedAt: now,
        })
        .where(and(eq(scanJobs.id, candidate.id), eq(scanJobs.status, 'queued')))
        .returning()
        .get();
    },

    updateProgress(id: string, progress: ProgressUpdate): ScanJob | undefined {
      const patch: Partial<ScanJob> = {
        progressCurrent: progress.current,
        updatedAt: new Date(),
      };
      if ('total' in progress) {
        patch.progressTotal = progress.total ?? null;
      }
      if ('message' in progress) {
        patch.progressMessage = progress.message ?? null;
      }
      const updated = db.update(scanJobs).set(patch).where(eq(scanJobs.id, id)).returning().get();
      return updated ?? getByIdOrUndefined(id);
    },

    requestCancel(id: string): ScanJob | undefined {
      const now = new Date();
      const cancelledQueued = db
        .update(scanJobs)
        .set({
          status: 'cancelled',
          cancelRequested: true,
          finishedAt: now,
          workerId: null,
          updatedAt: now,
        })
        .where(and(eq(scanJobs.id, id), eq(scanJobs.status, 'queued')))
        .returning()
        .get();
      if (cancelledQueued !== undefined) {
        return cancelledQueued;
      }

      const flaggedRunning = db
        .update(scanJobs)
        .set({ cancelRequested: true, updatedAt: now })
        .where(and(eq(scanJobs.id, id), eq(scanJobs.status, 'running')))
        .returning()
        .get();
      if (flaggedRunning !== undefined) {
        return flaggedRunning;
      }

      // Terminal (or missing) row: no-op, per-spec — never a throw.
      return getByIdOrUndefined(id);
    },

    markCancelled(id: string): ScanJob | undefined {
      const now = new Date();
      const updated = db
        .update(scanJobs)
        .set({ status: 'cancelled', finishedAt: now, workerId: null, updatedAt: now })
        .where(and(eq(scanJobs.id, id), eq(scanJobs.status, 'running')))
        .returning()
        .get();
      return updated ?? getByIdOrUndefined(id);
    },

    complete(id: string): ScanJob | undefined {
      const now = new Date();
      const updated = db
        .update(scanJobs)
        .set({ status: 'completed', finishedAt: now, workerId: null, updatedAt: now })
        .where(and(eq(scanJobs.id, id), eq(scanJobs.status, 'running')))
        .returning()
        .get();
      return updated ?? getByIdOrUndefined(id);
    },

    fail(id: string, error: string): ScanJob | undefined {
      const now = new Date();
      const updated = db
        .update(scanJobs)
        .set({ status: 'failed', error, finishedAt: now, workerId: null, updatedAt: now })
        .where(and(eq(scanJobs.id, id), eq(scanJobs.status, 'running')))
        .returning()
        .get();
      return updated ?? getByIdOrUndefined(id);
    },

    requeueOrphaned(): ScanJob[] {
      const now = new Date();
      return db
        .update(scanJobs)
        .set({ status: 'queued', workerId: null, claimedAt: null, updatedAt: now })
        .where(eq(scanJobs.status, 'running'))
        .returning()
        .all();
    },
  };
}
