import { HashRouter, Navigate, Route, Routes } from 'react-router';

import { AppShell } from './app/AppShell';
import { CalibrationPage } from './pages/CalibrationPage';
import { DashboardPage } from './pages/DashboardPage';
import { ReviewQueuePage } from './pages/ReviewQueuePage';
import { SessionsPage } from './pages/SessionsPage';
import { SettingsPage } from './pages/SettingsPage';
import { TargetsPage } from './pages/TargetsPage';
import { ThemeProvider } from './theme/ThemeProvider';

/**
 * `ThemeProvider` wraps `HashRouter` (never the reverse) so a theme change
 * never remounts the router or loses route/scroll state. `HashRouter` is
 * required because the packaged app is served over `file://`: a
 * push-state-based history would rewrite the URL to a path that doesn't
 * exist on disk, breaking on reload — `HashRouter` keeps the document part
 * of the URL constant so a reload (dev or packaged) restores the same page
 * from the hash. Paths mirror `app/routes.ts`'s `NAV_ITEMS`. Visiting `/`
 * (or any unrecognised hash) lands on Dashboard.
 */
export function App() {
  return (
    <ThemeProvider>
      <HashRouter>
        <Routes>
          <Route path="/" element={<AppShell />}>
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="targets" element={<TargetsPage />} />
            <Route path="sessions" element={<SessionsPage />} />
            <Route path="calibration" element={<CalibrationPage />} />
            <Route path="review-queue" element={<ReviewQueuePage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>
        </Routes>
      </HashRouter>
    </ThemeProvider>
  );
}
