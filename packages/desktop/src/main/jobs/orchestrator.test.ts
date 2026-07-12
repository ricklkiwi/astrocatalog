import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { openDatabase, type AstroDatabase } from '@astrotracker/db';
import { afterEach, describe, expect, it } from 'vitest';

import { createJobQueueOrchestrator, type JobProgressEvent } from './orchestrator.js';
import { createWorkerPool, type WorkerPool, type WorkerPoolCallbacks } from './pool.js';

interface Harness {
  db: AstroDatabase;
  orchestrator: ReturnType<typeof createJobQueueOrchestrator>;
  events: JobProgressEvent[];
  pool: WorkerPool;
  dir: string;
}

const harnesses: Harness[] = [];

afterEach(async () => {
  while (harnesses.length > 0) {
    const harness = harnesses.pop()!;
    await harness.pool.terminateAll();
    harness.db.close();
    rmSync(harness.dir, { recursive: true, force: true });
  }
});

function createHarness(filePath?: string): Harness {
  const dir = filePath === undefined ? mkdtempSync(path.join(tmpdir(), 'astro-p0-05-')) : '';
  const db = openDatabase({ filePath: filePath ?? path.join(dir, 'astrotracker.db') });
  let pool: WorkerPool | undefined;
  const orchestrator = createJobQueueOrchestrator({
    scanJobs: db.repos.scanJobs,
    createPool(callbacks: WorkerPoolCallbacks) {
      pool = createWorkerPool(1, callbacks);
      return pool;
    },
  });
  const events: JobProgressEvent[] = [];
  orchestrator.onEvent((event) => {
    events.push(event);
  });
  const harness = { db, orchestrator, events, pool: pool!, dir };
  harnesses.push(harness);
  return harness;
}

async function waitUntil(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('waitUntil timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('JobQueueOrchestrator', () => {
  it('runs a demo job through progress to completed using a real worker pool', async () => {
    const harness = createHarness();
    harness.orchestrator.start();

    const { jobId } = harness.orchestrator.enqueueDemo({ totalSteps: 3, stepMs: 5 });
    await waitUntil(() => harness.db.repos.scanJobs.getById(jobId)?.status === 'completed');

    expect(
      harness.events.filter((event) => event.jobId === jobId).map((event) => event.current),
    ).toContain(3);
    expect(harness.db.repos.scanJobs.getById(jobId)?.workerId).toBeNull();
  }, 10000);

  it('requeues an orphaned running job and resumes from persisted progress after restart', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'astro-p0-05-resume-'));
    const filePath = path.join(dir, 'astrotracker.db');
    const first = createHarness(filePath);
    first.orchestrator.start();

    const { jobId } = first.orchestrator.enqueueDemo({ totalSteps: 8, stepMs: 15 });
    await waitUntil(() => first.db.repos.scanJobs.getById(jobId)!.progressCurrent >= 3);
    const beforeRestartProgress = first.db.repos.scanJobs.getById(jobId)!.progressCurrent;
    await first.pool.terminateAll();
    const beforeRestartSequence = first.events
      .filter((event) => event.jobId === jobId && event.message?.startsWith('step '))
      .map((event) => event.current);
    const firstIndex = harnesses.indexOf(first);
    if (firstIndex >= 0) {
      harnesses.splice(firstIndex, 1);
    }
    first.db.close();

    const second = createHarness(filePath);
    second.dir = dir;
    second.orchestrator.start();
    await waitUntil(() => second.db.repos.scanJobs.getById(jobId)?.status === 'completed');

    const afterRestartSequence = second.events
      .filter((event) => event.jobId === jobId && event.message?.startsWith('step '))
      .map((event) => event.current);
    expect(beforeRestartSequence).toEqual(
      Array.from({ length: beforeRestartProgress }, (_, index) => index + 1),
    );
    expect([...beforeRestartSequence, ...afterRestartSequence]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(second.db.repos.scanJobs.getById(jobId)?.progressCurrent).toBe(8);
  }, 15000);

  it('marks a requeued cancel-requested job cancelled before worker dispatch', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'astro-p0-05-cancel-restart-'));
    const filePath = path.join(dir, 'astrotracker.db');
    const seed = openDatabase({ filePath });
    const job = seed.repos.scanJobs.enqueue({
      jobType: 'demo',
      payloadJson: JSON.stringify({ totalSteps: 3, stepMs: 5 }),
    });
    seed.repos.scanJobs.claimNext('worker-before-restart');
    seed.repos.scanJobs.requestCancel(job.id);
    seed.close();

    const restarted = createHarness(filePath);
    restarted.dir = dir;
    restarted.orchestrator.start();
    await waitUntil(() => restarted.db.repos.scanJobs.getById(job.id)?.status === 'cancelled');

    expect(
      restarted.events.filter(
        (event) => event.jobId === job.id && event.message?.startsWith('step '),
      ),
    ).toEqual([]);
    expect(restarted.pool.idleCount()).toBe(1);
  });

  it('cancels a running job and frees the slot for the next queued job', async () => {
    const harness = createHarness();
    harness.orchestrator.start();

    const first = harness.orchestrator.enqueueDemo({ totalSteps: 20, stepMs: 10 });
    await waitUntil(() => harness.db.repos.scanJobs.getById(first.jobId)!.progressCurrent >= 1);
    const second = harness.orchestrator.enqueueDemo({ totalSteps: 1, stepMs: 5 });

    harness.orchestrator.cancel(first.jobId);

    await waitUntil(() => harness.db.repos.scanJobs.getById(first.jobId)?.status === 'cancelled');
    await waitUntil(() => harness.db.repos.scanJobs.getById(second.jobId)?.status === 'completed');

    expect(harness.db.repos.scanJobs.getById(first.jobId)?.workerId).toBeNull();
    expect(harness.db.repos.scanJobs.getById(second.jobId)?.progressCurrent).toBe(1);
  }, 15000);
});
