import { watchFolders } from '../schema/index.js';
import { createCrudRepository, type CrudRepository, type DrizzleDb } from './shared.js';

export type WatchFoldersRepository = CrudRepository<typeof watchFolders>;

export function createWatchFoldersRepository(db: DrizzleDb): WatchFoldersRepository {
  return createCrudRepository(db, watchFolders);
}
