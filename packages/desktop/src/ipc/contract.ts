/**
 * The typed IPC contract — the single source of truth for every renderer ↔
 * main procedure (DD-002 rule 2). Both sides derive their types from this
 * file; the renderer may import it with `import type` ONLY (enforced by a
 * scoped ESLint rule) so no runtime code ever crosses the boundary.
 *
 * Adding a procedure means: add a channel literal to IPC_CHANNELS, add its
 * input/output entry to IpcContract, and implement it in
 * `src/main/ipc/register.ts` (the mapped Handlers type makes a missing
 * implementation a compile error; contract.test.ts pins registration).
 */

/** Every request/response channel in the contract, as runtime data (preload whitelist source). */
export const IPC_CHANNELS = [
  'app.version',
  'jobs.enqueueDemo',
  'jobs.cancel',
  'jobs.list',
  'jobs.enqueueScan',
  'watchFolders.list',
  'watchFolders.add',
  'watchFolders.remove',
  'watchFolders.setLiveWatch',
  'files.listByWatchFolder',
] as const;

export type IpcChannel = (typeof IPC_CHANNELS)[number];

/** Every main→renderer event channel in the contract, as runtime data (preload whitelist source). */
export const IPC_EVENT_CHANNELS = ['jobs.progress', 'watch.status'] as const;

export type IpcEventChannel = (typeof IPC_EVENT_CHANNELS)[number];

/** Output of `app.version` — the demo procedure proving the full round trip. */
export interface AppVersionInfo {
  appVersion: string;
  electronVersion: string;
  chromeVersion: string;
  nodeVersion: string;
  platform: string;
  /** From the Step 6 native-module smoke (in-memory SQLite, no persistence). */
  sqliteVersion: string;
  sharpVersion: string;
}

export interface EnqueueDemoInput {
  totalSteps?: number;
  stepMs?: number;
}

export interface EnqueueDemoOutput {
  jobId: string;
}

export interface CancelJobInput {
  jobId: string;
}

export interface JobSummary {
  id: string;
  jobType: string;
  status: string;
  progressCurrent: number;
  progressTotal: number | null;
  progressMessage: string | null;
}

export interface JobProgressEvent extends JobSummary {
  message: string | null;
}

/**
 * IPC-facing view of a `watch_folders` row (mirrors `@astrotracker/db`'s
 * `WatchFolder`, kept as a local type so this contract stays import-free and
 * the type-only renderer never needs to resolve `@astrotracker/db`).
 * `skipPatterns` is surfaced already-parsed from the DB's JSON `skip_patterns`
 * TEXT column (`null` when unset). `Date` fields survive the Electron
 * structured-clone boundary intact.
 */
export interface WatchFolderRecord {
  id: string;
  path: string;
  driveLabel: string | null;
  isActive: boolean;
  lastScanAt: Date | null;
  skipPatterns: string[] | null;
  /** Per-folder opt-in for live chokidar watching (P1-09). Default `false`. */
  liveWatchEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Runtime live-watch state for a folder (P1-09). Not persisted — recomputed
 * by `WatchManager.start()` at every app boot. `'watching'`: a live chokidar
 * watcher is attached. `'fallback'`: the watcher hit an OS resource limit
 * (ENOSPC/EMFILE/ENFILE) and the folder fell back to periodic rescanning.
 * `'off'`: live watch is disabled for this folder.
 */
export type WatchMode = 'watching' | 'fallback' | 'off';

/** Main → renderer push event reporting a watch-folder's live-watch mode transition (P1-09). */
export interface WatchStatusEvent {
  watchFolderId: string;
  mode: WatchMode;
  /** Human-readable detail, e.g. the fallback reason. `null` when not applicable. */
  message: string | null;
  /** UTC ISO-8601 timestamp of the transition. */
  updatedAt: string;
}

export interface SetLiveWatchInput {
  id: string;
  enabled: boolean;
}

/** IPC-facing view of a `files` row (mirrors `@astrotracker/db`'s `FileRecord`). */
export interface FileRecord {
  id: string;
  watchFolderId: string;
  relativePath: string;
  filename: string;
  extension: string;
  sizeBytes: number;
  sha256: string | null;
  fileMtime: Date | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  status: string;
  duplicateOfId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AddWatchFolderInput {
  /** Absolute path to an existing directory; the main-process handler `stat`s it and rejects non-directories. */
  path: string;
  /** Optional glob-ish skip patterns persisted as JSON on the row. */
  skipPatterns?: string[];
}

export interface RemoveWatchFolderInput {
  id: string;
}

export interface EnqueueScanInput {
  watchFolderId: string;
}

export interface EnqueueScanOutput {
  jobId: string;
}

export interface ListFilesByWatchFolderInput {
  watchFolderId: string;
}

/**
 * Channel → { input, output } map. Keyed by IpcChannel so a channel cannot be
 * listed in IPC_CHANNELS without a contract entry (and vice versa).
 */
export interface IpcContract extends Record<IpcChannel, { input: unknown; output: unknown }> {
  'app.version': { input: void; output: AppVersionInfo };
  'jobs.enqueueDemo': { input: EnqueueDemoInput | void; output: EnqueueDemoOutput };
  'jobs.cancel': { input: CancelJobInput; output: void };
  'jobs.list': { input: void; output: JobSummary[] };
  'jobs.enqueueScan': { input: EnqueueScanInput; output: EnqueueScanOutput };
  'watchFolders.list': { input: void; output: { watchFolders: WatchFolderRecord[] } };
  'watchFolders.add': { input: AddWatchFolderInput; output: WatchFolderRecord };
  'watchFolders.remove': { input: RemoveWatchFolderInput; output: { removed: boolean } };
  'watchFolders.setLiveWatch': { input: SetLiveWatchInput; output: WatchFolderRecord };
  'files.listByWatchFolder': {
    input: ListFilesByWatchFolderInput;
    output: { files: FileRecord[] };
  };
}

export type IpcInput<C extends IpcChannel> = IpcContract[C]['input'];
export type IpcOutput<C extends IpcChannel> = IpcContract[C]['output'];

export interface IpcEventContract extends Record<IpcEventChannel, { payload: unknown }> {
  'jobs.progress': { payload: JobProgressEvent };
  'watch.status': { payload: WatchStatusEvent };
}

export type IpcEventPayload<C extends IpcEventChannel> = IpcEventContract[C]['payload'];

/**
 * The one API the preload exposes as `window.astrotracker`. Input-less
 * procedures are invoked with no second argument.
 */
export interface AstroTrackerBridge {
  invoke<C extends IpcChannel>(
    channel: C,
    ...args: undefined extends IpcInput<C>
      ? [] | [input: Exclude<IpcInput<C>, void>]
      : IpcInput<C> extends void
        ? []
        : [input: IpcInput<C>]
  ): Promise<IpcOutput<C>>;
  on<C extends IpcEventChannel>(
    channel: C,
    listener: (payload: IpcEventPayload<C>) => void,
  ): () => void;
}
