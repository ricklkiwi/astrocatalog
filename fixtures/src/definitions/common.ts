import { buildHeader, card, cardCount, type CardSpec } from '../lib/fits.js';
import type { FixtureDef, JsonScalar } from './types.js';

/** Provenance date for all fixtures authored by this issue (never wall-clock). */
export const FIXTURE_DATE = '2026-07-06';
export const LICENSE = 'CC0-1.0';

/** Mandatory FITS primary-header opening for a 16-bit 2D image (header-only). */
export function baseCards(naxis1: number, naxis2: number): CardSpec[] {
  return [
    card('SIMPLE', true, 'file does conform to FITS standard'),
    card('BITPIX', 16, 'number of bits per data pixel'),
    card('NAXIS', 2, 'number of data axes'),
    card('NAXIS1', naxis1, 'length of data axis 1'),
    card('NAXIS2', naxis2, 'length of data axis 2'),
    card('BZERO', 32768, 'offset data range to that of unsigned short'),
    card('BSCALE', 1, 'default scaling factor'),
  ];
}

export interface ValidFitsOptions {
  file: string;
  description: string;
  /** Omit for pure format edge cases not tied to a capture program. */
  program?: string;
  emulatesVersion?: string;
  sources: string[];
  cards: CardSpec[];
  keywords: Record<string, JsonScalar>;
  notes?: string;
  /** Authoring-time invariant, e.g. 2880 for the END-in-block-one edge case. */
  expectHeaderBytes?: number;
}

/** Declarative valid-FITS fixture: cards in, bytes + manifest entry out. */
export function validFits(opts: ValidFitsOptions): FixtureDef {
  const build = () => buildHeader(opts.cards);
  const bytes = build();
  if (opts.expectHeaderBytes !== undefined && bytes.length !== opts.expectHeaderBytes) {
    throw new Error(
      `${opts.file}: expected ${opts.expectHeaderBytes} header bytes, built ${bytes.length}`,
    );
  }
  return {
    build,
    entry: {
      file: opts.file,
      format: 'fits',
      description: opts.description,
      provenance: {
        method: 'synthesized-to-conventions',
        ...(opts.program === undefined ? {} : { program: opts.program }),
        ...(opts.emulatesVersion === undefined ? {} : { emulatesVersion: opts.emulatesVersion }),
        sources: opts.sources,
        license: LICENSE,
        date: FIXTURE_DATE,
      },
      expected: {
        status: 'ok',
        keywords: opts.keywords,
        cardCount: cardCount(opts.cards),
        headerBytes: bytes.length,
        ...(opts.notes === undefined ? {} : { notes: opts.notes }),
      },
    },
  };
}
