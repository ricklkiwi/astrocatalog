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
  equipmentProfileId: text('equipment_profile_id').references(() => equipmentProfiles.id),
  notes: text('notes'),
  weatherNotes: text('weather_notes'),
});
