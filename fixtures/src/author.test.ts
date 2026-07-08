/**
 * Determinism guard (P0-06 Step 8g): re-running the authoring pipeline must
 * reproduce every committed fixture binary and manifest byte-for-byte. This
 * catches platform-dependent authoring bugs (locale-sensitive formatting,
 * object key ordering, floating rounding) before they surface only on one
 * leg of the 3-OS CI matrix.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIXTURES_ROOT, buildCorpus } from './author.js';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('author.ts determinism', () => {
  const corpus = buildCorpus();

  it('re-running buildCorpus() is byte-identical to itself (pure function)', () => {
    const again = buildCorpus();
    expect(again.files.size).toBe(corpus.files.size);
    for (const [path, bytes] of corpus.files) {
      const rebuilt = again.files.get(path);
      expect(rebuilt, `missing rebuilt file: ${path}`).toBeDefined();
      expect(sha256(rebuilt!)).toBe(sha256(bytes));
    }
    for (const [path, text] of corpus.manifests) {
      expect(again.manifests.get(path)).toBe(text);
    }
  });

  it('every in-memory fixture file byte-matches the committed file on disk', () => {
    expect(corpus.files.size).toBeGreaterThan(0);
    for (const [relPath, bytes] of corpus.files) {
      const committed = readFileSync(`${FIXTURES_ROOT}/${relPath}`);
      expect(sha256(committed)).toBe(sha256(bytes));
    }
  });

  it('every in-memory manifest text-matches the committed manifest.json on disk', () => {
    expect(corpus.manifests.size).toBe(3);
    for (const [relPath, text] of corpus.manifests) {
      const committed = readFileSync(`${FIXTURES_ROOT}/${relPath}`, 'utf8');
      expect(committed).toBe(text);
    }
  });
});
