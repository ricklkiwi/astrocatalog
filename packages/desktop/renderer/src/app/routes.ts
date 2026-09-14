/**
 * The DD-008 six-destination sidebar nav, in V1 Navigation order. This is
 * the single list both the router config (`App.tsx`) and `Sidebar` read, so
 * they cannot drift out of sync with each other.
 */
export interface NavItem {
  path: string;
  label: string;
  /**
   * Optional per-item badge (e.g. Review queue's unresolved-item count,
   * DD-008 §5). A layout seam only — computing a real count is P1-16's job;
   * no item shipped by this issue supplies one.
   */
  badgeCount?: number;
}

export const NAV_ITEMS: NavItem[] = [
  { path: '/dashboard', label: 'Dashboard' },
  { path: '/targets', label: 'Targets' },
  { path: '/sessions', label: 'Sessions' },
  { path: '/calibration', label: 'Calibration' },
  { path: '/review-queue', label: 'Review queue' },
  { path: '/settings', label: 'Settings' },
];
