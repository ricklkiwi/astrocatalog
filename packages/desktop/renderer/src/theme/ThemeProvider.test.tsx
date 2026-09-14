import type { AstroTrackerBridge } from '@astrotracker/desktop';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppShell } from '../app/AppShell';
import { DashboardPage } from '../pages/DashboardPage';
import { ThemeProvider, useTheme } from './ThemeProvider';
import type { Theme } from './ThemeProvider';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function ThemeReadout() {
  const { theme } = useTheme();
  return <span data-testid="theme-readout">{theme}</span>;
}

describe('ThemeProvider', () => {
  it('renders exactly one .app-root element carrying data-theme, and useTheme() exposes it', () => {
    const { container } = render(
      <ThemeProvider theme="light">
        <ThemeReadout />
      </ThemeProvider>,
    );

    const roots = container.querySelectorAll('.app-root');
    expect(roots).toHaveLength(1);
    expect(roots[0]?.getAttribute('data-theme')).toBe('light');
    expect(container.querySelector('[data-testid="theme-readout"]')?.textContent).toBe('light');
  });

  it('defaults to the literal "dark" theme with no theme prop, and never reads prefers-color-scheme', () => {
    const matchMediaSpy = vi.fn();
    vi.stubGlobal('matchMedia', matchMediaSpy);

    const { container } = render(
      <ThemeProvider>
        <p>content</p>
      </ThemeProvider>,
    );

    expect(container.querySelector('.app-root')?.getAttribute('data-theme')).toBe('dark');
    expect(matchMediaSpy).not.toHaveBeenCalled();
  });

  it('useTheme() exposes a setTheme seam (uncalled by any rendered control in this issue)', () => {
    let captured: ReturnType<typeof useTheme> | undefined;
    function Capture() {
      captured = useTheme();
      return null;
    }
    render(
      <ThemeProvider theme="dark">
        <Capture />
      </ThemeProvider>,
    );

    expect(captured?.theme).toBe('dark');
    expect(typeof captured?.setTheme).toBe('function');
  });

  it('matches a committed DOM snapshot for the dark theme', () => {
    const { container } = render(
      <ThemeProvider theme="dark">
        <p>Dashboard</p>
      </ThemeProvider>,
    );
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('matches a committed DOM snapshot for the light theme', () => {
    const { container } = render(
      <ThemeProvider theme="light">
        <p>Dashboard</p>
      </ThemeProvider>,
    );
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('matches a committed DOM snapshot for the red-night-vision theme', () => {
    const { container } = render(
      <ThemeProvider theme="red-night-vision">
        <p>Dashboard</p>
      </ThemeProvider>,
    );
    expect(container.innerHTML).toMatchSnapshot();
  });
});

/** Renders the shell + a real page under one theme, isolated from `App.tsx`
 * (which hardcodes 'dark') so every theme can be exercised directly via
 * `ThemeProvider`'s `theme` prop. */
function renderShellUnderTheme(theme: Theme) {
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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={theme}>
        <MemoryRouter initialEntries={['/dashboard']}>
          <Routes>
            <Route path="/" element={<AppShell />}>
              <Route path="dashboard" element={<DashboardPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('THM-4: theme-invariant DOM', () => {
  it('the same shell + page subtree serialises byte-identical across all three themes (data-theme aside)', async () => {
    const dark = renderShellUnderTheme('dark');
    await screen.findByRole('heading', { name: 'Dashboard' });
    const darkHtml = dark.container.innerHTML.replace(/data-theme="[^"]+"/, 'data-theme="T"');
    dark.unmount();

    const light = renderShellUnderTheme('light');
    await screen.findByRole('heading', { name: 'Dashboard' });
    const lightHtml = light.container.innerHTML.replace(/data-theme="[^"]+"/, 'data-theme="T"');
    light.unmount();

    const redNightVision = renderShellUnderTheme('red-night-vision');
    await screen.findByRole('heading', { name: 'Dashboard' });
    const redNightVisionHtml = redNightVision.container.innerHTML.replace(
      /data-theme="[^"]+"/,
      'data-theme="T"',
    );
    redNightVision.unmount();

    expect(lightHtml).toBe(darkHtml);
    expect(redNightVisionHtml).toBe(darkHtml);
  });
});
