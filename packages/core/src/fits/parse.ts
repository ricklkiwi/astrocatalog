/**
 * Header-only FITS parser (P1-01).
 *
 * Reads 2880-byte blocks through a caller-supplied reader until the END card
 * (DD-004: header-only, never the pixel payload), parses fixed/free-format
 * 80-character cards per FITS 4.0 — quoted strings with `''` escaping, the
 * registered CONTINUE long-string convention, logical T/F, integer and real
 * values (including D exponents), COMMENT/HISTORY/blank commentary cards —
 * and tolerates non-standard no-value cards (e.g. HIERARCH) by preserving
 * them raw.
 *
 * Malformed input produces a structured {@link FitsParseError}; this module
 * never throws on file content and is bounded by {@link MAX_HEADER_BLOCKS},
 * so it never hangs (DD-004 error isolation).
 */

import type {
  FitsCard,
  FitsHeader,
  FitsParseError,
  FitsParseResult,
  FitsReader,
  FitsValue,
} from './types.js';

export const BLOCK_BYTES = 2880;
export const CARD_BYTES = 80;
export const CARDS_PER_BLOCK = BLOCK_BYTES / CARD_BYTES;

/**
 * Upper bound on header size (~2.8 MB). A header with no END card inside
 * this many blocks reports MISSING_END instead of scanning a multi-gigabyte
 * file forever.
 */
export const MAX_HEADER_BLOCKS = 1000;

const KEYWORD_RE = /^[A-Z0-9_-]*$/;
const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[EDed][+-]?\d+)?$/;

/** Decode one validated card image (restricted ASCII) to a string. */
function decodeCard(block: Uint8Array, start: number): string {
  return String.fromCharCode(...block.subarray(start, start + CARD_BYTES));
}

type ValueParse =
  | { ok: true; value: FitsValue; comment?: string; continued: boolean }
  | { ok: false; reason: string; unterminated?: boolean };

/** Parse the text after a closing quote or value token: spaces, then an optional `/ comment`. */
function parseTrailer(rest: string): { ok: true; comment?: string } | { ok: false } {
  const trimmed = rest.trimStart();
  if (trimmed === '') return { ok: true };
  if (trimmed.startsWith('/')) return { ok: true, comment: trimmed.slice(1).trim() };
  return { ok: false };
}

/**
 * Parse a quoted string starting at `field[start]` (which must be `'`).
 * Returns the verbatim content (with `''` unescaped, trailing spaces kept)
 * and the index just past the closing quote.
 */
function parseQuoted(
  field: string,
  start: number,
): { ok: true; content: string; end: number } | { ok: false } {
  let content = '';
  let i = start + 1;
  while (i < field.length) {
    const ch = field[i] ?? '';
    if (ch === "'") {
      if (field[i + 1] === "'") {
        content += "'";
        i += 2;
        continue;
      }
      return { ok: true, content, end: i + 1 };
    }
    content += ch;
    i += 1;
  }
  return { ok: false };
}

/** Parse the value field of a `KEYWORD = value / comment` card (bytes 11–80). */
function parseValueField(field: string): ValueParse {
  let i = 0;
  while (i < field.length && field[i] === ' ') i += 1;

  if (i === field.length) return { ok: true, value: null, continued: false };

  const first = field[i];
  if (first === '/') {
    return { ok: true, value: null, comment: field.slice(i + 1).trim(), continued: false };
  }

  if (first === "'") {
    const quoted = parseQuoted(field, i);
    if (!quoted.ok) {
      return { ok: false, reason: 'string value never closes its quote', unterminated: true };
    }
    const trailer = parseTrailer(field.slice(quoted.end));
    if (!trailer.ok) return { ok: false, reason: 'unexpected text after string value' };
    const continued = quoted.content.endsWith('&');
    return {
      ok: true,
      // Continuation candidates keep their content verbatim (including the
      // trailing '&') until the next card decides whether to merge; final
      // string values drop insignificant trailing spaces per FITS 4.0.
      value: continued ? quoted.content : quoted.content.trimEnd(),
      comment: trailer.comment,
      continued,
    };
  }

  let j = i;
  while (j < field.length && field[j] !== ' ' && field[j] !== '/') j += 1;
  const token = field.slice(i, j);
  const trailer = parseTrailer(field.slice(j));
  if (!trailer.ok) return { ok: false, reason: `unexpected text after value token '${token}'` };

  if (token === 'T') return { ok: true, value: true, comment: trailer.comment, continued: false };
  if (token === 'F') return { ok: true, value: false, comment: trailer.comment, continued: false };

  if (NUMBER_RE.test(token)) {
    const numeric = Number(token.replace(/[Dd]/, 'E'));
    if (Number.isFinite(numeric)) {
      return { ok: true, value: numeric, comment: trailer.comment, continued: false };
    }
  }
  return { ok: false, reason: `value field is neither a number, logical, nor string: '${token}'` };
}

