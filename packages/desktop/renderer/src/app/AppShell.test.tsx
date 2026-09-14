import type { AstroTrackerBridge } from '@astrotracker/desktop';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AppShell } from './AppShell';

beforeEach(() => {
  window.astrotracker = {
    invoke: vi.fn(() => Promise.resolve([])),
    on: vi.fn(() => vi.fn()),
  } as unknown as AstroTrackerBridge;
});

afterEach(() => {
  cleanup();
});

function renderShellAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<AppShell />}>
          <Route path="dashboard" element={<p>Dashboard content</p>} />
          <Route path="targets" element={<p>Targets content</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
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
});
