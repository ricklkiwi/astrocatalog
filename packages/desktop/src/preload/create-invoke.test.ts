import { describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '../ipc/contract.js';
import { createInvoke } from './create-invoke.js';

describe('preload invoke whitelist', () => {
  it('forwards contract channels to the raw ipcRenderer invoke', async () => {
    const raw = vi.fn().mockResolvedValue({ ok: true });
    const invoke = createInvoke(raw);

    await expect(invoke('app.version')).resolves.toEqual({ ok: true });
    expect(raw).toHaveBeenCalledExactlyOnceWith('app.version');
  });

  it('throws synchronously for a channel outside the contract, without touching ipcRenderer', () => {
    const raw = vi.fn();
    const invoke = createInvoke(raw) as unknown as (channel: string) => Promise<unknown>;

    expect(() => invoke('fs.read')).toThrow(/not in the AstroTracker contract/);
    expect(raw).not.toHaveBeenCalled();
  });

  it('whitelists exactly the contract channels', () => {
    const raw = vi.fn().mockResolvedValue(undefined);
    const invoke = createInvoke(raw) as unknown as (channel: string) => Promise<unknown>;

    for (const channel of IPC_CHANNELS) {
      expect(() => invoke(channel)).not.toThrow();
    }
    for (const bad of ['app.version2', 'shell.openExternal', '']) {
      expect(() => invoke(bad), bad).toThrow();
    }
  });
});
