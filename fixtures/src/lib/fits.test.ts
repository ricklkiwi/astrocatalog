import { describe, expect, it } from 'vitest';
import {
  BLOCK_BYTES,
  CARD_BYTES,
  END_CARD,
  blank,
  buildHeader,
  card,
  cardCount,
  comment,
  formatCard,
  history,
  longStringCards,
  longstrnCard,
  num,
  raw,
} from './fits.js';
import { cardsOf, endCardIndex, valueOf } from './inspect.js';

const decode = (bytes: Uint8Array) => String.fromCharCode(...bytes);

describe('formatCard — value cards', () => {
  it('emits exactly 80 characters with keyword left-justified in columns 1-8', () => {
    const text = formatCard(card('EXPTIME', 300));
    expect(text).toHaveLength(CARD_BYTES);
    expect(text.slice(0, 8)).toBe('EXPTIME ');
    expect(text.slice(8, 10)).toBe('= ');
  });

  it('right-justifies numbers so the value ends in column 30', () => {
    const text = formatCard(card('NAXIS1', 4656));
    expect(text.slice(10, 30)).toBe('                4656');
  });

  it('honors an exact numeric repr (300.0 stays 300.0, not 300)', () => {
    const text = formatCard(num('EXPTIME', 300, '300.0'));
    expect(text.slice(10, 30)).toBe('               300.0');
  });

  it('rejects a repr that does not round-trip to the value', () => {
    expect(() => formatCard(num('EXPTIME', 300, '301.0'))).toThrow(/round-trip/);
  });

  it('places logical T/F in column 30', () => {
    const text = formatCard(card('SIMPLE', true, 'conforms to FITS standard'));
    expect(text[29]).toBe('T');
    expect(formatCard(card('SIMPLE', false))[29]).toBe('F');
  });

  it('opens strings with a quote in column 11 and pads content to 8 chars', () => {
    const text = formatCard(card('OBJECT', 'M 31'));
    expect(text[10]).toBe("'");
    expect(text.slice(10, 20)).toBe("'M 31    '");
  });

  it("escapes single quotes by doubling them ('' convention)", () => {
    const text = formatCard(card('TELESCOP', "Officina Stellare Veloce RH 200'"));
    expect(text).toContain("Veloce RH 200''");
  });

  it('appends comments after column 30 with a slash separator', () => {
    const text = formatCard(card('GAIN', 100, 'Sensor gain'));
    expect(text.slice(30, 33)).toBe(' / ');
    expect(text).toContain('/ Sensor gain');
  });

  it('rejects keywords that are lowercase, too long, or contain spaces', () => {
    expect(() => formatCard(card('exptime', 1))).toThrow(/invalid FITS keyword/);
    expect(() => formatCard(card('TOOLONGKEY', 1))).toThrow(/invalid FITS keyword/);
    expect(() => formatCard(card('EXP TIME', 1))).toThrow(/invalid FITS keyword/);
  });

  it('rejects a card whose value + comment overflow 80 bytes', () => {
    expect(() => formatCard(card('OBJECT', 'x'.repeat(60), 'a comment that will not fit'))).toThrow(
      /longer than 80/,
    );
  });
});

describe('formatCard — commentary and raw cards', () => {
  it('emits COMMENT/HISTORY cards without a value indicator', () => {
    const c = formatCard(comment('Synthesized fixture'));
    expect(c.slice(0, 8)).toBe('COMMENT ');
    expect(c.slice(8, 10)).not.toBe('= ');
    const h = formatCard(history('created by author.ts'));
    expect(h.slice(0, 8)).toBe('HISTORY ');
  });

  it('emits a fully blank card for blank()', () => {
    expect(formatCard(blank())).toBe(' '.repeat(CARD_BYTES));
  });

  it('pads raw cards to 80 bytes by default', () => {
    expect(formatCard(raw('HIERARCH ESO TEL FOCU SCALE = 1.489'))).toHaveLength(CARD_BYTES);
  });

  it('supports deliberately short/overlong raw cards with exactLength', () => {
    expect(formatCard(raw('OBJECT  = ', true))).toHaveLength(10);
    expect(formatCard(raw('X'.repeat(95), true))).toHaveLength(95);
  });
});

