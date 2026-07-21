/**
 * Literal-object unit tests for the SGPro `ANGLE` -> `rotatorAngleDegrees`
 * fixup (P1-05): calls the fixup function directly with hand-built
 * `(headers, metadata)` pairs, no parser involved. See `apply.test.ts` for
 * the fixture-driven end-to-end case.
 */
import { describe, expect, it } from 'vitest';

import { sgproProfile } from './sgpro.js';
import type { FrameMetadata } from '../../fits/metadata.js';
import type { FitsValue } from '../../fits/types.js';

function blankMetadata(overrides: Partial<FrameMetadata> = {}): FrameMetadata {
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
    headers: {},
    ...overrides,
  };
}

describe('sgproProfile ANGLE -> rotatorAngleDegrees fixup', () => {
  const [angleFixup] = sgproProfile.fixups;
  if (angleFixup === undefined) throw new Error('sgproProfile.fixups[0] must exist');

  it('applies the patch when ANGLE is present and rotatorAngleDegrees is null', () => {
    const headers: Record<string, FitsValue> = { ANGLE: 182.4 };
    const metadata = blankMetadata({ headers });
    expect(angleFixup(headers, metadata)).toStrictEqual({ rotatorAngleDegrees: 182.4 });
  });

  it('returns {} when ANGLE is present but rotatorAngleDegrees is already non-null', () => {
    const headers: Record<string, FitsValue> = { ANGLE: 182.4 };
    const metadata = blankMetadata({ headers, rotatorAngleDegrees: 90 });
    expect(angleFixup(headers, metadata)).toStrictEqual({});
  });

  it('returns {} when ANGLE is absent', () => {
    const headers: Record<string, FitsValue> = {};
    const metadata = blankMetadata({ headers });
    expect(angleFixup(headers, metadata)).toStrictEqual({});
  });

  it('returns {} when ANGLE is present but non-numeric', () => {
    const headers: Record<string, FitsValue> = { ANGLE: '182.4 deg' };
    const metadata = blankMetadata({ headers });
    expect(angleFixup(headers, metadata)).toStrictEqual({});
  });
});
