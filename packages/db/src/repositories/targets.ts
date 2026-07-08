import { eq } from 'drizzle-orm';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';

import { targetAliases, targets } from '../schema/index.js';
import {
  createCrudRepository,
  insertStamp,
  type CrudRepository,
  type DrizzleDb,
  type NewRow,
} from './shared.js';

type TargetAlias = InferSelectModel<typeof targetAliases>;

export interface TargetsRepository extends CrudRepository<typeof targets> {
  /** Aliases belong to the target aggregate (DD-003 `target_aliases`). */
  insertAlias(values: NewRow<typeof targetAliases>): TargetAlias;
  listAliases(targetId: string): TargetAlias[];
}

export function createTargetsRepository(db: DrizzleDb): TargetsRepository {
  const base = createCrudRepository(db, targets);
  return {
    ...base,
    insertAlias(values: NewRow<typeof targetAliases>): TargetAlias {
      const row: InferInsertModel<typeof targetAliases> = { ...values, ...insertStamp() };
      return db.insert(targetAliases).values(row).returning().get();
    },
    listAliases(targetId: string): TargetAlias[] {
      return db.select().from(targetAliases).where(eq(targetAliases.targetId, targetId)).all();
    },
  };
}
