import { afterEach, describe, expect, it, vi } from 'vitest';

import { isUuid, uuidv7 } from './uuidv7.js';

const V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Extract the 48-bit epoch-ms timestamp prefix of a UUIDv7. */
function timestampOf(id: string): number {
  return parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('uuidv7', () => {
  it('matches the canonical RFC 9562 v7 shape', () => {
    const id = uuidv7();
    expect(id).toHaveLength(36);
    expect(id).toMatch(V7_RE);
  });

  it('sets the version nibble to 7', () => {
    expect(uuidv7()[14]).toBe('7');
  });

  it('sets the variant bits to 10xx (first hex digit of group 4 is 8, 9, a, or b)', () => {
    for (let i = 0; i < 32; i += 1) {
      const nibble = parseInt(uuidv7()[19] as string, 16);
      expect(nibble & 0b1100).toBe(0b1000);
    }
  });

  it('round-trips the timestamp prefix against a mocked clock', () => {
    const mockedNow = 3_000_000_000_123;
    vi.spyOn(Date, 'now').mockReturnValue(mockedNow);
    const id = uuidv7();
    expect(timestampOf(id)).toBe(mockedNow);
  });

  it('emits strictly increasing, duplicate-free IDs for 10k calls in a tight loop', () => {
    const ids = Array.from({ length: 10_000 }, () => uuidv7());
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
    // strictly increasing => no duplicates
    for (let i = 1; i < ids.length; i += 1) {
      expect((ids[i] as string) > (ids[i - 1] as string)).toBe(true);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('stays monotonic across a wall-clock rollback (NTP correction)', () => {
    const spy = vi.spyOn(Date, 'now');
    spy.mockReturnValue(3_000_000_100_000);
    const before = uuidv7();
    spy.mockReturnValue(3_000_000_099_000); // clock jumps 1s backward
    const after = uuidv7();
    expect(after > before).toBe(true);
    // The rolled-back wall clock must not surface in the timestamp prefix.
    expect(timestampOf(after)).toBeGreaterThanOrEqual(timestampOf(before));
  });

  it('borrows the next millisecond instead of overflowing the 12-bit counter', () => {
    vi.spyOn(Date, 'now').mockReturnValue(3_000_000_200_000);
    // Far more calls than the counter can hold in one frozen millisecond.
    const ids = Array.from({ length: 5_000 }, () => uuidv7());
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('isUuid', () => {
  it('accepts a generated UUIDv7', () => {
    expect(isUuid(uuidv7())).toBe(true);
  });

  it('accepts uppercase canonical UUIDs', () => {
    expect(isUuid(uuidv7().toUpperCase())).toBe(true);
  });

  it('rejects wrong-length strings', () => {
    expect(isUuid('')).toBe(false);
    expect(isUuid('0198c0de-9a7b-7abc-9def-0123456789a')).toBe(false); // 35 chars
    expect(isUuid('0198c0de-9a7b-7abc-9def-0123456789abc')).toBe(false); // 37 chars
  });

  it('rejects a wrong version nibble', () => {
    const id = uuidv7();
    expect(isUuid(id.slice(0, 14) + '0' + id.slice(15))).toBe(false);
    expect(isUuid(id.slice(0, 14) + '9' + id.slice(15))).toBe(false);
  });

  it('rejects a wrong variant nibble', () => {
    const id = uuidv7();
    expect(isUuid(id.slice(0, 19) + 'c' + id.slice(20))).toBe(false);
  });

  it('rejects non-hex garbage of the right length', () => {
    expect(isUuid('zzzzzzzz-zzzz-7zzz-9zzz-zzzzzzzzzzzz')).toBe(false);
  });
});
