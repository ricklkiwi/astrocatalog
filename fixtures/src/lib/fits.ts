/**
 * Pure FITS header builders (P0-06).
 *
 * Turns declarative card lists into byte-exact FITS headers per the FITS 4.0
 * standard (https://fits.gsfc.nasa.gov/fits_standard.html): fixed-format
 * 80-character cards, quoted strings with '' escaping, the CONTINUE
 * long-string convention, COMMENT/HISTORY/blank commentary cards, the END
 * card, and space padding to 2880-byte block boundaries.
 *
 * Deliberately broken output (missing END, unpadded blocks, overlong/short
 * cards, non-ASCII bytes) is supported through `raw` cards and build options —
 * the malformed fixture set depends on it.
 *
 * Pure module: Uint8Array in/out, no fs, no Electron (DD-002 layering).
 */

export const BLOCK_BYTES = 2880;
export const CARD_BYTES = 80;
export const CARDS_PER_BLOCK = BLOCK_BYTES / CARD_BYTES;

export type CardSpec =
  | {
      kind: 'value';
      keyword: string;
      value: string | number | boolean;
      /** Exact source text for numeric values (e.g. '300.0' instead of '300'). */
      repr?: string;
      comment?: string;
    }
  | { kind: 'commentary'; keyword: 'COMMENT' | 'HISTORY' | ''; text: string }
  /** Escape hatch: exact card text. Space-padded to 80 unless `exactLength`. */
  | { kind: 'raw'; text: string; exactLength?: boolean };

/** Shorthand constructors so definitions read as data. */
export function card(
  keyword: string,
  value: string | number | boolean,
  comment?: string,
): CardSpec {
  return { kind: 'value', keyword, value, comment };
}

/** Numeric card with an exact textual representation, e.g. num('EXPTIME', 300, '300.0'). */
export function num(keyword: string, value: number, repr: string, comment?: string): CardSpec {
  return { kind: 'value', keyword, value, repr, comment };
}

export function comment(text: string): CardSpec {
  return { kind: 'commentary', keyword: 'COMMENT', text };
}

export function history(text: string): CardSpec {
  return { kind: 'commentary', keyword: 'HISTORY', text };
}

export function blank(): CardSpec {
  return { kind: 'commentary', keyword: '', text: '' };
}

export function raw(text: string, exactLength = false): CardSpec {
  return { kind: 'raw', text, exactLength };
}

const KEYWORD_RE = /^[A-Z0-9_-]{1,8}$/;

function escapeString(value: string): string {
  return value.replaceAll("'", "''");
}

/** Serialize one card spec to its exact card text. */
export function formatCard(spec: CardSpec): string {
  if (spec.kind === 'raw') {
    if (spec.exactLength) return spec.text;
    if (spec.text.length > CARD_BYTES) {
      throw new Error(`raw card longer than ${CARD_BYTES} bytes: ${spec.text.slice(0, 20)}…`);
    }
    return spec.text.padEnd(CARD_BYTES);
  }

  if (spec.kind === 'commentary') {
    const head = spec.keyword.padEnd(8);
    const text = head + spec.text;
    if (text.length > CARD_BYTES) {
      throw new Error(`commentary card longer than ${CARD_BYTES} bytes: ${spec.text}`);
    }
    return text.padEnd(CARD_BYTES);
  }

  const { keyword, value, repr, comment: cmt } = spec;
  if (!KEYWORD_RE.test(keyword)) {
    throw new Error(`invalid FITS keyword: '${keyword}' (use raw() for deliberate breakage)`);
  }

  let body: string;
  if (typeof value === 'string') {
    // Fixed format: opening quote in column 11, content padded to >= 8 chars,
    // '' escaping per the standard.
    body = `'${escapeString(value).padEnd(8)}'`;
  } else if (typeof value === 'boolean') {
    // Logical T/F in column 30.
    body = (value ? 'T' : 'F').padStart(20);
  } else {
    if (!Number.isFinite(value)) throw new Error(`non-finite value for ${keyword}`);
    const text = repr ?? String(value);
    if (Number(text) !== value) {
      throw new Error(`repr '${text}' does not round-trip to ${value} for ${keyword}`);
    }
    // Numbers right-justified so the value ends in column 30.
    body = text.padStart(20);
  }

  let text = keyword.padEnd(8) + '= ' + body;
  if (cmt !== undefined) {
    text = text.padEnd(Math.max(text.length, 30)) + ' / ' + cmt;
  }
  if (text.length > CARD_BYTES) {
    throw new Error(`card for ${keyword} longer than ${CARD_BYTES} bytes`);
  }
  return text.padEnd(CARD_BYTES);
}

/**
 * Registered CONTINUE long-string convention (FITS 4.0 §4.2.1.2): the value
 * ends with '&' inside the quotes and continues on CONTINUE cards. Callers
 * should also include a LONGSTRN card (see `longstrnCard`).
 */
export function longStringCards(keyword: string, value: string, comment?: string): CardSpec[] {
  if (!KEYWORD_RE.test(keyword)) throw new Error(`invalid FITS keyword: '${keyword}'`);
  const CHUNK = 60;
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += CHUNK) chunks.push(value.slice(i, i + CHUNK));
  if (chunks.length === 0) chunks.push('');

  const cards: CardSpec[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const isFirst = i === 0;
    const isLast = i === chunks.length - 1;
    const escaped = escapeString(chunks[i] ?? '');
    if (escaped.length > 64) {
      throw new Error(`longStringCards: escaped chunk exceeds card capacity for ${keyword}`);
    }
    const body = `'${escaped}${isLast ? '' : '&'}'`;
    let text = isFirst ? keyword.padEnd(8) + '= ' + body : 'CONTINUE  ' + body;
    if (isLast && comment !== undefined) {
      text = text.padEnd(Math.max(text.length, 30)) + ' / ' + comment;
    }
    if (text.length > CARD_BYTES) throw new Error(`CONTINUE card overflow for ${keyword}`);
    cards.push(raw(text));
  }
  return cards;
}

/** LONGSTRN convention-declaration card that accompanies CONTINUE usage. */
export function longstrnCard(): CardSpec {
  return card('LONGSTRN', 'OGIP 1.0', 'The CONTINUE long string convention is used');
}

export const END_CARD = 'END'.padEnd(CARD_BYTES);

export interface BuildHeaderOptions {
  /** Append the END card (default true). Disable for MISSING_END fixtures. */
  includeEnd?: boolean;
  /** Pad with spaces to a 2880-byte boundary (default true). */
  pad?: boolean;
}

function ascii(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0xff) throw new Error(`non-byte character U+${code.toString(16)} in card text`);
    bytes[i] = code;
  }
  return bytes;
}

/** Serialize cards (+ END) and pad to the 2880-byte block boundary. */
export function buildHeader(cards: readonly CardSpec[], opts: BuildHeaderOptions = {}): Uint8Array {
  const { includeEnd = true, pad = true } = opts;
  let text = cards.map(formatCard).join('');
  if (includeEnd) text += END_CARD;
  if (pad) {
    const remainder = text.length % BLOCK_BYTES;
    if (remainder !== 0) text += ' '.repeat(BLOCK_BYTES - remainder);
  }
  return ascii(text);
}

/** Number of cards buildHeader would serialize (including END when enabled). */
export function cardCount(cards: readonly CardSpec[], opts: BuildHeaderOptions = {}): number {
  const { includeEnd = true } = opts;
  return cards.length + (includeEnd ? 1 : 0);
}

/** Concatenate byte chunks (for malformed fixtures assembled by hand). */
export function concatBytes(...chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

export { ascii as asciiBytes };
