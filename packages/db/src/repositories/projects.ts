import { eq } from 'drizzle-orm';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';

import { processingProjects, projectInputs } from '../schema/index.js';
import {
  createCrudRepository,
  insertStamp,
  type CrudRepository,
  type DrizzleDb,
  type NewRow,
} from './shared.js';

type ProjectInput = InferSelectModel<typeof projectInputs>;

export interface ProjectsRepository extends CrudRepository<typeof processingProjects> {
  /**
   * Add a polymorphic input (exactly one of `frameId`/`masterFrameId`,
   * enforced by the table CHECK constraint, not application discipline).
   */
  insertInput(values: NewRow<typeof projectInputs>): ProjectInput;
  listInputs(projectId: string): ProjectInput[];
}

export function createProjectsRepository(db: DrizzleDb): ProjectsRepository {
  const base = createCrudRepository(db, processingProjects);
  return {
    ...base,
    insertInput(values: NewRow<typeof projectInputs>): ProjectInput {
      const row: InferInsertModel<typeof projectInputs> = { ...values, ...insertStamp() };
      return db.insert(projectInputs).values(row).returning().get();
    },
    listInputs(projectId: string): ProjectInput[] {
      return db.select().from(projectInputs).where(eq(projectInputs.projectId, projectId)).all();
    },
  };
}
