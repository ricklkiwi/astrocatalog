/**
 * Header-only XISF parser (P1-02).
 *
 * A XISF monolithic file opens with a fixed 16-byte prologue — an 8-byte
 * `"XISF0100"` signature, a little-endian uint32 XML header length, and 4
 * reserved bytes — followed by exactly that many bytes of UTF-8 XML (DD-004).
 * The parser validates the signature before trusting anything else, reads
 * only the declared XML region (never the pixel payload, which the XML's
 * `location="attachment:..."` attributes merely point at), and extracts
 * `<FITSKeyword name="..." value="..."/>` and `<Property id="..." .../>`
 * elements from within `<Image>`.
 *
 * Malformed input produces a structured {@link XisfParseError}; this module
 * never throws on file content and bounds the trusted header length, so it
 * never hangs (DD-004 error isolation).
 */

import type {
  XisfHeader,
  XisfParseError,
  XisfParseResult,
  XisfProperty,
  XisfReader,
} from './types.js';

export const SIGNATURE = 'XISF0100';
export const PROLOGUE_BYTES = 16;

/**
 * Upper bound on the declared XML header length (~16 MB). A declared length
 * beyond this is never trusted enough to request — guards against a
 * corrupt or hostile length field driving an unbounded read.
 */
export const MAX_XML_BYTES = 16 * 1024 * 1024;

type XisfErrorCode = XisfParseError['code'];

function errorResult(code: XisfErrorCode, message: string): XisfParseResult {
  return { status: 'error', error: { code, message } };
}

function decodeEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos|#x[0-9a-fA-F]+|#\d+);/g, (match, entity: string) => {
    switch (entity) {
      case 'amp':
        return '&';
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      default:
        if (entity.startsWith('#x')) return String.fromCodePoint(parseInt(entity.slice(2), 16));
        if (entity.startsWith('#')) return String.fromCodePoint(parseInt(entity.slice(1), 10));
        return match;
    }
  });
}

/** Parse `name="value"` attribute pairs from the text following a tag name. Returns null on malformed attribute syntax. */
function parseAttributes(text: string): Record<string, string> | null {
  const attrs: Record<string, string> = {};
  let i = 0;
  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i] ?? '')) i += 1;
    if (i >= text.length) break;

    const nameStart = i;
    while (i < text.length && text[i] !== '=' && !/\s/.test(text[i] ?? '')) i += 1;
    const name = text.slice(nameStart, i);
    if (name === '') return null;

    while (i < text.length && /\s/.test(text[i] ?? '')) i += 1;
    if (text[i] !== '=') return null;
    i += 1;
    while (i < text.length && /\s/.test(text[i] ?? '')) i += 1;

    const quote = text[i];
    if (quote !== '"' && quote !== "'") return null;
    i += 1;
    const valueStart = i;
    while (i < text.length && text[i] !== quote) i += 1;
    if (i >= text.length) return null; // unterminated attribute value
    attrs[name] = decodeEntities(text.slice(valueStart, i));
    i += 1; // skip closing quote
  }
  return attrs;
}

/** Find the index of the `>` terminating a tag started at `start` (just after `<`), skipping quoted attribute values. Returns null if unterminated. */
function findTagEnd(text: string, start: number): number | null {
  let i = start;
  let quote: string | null = null;
  while (i < text.length) {
    const ch = text[i];
    if (quote !== null) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      return i;
    }
    i += 1;
  }
  return null;
}

type XmlScanResult =
  | { ok: true; keywords: Record<string, string>; properties: Record<string, XisfProperty> }
  | { ok: false; message: string };

/**
 * Bounded, tolerant scan for the small subset of XML the XISF header uses:
 * a document element containing (possibly nested) elements, where the only
 * ones of interest — `FITSKeyword` and `Property` — are always empty
 * (self-closing) elements with plain attributes. Not a general XML parser:
 * validates tag balance (catches unclosed elements) and attribute syntax,
 * but does not resolve namespaces, CDATA, or DOCTYPE internal subsets.
 */
