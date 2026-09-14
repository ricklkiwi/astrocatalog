/**
 * Presentation-only helpers shared across the renderer: the DD-008
 * `HHh MMm` integration-time formatter and the canonical per-filter colour
 * map. Both are pure — no fs, no Electron, no `window.astrotracker`, no
 * React — and this module is the SOLE place either concern lives; nothing
 * else in the renderer should re-derive an hour/minute split from seconds
 * or reference a `--filter-…` custom property directly.
 *
 * `FILTER_COLORS` holds `var(--filter-…)` REFERENCES, never resolved hex —
 * it does not and must never branch on the active theme. `theme/tokens.css`
 * re-declares the same custom properties under the night-vision theme's
 * attribute block with dimmed, red-shifted values, so the same reference
 * automatically resolves differently once that theme is active. The theme
 * swap stays a pure CSS token swap; no TypeScript in this file (or anywhere
 * else) needs to know that override exists.
 */

/** DD-008's seven named filter bands. */
export type FilterColorBand = 'L' | 'R' | 'G' | 'B' | 'Ha' | 'OIII' | 'SII';

/**
 * Formats a total integration time in seconds as `HHh MMm` (DD-008: "always
 * displayed HHh MMm"). Hours are zero-padded to a minimum of 2 digits but
 * never truncated past that (a 100+ hour target renders `100h 00m`).
 * `Math.floor`s the input first (defensive against summed floating-point
 * exposure seconds), then floor-divides into whole minutes — any sub-minute
 * remainder is dropped, never rounded up, so displayed integration time
 * never overstates what has actually completed.
 *
 * Throws `RangeError` on a negative input: there is no legitimate negative
 * integration time, and silently clamping to zero would hide a caller bug.
 */
export function formatIntegrationTime(totalSeconds: number): string {
  if (totalSeconds < 0) {
    throw new RangeError(
      `formatIntegrationTime: totalSeconds must not be negative (received ${totalSeconds}).`,
    );
  }

  // Two floor-divisions by 60 (60 * 60 = 3600 seconds per hour), not a
  // single divide-by-3600 — this is the one place in the renderer allowed to
  // derive an hour/minute split from a seconds count (DSP-9's single-source
  // guard fails any other file that re-derives one).
  const wholeSeconds = Math.floor(totalSeconds);
  const totalMinutes = Math.floor(wholeSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`;
}

/**
 * The canonical per-filter colour map (DD-008: L=white, R/G/B, Ha=deep red,
 * OIII=teal, SII=orange-red in dark/light; dimmed and red-shifted under the
 * night-vision theme). Every value is a `var(--filter-…)` reference into
 * `theme/tokens.css` — resolving the actual colour is the browser's job at
 * paint time, driven entirely by which theme's token block is active.
 */
export const FILTER_COLORS: Record<FilterColorBand, string> = {
  L: 'var(--filter-l)',
  R: 'var(--filter-r)',
  G: 'var(--filter-g)',
  B: 'var(--filter-b)',
  Ha: 'var(--filter-ha)',
  OIII: 'var(--filter-oiii)',
  SII: 'var(--filter-sii)',
};

function isKnownFilterBand(rawBand: string): rawBand is FilterColorBand {
  return Object.prototype.hasOwnProperty.call(FILTER_COLORS, rawBand);
}

/**
 * Resolves a raw/canonical band name to its colour token. Falls back to the
 * neutral `--filter-unknown` token for anything outside DD-008's seven named
 * bands (e.g. `'UVIR'`, `'None'`, `'Dualband'` — DD-003/DD-005's larger
 * filter vocabulary) so a future page rendering one of those frames never
 * hits a missing-key error, without this module inventing colours DD-008
 * never specified.
 */
export function getFilterColor(rawBand: string): string {
  if (isKnownFilterBand(rawBand)) {
    return FILTER_COLORS[rawBand];
  }
  return 'var(--filter-unknown)';
}
