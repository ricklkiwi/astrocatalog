/**
 * P1-13a acceptance E2E: the packaged app's DD-008 sidebar shell navigates
 * between all six destinations — each sidebar link is clicked in turn, the
 * matching placeholder page renders, and active-item indication
 * (`aria-current="page"`) moves to the clicked link and only that link.
 */
import { expect, test } from './fixtures.js';

const DESTINATIONS = [
  'Dashboard',
  'Targets',
  'Sessions',
  'Calibration',
  'Review queue',
  'Settings',
] as const;

test('sidebar navigates between all six destinations, updating aria-current', async ({
  electronApp,
}) => {
  const page = await electronApp.app.firstWindow();
  const nav = page.getByRole('navigation');

  // Asserted before navigating so a seventh destination cannot slip past a
  // hardcoded six-item loop below.
  await expect(nav.getByRole('link')).toHaveCount(6);

  for (const label of DESTINATIONS) {
    await nav.getByRole('link', { name: label }).click();

    await expect(page.getByRole('heading', { name: label })).toBeVisible();

    const clickedLink = nav.getByRole('link', { name: label });
    await expect(clickedLink).toHaveAttribute('aria-current', 'page');
    // Exactly one — the previously-active link must have lost it.
    await expect(page.locator('[aria-current="page"]')).toHaveCount(1);
  }
});
