import { copyFileSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

// --- P1-08: SHA-256 hashing + duplicate/move detection (DD-004 Stage 5a) -----

const FIXTURES_ROOT = new URL('../../../../../fixtures/', import.meta.url);
function fixturePath(relative: string): string {
  return fileURLToPath(new URL(relative, FIXTURES_ROOT));
}

interface HashHarness {
  db: AstroDatabase;
  orchestrator: ReturnType<typeof createJobQueueOrchestrator>;
  events: JobProgressEvent[];
  pool: WorkerPool;
  dbDir: string;
}

const hashHarnesses: HashHarness[] = [];
const hashScanDirs: string[] = [];

afterEach(async () => {
  while (hashHarnesses.length > 0) {
    const harness = hashHarnesses.pop()!;
    await harness.pool.terminateAll();
    harness.db.close();
    rmSync(harness.dbDir, { recursive: true, force: true });
  }
  while (hashScanDirs.length > 0) {
    rmSync(hashScanDirs.pop()!, { recursive: true, force: true });
  }
});

/** Full orchestrator wiring (files+frames+watchFolders+real pool) against real db repos. */
function createHashHarness(poolSize = 1): HashHarness {
  const dbDir = mkdtempSync(path.join(tmpdir(), 'astro-p1-08-db-'));
  const db = openDatabase({ filePath: path.join(dbDir, 'astrotracker.db') });
  let pool: WorkerPool | undefined;
  const orchestrator = createJobQueueOrchestrator({
    scanJobs: db.repos.scanJobs,
    files: db.repos.files,
    frames: db.repos.frames,
    watchFolders: db.repos.watchFolders,
    transaction: (fn) => db.transaction(() => fn()),
    createPool(callbacks: WorkerPoolCallbacks) {
      pool = createWorkerPool(poolSize, callbacks);
      return pool;
    },
  });
  const events: JobProgressEvent[] = [];
  orchestrator.onEvent((event) => {
    events.push(event);
  });
  const harness: HashHarness = { db, orchestrator, events, pool: pool!, dbDir };
  hashHarnesses.push(harness);
  return harness;
}

function seedFolder(db: AstroDatabase, folderPath: string): string {
  return db.repos.watchFolders.insert({
    path: folderPath,
    driveLabel: null,
    isActive: true,
    lastScanAt: null,
    skipPatterns: null,
  }).id;
}

function newScanDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  hashScanDirs.push(dir);
  return dir;
}

