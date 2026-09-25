/**
 * Table-driven tests for `detectEquipmentProfiles()` (P1-18).
 *
 * Test-only fs access to read the committed manifest corpus is not
 * domain-logic I/O (DD-002 rule 1 governs production code; `detect.ts`
 * itself never touches fs) — same pattern as `raw/fixtures.test.ts`.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { cameraInstrument } from '../../raw/index.js';
import { detectEquipmentProfiles } from './detect.js';
import type { EquipmentIdentityInput } from './types.js';

const FIXTURES_ROOT = new URL('../../../../../fixtures/', import.meta.url);

interface ManifestEntry {
  file: string;
  format: 'fits' | 'xisf' | 'raw';
  expected: {
    status: 'ok' | 'error';
    keywords?: Record<string, unknown>;
  };
}

function loadManifest(set: string): ManifestEntry[] {
  const parsed = JSON.parse(
    readFileSync(new URL(`${set}/manifest.json`, FIXTURES_ROOT), 'utf8'),
  ) as { entries: ManifestEntry[] };
  return parsed.entries;
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function toNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

/** Maps one ok-status manifest entry to an equipment-identity input, per DET-4. */
function toIdentityInput(entry: ManifestEntry): EquipmentIdentityInput {
  const kw = entry.expected.keywords ?? {};
  if (entry.format === 'raw') {
    return {
      telescopeRaw: null,
      cameraRaw: cameraInstrument(toStringOrNull(kw['Make']), toStringOrNull(kw['Model'])),
      focalLength: null,
    };
  }
  return {
    telescopeRaw: toStringOrNull(kw['TELESCOP']),
    cameraRaw: toStringOrNull(kw['INSTRUME']),
    focalLength: toNumberOrNull(kw['FOCALLEN']),
  };
}

function fixtureInputs(): EquipmentIdentityInput[] {
  const entries = [...loadManifest('fits'), ...loadManifest('xisf'), ...loadManifest('raw')];
  return entries.filter((e) => e.expected.status === 'ok').map(toIdentityInput);
}

describe('detectEquipmentProfiles — grouping and counts (DET-1)', () => {
  it('groups by matchKey, not raw telescopeRaw, and counts rows per identity', () => {
    const inputs: EquipmentIdentityInput[] = [
      { telescopeRaw: 'Gme28', cameraRaw: 'ZWO ASI533MC Pro', focalLength: 336.0 },
      { telescopeRaw: "'Gme28'", cameraRaw: 'ZWO ASI533MC Pro', focalLength: 336 },
      { telescopeRaw: 'Gme28  ', cameraRaw: 'ZWO ASI533MC Pro', focalLength: 335.88495 },
      { telescopeRaw: 'Gme28', cameraRaw: 'ZWO ASI533MC Pro', focalLength: 420 },
      { telescopeRaw: 'Gme28', cameraRaw: 'ZWO ASI533MC Pro', focalLength: 420 },
      { telescopeRaw: null, cameraRaw: null, focalLength: null },
    ];

    const profiles = detectEquipmentProfiles(inputs);
    expect(profiles).toHaveLength(2);
    const counts = profiles.map((p) => p.frameCount).sort((a, b) => a - b);
    expect(counts).toEqual([2, 3]);
    const at336 = profiles.find((p) => p.focalLengthMm === 336);
    const at420 = profiles.find((p) => p.focalLengthMm === 420);
    expect(at336?.frameCount).toBe(3);
    expect(at420?.frameCount).toBe(2);
  });
});

describe('detectEquipmentProfiles — order independence (DET-2)', () => {
  it('produces deep-equal, matchKey-sorted output regardless of input order', () => {
    const inputs: EquipmentIdentityInput[] = [
      { telescopeRaw: 'Gme28', cameraRaw: 'ZWO ASI533MC Pro', focalLength: 336.0 },
      { telescopeRaw: "'Gme28'", cameraRaw: 'ZWO ASI533MC Pro', focalLength: 336 },
      { telescopeRaw: 'Gme28  ', cameraRaw: 'ZWO ASI533MC Pro', focalLength: 335.88495 },
      { telescopeRaw: 'Gme28', cameraRaw: 'ZWO ASI533MC Pro', focalLength: 420 },
      { telescopeRaw: 'Gme28', cameraRaw: 'ZWO ASI533MC Pro', focalLength: 420 },
    ];

    const forward = detectEquipmentProfiles(inputs);
    const reversed = detectEquipmentProfiles([...inputs].reverse());
    expect(reversed).toEqual(forward);

    const keys = forward.map((p) => p.matchKey);
    expect(keys).toEqual([...keys].sort());
  });
});

