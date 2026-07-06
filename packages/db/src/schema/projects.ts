/**
 * Processing-workflow domain (DD-003 `processing_projects`, `project_inputs`,
 * `processed_images`).
 */
import { sql } from 'drizzle-orm';
import { check, integer, sqliteTable, text, unique } from 'drizzle-orm/sqlite-core';

import { baseColumns } from './columns.js';
import { masterFrames } from './calibration.js';
import { files } from './files.js';
import { frames } from './frames.js';
import { targets } from './targets.js';

/** A processing run against a target (e.g. one PixInsight project/version). */
export const processingProjects = sqliteTable('processing_projects', {
  ...baseColumns(),
  targetId: text('target_id').references(() => targets.id),
  name: text('name').notNull(),
  versionLabel: text('version_label'),
  status: text('status'),
  software: text('software'),
  notes: text('notes'),
});

/**
 * Polymorphic project input: exactly one of `frame_id`/`master_frame_id` is
 * set, discriminated by `input_type` — enforced by CHECK, not application
 * discipline. Surrogate UUIDv7 PK + UNIQUE natural key (plan deviation 7).
 */
export const projectInputs = sqliteTable(
  'project_inputs',
  {
    ...baseColumns(),
    projectId: text('project_id')
      .notNull()
      .references(() => processingProjects.id),
    inputType: text('input_type').notNull(),
    frameId: text('frame_id').references(() => frames.id),
    masterFrameId: text('master_frame_id').references(() => masterFrames.id),
  },
  (t) => [
    unique('project_inputs_natural_uq').on(t.projectId, t.frameId, t.masterFrameId),
    check(
      'project_inputs_exactly_one_check',
      sql`(${t.inputType} = 'frame' AND ${t.frameId} IS NOT NULL AND ${t.masterFrameId} IS NULL) OR (${t.inputType} = 'master_frame' AND ${t.masterFrameId} IS NOT NULL AND ${t.frameId} IS NULL)`,
    ),
    check(
      'project_inputs_input_type_check',
      sql`${t.inputType} IN ('frame', 'master_frame')`,
    ),
  ],
);

/** Output images produced by a processing project. */
export const processedImages = sqliteTable('processed_images', {
  ...baseColumns(),
  projectId: text('project_id')
    .notNull()
    .references(() => processingProjects.id),
  fileId: text('file_id').references(() => files.id),
  format: text('format'),
  isFinal: integer('is_final', { mode: 'boolean' }).notNull().default(false),
  publishedUrl: text('published_url'),
});
