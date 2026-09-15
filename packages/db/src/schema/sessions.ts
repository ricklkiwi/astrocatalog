/**
 * Imaging-night domain (DD-003 `sessions`).
 */
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { baseColumns } from './columns.js';
import { equipmentProfiles } from './equipment.js';

/** Detected imaging nights. */
export const sessions = sqliteTable('sessions', {
  ...baseColumns(),
  /**
   * Local astronomical date label, `YYYY-MM-DD` TEXT (noon-to-noon).
   * Documented exception to the epoch-ms rule: this is a date *label* per
   * DD-002 rule 4 / DD-006, not a timestamp — no UTC claim applies.
   */
  sessionDate: text('session_date').notNull(),
  startedAtUtc: integer('started_at_utc', { mode: 'timestamp_ms' }),
  endedAtUtc: integer('ended_at_utc', { mode: 'timestamp_ms' }),
  /**
   * IANA timezone used for this session's astronomical-day grouping,
   * captured at detection time (DD-003 "Timezone source"): historical
   * grouping stays stable even if `watch_folders.timezone` changes later
   * (P1-17).
   */
  timezone: text('timezone'),
  /**
   * Provenance of `timezone` — app-enforced `'watch_folder' | 'system_fallback'`
   * (P1-17). Deliberately no CHECK constraint (Out of Scope): mirrors the
   * existing `scan_jobs.job_type` precedent for a non-closed-lifecycle field,
   * keeping this migration a plain `ALTER TABLE ADD`.
   */
  timezoneSource: text('timezone_source'),
  equipmentProfileId: text('equipment_profile_id').references(() => equipmentProfiles.id),
  notes: text('notes'),
  weatherNotes: text('weather_notes'),
});
