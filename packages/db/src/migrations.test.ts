import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { isUuid } from '@astrotracker/core';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase, type AstroDatabase } from './index.js';
import { resolveMigrationsFolder } from './migrate.js';

const DD003_TABLES = [
  'watch_folders',
  'files',
  'frames',
  'targets',
  'target_aliases',
  'filters',
  'sessions',
  'equipment_profiles',
  'master_frames',
  'master_frame_subs',
  'processing_projects',
  'project_inputs',
  'processed_images',
  'scan_jobs',
  'thumbnails',
  'settings',
];

const DD003_INDEXES = [
  'frames_target_filter_type_idx',
  'frames_session_id_idx',
  'frames_date_obs_utc_idx',
  'files_sha256_idx',
  'target_aliases_alias_normalized_idx',
];

let tempDir: string;
let filePath: string;
let db: AstroDatabase;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'astrotracker-migrations-'));
  filePath = join(tempDir, 'catalog.db');
  db = openDatabase({ filePath });
});

afterEach(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

/** Raw second connection for schema inspection and explicit-delete tests. */
function withRawConnection<T>(fn: (raw: InstanceType<typeof Database>) => T): T {
  const raw = new Database(filePath);
  raw.pragma('foreign_keys = ON');
  try {
    return fn(raw);
  } finally {
    raw.close();
  }
}

/** Minimal valid files-row payload. */
function fileFixture(relativePath: string) {
  return {
    relativePath,
    filename: relativePath.split('/').pop() as string,
    extension: '.fits',
    sizeBytes: 32_000_000,
    fileMtime: new Date('2026-01-15T22:10:00Z'),
    firstSeenAt: new Date('2026-01-16T08:00:00Z'),
    lastSeenAt: new Date('2026-01-16T08:00:00Z'),
    status: 'present' as const,
  };
}

describe('migration from empty database', () => {
  it('creates every DD-003 v1 table', () => {
    const tables = withRawConnection((raw) =>
      raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => (row as { name: string }).name),
    );
    for (const table of DD003_TABLES) {
      expect(tables, `missing table ${table}`).toContain(table);
    }
    expect(tables).toContain('search_fts');
    expect(tables).toContain('__drizzle_migrations');
  });

  it('creates the five DD-003 aggregation/lookup indexes', () => {
    const indexes = withRawConnection((raw) =>
      raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
        .all()
        .map((row) => (row as { name: string }).name),
    );
    for (const index of DD003_INDEXES) {
      expect(indexes, `missing index ${index}`).toContain(index);
    }
  });
});