describe('CONTINUE long-string convention', () => {
  const LONG = 'Sh2-129 Flying Bat with Ou4 Giant Squid Nebula extended mosaic session Panel 3';

  it('splits long strings across CONTINUE cards with & continuation markers', () => {
    const cards = longStringCards('OBJECT', LONG);
    expect(cards.length).toBeGreaterThan(1);
    const first = formatCard(cards[0]!);
    expect(first.slice(0, 10)).toBe('OBJECT  = ');
    expect(first).toContain("&'");
    const second = formatCard(cards[1]!);
    expect(second.slice(0, 10)).toBe('CONTINUE  ');
  });

  it('round-trips the full string through the card inspector', () => {
    const header = buildHeader([
      card('SIMPLE', true),
      longstrnCard(),
      ...longStringCards('OBJECT', LONG),
    ]);
    expect(valueOf(header, 'OBJECT')).toBe(LONG);
    expect(valueOf(header, 'LONGSTRN')).toBe('OGIP 1.0');
  });

  it('keeps every emitted card at exactly 80 bytes', () => {
    for (const spec of longStringCards('OBJECT', LONG, 'target name')) {
      expect(formatCard(spec)).toHaveLength(CARD_BYTES);
    }
  });
});

describe('buildHeader — block padding and END placement', () => {
  const base = [card('SIMPLE', true), card('BITPIX', 16), card('NAXIS', 0)];

  it('appends END and pads with spaces to a 2880-byte boundary', () => {
    const header = buildHeader(base);
    expect(header.length).toBe(BLOCK_BYTES);
    const text = decode(header);
    expect(text.slice(3 * CARD_BYTES, 4 * CARD_BYTES)).toBe(END_CARD);
    expect(text.slice(4 * CARD_BYTES)).toBe(' '.repeat(BLOCK_BYTES - 4 * CARD_BYTES));
  });

  it('makes END the 36th card of a single block for a 35-card header', () => {
    const cards = [...base];
    while (cards.length < 35) cards.push(comment(`filler ${cards.length}`));
    const header = buildHeader(cards);
    expect(cardCount(cards)).toBe(36);
    expect(header.length).toBe(BLOCK_BYTES);
    expect(endCardIndex(header)).toBe(35);
  });

  it('spills END alone into a second space-padded block for a 36-card header', () => {
    const cards = [...base];
    while (cards.length < 36) cards.push(comment(`filler ${cards.length}`));
    const header = buildHeader(cards);
    expect(header.length).toBe(2 * BLOCK_BYTES);
    expect(endCardIndex(header)).toBe(36);
    const text = decode(header);
    expect(text.slice(BLOCK_BYTES + CARD_BYTES)).toBe(' '.repeat(BLOCK_BYTES - CARD_BYTES));
  });

  it('can deliberately omit END (MISSING_END breakage mode)', () => {
    const header = buildHeader(base, { includeEnd: false });
    expect(header.length).toBe(BLOCK_BYTES);
    expect(endCardIndex(header)).toBe(-1);
  });

  it('can deliberately skip block padding (TRUNCATED_HEADER breakage mode)', () => {
    const header = buildHeader(base, { pad: false });
    expect(header.length).toBe(4 * CARD_BYTES);
    expect(header.length % BLOCK_BYTES).not.toBe(0);
  });

  it('supports non-ASCII byte injection via post-processing', () => {
    const header = buildHeader([...base, card('OBJECT', 'M 31')]);
    header[3 * CARD_BYTES + 11] = 0xe9; // é inside the OBJECT value
    expect(Array.from(header).some((b) => b > 0x7e)).toBe(true);
  });
});

describe('inspector value round-trips', () => {
  it('reads strings, numbers, and logicals back with types', () => {
    const header = buildHeader([
      card('SIMPLE', true),
      card('OBJECT', 'M 31'),
      num('EXPTIME', 300, '300.0'),
      card('CCD-TEMP', -10.1),
      card('GAIN', 100, 'Sensor gain'),
      card('COMMENTD', 5, 'value with / slash in comment'),
    ]);
    expect(valueOf(header, 'SIMPLE')).toBe(true);
    expect(valueOf(header, 'OBJECT')).toBe('M 31');
    expect(valueOf(header, 'EXPTIME')).toBe(300);
    expect(valueOf(header, 'CCD-TEMP')).toBe(-10.1);
    expect(valueOf(header, 'GAIN')).toBe(100);
    expect(valueOf(header, 'COMMENTD')).toBe(5);
    expect(valueOf(header, 'MISSING')).toBeUndefined();
  });

  it('splits buffers into 80-char cards', () => {
    const header = buildHeader([card('SIMPLE', true)]);
    const cards = cardsOf(header);
    expect(cards).toHaveLength(BLOCK_BYTES / CARD_BYTES);
    expect(cards.every((c) => c.length === CARD_BYTES)).toBe(true);
  });
});
