/**
 * Catalog domain: canonical astronomical targets and their aliases
 * (DD-003 `targets`, `target_aliases`).
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  real,
  sqliteTable,
  text,
  unique,
  type AnySQLiteColumn,
} from 'drizzle-orm/sqlite-core';

import { baseColumns } from './columns.js';
import { frames } from './frames.js';

/** Canonical astronomical targets. */
export const targets = sqliteTable(
  'targets',
  {
    ...baseColumns(),
    /** e.g. 'M 31'. */
    canonicalName: text('canonical_name').notNull(),
    /** User-editable, e.g. 'Andromeda Galaxy'. */
    displayName: text('display_name'),
    /** JSON array, e.g. '["M 31","NGC 224"]'. */
    catalogIdsJson: text('catalog_ids_json'),
    raDeg: real('ra_deg'),
    decDeg: real('dec_deg'),
    objectType: text('object_type'),
    constellation: text('constellation'),
    status: text('status'),
    notes: text('notes'),
    thumbnailFrameId: text('thumbnail_frame_id').references((): AnySQLiteColumn => frames.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    check(
      'targets_status_check',
      sql`${t.status} IN ('planning', 'capturing', 'ready', 'processed', 'complete')`,
    ),
  ],
);

/**
 * Normalized alias lookup rows. `ON DELETE CASCADE`: alias rows are catalog
 * metadata owned by their target — cascading here never touches `files` rows,
 * so DD-003's "rows removed only by explicit user action" is untouched.
 */
export const targetAliases = sqliteTable(
  'target_aliases',
  {
    ...baseColumns(),
    targetId: text('target_id')
      .notNull()
      .references(() => targets.id, { onDelete: 'cascade' }),
    aliasNormalized: text('alias_normalized').notNull(),
    source: text('source').notNull(),
  },
  (t) => [
    unique('target_aliases_target_alias_uq').on(t.targetId, t.aliasNormalized),
    index('target_aliases_alias_normalized_idx').on(t.aliasNormalized),
    check('target_aliases_source_check', sql`${t.source} IN ('builtin', 'user')`),
  ],
);
