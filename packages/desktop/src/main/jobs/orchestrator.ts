import { randomUUID } from 'node:crypto';

import type { FilesRepository, ScanJob, ScanJobsRepository } from '@astrotracker/db';

import type { DispatchJob, WorkerPool, WorkerPoolCallbacks } from './pool.js';
import type { DiscoveredFile, JobType, ScanJobPayload } from './protocol.js';

export interface JobProgressEvent {
  jobId: string;
  jobType: string;
  status: string;
  current: number;
  total: number | null;
  message: string | null;
}

export interface JobQueueOrchestrator {
  readonly callbacks: WorkerPoolCallbacks;
  start(): void;
  enqueueDemo(input?: { totalSteps?: number; stepMs?: number }): { jobId: string };
  /**
   * Enqueue a `'scan'` job (P1-06 Stage 1). The caller (an IPC handler) has
   * already resolved the watch folder's `rootPath`/`extensions`/`skipPatterns`
   * and passes the full payload — the orchestrator does no watch-folder lookup.
   */
  enqueueScan(input: {
    watchFolderId: string;
    rootPath: string;
    extensions: string[];
    skipPatterns?: string[];
  }): { jobId: string };
  cancel(jobId: string): void;
  list(): Array<{
    id: string;
    jobType: string;
    status: string;
    progressCurrent: number;
    progressTotal: number | null;
    progressMessage: string | null;
  }>;
  onEvent(listener: (event: JobProgressEvent) => void): () => void;
}

export interface CreateJobQueueOrchestratorOptions {
  scanJobs: ScanJobsRepository;
  /**
   * Files repository for `'scan'`-job Stage-1 upserts (P1-06). Optional so the
   * P0-05 demo-only wiring (and any caller that never enqueues scans) still
   * constructs an orchestrator; when absent, `'scan'` discovery batches are
   * ignored. Production (`main/index.ts`) must supply it for scans to persist.
   */
  files?: FilesRepository;
  /**
   * Runs `fn` inside a single DB transaction, used to batch each discovered
   * file group's upserts atomically (DD-002 single-writer). Optional — when
   * omitted, upserts still happen, just one statement at a time (no batch
   * atomicity). Wire it as `(fn) => database.transaction(() => fn())`
   * (`AstroDatabase.transaction` is also directly assignable here).
   */
  transaction?: <T>(fn: () => T) => T;
  createPool(callbacks: WorkerPoolCallbacks): WorkerPool;
}

