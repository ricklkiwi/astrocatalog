import type { AstroTrackerBridge } from '@astrotracker/desktop';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { App } from './App';

function renderApp(bridge: AstroTrackerBridge) {
  window.astrotracker = bridge;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>,
  );
}

describe('App', () => {
  it('renders every field of the app.version payload from the mocked bridge', async () => {
    const invoke = vi.fn().mockResolvedValue({
      appVersion: '9.9.9-mocked',
      electronVersion: '43.0.0',
      chromeVersion: '142.0.0.1',
      nodeVersion: '22.20.0',
      platform: 'darwin',
      sqliteVersion: '3.46.0',
      sharpVersion: '0.33.0',
    });
    renderApp({ invoke } as AstroTrackerBridge);

    expect(await screen.findByText('9.9.9-mocked')).toBeTruthy();
    for (const value of ['43.0.0', '142.0.0.1', '22.20.0', 'darwin', '3.46.0', '0.33.0']) {
      expect(screen.getByText(value)).toBeTruthy();
    }
    expect(invoke).toHaveBeenCalledExactlyOnceWith('app.version');
  });

  it('surfaces bridge failures instead of rendering a blank screen', async () => {
    const invoke = vi.fn().mockRejectedValue(new Error('bridge down'));
    renderApp({ invoke } as AstroTrackerBridge);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('bridge down');
  });
});
