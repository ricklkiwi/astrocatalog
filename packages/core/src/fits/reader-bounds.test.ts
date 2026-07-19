/**
 * P1-01 acceptance: the parser never reads beyond the header region
 * (DD-004 header-only reads). A recording mock reader wraps each valid
 * fixture with a fake pixel payload appended after the header; the parser
 * must request only sequential 2880-byte header blocks, stop at the block
 * containing END, and never touch a payload byte.
 *
 * Test-only fs access (see fixtures.test.ts).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { BLOCK_BYTES, parseFitsHeader } from './parse.js';

const FIXTURES_ROOT = new URL('../../../../fixtures/', import.meta.url);

interface ManifestEntry {
  file: string;
  expected: { status: string; headerBytes?: number };
}

const manifest = JSON.parse(readFileSync(new URL('fits/manifest.json', FIXTURES_ROOT), 'utf8')) as {
  entries: ManifestEntry[];
};

const okEntries = manifest.entries.filter((entry) => entry.expected.status === 'ok');

const PAYLOAD_BLOCKS = 4;

describe('header-only read bound (mock reader byte count)', () => {
  it.each(okEntries.map((entry) => [entry.file, entry] as const))(
    '%s: reads exactly the header region and nothing more',
    async (_file, entry) => {
      const headerBytes = entry.expected.headerBytes;
      if (headerBytes === undefined) throw new Error('ok entry without headerBytes');

      const header = new Uint8Array(
        readFileSync(fileURLToPath(new URL(entry.file, FIXTURES_ROOT))),
      );
      // Simulate a real capture file: pixel payload after the header. Any
      // read into it would return poison bytes and corrupt the parse.
      const withPayload = new Uint8Array(header.length + PAYLOAD_BLOCKS * BLOCK_BYTES);
      withPayload.set(header, 0);
      withPayload.fill(0xff, header.length);

      const requests: Array<{ offset: number; length: number }> = [];
      let bytesServed = 0;

      const result = await parseFitsHeader((offset, length) => {
        requests.push({ offset, length });
        const chunk = withPayload.subarray(offset, offset + length);
        bytesServed += chunk.length;
        return chunk;
      });

      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;
      expect(result.header.headerBytes).toBe(headerBytes);

      // Sequential 2880-byte block requests, ending at the END block.
      expect(requests).toStrictEqual(
        Array.from({ length: headerBytes / BLOCK_BYTES }, (_, block) => ({
          offset: block * BLOCK_BYTES,
          length: BLOCK_BYTES,
        })),
      );
      expect(bytesServed).toBe(headerBytes);
      const maxByteTouched = Math.max(...requests.map((r) => r.offset + r.length));
      expect(maxByteTouched).toBeLessThanOrEqual(headerBytes);
    },
  );
});
