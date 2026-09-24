/**
 * Unit tests for FITS card/value parsing corners not covered by the fixture
 * corpus: D exponents, escaped quotes, literal '&', null values, duplicate
 * keywords, the MAX_HEADER_BLOCKS hang bound, and reader misbehavior.
 */
import { describe, expect, it } from 'vitest';

import {
  BLOCK_BYTES,
  CARD_BYTES,
  MAX_HEADER_BLOCKS,
  decodeFitsStringLiteral,
  parseFitsHeader,
  parseFitsHeaderFromBuffer,
} from './parse.js';
import type { FitsHeader } from './types.js';

function toBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bytes;
}

/** Build a padded header from raw card texts (each padded to 80 chars). */
function headerOf(...cards: string[]): Uint8Array {
  let text = cards.map((card) => card.padEnd(CARD_BYTES)).join('') + 'END'.padEnd(CARD_BYTES);
  const remainder = text.length % BLOCK_BYTES;
  if (remainder !== 0) text += ' '.repeat(BLOCK_BYTES - remainder);
  return toBytes(text);
}

const SIMPLE = 'SIMPLE  =                    T / conforms';

function parseOk(...cards: string[]): FitsHeader {
  const result = parseFitsHeaderFromBuffer(headerOf(SIMPLE, ...cards));
  if (result.status !== 'ok') throw new Error(`expected ok, got ${result.error.code}`);
  return result.header;
}

describe('value parsing corners', () => {
  it('parses D-exponent reals, negative reals, and bare integers', () => {
    const header = parseOk(
      'EGAIN   =            2.4600D-1 / D exponent',
      'CCD-TEMP=               -10.15 / negative real',
      'GAIN    =                  100',
      'FOO     =              1.5E+03 / E exponent',
    );
    expect(header.keywords['EGAIN']).toBeCloseTo(0.246, 10);
    expect(header.keywords['CCD-TEMP']).toBe(-10.15);
    expect(header.keywords['GAIN']).toBe(100);
    expect(header.keywords['FOO']).toBe(1500);
  });

  it('unescapes doubled quotes and keeps leading spaces while trimming trailing ones', () => {
    const header = parseOk("OBJECT  = 'Barnard''s Loop   ' / possessive");
    expect(header.keywords['OBJECT']).toBe("Barnard's Loop");
  });

  it("keeps a literal '&' when padding follows it inside the quotes", () => {
    const header = parseOk("OBJECT  = 'A & B     '         / literal ampersand");
    expect(header.keywords['OBJECT']).toBe('A & B');
  });

  it("keeps a trailing '&' literal when no CONTINUE card follows", () => {
    const header = parseOk("OBJECT  = 'M 31&'", 'EXPTIME =                 60.0');
    expect(header.keywords['OBJECT']).toBe('M 31&');
    expect(header.keywords['EXPTIME']).toBe(60);
  });

  it('parses a valueless card (KEYWORD = with empty value field) as null', () => {
    const header = parseOk('BLANKVAL=                      / undefined value');
    expect(header.keywords['BLANKVAL']).toBeNull();
  });

  it('resolves duplicate keywords to the last occurrence', () => {
    const header = parseOk('EXPTIME =                 60.0', 'EXPTIME =                120.0');
    expect(header.keywords['EXPTIME']).toBe(120);
  });

  it('tolerates a no-value-indicator card and preserves it raw', () => {
    const raw = 'HIERARCH ESO TEL FOCU SCALE = 1.489 / ESO convention';
    const header = parseOk(raw);
    expect(header.keywords['HIERARCH']).toBeUndefined();
    const card = header.cards.find((c) => c.keyword === 'HIERARCH');
    expect(card?.raw).toBe(raw.padEnd(CARD_BYTES));
    expect(card?.value).toBeNull();
  });

  it('reports INVALID_CARD for an unterminated string on a normal value card', () => {
    const result = parseFitsHeaderFromBuffer(headerOf(SIMPLE, "OBJECT  = 'never closes"));
    expect(result).toMatchObject({ status: 'error', error: { code: 'INVALID_CARD' } });
  });

  it('reports INVALID_CARD for garbage after a closed string value', () => {
    const result = parseFitsHeaderFromBuffer(headerOf(SIMPLE, "OBJECT  = 'M 31' trailing junk"));
    expect(result).toMatchObject({ status: 'error', error: { code: 'INVALID_CARD' } });
  });
});

