/**
 * Deterministic malformed-file injection for at-scale scan benchmarks
 * (P1-07 acceptance criterion 2 / DD-004 "malformed files logged and
 * skipped"). A pure, side-effect-free sibling to `generate.ts`: it never
 * touches the fs and never mutates its input, so `generate.ts`'s
 * byte-determinism guarantee for the curated/tracked corpus is untouched —
 * callers (the 10k-file `bench/` corpus) generate well-formed frames with
 * `generateFrames()` and then corrupt a chosen subset before writing them to
 * their own scratch directory.
 *
 * The corruption is intentionally header-region only: a well-formed generated
 * FITS file is truncated to a partial single header block and its leading
 * `SIMPLE` keyword is clobbered, so the `@astrotracker/core` parser rejects it
 * (NOT_FITS / MISSING_END) — the file still ends in `.fits` and is non-empty,
 * so it is discovered by the Stage-1 walk and reaches Stage 2 (where it is
 * logged as a parse error and skipped), exactly the path this benchmark must
 * exercise at scale.
 */

/**
 * Bytes retained from the head of a well-formed FITS file when corrupting it.
 * A generated header is 12 value cards (960 bytes) then the `END` card at
 * offset 960, padded to a 2880-byte block. 512 bytes keeps the file a
 * plausible partial header (SIMPLE is present to be clobbered) while
 * guaranteeing the `END` card is absent — so the parser can never treat it as
 * a complete header.
 */
export const CORRUPT_TRUNCATE_BYTES = 512;

/** ASCII bytes overwritten onto the leading keyword so `SIMPLE` no longer parses. */
const CLOBBER = 'XXXXXXXX';

/**
 * Return a corrupted copy of a well-formed generated FITS buffer. Pure: the
 * input is never mutated. The result is a fresh, shorter `Uint8Array` whose
 * first 8 bytes are clobbered, guaranteeing a Stage-2 parse error without
 * changing the `.fits` extension or emptying the file.
 */
export function corruptFitsBytes(bytes: Uint8Array): Uint8Array {
  const length = Math.min(bytes.length, CORRUPT_TRUNCATE_BYTES);
  const copy = Uint8Array.from(bytes.subarray(0, length));
  for (let i = 0; i < CLOBBER.length && i < copy.length; i += 1) {
    copy[i] = CLOBBER.charCodeAt(i);
  }
  return copy;
}

/**
 * How many files to corrupt for a given fraction of a corpus, rounded to the
 * nearest whole file and clamped to `[0, total]`. `0.01` of 10,000 → 100.
 */
export function corruptCountForFraction(total: number, fraction: number): number {
  if (!Number.isFinite(fraction) || fraction < 0) {
    throw new Error(`corrupt fraction must be a non-negative number (got ${fraction})`);
  }
  if (fraction >= 1) {
    throw new Error(
      `corrupt fraction must be < 1 (got ${fraction}); keep most of the corpus valid`,
    );
  }
  return Math.min(total, Math.round(total * fraction));
}

/**
 * Deterministically choose `corruptCount` distinct indices in `[0, total)`,
 * evenly spread across the corpus (not clustered at the start), so the
 * malformed files are interleaved with well-formed ones — the realistic layout
 * for the "one bad file must not abort the batch" property. Returns a sorted
 * array of unique indices; `corruptCount` is clamped to `total`.
 */
export function selectCorruptIndices(total: number, corruptCount: number): number[] {
  if (!Number.isInteger(total) || total < 0) {
    throw new Error(`total must be a non-negative integer (got ${total})`);
  }
  const count = Math.max(0, Math.min(corruptCount, total));
  if (count === 0) {
    return [];
  }
  const step = total / count;
  const indices = new Set<number>();
  for (let k = 0; k < count; k += 1) {
    // Midpoint of each even slice, clamped inside range; the Set + backfill
    // below repairs the rare rounding collision so the count is always exact.
    indices.add(Math.min(total - 1, Math.floor(k * step + step / 2)));
  }
  // Backfill any collisions from rounding so we always return exactly `count`.
  for (let i = 0; indices.size < count && i < total; i += 1) {
    indices.add(i);
  }
  return [...indices].sort((a, b) => a - b);
}
