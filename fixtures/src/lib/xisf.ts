/**
 * Pure XISF monolithic-file builder (P0-06).
 *
 * XISF 1.0 monolithic file layout (https://pixinsight.com/xisf/):
 *   bytes 0-7    signature "XISF0100"
 *   bytes 8-11   header length, uint32 little-endian (byte length of the XML
 *                header text that follows, NOT including this 16-byte block)
 *   bytes 12-15  reserved, must be zero
 *   bytes 16..   UTF-8 XML header (the <xisf> document)
 *
 * This module only ever builds the signature + XML header — no image data
 * attachment is written (header-only rationale, same as the FITS builder);
 * the XML declares `location="attachment:offset:size"` so a real parser's
 * declared-attachment path is exercised, but the bytes end after the header.
 *
 * Pure module: Uint8Array in/out, no fs, no Electron (DD-002 layering).
 */

export const XISF_SIGNATURE = 'XISF0100';

export interface FitsKeywordSpec {
  name: string;
  value: string;
  comment?: string;
}

export interface XisfPropertySpec {
  id: string;
  type: string;
  value: string;
  comment?: string;
}

export interface BuildXisfOptions {
  imageGeometry: string; // e.g. "4656:3520:1"
  sampleFormat: string; // e.g. "UInt16"
  colorSpace: string; // e.g. "Gray"
  fitsKeywords?: FitsKeywordSpec[];
  properties?: XisfPropertySpec[];
  /** Declared (but unwritten) attachment location, e.g. "attachment:16416:32800000". */
  attachmentLocation: string;
}

function xmlEscape(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function fitsKeywordEl(k: FitsKeywordSpec): string {
  const comment = k.comment === undefined ? '' : ` comment="${xmlEscape(k.comment)}"`;
  return `    <FITSKeyword name="${xmlEscape(k.name)}" value="${xmlEscape(k.value)}"${comment}/>`;
}

function propertyEl(p: XisfPropertySpec): string {
  const comment = p.comment === undefined ? '' : ` comment="${xmlEscape(p.comment)}"`;
  return `    <Property id="${xmlEscape(p.id)}" type="${xmlEscape(p.type)}" value="${xmlEscape(p.value)}"${comment}/>`;
}

/** Build the well-formed XML header text (without the binary signature block). */
export function buildXisfXmlHeader(opts: BuildXisfOptions): string {
  const keywords = (opts.fitsKeywords ?? []).map(fitsKeywordEl).join('\n');
  const properties = (opts.properties ?? []).map(propertyEl).join('\n');
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<xisf version="1.0" xmlns="http://www.pixinsight.com/xisf">\n` +
    `  <Image geometry="${opts.imageGeometry}" sampleFormat="${opts.sampleFormat}" ` +
    `colorSpace="${opts.colorSpace}" location="${opts.attachmentLocation}">\n` +
    (keywords ? keywords + '\n' : '') +
    (properties ? properties + '\n' : '') +
    `  </Image>\n` +
    `</xisf>\n`
  );
}

function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function ascii(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

function concat(...chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

/** Full monolithic file bytes: 16-byte signature block + UTF-8 XML header. */
export function buildXisf(opts: BuildXisfOptions): Uint8Array {
  const xml = buildXisfXmlHeader(opts);
  const xmlBytes = utf8Bytes(xml);
  const block = new Uint8Array(16);
  block.set(ascii(XISF_SIGNATURE), 0);
  new DataView(block.buffer).setUint32(8, xmlBytes.length, true);
  // bytes 12-15 stay zero (reserved)
  return concat(block, xmlBytes);
}

/** Deliberately wrong signature (BAD_SIGNATURE malformed fixture). */
export function buildBadSignature(opts: BuildXisfOptions): Uint8Array {
  const good = buildXisf(opts);
  const bytes = good.slice();
  bytes.set(ascii('XISF9999'), 0);
  return bytes;
}

/** Well-formed signature/length, but the XML body has an unclosed tag. */
export function buildMalformedXml(): Uint8Array {
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<xisf version="1.0" xmlns="http://www.pixinsight.com/xisf">\n` +
    `  <Image geometry="1024:768:1" sampleFormat="UInt16" colorSpace="Gray">\n` +
    `    <FITSKeyword name="OBJECT" value="M 31"/>\n` +
    // Deliberately missing the closing </Image> and </xisf> tags.
    '';
  const xmlBytes = utf8Bytes(xml);
  const block = new Uint8Array(16);
  block.set(ascii(XISF_SIGNATURE), 0);
  new DataView(block.buffer).setUint32(8, xmlBytes.length, true);
  return concat(block, xmlBytes);
}

export { utf8Bytes as xisfUtf8Bytes };
