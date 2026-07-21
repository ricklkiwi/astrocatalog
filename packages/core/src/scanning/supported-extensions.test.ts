import { describe, expect, it } from 'vitest';

import {
  FITS_EXTENSIONS,
  RAW_EXTENSIONS,
  SUPPORTED_EXTENSIONS,
  SUPPORTED_EXTENSION_SET,
  XISF_EXTENSIONS,
  isSupportedExtension,
} from './supported-extensions.js';

describe('SUPPORTED_EXTENSIONS', () => {
  it('is lowercase and dot-less', () => {
    for (const ext of SUPPORTED_EXTENSIONS) {
      expect(ext).toBe(ext.toLowerCase());
      expect(ext.startsWith('.')).toBe(false);
    }
  });

  it('covers the FITS, XISF, and RAW parser formats', () => {
    for (const ext of [...FITS_EXTENSIONS, ...XISF_EXTENSIONS, ...RAW_EXTENSIONS]) {
      expect(SUPPORTED_EXTENSIONS).toContain(ext);
    }
    // The four RAW formats that actually ship fixtures in fixtures/raw/.
    for (const ext of ['cr2', 'cr3', 'nef', 'arw']) {
      expect(SUPPORTED_EXTENSIONS).toContain(ext);
    }
    // The standard FITS spellings.
    expect(SUPPORTED_EXTENSIONS).toEqual(expect.arrayContaining(['fits', 'fit', 'fts']));
    expect(SUPPORTED_EXTENSIONS).toContain('xisf');
  });

  it('has no duplicate entries', () => {
    expect(new Set(SUPPORTED_EXTENSIONS).size).toBe(SUPPORTED_EXTENSIONS.length);
  });

  it('isSupportedExtension matches the set, case-sensitively (caller lowercases first)', () => {
    expect(isSupportedExtension('fits')).toBe(true);
    expect(isSupportedExtension('cr2')).toBe(true);
    expect(isSupportedExtension('jpg')).toBe(false);
    expect(isSupportedExtension('txt')).toBe(false);
    // Not pre-lowercased: the walker's extensionOf() already lowercases.
    expect(isSupportedExtension('FITS')).toBe(false);
    expect(SUPPORTED_EXTENSION_SET.has('xisf')).toBe(true);
  });

  it('is frozen (shared allowlist cannot be mutated)', () => {
    expect(Object.isFrozen(SUPPORTED_EXTENSIONS)).toBe(true);
  });
});