function parsePayload(job: ScanJob): Record<string, unknown> {
  if (job.payloadJson === null) {
    return {};
  }
  const parsed: unknown = JSON.parse(job.payloadJson);
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function toDispatchJob(job: ScanJob): DispatchJob {
  const payload = {
    ...parsePayload(job),
    resumeFrom: job.progressCurrent,
  };
  return {
    id: job.id,
    jobType: job.jobType as JobType,
    payload,
  };
}

/**
 * Resolve the watch-folder id for a scan job: prefer the dedicated
 * `watch_folder_id` column, falling back to the JSON payload. Both are
 * persisted by `enqueueScan`, so this survives the orphan-requeue-after-restart
 * path (no in-memory map needed). Returns `undefined` for a non-scan job.
 */
function watchFolderIdOf(job: ScanJob): string | undefined {
  if (job.watchFolderId !== null) {
    return job.watchFolderId;
  }
  const payload = parsePayload(job);
  return typeof payload.watchFolderId === 'string' ? payload.watchFolderId : undefined;
}

export function createJobQueueOrchestrator({
  scanJobs,
  files,
  transaction = (fn) => fn(),
  createPool,
}: CreateJobQueueOrchestratorOptions): JobQueueOrchestrator {
  const listeners = new Set<(event: JobProgressEvent) => void>();
  let started = false;

  function emit(job: ScanJob, message: string | null = job.progressMessage): void {
    const event: JobProgressEvent = {
      jobId: job.id,
      jobType: job.jobType,
      status: job.status,
      current: job.progressCurrent,
      total: job.progressTotal,
      message,
    };
    for (const listener of listeners) {
      listener(event);
    }
  }

  function pump(): void {
    while (pool.idleCount() > 0) {
      const claimed = scanJobs.claimNext(`worker-${randomUUID()}`);
      if (claimed === undefined) {
        return;
      }
      if (claimed.cancelRequested) {
        const cancelled = scanJobs.markCancelled(claimed.id);
        if (cancelled !== undefined) {
          emit(cancelled, 'cancelled before resume');
        }
        continue;
      }
      const dispatched = pool.dispatch(toDispatchJob(claimed));
      if (!dispatched) {
        return;
      }
      // Do not reuse the last persisted progress message on a resumed claim:
      // renderer consumers distinguish real worker progress ticks by their
      // step message, and replaying it here would duplicate the restart
      // sequence even though no step ran twice.
      emit(claimed, 'running');
    }
  }

  /**
   * Persist one discovered-file batch (P1-06 Stage 1). `seenAt` is the scan
   * job's persisted `startedAt`, captured once at claim time and read back
   * here (not `new Date()` per batch) so the whole run shares one cutoff for
   * missing-detection. Wrapped in a single transaction per batch for atomicity
   * / write throughput.
   */
  function upsertDiscoveredBatch(jobId: string, discovered: DiscoveredFile[]): void {
    if (files === undefined || discovered.length === 0) {
      return;
    }
    const job = scanJobs.getById(jobId);
    if (job === undefined || job.startedAt === null) {
      return;
    }
    const watchFolderId = watchFolderIdOf(job);
    if (watchFolderId === undefined) {
      return;
    }
    const seenAt = job.startedAt;
    const filesRepo = files;
    transaction(() => {
      for (const file of discovered) {
        filesRepo.upsertDiscovered(
          {
            watchFolderId,
            relativePath: file.relativePath,
            filename: file.filename,
            extension: file.extension,
            sizeBytes: file.sizeBytes,
            fileMtime: file.fileMtimeMs === null ? null : new Date(file.fileMtimeMs),
          },
          seenAt,
        );
      }
    });
  }

  const callbacks: WorkerPoolCallbacks = {
    onProgress(jobId, current, total, message) {
      const updated = scanJobs.updateProgress(jobId, { current, total, message });
      if (updated !== undefined) {
        emit(updated, message);
      }
    },
    onDiscovered(jobId, discovered) {
      upsertDiscoveredBatch(jobId, discovered);
    },
    onDone(jobId) {
      const completed = scanJobs.complete(jobId);
      if (completed !== undefined) {
        emit(completed, 'completed');
        // Stage-1 missing-detection (P1-06 / DD-004): every `'present'` row
        // under this watch folder not re-seen by *this* scan (deleted, or the
        // whole drive disconnected) flips to `'missing'`. The cutoff is the
        // scan's own persisted `startedAt` — the same timestamp used as
        // `seenAt` for every upsert in this run — so files re-discovered this
        // run (lastSeenAt === startedAt) survive the strict `<` comparison,
        // while stale rows (older startedAt) don't. Restoring them later is
        // free: a subsequent successful rescan re-upserts and `wasRestored`
        // flips them back to `'present'`.
        if (completed.jobType === 'scan' && files !== undefined && completed.startedAt !== null) {
          const watchFolderId = watchFolderIdOf(completed);
          if (watchFolderId !== undefined) {
            files.markMissingNotSeenSince(watchFolderId, completed.startedAt);
          }
        }
      }
      pump();
    },
    onError(jobId, error) {
      const failed = scanJobs.fail(jobId, error);
      if (failed !== undefined) {
        emit(failed, error);
      }
      pump();
    },
    onCancelled(jobId) {
      const cancelled = scanJobs.markCancelled(jobId);
      if (cancelled !== undefined) {
        emit(cancelled, 'cancelled');
      }
      pump();
    },
  };

  const pool = createPool(callbacks);

  return {
    callbacks,

    start(): void {
      if (started) {
        return;
      }
      started = true;
      for (const job of scanJobs.requeueOrphaned()) {
        emit(job, 'requeued after restart');
      }
      pump();
    },

    enqueueDemo(input = {}): { jobId: string } {
      const payload = {
        totalSteps: input.totalSteps ?? 10,
        stepMs: input.stepMs ?? 500,
      };
      const job = scanJobs.enqueue({
        jobType: 'demo',
        payloadJson: JSON.stringify(payload),
      });
      emit(job, 'queued');
      pump();
      return { jobId: job.id };
    },

    enqueueScan(input): { jobId: string } {
      const payload: ScanJobPayload = {
        watchFolderId: input.watchFolderId,
        rootPath: input.rootPath,
        extensions: input.extensions,
        ...(input.skipPatterns !== undefined ? { skipPatterns: input.skipPatterns } : {}),
      };
      const job = scanJobs.enqueue({
        jobType: 'scan',
        // Persist the id on the dedicated column too (not just inside the
        // payload) so onDiscovered/onDone can resolve it without re-parsing,
        // and it survives the orphan-requeue-after-restart path.
        watchFolderId: input.watchFolderId,
        payloadJson: JSON.stringify(payload),
      });
      emit(job, 'queued');
      pump();
      return { jobId: job.id };
    },

    cancel(jobId: string): void {
      const job = scanJobs.requestCancel(jobId);
      if (job === undefined) {
        return;
      }
      emit(job, 'cancel requested');
      if (job.status === 'running') {
        pool.cancel(jobId);
      }
      pump();
    },

    list() {
      return scanJobs.list().map((job) => ({
        id: job.id,
        jobType: job.jobType,
        status: job.status,
        progressCurrent: job.progressCurrent,
        progressTotal: job.progressTotal,
        progressMessage: job.progressMessage,
      }));
    },

    onEvent(listener: (event: JobProgressEvent) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
