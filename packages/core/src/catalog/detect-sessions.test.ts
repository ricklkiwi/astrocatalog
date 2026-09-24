import { describe, expect, it } from 'vitest';

import * as coreRoot from '../index.js';
// API-1: these four types are imported from the package root (not
// `./types.js`) specifically so that deleting any of their re-exports from
// `packages/core/src/index.ts` is a build failure, not just a runtime gap.
import type {
  SessionAssignment,
  SessionDetectionConfig,
  SessionInputFrame,
  TimezoneSource,
} from '../index.js';
import { detectSessions } from './detect-sessions.js';

const DENVER = 'America/Denver';
const KOLKATA = 'Asia/Kolkata';
const AUCKLAND = 'Pacific/Auckland';

/** Default light frame; override only what a scenario needs. */
function mkFrame(
  id: string,
  overrides: Partial<Omit<SessionInputFrame, 'id'>> = {},
): SessionInputFrame {
  return {
    id,
    dateObsUtc: null,
    equipmentProfileId: null,
    frameType: 'light',
    watchFolderTimezone: null,
    existingSessionId: null,
    existingSessionTimezone: null,
    existingSessionTimezoneSource: null,
    sessionAssignmentLocked: false,
    ...overrides,
  };
}

function ids(assignment: SessionAssignment): string[] {
  return [...assignment.frameIds].sort();
}

function findByFrameId(assignments: SessionAssignment[], frameId: string): SessionAssignment {
  const found = assignments.find((a) => a.frameIds.includes(frameId));
  if (found === undefined) {
    throw new Error(`no assignment contains frame ${frameId}`);
  }
  return found;
}

describe('detectSessions — public surface', () => {
  it('API-1: detectSessions and its types are reachable from the package root', () => {
    expect(typeof coreRoot.detectSessions).toBe('function');
  });

  it('API-2: every emitted assignment has exactly the documented key set', () => {
    const frames = [
      mkFrame('a', {
        dateObsUtc: new Date('2026-07-06T02:00:00.000Z'),
        watchFolderTimezone: DENVER,
      }),
    ];
    const [assignment] = detectSessions(frames, { fallbackTimezone: 'UTC' });
    expect(Object.keys(assignment as SessionAssignment).sort()).toEqual(
      [
        'sessionId',
        'frameIds',
        'sessionDate',
        'timezone',
        'timezoneSource',
        'equipmentProfileId',
        'startedAtUtc',
        'endedAtUtc',
        'isCalibrationOnly',
      ].sort(),
    );
  });

  it('API-3: does not mutate the caller-supplied array or its element order', () => {
    const a = mkFrame('a', {
      dateObsUtc: new Date('2026-07-06T09:00:00.000Z'),
      watchFolderTimezone: DENVER,
    });
    const b = mkFrame('b', {
      dateObsUtc: new Date('2026-07-06T02:00:00.000Z'),
      watchFolderTimezone: DENVER,
    });
    const frames = [a, b];
    const snapshot = [...frames];
    detectSessions(frames, { fallbackTimezone: 'UTC' });
    expect(frames).toEqual(snapshot);
    expect(frames[0]).toBe(a);
    expect(frames[1]).toBe(b);
  });

  it('returns [] for an empty input', () => {
    expect(detectSessions([], { fallbackTimezone: 'UTC' })).toEqual([]);
  });
});

