import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  openDatabase,
  type AstroDatabase,
  type FileRecord,
  type FilesRepository,
  type UpsertDiscoveredInput,
  type UpsertDiscoveredResult,
} from '@astrotracker/db';
import { afterEach, describe, expect, it } from 'vitest';

import { createJobQueueOrchestrator, type JobProgressEvent } from './orchestrator.js';
import { createWorkerPool, type WorkerPool, type WorkerPoolCallbacks } from './pool.js';

interface UpsertRecord {
  input: UpsertDiscoveredInput;
  result: UpsertDiscoveredResult;
}

interface MissingRecord {
  watchFolderId: string;
  cutoff: Date;
  result: FileRecord[];
}

interface Harness {
  db: AstroDatabase;
  orchestrator: ReturnType<typeof createJobQueueOrchestrator>;
  events: JobProgressEvent[];
  pool: WorkerPool;
  dir: string;
  /** Every `upsertDiscovered` call the orchestrator made, with its result (spy). */
  upserts: UpsertRecord[];
  /** Every `markMissingNotSeenSince` call the orchestrator made (spy). */
  missing: MissingRecord[];
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

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function createHarness(filePath?: string): Harness {
  const dir = filePath === undefined ? mkdtempSync(path.join(tmpdir(), 'astro-p0-05-')) : '';
  const db = openDatabase({ filePath: filePath ?? path.join(dir, 'astrotracker.db') });

  const upserts: UpsertRecord[] = [];
  const missing: MissingRecord[] = [];
  const baseFiles = db.repos.files;
  // Spy wrapper over the real files repo: records inputs/results so tests can
  // assert Stage-1 signals (`changed`/`wasRestored`) and the missing cutoff,
  // while every statement still runs on the same connection/transaction.
  const filesRepo: FilesRepository = {
    ...baseFiles,
    upsertDiscovered(input, seenAt) {
      const result = baseFiles.upsertDiscovered(input, seenAt);
      upserts.push({ input, result });
      return result;
    },
    markMissingNotSeenSince(watchFolderId, cutoff) {
      const result = baseFiles.markMissingNotSeenSince(watchFolderId, cutoff);
      missing.push({ watchFolderId, cutoff, result });
      return result;
    },
  };

  let pool: WorkerPool | undefined;
  const orchestrator = createJobQueueOrchestrator({
    scanJobs: db.repos.scanJobs,
    files: filesRepo,
    transaction: (fn) => db.transaction(() => fn()),
    createPool(callbacks: WorkerPoolCallbacks) {
      pool = createWorkerPool(1, callbacks);
      return pool;
    },
  });
  const events: JobProgressEvent[] = [];
  orchestrator.onEvent((event) => {
    events.push(event);
  });
  const harness = { db, orchestrator, events, pool: pool!, dir, upserts, missing };
  harnesses.push(harness);
  return harness;
}

/** Insert a watch-folder row (FK target for files/scan-jobs) and return its id. */
function seedWatchFolder(harness: Harness, folderPath: string): string {
  return harness.db.repos.watchFolders.insert({
    path: folderPath,
    driveLabel: null,
    isActive: true,
    lastScanAt: null,
    skipPatterns: null,
  }).id;
}

function filesFor(harness: Harness, watchFolderId: string): FileRecord[] {
  return harness.db.repos.files.list().filter((f) => f.watchFolderId === watchFolderId);
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

function stepSequence(events: readonly JobProgressEvent[], jobId: string): number[] {
  return events
    .filter((event) => event.jobId === jobId && event.message?.startsWith('step '))
    .map((event) => event.current);
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
    await first.pool.terminateAll();
    const beforeRestartProgress = first.db.repos.scanJobs.getById(jobId)!.progressCurrent;
    await waitUntil(() => stepSequence(first.events, jobId).length === beforeRestartProgress);
    const beforeRestartSequence = stepSequence(first.events, jobId);
    const firstIndex = harnesses.indexOf(first);
    if (firstIndex >= 0) {
      harnesses.splice(firstIndex, 1);
    }
    first.db.close();

    const second = createHarness(filePath);
    second.dir = dir;
    second.orchestrator.start();
    await waitUntil(() => second.db.repos.scanJobs.getById(jobId)?.status === 'completed');

    const afterRestartSequence = stepSequence(second.events, jobId);
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

  it('batch-upserts discovered files and marks missing on scan completion with the scan startedAt as cutoff', async () => {
    const harness = createHarness();
    harness.orchestrator.start();

    const scanDir = mkdtempSync(path.join(tmpdir(), 'astro-p1-06-scan-'));
    writeFileSync(path.join(scanDir, 'light_001.fits'), 'aaaa');
    writeFileSync(path.join(scanDir, 'light_002.fits'), 'bbbbbb');
    const watchFolderId = seedWatchFolder(harness, scanDir);

    const { jobId } = harness.orchestrator.enqueueScan({
      watchFolderId,
      rootPath: scanDir,
      extensions: ['fits'],
    });
    await waitUntil(() => harness.db.repos.scanJobs.getById(jobId)?.status === 'completed');

    // Both files upserted as new/changed.
    expect(harness.upserts).toHaveLength(2);
    expect(harness.upserts.every((u) => u.result.isNew && u.result.changed)).toBe(true);
    expect(
      filesFor(harness, watchFolderId)
        .map((f) => f.filename)
        .sort(),
    ).toEqual(['light_001.fits', 'light_002.fits']);

    // markMissingNotSeenSince fired once, with the job's persisted startedAt.
    const startedAt = harness.db.repos.scanJobs.getById(jobId)!.startedAt!;
    expect(harness.missing).toHaveLength(1);
    expect(harness.missing[0]!.watchFolderId).toBe(watchFolderId);
    expect(harness.missing[0]!.cutoff.getTime()).toBe(startedAt.getTime());
    // Nothing to mark missing — every present row was re-seen this run.
    expect(harness.missing[0]!.result).toHaveLength(0);

    rmSync(scanDir, { recursive: true, force: true });
  }, 15000);

  it('rescan of an unchanged tree reports every file as changed:false (incremental signal for P1-07)', async () => {
    const harness = createHarness();
    harness.orchestrator.start();

    const scanDir = mkdtempSync(path.join(tmpdir(), 'astro-p1-06-incremental-'));
    writeFileSync(path.join(scanDir, 'a.fits'), 'aaaa');
    writeFileSync(path.join(scanDir, 'b.xisf'), 'bbbb');
    const watchFolderId = seedWatchFolder(harness, scanDir);

    const scan = (): Promise<void> => {
      const { jobId } = harness.orchestrator.enqueueScan({
        watchFolderId,
        rootPath: scanDir,
        extensions: ['fits', 'xisf'],
      });
      return waitUntil(() => harness.db.repos.scanJobs.getById(jobId)?.status === 'completed');
    };

    await scan();
    const afterFirst = harness.upserts.length;
    expect(afterFirst).toBe(2);
    expect(harness.upserts.every((u) => u.result.changed)).toBe(true);

    await sleep(5);
    await scan();

    const secondRun = harness.upserts.slice(afterFirst);
    expect(secondRun).toHaveLength(2);
    // Nothing changed on disk → zero re-parse signals (P1-07 gates on this).
    expect(secondRun.every((u) => u.result.changed === false)).toBe(true);
    expect(secondRun.every((u) => u.result.isNew === false)).toBe(true);

    rmSync(scanDir, { recursive: true, force: true });
  }, 20000);

  it('disconnecting a drive marks files missing; reconnecting restores them', async () => {
    const harness = createHarness();
    harness.orchestrator.start();

    const scanDir = mkdtempSync(path.join(tmpdir(), 'astro-p1-06-reconnect-'));
    const gonePath = path.join(scanDir, 'ghost-not-a-dir');
    writeFileSync(path.join(scanDir, 'light.fits'), 'aaaa');
    const watchFolderId = seedWatchFolder(harness, scanDir);

    const scan = (rootPath: string): Promise<void> => {
      const { jobId } = harness.orchestrator.enqueueScan({
        watchFolderId,
        rootPath,
        extensions: ['fits'],
      });
      return waitUntil(() => harness.db.repos.scanJobs.getById(jobId)?.status === 'completed');
    };

    // 1) Initial scan: the file is present.
    await scan(scanDir);
    expect(filesFor(harness, watchFolderId).map((f) => f.status)).toEqual(['present']);

    // 2) "Drive disconnected": scan a rootPath that doesn't exist → nothing
    //    discovered → the previously-present row flips to missing.
    await sleep(5);
    await scan(gonePath);
    const afterDisconnect = filesFor(harness, watchFolderId);
    expect(afterDisconnect.map((f) => f.status)).toEqual(['missing']);
    expect(harness.missing.at(-1)!.result.map((f) => f.filename)).toEqual(['light.fits']);

    // 3) "Drive reconnected": rescan the real dir → the row is restored.
    await sleep(5);
    const beforeReconnect = harness.upserts.length;
    await scan(scanDir);
    const reconnectRun = harness.upserts.slice(beforeReconnect);
    expect(reconnectRun).toHaveLength(1);
    expect(reconnectRun[0]!.result.wasRestored).toBe(true);
    expect(filesFor(harness, watchFolderId).map((f) => f.status)).toEqual(['present']);

    rmSync(scanDir, { recursive: true, force: true });
  }, 25000);
});