describe('P1-08 hashing, duplicate + move detection', () => {
  it('detects duplicates across two watch folders; the later-firstSeen file becomes a duplicate of the earlier (deterministic canonical)', async () => {
    const harness = createHashHarness();
    harness.orchestrator.start();

    const folderA = newScanDir('astro-p1-08-dupA-');
    const folderB = newScanDir('astro-p1-08-dupB-');
    const content = 'identical astrophotography bytes across two folders';
    writeFileSync(path.join(folderA, 'light.fits'), content);
    writeFileSync(path.join(folderB, 'copy.fits'), content);
    const wfA = seedFolder(harness.db, folderA);
    const wfB = seedFolder(harness.db, folderB);

    const status = (id: string): string | undefined =>
      harness.db.repos.scanJobs.getById(id)?.status;

    // Scan A first (→ earlier firstSeenAt → canonical), then B.
    const a = harness.orchestrator.enqueueScan({
      watchFolderId: wfA,
      rootPath: folderA,
      extensions: ['fits'],
    });
    await waitUntil(() => status(a.jobId) === 'completed');
    await sleep(5);
    const b = harness.orchestrator.enqueueScan({
      watchFolderId: wfB,
      rootPath: folderB,
      extensions: ['fits'],
    });
    await waitUntil(() => status(b.jobId) === 'completed');

    // Hashing auto-triggers after each scan; wait until both files are hashed
    // and the duplicate has been marked.
    await waitUntil(() => {
      const rows = harness.db.repos.files.list();
      return (
        rows.length === 2 &&
        rows.every((f) => f.sha256 !== null) &&
        rows.some((f) => f.status === 'duplicate')
      );
    });

    const rows = harness.db.repos.files.list();
    const fileA = rows.find((f) => f.watchFolderId === wfA)!;
    const fileB = rows.find((f) => f.watchFolderId === wfB)!;
    expect(fileA.sha256).toBe(fileB.sha256);
    expect(fileA.status).toBe('present');
    expect(fileB.status).toBe('duplicate');
    expect(fileB.duplicateOfId).toBe(fileA.id);
  }, 25000);

  it('a file moved between folders retains its files.id and its frame link (no duplicate/orphan frame)', async () => {
    const harness = createHashHarness();
    harness.orchestrator.start();

    const folderA = newScanDir('astro-p1-08-moveA-');
    const folderB = newScanDir('astro-p1-08-moveB-');
    const wfA = seedFolder(harness.db, folderA);
    const wfB = seedFolder(harness.db, folderB);

    const status = (id: string): string | undefined =>
      harness.db.repos.scanJobs.getById(id)?.status;

    // A real, parseable fixture → a frames row is produced for it.
    copyFileSync(
      fixturePath('fits/nina/nina-light-mono-ha.fits'),
      path.join(folderA, 'sub_001.fits'),
    );

    // Scan A → present + parsed frame; wait for the auto hash pass to record sha256.
    const a1 = harness.orchestrator.enqueueScan({
      watchFolderId: wfA,
      rootPath: folderA,
      extensions: ['fits'],
    });
    await waitUntil(() => status(a1.jobId) === 'completed');
    await waitUntil(() => {
      const f = harness.db.repos.files.list().find((x) => x.watchFolderId === wfA);
      return f !== undefined && f.sha256 !== null;
    });

    const original = harness.db.repos.files.list().find((x) => x.watchFolderId === wfA)!;
    const originalFrame = harness.db.repos.frames.list().find((fr) => fr.fileId === original.id)!;
    expect(originalFrame).toBeDefined();
    expect(originalFrame.frameType).toBe('light');

    // Physically move the file A → B (byte-identical: same size + sha256).
    renameSync(path.join(folderA, 'sub_001.fits'), path.join(folderB, 'moved_001.fits'));

    // Rescan A (now empty) → the original row flips to 'missing' (keeps sha256 + frame).
    await sleep(5);
    const a2 = harness.orchestrator.enqueueScan({
      watchFolderId: wfA,
      rootPath: folderA,
      extensions: ['fits'],
    });
    await waitUntil(() => status(a2.jobId) === 'completed');
    await waitUntil(() => harness.db.repos.files.getById(original.id)?.status === 'missing');

    // Scan B → discovers the file at its new path → move detection re-paths the
    // ORIGINAL row rather than inserting a new one.
    await sleep(5);
    const bScan = harness.orchestrator.enqueueScan({
      watchFolderId: wfB,
      rootPath: folderB,
      extensions: ['fits'],
    });
    await waitUntil(() => status(bScan.jobId) === 'completed');
    await waitUntil(() => harness.db.repos.files.getById(original.id)?.status === 'present');

    const moved = harness.db.repos.files.getById(original.id)!;
    expect(moved.watchFolderId).toBe(wfB);
    expect(moved.relativePath).toBe('moved_001.fits');
    expect(moved.status).toBe('present');

    // Exactly one file row overall — the move re-pathed, it did not duplicate.
    expect(harness.db.repos.files.list()).toHaveLength(1);

    // The frame still resolves to the same file id — same frame row, no orphan, no dup.
    const framesForFile = harness.db.repos.frames.list().filter((fr) => fr.fileId === original.id);
    expect(framesForFile).toHaveLength(1);
    expect(framesForFile[0]!.id).toBe(originalFrame.id);
    expect(harness.db.repos.frames.list()).toHaveLength(1);
  }, 30000);

  it('claims a queued scan before a queued hash job (priority throttle), even though the hash was enqueued first', async () => {
    const harness = createHashHarness(1);

    const scanDir = newScanDir('astro-p1-08-prio-');
    writeFileSync(path.join(scanDir, 'light.fits'), 'abc');
    writeFileSync(path.join(scanDir, 'preexisting.fits'), 'xyz');
    const wf = seedFolder(harness.db, scanDir);

    // Seed a present, unhashed file row so the hash job has real work to do.
    harness.db.repos.files.upsertDiscovered(
      {
        watchFolderId: wf,
        relativePath: 'preexisting.fits',
        filename: 'preexisting.fits',
        extension: 'fits',
        sizeBytes: 3,
        fileMtime: null,
      },
      new Date(),
    );

    // Enqueue the HASH job FIRST (priority -1), then the SCAN job (priority 0),
    // both directly via the repo so no pump() runs until start() below — this
    // is what forces both to be queued simultaneously when claimNext runs.
    const hashJob = harness.db.repos.scanJobs.enqueue({
      jobType: 'hash',
      payloadJson: JSON.stringify({ files: [] }),
      priority: -1,
    });
    const scanJob = harness.db.repos.scanJobs.enqueue({
      jobType: 'scan',
      watchFolderId: wf,
      payloadJson: JSON.stringify({ watchFolderId: wf, rootPath: scanDir, extensions: ['fits'] }),
      priority: 0,
    });

    // One pump() claim now picks the highest-priority queued job: the scan.
    harness.orchestrator.start();

    const status = (id: string): string | undefined =>
      harness.db.repos.scanJobs.getById(id)?.status;
    await waitUntil(() => status(scanJob.id) === 'completed' && status(hashJob.id) === 'completed');

    const scanCompletedIdx = harness.events.findIndex(
      (e) => e.jobId === scanJob.id && e.message === 'completed',
    );
    const hashCompletedIdx = harness.events.findIndex(
      (e) => e.jobId === hashJob.id && e.message === 'completed',
    );
    expect(scanCompletedIdx).toBeGreaterThanOrEqual(0);
    expect(hashCompletedIdx).toBeGreaterThanOrEqual(0);
    // Pool size 1 + higher scan priority ⇒ the scan ran (and finished) first,
    // despite the hash being enqueued earlier.
    expect(scanCompletedIdx).toBeLessThan(hashCompletedIdx);
  }, 25000);
});
