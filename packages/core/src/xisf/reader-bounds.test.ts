/**
 * P1-02 acceptance: the parser never reads beyond the header region
 * (DD-004 header-only reads). A recording mock reader wraps each valid
 * fixture with a fake pixel payload appended after the header; the parser
 * must request only the 16-byte signature prologue and the declared XML
 * region, and never touch a payload byte. These fixtures are header-only
 * (P0-06 synthesized no pixel payload), so each fixture's own byte length
 * is exactly its expected header region — the manifest carries no separate
 * `headerBytes` field for XISF (see fixtures.test.ts).
 *
 * Test-only fs access (see fixtures.test.ts).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PROLOGUE_BYTES, parseXisfHeader } from './parse.js';

const FIXTURES_ROOT = new URL('../../../../fixtures/', import.meta.url);

interface ManifestEntry {
  file: string;
  expected: { status: string };
}

const manifest = JSON.parse(readFileSync(new URL('xisf/manifest.json', FIXTURES_ROOT), 'utf8')) as {
  entries: ManifestEntry[];
};

const okEntries = manifest.entries.filter((entry) => entry.expected.status === 'ok');

const PAYLOAD_BYTES = 4096;

describe('header-only read bound (mock reader byte count)', () => {
  it.each(okEntries.map((entry) => [entry.file, entry] as const))(
    '%s: reads exactly the header region and nothing more',
    async (_file, entry) => {
      const header = new Uint8Array(
        readFileSync(fileURLToPath(new URL(entry.file, FIXTURES_ROOT))),
      );
      const headerBytes = header.length;
      // Simulate a real XISF unit: pixel payload after the header. Any read
      // into it would return poison bytes and corrupt the parse.
      const withPayload = new Uint8Array(header.length + PAYLOAD_BYTES);
      withPayload.set(header, 0);
      withPayload.fill(0xff, header.length);

      const requests: Array<{ offset: number; length: number }> = [];
      let bytesServed = 0;

      const result = await parseXisfHeader((offset, length) => {
        requests.push({ offset, length });
        const chunk = withPayload.subarray(offset, offset + length);
        bytesServed += chunk.length;
        return chunk;
      });

      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;
      expect(result.header.headerBytes).toBe(headerBytes);

      // Exactly two requests: the 16-byte prologue, then the declared XML region.
      expect(requests).toStrictEqual([
        { offset: 0, length: PROLOGUE_BYTES },
        { offset: PROLOGUE_BYTES, length: headerBytes - PROLOGUE_BYTES },
      ]);
      expect(bytesServed).toBe(headerBytes);
      const maxByteTouched = Math.max(...requests.map((r) => r.offset + r.length));
      expect(maxByteTouched).toBeLessThanOrEqual(headerBytes);
    },
  );
});
