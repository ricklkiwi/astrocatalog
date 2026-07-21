import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase, type AstroDatabase } from '../index.js';

/**
 * DD-004 Stage 1 (discovery) repository semantics: upsert-on-scan and
 * missing-detection. Pure repository-level tests against an in-memory DB.
 */
let db: AstroDatabase;

function makeWatchFolder(path = '/mnt/astro') {
  return db.repos.watchFolders.insert({
    path,
    driveLabel: null,
    isActive: true,
    lastScanAt: null,
  });
}

beforeEach(() => {
  db = openDatabase({ filePath: ':memory:' });
});

afterEach(() => {
  db.close();
});

describe('upsertDiscovered', () => {
  it('inserts a new row as present, stamping firstSeenAt/lastSeenAt and leaving sha256 null', () => {
    const folder = makeWatchFolder();
    const seenAt = new Date('2026-07-20T10:00:00.000Z');

    const result = db.repos.files.upsertDiscovered(
      {
        watchFolderId: folder.id,
        relativePath: 'lights/frame_001.fits',
        filename: 'frame_001.fits',
        extension: '.fits',
        sizeBytes: 1024,
        fileMtime: new Date('2026-07-19T00:00:00.000Z'),
      },
      seenAt,
    );

    expect(result.isNew).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.wasRestored).toBe(false);
    expect(result.file.status).toBe('present');
    expect(result.file.sha256).toBeNull();
    expect(result.file.firstSeenAt.getTime()).toBe(seenAt.getTime());
    expect(result.file.lastSeenAt.getTime()).toBe(seenAt.getTime());
  });

  it('an unchanged rescan bumps lastSeenAt only: changed=false, sha256 preserved', () => {
    const folder = makeWatchFolder();
    const firstSeen = new Date('2026-07-20T10:00:00.000Z');
    const input = {
      watchFolderId: folder.id,
      relativePath: 'lights/frame_001.fits',
      filename: 'frame_001.fits',
      extension: '.fits',
      sizeBytes: 1024,
      fileMtime: new Date('2026-07-19T00:00:00.000Z'),
    };
    const first = db.repos.files.upsertDiscovered(input, firstSeen);

    // Simulate a hash having been computed since (P1-08 territory) so we can
    // assert it survives an unchanged rescan.
    db.repos.files.update(first.file.id, { sha256: 'deadbeef' });

    const rescanAt = new Date('2026-07-20T11:00:00.000Z');
    const second = db.repos.files.upsertDiscovered(input, rescanAt);

    expect(second.isNew).toBe(false);
    expect(second.changed).toBe(false);
    expect(second.wasRestored).toBe(false);
    expect(second.file.status).toBe('present');
    expect(second.file.sha256).toBe('deadbeef');
    expect(second.file.lastSeenAt.getTime()).toBe(rescanAt.getTime());
    expect(second.file.firstSeenAt.getTime()).toBe(firstSeen.getTime());
  });

  it('a size change on rescan reports changed=true and clears the stale sha256', () => {
    const folder = makeWatchFolder();
    const input = {
      watchFolderId: folder.id,
      relativePath: 'lights/frame_001.fits',
      filename: 'frame_001.fits',
      extension: '.fits',
      sizeBytes: 1024,
      fileMtime: new Date('2026-07-19T00:00:00.000Z'),
    };
    const first = db.repos.files.upsertDiscovered(input, new Date('2026-07-20T10:00:00.000Z'));
    db.repos.files.update(first.file.id, { sha256: 'deadbeef' });

    const rescan = db.repos.files.upsertDiscovered(
      { ...input, sizeBytes: 2048 },
      new Date('2026-07-20T11:00:00.000Z'),
    );

    expect(rescan.changed).toBe(true);
    expect(rescan.wasRestored).toBe(false);
    expect(rescan.file.sizeBytes).toBe(2048);
    expect(rescan.file.sha256).toBeNull();
  });

  it('an mtime change on rescan also reports changed=true and clears sha256', () => {
    const folder = makeWatchFolder();
    const input = {
      watchFolderId: folder.id,
      relativePath: 'lights/frame_001.fits',
      filename: 'frame_001.fits',
      extension: '.fits',
      sizeBytes: 1024,
      fileMtime: new Date('2026-07-19T00:00:00.000Z'),
    };
    const first = db.repos.files.upsertDiscovered(input, new Date('2026-07-20T10:00:00.000Z'));
    db.repos.files.update(first.file.id, { sha256: 'deadbeef' });

    const rescan = db.repos.files.upsertDiscovered(
      { ...input, fileMtime: new Date('2026-07-19T12:00:00.000Z') },
      new Date('2026-07-20T11:00:00.000Z'),
    );

    expect(rescan.changed).toBe(true);
    expect(rescan.file.sha256).toBeNull();
  });

  it('restores a missing row to present on rediscovery (wasRestored=true, changed=true)', () => {
    const folder = makeWatchFolder();
    const input = {
      watchFolderId: folder.id,
      relativePath: 'lights/frame_001.fits',
      filename: 'frame_001.fits',
      extension: '.fits',
      sizeBytes: 1024,
      fileMtime: new Date('2026-07-19T00:00:00.000Z'),
    };
    const first = db.repos.files.upsertDiscovered(input, new Date('2026-07-20T09:00:00.000Z'));
    db.repos.files.markMissingNotSeenSince(folder.id, new Date('2026-07-20T12:00:00.000Z'));
    expect(db.repos.files.getById(first.file.id)?.status).toBe('missing');

    const restored = db.repos.files.upsertDiscovered(input, new Date('2026-07-20T13:00:00.000Z'));

    expect(restored.isNew).toBe(false);
    expect(restored.wasRestored).toBe(true);
    expect(restored.changed).toBe(true);
    expect(restored.file.status).toBe('present');
  });

  it('leaves a duplicate row status alone on an unchanged rescan (only lastSeenAt bumps)', () => {
    const folder = makeWatchFolder();
    const input = {
      watchFolderId: folder.id,
      relativePath: 'lights/frame_001.fits',
      filename: 'frame_001.fits',
      extension: '.fits',
      sizeBytes: 1024,
      fileMtime: new Date('2026-07-19T00:00:00.000Z'),
    };
    const first = db.repos.files.upsertDiscovered(input, new Date('2026-07-20T09:00:00.000Z'));
    db.repos.files.update(first.file.id, { status: 'duplicate', duplicateOfId: null });

    const rescan = db.repos.files.upsertDiscovered(input, new Date('2026-07-20T10:00:00.000Z'));

    expect(rescan.file.status).toBe('duplicate');
    expect(rescan.changed).toBe(false);
    expect(rescan.wasRestored).toBe(false);
    expect(rescan.file.lastSeenAt.getTime()).toBe(new Date('2026-07-20T10:00:00.000Z').getTime());
  });

  it('updates size/mtime on a duplicate row when they change, but leaves status as-is', () => {
    const folder = makeWatchFolder();
    const input = {
      watchFolderId: folder.id,
      relativePath: 'lights/frame_001.fits',
      filename: 'frame_001.fits',
      extension: '.fits',
      sizeBytes: 1024,
      fileMtime: new Date('2026-07-19T00:00:00.000Z'),
    };
    const first = db.repos.files.upsertDiscovered(input, new Date('2026-07-20T09:00:00.000Z'));
    db.repos.files.update(first.file.id, {
      status: 'duplicate',
      duplicateOfId: null,
      sha256: 'deadbeef',
    });

    const rescan = db.repos.files.upsertDiscovered(
      { ...input, sizeBytes: 9999 },
      new Date('2026-07-20T10:00:00.000Z'),
    );

    expect(rescan.file.status).toBe('duplicate');
    expect(rescan.changed).toBe(true);
    expect(rescan.file.sizeBytes).toBe(9999);
    expect(rescan.file.sha256).toBeNull();
  });
});

