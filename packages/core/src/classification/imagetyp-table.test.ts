/**
 * IMAGETYP normalization + mapping table tests (P1-04). Table-driven,
 * ≥40-row coverage per the issue's acceptance criterion — this file
 * enumerates all 47 rows from
 * `docs/plans/p1-04-frame-classification.md`'s "≥40 tested IMAGETYP input
 * variants" table, asserting `matchImageType(raw)` directly (unit-level,
 * below `classifyFrame()`).
 */
import { describe, expect, it } from 'vitest';

import { matchImageType, normalizeImageType } from './imagetyp-table.js';
import type { FrameType } from './types.js';

const CASES: ReadonlyArray<readonly [string, string | null, FrameType | null]> = [
  // --- light ---
  ['1. LIGHT (fixture: nina, voyager, edge/malformed set)', 'LIGHT', 'light'],
  ['2. Light (fixture: apt, sgpro, sharpcap, asistudio)', 'Light', 'light'],
  ['3. light (defensive lowercase)', 'light', 'light'],
  ['4. "  LIGHT  " (defensive whitespace padding)', '  LIGHT  ', 'light'],
  ["5. Light Frame (MaxIm DL/CCDSoft; issue's cited example)", 'Light Frame', 'light'],
  ['6. LIGHT FRAME (MaxIm DL casing variant)', 'LIGHT FRAME', 'light'],
  ['7. LightFrame (defensive no-space)', 'LightFrame', 'light'],
  ['8. Light_Frame (defensive underscore)', 'Light_Frame', 'light'],
  ['9. Light-Frame (defensive hyphen)', 'Light-Frame', 'light'],
  ["10. 'LIGHT' (PixInsight quote-quirk)", "'LIGHT'", 'light'],

  // --- dark ---
  ['11. DARK (fixture: nina, voyager)', 'DARK', 'dark'],
  ['12. Dark (fixture: apt, sgpro, sharpcap, asistudio)', 'Dark', 'dark'],
  ['13. dark (defensive lowercase)', 'dark', 'dark'],
  ['14. Dark Frame (MaxIm DL)', 'Dark Frame', 'dark'],
  ['15. DARK FRAME (MaxIm DL casing variant)', 'DARK FRAME', 'dark'],
  ['16. DarkFrame (defensive)', 'DarkFrame', 'dark'],
  ["17. masterDark (issue's cited example)", 'masterDark', 'dark'],
  ['18. MasterDark (casing variant)', 'MasterDark', 'dark'],
  ['19. Master Dark (spaced variant)', 'Master Dark', 'dark'],
  ['20. MASTER DARK (uppercase variant)', 'MASTER DARK', 'dark'],

  // --- flat ---
  ['21. FLAT (fixture: nina, voyager)', 'FLAT', 'flat'],
  ['22. Flat (fixture: apt, sgpro, sharpcap, asistudio)', 'Flat', 'flat'],
  ['23. flat (defensive lowercase)', 'flat', 'flat'],
  ['24. Flat Field (MaxIm DL)', 'Flat Field', 'flat'],
  ['25. FLAT FIELD (MaxIm DL casing variant)', 'FLAT FIELD', 'flat'],
  ['26. FlatField (defensive)', 'FlatField', 'flat'],
  ['27. MasterFlat', 'MasterFlat', 'flat'],
  ['28. Master Flat', 'Master Flat', 'flat'],

  // --- bias ---
  ['29. BIAS (fixture: nina)', 'BIAS', 'bias'],
  ['30. Bias (plausible Title-case, inferred convention)', 'Bias', 'bias'],
  ['31. bias (defensive lowercase)', 'bias', 'bias'],
  ['32. Bias Frame (MaxIm DL)', 'Bias Frame', 'bias'],
  ['33. BIAS FRAME (MaxIm DL casing variant)', 'BIAS FRAME', 'bias'],
  ['34. masterBias', 'masterBias', 'bias'],
  ["35. 'Master Bias' (PixInsight quote-quirk, exact issue scenario)", "'Master Bias'", 'bias'],

  // --- darkflat ---
  ['36. DARKFLAT', 'DARKFLAT', 'darkflat'],
  ['37. DarkFlat', 'DarkFlat', 'darkflat'],
  ['38. Dark Flat', 'Dark Flat', 'darkflat'],
  ['39. DARK FLAT', 'DARK FLAT', 'darkflat'],
  ['40. Dark-Flat (hyphenated)', 'Dark-Flat', 'darkflat'],
  ['41. Dark_Flat (underscored)', 'Dark_Flat', 'darkflat'],
  ['42. Master Dark Flat', 'Master Dark Flat', 'darkflat'],
  ['43. MASTERDARKFLAT', 'MASTERDARKFLAT', 'darkflat'],

  // --- negative / fallthrough cases (never guessed silently) ---
  ['44. TEST FRAME (unrecognized custom-software value)', 'TEST FRAME', null],
  ["45. '' (empty after quote-strip; raw was \"''\")", "''", null],
  ['46. null (RAW frames: imageType is always null)', null, null],
  ["47. '   ' (whitespace-only)", '   ', null],
];

describe('matchImageType (≥40 IMAGETYP input variants)', () => {
  it.each(CASES)('%s', (_label, raw, expected) => {
    expect(matchImageType(raw)).toBe(expected);
  });

  it('covers at least 40 distinct variants', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(40);
  });
});

describe('normalizeImageType', () => {
  it('strips one leading and trailing quote only when both are present, trimming around it', () => {
    expect(normalizeImageType(" 'LIGHT' ")).toBe('LIGHT');
    expect(normalizeImageType("'Master Bias'")).toBe('MASTER BIAS');
  });

  it('does not strip an unbalanced single quote', () => {
    expect(normalizeImageType("'LIGHT")).toBe("'LIGHT");
    expect(normalizeImageType("LIGHT'")).toBe("LIGHT'");
  });

  it('treats null, empty, and whitespace-only as absent (null)', () => {
    expect(normalizeImageType(null)).toBeNull();
    expect(normalizeImageType('')).toBeNull();
    expect(normalizeImageType('   ')).toBeNull();
    expect(normalizeImageType("''")).toBeNull();
  });

  it('folds underscore/hyphen delimiters to a single space and collapses whitespace runs', () => {
    expect(normalizeImageType('Dark_Flat')).toBe('DARK FLAT');
    expect(normalizeImageType('Dark-Flat')).toBe('DARK FLAT');
    expect(normalizeImageType('Dark   Flat')).toBe('DARK FLAT');
  });
});
