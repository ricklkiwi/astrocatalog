/**
 * Valid-but-tricky FITS edge-case fixtures (6). Not tied to a capture
 * program — these exercise FITS 4.0 structural corners
 * (https://fits.gsfc.nasa.gov/fits_standard.html).
 */

import {
  BLOCK_BYTES,
  card,
  comment,
  blank,
  history,
  longStringCards,
  longstrnCard,
  num,
  raw,
  type CardSpec,
} from '../lib/fits.js';
import { baseCards, validFits } from './common.js';
import { SRC } from './sources.js';
import type { FixtureDef } from './types.js';

const SOURCES = [SRC.FITS_STANDARD];

const LONG_OBJECT =
  'Sh2-129 Flying Bat with Ou4 Giant Squid Nebula extended widefield mosaic session Panel 3';

/** Minimal common capture keywords so every edge file is still frame-shaped. */
function frameCards(): CardSpec[] {
  return [
    card('IMAGETYP', 'LIGHT', 'Type of exposure'),
    card('DATE-OBS', '2026-06-10T01:15:00.000', 'Time of observation (UTC)'),
    card('INSTRUME', 'Fixture Cam', 'Camera model'),
    card('XBINNING', 1, 'X binning'),
    card('YBINNING', 1, 'Y binning'),
  ];
}

const KW_FRAME = {
  IMAGETYP: 'LIGHT',
  'DATE-OBS': '2026-06-10T01:15:00.000',
  INSTRUME: 'Fixture Cam',
  XBINNING: 1,
  YBINNING: 1,
  NAXIS1: 1024,
  NAXIS2: 768,
} as const;

/** Pad a card list with COMMENT filler so cards.length + END === totalCards. */
function padToCards(cards: CardSpec[], totalCards: number): CardSpec[] {
  const out = [...cards];
  while (out.length < totalCards - 1) {
    out.push(comment(`block-boundary filler card ${out.length + 1}`));
  }
  if (out.length !== totalCards - 1) {
    throw new Error(`padToCards: ${out.length + 1} cards, wanted ${totalCards}`);
  }
  return out;
}

export const edgeDefs: FixtureDef[] = [
  validFits({
    file: 'fits/edge/edge-continue-longstrn.fits',
    description:
      'Registered CONTINUE long-string convention: OBJECT value spans CONTINUE cards with ' +
      "'&' continuation markers, declared by a LONGSTRN card.",
    sources: SOURCES,
    cards: [
      ...baseCards(1024, 768),
      ...frameCards(),
      num('EXPTIME', 300, '300.0', '[s] Exposure time'),
      longstrnCard(),
      ...longStringCards('OBJECT', LONG_OBJECT, 'long target name'),
    ],
    keywords: {
      OBJECT: LONG_OBJECT,
      EXPTIME: 300,
      LONGSTRN: 'OGIP 1.0',
      ...KW_FRAME,
    },
    notes:
      'Parsers must reassemble the full OBJECT string across CONTINUE cards; the trailing ' +
      "'&' of each segment is not part of the value (FITS 4.0 long-string convention).",
  }),

  validFits({
    file: 'fits/edge/edge-exposure-only.fits',
    description: 'EXPOSURE present but EXPTIME absent - manifests must not assume EXPTIME.',
    sources: SOURCES,
    cards: [
      ...baseCards(1024, 768),
      ...frameCards(),
      num('EXPOSURE', 180, '180.0', '[s] Exposure duration'),
      card('OBJECT', 'M 81', 'Target name'),
    ],
    keywords: {
      OBJECT: 'M 81',
      EXPOSURE: 180,
      ...KW_FRAME,
    },
    notes: 'Exposure time must be read from EXPOSURE when EXPTIME is absent.',
  }),

  validFits({
    file: 'fits/edge/edge-exptime-only.fits',
    description: 'EXPTIME present but EXPOSURE absent (the inverse pairing).',
    sources: SOURCES,
    cards: [
      ...baseCards(1024, 768),
      ...frameCards(),
      num('EXPTIME', 180, '180.0', '[s] Exposure time'),
      card('OBJECT', 'M 82', 'Target name'),
    ],
    keywords: {
      OBJECT: 'M 82',
      EXPTIME: 180,
      ...KW_FRAME,
    },
  }),

  validFits({
    file: 'fits/edge/edge-end-36th-card.fits',
    description:
      'Header of exactly 36 cards: END is the last card of the single 2880-byte block and ' +
      'no padding block follows (off-by-one block-loop bugs die here).',
    sources: SOURCES,
    cards: padToCards(
      [
        ...baseCards(1024, 768),
        ...frameCards(),
        num('EXPTIME', 60, '60.0', '[s] Exposure time'),
        card('OBJECT', 'M 45', 'Target name'),
      ],
      36,
    ),
    keywords: {
      OBJECT: 'M 45',
      EXPTIME: 60,
      ...KW_FRAME,
    },
    expectHeaderBytes: BLOCK_BYTES,
    notes: 'File is exactly 2880 bytes; END occupies card slot 36 of block 1.',
  }),

  validFits({
    file: 'fits/edge/edge-end-block2.fits',
    description:
      'Header of 37 cards: END sits alone at the start of a second, otherwise space-padded ' +
      '2880-byte block.',
    sources: SOURCES,
    cards: padToCards(
      [
        ...baseCards(1024, 768),
        ...frameCards(),
        num('EXPTIME', 60, '60.0', '[s] Exposure time'),
        card('OBJECT', 'M 45', 'Target name'),
      ],
      37,
    ),
    keywords: {
      OBJECT: 'M 45',
      EXPTIME: 60,
      ...KW_FRAME,
    },
    expectHeaderBytes: 2 * BLOCK_BYTES,
    notes: 'File is exactly 5760 bytes; block 2 contains only END followed by space padding.',
  }),

  validFits({
    file: 'fits/edge/edge-commentary-hierarch.fits',
    description:
      'COMMENT/HISTORY/blank commentary cards mixed with a HIERARCH-style non-standard card ' +
      'that must parse as a tolerated unknown and be preserved in raw card storage.',
    sources: SOURCES,
    cards: [
      ...baseCards(1024, 768),
      comment('This fixture mixes commentary card types.'),
      comment('  COMMENT cards may repeat.'),
      ...frameCards(),
      history('synthesized by @astrotracker/fixtures author.ts'),
      history('no pixel payload follows the header'),
      blank(),
      num('EXPTIME', 120, '120.0', '[s] Exposure time'),
      card('OBJECT', 'M 101', 'Target name'),
      raw('HIERARCH ESO TEL FOCU SCALE = 1.489 / ESO-convention non-standard card'),
    ],
    keywords: {
      OBJECT: 'M 101',
      EXPTIME: 120,
      ...KW_FRAME,
    },
    notes:
      'The HIERARCH card is not a standard value card: parsers must tolerate it as an ' +
      'unknown card and keep it in headers_json (DD-004), never error on it. COMMENT/' +
      'HISTORY/blank cards carry no = value indicator.',
  }),
];
