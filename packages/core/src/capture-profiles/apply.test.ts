/**
 * `applyCaptureProfile` merge semantics (P1-05): null-passthrough, the
 * SGPro `ANGLE` -> `rotatorAngleDegrees` fixture-driven fixup case, and
 * zero-fixup no-op pass-through cases now that all six profiles exist.
 *
 * Test-only fs access: reading the committed fixture corpus is not
 * domain-logic I/O (DD-002 rule 1 governs production code; `apply.ts` itself
 * never imports fs), matching the existing `fits/fixtures.test.ts` pattern.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { applyCaptureProfile } from './apply.js';
import { toFrameMetadata } from '../fits/metadata.js';
import { parseFitsHeaderFromBuffer } from '../fits/parse.js';
import type { FrameMetadata } from '../fits/metadata.js';

const FIXTURES_ROOT = new URL('../../../../fixtures/', import.meta.url);

function fixtureBytes(file: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(file, FIXTURES_ROOT))));
}

function blankMetadata(headers: Record<string, FrameMetadata['headers'][string]>): FrameMetadata {
  return {
    object: null,
    imageType: null,
    filter: null,
    exposureSeconds: null,
    dateObs: null,
    telescope: null,
    instrument: null,
    ccdTempCelsius: null,
    gain: null,
    offset: null,
    binningX: null,
    binningY: null,
    widthPixels: null,
    heightPixels: null,
    raDegrees: null,
    decDegrees: null,
    observer: null,
    siteName: null,
    airmass: null,
    focalLengthMm: null,
    apertureDiameterMm: null,
    pierSide: null,
    rotatorAngleDegrees: null,
    bayerPattern: null,
    rowOrder: null,
    setTempCelsius: null,
    sensorReadoutHz: null,
    electronsPerAdu: null,
    headers,
  };
}

describe('applyCaptureProfile', () => {
  it('returns the SAME object reference, unchanged, when no profile matches', () => {
    const metadata = blankMetadata({ SOMEUNKNOWNKEY: 'not a fingerprint' });
    const result = applyCaptureProfile(metadata);
    expect(result).toBe(metadata);
  });

  describe('SGPro ANGLE -> rotatorAngleDegrees fixup (fixture-driven)', () => {
    const bytes = fixtureBytes('fits/sgpro/sgpro-light-precision-timestamps.fits');
    const parsed = parseFitsHeaderFromBuffer(bytes);
    if (parsed.status !== 'ok') throw new Error('fixture must parse ok');
    const before = toFrameMetadata(parsed.header);

    it('rotatorAngleDegrees is null before the fixup (proves the defect is real)', () => {
      expect(before.rotatorAngleDegrees).toBeNull();
    });

    it('rotatorAngleDegrees is 182.4 after applyCaptureProfile', () => {
      const after = applyCaptureProfile(before);
      expect(after.rotatorAngleDegrees).toBe(182.4);
    });
  });

  describe('no-op pass-through for zero-fixup profiles', () => {
    const representativeFixtures: Array<[string, string]> = [
      ['nina', 'fits/nina/nina-light-mono-ha.fits'],
      ['apt', 'fits/apt/apt-ccd-light.fits'],
      ['sharpcap', 'fits/sharpcap/sharpcap-eaa-light.fits'],
      ['asiair-asistudio', 'fits/asistudio/asiair-light-osc.fits'],
      ['voyager', 'fits/voyager/voyager-light-full-pointing.fits'],
    ];

    it.each(representativeFixtures)(
      '%s: applyCaptureProfile matches the pre-fixup toFrameMetadata output field-for-field',
      (_id, file) => {
        const parsed = parseFitsHeaderFromBuffer(fixtureBytes(file));
        expect(parsed.status).toBe('ok');
        if (parsed.status !== 'ok') return;
        const before = toFrameMetadata(parsed.header);
        const after = applyCaptureProfile(before);
        expect(after).toStrictEqual(before);
      },
    );
  });
});
