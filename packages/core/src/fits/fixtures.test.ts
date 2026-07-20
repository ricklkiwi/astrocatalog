/**
 * Table-driven acceptance tests for P1-01 against the committed fixture
 * corpus (P0-06): every `fits/` manifest entry must parse to its expected
 * keywords/cardCount/headerBytes, and every malformed fixture must produce
 * its exact structured error code — never a throw, never a hang.
 *
 * Test-only fs access: reading the committed corpus is not domain-logic I/O
 * (DD-002 rule 1 governs production code; the parser itself never sees fs).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseFitsHeader, parseFitsHeaderFromBuffer } from './parse.js';
import type { FitsErrorCode, FitsValue } from './types.js';

const FIXTURES_ROOT = new URL('../../../../fixtures/', import.meta.url);

interface ManifestEntry {
  file: string;
  format: string;
  description: string;
  expected:
    | { status: 'ok'; keywords: Record<string, FitsValue>; cardCount: number; headerBytes: number }
    | { status: 'error'; errorCode: FitsErrorCode };
}

const manifest = JSON.parse(readFileSync(new URL('fits/manifest.json', FIXTURES_ROOT), 'utf8')) as {
  entries: ManifestEntry[];
};

function fixtureBytes(file: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(file, FIXTURES_ROOT))));
}

const okEntries = manifest.entries.filter((entry) => entry.expected.status === 'ok');
const errorEntries = manifest.entries.filter((entry) => entry.expected.status === 'error');

describe('FITS fixture corpus (manifest contract)', () => {
  it('covers the whole committed corpus', () => {
    expect(okEntries.length).toBeGreaterThanOrEqual(33);
    expect(errorEntries.length).toBeGreaterThanOrEqual(10);
  });

  describe.each(okEntries.map((entry) => [entry.file, entry] as const))('%s', (_file, entry) => {
    const expected = entry.expected;
    if (expected.status !== 'ok') throw new Error('unreachable');

    it('parses to the manifest keyword expectations (buffer)', () => {
      const result = parseFitsHeaderFromBuffer(fixtureBytes(entry.file));
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;
      for (const [keyword, value] of Object.entries(expected.keywords)) {
        expect(result.header.keywords[keyword], keyword).toStrictEqual(value);
      }
      expect(result.header.cardCount).toBe(expected.cardCount);
      expect(result.header.headerBytes).toBe(expected.headerBytes);
      expect(result.header.cards).toHaveLength(expected.cardCount);
    });

    it('parses identically through the async reader', async () => {
      const bytes = fixtureBytes(entry.file);
      const result = await parseFitsHeader((offset, length) =>
        bytes.subarray(offset, offset + length),
      );
      const sync = parseFitsHeaderFromBuffer(bytes);
      expect(result).toStrictEqual(sync);
    });
  });

  describe.each(errorEntries.map((entry) => [entry.file, entry] as const))('%s', (_file, entry) => {
    const expected = entry.expected;
    if (expected.status !== 'error') throw new Error('unreachable');

    it(`returns structured ${expected.errorCode} without throwing`, () => {
      const result = parseFitsHeaderFromBuffer(fixtureBytes(entry.file));
      expect(result.status).toBe('error');
      if (result.status !== 'error') return;
      expect(result.error.code).toBe(expected.errorCode);
      expect(result.error.message).toBeTruthy();
    });

    it('returns the same structured error through the async reader', async () => {
      const bytes = fixtureBytes(entry.file);
      const result = await parseFitsHeader((offset, length) =>
        bytes.subarray(offset, offset + length),
      );
      expect(result.status).toBe('error');
      if (result.status !== 'error') return;
      expect(result.error.code).toBe(expected.errorCode);
    });
  });
});