describe('fixture round-trip through the repositories', () => {
  it('inserts a coherent graph and reads every row back, including FKs', () => {
    const { repos } = db;

    const watchFolder = repos.watchFolders.insert({
      path: '/Volumes/AstroSSD',
      driveLabel: 'AstroSSD',
      isActive: true,
    });
    const file = repos.files.insert({
      watchFolderId: watchFolder.id,
      ...fileFixture('2026-01-15/M31/Light_M31_L_300s_001.fits'),
    });
    const target = repos.targets.insert({
      canonicalName: 'M 31',
      displayName: 'Andromeda Galaxy',
      catalogIdsJson: '["M 31","NGC 224"]',
      status: 'capturing',
    });
    const filter = repos.filters.insert({ rawName: 'L', canonicalName: 'L', bandType: 'L' });
    const equipmentProfile = repos.equipmentProfiles.insert({
      name: 'EdgeHD 8 + ASI2600MM',
      telescope: 'EdgeHD 8',
      camera: 'ASI2600MM',
      focalLength: 2032,
      aperture: 203,
      pixelSize: 3.76,
      isUserConfirmed: true,
    });
    const session = repos.sessions.insert({
      sessionDate: '2026-01-15',
      startedAtUtc: new Date('2026-01-15T21:30:00Z'),
      endedAtUtc: new Date('2026-01-16T03:45:00Z'),
      equipmentProfileId: equipmentProfile.id,
      notes: 'First clear night in weeks',
    });
    const frame = repos.frames.insert({
      fileId: file.id,
      frameType: 'light',
      frameTypeSource: 'header',
      objectRaw: 'M31',
      targetId: target.id,
      filterRaw: 'Lum',
      filterId: filter.id,
      exposureSeconds: 300,
      dateObsUtc: new Date('2026-01-15T22:05:00Z'),
      equipmentProfileId: equipmentProfile.id,
      sessionId: session.id,
      gain: 100,
      ccdTemp: -10,
      binningX: 1,
      binningY: 1,
      headersJson: JSON.stringify({ OBJECT: 'M31', 'DATE-OBS': '2026-01-15T22:05:00' }),
    });

    const masterFile = repos.files.insert({
      watchFolderId: watchFolder.id,
      ...fileFixture('calibration/MasterDark_300s_-10C.fits'),
    });
    const masterFrame = repos.masterFrames.insert({
      fileId: masterFile.id,
      masterType: 'dark',
      exposureSeconds: 300,
      ccdTemp: -10,
      gain: 100,
      subCount: 20,
    });
    const sub = repos.masterFrames.insertSub({
      masterFrameId: masterFrame.id,
      frameId: frame.id,
    });

    const project = repos.projects.insert({
      targetId: target.id,
      name: 'M31 LRGB',
      versionLabel: 'v1',
      status: 'in_progress',
      software: 'PixInsight',
      notes: 'Waiting on Ha data',
    });
    const frameInput = repos.projects.insertInput({
      projectId: project.id,
      inputType: 'frame',
      frameId: frame.id,
    });
    const masterInput = repos.projects.insertInput({
      projectId: project.id,
      inputType: 'master_frame',
      masterFrameId: masterFrame.id,
    });

    // Every id is a UUIDv7 stamped by the repository layer.
    for (const row of [watchFolder, file, target, filter, equipmentProfile, session, frame]) {
      expect(isUuid(row.id)).toBe(true);
      expect(row.createdAt).toBeInstanceOf(Date);
      expect(row.updatedAt).toBeInstanceOf(Date);
    }

    // getById returns exactly what was written, FKs included.
    expect(db.repos.watchFolders.getById(watchFolder.id)).toEqual(watchFolder);
    expect(db.repos.files.getById(file.id)).toEqual(file);
    expect(db.repos.targets.getById(target.id)).toEqual(target);
    expect(db.repos.filters.getById(filter.id)).toEqual(filter);
    expect(db.repos.equipmentProfiles.getById(equipmentProfile.id)).toEqual(equipmentProfile);
    expect(db.repos.sessions.getById(session.id)).toEqual(session);
    expect(db.repos.frames.getById(frame.id)).toEqual(frame);
    expect(db.repos.masterFrames.getById(masterFrame.id)).toEqual(masterFrame);
    expect(db.repos.masterFrames.listSubs(masterFrame.id)).toEqual([sub]);
    expect(db.repos.projects.getById(project.id)).toEqual(project);
    expect(db.repos.projects.listInputs(project.id)).toEqual(
      expect.arrayContaining([frameInput, masterInput]),
    );
    expect(db.repos.projects.listInputs(project.id)).toHaveLength(2);

    expect(frame.fileId).toBe(file.id);
    expect(frame.targetId).toBe(target.id);
    expect(frame.filterId).toBe(filter.id);
    expect(frame.sessionId).toBe(session.id);
    expect(frame.equipmentProfileId).toBe(equipmentProfile.id);
    expect(frameInput.frameId).toBe(frame.id);
    expect(frameInput.masterFrameId).toBeNull();
    expect(masterInput.masterFrameId).toBe(masterFrame.id);
    expect(masterInput.frameId).toBeNull();
  });

  it('update() re-stamps updated_at and leaves unspecified columns untouched', () => {
    const target = db.repos.targets.insert({ canonicalName: 'M 42', notes: 'Orion Nebula' });
    const updated = db.repos.targets.update(target.id, { displayName: 'Orion Nebula' });
    expect(updated?.displayName).toBe('Orion Nebula');
    expect(updated?.canonicalName).toBe('M 42');
    expect(updated?.notes).toBe('Orion Nebula');
    expect(updated?.createdAt).toEqual(target.createdAt);
    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(target.updatedAt.getTime());
  });

  it('frames.list({ targetId }) returns only that target’s frames', () => {
    const { repos } = db;
    const watchFolder = repos.watchFolders.insert({ path: '/Volumes/AstroSSD' });
    const targetA = repos.targets.insert({ canonicalName: 'M 31' });
    const targetB = repos.targets.insert({ canonicalName: 'M 42' });

    const frameFor = (target: { id: string }, path: string) => {
      const file = repos.files.insert({ watchFolderId: watchFolder.id, ...fileFixture(path) });
      return repos.frames.insert({
        fileId: file.id,
        frameType: 'light',
        frameTypeSource: 'header',
        targetId: target.id,
        headersJson: '{}',
      });
    };

    const a1 = frameFor(targetA, 'a/1.fits');
    const a2 = frameFor(targetA, 'a/2.fits');
    frameFor(targetB, 'b/1.fits');

    const listed = repos.frames.list({ targetId: targetA.id });
    expect(listed.map((f) => f.id).sort()).toEqual([a1.id, a2.id].sort());
    expect(repos.frames.list()).toHaveLength(3);
  });
});

