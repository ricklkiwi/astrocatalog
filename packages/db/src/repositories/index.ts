/**
 * Repository factory — one repository per aggregate. This is the only
 * surface `openDatabase()` callers ever see; the Drizzle instance (and the
 * better-sqlite3 connection beneath it) stay closed over and unexported.
 */
import { createEquipmentProfilesRepository } from './equipment-profiles.js';
import { createFilesRepository } from './files.js';
import { createFiltersRepository } from './filters.js';
import { createFramesRepository } from './frames.js';
import { createMasterFramesRepository } from './master-frames.js';
import { createProjectsRepository } from './projects.js';
import { createScanJobsRepository } from './scan-jobs.js';
import { createSearchRepository } from './search.js';
import { createSessionsRepository } from './sessions.js';
import { createSettingsRepository } from './settings.js';
import { createTargetsRepository } from './targets.js';
import { createWatchFoldersRepository } from './watch-folders.js';
import type { EquipmentProfilesRepository } from './equipment-profiles.js';
import type { FilesRepository, UpsertDiscoveredInput, UpsertDiscoveredResult } from './files.js';
import type { FiltersRepository } from './filters.js';
import type { FramesListFilter, FramesRepository } from './frames.js';
import type { MasterFramesRepository } from './master-frames.js';
import type { ProjectsRepository } from './projects.js';
import type {
  EnqueueJobInput,
  JobStatus,
  ProgressUpdate,
  ScanJob,
  ScanJobsRepository,
} from './scan-jobs.js';
import type { SearchHit, SearchRepository } from './search.js';
import type { SessionsRepository } from './sessions.js';
import type { SettingsRepository } from './settings.js';
import type { TargetsRepository } from './targets.js';
import type { WatchFoldersRepository } from './watch-folders.js';
import type { CrudRepository, DrizzleDb, NewRow, RowPatch } from './shared.js';

export interface Repositories {
  watchFolders: WatchFoldersRepository;
  files: FilesRepository;
  frames: FramesRepository;
  targets: TargetsRepository;
  filters: FiltersRepository;
  sessions: SessionsRepository;
  equipmentProfiles: EquipmentProfilesRepository;
  masterFrames: MasterFramesRepository;
  projects: ProjectsRepository;
  scanJobs: ScanJobsRepository;
  settings: SettingsRepository;
  search: SearchRepository;
}

export function createRepositories(db: DrizzleDb): Repositories {
  return {
    watchFolders: createWatchFoldersRepository(db),
    files: createFilesRepository(db),
    frames: createFramesRepository(db),
    targets: createTargetsRepository(db),
    filters: createFiltersRepository(db),
    sessions: createSessionsRepository(db),
    equipmentProfiles: createEquipmentProfilesRepository(db),
    masterFrames: createMasterFramesRepository(db),
    projects: createProjectsRepository(db),
    scanJobs: createScanJobsRepository(db),
    settings: createSettingsRepository(db),
    search: createSearchRepository(db),
  };
}

export type {
  CrudRepository,
  NewRow,
  RowPatch,
  WatchFoldersRepository,
  FilesRepository,
  UpsertDiscoveredInput,
  UpsertDiscoveredResult,
  FramesListFilter,
  FramesRepository,
  TargetsRepository,
  FiltersRepository,
  SessionsRepository,
  EquipmentProfilesRepository,
  MasterFramesRepository,
  ProjectsRepository,
  EnqueueJobInput,
  JobStatus,
  ProgressUpdate,
  ScanJob,
  ScanJobsRepository,
  SettingsRepository,
  SearchHit,
  SearchRepository,
};
