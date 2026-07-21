/**
 * Unit tests for the Stage 2–3 dispatcher (P1-07), exercised directly against
 * the committed fixture corpus through an in-memory {@link BoundedReader} — no
 * worker thread, no fs in the code under test (the reader below is test-only
 * fs, DD-002 rule 1).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { formatForExtension, parseAndClassifyFile, type BoundedReader } from './parse-file.js';

const FIXTURES_ROOT = new URL('../../../../fixtures/', import.meta.url);

function fixtureBytes(file: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(file, FIXTURES_ROOT))));
}

/** A bounded reader backed by an in-memory buffer, mirroring the worker's fd-backed reader. */
function readerFor(file: string): BoundedReader {
  const bytes = fixtureBytes(file);
  return (offset, length) => bytes.subarray(offset, offset + length);
}

describe('formatForExtension', () => {
  it('routes each extension group to its parser (case-insensitive)', () => {
    expect(formatForExtension('fits')).toBe('fits');
    expect(formatForExtension('FIT')).toBe('fits');
    expect(formatForExtension('fts')).toBe('fits');
    expect(formatForExtension('xisf')).toBe('xisf');
    expect(formatForExtension('CR2')).toBe('raw');
    expect(formatForExtension('nef')).toBe('raw');
    expect(formatForExtension('arw')).toBe('raw');
    expect(formatForExtension('jpg')).toBeNull();
    expect(formatForExtension('')).toBeNull();
  });
});

describe('parseAndClassifyFile', () => {
  it('parses + classifies a well-formed FITS light frame (header wins)', async () => {
    const result = await parseAndClassifyFile(
      'fits',
      readerFor('fits/nina/nina-light-mono-ha.fits'),
      'nina/nina-light-mono-ha.fits',
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.frame.frameType).toBe('light');
    expect(result.frame.frameTypeSource).toBe('header');
    expect(result.frame.metadata.object).toBe('M 31');
    // Raw keyword dict is preserved for headers_json.
    expect(result.frame.metadata.headers.IMAGETYP).toBe('LIGHT');
  });

  it.each([
    ['fits/nina/nina-dark.fits', 'dark'],
    ['fits/nina/nina-flat.fits', 'flat'],
    ['fits/nina/nina-bias.fits', 'bias'],
  ] as const)('classifies %s as %s from IMAGETYP', async (file, expected) => {
    const result = await parseAndClassifyFile('fits', readerFor(file), file);
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.frame.frameType).toBe(expected);
  });

  it('parses a well-formed XISF header', async () => {
    const result = await parseAndClassifyFile(
      'xisf',
      readerFor('xisf/pixinsight-unit-mono-ha.xisf'),
      'xisf/pixinsight-unit-mono-ha.xisf',
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(Object.keys(result.frame.metadata.headers).length).toBeGreaterThan(0);
  });

  it('parses a well-formed RAW (CR2) frame via the bounded prefix', async () => {
    const result = await parseAndClassifyFile(
      'cr2',
      readerFor('raw/canon-6d-light.cr2'),
      'raw/canon-6d-light.cr2',
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    // EXIF carries no IMAGETYP and the path has no light/dark segment → unknown.
    expect(result.frame.metadata.instrument).toContain('Canon');
  });

  it('returns a structured error (no throw) for a malformed FITS file', async () => {
    const result = await parseAndClassifyFile(
      'fits',
      readerFor('fits/malformed/malformed-missing-end.fits'),
      'fits/malformed/malformed-missing-end.fits',
    );
    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.errorCode).toBe('MISSING_END');
    expect(result.message).toBeTruthy();
  });

  it('returns a structured error for an empty file', async () => {
    const result = await parseAndClassifyFile(
      'fits',
      () => new Uint8Array(0),
      'fits/malformed/malformed-empty.fits',
    );
    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.errorCode).toBe('EMPTY_FILE');
  });

  it('returns an UNSUPPORTED_EXTENSION error for an unknown extension', async () => {
    const result = await parseAndClassifyFile('jpg', () => new Uint8Array(0), 'photo.jpg');
    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.errorCode).toBe('UNSUPPORTED_EXTENSION');
  });
});
