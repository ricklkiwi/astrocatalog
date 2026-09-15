import { describe, expect, it } from 'vitest';

import { astronomicalDayLabel, isValidIana, resolveTimezone } from './timezone.js';

describe('astronomicalDayLabel', () => {
  const cases: Array<{ name: string; instant: string; timezone: string; expected: string }> = [
    {
      name: "DD-006's literal example: 01:30 local Jul 6 belongs to the Jul 5 session",
      instant: '2026-07-06T07:30:00.000Z',
      timezone: 'America/Denver',
      expected: '2026-07-05',
    },
    {
      name: 'evening frame (20:00 local, >= noon) stays on the same calendar date',
      instant: '2026-07-06T02:00:00.000Z',
      timezone: 'America/Denver',
      expected: '2026-07-05',
    },
    {
      name: 'ALG-2: local noon exactly opens the new astronomical day',
      instant: '2026-07-05T18:00:00.000Z',
      timezone: 'America/Denver',
      expected: '2026-07-05',
    },
    {
      name: 'ALG-3: 1ms before local noon is still the previous calendar date',
      instant: '2026-07-05T17:59:59.999Z',
      timezone: 'America/Denver',
      expected: '2026-07-04',
    },
    {
      name: 'ALG-4a: DST spring-forward, before the jump (01:30 MST)',
      instant: '2026-03-08T08:30:00.000Z',
      timezone: 'America/Denver',
      expected: '2026-03-07',
    },
    {
      name: 'ALG-4b: DST spring-forward, after the jump (03:30 MDT), same night',
      instant: '2026-03-08T09:30:00.000Z',
      timezone: 'America/Denver',
      expected: '2026-03-07',
    },
    {
      name: 'ALG-5: fractional-offset zone (Asia/Kolkata, UTC+05:30), morning frame',
      instant: '2026-07-06T04:00:00.000Z',
      timezone: 'Asia/Kolkata',
      expected: '2026-07-05',
    },
  ];

  it.each(cases)('$name', ({ instant, timezone, expected }) => {
    expect(astronomicalDayLabel(new Date(instant), timezone)).toBe(expected);
  });
});

describe('isValidIana', () => {
  it('accepts a real IANA zone', () => {
    expect(isValidIana('America/Denver')).toBe(true);
  });

  it('rejects a non-IANA string', () => {
    expect(isValidIana('Mars/Olympus_Mons')).toBe(false);
  });

  it('rejects null', () => {
    expect(isValidIana(null)).toBe(false);
  });
});

describe('resolveTimezone', () => {
  it('TZ-1: uses the watch-folder timezone when valid, source watch_folder', () => {
    expect(resolveTimezone('America/Denver', 'Pacific/Auckland')).toEqual({
      timezone: 'America/Denver',
      source: 'watch_folder',
    });
  });

  it('TZ-3: falls back to the caller-resolved default when candidate is null, source system_fallback', () => {
    expect(resolveTimezone(null, 'Pacific/Auckland')).toEqual({
      timezone: 'Pacific/Auckland',
      source: 'system_fallback',
    });
  });

  it('TZ-4: falls back identically for a malformed/non-IANA candidate', () => {
    expect(resolveTimezone('Mars/Olympus_Mons', 'Pacific/Auckland')).toEqual({
      timezone: 'Pacific/Auckland',
      source: 'system_fallback',
    });
  });
});
