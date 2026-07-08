import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import {
  XISF_SIGNATURE,
  buildBadSignature,
  buildMalformedXml,
  buildXisf,
  buildXisfXmlHeader,
} from './xisf.js';

const decodeAscii = (bytes: Uint8Array, start: number, end: number) =>
  String.fromCharCode(...bytes.subarray(start, end));

const baseOpts = {
  imageGeometry: '1024:768:1',
  sampleFormat: 'UInt16',
  colorSpace: 'Gray',
  attachmentLocation: 'attachment:16416:1572864',
  fitsKeywords: [{ name: 'OBJECT', value: 'M 31', comment: 'Target name' }],
  properties: [{ id: 'Observation:Object:Name', type: 'String', value: 'M 31' }],
};

describe('buildXisf — signature and header length encoding', () => {
  it('writes the 8-byte "XISF0100" signature at offset 0', () => {
    const bytes = buildXisf(baseOpts);
    expect(decodeAscii(bytes, 0, 8)).toBe(XISF_SIGNATURE);
  });

  it('encodes the XML header length as little-endian uint32 at offset 8', () => {
    const bytes = buildXisf(baseOpts);
    const xml = buildXisfXmlHeader(baseOpts);
    const expectedLen = new TextEncoder().encode(xml).length;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(8, true)).toBe(expectedLen);
    expect(bytes.length).toBe(16 + expectedLen);
  });

  it('leaves the 4 reserved bytes (12-15) zero', () => {
    const bytes = buildXisf(baseOpts);
    expect(Array.from(bytes.subarray(12, 16))).toEqual([0, 0, 0, 0]);
  });

  it('produces well-formed XML containing the declared FITSKeyword and Property elements', () => {
    const bytes = buildXisf(baseOpts);
    const xml = decodeAscii(bytes, 16, bytes.length);
    expect(XMLValidator.validate(xml)).toBe(true);
    const parsed = new XMLParser({ ignoreAttributes: false }).parse(xml);
    const image = parsed.xisf.Image;
    expect(image['@_geometry']).toBe('1024:768:1');
    expect(image.FITSKeyword['@_name']).toBe('OBJECT');
    expect(image.FITSKeyword['@_value']).toBe('M 31');
    expect(image.Property['@_id']).toBe('Observation:Object:Name');
  });
});

describe('negative fixtures', () => {
  it('buildBadSignature corrupts only the signature, keeping the XML well-formed', () => {
    const bytes = buildBadSignature(baseOpts);
    expect(decodeAscii(bytes, 0, 8)).not.toBe(XISF_SIGNATURE);
    const xml = decodeAscii(bytes, 16, bytes.length);
    expect(XMLValidator.validate(xml)).toBe(true);
  });

  it('buildMalformedXml keeps a valid signature but produces invalid XML', () => {
    const bytes = buildMalformedXml();
    expect(decodeAscii(bytes, 0, 8)).toBe(XISF_SIGNATURE);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const declaredLen = view.getUint32(8, true);
    expect(bytes.length).toBe(16 + declaredLen);
    const xml = decodeAscii(bytes, 16, bytes.length);
    expect(XMLValidator.validate(xml)).not.toBe(true);
  });
});
