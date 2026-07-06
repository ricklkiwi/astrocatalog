/**
 * Frame domain: normalized filters and parsed per-image metadata
 * (DD-003 `filters`, `frames`).
 */
import { sql } from 'drizzle-orm';
import { check, index, integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { baseColumns } from './columns.js';
import { equipmentProfiles } from './equipment.js';
import { files } from './files.js';
import { sessions } from './sessions.js';
import { targets } from './targets.js';

/** Normalized filters with canonical grouping ('L','R','G','B','Ha','OIII','SII','UVIR','none'…). */
export const filters = sqliteTable('filters', {
  ...baseColumns(),
  rawName: text('raw_name').notNull(),
  canonicalName: text('canonical_name'),
  bandType: text('band_type'),
});

/**
 * Parsed metadata, one row per image file. `headers_json` preserves the full
 * raw header dump so future keyword features never require rescanning disks
 * (DD-003). All quality columns are nullable.
 */
export const frames = sqliteTable(
  'frames',
  {
    ...baseColumns(),
    fileId: text('file_id')
      .notNull()
      .unique('frames_file_id_uq')
      .references(() => files.id),
    frameType: text('frame_type').notNull(),
    frameTypeSource: text('frame_type_source').notNull(),
    /** OBJECT header verbatim. */
    objectRaw: text('object_raw'),
    targetId: text('target_id').references(() => targets.id),
    filterRaw: text('filter_raw'),
    filterId: text('filter_id').references(() => filters.id),
    exposureSeconds: real('exposure_seconds'),
    dateObsUtc: integer('date_obs_utc', { mode: 'timestamp_ms' }),
    telescopeRaw: text('telescope_raw'),
    cameraRaw: text('camera_raw'),
    equipmentProfileId: text('equipment_profile_id').references(() => equipmentProfiles.id),
    ccdTemp: real('ccd_temp'),
    setTemp: real('set_temp'),
    gain: real('gain'),
    offset: real('offset'),
    binningX: integer('binning_x'),
    binningY: integer('binning_y'),
    widthPx: integer('width_px'),
    heightPx: integer('height_px'),
    raDeg: real('ra_deg'),
    decDeg: real('dec_deg'),
    focalLength: real('focal_length'),
    aperture: real('aperture'),
    pierSide: text('pier_side'),
    airmass: real('airmass'),
    observer: text('observer'),
    siteName: text('site_name'),
    bayerPattern: text('bayer_pattern'),
    /** Quality metrics (nullable until measured). */
    fwhm: real('fwhm'),
    hfr: real('hfr'),
    starCount: integer('star_count'),
    sessionId: text('session_id').references(() => sessions.id),
    /** Full raw header dump for forward-compat (DD-003 / DD-004). */
    headersJson: text('headers_json').notNull(),
  },
  (t) => [
    // DD-003 aggregation indexes: integration-time rollups are
    // SUM(exposure_seconds) GROUP BY target_id, filter_id over these.
    index('frames_target_filter_type_idx').on(t.targetId, t.filterId, t.frameType),
    index('frames_session_id_idx').on(t.sessionId),
    index('frames_date_obs_utc_idx').on(t.dateObsUtc),
    check(
      'frames_frame_type_check',
      sql`${t.frameType} IN ('light', 'dark', 'flat', 'bias', 'darkflat', 'unknown')`,
    ),
    check(
      'frames_frame_type_source_check',
      sql`${t.frameTypeSource} IN ('header', 'path_heuristic', 'manual')`,
    ),
  ],
);
