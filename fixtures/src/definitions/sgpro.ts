/**
 * Sequence Generator Pro-convention FITS fixtures (5).
 *
 * Conventions synthesized from the SGPro help ("Data Stored in the FITS
 * Header", https://www.sequencegeneratorpro.com/): CREATOR identification,
 * EXPOSURE (seconds), DATE-OBS/DATE-LOC with seven fractional digits,
 * intermittently absent FOCALLEN, sexagesimal OBJCTRA/OBJCTDEC.
 */

import { card, num, type CardSpec } from '../lib/fits.js';
import { baseCards, validFits } from './common.js';
import { SRC } from './sources.js';
import type { FixtureDef } from './types.js';

const PROGRAM = 'SGPro';
const VERSION = '4.x';
const SOURCES = [SRC.SGPRO_SITE, SRC.FITS_STANDARD];
const CREATOR = 'Sequence Generator Pro v4.2.0.1024';

const PRECISION_NOTE =
  'SGPro timestamps carry seven fractional digits - more precision than a JS Date holds. ' +
  'The manifest stores the exact original string; P1-01 must choose a truncation policy ' +
  'explicitly, never accidentally. Parsers persist the UTC DATE-OBS, not DATE-LOC.';

function rig(camera: string): CardSpec[] {
  return [
    card('CREATOR', CREATOR, 'Capture software'),
    card('INSTRUME', camera, 'Instrument name'),
    card('XBINNING', 1, 'X binning factor'),
    card('YBINNING', 1, 'Y binning factor'),
    card('GAIN', 56, 'Camera gain'),
    card('OFFSET', 25, 'Camera offset'),
    num('SET-TEMP', -15, '-15.0', '[degC] CCD temperature setpoint'),
    num('CCD-TEMP', -15, '-15.0', '[degC] CCD temperature'),
  ];
}

const KW_RIG = {
  INSTRUME: 'QHY268M',
  XBINNING: 1,
  YBINNING: 1,
  GAIN: 56,
  OFFSET: 25,
  'CCD-TEMP': -15,
  CREATOR,
} as const;

