/**
 * Unit tests for XISF header-parsing internals (P1-02) not otherwise covered
 * by the fixture corpus: entity decoding, comments/processing instructions,
 * quote styles, tag-balance errors, and prologue-field bounds.
 */
import { describe, expect, it } from 'vitest';

import { MAX_XML_BYTES, PROLOGUE_BYTES, SIGNATURE, parseXisfHeaderFromBuffer } from './parse.js';

function buildXisf(
  xml: string,
  options?: { headerLength?: number; signature?: string },
): Uint8Array {
  const xmlBytes = new TextEncoder().encode(xml);
  const signature = new TextEncoder().encode(options?.signature ?? SIGNATURE);
  const headerLength = options?.headerLength ?? xmlBytes.length;

  const bytes = new Uint8Array(PROLOGUE_BYTES + xmlBytes.length);
  bytes.set(signature.subarray(0, 8), 0);
  new DataView(bytes.buffer).setUint32(8, headerLength, true);
  bytes.set(xmlBytes, PROLOGUE_BYTES);
  return bytes;
}

const IMAGE_XML = (inner: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><xisf version="1.0"><Image geometry="1:1:1">${inner}</Image></xisf>`;

describe('parseXisfHeaderFromBuffer', () => {
  it('decodes named and numeric XML entities in attribute values', () => {
    const result = parseXisfHeaderFromBuffer(
      buildXisf(
        IMAGE_XML(
          '<FITSKeyword name="OBJECT" value="M 31 &amp; M 32 &lt;test&gt; &quot;q&quot; &apos;a&apos; &#65;&#x42;"/>',
        ),
      ),
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.header.keywords.OBJECT).toBe('M 31 & M 32 <test> "q" \'a\' AB');
  });

  it('accepts single-quoted attribute values', () => {
    const result = parseXisfHeaderFromBuffer(
      buildXisf(IMAGE_XML("<FITSKeyword name='FILTER' value='Ha 3nm'/>")),
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.header.keywords.FILTER).toBe('Ha 3nm');
  });

  it('skips comments and processing instructions without affecting tag balance', () => {
    const result = parseXisfHeaderFromBuffer(
      buildXisf(
        `<?xml version="1.0"?><xisf version="1.0"><!-- a comment with <fake> tags --><Image geometry="1:1:1"><FITSKeyword name="OBJECT" value="M 31"/></Image></xisf>`,
      ),
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.header.keywords.OBJECT).toBe('M 31');
  });

  it('captures Property elements separately from FITSKeyword', () => {
    const result = parseXisfHeaderFromBuffer(
      buildXisf(IMAGE_XML('<Property id="Instrument:ExposureTime" type="Float32" value="300"/>')),
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.header.properties['Instrument:ExposureTime']).toStrictEqual({
      type: 'Float32',
      value: '300',
    });
    expect(result.header.keywords).toStrictEqual({});
  });

  it('last occurrence wins for a duplicate FITSKeyword name', () => {
    const result = parseXisfHeaderFromBuffer(
      buildXisf(
        IMAGE_XML('<FITSKeyword name="GAIN" value="100"/><FITSKeyword name="GAIN" value="200"/>'),
      ),
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.header.keywords.GAIN).toBe('200');
  });

  it('returns MALFORMED_XML for a mismatched closing tag', () => {
    const result = parseXisfHeaderFromBuffer(
      buildXisf('<xisf version="1.0"><Image geometry="1:1:1"></xisf></Image>'),
    );
    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.error.code).toBe('MALFORMED_XML');
  });

  it('returns MALFORMED_XML for an unterminated attribute quote', () => {
    const result = parseXisfHeaderFromBuffer(
      buildXisf(IMAGE_XML('<FITSKeyword name="OBJECT" value="M 31/>')),
    );
    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.error.code).toBe('MALFORMED_XML');
  });

  it('returns EMPTY_FILE for a zero-byte input', () => {
    const result = parseXisfHeaderFromBuffer(new Uint8Array(0));
    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.error.code).toBe('EMPTY_FILE');
  });

  it('returns TRUNCATED_HEADER when fewer than 8 bytes are available', () => {
    const result = parseXisfHeaderFromBuffer(new TextEncoder().encode('XISF'));
    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.error.code).toBe('TRUNCATED_HEADER');
  });

  it('returns BAD_SIGNATURE before trusting the declared header length', () => {
    const bytes = buildXisf(IMAGE_XML(''), { signature: 'NOTXISF!', headerLength: 999_999 });
    const result = parseXisfHeaderFromBuffer(bytes);
    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.error.code).toBe('BAD_SIGNATURE');
  });

  it('returns TRUNCATED_HEADER when the declared header length exceeds the trusted maximum', () => {
    const bytes = buildXisf(IMAGE_XML(''), { headerLength: MAX_XML_BYTES + 1 });
    const result = parseXisfHeaderFromBuffer(bytes);
    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.error.code).toBe('TRUNCATED_HEADER');
  });

  it('returns TRUNCATED_HEADER when the buffer is shorter than the declared XML length', () => {
    const xml = IMAGE_XML('');
    const bytes = buildXisf(xml, { headerLength: xml.length + 100 });
    const result = parseXisfHeaderFromBuffer(bytes);
    expect(result.status).toBe('error');
    if (result.status !== 'error') return;
    expect(result.error.code).toBe('TRUNCATED_HEADER');
  });
});
