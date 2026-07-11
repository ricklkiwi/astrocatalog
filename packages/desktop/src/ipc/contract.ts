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
] as const;

export type IpcChannel = (typeof IPC_CHANNELS)[number];

/** Every main→renderer event channel in the contract, as runtime data (preload whitelist source). */
export const IPC_EVENT_CHANNELS = ['jobs.progress'] as const;

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
 * Channel → { input, output } map. Keyed by IpcChannel so a channel cannot be
 * listed in IPC_CHANNELS without a contract entry (and vice versa).
 */
export interface IpcContract extends Record<IpcChannel, { input: unknown; output: unknown }> {
  'app.version': { input: void; output: AppVersionInfo };
  'jobs.enqueueDemo': { input: EnqueueDemoInput | void; output: EnqueueDemoOutput };
  'jobs.cancel': { input: CancelJobInput; output: void };
  'jobs.list': { input: void; output: JobSummary[] };
}

export type IpcInput<C extends IpcChannel> = IpcContract[C]['input'];
export type IpcOutput<C extends IpcChannel> = IpcContract[C]['output'];

export interface IpcEventContract extends Record<IpcEventChannel, { payload: unknown }> {
  'jobs.progress': { payload: JobProgressEvent };
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
