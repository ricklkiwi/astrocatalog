import { describe, expect, it } from 'vitest';

import { createIpcHandlers, registerIpcHandlers } from '../main/ipc/register.js';
import {
  IPC_CHANNELS,
  IPC_EVENT_CHANNELS,
  type AppVersionInfo,
  type JobSummary,
} from './contract.js';

function makeHandlers() {
  return createIpcHandlers({
    appVersion: '0.1.0-test',
    platform: 'darwin',
    versions: { electron: '43.0.0', chrome: '142.0.0.0', node: '22.0.0' },
    nativeSmoke: () => ({ sqliteVersion: '3.46.0', sharpVersion: '0.33.0' }),
    jobs: {
      enqueueDemo: () => ({ jobId: 'job-1' }),
      cancel: () => {},
      list: () => [
        {
          id: 'job-1',
          jobType: 'demo',
          status: 'queued',
          progressCurrent: 0,
          progressTotal: null,
          progressMessage: null,
        },
      ],
    },
  });
}

describe('IPC contract registration', () => {
  it('binds every contract channel exactly once, and nothing else', () => {
    const registered: string[] = [];
    registerIpcHandlers({ handle: (channel) => registered.push(channel) }, makeHandlers());

    expect([...registered].sort()).toEqual([...IPC_CHANNELS].sort());
    expect(new Set(registered).size).toBe(registered.length);
  });

  it('has a handler for every contract channel (set equality with IPC_CHANNELS)', () => {
    // IpcHandlers is a mapped type over the contract, so its runtime keys ARE
    // the contract's keys — this pins IPC_CHANNELS against drifting from it.
    expect(Object.keys(makeHandlers()).sort()).toEqual([...IPC_CHANNELS].sort());
  });
});

describe('jobs handlers', () => {
  it('registers job request channels and the jobs.progress event channel', () => {
    expect(IPC_CHANNELS).toEqual(['app.version', 'jobs.enqueueDemo', 'jobs.cancel', 'jobs.list']);
    expect(IPC_EVENT_CHANNELS).toEqual(['jobs.progress']);
  });

  it('delegates enqueue/cancel/list to injected job dependencies', async () => {
    const handlers = makeHandlers();

    expect(await handlers['jobs.enqueueDemo']({ totalSteps: 2, stepMs: 3 })).toEqual({
      jobId: 'job-1',
    });
    expect(await handlers['jobs.cancel']({ jobId: 'job-1' })).toBeUndefined();
    const jobs: JobSummary[] = await handlers['jobs.list']();
    expect(jobs[0]?.id).toBe('job-1');
  });
});

describe('app.version handler', () => {
  it('returns the contract output shape with non-empty string fields', async () => {
    const result: AppVersionInfo = await makeHandlers()['app.version']();

    const expectedKeys: Array<keyof AppVersionInfo> = [
      'appVersion',
      'electronVersion',
      'chromeVersion',
      'nodeVersion',
      'platform',
      'sqliteVersion',
      'sharpVersion',
    ];
    expect(Object.keys(result).sort()).toEqual([...expectedKeys].sort());
    for (const key of expectedKeys) {
      expect(typeof result[key], key).toBe('string');
      expect(result[key], key).not.toHaveLength(0);
    }
    expect(result.appVersion).toBe('0.1.0-test');
    expect(result.platform).toBe('darwin');
  });
});
