import { scanJobs } from '../schema/index.js';
import { createCrudRepository, type CrudRepository, type DrizzleDb } from './shared.js';

/**
 * Scan-job bookkeeping rows only — claim/resume/retry semantics are P0-05.
 */
export type ScanJobsRepository = CrudRepository<typeof scanJobs>;

export function createScanJobsRepository(db: DrizzleDb): ScanJobsRepository {
  return createCrudRepository(db, scanJobs);
}
