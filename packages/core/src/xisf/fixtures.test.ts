/**
 * Table-driven acceptance tests for P1-02 against the committed fixture
 * corpus (P0-06): every `xisf/` manifest entry must parse to its expected
 * keywords, and every malformed fixture must produce its exact structured
 * error code — never a throw, never a hang. (`headerBytes` isn't part of
 * the manifest contract for XISF — see reader-bounds.test.ts, which derives
 * the expected header region straight from each fixture's own byte length.)
 *
 * Test-only fs access: reading the committed corpus is not domain-logic I/O
 * (DD-002 rule 1 governs production code; the parser itself never sees fs).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseXisfHeader, parseXisfHeaderFromBuffer } from './parse.js';
import type { XisfErrorCode } from './types.js';

const FIXTURES_ROOT = new URL('../../../../fixtures/', import.meta.url);

interface ManifestEntry {
  file: string;
  format: string;
  description: string;
  expected:
    | { status: 'ok'; keywords: Record<string, string> }
    | { status: 'error'; errorCode: XisfErrorCode };
}

const manifest = JSON.parse(readFileSync(new URL('xisf/manifest.json', FIXTURES_ROOT), 'utf8')) as {
  entries: ManifestEntry[];
};

function fixtureBytes(file: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(file, FIXTURES_ROOT))));
}

const okEntries = manifest.entries.filter((entry) => entry.expected.status === 'ok');
const errorEntries = manifest.entries.filter((entry) => entry.expected.status === 'error');

describe('XISF fixture corpus (manifest contract)', () => {
  it('covers the whole committed corpus', () => {
    expect(okEntries.length).toBeGreaterThanOrEqual(3);
    expect(errorEntries.length).toBeGreaterThanOrEqual(2);
  });

  describe.each(okEntries.map((entry) => [entry.file, entry] as const))('%s', (_file, entry) => {
    const expected = entry.expected;
    if (expected.status !== 'ok') throw new Error('unreachable');

    it('parses to the manifest keyword expectations (buffer)', () => {
      const result = parseXisfHeaderFromBuffer(fixtureBytes(entry.file));
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;
      expect(result.header.keywords).toStrictEqual(expected.keywords);
    });

    it('parses identically through the async reader', async () => {
      const bytes = fixtureBytes(entry.file);
      const result = await parseXisfHeader((offset, length) =>
        bytes.subarray(offset, offset + length),
      );
      const sync = parseXisfHeaderFromBuffer(bytes);
      expect(result).toStrictEqual(sync);
    });
  });

  describe.each(errorEntries.map((entry) => [entry.file, entry] as const))('%s', (_file, entry) => {
    const expected = entry.expected;
    if (expected.status !== 'error') throw new Error('unreachable');

    it(`returns structured ${expected.errorCode} without throwing`, () => {
      const result = parseXisfHeaderFromBuffer(fixtureBytes(entry.file));
      expect(result.status).toBe('error');
      if (result.status !== 'error') return;
      expect(result.error.code).toBe(expected.errorCode);
      expect(result.error.message).toBeTruthy();
    });

    it('returns the same structured error through the async reader', async () => {
      const bytes = fixtureBytes(entry.file);
      const result = await parseXisfHeader((offset, length) =>
        bytes.subarray(offset, offset + length),
      );
      expect(result.status).toBe('error');
      if (result.status !== 'error') return;
      expect(result.error.code).toBe(expected.errorCode);
    });
  });
});
