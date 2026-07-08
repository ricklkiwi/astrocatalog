/**
 * Equipment domain (DD-003 `equipment_profiles`).
 */
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { baseColumns } from './columns.js';

/** Distinct telescope+camera(+rotator/reducer) combos, auto-detected. */
export const equipmentProfiles = sqliteTable('equipment_profiles', {
  ...baseColumns(),
  name: text('name').notNull(),
  telescope: text('telescope'),
  camera: text('camera'),
  focalLength: real('focal_length'),
  aperture: real('aperture'),
  pixelSize: real('pixel_size'),
  isUserConfirmed: integer('is_user_confirmed', { mode: 'boolean' }).notNull().default(false),
});
