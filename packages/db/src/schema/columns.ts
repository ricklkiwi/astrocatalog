/**
 * Shared column helpers guaranteeing the DD-003 shape on every table:
 * UUIDv7 TEXT primary key (app-generated at insert time) plus
 * `created_at`/`updated_at` audit timestamps.
 *
 * Timestamps are INTEGER Unix epoch milliseconds — UTC by construction
 * (DD-002 rule 4). Drizzle's `timestamp_ms` mode surfaces them as `Date`.
 * `updated_at` is stamped by the repository write-helpers
 * (`repositories/shared.ts`), not by SQL triggers (DD-003: single writer).
 */
import { integer, text } from 'drizzle-orm/sqlite-core';

/** UUIDv7 string primary key (DD-003: all PKs are UUIDv7 strings for Phase 2 sync). */
export const id = () => text('id').primaryKey();

/** UTC creation timestamp, INTEGER epoch-ms. */
export const createdAt = () => integer('created_at', { mode: 'timestamp_ms' }).notNull();

/** UTC last-write timestamp, INTEGER epoch-ms, re-stamped on every repository write. */
export const updatedAt = () => integer('updated_at', { mode: 'timestamp_ms' }).notNull();

/** The three columns every DD-003 table carries (exception: `settings`, natural key). */
export const baseColumns = () => ({
  id: id(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
