import { eq } from 'drizzle-orm';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';

import { masterFrames, masterFrameSubs } from '../schema/index.js';
import {
  createCrudRepository,
  insertStamp,
  type CrudRepository,
  type DrizzleDb,
  type NewRow,
} from './shared.js';

type MasterFrameSub = InferSelectModel<typeof masterFrameSubs>;

export interface MasterFramesRepository extends CrudRepository<typeof masterFrames> {
  /** Link a raw sub to the master it built (DD-003 `master_frame_subs`). */
  insertSub(values: NewRow<typeof masterFrameSubs>): MasterFrameSub;
  listSubs(masterFrameId: string): MasterFrameSub[];
}

export function createMasterFramesRepository(db: DrizzleDb): MasterFramesRepository {
  const base = createCrudRepository(db, masterFrames);
  return {
    ...base,
    insertSub(values: NewRow<typeof masterFrameSubs>): MasterFrameSub {
      const row: InferInsertModel<typeof masterFrameSubs> = { ...values, ...insertStamp() };
      return db.insert(masterFrameSubs).values(row).returning().get();
    },
    listSubs(masterFrameId: string): MasterFrameSub[] {
      return db
        .select()
        .from(masterFrameSubs)
        .where(eq(masterFrameSubs.masterFrameId, masterFrameId))
        .all();
    },
  };
}
