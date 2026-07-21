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

function makePresentFile(folderId: string, relativePath: string, seenAt: Date, sizeBytes = 1024) {
  return db.repos.files.upsertDiscovered(
    {
      watchFolderId: folderId,
      relativePath,
      filename: relativePath.split('/').pop() ?? relativePath,
      extension: '.fits',
      sizeBytes,
      fileMtime: null,
    },
    seenAt,
  ).file;
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

describe('recordHash', () => {
  const HASH = 'a'.repeat(64);

  it('with no other match stays present and is its own canonical', () => {
    const folder = makeWatchFolder();
    const file = makePresentFile(folder.id, 'lights/a.fits', new Date('2026-07-20T10:00:00.000Z'));

    const result = db.repos.files.recordHash(file.id, HASH);

    expect(result.canonicalId).toBe(file.id);
    expect(result.file.id).toBe(file.id);
    expect(result.file.sha256).toBe(HASH);
    expect(result.file.status).toBe('present');
    expect(result.file.duplicateOfId).toBeNull();
  });

  it('marks the newer file duplicate of the older canonical when hashes collide', () => {
    const folder = makeWatchFolder();
    const older = makePresentFile(
      folder.id,
      'lights/older.fits',
      new Date('2026-07-20T09:00:00.000Z'),
    );
    const newer = makePresentFile(
      folder.id,
      'lights/newer.fits',
      new Date('2026-07-20T10:00:00.000Z'),
    );

    const olderResult = db.repos.files.recordHash(older.id, HASH);
    expect(olderResult.canonicalId).toBe(older.id);

    const newerResult = db.repos.files.recordHash(newer.id, HASH);

    expect(newerResult.canonicalId).toBe(older.id);
    expect(newerResult.file.status).toBe('duplicate');
    expect(newerResult.file.duplicateOfId).toBe(older.id);
    // Older row stays canonical.
    const olderRow = db.repos.files.getById(older.id);
    expect(olderRow?.status).toBe('present');
    expect(olderRow?.duplicateOfId).toBeNull();
  });

  it('is order-independent: hashing newer-first yields the same end state', () => {
    const folder = makeWatchFolder();
    const older = makePresentFile(
      folder.id,
      'lights/older.fits',
      new Date('2026-07-20T09:00:00.000Z'),
    );
    const newer = makePresentFile(
      folder.id,
      'lights/newer.fits',
      new Date('2026-07-20T10:00:00.000Z'),
    );

    // Hash the NEWER file first (it becomes its own canonical transiently)...
    const first = db.repos.files.recordHash(newer.id, HASH);
    expect(first.canonicalId).toBe(newer.id);
    expect(first.file.status).toBe('present');

    // ...then the older one, which re-canonicalizes the group.
    const second = db.repos.files.recordHash(older.id, HASH);
    expect(second.canonicalId).toBe(older.id);
    expect(second.file.status).toBe('present');
    expect(second.file.duplicateOfId).toBeNull();

    // The previously-canonical newer row must have flipped to duplicate.
    const newerRow = db.repos.files.getById(newer.id);
    expect(newerRow?.status).toBe('duplicate');
    expect(newerRow?.duplicateOfId).toBe(older.id);
  });

  it('re-canonicalizes when an even-older file joins the group last', () => {
    const folder = makeWatchFolder();
    // firstSeenAt: mid, then late, then the earliest hashed LAST.
    const mid = makePresentFile(folder.id, 'lights/mid.fits', new Date('2026-07-20T10:00:00.000Z'));
    const late = makePresentFile(
      folder.id,
      'lights/late.fits',
      new Date('2026-07-20T11:00:00.000Z'),
    );
    const earliest = makePresentFile(
      folder.id,
      'lights/earliest.fits',
      new Date('2026-07-20T08:00:00.000Z'),
    );

    db.repos.files.recordHash(mid.id, HASH);
    db.repos.files.recordHash(late.id, HASH);
    // mid is currently canonical.
    expect(db.repos.files.getById(mid.id)?.status).toBe('present');
    expect(db.repos.files.getById(late.id)?.duplicateOfId).toBe(mid.id);

    // The earliest file is hashed last — it must take over as canonical.
    const result = db.repos.files.recordHash(earliest.id, HASH);

    expect(result.canonicalId).toBe(earliest.id);
    expect(result.file.status).toBe('present');
    expect(result.file.duplicateOfId).toBeNull();
    // Previous canonical (mid) flips to duplicate pointing at the new canonical.
    expect(db.repos.files.getById(mid.id)?.status).toBe('duplicate');
    expect(db.repos.files.getById(mid.id)?.duplicateOfId).toBe(earliest.id);
    expect(db.repos.files.getById(late.id)?.duplicateOfId).toBe(earliest.id);
  });

  it('ignores missing rows when forming a live duplicate group', () => {
    const folder = makeWatchFolder();
    const missing = makePresentFile(
      folder.id,
      'lights/missing.fits',
      new Date('2026-07-20T08:00:00.000Z'),
    );
    // Give the missing row the same hash, then mark it missing.
    db.repos.files.update(missing.id, { sha256: HASH, status: 'missing' });

    const present = makePresentFile(
      folder.id,
      'lights/present.fits',
      new Date('2026-07-20T10:00:00.000Z'),
    );
    const result = db.repos.files.recordHash(present.id, HASH);

    // The older missing row must NOT be considered — present stays its own canonical.
    expect(result.canonicalId).toBe(present.id);
    expect(result.file.status).toBe('present');
    expect(result.file.duplicateOfId).toBeNull();
  });

  it('promotes a stale duplicate back to present when its new hash matches nothing', () => {
    const folder = makeWatchFolder();
    const file = makePresentFile(folder.id, 'lights/a.fits', new Date('2026-07-20T10:00:00.000Z'));
    // Simulate a prior resolution having marked it a duplicate of someone.
    db.repos.files.update(file.id, { status: 'duplicate', duplicateOfId: file.id });

    const result = db.repos.files.recordHash(file.id, HASH);

    expect(result.canonicalId).toBe(file.id);
    expect(result.file.status).toBe('present');
    expect(result.file.duplicateOfId).toBeNull();
  });
});

describe('listUnhashed', () => {
  it('returns only present, unhashed rows oldest-first and respects the limit', () => {
    const folder = makeWatchFolder();
    const first = makePresentFile(folder.id, 'a.fits', new Date('2026-07-20T08:00:00.000Z'));
    const second = makePresentFile(folder.id, 'b.fits', new Date('2026-07-20T09:00:00.000Z'));
    const third = makePresentFile(folder.id, 'c.fits', new Date('2026-07-20T10:00:00.000Z'));

    // Already-hashed present row: excluded.
    const hashed = makePresentFile(folder.id, 'd.fits', new Date('2026-07-20T07:00:00.000Z'));
    db.repos.files.update(hashed.id, { sha256: 'f'.repeat(64) });

    // Missing row (no hash): excluded because not present.
    const missing = makePresentFile(folder.id, 'e.fits', new Date('2026-07-20T06:00:00.000Z'));
    db.repos.files.update(missing.id, { status: 'missing' });

    const page = db.repos.files.listUnhashed(2);
    expect(page.map((f) => f.id)).toEqual([first.id, second.id]);

    const all = db.repos.files.listUnhashed(10);
    expect(all.map((f) => f.id)).toEqual([first.id, second.id, third.id]);
  });
});

describe('listMissingWithHash', () => {
  it('returns only missing rows that already have a hash, as MoveCandidates', () => {
    const folder = makeWatchFolder();
    const missingHashed = makePresentFile(
      folder.id,
      'moved.fits',
      new Date('2026-07-20T08:00:00.000Z'),
      4096,
    );
    db.repos.files.update(missingHashed.id, { sha256: 'b'.repeat(64), status: 'missing' });

    // Missing but unhashed: excluded.
    const missingNoHash = makePresentFile(
      folder.id,
      'gone.fits',
      new Date('2026-07-20T09:00:00.000Z'),
    );
    db.repos.files.update(missingNoHash.id, { status: 'missing' });

    // Present with hash: excluded (not missing).
    const presentHashed = makePresentFile(
      folder.id,
      'here.fits',
      new Date('2026-07-20T10:00:00.000Z'),
    );
    db.repos.files.update(presentHashed.id, { sha256: 'c'.repeat(64) });

    const candidates = db.repos.files.listMissingWithHash();
    expect(candidates).toEqual([
      {
        fileId: missingHashed.id,
        watchFolderId: folder.id,
        relativePath: 'moved.fits',
        sizeBytes: 4096,
        sha256: 'b'.repeat(64),
      },
    ]);
  });
});

describe('reparentMoved', () => {
  const HASH = 'd'.repeat(64);

  it('re-paths a missing row in place, preserving its id and frame FK link', () => {
    const folder = makeWatchFolder('/mnt/astro-a');
    const newFolder = makeWatchFolder('/mnt/astro-b');
    const file = makePresentFile(
      folder.id,
      'lights/old_name.fits',
      new Date('2026-07-20T08:00:00.000Z'),
    );
    db.repos.files.update(file.id, { sha256: HASH, status: 'missing' });

    // A frames row references files.id — it must survive the re-path.
    const frame = db.repos.frames.insert({
      fileId: file.id,
      frameType: 'light',
      frameTypeSource: 'header',
      headersJson: '{}',
    });

    const seenAt = new Date('2026-07-21T09:00:00.000Z');
    const moved = db.repos.files.reparentMoved(
      file.id,
      {
        watchFolderId: newFolder.id,
        relativePath: 'lights/new_name.fits',
        filename: 'new_name.fits',
        extension: '.fits',
        sizeBytes: 2048,
        fileMtime: new Date('2026-07-21T00:00:00.000Z'),
        sha256: HASH,
      },
      seenAt,
    );

    expect(moved).toBeDefined();
    // Same id — this is what preserves the FK links.
    expect(moved?.id).toBe(file.id);
    expect(moved?.watchFolderId).toBe(newFolder.id);
    expect(moved?.relativePath).toBe('lights/new_name.fits');
    expect(moved?.filename).toBe('new_name.fits');
    expect(moved?.sizeBytes).toBe(2048);
    expect(moved?.sha256).toBe(HASH);
    expect(moved?.status).toBe('present');
    expect(moved?.duplicateOfId).toBeNull();
    expect(moved?.lastSeenAt.getTime()).toBe(seenAt.getTime());

    // The frame still resolves to the same (re-pathed) file row.
    const frameRow = db.repos.frames.getById(frame.id);
    expect(frameRow?.fileId).toBe(file.id);
    expect(db.repos.files.getById(file.id)?.relativePath).toBe('lights/new_name.fits');
  });

  it('returns undefined when the target row is not status=missing', () => {
    const folder = makeWatchFolder();
    const file = makePresentFile(
      folder.id,
      'lights/present.fits',
      new Date('2026-07-20T08:00:00.000Z'),
    );

    const result = db.repos.files.reparentMoved(
      file.id,
      {
        watchFolderId: folder.id,
        relativePath: 'lights/elsewhere.fits',
        filename: 'elsewhere.fits',
        extension: '.fits',
        sizeBytes: 1024,
        fileMtime: null,
        sha256: HASH,
      },
      new Date('2026-07-21T09:00:00.000Z'),
    );

    expect(result).toBeUndefined();
    // The present row was left untouched.
    expect(db.repos.files.getById(file.id)?.relativePath).toBe('lights/present.fits');
  });
});
