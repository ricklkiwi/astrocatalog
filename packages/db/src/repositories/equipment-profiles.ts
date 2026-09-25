/**
 * `EquipmentProfilesRepository` (P1-18, DD-003 `equipment_profiles`, DD-006
 * equipment split rule). Extends the bare CRUD skeleton with the domain
 * operations that make a detected profile stable across rescans: idempotent
 * detection, match-key resolution (following a merge's `merged_into_id`),
 * usage rollups, and user confirm/rename/merge.
 *
 * Detection and merge suggestion are pure `@astrotracker/core` functions;
 * this module is the only place that touches SQL for them (DD-002 rule 1).
 */
import {
  detectEquipmentProfiles,
  suggestProfileMerges,
  type EquipmentIdentityInput,
  type EquipmentProfileForSuggestion,
  type MergeSuggestion,
} from '@astrotracker/core';
import { eq, inArray, sql } from 'drizzle-orm';
import type { InferSelectModel } from 'drizzle-orm';

import { equipmentProfiles, frames, masterFrames, sessions } from '../schema/index.js';
import {
  createCrudRepository,
  type CrudRepository,
  type DrizzleDb,
  type NewRow,
} from './shared.js';

type EquipmentProfileRow = InferSelectModel<typeof equipmentProfiles>;

export interface DetectFromFramesResult {
  inserted: number;
  existing: number;
}

/** Σ light-frame exposure for one profile, in both units (no float drift on render). */
export interface EquipmentProfileUsage {
  lightExposureSeconds: number;
  usageHours: number;
}

export interface EquipmentProfileWithUsage extends EquipmentProfileRow, EquipmentProfileUsage {
  lightFrameCount: number;
}

export interface EquipmentProfilesRepository extends CrudRepository<typeof equipmentProfiles> {
  /**
   * Reads the `SELECT DISTINCT telescope_raw, camera_raw, focal_length`
   * triples off `frames` (cheap — tens of rows, not per-frame), runs
   * `detectEquipmentProfiles()`, and inserts a row for each `matchKey` with
   * no existing row yet. Idempotent: re-running over the same frames
   * inserts nothing on the second pass. Never writes `frames` — assigning
   * `frames.equipment_profile_id` is P1-18a.
   */
  detectFromFrames(): DetectFromFramesResult;
  /**
   * Resolves each key to its **live** profile id, following a merge's
   * `merged_into_id` (one hop — merges flatten chains). Keys with no
   * matching row are simply absent from the returned map (never mapped to
   * `null`).
   */
  resolveMatchKeys(keys: string[]): Map<string, string>;
  /** Live (not merged) profiles with their light-frame usage, one aggregate query. */
  listLive(): EquipmentProfileWithUsage[];
  /** Same usage figure as `listLive()`, for one profile. */
  usageHours(profileId: string): EquipmentProfileUsage;
  /** Live profiles + usage, run through `suggestProfileMerges()`. */
  listMergeSuggestions(config?: Parameters<typeof suggestProfileMerges>[1]): MergeSuggestion[];
  /** Marks a live profile user-confirmed. Rejects a merged or unknown id. */
  confirm(id: string): EquipmentProfileRow;
  /** Trims and sets `name` only. Rejects an empty result, or a merged/unknown id. */
  rename(id: string, name: string): EquipmentProfileRow;
  /**
   * One transaction: repoints every `frames`/`sessions`/`master_frames` row
   * of every merged id to the survivor (re-stamping `updated_at` on each
   * touched row), flattens any prior chain into the merged ids, sets
   * `merged_into_id` on the merged rows (never hard-deleted, DD-003), and
   * marks the survivor confirmed. Rejects — leaving the database
   * byte-for-byte unchanged — when: the survivor is listed among the
   * merged ids, `mergedIds` is empty, any id is unknown, the survivor is
   * itself merged, or a merged id is already merged.
   */
  merge(survivorId: string, mergedIds: string[]): void;
}

/** Raw-SQL row shape for the usage aggregate (DD-003 aggregation hot path). */
interface RawUsageRow {
  id: string;
  createdAt: number;
  updatedAt: number;
  name: string;
  telescope: string | null;
  camera: string | null;
  focalLength: number | null;
  aperture: number | null;
  pixelSize: number | null;
  isUserConfirmed: number;
  matchKey: string | null;
  mergedIntoId: string | null;
  lightExposureSeconds: number;
  lightFrameCount: number;
}

function toUsageRecord(row: RawUsageRow): EquipmentProfileWithUsage {
  return {
    id: row.id,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
    name: row.name,
    telescope: row.telescope,
    camera: row.camera,
    focalLength: row.focalLength,
    aperture: row.aperture,
    pixelSize: row.pixelSize,
    isUserConfirmed: row.isUserConfirmed === 1,
    matchKey: row.matchKey,
    mergedIntoId: row.mergedIntoId,
    lightExposureSeconds: row.lightExposureSeconds,
    usageHours: row.lightExposureSeconds / 3600,
    lightFrameCount: row.lightFrameCount,
  };
}