describe('detectSessions — astronomical-day windowing', () => {
  it('ALG-1: a midnight-spanning night is one session dated by the evening side', () => {
    const frames = ['02:00', '04:00', '06:00', '08:00'].map((hm, i) =>
      mkFrame(`f${i}`, {
        dateObsUtc: new Date(`2026-07-06T${hm}:00.000Z`),
        watchFolderTimezone: DENVER,
        equipmentProfileId: 'rig-1',
      }),
    );
    const result = detectSessions(frames, { fallbackTimezone: 'UTC' });
    expect(result).toHaveLength(1);
    const [assignment] = result as [SessionAssignment];
    expect(ids(assignment)).toEqual(['f0', 'f1', 'f2', 'f3'].sort());
    expect(assignment.sessionDate).toBe('2026-07-05');
    expect(assignment.startedAtUtc).toEqual(new Date('2026-07-06T02:00:00.000Z'));
    expect(assignment.endedAtUtc).toEqual(new Date('2026-07-06T08:00:00.000Z'));
  });

  it('ALG-2: a frame at exactly local noon opens the new astronomical day', () => {
    const frames = [
      mkFrame('a', {
        dateObsUtc: new Date('2026-07-05T18:00:00.000Z'),
        watchFolderTimezone: DENVER,
      }),
    ];
    const [assignment] = detectSessions(frames, { fallbackTimezone: 'UTC' }) as [SessionAssignment];
    expect(assignment.sessionDate).toBe('2026-07-05');
  });

  it('ALG-3: a frame 1ms before local noon belongs to the previous calendar date', () => {
    const frames = [
      mkFrame('a', {
        dateObsUtc: new Date('2026-07-05T17:59:59.999Z'),
        watchFolderTimezone: DENVER,
      }),
    ];
    const [assignment] = detectSessions(frames, { fallbackTimezone: 'UTC' }) as [SessionAssignment];
    expect(assignment.sessionDate).toBe('2026-07-04');
  });

  it('ALG-4: frames on either side of a DST spring-forward land in one assignment, same date', () => {
    const frames = [
      mkFrame('a', {
        dateObsUtc: new Date('2026-03-08T08:30:00.000Z'),
        watchFolderTimezone: DENVER,
      }),
      mkFrame('b', {
        dateObsUtc: new Date('2026-03-08T09:30:00.000Z'),
        watchFolderTimezone: DENVER,
      }),
    ];
    const result = detectSessions(frames, { fallbackTimezone: 'UTC' });
    expect(result).toHaveLength(1);
    const [assignment] = result as [SessionAssignment];
    expect(ids(assignment)).toEqual(['a', 'b']);
    expect(assignment.sessionDate).toBe('2026-03-07');
  });

  it('ALG-5: a fractional-offset zone (Asia/Kolkata) labels a morning frame the previous evening', () => {
    const frames = [
      mkFrame('a', {
        dateObsUtc: new Date('2026-07-06T04:00:00.000Z'),
        watchFolderTimezone: KOLKATA,
      }),
    ];
    const [assignment] = detectSessions(frames, { fallbackTimezone: 'UTC' }) as [SessionAssignment];
    expect(assignment.sessionDate).toBe('2026-07-05');
  });
});

describe('detectSessions — gap splitting', () => {
  it('ALG-6: a gap of exactly 4h00m00.000s does not split', () => {
    const frames = [
      mkFrame('a', {
        dateObsUtc: new Date('2026-07-06T02:00:00.000Z'),
        watchFolderTimezone: DENVER,
      }),
      mkFrame('b', {
        dateObsUtc: new Date('2026-07-06T06:00:00.000Z'),
        watchFolderTimezone: DENVER,
      }),
    ];
    const result = detectSessions(frames, { fallbackTimezone: 'UTC' });
    expect(result).toHaveLength(1);
    expect(ids(result[0] as SessionAssignment)).toEqual(['a', 'b']);
  });

  it('ALG-7: a gap of 4h00m00.001s splits into exactly two assignments', () => {
    const frames = [
      mkFrame('a', {
        dateObsUtc: new Date('2026-07-06T02:00:00.000Z'),
        watchFolderTimezone: DENVER,
      }),
      mkFrame('b', {
        dateObsUtc: new Date('2026-07-06T06:00:00.001Z'),
        watchFolderTimezone: DENVER,
      }),
    ];
    const result = detectSessions(frames, { fallbackTimezone: 'UTC' });
    expect(result).toHaveLength(2);
    const frameSets = result.map((a) => ids(a)).sort();
    expect(frameSets).toEqual([['a'], ['b']]);
  });

  it('ALG-8: config.gapHours overrides the default threshold', () => {
    const frames = [
      mkFrame('a', {
        dateObsUtc: new Date('2026-07-06T02:00:00.000Z'),
        watchFolderTimezone: DENVER,
      }),
      mkFrame('b', {
        dateObsUtc: new Date('2026-07-06T05:00:00.000Z'),
        watchFolderTimezone: DENVER,
      }),
    ];
    const withOverride = detectSessions(frames, { fallbackTimezone: 'UTC', gapHours: 2 });
    expect(withOverride).toHaveLength(2);

    const withDefault = detectSessions(frames, { fallbackTimezone: 'UTC' });
    expect(withDefault).toHaveLength(1);
  });
});

