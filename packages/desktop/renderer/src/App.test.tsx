import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AstroTrackerBridge } from '@astrotracker/desktop';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { App } from './App';
import { NAV_ITEMS } from './app/routes';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));

function mockBridge(): AstroTrackerBridge {
  const invoke = vi.fn((channel: string) => {
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
  });
  return { invoke, on: vi.fn(() => vi.fn()) } as unknown as AstroTrackerBridge;
}

function renderApp() {
  window.astrotracker = mockBridge();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  window.location.hash = '';
});

afterEach(() => {
  cleanup();
});

describe('App', () => {
  it('NAV-9: renders the Dashboard placeholder by default (no hash)', async () => {
    renderApp();
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy();
  });

  it('NAV-10: an unknown hash lands on Dashboard with a non-empty content area', async () => {
    window.location.hash = '#/nonexistent';
    renderApp();

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy();
  });

  it('THM-6: .app-root is a DOM ancestor of the router-rendered <nav> (ThemeProvider wraps HashRouter)', async () => {
    const { container } = renderApp();
    await screen.findByRole('heading', { name: 'Dashboard' });

    const appRoot = container.querySelector('.app-root');
    const nav = container.querySelector('nav');
    expect(appRoot).not.toBeNull();
    expect(nav).not.toBeNull();
    expect(appRoot?.contains(nav)).toBe(true);
  });

  it('clicking a Sidebar link navigates and moves aria-current to the clicked link', async () => {
    const { container } = renderApp();
    await screen.findByRole('heading', { name: 'Dashboard' });

    fireEvent.click(screen.getByRole('link', { name: 'Targets' }));

    expect(await screen.findByRole('heading', { name: 'Targets' })).toBeTruthy();
    const current = container.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toBe('Targets');
  });

  it.each(NAV_ITEMS)(
    'NAV-3: the $label sidebar link resolves to the $label placeholder',
    async ({ label }) => {
      renderApp();
      await screen.findByRole('heading', { name: 'Dashboard' });

      fireEvent.click(screen.getByRole('link', { name: label }));

      expect(await screen.findByRole('heading', { name: label })).toBeTruthy();
    },
  );

  it('NAV-4: every nested <Route path> in App.tsx is exactly NAV_ITEMS plus the index route and the catch-all', () => {
    const appTsxPath = path.join(THIS_DIR, 'App.tsx');
    const source = readFileSync(appTsxPath, 'utf8').replace(/\r\n/g, '\n');

    const declaredPaths = new Set<string>();
    const pathPattern = /<Route\s+[^>]*\bpath="([^"]+)"/g;
    let match: RegExpExecArray | null;
    while ((match = pathPattern.exec(source)) !== null) {
      const [, value] = match;
      if (value !== undefined) {
        declaredPaths.add(value);
      }
    }

    const hasIndexRoute = /<Route\s+index\b/.test(source);

    const expectedPaths = new Set<string>([
      '/',
      '*',
      ...NAV_ITEMS.map((item) => item.path.replace(/^\//, '')),
    ]);

    expect([...declaredPaths].sort()).toEqual([...expectedPaths].sort());
    expect(hasIndexRoute).toBe(true);
  });

  it('NAV-11: imports HashRouter from react-router, never BrowserRouter/MemoryRouter', () => {
    const appTsxPath = path.join(THIS_DIR, 'App.tsx');
    const source = readFileSync(appTsxPath, 'utf8');

    expect(source).toMatch(/from ['"]react-router['"]/);
    expect(source).toContain('HashRouter');
    expect(source).not.toContain('BrowserRouter');
    expect(source).not.toContain('MemoryRouter');
  });
});
