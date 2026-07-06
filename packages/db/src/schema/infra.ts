/**
 * Infrastructure domain (DD-003 `scan_jobs`, `thumbnails`, `settings`).
 *
 * DD-003's `schema_migrations` table is realized as Drizzle's own
 * `__drizzle_migrations` bookkeeping table (driver-managed, exempt from the
 * UUIDv7/`updated_at` rule) — plan deviation 6; no hand-rolled twin exists.
 */
import { integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

import { baseColumns, createdAt, updatedAt } from './columns.js';
import { watchFolders } from './files.js';
import { frames } from './frames.js';

/** Scan-job bookkeeping. Claim/resume semantics land in P0-05; only the table exists here. */
export const scanJobs = sqliteTable('scan_jobs', {
  ...baseColumns(),
  watchFolderId: text('watch_folder_id')
    .notNull()
    .references(() => watchFolders.id),
  status: text('status').notNull(),
  filesSeen: integer('files_seen').notNull().default(0),
  filesAdded: integer('files_added').notNull().default(0),
  filesUpdated: integer('files_updated').notNull().default(0),
  startedAt: integer('started_at', { mode: 'timestamp_ms' }),
  finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
  error: text('error'),
});

/**
 * Thumbnail cache pointers (never image data — DD-003). Surrogate UUIDv7 PK
 * plus UNIQUE natural key `frame_id` (plan deviation 7).
 */
export const thumbnails = sqliteTable(
  'thumbnails',
  {
    ...baseColumns(),
    frameId: text('frame_id')
      .notNull()
      .references(() => frames.id),
    cachePath: text('cache_path').notNull(),
    generatedAt: integer('generated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [unique('thumbnails_frame_id_uq').on(t.frameId)],
);

/**
 * Key-value settings. Documented deviation 5: keeps its natural
 * `key TEXT PRIMARY KEY` (a UUIDv7 surrogate adds nothing to a key-value
 * table that never syncs by row identity) but still carries `updated_at`.
 */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
