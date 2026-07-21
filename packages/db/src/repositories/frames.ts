import { and, eq, type SQL } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';

import { frames } from '../schema/index.js';
import {
  createCrudRepository,
  type CrudRepository,
  type DrizzleDb,
  type NewRow,
} from './shared.js';

type Frame = InferSelectModel<typeof frames>;

export interface FramesListFilter {
  targetId?: string;
  sessionId?: string;
  frameType?: Frame['frameType'];
}

export interface FramesRepository extends Omit<CrudRepository<typeof frames>, 'list'> {
  /** List frames, optionally filtered (DD-003 aggregation indexes cover these). */
  list(filter?: FramesListFilter): Frame[];
  /**
   * Insert-or-update the single `frames` row for a file (DD-004 Stages 2–3,
   * P1-07). `frames.file_id` is UNIQUE, so re-parsing a changed file updates
   * that row **in place** (same `id`, no duplicate) rather than inserting a
   * second one — this is what keeps a rescan idempotent on row counts.
   *
   * On update, only the columns present in `input` are written (parse-derived
   * fields); columns owned by later stages / the user — `targetId`,
   * `filterId`, `sessionId`, `equipmentProfileId`, the quality metrics — are
   * left untouched. A `frame_type_source = 'manual'` override is preserved:
   * a rescan never overwrites a user's manual frame-type decision (DD-004:
   * "manual overrides always win and survive rescans").
   */
  upsertByFileId(input: NewRow<typeof frames>): Frame;
}

export function createFramesRepository(db: DrizzleDb): FramesRepository {
  const base = createCrudRepository(db, frames);
  return {
    ...base,

    upsertByFileId(input: NewRow<typeof frames>): Frame {
      const existing = db.select().from(frames).where(eq(frames.fileId, input.fileId)).get();
      if (existing === undefined) {
        return base.insert(input);
      }
      // Preserve a manual frame-type override across re-parse (DD-004).
      const preserveType = existing.frameTypeSource === 'manual';
      const patch = {
        ...input,
        ...(preserveType
          ? { frameType: existing.frameType, frameTypeSource: existing.frameTypeSource }
          : {}),
        updatedAt: new Date(),
      };
      const updated = db
        .update(frames)
        .set(patch)
        .where(eq(frames.id, existing.id))
        .returning()
        .get();
      return updated ?? existing;
    },

    list(filter?: FramesListFilter): Frame[] {
      const conditions: SQL[] = [];
      if (filter?.targetId !== undefined) {
        conditions.push(eq(frames.targetId, filter.targetId));
      }
      if (filter?.sessionId !== undefined) {
        conditions.push(eq(frames.sessionId, filter.sessionId));
      }
      if (filter?.frameType !== undefined) {
        conditions.push(eq(frames.frameType, filter.frameType));
      }
      if (conditions.length === 0) {
        return db.select().from(frames).all();
      }
      return db
        .select()
        .from(frames)
        .where(and(...conditions))
        .all();
    },
  };
}
