import { describe, expect, it } from 'vitest';
import { mulberry32, weightedIndex } from './prng.js';

describe('mulberry32', () => {
  it('produces an identical sequence for an identical seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      expect(a()).toBe(b());
    }
  });

  it('produces different sequences for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const seqA = Array.from({ length: 8 }, () => a());
    const seqB = Array.from({ length: 8 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it('emits values in [0, 1)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 10000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('matches a pinned reference sequence (cross-platform regression pin)', () => {
    // Pinned at authoring time; a change here means generator output (and
    // every P0-07 baseline derived from it) silently changed.
    const r = mulberry32(1);
    const got = Array.from({ length: 4 }, () => Math.round(r() * 1e9));
    expect(got).toEqual([627073941, 2735721, 527447040, 981050967]);
  });
});

describe('weightedIndex', () => {
  it('maps r deterministically onto cumulative weights', () => {
    const weights = [0.5, 0.3, 0.2];
    expect(weightedIndex(weights, 0.0)).toBe(0);
    expect(weightedIndex(weights, 0.49)).toBe(0);
    expect(weightedIndex(weights, 0.5)).toBe(1);
    expect(weightedIndex(weights, 0.79)).toBe(1);
    expect(weightedIndex(weights, 0.8)).toBe(2);
    expect(weightedIndex(weights, 0.999)).toBe(2);
  });

  it('normalizes implicitly: weights need not sum to 1', () => {
    expect(weightedIndex([5, 3, 2], 0.49)).toBe(0);
    expect(weightedIndex([5, 3, 2], 0.5)).toBe(1);
  });

  it('rejects all-zero weights', () => {
    expect(() => weightedIndex([0, 0], 0.5)).toThrow(/positive/);
  });
});
