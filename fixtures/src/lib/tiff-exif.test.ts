import exifr from 'exifr';
import { describe, expect, it } from 'vitest';
import { buildCr3, buildTiff, truncate } from './tiff-exif.js';

const withoutOffset = () =>
  buildTiff({
    ifd0: [
      { tag: 271, type: 'ASCII', value: 'Canon' },
      { tag: 272, type: 'ASCII', value: 'Canon EOS R6' },
    ],
    exifIfd: [
      { tag: 0x829a, type: 'RATIONAL', value: [1, 200] }, // ExposureTime
      { tag: 0x8827, type: 'SHORT', value: 1600 }, // ISOSpeedRatings
      { tag: 0x9003, type: 'ASCII', value: '2026:04:05 22:11:03' }, // DateTimeOriginal
    ],
  });

const withOffset = () =>
  buildTiff({
    ifd0: [
      { tag: 271, type: 'ASCII', value: 'Nikon' },
      { tag: 272, type: 'ASCII', value: 'NIKON Z 6' },
    ],
    exifIfd: [
      { tag: 0x829a, type: 'RATIONAL', value: [1, 400] },
      { tag: 0x8827, type: 'SHORT', value: 800 },
      { tag: 0x9003, type: 'ASCII', value: '2026-04-06T01:20:00' },
      { tag: 0x9011, type: 'ASCII', value: '+02:00' }, // OffsetTimeOriginal
    ],
  });

describe('buildTiff — IFD0 + EXIF IFD roundtrip via exifr', () => {
  it('is readable by exifr and reports Make/Model plus core EXIF fields', async () => {
    const bytes = withoutOffset();
    const result = await exifr.parse(Buffer.from(bytes), true);
    expect(result).toBeTruthy();
    expect(result.Make).toBe('Canon');
    expect(result.Model).toBe('Canon EOS R6');
    expect(result.ExposureTime).toBeCloseTo(1 / 200, 6);
    expect(result.ISO).toBe(1600);
  });

  it('the with-offset sample exposes an offset field; the without-offset sample does not', async () => {
    const withOff = await exifr.parse(Buffer.from(withOffset()), true);
    const withoutOff = await exifr.parse(Buffer.from(withoutOffset()), true);
    expect(withOff.OffsetTimeOriginal).toBe('+02:00');
    expect(withoutOff.OffsetTimeOriginal).toBeUndefined();
  });

  it('produces a byte-identical TIFF for identical input (determinism)', () => {
    expect(withoutOffset()).toEqual(withoutOffset());
  });
});

describe('truncate — malformed TIFF helper', () => {
  it('produces a byte sequence shorter than a full IFD that exifr cannot extract fields from', async () => {
    const short = truncate(withoutOffset(), 10);
    expect(short.length).toBe(10);
    // exifr doesn't always throw for a truncated buffer — it can resolve with
    // no usable fields (undefined) or an { errors: [...] } diagnostic object.
    // Either shape means "not a successfully parsed EXIF payload", which is
    // what the UNRECOGNIZED_RAW/truncated-TIFF malformed fixture needs.
    const result = await exifr.parse(Buffer.from(short), true).catch((err: unknown) => err);
    const usableFields =
      result && typeof result === 'object' && !('errors' in result)
        ? Object.keys(result).length
        : 0;
    expect(usableFields).toBe(0);
  });
});

describe('buildCr3 — minimal ISO-BMFF box structure', () => {
  it('starts with an ftyp box declaring the crx major brand', () => {
    const cmt1 = withoutOffset();
    const cmt2 = withoutOffset();
    const bytes = buildCr3({ cmt1, cmt2 });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ftypSize = view.getUint32(0, false);
    const fourcc = String.fromCharCode(...bytes.subarray(4, 8));
    expect(fourcc).toBe('ftyp');
    const majorBrand = String.fromCharCode(...bytes.subarray(8, 12));
    expect(majorBrand).toBe('crx ');
    expect(ftypSize).toBeGreaterThan(8);
  });

  it('follows ftyp with a moov box, then appends the CMT1/CMT2 payload blocks', () => {
    const cmt1 = withoutOffset();
    const cmt2 = withOffset();
    const bytes = buildCr3({ cmt1, cmt2 });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ftypSize = view.getUint32(0, false);
    const moovFourcc = String.fromCharCode(...bytes.subarray(ftypSize + 4, ftypSize + 8));
    expect(moovFourcc).toBe('moov');
    const moovSize = view.getUint32(ftypSize, false);
    const cmt1Offset = ftypSize + moovSize;
    expect(bytes.length).toBe(cmt1Offset + cmt1.length + cmt2.length);
    // Appended CMT1 block is itself a valid little-endian TIFF header.
    expect(bytes[cmt1Offset]).toBe(0x49);
    expect(bytes[cmt1Offset + 1]).toBe(0x49);
  });
});
