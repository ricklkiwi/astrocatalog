import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openDatabase, type AstroDatabase } from '../index.js';

/**
 * Queue claim/resume/cancel semantics (P0-05 acceptance criterion: "Unit
 * tests for queue claim/resume/cancel semantics") — pure repository-level
 * tests against an in-memory DB, no `worker_threads` involved.
 */
let db: AstroDatabase;

beforeEach(() => {
  db = openDatabase({ filePath: ':memory:' });
});

afterEach(() => {
  vi.useRealTimers();
  db.close();
});

describe('enqueue', () => {
  it('stamps queued defaults when the caller omits priority/cancelRequested', () => {
    const job = db.repos.scanJobs.enqueue({ jobType: 'demo' });

    expect(job.status).toBe('queued');
    expect(job.jobType).toBe('demo');
    expect(job.progressCurrent).toBe(0);
    expect(job.progressTotal).toBeNull();
    expect(job.priority).toBe(0);
    expect(job.cancelRequested).toBe(false);
    expect(job.workerId).toBeNull();
    expect(job.watchFolderId).toBeNull();
  });

  it('round-trips arbitrary job-shaped payload JSON verbatim', () => {
    const payload = { totalSteps: 20, stepMs: 10, resumeFrom: 5 };
    const job = db.repos.scanJobs.enqueue({
      jobType: 'demo',
      payloadJson: JSON.stringify(payload),
    });

    expect(JSON.parse(job.payloadJson as string)).toEqual(payload);
  });

  it('rejects a non-JSON payloadJson before writing', () => {
    expect(() => db.repos.scanJobs.enqueue({ jobType: 'demo', payloadJson: '{not json' })).toThrow(
      /valid JSON/,
    );
    expect(db.repos.scanJobs.list()).toHaveLength(0);
  });
});

describe('claimNext', () => {
  it('claims in priority-desc, then created_at-asc and id-asc order', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T12:00:00.000Z'));
    const a = db.repos.scanJobs.enqueue({ jobType: 'demo', priority: 0 });
    const b = db.repos.scanJobs.enqueue({ jobType: 'demo', priority: 0 });
    const c = db.repos.scanJobs.enqueue({ jobType: 'demo', priority: 1 });
    vi.useRealTimers();

    expect(a.createdAt.getTime()).toBe(b.createdAt.getTime());
    expect(a.id < b.id).toBe(true);

    const first = db.repos.scanJobs.claimNext('worker-1');
    const second = db.repos.scanJobs.claimNext('worker-1');
    const third = db.repos.scanJobs.claimNext('worker-1');

    expect(first?.id).toBe(c.id);
    expect(second?.id).toBe(a.id);
    expect(third?.id).toBe(b.id);
  });

  it('returns undefined on an empty queue, without throwing', () => {
    expect(db.repos.scanJobs.claimNext('worker-1')).toBeUndefined();
  });

  it('transitions the row to running and stamps worker_id/claimed_at/started_at', () => {
    const job = db.repos.scanJobs.enqueue({ jobType: 'demo' });
    expect(job.startedAt).toBeNull();

    const claimed = db.repos.scanJobs.claimNext('worker-7');

    expect(claimed?.status).toBe('running');
    expect(claimed?.workerId).toBe('worker-7');
    expect(claimed?.claimedAt).toBeInstanceOf(Date);
    expect(claimed?.startedAt).toBeInstanceOf(Date);
  });

  it('does not overwrite an already-set started_at on reclaim after requeue', () => {
    const job = db.repos.scanJobs.enqueue({ jobType: 'demo' });
    const firstClaim = db.repos.scanJobs.claimNext('worker-1');
    const startedAt = firstClaim?.startedAt;

    db.repos.scanJobs.requeueOrphaned();
    const secondClaim = db.repos.scanJobs.claimNext('worker-2');

    expect(secondClaim?.id).toBe(job.id);
    expect(secondClaim?.startedAt?.getTime()).toBe(startedAt?.getTime());
  });
});

describe('requeueOrphaned', () => {
  it('resets every running row to queued while preserving progress and a pending cancel flag', () => {
    const job = db.repos.scanJobs.enqueue({ jobType: 'demo' });
    db.repos.scanJobs.claimNext('worker-1');
    db.repos.scanJobs.updateProgress(job.id, { current: 4, total: 10, message: 'step 4' });
    db.repos.scanJobs.requestCancel(job.id); // running row -> cancelRequested=true, status stays running

    const [requeued] = db.repos.scanJobs.requeueOrphaned();

    expect(requeued?.status).toBe('queued');
    expect(requeued?.workerId).toBeNull();
    expect(requeued?.claimedAt).toBeNull();
    expect(requeued?.progressCurrent).toBe(4);
    expect(requeued?.progressTotal).toBe(10);
    expect(requeued?.progressMessage).toBe('step 4');
    expect(requeued?.cancelRequested).toBe(true);
  });

  it('leaves still-queued and terminal rows untouched', () => {
    // First job: claimed then completed (terminal — must stay untouched).
    const completedJob = db.repos.scanJobs.enqueue({ jobType: 'demo' });
    db.repos.scanJobs.claimNext('worker-1');
    db.repos.scanJobs.complete(completedJob.id);

    // Second job: claimed and left running (orphaned — this is the one
    // requeued). Claimed before the third job is enqueued so FIFO ordering
    // can't accidentally pick the wrong row.
    const orphanedJob = db.repos.scanJobs.enqueue({ jobType: 'demo' });
    db.repos.scanJobs.claimNext('worker-2');

    // Third job: never claimed (stays queued — must stay untouched).
    const stillQueuedJob = db.repos.scanJobs.enqueue({ jobType: 'demo' });

    const requeued = db.repos.scanJobs.requeueOrphaned();

    expect(requeued.map((j) => j.id)).toEqual([orphanedJob.id]);
    expect(db.repos.scanJobs.getById(completedJob.id)?.status).toBe('completed');
    expect(db.repos.scanJobs.getById(stillQueuedJob.id)?.status).toBe('queued');
    expect(db.repos.scanJobs.getById(orphanedJob.id)?.status).toBe('queued');
  });
});

