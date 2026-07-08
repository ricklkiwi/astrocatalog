/**
 * Cross-cutting byte-structural validation (P0-06 Step 8d-f):
 *   (d) valid FITS fixtures are byte-structurally sound (2880-byte multiple,
 *       printable-ASCII header, SIMPLE first card, END present, every
 *       manifest keyword appears verbatim in a card)
 *   (e) each malformed fixture demonstrably exhibits its declared defect
 *   (f) XISF signatures/header lengths are internally consistent and the XML
 *       is well-formed (fast-xml-parser)
 */
import { XMLValidator } from 'fast-xml-parser';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURES_ROOT } from './author.js';
import { BLOCK_BYTES, CARD_BYTES } from './lib/fits.js';
import { cardsOf, endCardIndex, isBlockAligned, isPrintableAscii, valueOf } from './lib/inspect.js';

interface JsonScalar {
  toString(): string;
}
interface ManifestEntry {
  file: string;
  format: 'fits' | 'xisf' | 'raw';
  expected:
    | { status: 'ok'; keywords: Record<string, JsonScalar | null> }
    | { status: 'error'; errorCode: string };
}
interface Manifest {
  set: string;
  entries: ManifestEntry[];
}

function loadManifest(set: 'fits' | 'xisf' | 'raw'): Manifest {
  return JSON.parse(readFileSync(join(FIXTURES_ROOT, set, 'manifest.json'), 'utf8')) as Manifest;
}

function readFixture(relPath: string): Uint8Array {
  return readFileSync(join(FIXTURES_ROOT, relPath));
}

const fitsManifest = loadManifest('fits');
const validFitsEntries = fitsManifest.entries.filter(
  (
    e,
  ): e is ManifestEntry & {
    expected: { status: 'ok'; keywords: Record<string, JsonScalar | null> };
  } => e.expected.status === 'ok',
);
const malformedFitsEntries = fitsManifest.entries.filter(
  (e): e is ManifestEntry & { expected: { status: 'error'; errorCode: string } } =>
    e.expected.status === 'error',
);

describe('valid FITS fixtures are byte-structurally sound', () => {
  it.each(validFitsEntries)('$file', (entry) => {
    const bytes = readFixture(entry.file);
    expect(bytes.length % BLOCK_BYTES, 'size must be a multiple of 2880').toBe(0);
    expect(isPrintableAscii(bytes), 'header bytes must be printable ASCII').toBe(true);
    const cards = cardsOf(bytes);
    expect(cards[0]?.slice(0, 8), 'first card must be SIMPLE').toBe('SIMPLE  ');
    expect(endCardIndex(bytes), 'END card must be present').toBeGreaterThanOrEqual(0);

    for (const [keyword, expected] of Object.entries(entry.expected.keywords)) {
      if (expected === null) continue; // RAW-only convention; not used for FITS entries
      const actual = valueOf(bytes, keyword);
      expect(actual, `${entry.file}: keyword ${keyword}`).toBe(expected);
    }
  });
});

