import { describe, expect, it } from 'vitest';

import { NAV_ITEMS } from './routes';

describe('NAV_ITEMS', () => {
  it('NAV-1: deep-equals the six DD-008 destinations, in order, with no badgeCount set', () => {
    expect(NAV_ITEMS).toEqual([
      { path: '/dashboard', label: 'Dashboard' },
      { path: '/targets', label: 'Targets' },
      { path: '/sessions', label: 'Sessions' },
      { path: '/calibration', label: 'Calibration' },
      { path: '/review-queue', label: 'Review queue' },
      { path: '/settings', label: 'Settings' },
    ]);
  });

  it('NAV-12: no shipped NAV_ITEMS entry supplies a badgeCount', () => {
    expect(NAV_ITEMS.every((item) => item.badgeCount === undefined)).toBe(true);
  });
});