describe('detectSessions — equipment splitting and bucketing', () => {
  it('ALG-9: two equipment profiles with no time gap split into two assignments', () => {
    const frames = [
      mkFrame('a1', {
        dateObsUtc: new Date('2026-07-06T02:00:00.000Z'),
        watchFolderTimezone: DENVER,
        equipmentProfileId: 'rig-1',
      }),
      mkFrame('a2', {
        dateObsUtc: new Date('2026-07-06T03:00:00.000Z'),
        watchFolderTimezone: DENVER,
        equipmentProfileId: 'rig-1',
      }),
      mkFrame('b1', {
        dateObsUtc: new Date('2026-07-06T02:30:00.000Z'),
        watchFolderTimezone: DENVER,
        equipmentProfileId: 'rig-2',
      }),
      mkFrame('b2', {
        dateObsUtc: new Date('2026-07-06T03:30:00.000Z'),
        watchFolderTimezone: DENVER,
        equipmentProfileId: 'rig-2',
      }),
    ];
    const result = detectSessions(frames, { fallbackTimezone: 'UTC' });
    expect(result).toHaveLength(2);
    const frameSets = result.map((a) => ids(a)).sort();
    expect(frameSets).toEqual(
      [
        ['a1', 'a2'],
        ['b1', 'b2'],
      ].sort(),
    );
  });

  it('ALG-10/ALG-11: an all-null-profile night groups as one assignment with equipmentProfileId null', () => {
    const frames = [
      mkFrame('a', {
        dateObsUtc: new Date('2026-07-06T02:00:00.000Z'),
        watchFolderTimezone: DENVER,
      }),
      mkFrame('b', {
        dateObsUtc: new Date('2026-07-06T03:00:00.000Z'),
        watchFolderTimezone: DENVER,
      }),
    ];
    const result = detectSessions(frames, { fallbackTimezone: 'UTC' });
    expect(result).toHaveLength(1);
    const [assignment] = result as [SessionAssignment];
    expect(ids(assignment)).toEqual(['a', 'b']);
    expect(assignment.equipmentProfileId).toBeNull();
  });

  it('ALG-12: a DSLR night mixing lights and flats, no temperature data, stays one session', () => {
    const frames = [
      mkFrame('l1', {
        dateObsUtc: new Date('2026-07-06T02:00:00.000Z'),
        watchFolderTimezone: DENVER,
        frameType: 'light',
      }),
      mkFrame('l2', {
        dateObsUtc: new Date('2026-07-06T03:00:00.000Z'),
        watchFolderTimezone: DENVER,
        frameType: 'light',
      }),
      mkFrame('fl1', {
        dateObsUtc: new Date('2026-07-06T04:00:00.000Z'),
        watchFolderTimezone: DENVER,
        frameType: 'flat',
      }),
    ];
    const result = detectSessions(frames, { fallbackTimezone: 'UTC' });
    expect(result).toHaveLength(1);
    expect(ids(result[0] as SessionAssignment)).toEqual(['fl1', 'l1', 'l2']);
  });
});

