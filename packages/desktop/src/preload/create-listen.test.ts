import { describe, expect, it, vi } from 'vitest';

import { IPC_EVENT_CHANNELS } from '../ipc/contract.js';
import { createListen } from './create-listen.js';

describe('preload event whitelist', () => {
  it('forwards contract event channels to ipcRenderer.on and returns an unsubscribe', () => {
    const rawOn = vi.fn();
    const rawOff = vi.fn();
    const listen = createListen(rawOn, rawOff);
    const listener = vi.fn();

    const unsubscribe = listen('jobs.progress', listener);

    expect(rawOn).toHaveBeenCalledOnce();
    const [channel, wrapped] = rawOn.mock.calls[0]!;
    expect(channel).toBe('jobs.progress');
    (wrapped as (_event: unknown, payload: unknown) => void)({}, { id: 'job-1' });
    expect(listener).toHaveBeenCalledExactlyOnceWith({ id: 'job-1' });

    unsubscribe();
    expect(rawOff).toHaveBeenCalledExactlyOnceWith('jobs.progress', wrapped);
  });

  it('throws synchronously for an event outside the contract before touching ipcRenderer', () => {
    const rawOn = vi.fn();
    const rawOff = vi.fn();
    const listen = createListen(rawOn, rawOff) as unknown as (
      channel: string,
      listener: (payload: unknown) => void,
    ) => () => void;

    expect(() => listen('evil.event', vi.fn())).toThrow(/not in the AstroTracker event contract/);
    expect(rawOn).not.toHaveBeenCalled();
    expect(rawOff).not.toHaveBeenCalled();
  });

  it('whitelists exactly the event contract channels', () => {
    const listen = createListen(vi.fn(), vi.fn()) as unknown as (
      channel: string,
      listener: (payload: unknown) => void,
    ) => () => void;
    for (const channel of IPC_EVENT_CHANNELS) {
      expect(() => listen(channel, vi.fn())).not.toThrow();
    }
    expect(() => listen('jobs.progress2', vi.fn())).toThrow();
  });
});
