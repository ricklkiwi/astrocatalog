import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createWorkerPool, type WorkerPool, type WorkerPoolCallbacks } from './pool.js';
import type { DiscoveredFile, HashError, HashedFile, JobType } from './protocol.js';

/**
 * Real `worker_threads` exercised against the real `worker-entry.ts` (P0-05
 * plan Step 4) — small step counts/short delays (tens of ms), asserting on
 * message-count/ordering promises rather than wall-clock sleeps.
 */

let pool: WorkerPool | undefined;
const tmpDirs: string[] = [];

afterEach(async () => {
  if (pool !== undefined) {
    await pool.terminateAll();
    pool = undefined;
  }
  while (tmpDirs.length > 0) {
    rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  }
});

interface Recorder {
  callbacks: WorkerPoolCallbacks;
  progress: Array<{ jobId: string; current: number; total: number | null; message: string | null }>;
  discovered: Array<{ jobId: string; files: DiscoveredFile[] }>;
  hashed: Array<{ jobId: string; results: Array<HashedFile | HashError> }>;
  done: string[];
  errors: Array<{ jobId: string; error: string }>;
  cancelled: string[];
  waitForDone(jobId: string, timeoutMs?: number): Promise<void>;
  waitForError(jobId: string, timeoutMs?: number): Promise<void>;
  waitForCancelled(jobId: string, timeoutMs?: number): Promise<void>;
  waitForProgressCount(jobId: string, count: number, timeoutMs?: number): Promise<void>;
}

function createRecorder(): Recorder {
  const progress: Recorder['progress'] = [];
  const discovered: Recorder['discovered'] = [];
  const hashed: Recorder['hashed'] = [];
  const done: string[] = [];
  const errors: Recorder['errors'] = [];
  const cancelled: string[] = [];
  const waiters: Array<() => void> = [];

  function notify(): void {
    for (const waiter of waiters.splice(0, waiters.length)) {
      waiter();
    }
  }

  async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
    if (predicate()) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('waitUntil timed out'));
      }, timeoutMs);
      const check = (): void => {
        if (predicate()) {
          clearTimeout(timeout);
          resolve();
        } else {
          waiters.push(check);
        }
      };
      waiters.push(check);
    });
  }

  return {
    callbacks: {
      onProgress: (jobId, current, total, message) => {
        progress.push({ jobId, current, total, message });
        notify();
      },
      onDiscovered: (jobId, files) => {
        discovered.push({ jobId, files });
        notify();
      },
      onHashed: (jobId, results) => {
        hashed.push({ jobId, results });
        notify();
      },
      onDone: (jobId) => {
        done.push(jobId);
        notify();
      },
      onError: (jobId, error) => {
        errors.push({ jobId, error });
        notify();
      },
      onCancelled: (jobId) => {
        cancelled.push(jobId);
        notify();
      },
    },
    progress,
    discovered,
    hashed,
    done,
    errors,
    cancelled,
    waitForDone: (jobId, timeoutMs = 5000) => waitUntil(() => done.includes(jobId), timeoutMs),
    waitForError: (jobId, timeoutMs = 5000) =>
      waitUntil(() => errors.some((e) => e.jobId === jobId), timeoutMs),
    waitForCancelled: (jobId, timeoutMs = 5000) =>
      waitUntil(() => cancelled.includes(jobId), timeoutMs),
    waitForProgressCount: (jobId, count, timeoutMs = 5000) =>
      waitUntil(() => progress.filter((p) => p.jobId === jobId).length >= count, timeoutMs),
  };
}

