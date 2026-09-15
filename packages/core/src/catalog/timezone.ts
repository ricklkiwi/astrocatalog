/**
 * Timezone resolution and astronomical-day labeling (P1-17, DD-006).
 *
 * The only place `packages/core/src/catalog` touches `Intl` — always with an
 * explicit `timeZone` argument supplied by the caller (DD-002 rule 1). Never
 * reads `process.env` or calls `Intl.DateTimeFormat().resolvedOptions()`.
 */
import type { TimezoneSource } from './types.js';

const MS_PER_HOUR = 3_600_000;
const NOON_SHIFT_MS = 12 * MS_PER_HOUR;

/**
 * `true` iff `timezone` is a value Node's ICU-backed `Intl.DateTimeFormat`
 * accepts as an IANA zone. A bogus zone string throws `RangeError` on
 * construction (verified on Node 26, this repo's pinned engine).
 */
export function isValidIana(timezone: string | null): timezone is string {
  if (timezone === null) {
    return false;
  }
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves the effective timezone for a frame with no prior session
 * assignment: the watch-folder timezone if it is a valid IANA zone,
 * otherwise the caller-resolved fallback (DD-006: "default to the system
 * timezone... flag it as user-confirmable").
 */
export function resolveTimezone(
  candidate: string | null,
  fallback: string,
): { timezone: string; source: TimezoneSource } {
  if (isValidIana(candidate)) {
    return { timezone: candidate, source: 'watch_folder' };
  }
  return { timezone: fallback, source: 'system_fallback' };
}

/**
 * DD-006's astronomical-day (noon-to-noon) date label: subtract 12 real
 * hours from the UTC instant, then take the local calendar date of the
 * *shifted* instant in `timezone` via `Intl.DateTimeFormat('en-CA', ...)`
 * (which formats as `YYYY-MM-DD`). Correct across DST transitions by
 * construction — ICU resolves the correct UTC offset for whatever the
 * shifted instant is, so no manual DST special-casing is needed.
 */
export function astronomicalDayLabel(instant: Date, timezone: string): string {
  const shifted = new Date(instant.getTime() - NOON_SHIFT_MS);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(shifted);
}
