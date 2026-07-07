/**
 * Database bootstrap: opens the caller-supplied SQLite file, applies
 * connection PRAGMAs, verifies FTS5 support, runs pending migrations, and
 * returns the `AstroDatabase` handle. The raw better-sqlite3 connection and
 * the Drizzle instance are captured in a closure and never escape the
 * package (issue #4 acceptance criterion).
 *
 * The caller supplies the file path — this package never asks Electron for
 * the app-data dir (DD-003's app-data location is the desktop package's
 * responsibility, P0-05+). The only fs write here is creating parent
 * directories for that caller-supplied DB file; user image files are never
 * touched (DD-002 rule 5).
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

import { isFts5Available } from './fts5-support.js';
import { runMigrations } from './migrate.js';

type SqliteConnection = InstanceType<typeof Database>;

export interface OpenDatabaseOptions {
  /**
   * SQLite file path (parent directories are created if absent), or
   * `':memory:'` for a throwaway in-memory database (fast unit tests; note
   * that in-memory DBs report `journal_mode=memory`, not WAL).
   */
  filePath: string;
  /** PRAGMA busy_timeout in milliseconds. Default: 5000 (plan deviation 8). */
  busyTimeoutMs?: number;
}

/**
 * The only handle callers ever see — no raw connection, no Drizzle instance.
 * The repository surface (`repos`, `transaction`) is attached in the
 * repository-skeleton step.
 */
export interface AstroDatabase {
  close(): void;
}

/**
 * Internal: open the connection and apply PRAGMAs in DD-003 order. Exported
 * for bootstrap tests only — not part of the package's public API
 * (`src/index.ts` does not re-export it).
 */
export function openConnection(options: OpenDatabaseOptions): SqliteConnection {
  const { filePath, busyTimeoutMs = 5000 } = options;

  if (filePath !== ':memory:') {
    mkdirSync(dirname(filePath), { recursive: true });
  }

  const connection = new Database(filePath);
  connection.pragma('journal_mode = WAL');
  connection.pragma(`busy_timeout = ${busyTimeoutMs}`);
  connection.pragma('foreign_keys = ON');
  connection.pragma('synchronous = NORMAL');

  if (!isFts5Available(connection)) {
    connection.close();
    throw new Error(
      'AstroTracker requires SQLite with the FTS5 extension, but the linked ' +
        'better-sqlite3 build does not include it. Reinstall dependencies ' +
        '(`pnpm install`) to restore the bundled better-sqlite3 binary, which ' +
        'ships with FTS5 compiled in.',
    );
  }

  return connection;
}

/**
 * Open (creating if absent) and migrate an AstroTracker database.
 * Idempotent: reopening an already-migrated file applies zero migrations.
 */
export function openDatabase(options: OpenDatabaseOptions): AstroDatabase {
  const connection = openConnection(options);

  try {
    const db = drizzle(connection);
    runMigrations(db);

    return {
      close(): void {
        connection.close();
      },
    };
  } catch (error) {
    connection.close();
    throw error;
  }
}
