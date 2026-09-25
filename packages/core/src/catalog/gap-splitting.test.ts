import { describe, expect, it } from 'vitest';

import { splitByGap } from './gap-splitting.js';
import type { SessionInputFrame } from './types.js';

function frame(id: string, isoInstant: string): SessionInputFrame {
  return {
    id,
    dateObsUtc: new Date(isoInstant),
    equipmentProfileId: null,
    frameType: 'light',
    watchFolderTimezone: null,
    existingSessionId: null,
    existingSessionTimezone: null,
    existingSessionTimezoneSource: null,
    sessionAssignmentLocked: false,
  };
}

describe('splitByGap', () => {
  it('no gap exceeding the threshold yields one run', () => {
    const frames = [
      frame('a', '2026-07-06T02:00:00.000Z'),
      frame('b', '2026-07-06T03:00:00.000Z'),
      frame('c', '2026-07-06T04:00:00.000Z'),
    ];
    const runs = splitByGap(frames, 4);
    expect(runs.map((run) => run.map((f) => f.id))).toEqual([['a', 'b', 'c']]);
  });

  it('one qualifying gap splits into two runs', () => {
    const frames = [
      frame('a', '2026-07-06T02:00:00.000Z'),
      frame('b', '2026-07-06T03:00:00.000Z'),
      frame('c', '2026-07-06T09:00:00.000Z'),
      frame('d', '2026-07-06T10:00:00.000Z'),
    ];
    const runs = splitByGap(frames, 4);
    expect(runs.map((run) => run.map((f) => f.id))).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('multiple qualifying gaps split into multiple runs', () => {
    const frames = [
      frame('a', '2026-07-06T02:00:00.000Z'),
      frame('b', '2026-07-06T09:00:00.000Z'),
      frame('c', '2026-07-06T16:00:00.000Z'),
    ];
    const runs = splitByGap(frames, 4);
    expect(runs.map((run) => run.map((f) => f.id))).toEqual([['a'], ['b'], ['c']]);
  });

  it('ALG-6: a gap of exactly gapHours does not split', () => {
    const frames = [
      frame('a', '2026-07-06T02:00:00.000Z'),
      frame('b', '2026-07-06T06:00:00.000Z'), // exactly 4h later
    ];
    const runs = splitByGap(frames, 4);
    expect(runs.map((run) => run.map((f) => f.id))).toEqual([['a', 'b']]);
  });

  it('ALG-7: a gap of gapHours + 1ms does split', () => {
    const frames = [
      frame('a', '2026-07-06T02:00:00.000Z'),
      frame('b', '2026-07-06T06:00:00.001Z'), // 4h + 1ms later
    ];
    const runs = splitByGap(frames, 4);
    expect(runs.map((run) => run.map((f) => f.id))).toEqual([['a'], ['b']]);
  });

  it('API-3: does not mutate the input array or its element order', () => {
    const a = frame('a', '2026-07-06T09:00:00.000Z');
    const b = frame('b', '2026-07-06T02:00:00.000Z');
    const frames = [a, b];
    const snapshot = [...frames];
    splitByGap(frames, 4);
    expect(frames).toEqual(snapshot);
    expect(frames[0]).toBe(a);
    expect(frames[1]).toBe(b);
  });

  it('returns an empty array for an empty input', () => {
    expect(splitByGap([], 4)).toEqual([]);
  });
});
