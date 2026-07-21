import { and, eq, lt } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';

import { files } from '../schema/index.js';
import {
  createCrudRepository,
  insertStamp,
  type CrudRepository,
  type DrizzleDb,
} from './shared.js';

export type FileRecord = InferSelectModel<typeof files>;

/** Caller-facing payload for `upsertDiscovered` — one row per walked file (DD-004 Stage 1). */
export interface UpsertDiscoveredInput {
  watchFolderId: string;
  relativePath: string;
  filename: string;
  extension: string;
  sizeBytes: number;
  fileMtime: Date | null;
}

export interface UpsertDiscoveredResult {
  file: FileRecord;
  isNew: boolean;
  /** True if this call caused a status/size/mtime change worth downstream reparse (P1-07 will consume this). */
  changed: boolean;
  /** True if the row existed with status='missing' and this call restored it to 'present'. */
  wasRestored: boolean;
}

/**
 * DD-004 Stage 1 (discovery) + missing-detection primitives on top of the
 * base CRUD skeleton (P0-05).
 */
export interface FilesRepository extends CrudRepository<typeof files> {
  /**
   * Look up by the `(watchFolderId, relativePath)` unique index and either
   * insert a fresh row or reconcile an existing one against what the walker
   * just observed on disk. Never deletes/re-parents a row — DD-004 move
   * detection and DD-004/CLAUDE.md's non-destructive guarantee are owned by
   * later stages (P1-08), not this call.
   *
   * `status='duplicate'` rows are left alone here (size/mtime still
   * refreshed if changed) — flipping a duplicate back to `'present'` is
   * P1-08's job, not a plain rescan's.
   */
  upsertDiscovered(input: UpsertDiscoveredInput, seenAt: Date): UpsertDiscoveredResult;
  /**
   * Marks every `'present'` row under `watchFolderId` whose `lastSeenAt` is
   * older than `cutoff` as `'missing'` (drive disconnected, file deleted
   * out-of-band). Never deletes rows. Returns the updated rows.
   */
  markMissingNotSeenSince(watchFolderId: string, cutoff: Date): FileRecord[];
  /** Every file row under `watchFolderId` (used to build the P1-07 incremental-skip snapshot). */
  listByWatchFolder(watchFolderId: string): FileRecord[];
  /**
   * Record a Stage-2 parse error on a file row, or clear it (pass `null`) on a
   * successful (re-)parse — DD-004 "Parse errors recorded on the file row"
   * (P1-07). Re-stamps `updated_at`. Returns the updated row, or `undefined`
   * if no row has that id.
   */
  recordParseError(fileId: string, error: string | null): FileRecord | undefined;
}

export function createFilesRepository(db: DrizzleDb): FilesRepository {
  const base = createCrudRepository(db, files);

  return {
    ...base,

    upsertDiscovered(input: UpsertDiscoveredInput, seenAt: Date): UpsertDiscoveredResult {
      const existing = db
        .select()
        .from(files)
        .where(
          and(
            eq(files.watchFolderId, input.watchFolderId),
            eq(files.relativePath, input.relativePath),
          ),
        )
        .get();

      if (existing === undefined) {
        const row = {
          ...insertStamp(),
          watchFolderId: input.watchFolderId,
          relativePath: input.relativePath,
          filename: input.filename,
          extension: input.extension,
          sizeBytes: input.sizeBytes,
          sha256: null,
          fileMtime: input.fileMtime,
          firstSeenAt: seenAt,
          lastSeenAt: seenAt,
          status: 'present' as const,
          duplicateOfId: null,
          parseError: null,
        };
        const inserted = db.insert(files).values(row).returning().get();
        return { file: inserted, isNew: true, changed: true, wasRestored: false };
      }

      const sizeOrMtimeChanged =
        existing.sizeBytes !== input.sizeBytes ||
        (existing.fileMtime?.getTime() ?? null) !== (input.fileMtime?.getTime() ?? null);
      const wasRestored = existing.status === 'missing';

      if (existing.status === 'duplicate') {
        // P1-08 owns duplicate resolution — never auto-restore status here,
        // but still keep size/mtime honest if the on-disk file changed.
        const patch: Partial<InferSelectModel<typeof files>> = {
          lastSeenAt: seenAt,
          updatedAt: new Date(),
        };
        if (sizeOrMtimeChanged) {
          patch.sizeBytes = input.sizeBytes;
          patch.fileMtime = input.fileMtime;
          patch.sha256 = null;
        }
        const updated = db
          .update(files)
          .set(patch)
          .where(eq(files.id, existing.id))
          .returning()
          .get();
        return {
          file: updated ?? existing,
          isNew: false,
          changed: sizeOrMtimeChanged,
          wasRestored: false,
        };
      }

      const changed = sizeOrMtimeChanged || wasRestored;
      const patch: Partial<InferSelectModel<typeof files>> = {
        lastSeenAt: seenAt,
        updatedAt: new Date(),
      };
      if (changed) {
        patch.sizeBytes = input.sizeBytes;
        patch.fileMtime = input.fileMtime;
        patch.status = 'present';
        if (sizeOrMtimeChanged) {
          patch.sha256 = null;
        }
      }
      const updated = db
        .update(files)
        .set(patch)
        .where(eq(files.id, existing.id))
        .returning()
        .get();
      return { file: updated ?? existing, isNew: false, changed, wasRestored };
    },

    markMissingNotSeenSince(watchFolderId: string, cutoff: Date): FileRecord[] {
      return db
        .update(files)
        .set({ status: 'missing', updatedAt: new Date() })
        .where(
          and(
            eq(files.watchFolderId, watchFolderId),
            eq(files.status, 'present'),
            lt(files.lastSeenAt, cutoff),
          ),
        )
        .returning()
        .all();
    },

    listByWatchFolder(watchFolderId: string): FileRecord[] {
      return db.select().from(files).where(eq(files.watchFolderId, watchFolderId)).all();
    },

    recordParseError(fileId: string, error: string | null): FileRecord | undefined {
      return db
        .update(files)
        .set({ parseError: error, updatedAt: new Date() })
        .where(eq(files.id, fileId))
        .returning()
        .get();
    },
  };
}