describe('detectSessions — calibration-only sessions', () => {
  it('ALG-13: a night of calibration frames including darkflat is isCalibrationOnly', () => {
    const frames = [
      mkFrame('d1', { dateObsUtc: new Date('2026-07-06T02:00:00.000Z'), frameType: 'dark' }),
      mkFrame('b1', { dateObsUtc: new Date('2026-07-06T02:30:00.000Z'), frameType: 'bias' }),
      mkFrame('df1', { dateObsUtc: new Date('2026-07-06T03:00:00.000Z'), frameType: 'darkflat' }),
    ];
    const [assignment] = detectSessions(frames, { fallbackTimezone: 'UTC' }) as [SessionAssignment];
    expect(assignment.isCalibrationOnly).toBe(true);
  });

  it('ALG-14: a night with at least one light alongside calibration frames is not calibration-only', () => {
    const frames = [
      mkFrame('l1', { dateObsUtc: new Date('2026-07-06T02:00:00.000Z'), frameType: 'light' }),
      mkFrame('d1', { dateObsUtc: new Date('2026-07-06T02:30:00.000Z'), frameType: 'dark' }),
    ];
    const [assignment] = detectSessions(frames, { fallbackTimezone: 'UTC' }) as [SessionAssignment];
    expect(assignment.isCalibrationOnly).toBe(false);
  });

  it('ALG-15: a night of all-unknown frames is calibration-only (no member is a light)', () => {
    const frames = [
      mkFrame('u1', { dateObsUtc: new Date('2026-07-06T02:00:00.000Z'), frameType: 'unknown' }),
      mkFrame('u2', { dateObsUtc: new Date('2026-07-06T02:30:00.000Z'), frameType: 'unknown' }),
    ];
    const [assignment] = detectSessions(frames, { fallbackTimezone: 'UTC' }) as [SessionAssignment];
    expect(assignment.isCalibrationOnly).toBe(true);
  });
});

describe('detectSessions — boundary metadata and frame accounting', () => {
  it('ALG-16: startedAtUtc/endedAtUtc are the min/max of the group, regardless of input order', () => {
    const frames = [
      mkFrame('mid', { dateObsUtc: new Date('2026-07-06T03:00:00.000Z') }),
      mkFrame('late', { dateObsUtc: new Date('2026-07-06T04:00:00.000Z') }),
      mkFrame('early', { dateObsUtc: new Date('2026-07-06T02:00:00.000Z') }),
    ];
    const [assignment] = detectSessions(frames, { fallbackTimezone: 'UTC' }) as [SessionAssignment];
    expect(assignment.startedAtUtc).toEqual(new Date('2026-07-06T02:00:00.000Z'));
    expect(assignment.endedAtUtc).toEqual(new Date('2026-07-06T04:00:00.000Z'));
  });

  it('ALG-17: a frame with unparseable dateObsUtc (null) is excluded and does not crash the run', () => {
    const frames = [
      mkFrame('a', { dateObsUtc: new Date('2026-07-06T02:00:00.000Z') }),
      mkFrame('null-date', { dateObsUtc: null }),
    ];
    const result = detectSessions(frames, { fallbackTimezone: 'UTC' });
    const allIds = result.flatMap((a) => a.frameIds);
    expect(allIds).toEqual(['a']);
  });

  it('ALG-18: assignments partition every usable input id exactly once', () => {
    const frames = [
      mkFrame('locked-1', {
        dateObsUtc: new Date('2026-07-06T02:00:00.000Z'),
        existingSessionId: 'session-A',
        existingSessionTimezone: DENVER,
        existingSessionTimezoneSource: 'watch_folder',
        sessionAssignmentLocked: true,
      }),
      mkFrame('locked-2', {
        dateObsUtc: new Date('2026-07-06T03:00:00.000Z'),
        existingSessionId: 'session-A',
        existingSessionTimezone: DENVER,
        existingSessionTimezoneSource: 'watch_folder',
        sessionAssignmentLocked: true,
      }),
      mkFrame('unlocked-1', {
        dateObsUtc: new Date('2026-07-06T09:00:00.000Z'),
        watchFolderTimezone: DENVER,
      }),
      mkFrame('null-date', { dateObsUtc: null }),
    ];
    const result = detectSessions(frames, { fallbackTimezone: 'UTC' });
    const allIds = result.flatMap((a) => a.frameIds);
    expect([...allIds].sort()).toEqual(['locked-1', 'locked-2', 'unlocked-1'].sort());
    // No id appears twice.
    expect(new Set(allIds).size).toBe(allIds.length);
  });
});

