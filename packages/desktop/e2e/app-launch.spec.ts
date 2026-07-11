/**
 * The P0-08 smoke spec: the packaged app boots, exactly one window opens
 * with the right title, and the demo `app.version` IPC round trip returns
 * real data through renderer → preload → main — including live SQLite and
 * sharp versions, proving the native modules were rebuilt against the
 * correct Electron ABI inside the asar-unpacked artifact (the class of bug
 * P0-03's plain-Node unit smoke cannot catch).
 */
import type { AppVersionInfo, AstroTrackerBridge } from '../src/ipc/contract.js';
import { expect, test } from './fixtures.js';

/** The preload's one exposed global, as visible inside `page.evaluate`. */
declare const window: { astrotracker: AstroTrackerBridge };

test('packaged app boots with one titled window and a live IPC round trip', async ({
  electronApp,
}) => {
  const page = await electronApp.app.firstWindow();

  // Exactly one window — the app is single-window by design (P0-03).
  expect(electronApp.app.windows()).toHaveLength(1);

  // Title comes from renderer/index.html's <title>.
  expect(await page.title()).toBe('AstroTracker');

  // Full renderer → preload → main round trip over the typed IPC contract.
  const version: AppVersionInfo = await page.evaluate(() =>
    window.astrotracker.invoke('app.version'),
  );

  for (const key of [
    'appVersion',
    'electronVersion',
    'chromeVersion',
    'nodeVersion',
    'platform',
  ] as const) {
    expect(version[key], `${key} should be a non-empty string`).toEqual(expect.any(String));
    expect(version[key], `${key} should be a non-empty string`).not.toBe('');
  }

  // Native-module proof: 'unknown' is register.ts's absent-version fallback —
  // a real packaged run must report the live SQLite/sharp versions.
  for (const key of ['sqliteVersion', 'sharpVersion'] as const) {
    expect(version[key], `${key} should be a real native-module version`).toEqual(
      expect.any(String),
    );
    expect(version[key], `${key} should be a real native-module version`).not.toBe('');
    expect(version[key], `${key} should be a real native-module version`).not.toBe('unknown');
  }
});
