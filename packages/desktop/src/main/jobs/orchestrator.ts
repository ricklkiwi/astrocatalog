import { randomUUID } from 'node:crypto';

import type { ScanJob, ScanJobsRepository } from '@astrotracker/db';

import type { DispatchJob, WorkerPool, WorkerPoolCallbacks } from './pool.js';
import type { JobType } from './protocol.js';

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

export function createJobQueueOrchestrator({
  scanJobs,
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
      emit(claimed);
    }
  }

  const callbacks: WorkerPoolCallbacks = {
    onProgress(jobId, current, total, message) {
      const updated = scanJobs.updateProgress(jobId, { current, total, message });
      if (updated !== undefined) {
        emit(updated, message);
      }
    },
    onDone(jobId) {
      const completed = scanJobs.complete(jobId);
      if (completed !== undefined) {
        emit(completed, 'completed');
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
