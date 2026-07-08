/**
 * FTS5 availability probe, isolated in its own module so tests can mock it
 * to simulate a better-sqlite3 build compiled without FTS5.
 */
import type Database from 'better-sqlite3';

type SqliteConnection = InstanceType<typeof Database>;

/** True if the linked SQLite build has the FTS5 extension compiled in. */
export function isFts5Available(connection: SqliteConnection): boolean {
  try {
    connection.exec(
      'CREATE VIRTUAL TABLE temp.__astrotracker_fts5_probe USING fts5(probe);' +
        'DROP TABLE temp.__astrotracker_fts5_probe;',
    );
    return true;
  } catch {
    return false;
  }
}
