import type { AstroTrackerBridge } from '@astrotracker/desktop';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DebugPanel } from './DebugPanel';

afterEach(() => {
  cleanup();
});

type Listener = (payload: unknown) => void;

function renderDebugPanel(): { listeners: Map<string, Listener> } {
  const listeners = new Map<string, Listener>();
  const on = vi.fn((channel: string, listener: Listener) => {
    listeners.set(channel, listener);
    return vi.fn();
  });
  window.astrotracker = { invoke: vi.fn(), on } as unknown as AstroTrackerBridge;
  render(<DebugPanel />);
  return { listeners };
}

describe('DebugPanel', () => {
  it('is collapsed by default, with a button to show it', () => {
    renderDebugPanel();

    expect(screen.getByRole('button', { name: 'Show debug panel' })).toBeTruthy();
    expect(screen.queryByLabelText('Watch and scan activity log')).toBeNull();
  });

  it('shows a placeholder message when opened with no activity yet', () => {
    renderDebugPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Show debug panel' }));

    expect(
      screen.getByText(
        'No activity yet — drop a file into a watched folder or run a scan to see it here.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Hide debug panel' })).toBeTruthy();
  });

  it('renders a watch.activity event as a formatted log line', () => {
    const { listeners } = renderDebugPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Show debug panel' }));

    act(() => {
      listeners.get('watch.activity')?.({
        watchFolderId: 'wf-1234567890',
        kind: 'fs-event',
        detail: 'add: /mnt/astro/a.fits',
        timestamp: '2026-07-26T10:00:00.000Z',
      });
    });

    expect(screen.getByText(/\[watch wf-12345\] add: \/mnt\/astro\/a\.fits/)).toBeTruthy();
  });

  it('renders a watch.status event as a formatted log line, including the message when present', () => {
    const { listeners } = renderDebugPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Show debug panel' }));

    act(() => {
      listeners.get('watch.status')?.({
        watchFolderId: 'wf-1234567890',
        mode: 'fallback',
        message: 'EMFILE',
        updatedAt: '2026-07-26T10:00:00.000Z',
      });
    });

    expect(screen.getByText(/\[watch wf-12345\] status → fallback: EMFILE/)).toBeTruthy();
  });

  it('renders a jobs.progress event as a formatted log line', () => {
    const { listeners } = renderDebugPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Show debug panel' }));

    act(() => {
      listeners.get('jobs.progress')?.({
        id: 'job-1234567890',
        jobType: 'scan',
        status: 'running',
        progressCurrent: 5,
        progressTotal: 20,
        progressMessage: null,
        message: 'discovering files',
      });
    });

    expect(screen.getByText(/\[job job-1234\] running \(5\/20\) — discovering files/)).toBeTruthy();
  });

  it('shows the newest event first', () => {
    const { listeners } = renderDebugPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Show debug panel' }));

    act(() => {
      listeners.get('watch.status')?.({
        watchFolderId: 'wf-1',
        mode: 'watching',
        message: null,
        updatedAt: '2026-07-26T10:00:00.000Z',
      });
    });
    act(() => {
      listeners.get('watch.status')?.({
        watchFolderId: 'wf-1',
        mode: 'off',
        message: null,
        updatedAt: '2026-07-26T10:00:01.000Z',
      });
    });

    const items = screen.getAllByRole('listitem');
    expect(items[0]?.textContent).toContain('status → off');
    expect(items[1]?.textContent).toContain('status → watching');
  });

  it('subscribes to all three event channels regardless of open/closed state, so no activity is lost while collapsed', () => {
    const { listeners } = renderDebugPanel();
    // Panel starts closed — fire an event before ever opening it.
    act(() => {
      listeners.get('watch.activity')?.({
        watchFolderId: 'wf-1',
        kind: 'fs-event',
        detail: 'add: /mnt/astro/a.fits',
        timestamp: '2026-07-26T10:00:00.000Z',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Show debug panel' }));

    expect(screen.getByText(/add: \/mnt\/astro\/a\.fits/)).toBeTruthy();
  });

  it('clears the log when Clear is clicked', () => {
    const { listeners } = renderDebugPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Show debug panel' }));

    act(() => {
      listeners.get('watch.activity')?.({
        watchFolderId: 'wf-1',
        kind: 'fs-event',
        detail: 'add: /mnt/astro/a.fits',
        timestamp: '2026-07-26T10:00:00.000Z',
      });
    });
    expect(screen.getByText(/add: \/mnt\/astro\/a\.fits/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect(screen.queryByText(/add: \/mnt\/astro\/a\.fits/)).toBeNull();
    expect(
      screen.getByText(
        'No activity yet — drop a file into a watched folder or run a scan to see it here.',
      ),
    ).toBeTruthy();
  });

  it('caps the log at 300 entries, dropping the oldest', () => {
    const { listeners } = renderDebugPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Show debug panel' }));

    act(() => {
      for (let i = 0; i < 305; i += 1) {
        listeners.get('watch.activity')?.({
          watchFolderId: 'wf-1',
          kind: 'fs-event',
          detail: `add: /mnt/astro/f${i}.fits`,
          timestamp: '2026-07-26T10:00:00.000Z',
        });
      }
    });

    expect(screen.getAllByRole('listitem')).toHaveLength(300);
    // Newest-first: the very last emitted event (f304) survives; the earliest
    // five (f0..f4) were evicted by the 300-entry cap.
    expect(screen.getByText(/f304\.fits/)).toBeTruthy();
    expect(screen.queryByText(/f0\.fits/)).toBeNull();
  });
});
