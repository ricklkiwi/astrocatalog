/**
 * Calibration domain: master frames and their provenance
 * (DD-003 `master_frames`, `master_frame_subs`).
 */
import { sql } from 'drizzle-orm';
import { check, integer, real, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

import { baseColumns } from './columns.js';
import { equipmentProfiles } from './equipment.js';
import { files } from './files.js';
import { filters, frames } from './frames.js';

/** Calibration masters and their capture parameters. */
export const masterFrames = sqliteTable(
  'master_frames',
  {
    ...baseColumns(),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id),
    masterType: text('master_type').notNull(),
    cameraRaw: text('camera_raw'),
    equipmentProfileId: text('equipment_profile_id').references(() => equipmentProfiles.id),
    filterId: text('filter_id').references(() => filters.id),
    exposureSeconds: real('exposure_seconds'),
    ccdTemp: real('ccd_temp'),
    gain: real('gain'),
    offset: real('offset'),
    binningX: integer('binning_x'),
    binningY: integer('binning_y'),
    /** When the master was created (epoch-ms UTC). */
    createdDate: integer('created_date', { mode: 'timestamp_ms' }),
    subCount: integer('sub_count'),
    notes: text('notes'),
  },
  (t) => [
    check(
      'master_frames_master_type_check',
      sql`${t.masterType} IN ('dark', 'flat', 'bias', 'darkflat')`,
    ),
  ],
);

/**
 * Which raw subs built the master. Junction table with a surrogate UUIDv7 PK
 * plus a UNIQUE natural key (plan deviation 7, flagged for review).
 */
export const masterFrameSubs = sqliteTable(
  'master_frame_subs',
  {
    ...baseColumns(),
    masterFrameId: text('master_frame_id')
      .notNull()
      .references(() => masterFrames.id),
    frameId: text('frame_id')
      .notNull()
      .references(() => frames.id),
  },
  (t) => [unique('master_frame_subs_master_frame_uq').on(t.masterFrameId, t.frameId)],
);
