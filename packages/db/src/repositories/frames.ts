import { and, eq, type SQL } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';

import { frames } from '../schema/index.js';
import { createCrudRepository, type CrudRepository, type DrizzleDb } from './shared.js';

type Frame = InferSelectModel<typeof frames>;

export interface FramesListFilter {
  targetId?: string;
  sessionId?: string;
  frameType?: Frame['frameType'];
}

export interface FramesRepository extends Omit<CrudRepository<typeof frames>, 'list'> {
  /** List frames, optionally filtered (DD-003 aggregation indexes cover these). */
  list(filter?: FramesListFilter): Frame[];
}

export function createFramesRepository(db: DrizzleDb): FramesRepository {
  const base = createCrudRepository(db, frames);
  return {
    ...base,
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
