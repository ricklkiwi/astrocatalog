/**
 * Public API of `@astrotracker/db` (P0-04).
 *
 * Encapsulation guarantee (issue #4): nothing exported here exposes or
 * re-exports the underlying driver — no raw connection, no statements, no
 * driver types. Callers get `openDatabase()` and typed repositories only.
 */
import type { InferSelectModel } from 'drizzle-orm';

import type {
  equipmentProfiles,
  files,
  filters,
  frames,
  masterFrames,
  masterFrameSubs,
  scanJobs,
  sessions,
  settings,
  targetAliases,
  targets,
  thumbnails,
  watchFolders,
} from './schema/index.js';
import type { NewRow } from './repositories/shared.js';

export { openDatabase } from './bootstrap.js';
export type { AstroDatabase, OpenDatabaseOptions } from './bootstrap.js';

export type {
  Repositories,
  CrudRepository,
  NewRow,
  RowPatch,
  WatchFoldersRepository,
  FilesRepository,
  DuplicateGroupResult,
  MoveCandidate,
  ReparentMovedInput,
  UpsertDiscoveredInput,
  UpsertDiscoveredResult,
  FramesListFilter,
  FramesRepository,
  TargetsRepository,
  FiltersRepository,
  SessionsRepository,
  EquipmentProfilesRepository,
  DetectFromFramesResult,
  EquipmentProfileUsage,
  EquipmentProfileWithUsage,
  MasterFramesRepository,
  CounterDelta,
  EnqueueJobInput,
  JobStatus,
  ProgressUpdate,
  ScanJobsRepository,
  SettingsRepository,
  SearchHit,
  SearchRepository,
} from './repositories/index.js';

// Inferred row types (select model) and insert payloads (audit columns are
// stamped by the repositories, so New* omits id/createdAt/updatedAt).
export type WatchFolder = InferSelectModel<typeof watchFolders>;
export type NewWatchFolder = NewRow<typeof watchFolders>;
export type FileRecord = InferSelectModel<typeof files>;
export type NewFileRecord = NewRow<typeof files>;
export type Frame = InferSelectModel<typeof frames>;
export type NewFrame = NewRow<typeof frames>;
export type Target = InferSelectModel<typeof targets>;
export type NewTarget = NewRow<typeof targets>;
export type TargetAlias = InferSelectModel<typeof targetAliases>;
export type NewTargetAlias = NewRow<typeof targetAliases>;
export type Filter = InferSelectModel<typeof filters>;
export type NewFilter = NewRow<typeof filters>;
export type Session = InferSelectModel<typeof sessions>;
export type NewSession = NewRow<typeof sessions>;
export type EquipmentProfile = InferSelectModel<typeof equipmentProfiles>;
export type NewEquipmentProfile = NewRow<typeof equipmentProfiles>;
export type MasterFrame = InferSelectModel<typeof masterFrames>;
export type NewMasterFrame = NewRow<typeof masterFrames>;
export type MasterFrameSub = InferSelectModel<typeof masterFrameSubs>;
export type NewMasterFrameSub = NewRow<typeof masterFrameSubs>;
export type ScanJob = InferSelectModel<typeof scanJobs>;
export type NewScanJob = NewRow<typeof scanJobs>;
export type Thumbnail = InferSelectModel<typeof thumbnails>;
export type NewThumbnail = NewRow<typeof thumbnails>;
export type Setting = InferSelectModel<typeof settings>;
