import { describe, expect, it } from 'vitest';

import {
  CORRUPT_TRUNCATE_BYTES,
  corruptCountForFraction,
  corruptFitsBytes,
  selectCorruptIndices,
} from './corrupt.js';
import { generateFrames } from './generate.js';

/** A single well-formed generated FITS buffer to corrupt in the tests below. */
function sampleFrameBytes(): Uint8Array {
  const { frames } = generateFrames({
    count: 1,
    out: 'unused-generateFrames-is-pure-in-memory',
    seed: 7,
    profile: 'nina',
    objects: [{ name: 'M 31', weight: 1 }],
    filters: [{ name: 'Ha', weight: 1 }],
    exptimes: [300],
    imagetypes: [{ name: 'LIGHT', weight: 1 }],
    dateStart: '2026-01-01',
    nights: 1,
  });
  return frames[0]!.bytes;
}

describe('corruptFitsBytes', () => {
  it('returns a shorter, clobbered copy without mutating the input', () => {
    const original = sampleFrameBytes();
    const snapshot = Uint8Array.from(original);

    const corrupted = corruptFitsBytes(original);

    // Input untouched (byte-determinism of the source corpus is preserved).
    expect(original).toEqual(snapshot);
    // Truncated to the partial-header length, so the END card is gone.
    expect(corrupted.length).toBe(CORRUPT_TRUNCATE_BYTES);
    expect(corrupted.length).toBeLessThan(original.length);
    // Leading SIMPLE keyword clobbered.
    expect(Buffer.from(corrupted.subarray(0, 8)).toString('ascii')).toBe('XXXXXXXX');
    // Original started with the real FITS SIMPLE keyword.
    expect(Buffer.from(original.subarray(0, 6)).toString('ascii')).toBe('SIMPLE');
  });

  it('is deterministic', () => {
    const bytes = sampleFrameBytes();
    expect(corruptFitsBytes(bytes)).toEqual(corruptFitsBytes(bytes));
  });
});

describe('corruptCountForFraction', () => {
  it('rounds to whole files and rejects out-of-range fractions', () => {
    expect(corruptCountForFraction(10_000, 0.01)).toBe(100);
    expect(corruptCountForFraction(10_000, 0)).toBe(0);
    expect(corruptCountForFraction(50, 0.05)).toBe(3); // round(2.5)
    expect(() => corruptCountForFraction(10, -0.1)).toThrow(/non-negative/);
    expect(() => corruptCountForFraction(10, 1)).toThrow(/< 1/);
  });
});

describe('selectCorruptIndices', () => {
  it('returns exactly N distinct, in-range, sorted indices spread across the corpus', () => {
    const indices = selectCorruptIndices(10_000, 100);
    expect(indices).toHaveLength(100);
    expect(new Set(indices).size).toBe(100);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(Math.min(...indices)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...indices)).toBeLessThan(10_000);
    // Spread out, not clustered at the front: the last chosen index is deep
    // into the corpus.
    expect(Math.max(...indices)).toBeGreaterThan(9_000);
  });

  it('is deterministic and handles the degenerate counts', () => {
    expect(selectCorruptIndices(100, 5)).toEqual(selectCorruptIndices(100, 5));
    expect(selectCorruptIndices(100, 0)).toEqual([]);
    // corruptCount clamped to total → every index chosen exactly once.
    expect(selectCorruptIndices(4, 10)).toEqual([0, 1, 2, 3]);
  });
});
