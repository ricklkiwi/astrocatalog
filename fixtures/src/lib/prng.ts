/**
 * Deterministic integer-seeded PRNG (mulberry32).
 *
 * Used by the bulk fixture generator so identical seeds produce byte-identical
 * output on every OS/architecture (required for P0-07's stored CI baselines).
 * Only 32-bit integer ops (`Math.imul`, `>>>`) and one exact power-of-two
 * division are used — all fully specified by ECMA-262, so results are
 * platform-independent.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick an index from `weights` (non-negative, not all zero) using `r` in [0,1). */
export function weightedIndex(weights: readonly number[], r: number): number {
  let total = 0;
  for (const w of weights) total += w;
  if (total <= 0) throw new Error('weightedIndex: weights must sum to a positive value');
  let cursor = r * total;
  for (let i = 0; i < weights.length; i++) {
    cursor -= weights[i] ?? 0;
    if (cursor < 0) return i;
  }
  return weights.length - 1;
}
