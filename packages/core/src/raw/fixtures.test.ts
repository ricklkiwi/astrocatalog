/**
 * Table-driven acceptance tests for P1-03 against the committed fixture
 * corpus (P0-06): every `raw/` manifest entry must parse to its expected
 * keywords, and every malformed fixture must produce its exact structured
 * error code — never a throw, never a hang.
 *
 * Test-only fs access: reading the committed corpus is not domain-logic I/O
 * (DD-002 rule 1 governs production code; the parser itself never sees fs).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseRawHeader } from './parse.js';
import type { RawErrorCode, RawKeywords } from './types.js';

const FIXTURES_ROOT = new URL('../../../../fixtures/', import.meta.url);

interface ManifestEntry {
  file: string;
  format: string;
  description: string;
  expected: { status: 'ok'; keywords: RawKeywords } | { status: 'error'; errorCode: RawErrorCode };
}

const manifest = JSON.parse(readFileSync(new URL('raw/manifest.json', FIXTURES_ROOT), 'utf8')) as {
  entries: ManifestEntry[];
};

function fixtureBytes(file: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(file, FIXTURES_ROOT))));
}

const okEntries = manifest.entries.filter((entry) => entry.expected.status === 'ok');
const errorEntries = manifest.entries.filter((entry) => entry.expected.status === 'error');

describe('RAW fixture corpus (manifest contract)', () => {
  it('covers the whole committed corpus', () => {
    expect(okEntries.length).toBeGreaterThanOrEqual(4);
    expect(errorEntries.length).toBeGreaterThanOrEqual(2);
  });

  describe.each(okEntries.map((entry) => [entry.file, entry] as const))('%s', (_file, entry) => {
    const expected = entry.expected;
    if (expected.status !== 'ok') throw new Error('unreachable');

    it('parses to the manifest keyword expectations', async () => {
      const result = await parseRawHeader(fixtureBytes(entry.file));
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;
      expect(result.header.keywords).toStrictEqual(expected.keywords);
    });
  });

  describe.each(errorEntries.map((entry) => [entry.file, entry] as const))('%s', (_file, entry) => {
    const expected = entry.expected;
    if (expected.status !== 'error') throw new Error('unreachable');

    it(`returns structured ${expected.errorCode} without throwing`, async () => {
      const result = await parseRawHeader(fixtureBytes(entry.file));
      expect(result.status).toBe('error');
      if (result.status !== 'error') return;
      expect(result.error.code).toBe(expected.errorCode);
      expect(result.error.message).toBeTruthy();
    });
  });
});

describe('capture-time UTC normalization against the fixture corpus', () => {
  it('normalizes canon-6d-light.cr2 (has OffsetTimeOriginal) to a true UTC instant', async () => {
    const result = await parseRawHeader(fixtureBytes('raw/canon-6d-light.cr2'));
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.header.keywords.DateTimeOriginal).toBe('2026:04:05 22:11:03');
    expect(result.header.keywords.OffsetTimeOriginal).toBe('+02:00');
  });

  it('leaves OffsetTimeOriginal null for fixtures that never wrote one', async () => {
    for (const file of ['raw/nikon-z6-light.nef', 'raw/sony-a7iv-light.arw']) {
      const result = await parseRawHeader(fixtureBytes(file));
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') continue;
      expect(result.header.keywords.OffsetTimeOriginal).toBeNull();
    }
  });
});
