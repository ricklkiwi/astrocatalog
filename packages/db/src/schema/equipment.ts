/**
 * Equipment domain (DD-003 `equipment_profiles`).
 */
import { sql } from 'drizzle-orm';
import {
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { baseColumns } from './columns.js';

/**
 * Distinct telescope+camera(+rotator/reducer) combos, auto-detected (P1-18).
 *
 * `matchKey` is the deterministic identity key `equipmentIdentity()` computes
 * from a frame's normalized telescope/camera/focal-length triple
 * (`@astrotracker/core`). It is nullable (pre-P1-18 rows and any row created
 * outside detection carry `null`) and unique only where non-null — a plain
 * `UNIQUE` over a nullable column is inert in SQLite (NULLs are distinct),
 * exactly the defect DD-003 records for `project_inputs` (ADR-004).
 *
 * `mergedIntoId` is set on a merged-away row when the user confirms a merge
 * suggestion; the row is kept (DD-003: v1 does not hard-delete catalog rows)
 * so its `matchKey` keeps resolving to the survivor on every future rescan.
 * Always points at a **live** row (merges flatten chains).
 */
export const equipmentProfiles = sqliteTable(
  'equipment_profiles',
  {
    ...baseColumns(),
    name: text('name').notNull(),
    telescope: text('telescope'),
    camera: text('camera'),
    focalLength: real('focal_length'),
    aperture: real('aperture'),
    pixelSize: real('pixel_size'),
    isUserConfirmed: integer('is_user_confirmed', { mode: 'boolean' }).notNull().default(false),
    matchKey: text('match_key'),
    mergedIntoId: text('merged_into_id').references((): AnySQLiteColumn => equipmentProfiles.id),
  },
  (t) => [
    uniqueIndex('equipment_profiles_match_key_uq')
      .on(t.matchKey)
      .where(sql`${t.matchKey} IS NOT NULL`),
  ],
);