describe('detectSessions — session identity across re-runs', () => {
  it('ALG-19: an unlocked group with no prior existingSessionId emits sessionId null', () => {
    const frames = [
      mkFrame('a', { dateObsUtc: new Date('2026-07-06T02:00:00.000Z') }),
      mkFrame('b', { dateObsUtc: new Date('2026-07-06T03:00:00.000Z') }),
    ];
    const [assignment] = detectSessions(frames, { fallbackTimezone: 'UTC' }) as [SessionAssignment];
    expect(assignment.sessionId).toBeNull();
  });

  it.each([
    ['ascending', ['s1', 's1', 's1', 's2']],
    ['descending', ['s2', 's1', 's1', 's1']],
  ])('ALG-20 (%s order): a 3-to-1 split resolves to the majority id', (_label, sessionIds) => {
    const frames = sessionIds.map((sessionId, i) =>
      mkFrame(`f${i}`, {
        dateObsUtc: new Date(`2026-07-06T0${2 + i}:00:00.000Z`),
        existingSessionId: sessionId,
      }),
    );
    const [assignment] = detectSessions(frames, { fallbackTimezone: 'UTC' }) as [SessionAssignment];
    expect(assignment.sessionId).toBe('s1');
  });

  it.each([
    ['a-then-b', ['01890000-0000-7000-8000-00000000aaaa', '01890000-0000-7000-8000-00000000bbbb']],
    ['b-then-a', ['01890000-0000-7000-8000-00000000bbbb', '01890000-0000-7000-8000-00000000aaaa']],
  ])(
    'ALG-21 (%s): a 1-to-1 tie resolves to the lexicographically smaller id',
    (_label, sessionIds) => {
      const frames = sessionIds.map((sessionId, i) =>
        mkFrame(`f${i}`, {
          dateObsUtc: new Date(`2026-07-06T0${2 + i}:00:00.000Z`),
          existingSessionId: sessionId,
        }),
      );
      const [assignment] = detectSessions(frames, { fallbackTimezone: 'UTC' }) as [
        SessionAssignment,
      ];
      expect(assignment.sessionId).toBe('01890000-0000-7000-8000-00000000aaaa');
    },
  );

  it('ALG-22: idempotent re-run — applying output back onto input reproduces it exactly', () => {
    const frames: SessionInputFrame[] = [
      mkFrame('a', {
        dateObsUtc: new Date('2026-07-06T02:00:00.000Z'),
        watchFolderTimezone: DENVER,
      }),
      mkFrame('b', {
        dateObsUtc: new Date('2026-07-06T03:00:00.000Z'),
        watchFolderTimezone: DENVER,
      }),
      mkFrame('c', {
        dateObsUtc: new Date('2026-07-06T09:00:00.000Z'),
        watchFolderTimezone: DENVER,
        equipmentProfileId: 'rig-2',
      }),
    ];
    const config: SessionDetectionConfig = { fallbackTimezone: 'UTC' };
    const firstRun = detectSessions(frames, config);

    // Mint ids for any null sessionId, mirroring what the (out-of-scope)
    // persistence layer would do, then apply the result back onto a copy of
    // the input.
    const mintedByAssignment = firstRun.map((a) => a.sessionId ?? `minted-${a.frameIds.join('-')}`);
    const frameIdToAssignmentIndex = new Map<string, number>();
    firstRun.forEach((a, index) => {
      for (const frameId of a.frameIds) {
        frameIdToAssignmentIndex.set(frameId, index);
      }
    });

    const secondInput: SessionInputFrame[] = frames.map((f) => {
      const assignmentIndex = frameIdToAssignmentIndex.get(f.id) as number;
      const assignment = firstRun[assignmentIndex] as SessionAssignment;
      return {
        ...f,
        existingSessionId: mintedByAssignment[assignmentIndex] as string,
        existingSessionTimezone: assignment.timezone,
        existingSessionTimezoneSource: assignment.timezoneSource,
      };
    });

    const secondRun = detectSessions(secondInput, config);

    const normalize = (assignments: SessionAssignment[]) =>
      assignments
        .map((a) => ({ ...a, frameIds: [...a.frameIds].sort() }))
        .sort((a, b) => a.frameIds.join(',').localeCompare(b.frameIds.join(',')));

    const firstNormalized = normalize(firstRun).map((a) => ({
      ...a,
      sessionId: a.sessionId ?? `minted-${a.frameIds.join('-')}`,
    }));
    expect(normalize(secondRun)).toEqual(firstNormalized);
  });
});

