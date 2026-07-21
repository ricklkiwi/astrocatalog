/**
 * P1-07 acceptance tests (DD-004 Stages 2–3): the parse + resolve pipeline
 * exercised end-to-end through a real worker pool against the committed
 * fixture corpus. Proves the four correctness criteria — well-formed files
 * produce correct `frames` rows, malformed files are isolated onto a
 * `parse_error` without aborting the batch, an unchanged rescan re-parses
 * nothing, and a changed file is re-parsed in place. The 10k-file benchmark
 * is a separate workstream.
 */
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openDatabase, type AstroDatabase, type FileRecord, type Frame } from '@astrotracker/db';
import { afterEach, describe, expect, it } from 'vitest';

import { createJobQueueOrchestrator } from './orchestrator.js';
import { createWorkerPool, type WorkerPool, type WorkerPoolCallbacks } from './pool.js';

const FIXTURES_ROOT = new URL('../../../../../fixtures/', import.meta.url);

/** Absolute path to a committed fixture file. */
function fixturePath(relative: string): string {
  return fileURLToPath(new URL(relative, FIXTURES_ROOT));
}

interface Harness {
  db: AstroDatabase;
  orchestrator: ReturnType<typeof createJobQueueOrchestrator>;
  pool: WorkerPool;
  scanDir: string;
}

const harnesses: Harness[] = [];

afterEach(async () => {
  while (harnesses.length > 0) {
    const harness = harnesses.pop()!;
    await harness.pool.terminateAll();
    harness.db.close();
    rmSync(harness.scanDir, { recursive: true, force: true });
  }
});

function createHarness(): Harness {
  const scanDir = mkdtempSync(path.join(tmpdir(), 'astro-p1-07-'));
  const db = openDatabase({ filePath: ':memory:' });
  let pool: WorkerPool | undefined;
  const orchestrator = createJobQueueOrchestrator({
    scanJobs: db.repos.scanJobs,
    files: db.repos.files,
    frames: db.repos.frames,
    transaction: (fn) => db.transaction(() => fn()),
    createPool(callbacks: WorkerPoolCallbacks) {
      pool = createWorkerPool(1, callbacks);
      return pool;
    },
  });
  const harness: Harness = { db, orchestrator, pool: pool!, scanDir };
  harnesses.push(harness);
  orchestrator.start();
  return harness;
}

/** Copy a fixture into the scan dir under `destName` (defaults to the fixture basename). */
function place(harness: Harness, fixture: string, destName?: string): string {
  const dest = destName ?? path.basename(fixture);
  copyFileSync(fixturePath(fixture), path.join(harness.scanDir, dest));
  return dest;
}

function seedWatchFolder(harness: Harness): string {
  return harness.db.repos.watchFolders.insert({
    path: harness.scanDir,
    driveLabel: null,
    isActive: true,
    lastScanAt: null,
    skipPatterns: null,
  }).id;
}

