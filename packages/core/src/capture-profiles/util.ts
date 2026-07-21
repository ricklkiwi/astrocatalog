/**
 * Tiny shared helpers for profile `detect` predicates and fixups (P1-05).
 * Pure, side-effect-free — no fs, no Electron (DD-002 rule 1).
 */

import type { FitsValue } from '../fits/types.js';

/**
 * Read a header field as a string, or `null` when absent / not a string.
 * Lets a `detect` predicate safely `startsWith`/`includes` against a
 * guaranteed string: `(headerStringField(headers, 'CREATOR') ?? '')...`.
 */
export function headerStringField(headers: Record<string, FitsValue>, key: string): string | null {
  const value = headers[key];
  return typeof value === 'string' ? value : null;
}