describe('detectEquipmentProfiles — normalized components, not raw copy (DET-3)', () => {
  it('stores the normalized identity even when the first-seen row is the quoted/unrounded one', () => {
    const inputs: EquipmentIdentityInput[] = [
      // First-seen row for this identity is the quoted, unrounded one —
      // pinned so the mutation (copying raw telescopeRaw) is not blind.
      { telescopeRaw: "'Gme28'", cameraRaw: 'ZWO ASI533MC Pro', focalLength: 335.88495 },
      { telescopeRaw: 'Gme28', cameraRaw: 'ZWO ASI533MC Pro', focalLength: 336 },
    ];

    const [profile] = detectEquipmentProfiles(inputs);
    expect(profile?.telescope).toBe('Gme28');
    expect(profile?.focalLengthMm).toBe(336);
    expect(profile?.name).toBe('Gme28 + ZWO ASI533MC Pro @ 336 mm');
  });
});

describe('detectEquipmentProfiles — fixture corpus (DET-4)', () => {
  /**
   * Verified directly against the committed manifests (2026-09-23): the
   * spec's Test Hints claims "the ok-status manifest entries carry no
   * FOCALLEN, so every expected focal is null" and lists "GSO RC8 +
   * QHY268M" once among seven full-train profiles (19 total).
   *
   * That is factually wrong against the actual corpus:
   * fixtures/fits/manifest.json's sgpro-light-precision-timestamps.fits
   * entry carries `"FOCALLEN": 800`, while sgpro-light-sexagesimal.fits
   * (same TELESCOP='GSO RC8'/INSTRUME='QHY268M') carries no FOCALLEN at
   * all. Per the identity rules above (a reducer/different focal length is
   * a different optical train, ID-11), these are legitimately two distinct
   * profiles — exactly the "RC8 + QHY268M @ 800 and RC8 + QHY268M @ null
   * as two profiles" case the plan's own Design section calls out for
   * Step 3, and exactly the SUG-12 worked example in suggest.test.ts. So
   * this is 8 full-train profiles, not 7, and 20 total, not 19. See the
   * Coder's final report for this flagged as a spec Test Hints defect
   * rather than a silent deviation.
   */
  const EXPECTED_FULL_TRAIN: Array<[string, string, number | null]> = [
    ['Sky-Watcher Esprit 100ED', 'ZWO ASI2600MM Pro', null],
    ['Sky-Watcher Esprit 100ED', 'ZWO ASI2600MC Pro', null],
    ['GSO RC8', 'QHY268M', 800],
    ['GSO RC8', 'QHY268M', null],
    ['SkyWatcher 200PDS', 'Canon EOS 6D', null],
    ['SkyWatcher 200PDS', 'Atik 460EX', null],
    ['ZWO FF65 APO', 'ZWO ASI2600MC Pro', null],
    ['TS-Optics 130 APO', 'Moravian G3-16200', null],
  ];
  const EXPECTED_CAMERA_ONLY: string[] = [
    'ZWO ASI2600MM Pro',
    'QHY268M',
    'Atik 460EX',
    'ZWO ASI294MC',
    'ZWO ASI294MM Pro',
    'ZWO ASI2600MC Pro',
    'Moravian G3-16200',
    'Fixture Cam',
    'Canon EOS 6D',
    'NIKON Z 6',
    'SONY ILCE-7M4',
    'Canon EOS R6',
  ];

  it('yields exactly the fixture-derived triple set, with no profile for minimal-unit.xisf or malformed entries', () => {
    const profiles = detectEquipmentProfiles(fixtureInputs());
    const actualTriples = new Set(
      profiles.map((p) => JSON.stringify([p.telescope, p.camera, p.focalLengthMm])),
    );

    const expectedTriples = new Set([
      ...EXPECTED_FULL_TRAIN.map(([t, c, f]) => JSON.stringify([t, c, f])),
      ...EXPECTED_CAMERA_ONLY.map((c) => JSON.stringify([null, c, null])),
    ]);

    expect(actualTriples).toEqual(expectedTriples);
    expect(profiles).toHaveLength(20);
  });
});
