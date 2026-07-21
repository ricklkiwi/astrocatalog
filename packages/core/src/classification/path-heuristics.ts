/**
 * Path-segment classification heuristics (P1-04, DD-004 Stage 2 of the
 * classification order: "IMAGETYP header → path heuristics → unknown").
 * Pure string/regex matching — no I/O.
 */
import type { FrameType } from './types.js';

/**
 * Boundary chars for word-boundary-safe matching within a single path
 * segment: start/end of the segment, or one of `_ - .` (the `/` boundary
 * is already handled by splitting the normalized path into segments before
 * these patterns run). This is what keeps `starlight`, `flatiron`, and
 * `biassing` from false-positively matching `light`, `flat`, `bias` — none
 * of those substrings sit at a delimiter/start/end boundary in those
 * words.
 */
const BOUNDARY_START = '(?:^|[-_.])';
const BOUNDARY_END = '(?:$|[-_.])';

function boundaryPattern(inner: string): RegExp {
  return new RegExp(`${BOUNDARY_START}${inner}${BOUNDARY_END}`);
}

/**
 * Ordered word-boundary-safe rules, checked in this order for a given
 * segment (first match wins). `darkflat` is checked first so
 * `dark_flat`/`dark-flat` don't get caught by the plain `dark` rule below;
 * a bare concatenated `darkflat` never matches the bare `dark` rule anyway
 * since there is no boundary between `dark` and `flat` in that token.
 */
const RULES: ReadonlyArray<{ readonly type: FrameType; readonly pattern: RegExp }> = [
  { type: 'darkflat', pattern: boundaryPattern('dark[ _-]?flats?') },
  { type: 'light', pattern: boundaryPattern('lights?') },
  { type: 'dark', pattern: boundaryPattern('darks?') },
  { type: 'flat', pattern: boundaryPattern('flats?') },
  { type: 'bias', pattern: boundaryPattern('bias(?:es)?') },
];

/**
 * Classify a file path by its directory segments and filename, per DD-004's
 * path-heuristic stage:
 *
 * 1. Replace all `\` with `/` (Windows watch-folder paths reach this
 *    function backslash-separated — `packages/core` must not assume POSIX
 *    separators).
 * 2. Lowercase the whole string.
 * 3. Split into segments (directories + filename) and scan them **deepest
 *    first** (closest to the filename, working back toward the root) — the
 *    first segment with a rule match wins. This covers both whole
 *    directory segments (`/darks/`) and filename-embedded tokens
 *    (`dark_-10c_300s.fits`).
 * 4. Within a given segment, the ordered rule list above is checked in
 *    order; the first rule that matches wins.
 * 5. `masters/`, `master_`, `master-` tokens are not matched by any rule
 *    and are therefore silently skipped as noise — no special-case code is
 *    needed for the `masters/` nesting convention.
 * 6. No match anywhere in the path → `null` (the orchestrator maps this to
 *    `'unknown'`).
 */
export function matchPath(filePath: string): FrameType | null {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  const segments = normalized.split('/').filter((segment) => segment.length > 0);

  for (const segment of segments.toReversed()) {
    for (const rule of RULES) {
      if (rule.pattern.test(segment)) return rule.type;
    }
  }
  return null;
}
