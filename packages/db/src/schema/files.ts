/**
 * Physical-storage domain: watch folder roots and the files discovered
 * under them (DD-003 `watch_folders`, `files`).
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  unique,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { baseColumns } from './columns.js';

/** Physical storage roots the user watches. */
export const watchFolders = sqliteTable(
  'watch_folders',
  {
    ...baseColumns(),
    path: text('path').notNull(),
    driveLabel: text('drive_label'),
    isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
    lastScanAt: integer('last_scan_at', { mode: 'timestamp_ms' }),
    /**
     * JSON-stringified `string[]` of additional basename skip patterns
     * (beyond the always-skipped hidden/dot-prefixed entries and the baked-in
     * `node_modules`). `null` = use built-in defaults only (P1-06, DD-004).
     */
    skipPatterns: text('skip_patterns'),
  },
  (t) => [unique('watch_folders_path_uq').on(t.path)],
);

/**
 * One row per physical file discovered. DD-003: files on disconnected drives
 * are marked `missing`, never auto-deleted; `duplicate_of_id` points at the
 * canonical file and is SET NULL (never cascade) if that row is deleted.
 */
export const files = sqliteTable(
  'files',
  {
    ...baseColumns(),
    watchFolderId: text('watch_folder_id')
      .notNull()
      .references(() => watchFolders.id),
    relativePath: text('relative_path').notNull(),
    filename: text('filename').notNull(),
    extension: text('extension').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    /** Nullable until hashed — DD-003 lazy hashing. */
    sha256: text('sha256'),
    fileMtime: integer('file_mtime', { mode: 'timestamp_ms' }),
    firstSeenAt: integer('first_seen_at', { mode: 'timestamp_ms' }).notNull(),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
    status: text('status').notNull(),
    duplicateOfId: text('duplicate_of_id').references((): AnySQLiteColumn => files.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    unique('files_watch_folder_relative_path_uq').on(t.watchFolderId, t.relativePath),
    index('files_sha256_idx').on(t.sha256),
    check('files_status_check', sql`${t.status} IN ('present', 'missing', 'duplicate')`),
  ],
);