describe('createWorkerPool', () => {
  it('dispatches a demo job to an idle worker and observes progress + done', async () => {
    const recorder = createRecorder();
    pool = createWorkerPool(2, recorder.callbacks);

    const jobId = randomUUID();
    const dispatched = pool.dispatch({
      id: jobId,
      jobType: 'demo' as JobType,
      payload: { totalSteps: 3, stepMs: 5 },
    });

    expect(dispatched).toBe(true);
    await recorder.waitForDone(jobId);

    expect(recorder.progress.filter((p) => p.jobId === jobId).map((p) => p.current)).toEqual([
      1, 2, 3,
    ]);
    expect(recorder.done).toEqual([jobId]);
  }, 10000);

  it('idleCount reflects busy/idle slots, and dispatch fails when the pool is full', async () => {
    const recorder = createRecorder();
    pool = createWorkerPool(1, recorder.callbacks);

    expect(pool.idleCount()).toBe(1);
    const jobId = randomUUID();
    pool.dispatch({
      id: jobId,
      jobType: 'demo' as JobType,
      payload: { totalSteps: 5, stepMs: 20 },
    });
    expect(pool.idleCount()).toBe(0);

    const secondJobId = randomUUID();
    const dispatched = pool.dispatch({
      id: secondJobId,
      jobType: 'demo' as JobType,
      payload: { totalSteps: 1, stepMs: 5 },
    });
    expect(dispatched).toBe(false);

    await recorder.waitForDone(jobId);
    expect(pool.idleCount()).toBe(1);
  }, 10000);

  it('forwards cancel to the worker running a given job id', async () => {
    const recorder = createRecorder();
    pool = createWorkerPool(1, recorder.callbacks);

    const jobId = randomUUID();
    pool.dispatch({
      id: jobId,
      jobType: 'demo' as JobType,
      payload: { totalSteps: 20, stepMs: 10 },
    });
    await recorder.waitForProgressCount(jobId, 1);

    const forwarded = pool.cancel(jobId);
    expect(forwarded).toBe(true);

    await recorder.waitForCancelled(jobId);
    expect(recorder.done).not.toContain(jobId);
  }, 10000);

  it('cancel() returns false for a job id no slot is running', async () => {
    const recorder = createRecorder();
    pool = createWorkerPool(1, recorder.callbacks);

    expect(pool.cancel('not-a-dispatched-job')).toBe(false);
  });

  it('runs a scan job and forwards discovered file batches via onDiscovered', async () => {
    const recorder = createRecorder();
    pool = createWorkerPool(1, recorder.callbacks);

    const dir = mkdtempSync(path.join(tmpdir(), 'astro-p1-06-pool-'));
    tmpDirs.push(dir);
    writeFileSync(path.join(dir, 'light_001.fits'), 'x');
    writeFileSync(path.join(dir, 'light_002.fit'), 'xx');
    writeFileSync(path.join(dir, 'notes.txt'), 'ignored');

    const jobId = randomUUID();
    const dispatched = pool.dispatch({
      id: jobId,
      jobType: 'scan' as JobType,
      payload: {
        watchFolderId: 'wf-1',
        rootPath: dir,
        extensions: ['fits', 'fit'],
      },
    });
    expect(dispatched).toBe(true);

    await recorder.waitForDone(jobId);

    const files = recorder.discovered
      .filter((d) => d.jobId === jobId)
      .flatMap((d) => d.files)
      .map((f) => f.filename)
      .sort();
    expect(files).toEqual(['light_001.fits', 'light_002.fit']);
  }, 10000);

  it('runs a hash job and forwards hash results via onHashed', async () => {
    const recorder = createRecorder();
    pool = createWorkerPool(1, recorder.callbacks);

    const dir = mkdtempSync(path.join(tmpdir(), 'astro-p1-08-pool-'));
    tmpDirs.push(dir);
    const aPath = path.join(dir, 'a.fits');
    const gonePath = path.join(dir, 'missing.fits');
    writeFileSync(aPath, 'hash me');

    const jobId = randomUUID();
    const dispatched = pool.dispatch({
      id: jobId,
      jobType: 'hash' as JobType,
      payload: {
        files: [
          { fileId: 'file-a', absolutePath: aPath, sizeBytes: 7 },
          { fileId: 'file-gone', absolutePath: gonePath, sizeBytes: 0 },
        ],
      },
    });
    expect(dispatched).toBe(true);

    await recorder.waitForDone(jobId);

    const results = recorder.hashed.filter((h) => h.jobId === jobId).flatMap((h) => h.results);
    const byId = new Map(results.map((r) => [r.fileId, r]));
    expect(byId.size).toBe(2);
    expect('sha256' in byId.get('file-a')!).toBe(true);
    expect('error' in byId.get('file-gone')!).toBe(true);
  }, 10000);

  it('a worker crash (uncaught exception) fails the in-flight job and the pool keeps full capacity', async () => {
    const recorder = createRecorder();
    pool = createWorkerPool(1, recorder.callbacks);

    // An unrecognized job type reaching worker-entry.ts throws synchronously
    // outside runJob's try/catch (see worker-entry.ts) — a genuine uncaught
    // exception, not a graceful protocol error message.
    const crashingJobId = randomUUID();
    pool.dispatch({
      id: crashingJobId,
      jobType: 'not-a-real-job-type' as JobType,
      payload: {},
    });

    await recorder.waitForError(crashingJobId);
    expect(recorder.errors[0]?.jobId).toBe(crashingJobId);

    // Capacity restored: the same pool instance completes a subsequent job.
    expect(pool.idleCount()).toBe(1);
    const followUpJobId = randomUUID();
    const dispatched = pool.dispatch({
      id: followUpJobId,
      jobType: 'demo' as JobType,
      payload: { totalSteps: 1, stepMs: 5 },
    });
    expect(dispatched).toBe(true);
    await recorder.waitForDone(followUpJobId);
  }, 10000);
});
