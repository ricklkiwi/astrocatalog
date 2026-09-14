import type { AstroTrackerBridge } from '@astrotracker/desktop';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DevPanel } from './DevPanel';

afterEach(() => {
  cleanup();
});

function renderDevPanel(bridge: AstroTrackerBridge) {
  window.astrotracker = bridge;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DevPanel />
    </QueryClientProvider>,
  );
}

function expandPanel() {
  fireEvent.click(screen.getByRole('button', { name: 'Show developer tools' }));
}

describe('DevPanel', () => {
  it('DEV-3: is collapsed by default — no version values or widget headings are in the DOM', () => {
    renderDevPanel({
      invoke: vi.fn(() =>
        Promise.resolve({
          appVersion: '9.9.9-mocked',
          electronVersion: '43.0.0',
          chromeVersion: '142.0.0.1',
          nodeVersion: '22.20.0',
          platform: 'darwin',
          sqliteVersion: '3.46.0',
          sharpVersion: '0.33.0',
        }),
      ),
      on: vi.fn(() => vi.fn()),
    } as unknown as AstroTrackerBridge);

    expect(screen.getByRole('button', { name: 'Show developer tools' })).toBeTruthy();
    for (const value of [
      '9.9.9-mocked',
      '43.0.0',
      '142.0.0.1',
      '22.20.0',
      'darwin',
      '3.46.0',
      '0.33.0',
    ]) {
      expect(screen.queryByText(value)).toBeNull();
    }
    for (const heading of ['Worker demo', 'Watch folders', 'Debug panel']) {
      expect(screen.queryByRole('heading', { name: heading })).toBeNull();
    }
  });

  it('DEV-4: after expanding, renders every field of the app.version payload from the mocked bridge', async () => {
    const invoke = vi.fn((channel: string) => {
      if (channel === 'watchFolders.list') {
        return Promise.resolve({ watchFolders: [] });
      }
      return Promise.resolve({
        appVersion: '9.9.9-mocked',
        electronVersion: '43.0.0',
        chromeVersion: '142.0.0.1',
        nodeVersion: '22.20.0',
        platform: 'darwin',
        sqliteVersion: '3.46.0',
        sharpVersion: '0.33.0',
      });
    });
    renderDevPanel({ invoke, on: vi.fn(() => vi.fn()) } as unknown as AstroTrackerBridge);

    expandPanel();

    expect(await screen.findByText('9.9.9-mocked')).toBeTruthy();
    for (const value of ['43.0.0', '142.0.0.1', '22.20.0', 'darwin', '3.46.0', '0.33.0']) {
      expect(screen.getByText(value)).toBeTruthy();
    }
    expect(invoke).toHaveBeenCalledWith('app.version');
    for (const heading of ['Worker demo', 'Watch folders', 'Debug panel']) {
      expect(screen.getByRole('heading', { name: heading })).toBeTruthy();
    }
  });

  it('DEV-4: surfaces bridge failures instead of rendering a blank screen, once expanded', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('bridge down'));
    renderDevPanel({ invoke, on: vi.fn(() => vi.fn()) } as AstroTrackerBridge);

    expandPanel();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('bridge down');
  });

  it('DEV-4: starts a demo worker job and updates from jobs.progress events, once expanded', async () => {
    let progressListener: ((payload: unknown) => void) | undefined;
    const unsubscribe = vi.fn();
    const invoke = vi.fn((channel: string) => {
      if (channel === 'app.version') {
        return Promise.resolve({
          appVersion: '9.9.9-mocked',
          electronVersion: '43.0.0',
          chromeVersion: '142.0.0.1',
          nodeVersion: '22.20.0',
          platform: 'darwin',
          sqliteVersion: '3.46.0',
          sharpVersion: '0.33.0',
        });
      }
      if (channel === 'jobs.enqueueDemo') {
        return Promise.resolve({ jobId: 'job-1' });
      }
      return Promise.resolve(undefined);
    });
    const on = vi.fn((_channel: string, listener: (payload: unknown) => void) => {
      progressListener = listener;
      return unsubscribe;
    });
    const { unmount } = renderDevPanel({ invoke, on } as unknown as AstroTrackerBridge);

    expandPanel();

    fireEvent.click(await screen.findByRole('button', { name: /start demo job/i }));
    expect(invoke).toHaveBeenCalledWith('jobs.enqueueDemo');
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /cancel/i }).hasAttribute('disabled')).toBe(false);
    });

    await act(async () => {
      progressListener?.({
        id: 'job-1',
        jobType: 'demo',
        status: 'running',
        progressCurrent: 5,
        progressTotal: 10,
        progressMessage: 'step 5/10',
        message: 'step 5/10',
      });
    });
    expect(await screen.findByText('running: 50%')).toBeTruthy();

    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