type FeedOutcome = 'need-more' | 'done' | 'error';

interface PendingContinuation {
  keyword: string;
  /** Accumulated verbatim content, still ending with the '&' marker. */
  content: string;
}

class HeaderScanner {
  readonly cards: FitsCard[] = [];
  readonly keywords: Record<string, FitsValue> = {};
  error: FitsParseError | null = null;

  private pending: PendingContinuation | null = null;
  private cardIndex = 0;

  private fail(code: FitsParseError['code'], message: string, offset: number): 'error' {
    this.error = { code, message, offset };
    return 'error';
  }

  private finalizePending(): void {
    if (this.pending === null) return;
    // No CONTINUE followed: the '&' is literal (FITS 4.0 §4.2.1.2).
    this.keywords[this.pending.keyword] = this.pending.content.trimEnd();
    this.pending = null;
  }

  feedBlock(block: Uint8Array, blockIndex: number): FeedOutcome {
    for (let c = 0; c < CARDS_PER_BLOCK; c += 1) {
      const cardStart = c * CARD_BYTES;
      const fileOffset = blockIndex * BLOCK_BYTES + cardStart;
      const isFirstCard = this.cardIndex === 0;

      for (let i = cardStart; i < cardStart + CARD_BYTES; i += 1) {
        const byte = block[i] ?? 0;
        if (byte < 0x20 || byte > 0x7e) {
          return isFirstCard
            ? this.fail('NOT_FITS', 'first card contains non-ASCII bytes', fileOffset)
            : this.fail(
                'INVALID_CARD',
                `card ${this.cardIndex + 1} contains byte 0x${byte.toString(16)} outside restricted ASCII (0x20-0x7E)`,
                fileOffset,
              );
        }
      }

      const raw = decodeCard(block, cardStart);
      const keyword = raw.slice(0, 8).trimEnd();
      const hasValueIndicator = raw.slice(8, 10) === '= ';

      if (isFirstCard) {
        const value = hasValueIndicator ? parseValueField(raw.slice(10)) : null;
        if (keyword !== 'SIMPLE' || value === null || !value.ok || value.value !== true) {
          const detail =
            keyword === 'SIMPLE'
              ? 'SIMPLE is not T — file declares itself non-conforming'
              : `first card is '${keyword}', not SIMPLE = T`;
          return this.fail('NOT_FITS', detail, fileOffset);
        }
        this.pushCard({ keyword, value: true, comment: value.comment, raw });
        this.keywords[keyword] = true;
        continue;
      }

      if (keyword === 'CONTINUE' && !hasValueIndicator) {
        if (this.pending === null) {
          return this.fail(
            'BAD_CONTINUE',
            `CONTINUE card ${this.cardIndex + 1} has no preceding string ending in '&'`,
            fileOffset,
          );
        }
        const field = raw.slice(8);
        let i = 0;
        while (i < field.length && field[i] === ' ') i += 1;
        const quoted = field[i] === "'" ? parseQuoted(field, i) : ({ ok: false } as const);
        if (!quoted.ok) {
          return this.fail(
            'BAD_CONTINUE',
            `CONTINUE card ${this.cardIndex + 1} does not carry a well-formed quoted string`,
            fileOffset,
          );
        }
        const trailer = parseTrailer(field.slice(quoted.end));
        if (!trailer.ok) {
          return this.fail(
            'BAD_CONTINUE',
            `unexpected text after CONTINUE string on card ${this.cardIndex + 1}`,
            fileOffset,
          );
        }
        const continued = quoted.content.endsWith('&');
        const merged = this.pending.content.slice(0, -1) + quoted.content;
        this.pushCard({
          keyword,
          value: continued ? quoted.content : quoted.content.trimEnd(),
          comment: trailer.comment,
          raw,
        });
        if (continued) {
          this.pending = { keyword: this.pending.keyword, content: merged };
        } else {
          this.keywords[this.pending.keyword] = merged.trimEnd();
          this.pending = null;
        }
        continue;
      }

      this.finalizePending();

      if (keyword === 'END') {
        this.pushCard({ keyword, value: null, raw });
        return 'done';
      }

      if (!KEYWORD_RE.test(keyword)) {
        return this.fail(
          'INVALID_CARD',
          `card ${this.cardIndex + 1} keyword '${keyword}' violates the FITS keyword charset`,
          fileOffset,
        );
      }

      if (keyword === 'COMMENT' || keyword === 'HISTORY' || keyword === '') {
        this.pushCard({ keyword, value: null, comment: raw.slice(8).trimEnd(), raw });
        continue;
      }

      if (!hasValueIndicator) {
        // Tolerated non-standard card (e.g. HIERARCH): no value indicator,
        // preserved raw, never an error (DD-004 quirk tolerance).
        this.pushCard({ keyword, value: null, raw });
        continue;
      }

      const parsed = parseValueField(raw.slice(10));
      if (!parsed.ok) {
        return this.fail(
          'INVALID_CARD',
          `card ${this.cardIndex + 1} (${keyword}): ${parsed.reason}`,
          fileOffset,
        );
      }
      this.pushCard({ keyword, value: parsed.value, comment: parsed.comment, raw });
      if (parsed.continued && typeof parsed.value === 'string') {
        this.pending = { keyword, content: parsed.value };
      } else {
        this.keywords[keyword] = parsed.value;
      }
    }
    return 'need-more';
  }

