/**
 * Gap splitting (P1-17, DD-006): "within one astronomical day, a gap > 4 h
 * (configurable) between consecutive frames splits sessions."
 */
import type { SessionInputFrame } from './types.js';

const MS_PER_HOUR = 3_600_000;

/**
 * Sorts `frames` by `dateObsUtc` ascending (into a new array — the input
 * array and its elements are never mutated) and splits into runs wherever a
 * consecutive gap **strictly exceeds** `gapHours` hours. An exact
 * `gapHours`-long gap does not split (DD-006's literal "> 4h").
 *
 * Callers must only pass frames with a non-null `dateObsUtc`
 * (`detectSessions` filters these before bucketing).
 */
export function splitByGap(frames: SessionInputFrame[], gapHours: number): SessionInputFrame[][] {
  const sorted = [...frames].sort(
    (a, b) => (a.dateObsUtc as Date).getTime() - (b.dateObsUtc as Date).getTime(),
  );

  const thresholdMs = gapHours * MS_PER_HOUR;
  const runs: SessionInputFrame[][] = [];
  let currentRun: SessionInputFrame[] = [];

  for (const frame of sorted) {
    if (currentRun.length === 0) {
      currentRun.push(frame);
      continue;
    }
    const previous = currentRun[currentRun.length - 1] as SessionInputFrame;
    const deltaMs = (frame.dateObsUtc as Date).getTime() - (previous.dateObsUtc as Date).getTime();
    if (deltaMs > thresholdMs) {
      runs.push(currentRun);
      currentRun = [frame];
    } else {
      currentRun.push(frame);
    }
  }
  if (currentRun.length > 0) {
    runs.push(currentRun);
  }
  return runs;
}
