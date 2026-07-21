/**
 * P1-08 unit tests for the `'hash'` job runner (DD-004 Stage 5a) — real temp
 * files, real streaming SHA-256, exercised directly with a fake `JobContext`
 * (no `worker_threads` instance), mirroring `demo-job.test.ts`. Covers correct
 * digests, batch flushing + progress, per-file error isolation (one
 * missing/unreadable file never aborts the rest), and cooperative cancellation.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runHashJob } from './hash-job.js';
import type { JobContext } from './job-context.js';
import type { HashCandidate, HashError, HashedFile } from './protocol.js';

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'astro-p1-08-hash-'));
  dirs.push(dir);
  return dir;
}

interface Progress {
  current: number;
  total: number | null;
  message: string | null;
}

function recordingContext(isCancelled: () => boolean = () => false) {
  const hashed: Array<HashedFile | HashError> = [];
  const progress: Progress[] = [];
  const ctx: JobContext = {
    reportProgress: (current, total, message) => {
      progress.push({ current, total, message });
    },
    // Hash jobs never discover files; a no-op keeps the fake ctx conformant.
    reportDiscovered: () => {},
    reportHashed: (results) => {
      hashed.push(...results);
    },
    isCancelled,
  };
  return { ctx, hashed, progress };
}

/** The reference digest node would compute for a UTF-8 string. */
function sha256Of(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function writeFile(dir: string, name: string, content: string): string {
  const full = path.join(dir, name);
  writeFileSync(full, content);
  return full;
}

describe('runHashJob', () => {
  it('streams a full SHA-256 for each candidate and reports it via reportHashed', async () => {
    const dir = tempDir();
    const files: HashCandidate[] = [
      { fileId: 'file-a', absolutePath: writeFile(dir, 'a.fits', 'alpha'), sizeBytes: 5 },
      { fileId: 'file-b', absolutePath: writeFile(dir, 'b.fits', 'beta-content'), sizeBytes: 12 },
    ];

    const { ctx, hashed } = recordingContext();
    await runHashJob({ files }, ctx);

    expect(hashed).toEqual([
      { fileId: 'file-a', sha256: sha256Of('alpha') },
      { fileId: 'file-b', sha256: sha256Of('beta-content') },
    ]);
  });

  it('produces identical digests for identical content (duplicate detection basis)', async () => {
    const dir = tempDir();
    const files: HashCandidate[] = [
      { fileId: 'dup-1', absolutePath: writeFile(dir, 'one.fits', 'same bytes'), sizeBytes: 10 },
      { fileId: 'dup-2', absolutePath: writeFile(dir, 'two.fits', 'same bytes'), sizeBytes: 10 },
    ];

    const { ctx, hashed } = recordingContext();
    await runHashJob({ files }, ctx);

    const one = hashed.find((r) => r.fileId === 'dup-1') as HashedFile;
    const two = hashed.find((r) => r.fileId === 'dup-2') as HashedFile;
    expect(one.sha256).toBe(two.sha256);
  });

  it('isolates a missing/unreadable file mid-batch without aborting the rest', async () => {
    const dir = tempDir();
    const files: HashCandidate[] = [
      { fileId: 'g1', absolutePath: writeFile(dir, 'g1.fits', 'one'), sizeBytes: 3 },
      { fileId: 'gone', absolutePath: path.join(dir, 'does-not-exist.fits'), sizeBytes: 0 },
      { fileId: 'g2', absolutePath: writeFile(dir, 'g2.fits', 'three'), sizeBytes: 5 },
    ];

    const { ctx, hashed } = recordingContext();
    await runHashJob({ files }, ctx);

    const byId = new Map(hashed.map((r) => [r.fileId, r]));
    expect(byId.size).toBe(3);
    expect('sha256' in byId.get('g1')!).toBe(true);
    expect('sha256' in byId.get('g2')!).toBe(true);
    const gone = byId.get('gone')!;
    expect('error' in gone).toBe(true);
    expect((gone as HashError).error.length).toBeGreaterThan(0);
  });

  it('flushes results in batches and reports progress as it goes', async () => {
    const dir = tempDir();
    const files: HashCandidate[] = [];
    for (let i = 0; i < 120; i += 1) {
      files.push({
        fileId: `f${i}`,
        absolutePath: writeFile(dir, `f${i}.fits`, `content-${i}`),
        sizeBytes: 0,
      });
    }

    const { ctx, hashed, progress } = recordingContext();
    await runHashJob({ files }, ctx);

    expect(hashed).toHaveLength(120);
    // BATCH_SIZE is 50 → flushes at 50, 100, and a final 20 → ≥3 progress ticks.
    expect(progress.length).toBeGreaterThanOrEqual(3);
    expect(progress.at(-1)).toEqual({
      current: 120,
      total: 120,
      message: 'hashed 120/120 files',
    });
  });

  it('stops early once ctx.isCancelled() trips (checked between files)', async () => {
    const dir = tempDir();
    const files: HashCandidate[] = [];
    for (let i = 0; i < 60; i += 1) {
      files.push({
        fileId: `f${i}`,
        absolutePath: writeFile(dir, `f${i}.fits`, `content-${i}`),
        sizeBytes: 0,
      });
    }

    // isCancelled is checked once at the top of each file iteration. Trip it at
    // the 56th check (i.e. before processing f55) — by then f0..f49 have been
    // flushed as one full batch (50), and f50..f54 sit unflushed (dropped on
    // the cancel-return, which deliberately does not flush).
    let checks = 0;
    const { ctx, hashed } = recordingContext(() => {
      checks += 1;
      return checks > 55;
    });
    await runHashJob({ files }, ctx);

    expect(hashed).toHaveLength(50);
  });

  it('handles an empty candidate list as a no-op', async () => {
    const { ctx, hashed, progress } = recordingContext();
    await runHashJob({ files: [] }, ctx);
    expect(hashed).toHaveLength(0);
    expect(progress).toHaveLength(0);
  });
});