  private pushCard(card: {
    keyword: string;
    value: FitsValue;
    comment?: string;
    raw: string;
  }): void {
    const entry: FitsCard = { keyword: card.keyword, value: card.value, raw: card.raw };
    if (card.comment !== undefined) entry.comment = card.comment;
    this.cards.push(entry);
    this.cardIndex += 1;
  }
}

function errorResult(
  code: FitsParseError['code'],
  message: string,
  offset?: number,
): FitsParseResult {
  const error: FitsParseError = { code, message };
  if (offset !== undefined) error.offset = offset;
  return { status: 'error', error };
}

function okResult(scanner: HeaderScanner, headerBytes: number): FitsParseResult {
  const header: FitsHeader = {
    keywords: scanner.keywords,
    cards: scanner.cards,
    cardCount: scanner.cards.length,
    headerBytes,
  };
  return { status: 'ok', header };
}

function classifyChunk(chunk: Uint8Array, blockIndex: number): FitsParseResult | null {
  if (chunk.length === 0) {
    return blockIndex === 0
      ? errorResult('EMPTY_FILE', 'file contains no bytes')
      : errorResult(
          'MISSING_END',
          `no END card before end of file (${blockIndex} complete 2880-byte blocks)`,
        );
  }
  if (chunk.length < BLOCK_BYTES) {
    return errorResult(
      'TRUNCATED_HEADER',
      `header block ${blockIndex + 1} is ${chunk.length} bytes, expected ${BLOCK_BYTES}`,
      blockIndex * BLOCK_BYTES + chunk.length,
    );
  }
  return null;
}

const missingEndLimit = (): FitsParseResult =>
  errorResult(
    'MISSING_END',
    `no END card within the first ${MAX_HEADER_BLOCKS} header blocks (${MAX_HEADER_BLOCKS * BLOCK_BYTES} bytes)`,
  );

/**
 * Parse a FITS header through a bounded-read callback. Requests sequential
 * 2880-byte blocks starting at offset 0 and stops at the block containing
 * the END card — it never reads into the data region.
 */
export async function parseFitsHeader(read: FitsReader): Promise<FitsParseResult> {
  const scanner = new HeaderScanner();
  for (let block = 0; block < MAX_HEADER_BLOCKS; block += 1) {
    const chunk = await read(block * BLOCK_BYTES, BLOCK_BYTES);
    const structural = classifyChunk(chunk, block);
    if (structural !== null) return structural;

    const outcome = scanner.feedBlock(chunk.subarray(0, BLOCK_BYTES), block);
    if (outcome === 'error' && scanner.error !== null) {
      return { status: 'error', error: scanner.error };
    }
    if (outcome === 'done') return okResult(scanner, (block + 1) * BLOCK_BYTES);
  }
  return missingEndLimit();
}

/**
 * Synchronous variant over an in-memory buffer (e.g. a header region already
 * read by the caller). Identical semantics to {@link parseFitsHeader}.
 */
export function parseFitsHeaderFromBuffer(bytes: Uint8Array): FitsParseResult {
  const scanner = new HeaderScanner();
  for (let block = 0; block < MAX_HEADER_BLOCKS; block += 1) {
    const offset = block * BLOCK_BYTES;
    const chunk = bytes.subarray(offset, offset + BLOCK_BYTES);
    const structural = classifyChunk(chunk, block);
    if (structural !== null) return structural;

    const outcome = scanner.feedBlock(chunk, block);
    if (outcome === 'error' && scanner.error !== null) {
      return { status: 'error', error: scanner.error };
    }
    if (outcome === 'done') return okResult(scanner, (block + 1) * BLOCK_BYTES);
  }
  return missingEndLimit();
}
