import { eq } from 'drizzle-orm';

import { watchFolders } from '../schema/index.js';
import { createCrudRepository, type CrudRepository, type DrizzleDb } from './shared.js';

export interface WatchFoldersRepository extends CrudRepository<typeof watchFolders> {
  /**
   * Hard-deletes the watch-folder metadata row (not a user image file — the
   * CLAUDE.md non-destructive guarantee covers files under the folder, not
   * this bookkeeping row itself). Returns whether a row was actually
   * removed.
   */
  remove(id: string): boolean;
}

export function createWatchFoldersRepository(db: DrizzleDb): WatchFoldersRepository {
  const base = createCrudRepository(db, watchFolders);

  return {
    ...base,
    remove(id: string): boolean {
      const result = db.delete(watchFolders).where(eq(watchFolders.id, id)).run();
      return result.changes > 0;
    },
  };
}
