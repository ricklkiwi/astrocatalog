import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { openConnection, openDatabase } from './bootstrap.js';
import * as fts5Support from './fts5-support.js';

// Mockable FTS5 probe. Default mirrors the real build (FTS5 present); the
// fail-fast test flips it to simulate a build without FTS5. The real probe
// is exercised end-to-end by fts.test.ts, which runs unmocked FTS5 queries.
vi.mock('./fts5-support.js', () => ({
  isFts5Available: vi.fn(() => true),
}));

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'astrotracker-bootstrap-'));
});

afterEach(() => {
  vi.mocked(fts5Support.isFts5Available).mockImplementation(() => true);
  rmSync(tempDir, { recursive: true, force: true });
});

function pragmaValue(connection: InstanceType<typeof Database>, name: string): unknown {
  return connection.pragma(name, { simple: true });
}

describe('openConnection PRAGMAs (real temp file)', () => {
  it('applies journal_mode=wal, busy_timeout, foreign_keys=ON, synchronous=NORMAL', () => {
    const connection = openConnection({ filePath: join(tempDir, 'pragmas.db') });
    try {
      expect(pragmaValue(connection, 'journal_mode')).toBe('wal');
      expect(pragmaValue(connection, 'busy_timeout')).toBe(5000);
      expect(pragmaValue(connection, 'foreign_keys')).toBe(1);
      // synchronous=NORMAL reports as 1
      expect(pragmaValue(connection, 'synchronous')).toBe(1);
    } finally {
      connection.close();
    }
  });

  it('honors a configured busy_timeout instead of the 5000ms default', () => {
    const connection = openConnection({
      filePath: join(tempDir, 'busy.db'),
      busyTimeoutMs: 250,
    });
    try {
      expect(pragmaValue(connection, 'busy_timeout')).toBe(250);
    } finally {
      connection.close();
    }
  });
});

describe('openDatabase', () => {
  it('creates missing parent directories for the database file', () => {
    const filePath = join(tempDir, 'deeply', 'nested', 'dirs', 'catalog.db');
    const db = openDatabase({ filePath });
    db.close();
    expect(existsSync(filePath)).toBe(true);
  });

  it('is idempotent: reopening the same file applies zero further migrations', () => {
    const filePath = join(tempDir, 'idempotent.db');
    openDatabase({ filePath }).close();

    const inspect = new Database(filePath);
    const migrationsAfterFirstOpen = inspect
      .prepare('SELECT count(*) AS c FROM __drizzle_migrations')
      .get() as { c: number };
    const tablesAfterFirstOpen = inspect
      .prepare("SELECT count(*) AS c FROM sqlite_master WHERE type = 'table'")
      .get() as { c: number };
    inspect.close();

    openDatabase({ filePath }).close();

    const reinspect = new Database(filePath);
    const migrationsAfterSecondOpen = reinspect
      .prepare('SELECT count(*) AS c FROM __drizzle_migrations')
      .get() as { c: number };
    const tablesAfterSecondOpen = reinspect
      .prepare("SELECT count(*) AS c FROM sqlite_master WHERE type = 'table'")
      .get() as { c: number };
    reinspect.close();

    expect(migrationsAfterSecondOpen.c).toBe(migrationsAfterFirstOpen.c);
    expect(tablesAfterSecondOpen.c).toBe(tablesAfterFirstOpen.c);
  });

  it("supports ':memory:' even though journal_mode stays 'memory' (not wal)", () => {
    const connection = openConnection({ filePath: ':memory:' });
    try {
      expect(pragmaValue(connection, 'journal_mode')).toBe('memory');
    } finally {
      connection.close();
    }
    expect(() => openDatabase({ filePath: ':memory:' }).close()).not.toThrow();
  });

  it('fails fast with an actionable FTS5 message when the SQLite build lacks FTS5', () => {
    vi.mocked(fts5Support.isFts5Available).mockReturnValue(false);

    const filePath = join(tempDir, 'no-fts5.db');
    expect(() => openDatabase({ filePath })).toThrow(/FTS5/);
    expect(() => openDatabase({ filePath })).not.toThrow(/no such module/);

    // Fails during bootstrap, before any migration runs: no tables exist.
    const inspect = new Database(filePath);
    const tables = inspect
      .prepare("SELECT count(*) AS c FROM sqlite_master WHERE type = 'table'")
      .get() as { c: number };
    inspect.close();
    expect(tables.c).toBe(0);
  });
});
