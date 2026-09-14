import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { CalibrationPage } from './CalibrationPage';
import { DashboardPage } from './DashboardPage';
import { ReviewQueuePage } from './ReviewQueuePage';
import { SessionsPage } from './SessionsPage';
import { SettingsPage } from './SettingsPage';
import { TargetsPage } from './TargetsPage';

afterEach(() => {
  cleanup();
});

const PAGES = [
  { name: 'DashboardPage', Component: DashboardPage, title: 'Dashboard' },
  { name: 'TargetsPage', Component: TargetsPage, title: 'Targets' },
  { name: 'SessionsPage', Component: SessionsPage, title: 'Sessions' },
  { name: 'CalibrationPage', Component: CalibrationPage, title: 'Calibration' },
  { name: 'ReviewQueuePage', Component: ReviewQueuePage, title: 'Review queue' },
  { name: 'SettingsPage', Component: SettingsPage, title: 'Settings' },
] as const;

describe('page components', () => {
  it.each(PAGES)('$name renders a "$title" heading via PlaceholderPage', ({ Component, title }) => {
    render(<Component />);
    expect(screen.getByRole('heading', { name: title })).toBeTruthy();
  });
});
