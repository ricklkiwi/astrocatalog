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

  it('follows ftyp with a moov box whose Canon uuid box carries CMT1/CMT2 as direct sibling boxes', () => {
    const cmt1 = withoutOffset();
    const cmt2 = withOffset();
    const bytes = buildCr3({ cmt1, cmt2 });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const ftypSize = view.getUint32(0, false);
    const moovFourcc = String.fromCharCode(...bytes.subarray(ftypSize + 4, ftypSize + 8));
    expect(moovFourcc).toBe('moov');
    const moovSize = view.getUint32(ftypSize, false);
    // Nothing appended after moov — CMT1/CMT2 live inside it now, as direct
    // sibling boxes in the Canon uuid box (real Canon layout, not an
    // offset-referenced appendix).
    expect(bytes.length).toBe(ftypSize + moovSize);

    // Walk moov -> uuid -> find CMT1/CMT2 by box type, confirm each payload
    // is itself a valid little-endian TIFF header.
    const uuidStart = ftypSize + 8;
    const uuidPayloadStart = uuidStart + 8 + 16; // box header(8) + uuid(16)
    const uuidSize = view.getUint32(uuidStart, false);
    let offset = uuidPayloadStart;
    const found: Record<string, number> = {};
    while (offset < uuidStart + uuidSize) {
      const size = view.getUint32(offset, false);
      const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      found[type] = offset + 8;
      offset += size;
    }
    expect(found.CMT1).toBeDefined();
    expect(found.CMT2).toBeDefined();
    expect(bytes[found.CMT1!]).toBe(0x49);
    expect(bytes[found.CMT1! + 1]).toBe(0x49);
    expect(bytes[found.CMT2!]).toBe(0x49);
    expect(bytes[found.CMT2! + 1]).toBe(0x49);
  });
});
