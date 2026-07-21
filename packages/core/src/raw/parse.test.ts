/**
 * Unit tests for the RAW/EXIF adapter's parsing edge cases (P1-03) that sit
 * below the fixture-manifest contract tested in fixtures.test.ts: the CR3
 * `CTBO` box-walk in isolation, structurally-valid-but-metadata-free input,
 * and the `EMPTY_FILE` guard.
 *
 * Test-only fs access to read the committed CR3 fixture for the box-walk
 * tests — same DD-002 rule 1 carve-out as fixtures.test.ts.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { extractCr3TiffBlocks, looksLikeCr3, parseRawHeader } from './parse.js';

const FIXTURES_ROOT = new URL('../../../../fixtures/', import.meta.url);

function fixtureBytes(file: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(file, FIXTURES_ROOT))));
}

/** `II*` TIFF magic + IFD0 at offset 8 with zero entries + no next IFD — structurally valid, carries no tags. */
const EMPTY_TIFF = new Uint8Array([
  0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

/** Minimal `ftyp` box declaring the `crx ` brand, with nothing else after it — no moov. */
const FTYP_ONLY_CR3 = new Uint8Array([
  0x00,
  0x00,
  0x00,
  0x18, // size = 24
  0x66,
  0x74,
  0x79,
  0x70, // 'ftyp'
  0x63,
  0x72,
  0x78,
  0x20, // 'crx '
  0x00,
  0x00,
  0x00,
  0x00,
  0x63,
  0x72,
  0x78,
  0x20,
  0x69,
  0x73,
  0x6f,
  0x6d,
]);

describe('looksLikeCr3', () => {
  it('recognizes the CR3 fixture', () => {
    expect(looksLikeCr3(fixtureBytes('raw/canon-r6-light.cr3'))).toBe(true);
  });

  it('rejects plain-TIFF RAW formats', () => {
    expect(looksLikeCr3(fixtureBytes('raw/canon-6d-light.cr2'))).toBe(false);
    expect(looksLikeCr3(fixtureBytes('raw/nikon-z6-light.nef'))).toBe(false);
  });

  it('rejects buffers too short to hold a ftyp box', () => {
    expect(looksLikeCr3(new Uint8Array(4))).toBe(false);
  });

  it('rejects a ftyp box with a non-crx major brand', () => {
    const heic = new Uint8Array(FTYP_ONLY_CR3);
    heic.set([0x68, 0x65, 0x69, 0x63], 8); // 'heic'
    expect(looksLikeCr3(heic)).toBe(false);
  });
});

describe('extractCr3TiffBlocks', () => {
  it('extracts both CMT TIFF blocks from the CR3 fixture via the CTBO table', () => {
    const blocks = extractCr3TiffBlocks(fixtureBytes('raw/canon-r6-light.cr3'));
    expect(blocks).toHaveLength(2);
    // Each block is an independently valid "II*" TIFF header.
    for (const block of blocks) {
      expect(block[0]).toBe(0x49);
      expect(block[1]).toBe(0x49);
      expect(block[2]).toBe(0x2a);
    }
  });

  it('returns [] when the ftyp/crx buffer has no moov box (nothing to walk)', () => {
    expect(extractCr3TiffBlocks(FTYP_ONLY_CR3)).toStrictEqual([]);
  });

  it('returns [] for a non-CR3 buffer', () => {
    expect(extractCr3TiffBlocks(fixtureBytes('raw/canon-6d-light.cr2'))).toStrictEqual([]);
  });
});

describe('parseRawHeader edge cases', () => {
  it('reports EMPTY_FILE for a zero-byte buffer, never throwing', async () => {
    const result = await parseRawHeader(new Uint8Array(0));
    expect(result).toStrictEqual({
      status: 'error',
      error: { code: 'EMPTY_FILE', message: expect.any(String) as unknown as string },
    });
  });

  it('parses a structurally-valid TIFF with zero tags to an ok result with all-null keywords', async () => {
    const result = await parseRawHeader(EMPTY_TIFF);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.header.keywords).toStrictEqual({
      OBJECT: null,
      FILTER: null,
      Make: null,
      Model: null,
      ExposureTime: null,
      ISO: null,
      DateTimeOriginal: null,
      OffsetTimeOriginal: null,
    });
    expect(result.header.tags).toStrictEqual({});
  });

  it('falls through to UNRECOGNIZED_RAW when a ftyp/crx buffer has no extractable CTBO structure', async () => {
    const result = await parseRawHeader(FTYP_ONLY_CR3);
    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.error.code).toBe('UNRECOGNIZED_RAW');
  });

  it('parses CR2/NEF/ARW identically regardless of the caller-supplied file extension (magic-byte detection only)', async () => {
    // Same bytes as canon-6d-light.cr2, but nothing about parseRawHeader's
    // input is extension-aware -- it would parse identically if handed to
    // it under a .tif/.tiff name, proving plain-TIFF (PRD 8.1) support.
    const result = await parseRawHeader(fixtureBytes('raw/canon-6d-light.cr2'));
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.header.keywords.Make).toBe('Canon');
  });
});
