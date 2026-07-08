import { files } from '../schema/index.js';
import { createCrudRepository, type CrudRepository, type DrizzleDb } from './shared.js';

export type FilesRepository = CrudRepository<typeof files>;

export function createFilesRepository(db: DrizzleDb): FilesRepository {
  return createCrudRepository(db, files);
}
