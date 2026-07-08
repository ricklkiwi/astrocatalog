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

/** Every channel in the contract, as runtime data (preload whitelist source). */
export const IPC_CHANNELS = ['app.version'] as const;

export type IpcChannel = (typeof IPC_CHANNELS)[number];

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

/**
 * Channel → { input, output } map. Keyed by IpcChannel so a channel cannot be
 * listed in IPC_CHANNELS without a contract entry (and vice versa).
 */
export interface IpcContract extends Record<IpcChannel, { input: unknown; output: unknown }> {
  'app.version': { input: void; output: AppVersionInfo };
}

export type IpcInput<C extends IpcChannel> = IpcContract[C]['input'];
export type IpcOutput<C extends IpcChannel> = IpcContract[C]['output'];

/**
 * The one API the preload exposes as `window.astrotracker`. Input-less
 * procedures are invoked with no second argument.
 */
export interface AstroTrackerBridge {
  invoke<C extends IpcChannel>(
    channel: C,
    ...args: IpcInput<C> extends void ? [] : [input: IpcInput<C>]
  ): Promise<IpcOutput<C>>;
}
