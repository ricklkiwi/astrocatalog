/**
 * `applyCaptureProfile` merge semantics (P1-05): null-passthrough, and the
 * SGPro `ANGLE` -> `rotatorAngleDegrees` fixture-driven fixup case (extended
 * in a later step with zero-fixup no-op pass-through cases once all six
 * profiles exist).
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
});
