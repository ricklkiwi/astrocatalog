/**
 * RFC 9562 UUID version 7 generator — zero runtime dependencies (plan
 * deviation 3: hand-rolled instead of the `uuidv7` npm package).
 *
 * Layout (canonical 8-4-4-4-12 hex):
 *   unix_ts_ms (48 bits) | ver=7 (4) | rand_a (12) | var=10 (2) | rand_b (62)
 *
 * `rand_a` is used as a monotonic counter (RFC 9562 §6.2 method 1): reseeded
 * randomly at each new millisecond with the top bit cleared for increment
 * headroom, incremented for every ID issued within the same millisecond, so
 * bulk inserts in one scan batch sort in creation order. If the counter
 * overflows, or the wall clock moves backward (NTP correction), the last
 * timestamp is reused/advanced so IDs never sort before already-issued ones.
 *
 * Pure domain logic (DD-002 rule 1): only `node:crypto` randomness — no fs,
 * no Electron. Reused later by cloud sync (DD-003: UUIDv7 PKs everywhere).
 */
import { getRandomValues } from 'node:crypto';

let lastMs = -1;
let counter = 0; // 12-bit rand_a counter, valid range 0..0xFFF

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Generate an RFC 9562 UUIDv7 string; strictly increasing (lexically) per process. */
export function uuidv7(): string {
  const now = Date.now();

  if (now > lastMs) {
    lastMs = now;
    counter = reseedCounter();
  } else {
    // Same millisecond, or wall clock moved backward: keep the (possibly
    // future) lastMs and advance the counter so ordering is preserved.
    counter += 1;
    if (counter > 0xfff) {
      // Counter exhausted within one logical millisecond: borrow the next
      // millisecond (RFC 9562 §6.2 "increment the timestamp").
      lastMs += 1;
      counter = reseedCounter();
    }
  }

  const rand = new Uint8Array(8);
  getRandomValues(rand);

  // 48-bit timestamp -> 12 hex; split 8 + 4 across the first two groups.
  const tsHex = lastMs.toString(16).padStart(12, '0');
  // 12-bit counter occupies all of rand_a -> 3 hex after the version nibble.
  const randAHex = counter.toString(16).padStart(3, '0');
  // Group 4 (16 bits): variant '10' + 14 random bits -> first hex digit 8..b.
  const group4 = (0x8000 | ((byteAt(rand, 0) & 0x3f) << 8) | byteAt(rand, 1))
    .toString(16)
    .padStart(4, '0');
  // Group 5 (48 bits): 6 random bytes -> 12 hex.
  let group5 = '';
  for (let i = 2; i < 8; i += 1) {
    group5 += byteAt(rand, i).toString(16).padStart(2, '0');
  }

  return `${tsHex.slice(0, 8)}-${tsHex.slice(8, 12)}-7${randAHex}-${group4}-${group5}`;
}

/** Random 11-bit seed (top bit of the 12-bit counter left clear for headroom). */
function reseedCounter(): number {
  const seed = new Uint16Array(1);
  getRandomValues(seed);
  return (seed[0] ?? 0) & 0x7ff;
}

/** Indexed byte access that satisfies `noUncheckedIndexedAccess`. */
function byteAt(bytes: Uint8Array, index: number): number {
  return bytes[index] ?? 0;
}

/** True if `value` is a canonical RFC 9562 UUID (any version 1-8, variant 10xx). */
export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
