import { describe, expect, it, vi } from 'vitest';

import { broadcastIpcEvent, toIpcJobProgressEvent } from './broadcast.js';

describe('job progress broadcast', () => {
  it('maps the orchestrator event to the exact renderer-facing payload', () => {
    expect(
      toIpcJobProgressEvent({
        jobId: 'job-1',
        jobType: 'demo',
        status: 'running',
        current: 4,
        total: 10,
        message: 'step 4/10',
      }),
    ).toEqual({
      id: 'job-1',
      jobType: 'demo',
      status: 'running',
      progressCurrent: 4,
      progressTotal: 10,
      progressMessage: 'step 4/10',
      message: 'step 4/10',
    });
  });

  it('sends progress to every currently open window sender', () => {
    const first = { send: vi.fn() };
    const second = { send: vi.fn() };
    const payload = toIpcJobProgressEvent({
      jobId: 'job-1',
      jobType: 'demo',
      status: 'running',
      current: 1,
      total: null,
      message: null,
    });

    broadcastIpcEvent(() => [first, second], 'jobs.progress', payload);

    expect(first.send).toHaveBeenCalledExactlyOnceWith('jobs.progress', payload);
    expect(second.send).toHaveBeenCalledExactlyOnceWith('jobs.progress', payload);
  });
});
