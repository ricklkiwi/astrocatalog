import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { isUuid, uuidv7 } from '@astrotracker/core';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase, type AstroDatabase } from './index.js';
import { resolveMigrationsFolder } from './migrate.js';

/**
 * Tables that exist for infrastructure rather than DD-003 domain data, and so
 * are excluded before the domain table set is compared for equality.
 */
const INFRA_TABLES = [
  '__drizzle_migrations', // drizzle-kit migration bookkeeping
  'search_fts', // FTS5 virtual table backing search
];

/**
 * FTS5 materialises its own shadow tables alongside the virtual table. They are
 * an implementation detail of `search_fts`, not schema this repo declares.
 */
function isFtsShadowTable(name: string): boolean {
  return /^search_fts_(data|idx|content|docsize|config)$/.test(name);
}

/** One row of `PRAGMA table_info(...)`. */
interface TableColumn {
  name: string;
  type: string;
  pk: number;
}

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
  it('creates exactly the DD-003 v1 tables — no more, no less', () => {
    const tables = withRawConnection((raw) =>
      raw
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map((row) => (row as { name: string }).name),
    );

    expect(tables, 'missing the FTS5 search table').toContain('search_fts');
    expect(tables, 'missing drizzle migration bookkeeping').toContain('__drizzle_migrations');

    const domainTables = tables
      .filter((name) => !INFRA_TABLES.includes(name) && !isFtsShadowTable(name))
      .sort();

    // Asserted as set equality, not containment: an unsanctioned table must fail
    // here the day it appears. Containment only catches omissions, and every
    // schema defect this project has had was an addition (ADR-004: P0-04 shipped
    // all sixteen v1 tables up front, including a polymorphic project_inputs
    // DD-003 had explicitly rejected — the old toContain assertion passed).
    expect(domainTables).toEqual([...DD003_TABLES].sort());
  });

  it('gives every DD-003 table a TEXT primary key and created_at/updated_at', () => {
    const columnsByTable = withRawConnection((raw) =>
      Object.fromEntries(
        DD003_TABLES.map((table) => [
          table,
          raw.prepare(`PRAGMA table_info(${table})`).all() as TableColumn[],
        ]),
      ),
    );

    for (const table of DD003_TABLES) {
      const columns = columnsByTable[table] ?? [];
      const names = columns.map((column) => column.name);

      // CLAUDE.md hard rule, from DD-003: required for Phase 2 sync. Previously
      // only spot-checked on individual tables via round-trip, so a new table
      // without them would have shipped silently.
      expect(names, `${table} is missing created_at`).toContain('created_at');
      expect(names, `${table} is missing updated_at`).toContain('updated_at');

      const primaryKey = columns.filter((column) => column.pk > 0);
      expect(primaryKey, `${table} has no primary key`).toHaveLength(1);
      expect(primaryKey[0]?.type, `${table}'s primary key must be TEXT`).toBe('TEXT');

      // `settings` is keyed by its setting name rather than a surrogate UUIDv7;
      // every other table uses `id`.
      expect(primaryKey[0]?.name, `unexpected primary key column on ${table}`).toBe(
        table === 'settings' ? 'key' : 'id',
      );
    }
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

    expect(frame.fileId).toBe(file.id);
    expect(frame.targetId).toBe(target.id);
    expect(frame.filterId).toBe(filter.id);
    expect(frame.sessionId).toBe(session.id);
    expect(frame.equipmentProfileId).toBe(equipmentProfile.id);
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

describe('migration 0002 (scan_jobs queue columns) against a pre-existing P0-04 install', () => {
  /**
   * Builds a migrations folder containing only 0000/0001 (byte-identical
   * copies of the committed files, so their sha256 hashes match what the
   * full migrate() run will see) to bring a fresh DB file to the exact
   * pre-0002 schema, simulating an existing install that predates this issue.
   *
   * drizzle's migrate() decides "already applied" by comparing each
   * migration's journal `when` (folderMillis) against the latest applied
   * row's `created_at` — NOT by hash — so the legacy journal's `when` values
   * for 0000/0001 must match the real committed journal exactly, or the full
   * migrate() run (0000..0002) will treat them as still-pending and re-run
   * their CREATE TABLEs against a database that already has those tables.
   */
  function buildLegacyMigrationsFolder(dir: string): string {
    const legacyFolder = join(dir, 'legacy-migrations');
    mkdirSync(join(legacyFolder, 'meta'), { recursive: true });
    const fullFolder = resolveMigrationsFolder();
    copyFileSync(
      join(fullFolder, '0000_numerous_dreadnoughts.sql'),
      join(legacyFolder, '0000_numerous_dreadnoughts.sql'),
    );
    copyFileSync(
      join(fullFolder, '0001_fts5_search.sql'),
      join(legacyFolder, '0001_fts5_search.sql'),
    );
    const realJournal = JSON.parse(
      readFileSync(join(fullFolder, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number; when: number; tag: string }> };
    const legacyEntries = realJournal.entries.filter((e) => e.idx <= 1);
    writeFileSync(
      join(legacyFolder, 'meta', '_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'sqlite',
        entries: legacyEntries.map((e) => ({ ...e, breakpoints: true, version: '6' })),
      }),
    );
    return legacyFolder;
  }

  // Two real mkdtemp+migrate() passes plus a legacy-journal file copy —
  // legitimately slow synchronous fs+SQLite work that occasionally exceeds
  // vitest's default 5000ms on Windows CI runners (observed ~9.8s wall time
  // under CI load). Explicit timeout below is generous headroom, not a
  // correctness change.
  it("backfills job_type='scan' and preserves original columns on pre-existing rows", () => {
    const dir = mkdtempSync(join(tmpdir(), 'astrotracker-legacy-migration-'));
    const legacyFilePath = join(dir, 'legacy.db');
    try {
      // 1. Bring a fresh file to the exact pre-0002 (P0-04) schema.
      const legacyConnection = new Database(legacyFilePath);
      legacyConnection.pragma('foreign_keys = ON');
      migrate(drizzle(legacyConnection), {
        migrationsFolder: buildLegacyMigrationsFolder(dir),
      });

      // 2. Seed a legacy scan_jobs row using only pre-0002 columns (no
      // job_type/payload_json/progress_*/priority/worker_id/etc. — those
      // didn't exist yet).
      const watchFolderId = uuidv7();
      const now = Date.now();
      legacyConnection
        .prepare(
          `INSERT INTO watch_folders (id, created_at, updated_at, path, is_active)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(watchFolderId, now, now, '/Volumes/Legacy', 1);
      const legacyJobId = uuidv7();
      legacyConnection
        .prepare(
          `INSERT INTO scan_jobs
             (id, created_at, updated_at, watch_folder_id, status, files_seen, files_added,
              files_updated, started_at, finished_at, error)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(legacyJobId, now, now, watchFolderId, 'completed', 42, 10, 2, now, now, null);
      legacyConnection.close();

      // 3. Apply the full migration set (0000..0002) — only 0002 is pending,
      // since 0000/0001 hashes already match the applied bookkeeping.
      const db: AstroDatabase = openDatabase({ filePath: legacyFilePath });
      try {
        const raw = new Database(legacyFilePath);
        try {
          const row = raw
            .prepare('SELECT * FROM scan_jobs WHERE id = ?')
            .get(legacyJobId) as Record<string, unknown>;
          expect(row['job_type']).toBe('scan');
          expect(row['status']).toBe('completed');
          expect(row['files_seen']).toBe(42);
          expect(row['files_added']).toBe(10);
          expect(row['files_updated']).toBe(2);
          expect(row['started_at']).toBe(now);
          expect(row['finished_at']).toBe(now);
          expect(row['watch_folder_id']).toBe(watchFolderId);
          // New generic queue columns get their schema defaults.
          expect(row['progress_current']).toBe(0);
          expect(row['progress_total']).toBeNull();
          expect(row['priority']).toBe(0);
          expect(row['cancel_requested']).toBe(0);
          expect(row['worker_id']).toBeNull();
        } finally {
          raw.close();
        }
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20000);

  it('applies cleanly on a fresh empty DB (0000→0002 in sequence)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'astrotracker-fresh-migration-'));
    try {
      const db = openDatabase({ filePath: join(dir, 'fresh.db') });
      try {
        const job = db.repos.scanJobs.insert({ jobType: 'demo', status: 'queued' });
        expect(job.jobType).toBe('demo');
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('migration 0006 (drop processing-project tables) against a pre-0006 install', () => {
  /**
   * Build a migrations folder holding every migration up to and including
   * `maxIdx`, byte-identical to the committed files so their hashes match, and
   * with the real journal `when` values — drizzle decides "already applied" by
   * comparing folderMillis against the latest applied row, not by hash, so a
   * fabricated `when` would make the full run re-apply 0000's CREATE TABLEs.
   */
  function buildPartialMigrationsFolder(dir: string, maxIdx: number): string {
    const partialFolder = join(dir, `migrations-through-${maxIdx}`);
    mkdirSync(join(partialFolder, 'meta'), { recursive: true });
    const fullFolder = resolveMigrationsFolder();
    const realJournal = JSON.parse(
      readFileSync(join(fullFolder, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number; when: number; tag: string }> };
    const entries = realJournal.entries.filter((entry) => entry.idx <= maxIdx);
    for (const entry of entries) {
      copyFileSync(join(fullFolder, `${entry.tag}.sql`), join(partialFolder, `${entry.tag}.sql`));
    }
    writeFileSync(
      join(partialFolder, 'meta', '_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'sqlite',
        entries: entries.map((entry) => ({ ...entry, breakpoints: true, version: '6' })),
      }),
    );
    return partialFolder;
  }

  it('drops the tables and cleans their orphaned FTS rows on an install that has project data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'astrotracker-0006-migration-'));
    const filePath = join(dir, 'legacy.db');
    try {
      // 1. Bring a fresh file to the exact pre-0006 schema.
      const legacy = new Database(filePath);
      legacy.pragma('foreign_keys = ON');
      migrate(drizzle(legacy), { migrationsFolder: buildPartialMigrationsFolder(dir, 5) });

      // 2. Seed a project. Its FTS row is written by the 0001 trigger, which
      // is exactly what DROP TABLE alone would orphan (DROP TABLE does not
      // fire AFTER DELETE).
      const projectId = uuidv7();
      const now = Date.now();
      legacy
        .prepare(
          `INSERT INTO processing_projects (id, created_at, updated_at, name, notes)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(projectId, now, now, 'M31 LRGB', 'Andromeda panel 3');
      expect(
        legacy.prepare(`SELECT count(*) AS n FROM search_fts WHERE entity_type = 'project'`).get(),
      ).toEqual({ n: 1 });
      legacy.close();

      // 3. Run the full migration set, which now includes 0006.
      const db = openDatabase({ filePath });
      try {
        const tables = withRawConnectionAt(filePath, (raw) =>
          raw
            .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
            .all()
            .map((row) => (row as { name: string }).name),
        );
        expect(tables).not.toContain('processing_projects');
        expect(tables).not.toContain('project_inputs');
        expect(tables).not.toContain('processed_images');

        // The FTS index must not keep a hit pointing at a table that no
        // longer exists — a search for 'andromeda' would otherwise return an
        // unresolvable 'project' row forever.
        const orphans = withRawConnectionAt(filePath, (raw) =>
          raw.prepare(`SELECT count(*) AS n FROM search_fts WHERE entity_type = 'project'`).get(),
        );
        expect(orphans).toEqual({ n: 0 });

        // The rest of the catalog still works after the drop.
        const watchFolder = db.repos.watchFolders.insert({ path: '/Volumes/AstroSSD' });
        expect(isUuid(watchFolder.id)).toBe(true);
        expect(db.repos.search.query('androm*')).toHaveLength(0);
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20000);
});

describe('migration 0007 (timezone + session-assignment-lock columns) against a pre-0007 install', () => {
  const EXPECTED_COLUMNS: Record<string, string[]> = {
    watch_folders: [
      'id',
      'created_at',
      'updated_at',
      'path',
      'drive_label',
      'timezone',
      'is_active',
      'last_scan_at',
      'skip_patterns',
      'live_watch_enabled',
    ],
    sessions: [
      'id',
      'created_at',
      'updated_at',
      'session_date',
      'started_at_utc',
      'ended_at_utc',
      'timezone',
      'timezone_source',
      'equipment_profile_id',
      'notes',
      'weather_notes',
    ],
    frames: [
      'id',
      'created_at',
      'updated_at',
      'file_id',
      'frame_type',
      'frame_type_source',
      'object_raw',
      'target_id',
      'filter_raw',
      'filter_id',
      'exposure_seconds',
      'date_obs_utc',
      'telescope_raw',
      'camera_raw',
      'equipment_profile_id',
      'ccd_temp',
      'set_temp',
      'gain',
      'offset',
      'binning_x',
      'binning_y',
      'width_px',
      'height_px',
      'ra_deg',
      'dec_deg',
      'focal_length',
      'aperture',
      'pier_side',
      'airmass',
      'observer',
      'site_name',
      'bayer_pattern',
      'fwhm',
      'hfr',
      'star_count',
      'session_id',
      'session_assignment_locked',
      'headers_json',
    ],
  };

  /**
   * Build a migrations folder holding every migration up to and including
   * `maxIdx`, byte-identical to the committed files so their hashes match,
   * mirroring `buildPartialMigrationsFolder` in the 0006 describe block
   * above (duplicated locally rather than hoisted, matching that block's own
   * precedent of a self-contained describe block).
   */
  function buildPartialMigrationsFolder(dir: string, maxIdx: number): string {
    const partialFolder = join(dir, `migrations-through-${maxIdx}`);
    mkdirSync(join(partialFolder, 'meta'), { recursive: true });
    const fullFolder = resolveMigrationsFolder();
    const realJournal = JSON.parse(
      readFileSync(join(fullFolder, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number; when: number; tag: string }> };
    const entries = realJournal.entries.filter((entry) => entry.idx <= maxIdx);
    for (const entry of entries) {
      copyFileSync(join(fullFolder, `${entry.tag}.sql`), join(partialFolder, `${entry.tag}.sql`));
    }
    writeFileSync(
      join(partialFolder, 'meta', '_journal.json'),
      JSON.stringify({
        version: '7',
        dialect: 'sqlite',
        entries: entries.map((entry) => ({ ...entry, breakpoints: true, version: '6' })),
      }),
    );
    return partialFolder;
  }

  it('adds the four new columns, defaults them correctly, and preserves seeded rows', () => {
    const dir = mkdtempSync(join(tmpdir(), 'astrotracker-0007-migration-'));
    const filePath = join(dir, 'legacy.db');
    try {
      // 1. Bring a fresh file to the exact pre-0007 schema.
      const legacy = new Database(filePath);
      legacy.pragma('foreign_keys = ON');
      migrate(drizzle(legacy), { migrationsFolder: buildPartialMigrationsFolder(dir, 6) });

      // 2. Seed one row per altered table, using only pre-0007 columns.
      const now = Date.now();
      const watchFolderId = uuidv7();
      legacy
        .prepare(
          `INSERT INTO watch_folders (id, created_at, updated_at, path, is_active)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(watchFolderId, now, now, '/Volumes/AstroSSD', 1);

      const sessionId = uuidv7();
      legacy
        .prepare(
          `INSERT INTO sessions (id, created_at, updated_at, session_date)
           VALUES (?, ?, ?, ?)`,
        )
        .run(sessionId, now, now, '2026-01-15');

      const fileId = uuidv7();
      legacy
        .prepare(
          `INSERT INTO files
             (id, created_at, updated_at, watch_folder_id, relative_path, filename,
              extension, size_bytes, first_seen_at, last_seen_at, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          fileId,
          now,
          now,
          watchFolderId,
          'M31/Light_001.fits',
          'Light_001.fits',
          '.fits',
          32_000_000,
          now,
          now,
          'present',
        );

      const frameId = uuidv7();
      legacy
        .prepare(
          `INSERT INTO frames
             (id, created_at, updated_at, file_id, frame_type, frame_type_source,
              session_id, headers_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(frameId, now, now, fileId, 'light', 'header', sessionId, '{}');
      legacy.close();

      // 3. Apply the full migration set, which now includes 0007.
      const db: AstroDatabase = openDatabase({ filePath });
      try {
        const columnsByTable = withRawConnectionAt(filePath, (raw) =>
          Object.fromEntries(
            Object.keys(EXPECTED_COLUMNS).map((table) => [
              table,
              (raw.prepare(`PRAGMA table_info(${table})`).all() as TableColumn[]).map(
                (c) => c.name,
              ),
            ]),
          ),
        );

        // Set equality, not containment (#111): an unsanctioned extra column
        // (e.g. a session-level `manually_locked` flag this slice deliberately
        // does not add) must fail here the day it appears.
        for (const [table, expected] of Object.entries(EXPECTED_COLUMNS)) {
          expect(columnsByTable[table]?.slice().sort(), `${table} column set`).toEqual(
            [...expected].sort(),
          );
        }

        const watchFolderRow = withRawConnectionAt(filePath, (raw) =>
          raw.prepare('SELECT timezone FROM watch_folders WHERE id = ?').get(watchFolderId),
        );
        expect(watchFolderRow).toEqual({ timezone: null });

        const sessionRow = withRawConnectionAt(filePath, (raw) =>
          raw.prepare('SELECT timezone, timezone_source FROM sessions WHERE id = ?').get(sessionId),
        );
        expect(sessionRow).toEqual({ timezone: null, timezone_source: null });

        const frameRow = withRawConnectionAt(filePath, (raw) =>
          raw.prepare('SELECT session_assignment_locked FROM frames WHERE id = ?').get(frameId),
        );
        expect(frameRow).toEqual({ session_assignment_locked: 0 });

        // Pre-existing rows survived the migration untouched.
        expect(db.repos.watchFolders.getById(watchFolderId)?.path).toBe('/Volumes/AstroSSD');
        expect(db.repos.sessions.getById(sessionId)?.sessionDate).toBe('2026-01-15');
        expect(db.repos.frames.getById(frameId)?.frameType).toBe('light');
      } finally {
        db.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 20000);

  it('round-trips all four new fields through the repositories, camelCase and typed', () => {
    const { repos } = db;
    const watchFolder = repos.watchFolders.insert({
      path: '/Volumes/AstroSSD2',
      timezone: 'America/Denver',
    });
    expect(watchFolder.timezone).toBe('America/Denver');

    const session = repos.sessions.insert({
      sessionDate: '2026-07-05',
      timezone: 'America/Denver',
      timezoneSource: 'watch_folder',
    });
    expect(session.timezone).toBe('America/Denver');
    expect(session.timezoneSource).toBe('watch_folder');

    const file = repos.files.insert({
      watchFolderId: watchFolder.id,
      ...fileFixture('2026-07-05/M31/Light_001.fits'),
    });
    const frame = repos.frames.insert({
      fileId: file.id,
      frameType: 'light',
      frameTypeSource: 'header',
      sessionId: session.id,
      sessionAssignmentLocked: true,
      headersJson: '{}',
    });
    expect(frame.sessionAssignmentLocked).toBe(true);

    const reread = repos.frames.getById(frame.id);
    expect(reread?.sessionAssignmentLocked).toBe(true);
  });

  it('applies cleanly on a fresh empty DB and defaults the lock column to false', () => {
    const dir = mkdtempSync(join(tmpdir(), 'astrotracker-0007-fresh-migration-'));
    try {
      const freshDb = openDatabase({ filePath: join(dir, 'fresh.db') });
      try {
        const watchFolder = freshDb.repos.watchFolders.insert({ path: '/Volumes/Fresh' });
        expect(watchFolder.timezone).toBeNull();
        const file = freshDb.repos.files.insert({
          watchFolderId: watchFolder.id,
          ...fileFixture('fresh.fits'),
        });
        const frame = freshDb.repos.frames.insert({
          fileId: file.id,
          frameType: 'light',
          frameTypeSource: 'header',
          headersJson: '{}',
        });
        expect(frame.sessionAssignmentLocked).toBe(false);
      } finally {
        freshDb.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/** `withRawConnection`, but against an explicit path rather than the suite's. */
function withRawConnectionAt<T>(
  filePath: string,
  fn: (raw: InstanceType<typeof Database>) => T,
): T {
  const raw = new Database(filePath, { readonly: true });
  try {
    return fn(raw);
  } finally {
    raw.close();
  }
}
