import type { AstroTrackerBridge, WatchFolderRecord } from '@astrotracker/desktop';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WatchFolders } from './WatchFolders';

afterEach(() => {
  cleanup();
});

function makeFolder(overrides: Partial<WatchFolderRecord> = {}): WatchFolderRecord {
  return {
    id: 'wf-1',
    path: '/mnt/astro',
    driveLabel: null,
    isActive: true,
    lastScanAt: null,
    skipPatterns: null,
    liveWatchEnabled: false,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

function renderWatchFolders(bridge: AstroTrackerBridge) {
  window.astrotracker = bridge;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WatchFolders />
    </QueryClientProvider>,
  );
}

describe('WatchFolders', () => {
  it('lists the watch folders returned by watchFolders.list', async () => {
    const invoke = vi.fn((channel: string) => {
      if (channel === 'watchFolders.list') {
        return Promise.resolve({
          watchFolders: [makeFolder({ path: '/mnt/astro', driveLabel: 'External SSD' })],
        });
      }
      return Promise.resolve(undefined);
    });
    renderWatchFolders({ invoke, on: vi.fn(() => vi.fn()) } as unknown as AstroTrackerBridge);

    expect(await screen.findByText('/mnt/astro')).toBeTruthy();
    expect(screen.getByText('(External SSD)')).toBeTruthy();
  });

  it('adds a folder and refetches the list', async () => {
    const folders: WatchFolderRecord[] = [];
    const invoke = vi.fn((channel: string, input?: unknown) => {
      if (channel === 'watchFolders.list') {
        return Promise.resolve({ watchFolders: [...folders] });
      }
      if (channel === 'watchFolders.add') {
        const added = makeFolder({ id: 'wf-new', path: (input as { path: string }).path });
        folders.push(added);
        return Promise.resolve(added);
      }
      return Promise.resolve(undefined);
    });
    renderWatchFolders({ invoke, on: vi.fn(() => vi.fn()) } as unknown as AstroTrackerBridge);

    expect(await screen.findByText('No watch folders configured yet.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Folder path'), {
      target: { value: '/mnt/new-drive' },
    });
    fireEvent.click(screen.getByRole('button', { name: /add folder/i }));

    // The new row appearing proves both the add call and the list refetch.
    expect(await screen.findByText('/mnt/new-drive')).toBeTruthy();
    expect(invoke).toHaveBeenCalledWith('watchFolders.add', { path: '/mnt/new-drive' });
  });

  it('surfaces an add error without adding a row', async () => {
    const invoke = vi.fn((channel: string) => {
      if (channel === 'watchFolders.list') {
        return Promise.resolve({ watchFolders: [] });
      }
      if (channel === 'watchFolders.add') {
        return Promise.reject(new Error('Watch-folder path is not a directory: /nope'));
      }
      return Promise.resolve(undefined);
    });
    renderWatchFolders({ invoke, on: vi.fn(() => vi.fn()) } as unknown as AstroTrackerBridge);

    await screen.findByText('No watch folders configured yet.');
    fireEvent.change(screen.getByLabelText('Folder path'), { target: { value: '/nope' } });
    fireEvent.click(screen.getByRole('button', { name: /add folder/i }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('not a directory');
  });

  it('starts a scan and reflects jobs.progress events for that folder', async () => {
    let progressListener: ((payload: unknown) => void) | undefined;
    const unsubscribe = vi.fn();
    const invoke = vi.fn((channel: string) => {
      if (channel === 'watchFolders.list') {
        return Promise.resolve({ watchFolders: [makeFolder()] });
      }
      if (channel === 'jobs.enqueueScan') {
        return Promise.resolve({ jobId: 'scan-1' });
      }
      return Promise.resolve(undefined);
    });
    const on = vi.fn((channel: string, listener: (payload: unknown) => void) => {
      if (channel === 'jobs.progress') {
        progressListener = listener;
      }
      return unsubscribe;
    });
    const { unmount } = renderWatchFolders({ invoke, on } as unknown as AstroTrackerBridge);

    fireEvent.click(await screen.findByRole('button', { name: /scan now/i }));
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('jobs.enqueueScan', { watchFolderId: 'wf-1' });
    });

    await act(async () => {
      progressListener?.({
        id: 'scan-1',
        jobType: 'scan',
        status: 'running',
        progressCurrent: 3,
        progressTotal: 6,
        progressMessage: 'scanning',
        message: 'scanning',
      });
    });
    expect(await screen.findByText('running: 50%')).toBeTruthy();

    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('removes a folder via watchFolders.remove', async () => {
    const folders: WatchFolderRecord[] = [makeFolder({ id: 'wf-x', path: '/mnt/remove-me' })];
    const invoke = vi.fn((channel: string, input?: unknown) => {
      if (channel === 'watchFolders.list') {
        return Promise.resolve({ watchFolders: [...folders] });
      }
      if (channel === 'watchFolders.remove') {
        const { id } = input as { id: string };
        const index = folders.findIndex((f) => f.id === id);
        if (index >= 0) {
          folders.splice(index, 1);
        }
        return Promise.resolve({ removed: true });
      }
      return Promise.resolve(undefined);
    });
    renderWatchFolders({ invoke, on: vi.fn(() => vi.fn()) } as unknown as AstroTrackerBridge);

    expect(await screen.findByText('/mnt/remove-me')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));

    await waitFor(() => {
      expect(screen.queryByText('/mnt/remove-me')).toBeNull();
    });
    expect(invoke).toHaveBeenCalledWith('watchFolders.remove', { id: 'wf-x' });
  });

  it('toggles live watch via watchFolders.setLiveWatch with the correct input', async () => {
    const folders: WatchFolderRecord[] = [makeFolder({ id: 'wf-1', liveWatchEnabled: false })];
    const invoke = vi.fn((channel: string, input?: unknown) => {
      if (channel === 'watchFolders.list') {
        return Promise.resolve({ watchFolders: [...folders] });
      }
      if (channel === 'watchFolders.setLiveWatch') {
        const { id, enabled } = input as { id: string; enabled: boolean };
        const folder = folders.find((f) => f.id === id);
        if (folder !== undefined) {
          folder.liveWatchEnabled = enabled;
        }
        return Promise.resolve(folder);
      }
      return Promise.resolve(undefined);
    });
    renderWatchFolders({ invoke, on: vi.fn(() => vi.fn()) } as unknown as AstroTrackerBridge);

    fireEvent.click(await screen.findByRole('button', { name: /enable live watch/i }));

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('watchFolders.setLiveWatch', {
        id: 'wf-1',
        enabled: true,
      });
    });
    // The list is refetched, flipping the button's label to the "on" state.
    expect(await screen.findByRole('button', { name: /disable live watch/i })).toBeTruthy();
  });

  it.each([
    ['off', false, undefined, 'Live watch: off'],
    ['watching', true, { mode: 'watching', message: null }, 'Live watch: watching'],
    [
      'fallback',
      true,
      { mode: 'fallback', message: 'EMFILE: too many open files' },
      'Live watch: fallback — EMFILE: too many open files',
    ],
  ] as const)(
    'renders the "%s" status text for the corresponding WatchMode',
    async (_label, liveWatchEnabled, eventOverrides, expectedText) => {
      let statusListener: ((payload: unknown) => void) | undefined;
      const invoke = vi.fn((channel: string) => {
        if (channel === 'watchFolders.list') {
          return Promise.resolve({
            watchFolders: [makeFolder({ id: 'wf-1', liveWatchEnabled })],
          });
        }
        return Promise.resolve(undefined);
      });
      const on = vi.fn((channel: string, listener: (payload: unknown) => void) => {
        if (channel === 'watch.status') {
          statusListener = listener;
        }
        return vi.fn();
      });
      renderWatchFolders({ invoke, on } as unknown as AstroTrackerBridge);

      await screen.findByText('/mnt/astro');

      if (eventOverrides !== undefined) {
        await act(async () => {
          statusListener?.({
            watchFolderId: 'wf-1',
            updatedAt: '2026-07-22T10:00:00.000Z',
            ...eventOverrides,
          });
        });
      }

      expect(await screen.findByText(expectedText)).toBeTruthy();
    },
  );

  it('a watch.status event for one folder updates only that folder’s row', async () => {
    let statusListener: ((payload: unknown) => void) | undefined;
    const invoke = vi.fn((channel: string) => {
      if (channel === 'watchFolders.list') {
        return Promise.resolve({
          watchFolders: [
            makeFolder({ id: 'wf-1', path: '/mnt/one', liveWatchEnabled: true }),
            makeFolder({ id: 'wf-2', path: '/mnt/two', liveWatchEnabled: true }),
          ],
        });
      }
      return Promise.resolve(undefined);
    });
    const on = vi.fn((channel: string, listener: (payload: unknown) => void) => {
      if (channel === 'watch.status') {
        statusListener = listener;
      }
      return vi.fn();
    });
    renderWatchFolders({ invoke, on } as unknown as AstroTrackerBridge);

    await screen.findByText('/mnt/one');
    await screen.findByText('/mnt/two');
    expect(screen.getAllByText('Live watch: watching')).toHaveLength(2);

    await act(async () => {
      statusListener?.({
        watchFolderId: 'wf-1',
        mode: 'fallback',
        message: 'EMFILE',
        updatedAt: '2026-07-22T10:00:00.000Z',
      });
    });

    expect(await screen.findByText('Live watch: fallback — EMFILE')).toBeTruthy();
    // wf-2's row is untouched.
    expect(screen.getAllByText('Live watch: watching')).toHaveLength(1);
  });
});