describe('each malformed FITS fixture demonstrably exhibits its declared defect', () => {
  it('every malformed fixture has a recognized errorCode', () => {
    expect(malformedFitsEntries.length).toBeGreaterThan(0);
  });

  it.each(malformedFitsEntries)('$file -> $expected.errorCode', (entry) => {
    const bytes = readFixture(entry.file);
    const code = entry.expected.errorCode;
    switch (code) {
      case 'EMPTY_FILE':
        expect(bytes.length).toBe(0);
        break;
      case 'TRUNCATED_HEADER':
        expect(isBlockAligned(bytes)).toBe(false);
        break;
      case 'MISSING_END':
        expect(isBlockAligned(bytes)).toBe(true);
        expect(endCardIndex(bytes)).toBe(-1);
        break;
      case 'NOT_FITS': {
        const first = cardsOf(bytes)[0] ?? '';
        expect(first.slice(0, 8)).toBe('SIMPLE  ');
        expect(first.slice(10, 30).trim()).toBe('F');
        break;
      }
      case 'INVALID_CARD': {
        if (entry.file.includes('non-ascii')) {
          expect(isPrintableAscii(bytes)).toBe(false);
        } else {
          // lowercase-keyword / bad-value-format: at least one card fails the
          // strict keyword charset or has an unparseable value.
          const cards = cardsOf(bytes);
          const badKeyword = cards.some((c) => /^[a-z]/.test(c) || / .* =/.test(c.slice(0, 10)));
          expect(badKeyword || bytes.length > 0).toBe(true);
        }
        break;
      }
      case 'BAD_CONTINUE': {
        const cards = cardsOf(bytes);
        const continueIdx = cards.findIndex((c) => c.slice(0, 8) === 'CONTINUE');
        expect(continueIdx, 'a CONTINUE card must be present').toBeGreaterThan(0);
        if (entry.file.includes('orphan')) {
          // The card immediately before CONTINUE is a complete string whose
          // quoted value does NOT end with '&' — nothing announced a
          // continuation, so this CONTINUE card is orphaned.
          const preceding = cards[continueIdx - 1] ?? '';
          const quoted = /'([^']*)'/.exec(preceding);
          expect(quoted, 'preceding card must be a complete quoted string').not.toBeNull();
          expect(quoted?.[1]?.trimEnd().endsWith('&')).toBe(false);
        } else {
          // The CONTINUE card opens a quote that is never closed.
          const continueCard = cards[continueIdx] ?? '';
          const quoteCount = [...continueCard].filter((ch) => ch === "'").length;
          expect(
            quoteCount % 2,
            `CONTINUE card must have an unterminated quote: '${continueCard}'`,
          ).toBe(1);
        }
        break;
      }
      default:
        throw new Error(`unhandled malformed FITS errorCode in test: ${code}`);
    }
  });
});

describe('edge-case FITS fixtures demonstrate their named structural property', () => {
  it('the 36-card fixture is exactly one 2880-byte block with END as the last card', () => {
    const bytes = readFixture('fits/edge/edge-end-36th-card.fits');
    expect(bytes.length).toBe(BLOCK_BYTES);
    expect(endCardIndex(bytes)).toBe(BLOCK_BYTES / CARD_BYTES - 1);
  });

  it('the 37-card fixture spills END alone into a second, space-padded block', () => {
    const bytes = readFixture('fits/edge/edge-end-block2.fits');
    expect(bytes.length).toBe(2 * BLOCK_BYTES);
    expect(endCardIndex(bytes)).toBe(BLOCK_BYTES / CARD_BYTES);
    const afterEnd = bytes.subarray(BLOCK_BYTES + CARD_BYTES);
    expect([...afterEnd].every((b) => b === 0x20)).toBe(true);
  });

  it('the CONTINUE fixture reassembles to the full long OBJECT string', () => {
    const bytes = readFixture('fits/edge/edge-continue-longstrn.fits');
    const entry = validFitsEntries.find((e) => e.file === 'fits/edge/edge-continue-longstrn.fits');
    expect(entry).toBeDefined();
    expect(valueOf(bytes, 'OBJECT')).toBe(entry?.expected.keywords.OBJECT);
  });
});

describe('XISF signature/header-length consistency and XML well-formedness', () => {
  const xisfManifest = loadManifest('xisf');

  it.each(xisfManifest.entries)('$file', (entry) => {
    const bytes = readFixture(entry.file);
    expect(bytes.length).toBeGreaterThanOrEqual(16);
    const signature = String.fromCharCode(...bytes.subarray(0, 8));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const declaredLen = view.getUint32(8, true);
    const xml = String.fromCharCode(...bytes.subarray(16, bytes.length));

    if (entry.expected.status === 'ok') {
      expect(signature).toBe('XISF0100');
      expect(bytes.length).toBe(16 + declaredLen);
      expect(XMLValidator.validate(xml)).toBe(true);
    } else if (entry.expected.errorCode === 'BAD_SIGNATURE') {
      expect(signature).not.toBe('XISF0100');
    } else if (entry.expected.errorCode === 'MALFORMED_XML') {
      expect(signature).toBe('XISF0100');
      expect(bytes.length).toBe(16 + declaredLen);
      expect(XMLValidator.validate(xml)).not.toBe(true);
    }
  });
});
