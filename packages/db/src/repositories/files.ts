import { and, asc, eq, inArray, isNotNull, isNull, lt, ne } from 'drizzle-orm';
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

export interface DuplicateGroupResult {
  /** This file's row after the update (status/duplicateOfId reflect the resolved group). */
  file: FileRecord;
  /** The group's canonical file id — equals `file.id` itself when this file IS the canonical one. */
  canonicalId: string;
}

export interface MoveCandidate {
  fileId: string;
  watchFolderId: string;
  relativePath: string;
  sizeBytes: number;
  sha256: string;
}

export interface ReparentMovedInput {
  watchFolderId: string;
  relativePath: string;
  filename: string;
  extension: string;
  sizeBytes: number;
  fileMtime: Date | null;
  sha256: string;
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
  /**
   * DD-004 Stage 5a: record `sha256` on `fileId`, then resolve the duplicate
   * group sharing that hash. Idempotent and order-independent — the background
   * hash job may process files in any order, and a file's hash can be cleared
   * (on a content change, see `upsertDiscovered`) then re-hashed later.
   *
   * The live group is `fileId` plus every OTHER row with the same `sha256`
   * whose `status IN ('present', 'duplicate')` (`'missing'` rows belong to
   * move detection, never a live duplicate group). The canonical row is the
   * one with the earliest `firstSeenAt` (tie-break: `id` ascending — UUIDv7
   * ids are lexicographically time-ordered). The canonical row is re-set to
   * `status='present'`, `duplicateOfId=null`; every non-canonical group member
   * becomes `status='duplicate'`, `duplicateOfId=<canonical id>`. With no
   * other match the row is promoted back to `'present'`/`null`. Runs as one
   * transaction (multi-row read-then-write).
   */
  recordHash(fileId: string, sha256: string): DuplicateGroupResult;
  /**
   * Up to `limit` `status='present'` rows still missing a hash, oldest
   * `firstSeenAt` first (oldest-discovered files hash first — this also biases
   * canonical selection toward older files, per `recordHash`).
   */
  listUnhashed(limit: number): FileRecord[];
  /**
   * Every `status='missing'` row that already has a `sha256`, as
   * {@link MoveCandidate}s. DD-004: hashing is lazy, so a `'missing'` row
   * without a hash can't be content-verified as a move source — these are the
   * only rows move detection can match against.
   */
  listMissingWithHash(): MoveCandidate[];
  /**
   * DD-004 move detection: re-path the EXISTING row `missingFileId` to the new
   * location/stat facts in `input`, **in place** (same `id`), preserving every
   * `frames`/`sessions`/`processing_projects` FK that references `files.id`.
   * Sets the location/stat columns, `sha256` (already confirmed by the
   * content-hash match), `status='present'`, `lastSeenAt=seenAt`,
   * `duplicateOfId=null`. Guarded by `WHERE id = missingFileId AND
   * status = 'missing'`: if no row matched (concurrently claimed, or status
   * changed) returns `undefined` so the caller falls back to a normal insert.
   */
  reparentMoved(
    missingFileId: string,
    input: ReparentMovedInput,
    seenAt: Date,
  ): FileRecord | undefined;
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

    recordHash(fileId: string, sha256: string): DuplicateGroupResult {
      return db.transaction((tx) => {
        const now = new Date();
        // 1. Record the hash on the target row.
        const target = tx
          .update(files)
          .set({ sha256, updatedAt: now })
          .where(eq(files.id, fileId))
          .returning()
          .get();
        if (target === undefined) {
          throw new Error(`recordHash: no file row with id ${fileId}`);
        }

        // 2. Find the other live members of this hash group.
        const others = tx
          .select()
          .from(files)
          .where(
            and(
              eq(files.sha256, sha256),
              ne(files.id, fileId),
              inArray(files.status, ['present', 'duplicate']),
            ),
          )
          .all();

        // 3a. No other member: promote this row back to a plain present file.
        if (others.length === 0) {
          const promoted = tx
            .update(files)
            .set({ status: 'present', duplicateOfId: null, updatedAt: now })
            .where(eq(files.id, fileId))
            .returning()
            .get();
          return { file: promoted ?? target, canonicalId: fileId };
        }

        // 3b. Re-canonicalize the whole group on every call (order-independent):
        // earliest firstSeenAt wins, id ascending is the deterministic tie-break.
        const group = [target, ...others];
        const canonical = group.reduce((best, row) => {
          const bestTime = best.firstSeenAt.getTime();
          const rowTime = row.firstSeenAt.getTime();
          if (rowTime < bestTime) {
            return row;
          }
          if (rowTime > bestTime) {
            return best;
          }
          return row.id < best.id ? row : best;
        });
        const canonicalId = canonical.id;

        let resolvedTarget = target;
        for (const row of group) {
          const isCanonical = row.id === canonicalId;
          const updated = tx
            .update(files)
            .set({
              status: isCanonical ? 'present' : 'duplicate',
              duplicateOfId: isCanonical ? null : canonicalId,
              updatedAt: now,
            })
            .where(eq(files.id, row.id))
            .returning()
            .get();
          if (row.id === fileId && updated !== undefined) {
            resolvedTarget = updated;
          }
        }
        return { file: resolvedTarget, canonicalId };
      });
    },

    listUnhashed(limit: number): FileRecord[] {
      return db
        .select()
        .from(files)
        .where(and(eq(files.status, 'present'), isNull(files.sha256)))
        .orderBy(asc(files.firstSeenAt))
        .limit(limit)
        .all();
    },

    listMissingWithHash(): MoveCandidate[] {
      return db
        .select()
        .from(files)
        .where(and(eq(files.status, 'missing'), isNotNull(files.sha256)))
        .all()
        .map((row): MoveCandidate => {
          const { sha256 } = row;
          if (sha256 === null) {
            // Unreachable: the isNotNull filter above excludes null hashes.
            throw new Error(`listMissingWithHash: file ${row.id} unexpectedly has no sha256`);
          }
          return {
            fileId: row.id,
            watchFolderId: row.watchFolderId,
            relativePath: row.relativePath,
            sizeBytes: row.sizeBytes,
            sha256,
          };
        });
    },

    reparentMoved(
      missingFileId: string,
      input: ReparentMovedInput,
      seenAt: Date,
    ): FileRecord | undefined {
      return db
        .update(files)
        .set({
          watchFolderId: input.watchFolderId,
          relativePath: input.relativePath,
          filename: input.filename,
          extension: input.extension,
          sizeBytes: input.sizeBytes,
          fileMtime: input.fileMtime,
          sha256: input.sha256,
          status: 'present',
          lastSeenAt: seenAt,
          duplicateOfId: null,
          updatedAt: new Date(),
        })
        .where(and(eq(files.id, missingFileId), eq(files.status, 'missing')))
        .returning()
        .get();
    },
  };
}
