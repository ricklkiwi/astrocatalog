/**
 * `applyCaptureProfile` merge semantics (P1-05): null-passthrough (this
 * step), extended in later steps with the SGPro fixture-driven fixup case,
 * zero-fixup no-op cases, and precedence semantics.
 */
import { describe, expect, it } from 'vitest';

import { applyCaptureProfile } from './apply.js';
import type { FrameMetadata } from '../fits/metadata.js';

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
});