async function waitUntil(predicate: () => boolean, timeoutMs = 8000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('waitUntil timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Enqueue a scan of the (fits+xisf) extensions and resolve when it completes. */
async function scan(harness: Harness, watchFolderId: string): Promise<void> {
  const { jobId } = harness.orchestrator.enqueueScan({
    watchFolderId,
    rootPath: harness.scanDir,
    extensions: ['fits', 'fit', 'fts', 'xisf', 'cr2', 'nef', 'arw'],
  });
  await waitUntil(() => harness.db.repos.scanJobs.getById(jobId)?.status === 'completed');
}

function fileByName(harness: Harness, filename: string): FileRecord {
  const file = harness.db.repos.files.list().find((f) => f.filename === filename);
  if (file === undefined) throw new Error(`no file row for ${filename}`);
  return file;
}

function frameForFile(harness: Harness, fileId: string): Frame | undefined {
  return harness.db.repos.frames.list().find((f) => f.fileId === fileId);
}

describe('P1-07 parse + resolve pipeline', () => {
  it('writes frames rows with correct frameType and headersJson for well-formed files', async () => {
    const harness = createHarness();
    const light = place(harness, 'fits/nina/nina-light-mono-ha.fits');
    const dark = place(harness, 'fits/nina/nina-dark.fits');
    const xisf = place(harness, 'xisf/pixinsight-unit-mono-ha.xisf');
    const watchFolderId = seedWatchFolder(harness);

    await scan(harness, watchFolderId);

    const lightFrame = frameForFile(harness, fileByName(harness, light).id);
    expect(lightFrame).toBeDefined();
    expect(lightFrame!.frameType).toBe('light');
    expect(lightFrame!.frameTypeSource).toBe('header');
    expect(lightFrame!.objectRaw).toBe('M 31');
    // headers_json is the raw keyword dict, round-trippable, IMAGETYP preserved.
    const headers = JSON.parse(lightFrame!.headersJson) as Record<string, unknown>;
    expect(headers.IMAGETYP).toBe('LIGHT');

    const darkFrame = frameForFile(harness, fileByName(harness, dark).id);
    expect(darkFrame!.frameType).toBe('dark');

    const xisfFrame = frameForFile(harness, fileByName(harness, xisf).id);
    expect(xisfFrame).toBeDefined();
    expect(Object.keys(JSON.parse(xisfFrame!.headersJson) as object).length).toBeGreaterThan(0);

    // No parse errors on any file row; the counters reflect a clean run.
    expect(harness.db.repos.files.list().every((f) => f.parseError === null)).toBe(true);
  }, 20000);

  it('records a parse_error on a malformed file, writes no frame, and does not abort the batch', async () => {
    const harness = createHarness();
    const good1 = place(harness, 'fits/nina/nina-light-mono-ha.fits');
    const good2 = place(harness, 'fits/nina/nina-flat.fits');
    const bad = place(harness, 'fits/malformed/malformed-missing-end.fits');
    const watchFolderId = seedWatchFolder(harness);

    await scan(harness, watchFolderId);

    // Malformed file: error recorded, no frame row.
    const badFile = fileByName(harness, bad);
    expect(badFile.parseError).not.toBeNull();
    expect(badFile.parseError).toContain('MISSING_END');
    expect(frameForFile(harness, badFile.id)).toBeUndefined();

    // The other two files in the same batch still got processed.
    expect(frameForFile(harness, fileByName(harness, good1).id)?.frameType).toBe('light');
    expect(frameForFile(harness, fileByName(harness, good2).id)?.frameType).toBe('flat');

    // Error count surfaced in the scan-job summary counters.
    const jobs = harness.db.repos.scanJobs.list();
    const scanJob = jobs.find((j) => j.jobType === 'scan')!;
    expect(scanJob.filesErrored).toBe(1);
    expect(scanJob.filesSeen).toBe(3);
    expect(scanJob.filesAdded).toBe(3);
  }, 20000);

  it('does not re-parse an unchanged tree on rescan (idempotent frames)', async () => {
    const harness = createHarness();
    place(harness, 'fits/nina/nina-light-mono-ha.fits');
    place(harness, 'fits/nina/nina-bias.fits');
    const watchFolderId = seedWatchFolder(harness);

    await scan(harness, watchFolderId);
    const first = harness.db.repos.frames.list();
    expect(first).toHaveLength(2);
    const firstStamps = new Map(first.map((f) => [f.id, f.updatedAt.getTime()]));

    await new Promise((resolve) => setTimeout(resolve, 10));
    await scan(harness, watchFolderId);

    const second = harness.db.repos.frames.list();
    // Row counts stable, and no frame row was re-written (updatedAt unchanged)
    // — the worker skipped Stage 2–3 for every unchanged file.
    expect(second).toHaveLength(2);
    for (const frame of second) {
      expect(frame.updatedAt.getTime()).toBe(firstStamps.get(frame.id));
    }
    // File-row counts stable too.
    expect(harness.db.repos.files.list()).toHaveLength(2);
  }, 25000);

  it('re-parses a changed file and updates its frame row in place (same fileId, no duplicate)', async () => {
    const harness = createHarness();
    // Start as a light frame under a fixed name.
    const name = 'frame_001.fits';
    place(harness, 'fits/nina/nina-light-mono-ha.fits', name);
    const watchFolderId = seedWatchFolder(harness);

    await scan(harness, watchFolderId);
    const fileId = fileByName(harness, name).id;
    const before = frameForFile(harness, fileId)!;
    expect(before.frameType).toBe('light');

    // Overwrite the same path with different (dark) content → size/mtime change.
    await new Promise((resolve) => setTimeout(resolve, 10));
    place(harness, 'fits/nina/nina-dark.fits', name);

    await scan(harness, watchFolderId);

    const allForFile = harness.db.repos.frames.list().filter((f) => f.fileId === fileId);
    // Exactly one frame row for the file (upserted in place, not duplicated).
    expect(allForFile).toHaveLength(1);
    const after = allForFile[0]!;
    expect(after.id).toBe(before.id);
    expect(after.frameType).toBe('dark');
    expect(after.updatedAt.getTime()).toBeGreaterThan(before.updatedAt.getTime());
  }, 25000);
});
