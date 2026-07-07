/**
 * Shared typed CRUD helpers for the repository skeleton. Every write goes
 * through here so the DD-003 hard rules hold mechanically:
 *   - `insert` stamps a UUIDv7 `id` (via `@astrotracker/core`) plus
 *     `created_at`/`updated_at` now-UTC,
 *   - `update` re-stamps `updated_at` on every write and never touches
 *     columns the caller didn't pass.
 *
 * Richer domain queries (aggregations, session grouping, calibration
 * matching) are deliberately NOT built here — later issues extend the
 * per-aggregate repositories.
 */
import { uuidv7 } from '@astrotracker/core';
import { eq } from 'drizzle-orm';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';

/** Internal drizzle handle type; never exposed on the public API surface. */
export type DrizzleDb = BetterSQLite3Database;

/** Shape every DD-003 table shares (UUIDv7 PK + audit timestamps). */
type BaseTable = SQLiteTable & {
  id: SQLiteColumn;
  createdAt: SQLiteColumn;
  updatedAt: SQLiteColumn;
};

/**
 * Caller-facing insert payload: the repo stamps `id`/`createdAt`/`updatedAt`.
 * Built on `$inferInsert` rather than `InferInsertModel<TTable>`: `Omit`
 * over the latter inside a generic alias collapses optional (nullable /
 * defaulted) columns to the constraint's keys, silently rejecting them.
 */
export type NewRow<TTable extends SQLiteTable> = Omit<
  TTable['$inferInsert'],
  'id' | 'createdAt' | 'updatedAt'
>;

/** Caller-facing update payload: partial, audit columns never settable. */
export type RowPatch<TTable extends SQLiteTable> = Partial<NewRow<TTable>>;

export interface CrudRepository<TTable extends BaseTable> {
  /** Insert one row, stamping `id` (UUIDv7) and both audit timestamps. */
  insert(values: NewRow<TTable>): InferSelectModel<TTable>;
  getById(id: string): InferSelectModel<TTable> | undefined;
  list(): InferSelectModel<TTable>[];
  /** Patch one row, re-stamping `updated_at`; returns the updated row. */
  update(id: string, patch: RowPatch<TTable>): InferSelectModel<TTable> | undefined;
}

/** Audit-column stamp for inserts. */
export function insertStamp(): { id: string; createdAt: Date; updatedAt: Date } {
  const now = new Date();
  return { id: uuidv7(), createdAt: now, updatedAt: now };
}

export function createCrudRepository<TTable extends BaseTable>(
  db: DrizzleDb,
  table: TTable,
): CrudRepository<TTable> {
  type Row = InferSelectModel<TTable>;
  return {
    insert(values: NewRow<TTable>): Row {
      const row = { ...values, ...insertStamp() };
      return db
        .insert(table)
        .values(row as InferInsertModel<TTable>)
        .returning()
        .get() as Row;
    },
    getById(id: string): Row | undefined {
      return db.select().from(table).where(eq(table.id, id)).get() as Row | undefined;
    },
    list(): Row[] {
      return db.select().from(table).all() as Row[];
    },
    update(id: string, patch: RowPatch<TTable>): Row | undefined {
      const stamped = { ...patch, updatedAt: new Date() };
      return db.update(table).set(stamped).where(eq(table.id, id)).returning().get() as
        Row | undefined;
    },
  };
}
