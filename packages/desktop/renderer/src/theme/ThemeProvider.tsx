import { createContext, useContext, useMemo, useState } from 'react';

import type { ReactNode } from 'react';

import './tokens.css';

/** The three DD-008 themes. Dark is the literal default — never derived
 * from `prefers-color-scheme` (DD-008 says "dark theme default," not "match
 * the OS"). */
export type Theme = 'dark' | 'light' | 'red-night-vision';

export interface ThemeContextValue {
  theme: Theme;
  /**
   * Seam for a later issue (P1-32) to wire a real theme-switch control to.
   * Nothing in this issue calls it from a rendered control — theme
   * persistence and the user-facing switch are explicitly out of scope here.
   */
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  theme?: Theme;
  children?: ReactNode;
}

/**
 * Renders the single themed root element (`className="app-root"`,
 * `data-theme={theme}`) that `theme/tokens.css` scopes every custom property
 * to, and exposes `useTheme()` to the subtree below it. Themes apply purely
 * by which CSS custom properties resolve under this element's `data-theme`
 * attribute — no component below ever needs to branch on `theme` in
 * TypeScript to render different colours.
 */
export function ThemeProvider({ theme: controlledTheme, children }: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(controlledTheme ?? 'dark');

  const value = useMemo<ThemeContextValue>(() => ({ theme, setTheme }), [theme]);

  return (
    <ThemeContext.Provider value={value}>
      <div className="app-root" data-theme={theme}>
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === null) {
    throw new Error('useTheme() must be called within a <ThemeProvider>.');
  }
  return value;
}
