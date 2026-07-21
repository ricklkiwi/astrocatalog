/**
 * The file-extension allowlist the Stage-1 discovery walker (DD-004, P1-06)
 * uses to decide which files are worth indexing at all. Pure data — no fs, no
 * Electron (DD-002 rule 1) — so both the desktop walker and any core-side
 * tooling can share one source of truth.
 *
 * Extensions are lowercase with **no leading dot**, matching the convention
 * `scan-job.ts`'s `extensionOf()` produces (it lowercases and strips the dot
 * before comparing against the caller-supplied `extensions` set).
 *
 * The three groups mirror the three P1-01…P1-03 header parsers:
 *   - FITS   (`packages/core/src/fits`): `.fits`/`.fit`/`.fts` are all the
 *     standard's accepted spellings for the same format.
 *   - XISF   (`packages/core/src/xisf`): PixInsight's `.xisf`.
 *   - RAW    (`packages/core/src/raw`): CR2/CR3/NEF/ARW/DNG. RAW is ultimately
 *     magic-byte-sniffed (a `.nef` full of garbage is still rejected by the
 *     parser), but the walker needs a concrete extension allowlist so it never
 *     pays to open the vast majority of files that obviously aren't images.
 *     CR2/NEF/ARW have real fixtures in `fixtures/raw/`; CR3 is fixtured too
 *     (parser-limited, see that fixture's manifest note); DNG is included as a
 *     common cross-vendor RAW container even though no fixture ships yet.
 */

/** FITS spellings (Flexible Image Transport System). */
export const FITS_EXTENSIONS = ['fits', 'fit', 'fts'] as const;

/** XISF (Extensible Image Serialization Format — PixInsight). */
export const XISF_EXTENSIONS = ['xisf'] as const;

/** TIFF-structured / ISO-BMFF camera RAW containers (PRD §8.1 high-priority formats + DNG). */
export const RAW_EXTENSIONS = ['cr2', 'cr3', 'nef', 'arw', 'dng'] as const;

/**
 * Every extension the discovery walker should index, lowercase and
 * dot-less. Ordered FITS → XISF → RAW; deduplication isn't needed (the three
 * groups are disjoint) but the value is frozen so no consumer can mutate the
 * shared allowlist.
 */
export const SUPPORTED_EXTENSIONS: readonly string[] = Object.freeze([
  ...FITS_EXTENSIONS,
  ...XISF_EXTENSIONS,
  ...RAW_EXTENSIONS,
]);

/** Set form for O(1) membership tests; same contents as {@link SUPPORTED_EXTENSIONS}. */
export const SUPPORTED_EXTENSION_SET: ReadonlySet<string> = new Set(SUPPORTED_EXTENSIONS);

/** True when `extension` (lowercase, no leading dot) is in the allowlist. */
export function isSupportedExtension(extension: string): boolean {
  return SUPPORTED_EXTENSION_SET.has(extension);
}
