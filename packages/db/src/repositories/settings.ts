import { eq } from 'drizzle-orm';

import { settings } from '../schema/index.js';
import type { DrizzleDb } from './shared.js';

/**
 * Keyed helpers over the `settings` key-value table (natural TEXT PK —
 * documented DD-003 deviation; `updated_at` still stamped on every write).
 */
export interface SettingsRepository {
  /** JSON-parsed value, or `undefined` when the key is absent. */
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

export function createSettingsRepository(db: DrizzleDb): SettingsRepository {
  return {
    get(key: string): unknown {
      const row = db.select().from(settings).where(eq(settings.key, key)).get();
      return row === undefined ? undefined : JSON.parse(row.valueJson);
    },
    set(key: string, value: unknown): void {
      const now = new Date();
      const valueJson = JSON.stringify(value);
      db.insert(settings)
        .values({ key, valueJson, createdAt: now, updatedAt: now })
        .onConflictDoUpdate({
          target: settings.key,
          set: { valueJson, updatedAt: now },
        })
        .run();
    },
  };
}