describe('constraint enforcement (foreign_keys=ON)', () => {
  it('rejects a frame whose file_id does not exist', () => {
    expect(() =>
      db.repos.frames.insert({
        fileId: '01890000-0000-7000-8000-000000000000',
        frameType: 'light',
        frameTypeSource: 'header',
        headersJson: '{}',
      }),
    ).toThrow(/FOREIGN KEY constraint failed/);
  });

  it('rejects a second frame for the same file_id with a typed UNIQUE violation', () => {
    const { repos } = db;
    const watchFolder = repos.watchFolders.insert({ path: '/Volumes/AstroSSD' });
    const file = repos.files.insert({ watchFolderId: watchFolder.id, ...fileFixture('x.fits') });
    repos.frames.insert({
      fileId: file.id,
      frameType: 'light',
      frameTypeSource: 'header',
      headersJson: '{}',
    });

    let caught: unknown;
    try {
      repos.frames.insert({
        fileId: file.id,
        frameType: 'dark',
        frameTypeSource: 'manual',
        headersJson: '{}',
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as { code?: string }).code).toBe('SQLITE_CONSTRAINT_UNIQUE');
    // The first frame is still the one on record — no silent overwrite.
    expect(repos.frames.list().filter((f) => f.fileId === file.id)).toHaveLength(1);
  });

  it('rejects project_inputs with both frame_id and master_frame_id set, and with neither', () => {
    const { repos } = db;
    const watchFolder = repos.watchFolders.insert({ path: '/Volumes/AstroSSD' });
    const file = repos.files.insert({ watchFolderId: watchFolder.id, ...fileFixture('y.fits') });
    const frame = repos.frames.insert({
      fileId: file.id,
      frameType: 'light',
      frameTypeSource: 'header',
      headersJson: '{}',
    });
    const masterFile = repos.files.insert({
      watchFolderId: watchFolder.id,
      ...fileFixture('master.fits'),
    });
    const master = repos.masterFrames.insert({ fileId: masterFile.id, masterType: 'flat' });
    const project = repos.projects.insert({ name: 'CHECK test' });

    expect(() =>
      repos.projects.insertInput({
        projectId: project.id,
        inputType: 'frame',
        frameId: frame.id,
        masterFrameId: master.id,
      }),
    ).toThrow(/CHECK constraint failed/);

    expect(() => repos.projects.insertInput({ projectId: project.id, inputType: 'frame' })).toThrow(
      /CHECK constraint failed/,
    );
  });

  it('sets duplicate_of_id to NULL (never cascades) when the canonical file row is deleted', () => {
    const { repos } = db;
    const watchFolder = repos.watchFolders.insert({ path: '/Volumes/AstroSSD' });
    const canonical = repos.files.insert({
      watchFolderId: watchFolder.id,
      ...fileFixture('canonical.fits'),
    });
    const duplicate = repos.files.insert({
      watchFolderId: watchFolder.id,
      ...fileFixture('copy/duplicate.fits'),
      status: 'duplicate',
      duplicateOfId: canonical.id,
    });

    // Explicit user delete of the canonical row (repos expose no delete —
    // rows are removed only by explicit user action per DD-003).
    withRawConnection((raw) => {
      raw.prepare('DELETE FROM files WHERE id = ?').run(canonical.id);
    });

    const survivor = repos.files.getById(duplicate.id);
    expect(survivor).toBeDefined();
    expect(survivor?.duplicateOfId).toBeNull();
  });
});

describe('migration folder resolution (src/ vs dist/)', () => {
  const packageRoot = join(import.meta.dirname, '..');

  it('resolves the committed drizzle/ folder relative to the module, not cwd', () => {
    const resolved = resolveMigrationsFolder();
    expect(resolved).toBe(join(packageRoot, 'drizzle'));
    expect(existsSync(join(resolved, 'meta', '_journal.json'))).toBe(true);
  });

  it('the import.meta.url-relative logic yields the same folder from src/ and dist/', () => {
    const fromSrc = new URL('../drizzle', pathToFileURL(join(packageRoot, 'src', 'migrate.ts')));
    const fromDist = new URL('../drizzle', pathToFileURL(join(packageRoot, 'dist', 'migrate.js')));
    expect(fromDist.pathname).toBe(fromSrc.pathname);
  });

  const distMigrate = join(packageRoot, 'dist', 'migrate.js');
  it.skipIf(!existsSync(distMigrate))(
    'the built dist/migrate.js resolves the identical folder and migrations apply',
    async () => {
      const distModule = (await import(pathToFileURL(distMigrate).href)) as {
        resolveMigrationsFolder(): string;
      };
      expect(distModule.resolveMigrationsFolder()).toBe(resolveMigrationsFolder());

      const distBootstrap = (await import(
        pathToFileURL(join(packageRoot, 'dist', 'bootstrap.js')).href
      )) as { openDatabase(options: { filePath: string }): { close(): void } };
      const distDb = distBootstrap.openDatabase({ filePath: join(tempDir, 'dist-built.db') });
      distDb.close();
    },
  );
});
