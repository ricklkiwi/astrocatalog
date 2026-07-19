/**
 * Types for the header-only FITS parser (P1-01, DD-004).
 *
 * Pure domain types: no Electron, no fs (DD-002 rule 1). The parser reads
 * through a caller-supplied {@link FitsReader}, so all I/O stays outside
 * `packages/core`.
 */

/** Parsed FITS card value. `null` marks a card that carries no value. */
export type FitsValue = string | number | boolean | null;

/** One 80-character header card, preserved verbatim alongside its parse. */
export interface FitsCard {
  /** Keyword field (bytes 1–8) with trailing spaces removed; `''` for blank commentary cards. */
  keyword: string;
  /** Parsed value for value-indicator cards; `null` for commentary and no-value cards. */
  value: FitsValue;
  /** Comment text following the `/` separator, when present. */
  comment?: string;
  /** Exact 80-character card image as read from the file. */
  raw: string;
}

/**
 * Structured error codes matching `fixtures/manifest.schema.json`'s closed
 * enum (the FITS subset). The parser returns these — it never throws on
 * malformed input (DD-004 error isolation).
 */
export type FitsErrorCode =
  'EMPTY_FILE' | 'TRUNCATED_HEADER' | 'MISSING_END' | 'NOT_FITS' | 'INVALID_CARD' | 'BAD_CONTINUE';

export interface FitsParseError {
  code: FitsErrorCode;
  message: string;
  /** Byte offset of the offending card within the file, when attributable. */
  offset?: number;
}

/** Successful header parse: typed keyword map plus the raw card list. */
export interface FitsHeader {
  /**
   * Typed keyword map. CONTINUE long strings are merged into their base
   * keyword; duplicate keywords resolve to the last occurrence. Commentary
   * and no-value cards do not appear here (see {@link FitsHeader.cards}).
   */
  keywords: Record<string, FitsValue>;
  /** Every card up to and including END, in file order (padding excluded). */
  cards: FitsCard[];
  /** Number of cards up to and including END. */
  cardCount: number;
  /** Total header-region size in bytes — always a multiple of 2880. */
  headerBytes: number;
}

export type FitsParseResult =
  { status: 'ok'; header: FitsHeader } | { status: 'error'; error: FitsParseError };

/**
 * Bounded random-access read callback (DD-002: parsers accept readers, never
 * touch fs). Returns up to `length` bytes starting at `offset`; returning
 * fewer bytes (or none) signals end of file. The parser only ever requests
 * sequential 2880-byte header blocks and stops at the block containing END.
 */
export type FitsReader = (offset: number, length: number) => Uint8Array | Promise<Uint8Array>;
