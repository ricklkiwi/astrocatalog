/**
 * Path-segment heuristic tests (P1-04). Table-driven, ≥20-row coverage per
 * the issue's acceptance criterion — this file enumerates all 26 rows from
 * `docs/plans/p1-04-frame-classification.md`'s "≥20 tested path patterns"
 * table, asserting `matchPath(path)` directly.
 */
import { describe, expect, it } from 'vitest';

import { matchPath } from './path-heuristics.js';
import type { FrameType } from './types.js';

const CASES: ReadonlyArray<readonly [string, string, FrameType | null]> = [
  ['1. plural segment', '/data/M31/2026-01-15/lights/frame_001.fits', 'light'],
  ['2. singular segment', '/data/M31/2026-01-15/light/frame_001.fits', 'light'],
  [
    '3. plural segment + filename token both dark',
    '/data/calibration/darks/dark_-10c_300s_001.fits',
    'dark',
  ],
  ['4. singular segment', '/data/calibration/dark/dark_001.fits', 'dark'],
  ['5. plural segment', '/data/calibration/flats/flat_L_001.fits', 'flat'],
  ['6. singular segment', '/data/calibration/flat/flat_001.fits', 'flat'],
  ['7. singular', '/data/calibration/bias/bias_001.fits', 'bias'],
  ['8. plural', '/data/calibration/biases/bias_001.fits', 'bias'],
  ['9. concatenated darkflat segment', '/data/calibration/darkflats/darkflat_001.fits', 'darkflat'],
  [
    '10. underscore-delimited darkflat segment',
    '/data/calibration/dark_flat/df_001.fits',
    'darkflat',
  ],
  ['11. hyphen-delimited darkflat segment', '/data/calibration/dark-flat/df_001.fits', 'darkflat'],
  [
    '12. masters/ noise segment skipped',
    '/data/calibration/masters/dark/master_dark_-10c_300s.fits',
    'dark',
  ],
  ['13. masters/ nesting', '/data/calibration/masters/flat/master_flat_L.fits', 'flat'],
  ['14. masters/ nesting', '/data/calibration/masters/bias/master_bias.fits', 'bias'],
  ['15. masters/ nesting', '/data/calibration/masters/darkflat/master_darkflat.fits', 'darkflat'],
  [
    '16. Windows backslashes + uppercase segment',
    'C:\\Astro\\M42\\2026-02-02\\LIGHT\\frame_002.fits',
    'light',
  ],
  [
    '17. delimiter-bounded prefix token in a compound segment',
    '/data/M31/lights_Ha/frame_003.fits',
    'light',
  ],
  [
    '18. uppercase segment with trailing detail',
    '/data/sessions/2026-01-15/DARK_-10C/frame.fits',
    'dark',
  ],
  [
    "19. no dedicated directory — filename-embedded token (DD-004's _flat_ example shape)",
    '/data/M42/2026-02-02/flat_L_001.xisf',
    'flat',
  ],
  [
    '20. RAW frame, imageType always null — path is the only signal',
    '/data/raw/bias_g100_001.cr2',
    'bias',
  ],
  ['21. no type-indicating segment anywhere', '/data/M31/2026-01-15/frame_004.fits', null],
  [
    '22. negative control: light substring inside starlight, not boundary-matched',
    '/data/M31/starlight_project/frame_005.fits',
    null,
  ],
  [
    '23. negative control: flat substring inside flatiron',
    '/data/M31/flatiron_survey/frame_006.fits',
    null,
  ],
  [
    '24. negative control: bias substring inside biassing (no es plural, no boundary after bias)',
    '/data/M31/biassing_test/frame_007.fits',
    null,
  ],
  [
    '25. mixed-case concatenated darkflat, rule 1 must win over rule 3 (dark)',
    '/data/M31/2026-01-15/DarkFlat_Library/master_darkflat_-10C.fits',
    'darkflat',
  ],
  [
    '26. conflicting segments in one path — deepest (darks) wins over shallower lights',
    '/data/M31/2026-01-15/lights/darks/frame_008.fits',
    'dark',
  ],
];

describe('matchPath (≥20 path patterns)', () => {
  it.each(CASES)('%s', (_label, path, expected) => {
    expect(matchPath(path)).toBe(expected);
  });

  it('covers at least 20 distinct patterns', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(20);
  });
});

describe('matchPath word-boundary safety', () => {
  it('does not false-positive on embedded substrings', () => {
    expect(matchPath('/data/starlight/frame.fits')).toBeNull();
    expect(matchPath('/data/flatiron/frame.fits')).toBeNull();
    expect(matchPath('/data/biassing/frame.fits')).toBeNull();
  });
});

describe('matchPath Windows/POSIX equivalence', () => {
  it('classifies backslash paths identically to their forward-slash equivalents', () => {
    const posix = '/data/M42/2026-02-02/darks/frame_002.fits';
    const windows = 'C:\\data\\M42\\2026-02-02\\darks\\frame_002.fits';
    expect(matchPath(windows)).toBe(matchPath(posix));
    expect(matchPath(windows)).toBe('dark');
  });
});
