/**
 * Binds every contract procedure to `ipcMain.handle` from one source of
 * truth. The mapped IpcHandlers type is exhaustive over the contract, so a
 * procedure cannot exist without appearing in the shared type — and cannot be
 * declared in the contract without an implementation here.
 *
 * `ipcMain` is injected (IpcMainLike) so this module never imports Electron
 * and stays unit-testable under plain Node (contract.test.ts).
 */
import {
  IPC_CHANNELS,
  type AddWatchFolderInput,
  type EnqueueDemoInput,
  type EnqueueScanInput,
  type IpcContract,
  type WatchFolderRecord,
} from '../../ipc/contract.js';

export type IpcHandlers = {
  [C in keyof IpcContract]: (
    input: IpcContract[C]['input'],
  ) => IpcContract[C]['output'] | Promise<IpcContract[C]['output']>;
};

/** The subset of Electron's ipcMain that registration needs. */
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void;
}

/** Everything the handlers need from the environment, injected for testability. */
export interface IpcHandlerDeps {
  appVersion: string;
  platform: string;
  /** `process.versions` — electron/chrome are absent under plain Node tests. */
  versions: Partial<Record<'electron' | 'chrome' | 'node', string>>;
  /** Step 6 native-module smoke, injected so this module needs no native deps to unit test. */
  nativeSmoke: () => { sqliteVersion: string; sharpVersion: string };
  jobs: {
    enqueueDemo(input?: EnqueueDemoInput): { jobId: string };
    cancel(jobId: string): void;
    list(): IpcContract['jobs.list']['output'];
    /** Enqueues a filesystem scan of the given watch folder; returns its job id. */
    enqueueScan(input: EnqueueScanInput): { jobId: string };
  };
  watchFolders: {
    list(): WatchFolderRecord[];
    /**
     * Validates the path (must exist and be a directory), best-effort detects
     * the drive label, persists the row, and returns the created record.
     * Async because it does filesystem + drive-label I/O.
     */
    add(input: AddWatchFolderInput): Promise<WatchFolderRecord>;
    remove(id: string): boolean;
  };
  files: {
    listByWatchFolder(
      watchFolderId: string,
    ): IpcContract['files.listByWatchFolder']['output']['files'];
  };
}

const DEMO_DEFAULTS = { totalSteps: 10, stepMs: 500 } as const;

function validateDemoInteger(
  field: keyof EnqueueDemoInput,
  value: number | undefined,
  max: number,
): number {
  if (value === undefined) {
    return DEMO_DEFAULTS[field];
  }
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${field} must be a finite integer in the inclusive range 1..${max}`);
  }
  return value;
}

function requireObject(input: unknown, label: string): Record<string, unknown> {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error(`${label} input must be an object`);
  }
  return input as Record<string, unknown>;
}

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function validateAddWatchFolderInput(input: unknown): AddWatchFolderInput {
  const obj = requireObject(input, 'watchFolders.add');
  const path = requireNonEmptyString(obj['path'], 'path');
  const rawSkip = obj['skipPatterns'];
  if (rawSkip === undefined) {
    return { path };
  }
  if (!Array.isArray(rawSkip) || rawSkip.some((p) => typeof p !== 'string')) {
    throw new Error('skipPatterns must be an array of strings when provided');
  }
  return { path, skipPatterns: rawSkip as string[] };
}

function validateWatchFolderId(input: unknown, label: string): string {
  const obj = requireObject(input, label);
  const key = label === 'watchFolders.remove' ? 'id' : 'watchFolderId';
  return requireNonEmptyString(obj[key], key);
}

function validateEnqueueDemoInput(input: EnqueueDemoInput | void): Required<EnqueueDemoInput> {
  if (
    input !== undefined &&
    (input === null || typeof input !== 'object' || Array.isArray(input))
  ) {
    throw new Error('jobs.enqueueDemo input must be an object when provided');
  }
  return {
    totalSteps: validateDemoInteger('totalSteps', input?.totalSteps, 1000),
    stepMs: validateDemoInteger('stepMs', input?.stepMs, 10000),
  };
}

export function createIpcHandlers(deps: IpcHandlerDeps): IpcHandlers {
  return {
    'app.version': () => {
      const { sqliteVersion, sharpVersion } = deps.nativeSmoke();
      return {
        appVersion: deps.appVersion,
        electronVersion: deps.versions.electron ?? 'unknown',
        chromeVersion: deps.versions.chrome ?? 'unknown',
        nodeVersion: deps.versions.node ?? 'unknown',
        platform: deps.platform,
        sqliteVersion,
        sharpVersion,
      };
    },
    'jobs.enqueueDemo': (input) => deps.jobs.enqueueDemo(validateEnqueueDemoInput(input)),
    'jobs.cancel': (input) => {
      deps.jobs.cancel(input.jobId);
    },
    'jobs.list': () => deps.jobs.list(),
    'jobs.enqueueScan': (input) =>
      deps.jobs.enqueueScan({ watchFolderId: validateWatchFolderId(input, 'jobs.enqueueScan') }),
    'watchFolders.list': () => ({ watchFolders: deps.watchFolders.list() }),
    'watchFolders.add': (input) => deps.watchFolders.add(validateAddWatchFolderInput(input)),
    'watchFolders.remove': (input) => ({
      removed: deps.watchFolders.remove(validateWatchFolderId(input, 'watchFolders.remove')),
    }),
    'files.listByWatchFolder': (input) => ({
      files: deps.files.listByWatchFolder(validateWatchFolderId(input, 'files.listByWatchFolder')),
    }),
  };
}

/** Registers every contract channel exactly once on the given ipcMain. */
export function registerIpcHandlers(ipcMain: IpcMainLike, handlers: IpcHandlers): void {
  for (const channel of IPC_CHANNELS) {
    const handler = handlers[channel];
    ipcMain.handle(channel, (_event, input) => handler(input as never));
  }
}