describe('requestCancel', () => {
  it('transitions a queued job straight to cancelled (no worker to signal)', () => {
    const job = db.repos.scanJobs.enqueue({ jobType: 'demo' });

    const cancelled = db.repos.scanJobs.requestCancel(job.id);

    expect(cancelled?.status).toBe('cancelled');
    expect(cancelled?.cancelRequested).toBe(true);
    expect(cancelled?.finishedAt).toBeInstanceOf(Date);
  });

  it('sets cancelRequested on a running job without changing its status', () => {
    const job = db.repos.scanJobs.enqueue({ jobType: 'demo' });
    db.repos.scanJobs.claimNext('worker-1');

    const flagged = db.repos.scanJobs.requestCancel(job.id);

    expect(flagged?.status).toBe('running');
    expect(flagged?.cancelRequested).toBe(true);
  });
});

describe('markCancelled', () => {
  it('performs the running -> cancelled terminal transition', () => {
    const job = db.repos.scanJobs.enqueue({ jobType: 'demo' });
    db.repos.scanJobs.claimNext('worker-1');
    db.repos.scanJobs.requestCancel(job.id);

    const cancelled = db.repos.scanJobs.markCancelled(job.id);

    expect(cancelled?.status).toBe('cancelled');
    expect(cancelled?.workerId).toBeNull();
    expect(cancelled?.finishedAt).toBeInstanceOf(Date);
  });
});

describe('terminal no-ops', () => {
  it('requestCancel/markCancelled/complete/fail on an already-completed row are no-ops, not throws', () => {
    const job = db.repos.scanJobs.enqueue({ jobType: 'demo' });
    db.repos.scanJobs.claimNext('worker-1');
    const completed = db.repos.scanJobs.complete(job.id);
    expect(completed?.status).toBe('completed');
    const finishedAt = completed?.finishedAt?.getTime();

    expect(() => db.repos.scanJobs.requestCancel(job.id)).not.toThrow();
    expect(() => db.repos.scanJobs.markCancelled(job.id)).not.toThrow();
    expect(() => db.repos.scanJobs.complete(job.id)).not.toThrow();
    expect(() => db.repos.scanJobs.fail(job.id, 'boom')).not.toThrow();

    const unchanged = db.repos.scanJobs.getById(job.id);
    expect(unchanged?.status).toBe('completed');
    expect(unchanged?.finishedAt?.getTime()).toBe(finishedAt);
    expect(unchanged?.error).toBeNull();
  });
});

describe('complete / fail', () => {
  it('complete() stamps finished_at, clears worker_id, and reaches the terminal status', () => {
    const job = db.repos.scanJobs.enqueue({ jobType: 'demo' });
    db.repos.scanJobs.claimNext('worker-1');

    const completed = db.repos.scanJobs.complete(job.id);

    expect(completed?.status).toBe('completed');
    expect(completed?.workerId).toBeNull();
    expect(completed?.finishedAt).toBeInstanceOf(Date);
  });

  it('fail() stores the error, stamps finished_at, clears worker_id', () => {
    const job = db.repos.scanJobs.enqueue({ jobType: 'demo' });
    db.repos.scanJobs.claimNext('worker-1');

    const failed = db.repos.scanJobs.fail(job.id, 'worker crashed');

    expect(failed?.status).toBe('failed');
    expect(failed?.error).toBe('worker crashed');
    expect(failed?.workerId).toBeNull();
    expect(failed?.finishedAt).toBeInstanceOf(Date);
  });
});

describe('updateProgress', () => {
  it('updates current/total/message and re-stamps updated_at', () => {
    const job = db.repos.scanJobs.enqueue({ jobType: 'demo' });
    db.repos.scanJobs.claimNext('worker-1');

    const updated = db.repos.scanJobs.updateProgress(job.id, {
      current: 3,
      total: 10,
      message: 'step 3',
    });

    expect(updated?.progressCurrent).toBe(3);
    expect(updated?.progressTotal).toBe(10);
    expect(updated?.progressMessage).toBe('step 3');
    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(job.updatedAt.getTime());
  });
});
