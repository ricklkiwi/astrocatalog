import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ThemeProvider, useTheme } from './ThemeProvider';

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