describe('decodeFitsStringLiteral', () => {
  // Standalone-string decoding (#129), used by the XISF parser for
  // FITSKeyword attribute values, which arrive whole rather than embedded in
  // an 80-character card — so this exercises the same quoting rules as
  // 'unescapes doubled quotes...' above, without a card/field wrapper.
  it.each([
    ['plain FITS string', "'WO Gt 71'", 'WO Gt 71'],
    ['embedded doubled quote unescapes to one', "'Barnard''s Loop'", "Barnard's Loop"],
    ['trailing padding is trimmed', "'Ha 3nm   '", 'Ha 3nm'],
    ['leading blanks are preserved', "'  M 31'", '  M 31'],
    ['lone empty-string quotes decode to empty string', "''", ''],
    ['numeric token is untouched', '100', '100'],
    ['logical T token is untouched', 'T', 'T'],
    ['logical F token is untouched', 'F', 'F'],
    ['unquoted text is untouched', 'LIGHT', 'LIGHT'],
    ['a single leading quote with no closing quote is untouched', "'WO Gt 71", "'WO Gt 71"],
    ['trailing text after the closing quote is untouched', "'ab'cd", "'ab'cd"],
    ['a value ending in a quote but not starting with one is untouched', "M 31'", "M 31'"],
    ['empty string is untouched', '', ''],
    // First and last characters are both a quote (the raw[0]/raw[len-1]
    // guard passes), but the interior isn't one well-formed FITS literal —
    // pins the `quoted.end !== raw.length` branch: a premature unescaped
    // closing quote leaves trailing content the guard alone can't see.
    [
      'trailing content after an early closing quote is untouched, even though raw itself ends in a quote',
      "'ab'cd'",
      "'ab'cd'",
    ],
    ['two separate quoted segments (not one literal) are untouched', "'a' 'b'", "'a' 'b'"],
    // Pins the `!quoted.ok` branch specifically: the guard passes (starts
    // and ends with a quote), but the interior never finds an unescaped
    // closing quote — the trailing `''` is consumed as an escaped literal
    // quote, leaving the string unterminated.
    ['an unterminated string despite a trailing doubled quote is untouched', "'abc''", "'abc''"],
  ])('%s: %j -> %j', (_name, input, expected) => {
    expect(decodeFitsStringLiteral(input)).toBe(expected);
  });
});

describe('structural corners', () => {
  it('reports NOT_FITS when the first card is not SIMPLE', () => {
    const result = parseFitsHeaderFromBuffer(headerOf('BITPIX  =                   16'));
    expect(result).toMatchObject({ status: 'error', error: { code: 'NOT_FITS' } });
  });

  it('reports NOT_FITS for arbitrary non-FITS bytes', () => {
    const result = parseFitsHeaderFromBuffer(new Uint8Array(BLOCK_BYTES).fill(0x89));
    expect(result).toMatchObject({ status: 'error', error: { code: 'NOT_FITS' } });
  });

  it('merges a CONTINUE chain that crosses a block boundary', () => {
    // 34 filler cards push the '&' base card to slot 36 of block 1, so the
    // CONTINUE lands at the start of block 2.
    const filler = Array.from(
      { length: 34 },
      (_, i) =>
        `FILLER${String(i).padStart(2, '0')}=                    ${String(i).padStart(2, ' ')}`,
    );
    const result = parseFitsHeaderFromBuffer(
      headerOf(SIMPLE, ...filler, "OBJECT  = 'part one&'", "CONTINUE  ' part two'"),
    );
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.header.keywords['OBJECT']).toBe('part one part two');
    expect(result.header.headerBytes).toBe(2 * BLOCK_BYTES);
  });

  it(`caps the scan at MAX_HEADER_BLOCKS (${MAX_HEADER_BLOCKS}) instead of hanging`, async () => {
    const block = new Uint8Array(BLOCK_BYTES).fill(0x20);
    block.set(toBytes(SIMPLE), 0);
    let reads = 0;
    // An adversarial endless reader: always returns a full block, never END.
    const result = await parseFitsHeader((offset) => {
      reads += 1;
      return offset === 0 ? block : new Uint8Array(BLOCK_BYTES).fill(0x20);
    });
    expect(result).toMatchObject({ status: 'error', error: { code: 'MISSING_END' } });
    expect(reads).toBe(MAX_HEADER_BLOCKS);
  });

  it('truncates over-long reader responses to one block', async () => {
    const bytes = headerOf(SIMPLE, 'EXPTIME =                 60.0');
    const result = await parseFitsHeader(() => bytes); // returns everything every time
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.header.keywords['EXPTIME']).toBe(60);
  });

  it('supports genuinely async readers', async () => {
    const bytes = headerOf(SIMPLE, "OBJECT  = 'M 33'");
    const result = await parseFitsHeader(async (offset, length) => {
      await new Promise((resolveSleep) => setTimeout(resolveSleep, 0));
      return bytes.subarray(offset, offset + length);
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.header.keywords['OBJECT']).toBe('M 33');
  });
});
