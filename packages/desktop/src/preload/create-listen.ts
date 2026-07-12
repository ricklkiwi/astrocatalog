import { IPC_EVENT_CHANNELS, type AstroTrackerBridge } from '../ipc/contract.js';

const ALLOWED_EVENT_CHANNELS: ReadonlySet<string> = new Set(IPC_EVENT_CHANNELS);

export function createListen(
  rawOn: (channel: string, listener: (_event: unknown, payload: unknown) => void) => void,
  rawOff: (channel: string, listener: (_event: unknown, payload: unknown) => void) => void,
): AstroTrackerBridge['on'] {
  return ((channel: string, listener: (payload: unknown) => void) => {
    if (!ALLOWED_EVENT_CHANNELS.has(channel)) {
      throw new Error(`IPC event "${channel}" is not in the AstroTracker event contract`);
    }
    const wrapped = (_event: unknown, payload: unknown): void => {
      listener(payload);
    };
    rawOn(channel, wrapped);
    return () => {
      rawOff(channel, wrapped);
    };
  }) as AstroTrackerBridge['on'];
}
