/**
 * Timezone resolution and astronomical-day labeling (P1-17, DD-006).
 *
 * The only place `packages/core/src/catalog` touches `Intl` — always with an
 * explicit `timeZone` argument supplied by the caller (DD-002 rule 1). Never
 * reads `process.env` or calls `Intl.DateTimeFormat().resolvedOptions()`.
 */
import type { TimezoneSource } from './types.js';

const MS_PER_DAY = 86_400_000;
/** DD-006: local noon opens the new astronomical day (ALG-2/ALG-3). */
const NOON_HOUR = 12;

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
 * DD-006's astronomical-day (noon-to-noon) date label: a **wall-clock**
 * rule, not a fixed-duration one. We read `instant`'s local calendar date
 * and hour in `timezone` directly (never shifting the instant by a real
 * duration first — a real-hours shift only agrees with the wall-clock rule
 * when the UTC offset is identical at both instants, which is false on the
 * two DST-transition days each year), then step the calendar date back by
 * one day when the local hour is before noon. The day-of, on-or-after-noon
 * frame keeps its own calendar date (ALG-2); a pre-noon frame belongs to
 * the previous evening's astronomical day (ALG-3). The one-day step is
 * pure calendar arithmetic on the (year, month, day) triple via
 * `Date.UTC`, so it can never reintroduce a timezone-offset bug.
 */
export function astronomicalDayLabel(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const get = (type: 'year' | 'month' | 'day' | 'hour'): number =>
    Number(parts.find((part) => part.type === type)?.value);

  const year = get('year');
  const month = get('month');
  const day = get('day');
  const hour = get('hour');

  const localDateUtcMs = Date.UTC(year, month - 1, day);
  const astronomicalDayUtcMs = hour < NOON_HOUR ? localDateUtcMs - MS_PER_DAY : localDateUtcMs;
  return new Date(astronomicalDayUtcMs).toISOString().slice(0, 10);
}
