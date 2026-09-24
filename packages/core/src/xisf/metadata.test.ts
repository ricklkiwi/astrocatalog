/**
 * FrameMetadata normalization tests (P1-02): FITSKeyword-priority extraction
 * with Property-element fallback, string-to-number coercion, and full
 * keyword preservation.
 */
import { describe, expect, it } from 'vitest';

import { parseXisfHeaderFromBuffer, PROLOGUE_BYTES, SIGNATURE } from './parse.js';
import { toFrameMetadata } from './metadata.js';
import type { XisfHeader, XisfProperty } from './types.js';

function headerWith(
  keywords: Record<string, string>,
  properties: Record<string, XisfProperty> = {},
): XisfHeader {
  return { keywords, properties, headerBytes: 256 };
}

/** Build real XISF prologue+XML bytes (mirrors parse.test.ts's builder) for a true end-to-end run. */
function buildXisf(xml: string): Uint8Array {
  const xmlBytes = new TextEncoder().encode(xml);
  const bytes = new Uint8Array(PROLOGUE_BYTES + xmlBytes.length);
  bytes.set(new TextEncoder().encode(SIGNATURE).subarray(0, 8), 0);
  new DataView(bytes.buffer).setUint32(8, xmlBytes.length, true);
  bytes.set(xmlBytes, PROLOGUE_BYTES);
  return bytes;
}

describe('toFrameMetadata', () => {
  it('extracts the PRD §8.2 critical set, coercing numeric strings', () => {
    const metadata = toFrameMetadata(
      headerWith({
        OBJECT: 'M 31',
        IMAGETYP: 'LIGHT',
        FILTER: 'Ha 3nm',
        EXPTIME: '300',
        'DATE-OBS': '2026-01-15T03:22:10.123',
        TELESCOP: 'Esprit 100ED',
        INSTRUME: 'ASI2600MM',
        'CCD-TEMP': '-10.1',
        GAIN: '100',
        OFFSET: '50',
        XBINNING: '1',
        YBINNING: '2',
        NAXIS1: '4656',
        NAXIS2: '3520',
        RA: '10.684708',
        DEC: '41.26875',
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
    });
  });

  it('falls back to EXPOSURE when EXPTIME is absent (SGPro convention)', () => {
    expect(toFrameMetadata(headerWith({ EXPOSURE: '600' })).exposureSeconds).toBe(600);
    expect(toFrameMetadata(headerWith({ EXPTIME: '120', EXPOSURE: '600' })).exposureSeconds).toBe(
      120,
    );
    expect(toFrameMetadata(headerWith({})).exposureSeconds).toBeNull();
  });

  it('falls back to Property elements when the equivalent FITSKeyword is absent', () => {
    const metadata = toFrameMetadata(
      headerWith(
        {},
        {
          'Observation:Object:Name': { type: 'String', value: 'M 42' },
          'Instrument:Filter:Name': { type: 'String', value: 'OIII' },
          'Instrument:Telescope:Name': { type: 'String', value: 'Esprit 100ED' },
          'Instrument:ExposureTime': { type: 'Float32', value: '180' },
          'Instrument:Sensor:Temperature': { type: 'Float32', value: '-5.5' },
          'Observation:Time:Start': { type: 'TimePoint', value: '2026-02-02T01:00:00.000' },
        },
      ),
    );
    expect(metadata.object).toBe('M 42');
    expect(metadata.filter).toBe('OIII');
    expect(metadata.telescope).toBe('Esprit 100ED');
    expect(metadata.exposureSeconds).toBe(180);
    expect(metadata.ccdTempCelsius).toBe(-5.5);
    expect(metadata.dateObs).toBe('2026-02-02T01:00:00.000');
  });

  it('prefers FITSKeyword over Property when both are present', () => {
    const metadata = toFrameMetadata(
      headerWith(
        { OBJECT: 'M 31' },
        { 'Observation:Object:Name': { type: 'String', value: 'Should not win' } },
      ),
    );
    expect(metadata.object).toBe('M 31');
  });

  it('converts sexagesimal OBJCTRA/OBJCTDEC when numeric RA/DEC are absent', () => {
    const metadata = toFrameMetadata(headerWith({ OBJCTRA: '13 29 53', OBJCTDEC: '+47 11 43' }));
    expect(metadata.raDegrees).toBeCloseTo(202.470833, 4);
    expect(metadata.decDegrees).toBeCloseTo(47.195278, 4);
  });

  it('maps absent or non-numeric keywords to null', () => {
    const metadata = toFrameMetadata(headerWith({ GAIN: 'not-a-number' }));
    expect(metadata.object).toBeNull();
    expect(metadata.gain).toBeNull();
    expect(metadata.filter).toBeNull();
  });

  it('preserves every FITSKeyword — normalized and unknown — in headers', () => {
    const keywords: Record<string, string> = {
      OBJECT: 'M 42',
      SWCREATE: 'PixInsight',
    };
    const metadata = toFrameMetadata(headerWith(keywords));
    expect(metadata.headers).toStrictEqual(keywords);
    expect(metadata.headers).not.toBe(keywords);
  });

  it('end-to-end (#129): a PixInsight-style header with FITS-quoted string values yields unquoted scalar fields and headers_json', () => {
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<xisf version="1.0"><Image geometry="1:1:1">` +
      `<FITSKeyword name="OBJECT" value="'FlatWizard'"/>` +
      `<FITSKeyword name="IMAGETYP" value="'Master Flat'"/>` +
      `<FITSKeyword name="FILTER" value="'NoFilter'"/>` +
      `<FITSKeyword name="TELESCOP" value="'WO Gt 71'"/>` +
      `<FITSKeyword name="INSTRUME" value="'ZWO ASI533MC Pro'"/>` +
      `<FITSKeyword name="EXPTIME" value="1.0"/>` +
      `</Image></xisf>`;
    const parsed = parseXisfHeaderFromBuffer(buildXisf(xml));
    expect(parsed.status).toBe('ok');
    if (parsed.status !== 'ok') return;

    const metadata = toFrameMetadata(parsed.header);
    expect(metadata.telescope).toBe('WO Gt 71');
    expect(metadata.instrument).toBe('ZWO ASI533MC Pro');
    expect(metadata.object).toBe('FlatWizard');
    expect(metadata.filter).toBe('NoFilter');
    expect(metadata.imageType).toBe('Master Flat');
    // headers_json (metadata.headers) carries the same decoded form — never
    // PixInsight's raw quoted syntax (DD-004 "preserve everything", kept
    // lossless *and* consistent with what the FITS path stores there).
    expect(metadata.headers.TELESCOP).toBe('WO Gt 71');
  });
});