/**
 * Shared aggregate: Σ `exposure_seconds` (COALESCEd to 0) and a row count,
 * over `light` frames whose file is not `duplicate` (DD-003: `missing`
 * files still count, stats stay stable when a drive is offline; P1-13
 * uses the same rule). A raw SQL fragment because this is a DD-003
 * aggregation hot path (CLAUDE.md), not expressible as one indexed
 * equality lookup.
 */
const USAGE_JOIN = sql`
  LEFT JOIN frames f ON f.equipment_profile_id = ep.id AND f.frame_type = 'light'
  LEFT JOIN files fi ON fi.id = f.file_id
`;
const USAGE_SECONDS_EXPR = sql`COALESCE(SUM(CASE WHEN f.id IS NOT NULL AND fi.status <> 'duplicate' THEN COALESCE(f.exposure_seconds, 0) ELSE 0 END), 0)`;
const USAGE_COUNT_EXPR = sql`COUNT(CASE WHEN f.id IS NOT NULL AND fi.status <> 'duplicate' THEN 1 END)`;

export function createEquipmentProfilesRepository(db: DrizzleDb): EquipmentProfilesRepository {
  const base = createCrudRepository(db, equipmentProfiles);

  function listLive(): EquipmentProfileWithUsage[] {
    const rows = db.all<RawUsageRow>(sql`
      SELECT
        ep.id AS id,
        ep.created_at AS createdAt,
        ep.updated_at AS updatedAt,
        ep.name AS name,
        ep.telescope AS telescope,
        ep.camera AS camera,
        ep.focal_length AS focalLength,
        ep.aperture AS aperture,
        ep.pixel_size AS pixelSize,
        ep.is_user_confirmed AS isUserConfirmed,
        ep.match_key AS matchKey,
        ep.merged_into_id AS mergedIntoId,
        ${USAGE_SECONDS_EXPR} AS lightExposureSeconds,
        ${USAGE_COUNT_EXPR} AS lightFrameCount
      FROM equipment_profiles ep
      ${USAGE_JOIN}
      WHERE ep.merged_into_id IS NULL
      GROUP BY ep.id
    `);
    return rows.map(toUsageRecord);
  }

  function listMergeSuggestions(
    config?: Parameters<typeof suggestProfileMerges>[1],
  ): MergeSuggestion[] {
    const live = listLive();
    const forSuggestion: EquipmentProfileForSuggestion[] = live.map((p) => ({
      id: p.id,
      telescope: p.telescope,
      camera: p.camera,
      focalLengthMm: p.focalLength,
      isUserConfirmed: p.isUserConfirmed,
      lightUsageSeconds: p.lightExposureSeconds,
    }));
    return suggestProfileMerges(forSuggestion, config);
  }

  return {
    ...base,

    detectFromFrames(): DetectFromFramesResult {
      const rows = db
        .selectDistinct({
          telescopeRaw: frames.telescopeRaw,
          cameraRaw: frames.cameraRaw,
          focalLength: frames.focalLength,
        })
        .from(frames)
        .all();

      const inputs: EquipmentIdentityInput[] = rows.map((r) => ({
        telescopeRaw: r.telescopeRaw,
        cameraRaw: r.cameraRaw,
        focalLength: r.focalLength,
      }));
      const detected = detectEquipmentProfiles(inputs);

      // Existing keys among ALL rows (live or merged-away): a merged-away
      // row's matchKey stays on its row (merge never clears it), so this
      // must not be scoped to merged_into_id IS NULL — that would make a
      // rescan resurrect a profile the user just merged away (MRG-10).
      const existingKeys = new Set(
        db
          .select({ matchKey: equipmentProfiles.matchKey })
          .from(equipmentProfiles)
          .all()
          .map((r) => r.matchKey)
          .filter((k): k is string => k !== null),
      );

      let inserted = 0;
      let existing = 0;
      for (const profile of detected) {
        if (existingKeys.has(profile.matchKey)) {
          existing += 1;
          continue;
        }
        const values: NewRow<typeof equipmentProfiles> = {
          name: profile.name,
          telescope: profile.telescope,
          camera: profile.camera,
          focalLength: profile.focalLengthMm,
          isUserConfirmed: false,
          matchKey: profile.matchKey,
        };
        base.insert(values);
        inserted += 1;
      }
      return { inserted, existing };
    },

    resolveMatchKeys(keys: string[]): Map<string, string> {
      if (keys.length === 0) return new Map();
      const rows = db
        .select({
          matchKey: equipmentProfiles.matchKey,
          id: equipmentProfiles.id,
          mergedIntoId: equipmentProfiles.mergedIntoId,
        })
        .from(equipmentProfiles)
        .where(inArray(equipmentProfiles.matchKey, keys))
        .all();
      const result = new Map<string, string>();
      for (const row of rows) {
        if (row.matchKey === null) continue;
        result.set(row.matchKey, row.mergedIntoId ?? row.id);
      }
      return result;
    },

    listLive,

    usageHours(profileId: string): EquipmentProfileUsage {
      const row = db.get<{ lightExposureSeconds: number }>(sql`
        SELECT ${USAGE_SECONDS_EXPR} AS lightExposureSeconds
        FROM equipment_profiles ep
        ${USAGE_JOIN}
        WHERE ep.id = ${profileId}
        GROUP BY ep.id
      `) as { lightExposureSeconds: number } | undefined;
      const seconds = row?.lightExposureSeconds ?? 0;
      return { lightExposureSeconds: seconds, usageHours: seconds / 3600 };
    },

    listMergeSuggestions,

    confirm(id: string): EquipmentProfileRow {
      return db.transaction((tx) => {
        const existing = tx
          .select()
          .from(equipmentProfiles)
          .where(eq(equipmentProfiles.id, id))
          .get();
        if (existing === undefined) {
          throw new Error(`confirm: unknown equipment profile id ${id}`);
        }
        if (existing.mergedIntoId !== null) {
          throw new Error(
            `confirm: equipment profile ${id} has been merged into ${existing.mergedIntoId}`,
          );
        }
        const updated = tx
          .update(equipmentProfiles)
          .set({ isUserConfirmed: true, updatedAt: new Date() })
          .where(eq(equipmentProfiles.id, id))
          .returning()
          .get();
        if (updated === undefined) {
          throw new Error(`confirm: update produced no row for id ${id}`);
        }
        return updated;
      });
    },

    rename(id: string, name: string): EquipmentProfileRow {
      const trimmed = name.trim();
      if (trimmed === '') {
        throw new Error('rename: name must not be empty');
      }
      return db.transaction((tx) => {
        const existing = tx
          .select()
          .from(equipmentProfiles)
          .where(eq(equipmentProfiles.id, id))
          .get();
        if (existing === undefined) {
          throw new Error(`rename: unknown equipment profile id ${id}`);
        }
        if (existing.mergedIntoId !== null) {
          throw new Error(
            `rename: equipment profile ${id} has been merged into ${existing.mergedIntoId}`,
          );
        }
        const updated = tx
          .update(equipmentProfiles)
          .set({ name: trimmed, updatedAt: new Date() })
          .where(eq(equipmentProfiles.id, id))
          .returning()
          .get();
        if (updated === undefined) {
          throw new Error(`rename: update produced no row for id ${id}`);
        }
        return updated;
      });
    },

    merge(survivorId: string, mergedIds: string[]): void {
      db.transaction((tx) => {
        if (mergedIds.length === 0) {
          throw new Error('merge: mergedIds must not be empty');
        }
        if (mergedIds.includes(survivorId)) {
          throw new Error('merge: survivorId must not appear in mergedIds');
        }

        const survivor = tx
          .select()
          .from(equipmentProfiles)
          .where(eq(equipmentProfiles.id, survivorId))
          .get();
        if (survivor === undefined) {
          throw new Error(`merge: unknown survivor id ${survivorId}`);
        }
        if (survivor.mergedIntoId !== null) {
          throw new Error(`merge: survivor ${survivorId} is itself merged`);
        }

        const losers = tx
          .select()
          .from(equipmentProfiles)
          .where(inArray(equipmentProfiles.id, mergedIds))
          .all();
        if (losers.length !== mergedIds.length) {
          throw new Error('merge: one or more mergedIds are unknown');
        }
        for (const loser of losers) {
          if (loser.mergedIntoId !== null) {
            throw new Error(`merge: profile ${loser.id} is already merged`);
          }
        }

        const now = new Date();

        // Repoint every referencing table — one UPDATE per table, not one
        // per row (J-3) — before touching equipment_profiles itself.
        tx.update(frames)
          .set({ equipmentProfileId: survivorId, updatedAt: now })
          .where(inArray(frames.equipmentProfileId, mergedIds))
          .run();
        tx.update(sessions)
          .set({ equipmentProfileId: survivorId, updatedAt: now })
          .where(inArray(sessions.equipmentProfileId, mergedIds))
          .run();
        tx.update(masterFrames)
          .set({ equipmentProfileId: survivorId, updatedAt: now })
          .where(inArray(masterFrames.equipmentProfileId, mergedIds))
          .run();

        // Flatten any prior chain (rows previously merged into a now-merged
        // loser) onto the new survivor, so resolution stays one hop.
        tx.update(equipmentProfiles)
          .set({ mergedIntoId: survivorId, updatedAt: now })
          .where(inArray(equipmentProfiles.mergedIntoId, mergedIds))
          .run();

        // Mark the merged-away rows. Never hard-deleted (DD-003) so their
        // matchKey keeps resolving to the survivor on every future rescan.
        tx.update(equipmentProfiles)
          .set({ mergedIntoId: survivorId, updatedAt: now })
          .where(inArray(equipmentProfiles.id, mergedIds))
          .run();

        // Last write: the survivor is always confirmed by a merge.
        tx.update(equipmentProfiles)
          .set({ isUserConfirmed: true, updatedAt: now })
          .where(eq(equipmentProfiles.id, survivorId))
          .run();
      });
    },
  };
}
