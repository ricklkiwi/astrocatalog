import type { AstroTrackerBridge } from '@astrotracker/desktop';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppShell } from './AppShell';

beforeEach(() => {
  window.astrotracker = {
    invoke: vi.fn((channel: string) => {
      if (channel === 'watchFolders.list') {
        return Promise.resolve({ watchFolders: [] });
      }
      if (channel === 'jobs.list') {
        return Promise.resolve([]);
      }
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
      return Promise.resolve(undefined);
    }),
    on: vi.fn(() => vi.fn()),
  } as unknown as AstroTrackerBridge;
});

afterEach(() => {
  cleanup();
});

function renderShellAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route path="dashboard" element={<p>Dashboard content</p>} />
            <Route path="targets" element={<p>Targets content</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AppShell', () => {
  it('SHL-1: renders the brand mark as a heading, the sidebar, a header row, and the routed content', async () => {
    renderShellAt('/dashboard');

    expect(screen.getByRole('heading', { name: 'AstroTracker' })).toBeTruthy();
    expect(screen.getByRole('navigation')).toBeTruthy();
    expect(screen.getAllByRole('link')).toHaveLength(6);
    expect(await screen.findByText('Dashboard content')).toBeTruthy();
  });

  it('shows the current page title in the header row, updating per route', async () => {
    renderShellAt('/dashboard');
    expect(await screen.findByText('Dashboard content')).toBeTruthy();
    expect(screen.getByText('Dashboard', { selector: 'p' })).toBeTruthy();

    cleanup();
    renderShellAt('/targets');
    expect(await screen.findByText('Targets content')).toBeTruthy();
    expect(screen.getByText('Targets', { selector: 'p' })).toBeTruthy();
  });

  it('DEV-5: mounts DevPanel once, so its toggle is present on every route', async () => {
    renderShellAt('/dashboard');
    expect(await screen.findByText('Dashboard content')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show developer tools' })).toBeTruthy();

    cleanup();
    renderShellAt('/targets');
    expect(await screen.findByText('Targets content')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show developer tools' })).toBeTruthy();
  });
});
