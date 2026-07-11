/**
 * Infrastructure domain (DD-003 `scan_jobs`, `thumbnails`, `settings`).
 *
 * DD-003's `schema_migrations` table is realized as Drizzle's own
 * `__drizzle_migrations` bookkeeping table (driver-managed, exempt from the
 * UUIDv7/`updated_at` rule) — plan deviation 6; no hand-rolled twin exists.
 */
import { sql } from 'drizzle-orm';
import { check, index, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

import { baseColumns, createdAt, updatedAt } from './columns.js';
import { watchFolders } from './files.js';
import { frames } from './frames.js';

/**
 * Generic persisted job queue (P0-05), generalized onto the P0-04 `scan_jobs`
 * table rather than a new table (plan Default 1) — scan-specific columns
 * (`files_seen`/`files_added`/`files_updated`) sit alongside generic queue
 * columns so P1-06's real scan jobs populate both. `job_type` is unconstrained
 * `TEXT` (plan Default 2) — the `JobType` union lives in `packages/desktop`,
 * only `status` gets a DB-level CHECK because that lifecycle is closed.
 * `watch_folder_id` is nullable: the `'demo'` job type has no watch folder.
 */
export const scanJobs = sqliteTable(
  'scan_jobs',
  {
    ...baseColumns(),
    watchFolderId: text('watch_folder_id').references(() => watchFolders.id),
    /** Free-form job-type discriminator (plan Default 2); `packages/db` doesn't know the union. */
    jobType: text('job_type').notNull(),
    status: text('status').notNull().default('queued'),
    filesSeen: integer('files_seen').notNull().default(0),
    filesAdded: integer('files_added').notNull().default(0),
    filesUpdated: integer('files_updated').notNull().default(0),
    /** Arbitrary job-shaped payload (e.g. demo job's totalSteps/stepMs/resumeFrom), JSON text. */
    payloadJson: text('payload_json'),
    progressCurrent: integer('progress_current').notNull().default(0),
    /** Null = indeterminate progress (no known total yet). */
    progressTotal: integer('progress_total'),
    progressMessage: text('progress_message'),
    priority: integer('priority').notNull().default(0),
    /** Owning worker while `status='running'`; cleared on every terminal transition. */
    workerId: text('worker_id'),
    claimedAt: integer('claimed_at', { mode: 'timestamp_ms' }),
    /** Cooperative-cancel flag; must survive `requeueOrphaned()` (plan Edge Cases). */
    cancelRequested: integer('cancel_requested', { mode: 'boolean' }).notNull().default(false),
    startedAt: integer('started_at', { mode: 'timestamp_ms' }),
    finishedAt: integer('finished_at', { mode: 'timestamp_ms' }),
    error: text('error'),
  },
  (t) => [
    check(
      'scan_jobs_status_check',
      sql`${t.status} IN ('queued', 'running', 'completed', 'failed', 'cancelled')`,
    ),
    index('scan_jobs_status_priority_created_at_idx').on(t.status, t.priority, t.createdAt),
  ],
);

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
