/**
 * `classifyFrame()` orchestrator tests (P1-04): precedence/fallback
 * behavior that the unit-level `imagetyp-table.test.ts` and
 * `path-heuristics.test.ts` tables can't exercise in isolation — header
 * short-circuiting, unrecognized-but-present-header fallthrough,
 * empty/whitespace-as-absent, the PixInsight quote-quirk combined with a
 * conflicting path, RAW-style null-header both branches, and a handful of
 * real fixture-derived byte strings re-asserted through the full entry
 * point.
 */
import { describe, expect, it } from 'vitest';

import { classifyFrame } from './classify.js';
import type { FrameMetadata } from '../fits/metadata.js';

function metadataWith(overrides: Partial<FrameMetadata> = {}): FrameMetadata {
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

describe('classifyFrame precedence', () => {
  it('a recognized header short-circuits even when the path disagrees', () => {
    const result = classifyFrame(
      metadataWith({ imageType: 'LIGHT' }),
      '/data/calibration/darks/frame_001.fits',
    );
    expect(result).toEqual({ frameType: 'light', frameTypeSource: 'header' });
  });

  it('RAW-style null imageType with a path match classifies via path', () => {
    const result = classifyFrame(metadataWith({ imageType: null }), '/data/raw/bias_g100_001.cr2');
    expect(result).toEqual({ frameType: 'bias', frameTypeSource: 'path_heuristic' });
  });

  it('RAW-style null imageType with no path signal falls to unknown/path_heuristic', () => {
    const result = classifyFrame(
      metadataWith({ imageType: null }),
      '/data/raw/2026-01-15/frame_004.cr2',
    );
    expect(result).toEqual({ frameType: 'unknown', frameTypeSource: 'path_heuristic' });
  });

  it('an empty-string header behaves identically to an absent header (falls to path)', () => {
    const result = classifyFrame(
      metadataWith({ imageType: '' }),
      '/data/calibration/flats/flat_001.fits',
    );
    expect(result).toEqual({ frameType: 'flat', frameTypeSource: 'path_heuristic' });
  });

  it('a whitespace-only header behaves identically to an absent header (falls to path)', () => {
    const result = classifyFrame(
      metadataWith({ imageType: '   ' }),
      '/data/calibration/flats/flat_001.fits',
    );
    expect(result).toEqual({ frameType: 'flat', frameTypeSource: 'path_heuristic' });
  });

  it('an unrecognized-but-present header falls through to a matching path (not immediately unknown)', () => {
    const result = classifyFrame(
      metadataWith({ imageType: 'TEST FRAME' }),
      '/data/calibration/darks/dark_001.fits',
    );
    expect(result).toEqual({ frameType: 'dark', frameTypeSource: 'path_heuristic' });
  });

  it('unrecognized header and no path signal yields unknown/path_heuristic (never guessed silently)', () => {
    const result = classifyFrame(
      metadataWith({ imageType: 'TEST FRAME' }),
      '/data/M31/2026-01-15/frame_004.fits',
    );
    expect(result).toEqual({ frameType: 'unknown', frameTypeSource: 'path_heuristic' });
  });

  it('the PixInsight single-quote quirk classifies via header', () => {
    const result = classifyFrame(
      metadataWith({ imageType: "'Master Bias'" }),
      '/data/calibration/bias/master_bias.fits',
    );
    expect(result).toEqual({ frameType: 'bias', frameTypeSource: 'header' });
  });

  it('the PixInsight single-quote quirk combined with a conflicting path still resolves via header', () => {
    const result = classifyFrame(
      metadataWith({ imageType: "'Master Bias'" }),
      '/data/M31/2026-01-15/lights/frame_009.fits',
    );
    expect(result).toEqual({ frameType: 'bias', frameTypeSource: 'header' });
  });
});

describe('classifyFrame fixture-derived byte strings through the full entry point', () => {
  it.each([
    ['LIGHT', '/data/M31/2026-01-15/session/frame_001.fits', 'light'],
    ['Light', '/data/M31/2026-01-15/session/frame_002.fits', 'light'],
    ['DARK', '/data/calibration/session/frame_003.fits', 'dark'],
    ['Dark', '/data/calibration/session/frame_004.fits', 'dark'],
    ['FLAT', '/data/calibration/session/frame_005.fits', 'flat'],
    ['Flat', '/data/calibration/session/frame_006.fits', 'flat'],
    ['BIAS', '/data/calibration/session/frame_007.fits', 'bias'],
  ] as const)('imageType %s at %s classifies as %s via header', (imageType, path, expected) => {
    const result = classifyFrame(metadataWith({ imageType }), path);
    expect(result).toEqual({ frameType: expected, frameTypeSource: 'header' });
  });
});