function scanXml(text: string): XmlScanResult {
  const keywords: Record<string, string> = {};
  const properties: Record<string, XisfProperty> = {};
  const stack: string[] = [];
  let i = 0;

  while (true) {
    const lt = text.indexOf('<', i);
    if (lt === -1) break;

    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      if (end === -1) return { ok: false, message: 'unterminated comment' };
      i = end + 3;
      continue;
    }
    if (text[lt + 1] === '?') {
      const end = text.indexOf('?>', lt);
      if (end === -1) return { ok: false, message: 'unterminated processing instruction' };
      i = end + 2;
      continue;
    }

    const gt = findTagEnd(text, lt + 1);
    if (gt === null) return { ok: false, message: `unterminated tag starting at position ${lt}` };
    const inner = text.slice(lt + 1, gt);
    i = gt + 1;

    if (inner.startsWith('!')) continue; // DOCTYPE or similar declaration — not expected, tolerated

    if (inner.startsWith('/')) {
      const closingName = inner.slice(1).trim();
      const top = stack.pop();
      if (top === undefined || top !== closingName) {
        return { ok: false, message: `mismatched closing tag </${closingName}>` };
      }
      continue;
    }

    let content = inner;
    let selfClosing = false;
    if (content.endsWith('/')) {
      selfClosing = true;
      content = content.slice(0, -1);
    }

    const nameMatch = /^([^\s/>]+)/.exec(content);
    if (nameMatch === null || nameMatch[1] === undefined) {
      return { ok: false, message: `malformed tag '<${inner}>'` };
    }
    const name = nameMatch[1];
    const attrs = parseAttributes(content.slice(name.length));
    if (attrs === null) return { ok: false, message: `malformed attributes in <${name}>` };

    if (name === 'FITSKeyword') {
      const keyword = attrs.name;
      if (keyword !== undefined) keywords[keyword] = attrs.value ?? '';
    } else if (name === 'Property') {
      const id = attrs.id;
      if (id !== undefined) properties[id] = { type: attrs.type ?? '', value: attrs.value ?? '' };
    }

    if (!selfClosing) stack.push(name);
  }

  if (stack.length > 0) {
    return { ok: false, message: `unclosed element(s): ${stack.join(', ')}` };
  }
  return { ok: true, keywords, properties };
}

function finishParse(xmlBytes: Uint8Array, headerBytes: number): XisfParseResult {
  const xmlText = new TextDecoder('utf-8').decode(xmlBytes);
  const scanned = scanXml(xmlText);
  if (!scanned.ok) return errorResult('MALFORMED_XML', scanned.message);
  const header: XisfHeader = {
    keywords: scanned.keywords,
    properties: scanned.properties,
    headerBytes,
  };
  return { status: 'ok', header };
}

function checkPrologue(prologue: Uint8Array): { headerLength: number } | XisfParseResult {
  if (prologue.length === 0) return errorResult('EMPTY_FILE', 'file contains no bytes');
  if (prologue.length < 8) {
    return errorResult(
      'TRUNCATED_HEADER',
      `file is ${prologue.length} bytes, too short to read the signature`,
    );
  }
  const signature = String.fromCharCode(...prologue.subarray(0, 8));
  if (signature !== SIGNATURE) {
    return errorResult('BAD_SIGNATURE', `signature is '${signature}', expected '${SIGNATURE}'`);
  }
  if (prologue.length < PROLOGUE_BYTES) {
    return errorResult(
      'TRUNCATED_HEADER',
      `file is ${prologue.length} bytes, too short to read the header-length field`,
    );
  }
  const view = new DataView(prologue.buffer, prologue.byteOffset, prologue.byteLength);
  const headerLength = view.getUint32(8, true);
  if (headerLength > MAX_XML_BYTES) {
    return errorResult(
      'TRUNCATED_HEADER',
      `declared XML header length ${headerLength} exceeds the trusted maximum of ${MAX_XML_BYTES} bytes`,
    );
  }
  return { headerLength };
}

/** Parse a XISF header through a bounded-read callback (async reader, DD-002/DD-004). */
export async function parseXisfHeader(read: XisfReader): Promise<XisfParseResult> {
  const prologue = await read(0, PROLOGUE_BYTES);
  const checked = checkPrologue(prologue);
  if ('status' in checked) return checked;

  const { headerLength } = checked;
  const xmlBytes = await read(PROLOGUE_BYTES, headerLength);
  if (xmlBytes.length < headerLength) {
    return errorResult(
      'TRUNCATED_HEADER',
      `XML header region is ${xmlBytes.length} bytes, expected ${headerLength}`,
    );
  }
  return finishParse(xmlBytes, PROLOGUE_BYTES + headerLength);
}

/** Synchronous variant over an in-memory buffer (e.g. a whole file already read by the caller). Identical semantics to {@link parseXisfHeader}. */
export function parseXisfHeaderFromBuffer(bytes: Uint8Array): XisfParseResult {
  const checked = checkPrologue(bytes.subarray(0, PROLOGUE_BYTES));
  if ('status' in checked) return checked;

  const { headerLength } = checked;
  const xmlBytes = bytes.subarray(PROLOGUE_BYTES, PROLOGUE_BYTES + headerLength);
  if (xmlBytes.length < headerLength) {
    return errorResult(
      'TRUNCATED_HEADER',
      `XML header region is ${xmlBytes.length} bytes, expected ${headerLength}`,
    );
  }
  return finishParse(xmlBytes, PROLOGUE_BYTES + headerLength);
}
