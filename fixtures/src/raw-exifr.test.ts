/**
 * Step 6 acceptance: exifr must successfully parse every valid CR2/NEF/ARW
 * fixture and return the exact ExposureTime/ISO/DateTimeOriginal values the
 * manifest declares, so P1-03 inherits pre-verified fixtures rather than
 * discovering builder bugs later. The CR3 sample is checked too, but its
 * manifest already documents (and this test tolerates) the known exifr
 * limitation for a hand-built box structure.
 */
import exifr from 'exifr';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURES_ROOT } from './author.js';

interface RawManifestEntry {
  file: string;
  expected: {
    status: 'ok' | 'error';
    keywords?: Record<string, unknown>;
    notes?: string;
  };
}

const manifest = JSON.parse(readFileSync(join(FIXTURES_ROOT, 'raw/manifest.json'), 'utf8')) as {
  entries: RawManifestEntry[];
};

const validEntries = manifest.entries.filter((e) => e.expected.status === 'ok');
const tiffBased = validEntries.filter((e) => !e.file.endsWith('.cr3'));
const cr3Entries = validEntries.filter((e) => e.file.endsWith('.cr3'));

// reviveValues: false keeps DateTimeOriginal as the raw EXIF string (exifr's
// default converts it to a Date instance) — the manifest's expected.keywords
// records the literal EXIF tag string, matching the FITS/XISF manifests'
// convention of storing the source value verbatim (P1-03 owns UTC coercion).
const EXIFR_OPTS = { tiff: true, reviveValues: false } as const;

describe('valid TIFF-based RAW samples (CR2/NEF/ARW) parse correctly with exifr', () => {
  it.each(tiffBased)('$file', async (entry) => {
    const bytes = readFileSync(join(FIXTURES_ROOT, entry.file));
    const result = await exifr.parse(bytes, EXIFR_OPTS);
    expect(result).toBeTruthy();
    const kw = entry.expected.keywords ?? {};
    expect(result.Make).toBe(kw.Make);
    expect(result.Model).toBe(kw.Model);
    expect(result.ExposureTime).toBe(kw.ExposureTime);
    expect(result.ISO).toBe(kw.ISO);
    expect(result.DateTimeOriginal).toBe(kw.DateTimeOriginal);
    if (kw.OffsetTimeOriginal === null) {
      expect(result.OffsetTimeOriginal).toBeUndefined();
    } else {
      expect(result.OffsetTimeOriginal).toBe(kw.OffsetTimeOriginal);
    }
  });

  it('exactly one of the three TIFF-based samples has an offset field', () => {
    const withOffset = tiffBased.filter((e) => e.expected.keywords?.OffsetTimeOriginal !== null);
    expect(withOffset).toHaveLength(1);
  });
});

describe('CR3 sample: parses, or the exifr limitation is recorded (never silently dropped)', () => {
  it.each(cr3Entries)('$file', async (entry) => {
    const bytes = readFileSync(join(FIXTURES_ROOT, entry.file));
    const result = await exifr.parse(bytes, EXIFR_OPTS).catch((err: unknown) => err);
    const parsed = result && typeof result === 'object' && 'Make' in result;
    if (!parsed) {
      // Not parseable by exifr: the manifest must say so explicitly.
      expect(entry.expected.notes ?? '').toMatch(/exifr limitation/i);
    } else {
      const kw = entry.expected.keywords ?? {};
      expect((result as Record<string, unknown>).Make).toBe(kw.Make);
    }
  });
});
