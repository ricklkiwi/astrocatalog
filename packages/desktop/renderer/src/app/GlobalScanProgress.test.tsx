import type { AstroTrackerBridge, JobSummary } from '@astrotracker/desktop';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GlobalScanProgress } from './GlobalScanProgress';

afterEach(() => {
  cleanup();
});

function makeJob(overrides: Partial<JobSummary> = {}): JobSummary {
  return {
    id: 'job-1',
    jobType: 'scan',
    status: 'running',
    progressCurrent: 420,
    progressTotal: 1000,
    progressMessage: null,
    ...overrides,
  };
}

interface Harness {
  listResult: JobSummary[];
  progressListener: ((payload: unknown) => void) | undefined;
  unsubscribe: ReturnType<typeof vi.fn>;
}

function renderScanProgress(listResult: JobSummary[]): Harness {
  const harness: Harness = { listResult, progressListener: undefined, unsubscribe: vi.fn() };
  const invoke = vi.fn((channel: string) => {
    if (channel === 'jobs.list') {
      return Promise.resolve(harness.listResult);
    }
    return Promise.resolve(undefined);
  });
  const on = vi.fn((channel: string, listener: (payload: unknown) => void) => {
    if (channel === 'jobs.progress') {
      harness.progressListener = listener;
    }
    return harness.unsubscribe;
  });
  window.astrotracker = { invoke, on } as unknown as AstroTrackerBridge;
  render(<GlobalScanProgress />);
  return harness;
}

describe('GlobalScanProgress', () => {
  it('SHL-2: renders nothing when jobs.list resolves [] and no jobs.progress event has arrived', async () => {
    const harness = renderScanProgress([]);
    await waitFor(() => {
      expect(harness.progressListener).toBeDefined();
    });

    expect(screen.queryByText(/./)).toBeNull();
  });

  it('SHL-3: seeded from jobs.list shows progress with no jobs.progress event fired', async () => {
    renderScanProgress([makeJob({ progressCurrent: 420, progressTotal: 1000 })]);

    expect(await screen.findByText('Scanning… 420/1000')).toBeTruthy();
  });

  it('SHL-4: a jobs.progress event updates the rendered counts', async () => {
    const harness = renderScanProgress([makeJob({ progressCurrent: 420, progressTotal: 1000 })]);
    await screen.findByText('Scanning… 420/1000');

    await act(async () => {
      harness.progressListener?.({
        id: 'job-1',
        jobType: 'scan',
        status: 'running',
        progressCurrent: 500,
        progressTotal: 1000,
        progressMessage: null,
        message: null,
      });
    });

    expect(await screen.findByText('Scanning… 500/1000')).toBeTruthy();
  });

  it('SHL-5: a null progressTotal renders an indeterminate label with no NaN/null//0', async () => {
    renderScanProgress([
      makeJob({ progressCurrent: 12, progressTotal: null, progressMessage: null }),
    ]);

    const label = await screen.findByText('Working…');
    expect(label.textContent).not.toMatch(/NaN/);
    expect(label.textContent).not.toMatch(/null/);
    expect(label.textContent).not.toMatch(/\/0\b/);
  });

  it('SHL-6: a terminal jobs.progress event (succeeded/failed) returns to rendering nothing', async () => {
    const harness = renderScanProgress([makeJob({ progressCurrent: 420, progressTotal: 1000 })]);
    await screen.findByText('Scanning… 420/1000');

    await act(async () => {
      harness.progressListener?.({
        id: 'job-1',
        jobType: 'scan',
        status: 'succeeded',
        progressCurrent: 1000,
        progressTotal: 1000,
        progressMessage: null,
        message: null,
      });
    });

    await waitFor(() => {
      expect(screen.queryByText(/Scanning/)).toBeNull();
    });
  });

  it('SHL-7: the jobs.progress subscription is torn down on unmount', async () => {
    const invoke = vi.fn((channel: string) => {
      if (channel === 'jobs.list') {
        return Promise.resolve([]);
      }
      return Promise.resolve(undefined);
    });
    const unsubscribe = vi.fn();
    const on = vi.fn(() => unsubscribe);
    window.astrotracker = { invoke, on } as unknown as AstroTrackerBridge;

    const { unmount } = render(<GlobalScanProgress />);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('jobs.list');
    });

    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('SHL-8: uses only jobs.list / jobs.progress via the shared ipc wrapper', async () => {
    const invoke = vi.fn((channel: string) => {
      if (channel === 'jobs.list') {
        return Promise.resolve([]);
      }
      return Promise.resolve(undefined);
    });
    const on = vi.fn(() => vi.fn());
    window.astrotracker = { invoke, on } as unknown as AstroTrackerBridge;

    render(<GlobalScanProgress />);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('jobs.list');
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(on).toHaveBeenCalledWith('jobs.progress', expect.any(Function));
    expect(on).toHaveBeenCalledTimes(1);
  });
});
