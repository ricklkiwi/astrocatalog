/**
 * Malformed FITS fixtures (10). Each file demonstrably exhibits exactly the
 * defect its manifest errorCode declares; a conforming parser (P1-01) must
 * return the structured error, never throw across the worker boundary, never
 * hang, and never abort the batch (DD-004 error isolation).
 */

import {
  asciiBytes,
  buildHeader,
  card,
  concatBytes,
  num,
  raw,
  type CardSpec,
} from '../lib/fits.js';
import { FIXTURE_DATE, LICENSE, baseCards } from './common.js';
import { SRC } from './sources.js';
import type { ErrorCode, FixtureDef } from './types.js';

const SOURCES = [SRC.FITS_STANDARD];

const PARSER_CONTRACT =
  'Conforming parser: return this structured error, never throw across the worker ' +
  'boundary, never hang, never abort the batch (DD-004 error isolation).';

function malformedFits(opts: {
  file: string;
  description: string;
  errorCode: ErrorCode;
  notes: string;
  build: () => Uint8Array;
}): FixtureDef {
  return {
    build: opts.build,
    entry: {
      file: opts.file,
      format: 'fits',
      description: opts.description,
      provenance: {
        method: 'synthesized-to-conventions',
        sources: SOURCES,
        license: LICENSE,
        date: FIXTURE_DATE,
      },
      expected: {
        status: 'error',
        errorCode: opts.errorCode,
        notes: `${opts.notes} ${PARSER_CONTRACT}`,
      },
    },
  };
}

function frameCards(): CardSpec[] {
  return [
    ...baseCards(1024, 768),
    card('IMAGETYP', 'LIGHT', 'Type of exposure'),
    num('EXPTIME', 120, '120.0', '[s] Exposure time'),
    card('DATE-OBS', '2026-06-11T02:00:00.000', 'Time of observation (UTC)'),
  ];
}

export const malformedDefs: FixtureDef[] = [
  malformedFits({
    file: 'fits/malformed/malformed-truncated-mid-block.fits',
    description: 'File truncated mid-block: size is not a multiple of 2880 and END never appears.',
    errorCode: 'TRUNCATED_HEADER',
    notes: 'Size 2000 bytes (not a 2880 multiple); no END card at any 80-byte offset.',
    build: () =>
      buildHeader([...frameCards(), card('OBJECT', 'M 31', 'Target name')], {
        includeEnd: false,
      }).slice(0, 2000),
  }),

  malformedFits({
    file: 'fits/malformed/malformed-missing-end.fits',
    description: 'Complete 2880-byte block(s) but the END card never appears before EOF.',
    errorCode: 'MISSING_END',
    notes: 'Block-aligned file whose header has no END card anywhere.',
    build: () => buildHeader(frameCards(), { includeEnd: false }),
  }),

  malformedFits({
    file: 'fits/malformed/malformed-lowercase-keyword.fits',
    description: 'Cards with a lowercase keyword and an embedded-space keyword.',
    errorCode: 'INVALID_CARD',
    notes:
      "Card 'exptime' violates the uppercase keyword charset; card 'EXP TIME' embeds a " +
      'space in the keyword field.',
    build: () =>
      buildHeader([
        ...frameCards(),
        raw('exptime =                120.0 / lowercase keyword'),
        raw('EXP TIME=                120.0 / embedded-space keyword'),
      ]),
  }),

  malformedFits({
    file: 'fits/malformed/malformed-bad-value-format.fits',
    description: 'Unquoted free-text value where a number is implied (bad value format).',
    errorCode: 'INVALID_CARD',
    notes: "EXPTIME's value field contains unquoted text ('three hundred'), not a number.",
    build: () =>
      buildHeader([
        ...baseCards(1024, 768),
        card('IMAGETYP', 'LIGHT', 'Type of exposure'),
        raw('EXPTIME =        three hundred / unquoted string where number implied'),
        card('DATE-OBS', '2026-06-11T02:00:00.000', 'Time of observation (UTC)'),
      ]),
  }),

  malformedFits({
    file: 'fits/malformed/malformed-continue-no-close.fits',
    description: 'CONTINUE card whose continued string never closes its quote.',
    errorCode: 'BAD_CONTINUE',
    notes:
      "OBJECT ends with '&' announcing continuation; the CONTINUE card opens a quote that " +
      'never closes. Distinct from the valid CONTINUE fixture in fits/edge/.',
    build: () =>
      buildHeader([
        ...frameCards(),
        card('LONGSTRN', 'OGIP 1.0', 'The CONTINUE long string convention is used'),
        raw("OBJECT  = 'A target name that keeps going and going and going and go&'"),
        raw("CONTINUE  'this continuation string never closes its quote"),
      ]),
  }),

  malformedFits({
    file: 'fits/malformed/malformed-orphan-continue.fits',
    description: "Orphan CONTINUE card: the preceding string value has no '&' continuation marker.",
    errorCode: 'BAD_CONTINUE',
    notes:
      "OBJECT is a complete string without a trailing '&', yet the next card is a CONTINUE " +
      'card - there is nothing to continue.',
    build: () =>
      buildHeader([
        ...frameCards(),
        card('OBJECT', 'M 31', 'Target name (complete, no continuation)'),
        raw("CONTINUE  'orphan continuation with no preceding ampersand'"),
      ]),
  }),

  malformedFits({
    file: 'fits/malformed/malformed-non-ascii.fits',
    description: 'Non-ASCII bytes (> 0x7E) inside a card image.',
    errorCode: 'INVALID_CARD',
    notes:
      'Two bytes inside the OBJECT value are 0xC3 0xA9 (UTF-8 é) - FITS card images must ' +
      'be restricted-ASCII (0x20-0x7E).',
    build: () => {
      const bytes = buildHeader([...frameCards(), card('OBJECT', 'Melotte 22 XY', 'Target name')]);
      const text = String.fromCharCode(...bytes);
      const at = text.indexOf('Melotte 22 XY');
      // Overwrite the 'XY' inside the quoted value (closing quote untouched).
      bytes[at + 11] = 0xc3;
      bytes[at + 12] = 0xa9;
      return bytes;
    },
  }),

  malformedFits({
    file: 'fits/malformed/malformed-empty.fits',
    description: 'Zero-length file.',
    errorCode: 'EMPTY_FILE',
    notes: 'The file contains no bytes at all.',
    build: () => new Uint8Array(0),
  }),

  malformedFits({
    file: 'fits/malformed/malformed-not-simple.fits',
    description: 'First card is SIMPLE = F: the file declares itself non-conforming.',
    errorCode: 'NOT_FITS',
    notes:
      'SIMPLE must be the first card of a primary header and must be T; this file carries ' +
      'SIMPLE = F.',
    build: () =>
      buildHeader([
        card('SIMPLE', false, 'file does NOT conform to FITS standard'),
        ...baseCards(1024, 768).slice(1),
        card('IMAGETYP', 'LIGHT', 'Type of exposure'),
      ]),
  }),

  malformedFits({
    file: 'fits/malformed/malformed-short-final-card.fits',
    description: 'Final card is shorter than 80 bytes at EOF (torn write).',
    errorCode: 'TRUNCATED_HEADER',
    notes:
      'The last card image is only 40 bytes long, so the file size is neither card- nor ' +
      'block-aligned.',
    build: () =>
      concatBytes(
        buildHeader(frameCards(), { includeEnd: false, pad: false }),
        asciiBytes("OBJECT  = 'M 31'   / torn mid-card write"),
      ),
  }),
];