describe('markMissingNotSeenSince', () => {
  it('marks only present rows older than cutoff for the given watch folder', () => {
    const folder = makeWatchFolder('/mnt/astro-a');
    const otherFolder = makeWatchFolder('/mnt/astro-b');
    const cutoff = new Date('2026-07-20T12:00:00.000Z');

    const stale = db.repos.files.upsertDiscovered(
      {
        watchFolderId: folder.id,
        relativePath: 'stale.fits',
        filename: 'stale.fits',
        extension: '.fits',
        sizeBytes: 1,
        fileMtime: null,
      },
      new Date('2026-07-20T10:00:00.000Z'), // before cutoff
    );
    const fresh = db.repos.files.upsertDiscovered(
      {
        watchFolderId: folder.id,
        relativePath: 'fresh.fits',
        filename: 'fresh.fits',
        extension: '.fits',
        sizeBytes: 1,
        fileMtime: null,
      },
      new Date('2026-07-20T13:00:00.000Z'), // after cutoff
    );
    const otherFolderFile = db.repos.files.upsertDiscovered(
      {
        watchFolderId: otherFolder.id,
        relativePath: 'stale.fits',
        filename: 'stale.fits',
        extension: '.fits',
        sizeBytes: 1,
        fileMtime: null,
      },
      new Date('2026-07-20T10:00:00.000Z'), // before cutoff, different folder
    );

    const updated = db.repos.files.markMissingNotSeenSince(folder.id, cutoff);

    expect(updated.map((f) => f.id)).toEqual([stale.file.id]);
    expect(db.repos.files.getById(stale.file.id)?.status).toBe('missing');
    expect(db.repos.files.getById(fresh.file.id)?.status).toBe('present');
    expect(db.repos.files.getById(otherFolderFile.file.id)?.status).toBe('present');
  });

  it('does not touch already-missing rows', () => {
    const folder = makeWatchFolder();
    const cutoff = new Date('2026-07-20T12:00:00.000Z');
    const file = db.repos.files.upsertDiscovered(
      {
        watchFolderId: folder.id,
        relativePath: 'already-missing.fits',
        filename: 'already-missing.fits',
        extension: '.fits',
        sizeBytes: 1,
        fileMtime: null,
      },
      new Date('2026-07-20T09:00:00.000Z'),
    );
    // First pass marks it missing.
    const firstPass = db.repos.files.markMissingNotSeenSince(folder.id, cutoff);
    expect(firstPass.map((f) => f.id)).toEqual([file.file.id]);

    // Second pass with the same cutoff should be a no-op (row is no longer 'present').
    const secondPass = db.repos.files.markMissingNotSeenSince(folder.id, cutoff);
    expect(secondPass).toHaveLength(0);
  });
});