export const sgproDefs: FixtureDef[] = [
  validFits({
    file: 'fits/sgpro/sgpro-light-precision-timestamps.fits',
    description:
      'SGPro light frame whose DATE-OBS/DATE-LOC carry seven fractional digits ' +
      '(2023-05-25T06:45:26.0000000) - the documented SGPro timestamp shape.',
    program: PROGRAM,
    emulatesVersion: VERSION,
    sources: SOURCES,
    cards: [
      ...baseCards(6280, 4210),
      card('IMAGETYP', 'Light', 'Type of image'),
      num('EXPOSURE', 300, '300.0', '[s] Exposure duration'),
      card('DATE-OBS', '2023-05-25T06:45:26.0000000', 'Time of observation (UTC)'),
      card('DATE-LOC', '2023-05-25T01:45:26.0000000', 'Time of observation (local)'),
      ...rig('QHY268M'),
      card('TELESCOP', 'GSO RC8', 'Telescope name'),
      num('FOCALLEN', 800, '800.0', '[mm] Focal length'),
      card('RA', 210.802417, '[deg] Right ascension'),
      card('DEC', 54.34875, '[deg] Declination'),
      card('FILTER', 'Halpha', 'Filter name'),
      card('OBJECT', 'M 101', 'Target name'),
      card('ANGLE', 182.4, '[deg] Rotation angle'),
      card('FLIPPED', false, 'Is image flipped'),
    ],
    keywords: {
      OBJECT: 'M 101',
      IMAGETYP: 'Light',
      FILTER: 'Halpha',
      EXPOSURE: 300,
      'DATE-OBS': '2023-05-25T06:45:26.0000000',
      'DATE-LOC': '2023-05-25T01:45:26.0000000',
      TELESCOP: 'GSO RC8',
      FOCALLEN: 800,
      NAXIS1: 6280,
      NAXIS2: 4210,
      RA: 210.802417,
      DEC: 54.34875,
      ...KW_RIG,
    },
    notes: PRECISION_NOTE + ' SGPro writes EXPOSURE; EXPTIME is deliberately absent here.',
  }),

  validFits({
    file: 'fits/sgpro/sgpro-light-no-focallen.fits',
    description:
      'SGPro light frame without FOCALLEN - the documented intermittent omission when no ' +
      'telescope profile is configured.',
    program: PROGRAM,
    emulatesVersion: VERSION,
    sources: SOURCES,
    cards: [
      ...baseCards(6280, 4210),
      card('IMAGETYP', 'Light', 'Type of image'),
      num('EXPOSURE', 600, '600.0', '[s] Exposure duration'),
      card('DATE-OBS', '2023-09-12T02:10:03.5000000', 'Time of observation (UTC)'),
      card('DATE-LOC', '2023-09-11T21:10:03.5000000', 'Time of observation (local)'),
      ...rig('QHY268M'),
      card('RA', 35.639083, '[deg] Right ascension'),
      card('DEC', 42.349167, '[deg] Declination'),
      card('FILTER', 'Lum', 'Filter name'),
      card('OBJECT', 'NGC 891', 'Target name'),
    ],
    keywords: {
      OBJECT: 'NGC 891',
      IMAGETYP: 'Light',
      FILTER: 'Lum',
      EXPOSURE: 600,
      'DATE-OBS': '2023-09-12T02:10:03.5000000',
      NAXIS1: 6280,
      NAXIS2: 4210,
      RA: 35.639083,
      DEC: 42.349167,
      ...KW_RIG,
    },
    notes:
      'FOCALLEN is absent by design: SGPro omits it when the equipment profile lacks a ' +
      'telescope. Parsers must treat focal length as optional.',
  }),

  validFits({
    file: 'fits/sgpro/sgpro-light-sexagesimal.fits',
    description: 'SGPro light frame carrying sexagesimal OBJCTRA/OBJCTDEC pointing strings.',
    program: PROGRAM,
    emulatesVersion: VERSION,
    sources: SOURCES,
    cards: [
      ...baseCards(6280, 4210),
      card('IMAGETYP', 'Light', 'Type of image'),
      num('EXPOSURE', 300, '300.0', '[s] Exposure duration'),
      card('DATE-OBS', '2023-06-02T03:22:41.1234567', 'Time of observation (UTC)'),
      card('DATE-LOC', '2023-06-01T22:22:41.1234567', 'Time of observation (local)'),
      ...rig('QHY268M'),
      card('TELESCOP', 'GSO RC8', 'Telescope name'),
      num('FOCALLEN', 800, '800.0', '[mm] Focal length'),
      card('OBJCTRA', '13 29 53', 'Object right ascension (sexagesimal)'),
      card('OBJCTDEC', '+47 11 43', 'Object declination (sexagesimal)'),
      card('FILTER', 'OIII', 'Filter name'),
      card('OBJECT', 'M 51', 'Target name'),
    ],
    keywords: {
      OBJECT: 'M 51',
      IMAGETYP: 'Light',
      FILTER: 'OIII',
      EXPOSURE: 300,
      'DATE-OBS': '2023-06-02T03:22:41.1234567',
      TELESCOP: 'GSO RC8',
      OBJCTRA: '13 29 53',
      OBJCTDEC: '+47 11 43',
      NAXIS1: 6280,
      NAXIS2: 4210,
      ...KW_RIG,
    },
    notes:
      'Pointing is sexagesimal-only (OBJCTRA/OBJCTDEC, no RA/DEC degree cards) - parsers ' +
      'must handle both representations.',
  }),

  validFits({
    file: 'fits/sgpro/sgpro-dark.fits',
    description: 'SGPro dark frame: no OBJECT, FILTER, or pointing keywords.',
    program: PROGRAM,
    emulatesVersion: VERSION,
    sources: SOURCES,
    cards: [
      ...baseCards(6280, 4210),
      card('IMAGETYP', 'Dark', 'Type of image'),
      num('EXPOSURE', 300, '300.0', '[s] Exposure duration'),
      card('DATE-OBS', '2023-05-25T11:02:10.0000000', 'Time of observation (UTC)'),
      ...rig('QHY268M'),
    ],
    keywords: {
      IMAGETYP: 'Dark',
      EXPOSURE: 300,
      'DATE-OBS': '2023-05-25T11:02:10.0000000',
      NAXIS1: 6280,
      NAXIS2: 4210,
      ...KW_RIG,
    },
  }),

  validFits({
    file: 'fits/sgpro/sgpro-flat.fits',
    description: 'SGPro flat frame with FILTER but no OBJECT.',
    program: PROGRAM,
    emulatesVersion: VERSION,
    sources: SOURCES,
    cards: [
      ...baseCards(6280, 4210),
      card('IMAGETYP', 'Flat', 'Type of image'),
      num('EXPOSURE', 2.5, '2.5', '[s] Exposure duration'),
      card('DATE-OBS', '2023-05-25T10:31:55.0000000', 'Time of observation (UTC)'),
      ...rig('QHY268M'),
      card('FILTER', 'Red', 'Filter name'),
    ],
    keywords: {
      IMAGETYP: 'Flat',
      FILTER: 'Red',
      EXPOSURE: 2.5,
      'DATE-OBS': '2023-05-25T10:31:55.0000000',
      NAXIS1: 6280,
      NAXIS2: 4210,
      ...KW_RIG,
    },
  }),
];