describe('detectSessions — timezone resolution', () => {
  it('TZ-1: watch-folder timezone wins over an unrelated fallback', () => {
    const frames = [
      mkFrame('a', {
        dateObsUtc: new Date('2026-07-06T00:30:00.000Z'),
        watchFolderTimezone: DENVER,
      }),
    ];
    const [assignment] = detectSessions(frames, { fallbackTimezone: AUCKLAND }) as [
      SessionAssignment,
    ];
    expect(assignment.sessionDate).toBe('2026-07-05');
    expect(assignment.timezone).toBe(DENVER);
    expect(assignment.timezoneSource).toBe('watch_folder');
  });

  it('TZ-2/TZ-3: an unset watch-folder timezone falls back to a different night entirely', () => {
    const frames = [mkFrame('a', { dateObsUtc: new Date('2026-07-06T00:30:00.000Z') })];
    const [assignment] = detectSessions(frames, { fallbackTimezone: AUCKLAND }) as [
      SessionAssignment,
    ];
    expect(assignment.sessionDate).toBe('2026-07-06');
    expect(assignment.timezone).toBe(AUCKLAND);
    expect(assignment.timezoneSource).toBe('system_fallback');
  });

  it('TZ-4: a malformed IANA watch-folder timezone resolves exactly as null does', () => {
    const frames = [
      mkFrame('a', {
        dateObsUtc: new Date('2026-07-06T00:30:00.000Z'),
        watchFolderTimezone: 'Mars/Olympus_Mons',
      }),
    ];
    const [assignment] = detectSessions(frames, { fallbackTimezone: AUCKLAND }) as [
      SessionAssignment,
    ];
    expect(assignment.sessionDate).toBe('2026-07-06');
    expect(assignment.timezone).toBe(AUCKLAND);
    expect(assignment.timezoneSource).toBe('system_fallback');
  });

  it('TZ-5: an invalid config.fallbackTimezone throws even if never consulted', () => {
    const frames = [
      mkFrame('a', {
        dateObsUtc: new Date('2026-07-06T00:30:00.000Z'),
        watchFolderTimezone: DENVER,
      }),
    ];
    expect(() => detectSessions(frames, { fallbackTimezone: 'Not/AZone' })).toThrow(
      /fallbackTimezone/,
    );
  });

  it('TZ-6: a frozen existingSessionTimezone beats a since-changed watchFolderTimezone', () => {
    const frames = [
      mkFrame('a', {
        dateObsUtc: new Date('2026-07-05T13:00:00.000Z'),
        watchFolderTimezone: 'UTC',
        existingSessionId: 'session-old',
        existingSessionTimezone: DENVER,
        existingSessionTimezoneSource: 'watch_folder',
      }),
    ];
    const [assignment] = detectSessions(frames, { fallbackTimezone: 'UTC' }) as [SessionAssignment];
    expect(assignment.timezone).toBe(DENVER);
    expect(assignment.timezoneSource).toBe('watch_folder');
    // Frozen Denver value: 13:00Z - 12h = 01:00Z = 19:00 local Jul4 -> '2026-07-04'.
    // A UTC re-derivation would instead give '2026-07-05'.
    expect(assignment.sessionDate).toBe('2026-07-04');
  });

  describe('TZ-7', () => {
    // `early` has the smaller `dateObsUtc` and must win regardless of which
    // array slot it occupies — the earlier attempt only ever varied which
    // timezone string was attached to `frames[0]`, so "earliest" and
    // "first in input order" were never distinct elements. Reversing the
    // array here is what actually exercises `earliestOf`.
    const early = mkFrame('early', {
      dateObsUtc: new Date('2026-07-06T02:00:00.000Z'),
      existingSessionId: 'session-A',
      existingSessionTimezone: DENVER,
      existingSessionTimezoneSource: 'watch_folder',
      sessionAssignmentLocked: true,
    });
    const late = mkFrame('late', {
      dateObsUtc: new Date('2026-07-06T03:00:00.000Z'),
      existingSessionId: 'session-A',
      existingSessionTimezone: 'UTC',
      existingSessionTimezoneSource: 'system_fallback',
      sessionAssignmentLocked: true,
    });
    const expectedTimezone = DENVER;
    const expectedSource: TimezoneSource = 'watch_folder';

    it.each([
      ['array order [early, late]', [early, late]],
      ['array order [late, early]', [late, early]],
    ])(
      'a locked group disagreeing on frozen timezone/source uses the earliest member’s values (%s)',
      (_label, frames) => {
        const [assignment] = detectSessions(frames, { fallbackTimezone: 'UTC' }) as [
          SessionAssignment,
        ];
        expect(assignment.timezone).toBe(expectedTimezone);
        expect(assignment.timezoneSource).toBe(expectedSource);
      },
    );
  });
});

