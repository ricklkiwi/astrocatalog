/**
 * Binds every contract procedure to `ipcMain.handle` from one source of
 * truth. The mapped IpcHandlers type is exhaustive over the contract, so a
 * procedure cannot exist without appearing in the shared type — and cannot be
 * declared in the contract without an implementation here.
 *
 * `ipcMain` is injected (IpcMainLike) so this module never imports Electron
 * and stays unit-testable under plain Node (contract.test.ts).
 */
import { IPC_CHANNELS, type IpcContract } from '../../ipc/contract.js';

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
}

export function createIpcHandlers(deps: IpcHandlerDeps): IpcHandlers {
  return {
    'app.version': () => ({
      appVersion: deps.appVersion,
      electronVersion: deps.versions.electron ?? 'unknown',
      chromeVersion: deps.versions.chrome ?? 'unknown',
      nodeVersion: deps.versions.node ?? 'unknown',
      platform: deps.platform,
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
