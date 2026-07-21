/**
 * FrameMetadata normalization tests (P1-03): ISO→gain mapping, OBJECT/FILTER
 * always null, camera Make+Model→instrument combination, and capture-time
 * UTC normalization (with and without an EXIF offset).
 */
import { describe, expect, it } from 'vitest';

import { cameraInstrument, normalizeDateObs, toFrameMetadata } from './metadata.js';
import type { RawHeader, RawKeywords } from './types.js';

function keywords(overrides: Partial<RawKeywords> = {}): RawKeywords {
  return {
    OBJECT: null,
    FILTER: null,
    Make: null,
    Model: null,
    ExposureTime: null,
    ISO: null,
    DateTimeOriginal: null,
    OffsetTimeOriginal: null,
    ...overrides,
  };
}

function headerWith(overrides: Partial<RawKeywords> = {}, tags: RawHeader['tags'] = {}): RawHeader {
  return { keywords: keywords(overrides), tags };
}

describe('normalizeDateObs', () => {
  it('converts a local reading with a positive offset to a true UTC instant', () => {
    // 22:11:03 +02:00 on 2026-04-05 -> 20:11:03 UTC same day.
    expect(normalizeDateObs('2026:04:05 22:11:03', '+02:00')).toBe('2026-04-05T20:11:03Z');
  });

  it('converts a local reading with a negative offset to a true UTC instant', () => {
    // 01:00:00 -05:00 -> 06:00:00 UTC same day.
    expect(normalizeDateObs('2026:04:06 01:00:00', '-05:00')).toBe('2026-04-06T06:00:00Z');
  });

  it('rolls the date forward across midnight when the offset conversion crosses a day boundary', () => {
    // 23:30:00 +02:00 on 2026-04-05 -> 21:30:00 UTC same day... use a case that actually rolls:
    // 01:00:00 +03:00 -> 22:00:00 UTC the *previous* day.
    expect(normalizeDateObs('2026:04:06 01:00:00', '+03:00')).toBe('2026-04-05T22:00:00Z');
  });

  it('emits a Z-less local timestamp when no offset is available (undecidable UTC instant)', () => {
    expect(normalizeDateObs('2026:04:06 01:20:00', null)).toBe('2026-04-06T01:20:00');
  });

  it('ignores a malformed offset and falls back to the Z-less local form', () => {
    expect(normalizeDateObs('2026:04:06 01:20:00', 'not-an-offset')).toBe('2026-04-06T01:20:00');
  });

  it('returns null for a malformed or absent DateTimeOriginal', () => {
    expect(normalizeDateObs(null, '+02:00')).toBeNull();
    expect(normalizeDateObs('not a date', '+02:00')).toBeNull();
    expect(normalizeDateObs('2026-04-06 01:20:00', null)).toBeNull(); // wrong separator (- instead of :)
  });
});

describe('cameraInstrument', () => {
  it('uses Model alone when it already mentions the Make brand token', () => {
    expect(cameraInstrument('Canon', 'Canon EOS 6D')).toBe('Canon EOS 6D');
    expect(cameraInstrument('NIKON CORPORATION', 'NIKON Z 6')).toBe('NIKON Z 6');
  });

  it('combines Make and Model when Model does not mention the brand', () => {
    expect(cameraInstrument('SONY', 'ILCE-7M4')).toBe('SONY ILCE-7M4');
  });

  it('falls back to whichever of Make/Model is present', () => {
    expect(cameraInstrument('Canon', null)).toBe('Canon');
    expect(cameraInstrument(null, 'ILCE-7M4')).toBe('ILCE-7M4');
    expect(cameraInstrument(null, null)).toBeNull();
  });

  it('is case-insensitive when detecting the brand token inside Model', () => {
    expect(cameraInstrument('canon', 'CANON EOS R6')).toBe('CANON EOS R6');
  });
});

describe('toFrameMetadata', () => {
  it('maps ExposureTime to exposureSeconds and ISO to gain', () => {
    const metadata = toFrameMetadata(headerWith({ ExposureTime: 0.005, ISO: 800 }));
    expect(metadata.exposureSeconds).toBe(0.005);
    expect(metadata.gain).toBe(800);
  });

  it('always reports OBJECT and FILTER as null — EXIF has no equivalent field', () => {
    const metadata = toFrameMetadata(
      headerWith({ Make: 'Canon', Model: 'Canon EOS 6D', ExposureTime: 0.005, ISO: 800 }),
    );
    expect(metadata.object).toBeNull();
    expect(metadata.filter).toBeNull();
  });

  it('leaves every astronomy-specific field null — RAW/EXIF carries none of them', () => {
    const metadata = toFrameMetadata(
      headerWith({ Make: 'Canon', Model: 'Canon EOS 6D', ExposureTime: 0.005, ISO: 800 }),
    );
    expect(metadata.imageType).toBeNull();
    expect(metadata.telescope).toBeNull();
    expect(metadata.ccdTempCelsius).toBeNull();
    expect(metadata.offset).toBeNull();
    expect(metadata.binningX).toBeNull();
    expect(metadata.binningY).toBeNull();
    expect(metadata.widthPixels).toBeNull();
    expect(metadata.heightPixels).toBeNull();
    expect(metadata.raDegrees).toBeNull();
    expect(metadata.decDegrees).toBeNull();
    expect(metadata.observer).toBeNull();
    expect(metadata.siteName).toBeNull();
    expect(metadata.airmass).toBeNull();
    expect(metadata.focalLengthMm).toBeNull();
    expect(metadata.apertureDiameterMm).toBeNull();
    expect(metadata.pierSide).toBeNull();
    expect(metadata.rotatorAngleDegrees).toBeNull();
    expect(metadata.bayerPattern).toBeNull();
    expect(metadata.rowOrder).toBeNull();
    expect(metadata.setTempCelsius).toBeNull();
    expect(metadata.sensorReadoutHz).toBeNull();
    expect(metadata.electronsPerAdu).toBeNull();
  });

  it('maps camera model into instrument, deduplicating the brand token', () => {
    const metadata = toFrameMetadata(headerWith({ Make: 'Canon', Model: 'Canon EOS 6D' }));
    expect(metadata.instrument).toBe('Canon EOS 6D');
  });

  it('normalizes dateObs to UTC when an offset is present', () => {
    const metadata = toFrameMetadata(
      headerWith({ DateTimeOriginal: '2026:04:05 22:11:03', OffsetTimeOriginal: '+02:00' }),
    );
    expect(metadata.dateObs).toBe('2026-04-05T20:11:03Z');
  });

  it('normalizes dateObs to a Z-less local timestamp when no offset is present', () => {
    const metadata = toFrameMetadata(headerWith({ DateTimeOriginal: '2026:04:06 01:20:00' }));
    expect(metadata.dateObs).toBe('2026-04-06T01:20:00');
  });

  it('preserves the full raw tag dictionary in headers, flattening arrays to JSON strings', () => {
    const tags = { Make: 'Canon', GPSCoordinates: [45.5, -73.6, 12] };
    const metadata = toFrameMetadata(headerWith({ Make: 'Canon' }, tags));
    expect(metadata.headers).toStrictEqual({ Make: 'Canon', GPSCoordinates: '[45.5,-73.6,12]' });
    expect(metadata.headers).not.toBe(tags);
  });
});