describe('detectSessions — manual-assignment locks', () => {
  it('LOCK-1: a manual merge survives a >4h internal gap', () => {
    const lockedFrames = ['02:00', '03:00', '09:00', '10:00'].map((hm, i) =>
      mkFrame(`locked-${i}`, {
        dateObsUtc: new Date(`2026-07-06T${hm}:00.000Z`),
        existingSessionId: 'session-A',
        existingSessionTimezone: DENVER,
        existingSessionTimezoneSource: 'watch_folder',
        sessionAssignmentLocked: true,
      }),
    );

    const result = detectSessions(lockedFrames, { fallbackTimezone: 'UTC' });

    const lockedAssignment = result.find((a) => a.sessionId === 'session-A');
    expect(lockedAssignment).toBeDefined();
    expect(ids(lockedAssignment as SessionAssignment)).toEqual(
      ['locked-0', 'locked-1', 'locked-2', 'locked-3'].sort(),
    );
    expect((lockedAssignment as SessionAssignment).startedAtUtc).toEqual(
      new Date('2026-07-06T02:00:00.000Z'),
    );
    expect((lockedAssignment as SessionAssignment).endedAtUtc).toEqual(
      new Date('2026-07-06T10:00:00.000Z'),
    );
  });

  it('LOCK-3: a new unlocked frame inside a locked window never widens the lock', () => {
    const lockedFrames = ['02:00', '03:00', '09:00', '10:00'].map((hm, i) =>
      mkFrame(`locked-${i}`, {
        dateObsUtc: new Date(`2026-07-06T${hm}:00.000Z`),
        existingSessionId: 'session-A',
        existingSessionTimezone: DENVER,
        existingSessionTimezoneSource: 'watch_folder',
        sessionAssignmentLocked: true,
      }),
    );
    const newUnlockedFrame = mkFrame('new-unlocked', {
      dateObsUtc: new Date('2026-07-06T06:00:00.000Z'),
      watchFolderTimezone: DENVER,
    });

    const result = detectSessions([...lockedFrames, newUnlockedFrame], { fallbackTimezone: 'UTC' });

    const lockedAssignment = result.find((a) => a.sessionId === 'session-A');
    expect(lockedAssignment).toBeDefined();
    expect(ids(lockedAssignment as SessionAssignment)).toEqual(
      ['locked-0', 'locked-1', 'locked-2', 'locked-3'].sort(),
    );
    expect((lockedAssignment as SessionAssignment).startedAtUtc).toEqual(
      new Date('2026-07-06T02:00:00.000Z'),
    );
    expect((lockedAssignment as SessionAssignment).endedAtUtc).toEqual(
      new Date('2026-07-06T10:00:00.000Z'),
    );

    const newFrameAssignment = findByFrameId(result, 'new-unlocked');
    expect(ids(newFrameAssignment)).toEqual(['new-unlocked']);
    expect(newFrameAssignment.sessionId).not.toBe('session-A');
  });

  it('LOCK-2: a manual split survives even though the gap rule alone would merge all four', () => {
    const frames = [0, 1, 2, 3].map((i) =>
      mkFrame(`f${i}`, {
        dateObsUtc: new Date(`2026-07-06T0${2 + i}:00:00.000Z`),
        existingSessionId: i < 2 ? 'session-X' : 'session-Y',
        existingSessionTimezone: DENVER,
        existingSessionTimezoneSource: 'watch_folder',
        sessionAssignmentLocked: true,
      }),
    );
    const result = detectSessions(frames, { fallbackTimezone: 'UTC' });
    expect(result).toHaveLength(2);
    const x = result.find((a) => a.sessionId === 'session-X');
    const y = result.find((a) => a.sessionId === 'session-Y');
    expect(ids(x as SessionAssignment)).toEqual(['f0', 'f1']);
    expect(ids(y as SessionAssignment)).toEqual(['f2', 'f3']);
  });

  it('LOCK-4: a locked group emits its members’ existingSessionId verbatim', () => {
    const frames = [
      mkFrame('a', {
        dateObsUtc: new Date('2026-07-06T02:00:00.000Z'),
        existingSessionId: 'session-A',
        existingSessionTimezone: DENVER,
        existingSessionTimezoneSource: 'watch_folder',
        sessionAssignmentLocked: true,
      }),
    ];
    const [assignment] = detectSessions(frames, { fallbackTimezone: 'UTC' }) as [SessionAssignment];
    expect(assignment.sessionId).toBe('session-A');
  });

  it('LOCK-5: two locked frames with different equipment profiles remain one assignment', () => {
    const frames = [
      mkFrame('a', {
        dateObsUtc: new Date('2026-07-06T02:00:00.000Z'),
        existingSessionId: 'session-A',
        existingSessionTimezone: DENVER,
        existingSessionTimezoneSource: 'watch_folder',
        sessionAssignmentLocked: true,
        equipmentProfileId: 'rig-1',
      }),
      mkFrame('b', {
        dateObsUtc: new Date('2026-07-06T02:30:00.000Z'),
        existingSessionId: 'session-A',
        existingSessionTimezone: DENVER,
        existingSessionTimezoneSource: 'watch_folder',
        sessionAssignmentLocked: true,
        equipmentProfileId: 'rig-2',
      }),
    ];
    const result = detectSessions(frames, { fallbackTimezone: 'UTC' });
    expect(result).toHaveLength(1);
    expect(ids(result[0] as SessionAssignment)).toEqual(['a', 'b']);
  });

  it('LOCK-6: a lock with no existingSessionId is treated as unlocked and joins its neighbours', () => {
    const frames = [
      mkFrame('a', {
        dateObsUtc: new Date('2026-07-06T02:00:00.000Z'),
        watchFolderTimezone: DENVER,
        sessionAssignmentLocked: true,
        existingSessionId: null,
      }),
      mkFrame('b', {
        dateObsUtc: new Date('2026-07-06T02:30:00.000Z'),
        watchFolderTimezone: DENVER,
      }),
    ];
    const result = detectSessions(frames, { fallbackTimezone: 'UTC' });
    expect(result).toHaveLength(1);
    expect(ids(result[0] as SessionAssignment)).toEqual(['a', 'b']);
  });
});

describe('detectSessions — defensive edge cases', () => {
  it('a locked group whose existingSessionTimezone is absent falls through to fresh resolution', () => {
    const frames = [
      mkFrame('a', {
        dateObsUtc: new Date('2026-07-06T02:00:00.000Z'),
        existingSessionId: 'session-A',
        existingSessionTimezone: null,
        existingSessionTimezoneSource: null,
        watchFolderTimezone: DENVER,
        sessionAssignmentLocked: true,
      }),
    ];
    const [assignment] = detectSessions(frames, { fallbackTimezone: 'UTC' }) as [SessionAssignment];
    expect(assignment.timezone).toBe(DENVER);
    expect(assignment.timezoneSource).toBe('watch_folder');
  });

  it('an empty frames array returns []', () => {
    expect(detectSessions([], { fallbackTimezone: 'UTC' })).toEqual([]);
  });
});
