/**
 * FrameMetadata normalization tests (P1-01): PRD §8.2 critical + important
 * keyword extraction, EXPTIME/EXPOSURE fallback, sexagesimal pointing
 * conversion, and full keyword preservation.
 */
import { describe, expect, it } from 'vitest';

import { parseSexagesimal, toFrameMetadata } from './metadata.js';
import type { FitsHeader, FitsValue } from './types.js';

function headerWith(keywords: Record<string, FitsValue>): FitsHeader {
  return { keywords, cards: [], cardCount: 0, headerBytes: 2880 };
}

describe('parseSexagesimal', () => {
  it('parses space- and colon-separated triplets with signs', () => {
    expect(parseSexagesimal('00 42 44')).toBeCloseTo(0.712222, 5);
    expect(parseSexagesimal('13:29:53')).toBeCloseTo(13.498056, 5);
    expect(parseSexagesimal('+41 16 09')).toBeCloseTo(41.269167, 5);
    expect(parseSexagesimal('-05 23 28')).toBeCloseTo(-5.391111, 5);
    expect(parseSexagesimal('20 45 38.5')).toBeCloseTo(20.760694, 5);
  });

  it('rejects non-sexagesimal text and out-of-range components', () => {
    expect(parseSexagesimal('M 31')).toBeNull();
    expect(parseSexagesimal('12 61 00')).toBeNull();
    expect(parseSexagesimal('12 00 60')).toBeNull();
    expect(parseSexagesimal('12.5')).toBeNull();
  });
});

describe('toFrameMetadata', () => {
  it('extracts the PRD §8.2 critical set from a N.I.N.A.-style header', () => {
    const metadata = toFrameMetadata(
      headerWith({
        SIMPLE: true,
        OBJECT: 'M 31',
        IMAGETYP: 'LIGHT',
        FILTER: 'Ha 3nm',
        EXPTIME: 300,
        EXPOSURE: 300,
        'DATE-OBS': '2026-01-15T03:22:10.123',
        TELESCOP: 'Esprit 100ED',
        INSTRUME: 'ASI2600MM',
        'CCD-TEMP': -10.1,
        GAIN: 100,
        OFFSET: 50,
        XBINNING: 1,
        YBINNING: 2,
        NAXIS1: 4656,
        NAXIS2: 3520,
        RA: 10.684708,
        DEC: 41.26875,
        EGAIN: 0.246,
        ROWORDER: 'TOP-DOWN',
      }),
    );
    expect(metadata).toMatchObject({
      object: 'M 31',
      imageType: 'LIGHT',
      filter: 'Ha 3nm',
      exposureSeconds: 300,
      dateObs: '2026-01-15T03:22:10.123',
      telescope: 'Esprit 100ED',
      instrument: 'ASI2600MM',
      ccdTempCelsius: -10.1,
      gain: 100,
      offset: 50,
      binningX: 1,
      binningY: 2,
      widthPixels: 4656,
      heightPixels: 3520,
      raDegrees: 10.684708,
      decDegrees: 41.26875,
      electronsPerAdu: 0.246,
      rowOrder: 'TOP-DOWN',
    });
  });

  it('falls back to EXPOSURE when EXPTIME is absent (SGPro convention)', () => {
    expect(toFrameMetadata(headerWith({ EXPOSURE: 600 })).exposureSeconds).toBe(600);
    expect(toFrameMetadata(headerWith({ EXPTIME: 120, EXPOSURE: 600 })).exposureSeconds).toBe(120);
    expect(toFrameMetadata(headerWith({})).exposureSeconds).toBeNull();
  });

  it('converts sexagesimal OBJCTRA/OBJCTDEC when numeric RA/DEC are absent', () => {
    const metadata = toFrameMetadata(headerWith({ OBJCTRA: '13 29 53', OBJCTDEC: '+47 11 43' }));
    expect(metadata.raDegrees).toBeCloseTo(202.470833, 4);
    expect(metadata.decDegrees).toBeCloseTo(47.195278, 4);
  });

  it('prefers numeric RA/DEC over sexagesimal pointing', () => {
    const metadata = toFrameMetadata(
      headerWith({ RA: 210.802417, DEC: 54.34875, OBJCTRA: '00 00 00', OBJCTDEC: '+00 00 00' }),
    );
    expect(metadata.raDegrees).toBe(210.802417);
    expect(metadata.decDegrees).toBe(54.34875);
  });

  it('maps absent keywords to null and ignores wrong-typed values', () => {
    const metadata = toFrameMetadata(headerWith({ OBJECT: 42, GAIN: 'high' }));
    expect(metadata.object).toBeNull();
    expect(metadata.gain).toBeNull();
    expect(metadata.filter).toBeNull();
    expect(metadata.pierSide).toBeNull();
  });

  it('preserves every keyword — normalized and unknown — in headers', () => {
    const keywords: Record<string, FitsValue> = {
      OBJECT: 'M 42',
      SWCREATE: 'SharpCap v4.1',
      USBSPEED: 40,
      BLKLEVEL: 30,
    };
    const metadata = toFrameMetadata(headerWith(keywords));
    expect(metadata.headers).toStrictEqual(keywords);
    expect(metadata.headers).not.toBe(keywords);
  });
});
