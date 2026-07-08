/**
 * N.I.N.A.-convention FITS fixtures (6).
 *
 * Header conventions synthesized from the N.I.N.A. documentation
 * (https://nighttime-imaging.eu/docs/master/site/): SWCREATE identification,
 * uppercase IMAGETYP, both EXPOSURE and EXPTIME, DATE-LOC alongside DATE-OBS,
 * sexagesimal OBJCTRA/OBJCTDEC plus RA/DEC degrees, GAIN/OFFSET/EGAIN,
 * FWHEEL/FILTER, FOCPOS/FOCTEMP, SITE* keywords, ROWORDER, BAYERPAT for OSC.
 */

import { card, num, type CardSpec } from '../lib/fits.js';
import { baseCards, validFits } from './common.js';
import { SRC } from './sources.js';
import type { FixtureDef } from './types.js';

const PROGRAM = 'N.I.N.A.';
const VERSION = '3.x';
const SOURCES = [SRC.NINA_DOCS, SRC.FITS_STANDARD];
const SWCREATE = 'N.I.N.A. 3.1.2.9001';

/** Rig keywords shared by every N.I.N.A. fixture. */
function rig(camera: string): CardSpec[] {
  return [
    card('XBINNING', 1, 'X axis binning factor'),
    card('YBINNING', 1, 'Y axis binning factor'),
    card('GAIN', 100, 'Sensor gain'),
    card('OFFSET', 50, 'Sensor gain offset'),
    card('EGAIN', 0.246, '[e-/ADU] Electrons Per A/D Unit'),
    card('XPIXSZ', 3.76, '[um] Pixel X axis size'),
    card('YPIXSZ', 3.76, '[um] Pixel Y axis size'),
    card('INSTRUME', camera, 'Imaging instrument name'),
    num('SET-TEMP', -10, '-10.0', '[degC] CCD temperature setpoint'),
    card('CCD-TEMP', -10.1, '[degC] CCD temperature'),
    card('ROWORDER', 'TOP-DOWN', 'FITS Image Orientation'),
    card('SWCREATE', SWCREATE, 'Software that created this file'),
  ];
}

function opticalTrain(): CardSpec[] {
  return [
    card('TELESCOP', 'Sky-Watcher Esprit 100ED', 'Name of telescope'),
    num('FOCALLEN', 550, '550.0', '[mm] Focal length'),
    card('FOCRATIO', 5.5, 'Focal ratio'),
    card('FOCNAME', 'ZWO EAF', 'Focusing equipment name'),
    card('FOCPOS', 12345, '[step] Focuser position'),
    card('FOCUSPOS', 12345, '[step] Focuser position'),
    card('FOCTEMP', 4.2, '[degC] Focuser temperature'),
    card('FOCUSTEM', 4.2, '[degC] Focuser temperature'),
  ];
}

function site(): CardSpec[] {
  return [
    num('SITEELEV', 285, '285.0', '[m] Observation site elevation'),
    card('SITELAT', 51.477928, '[deg] Observation site latitude'),
    card('SITELONG', -0.001545, '[deg] Observation site longitude'),
  ];
}

const KW_RIG = {
  XBINNING: 1,
  YBINNING: 1,
  GAIN: 100,
  OFFSET: 50,
  EGAIN: 0.246,
  'CCD-TEMP': -10.1,
  ROWORDER: 'TOP-DOWN',
  SWCREATE,
} as const;

export const ninaDefs: FixtureDef[] = [
  validFits({
    file: 'fits/nina/nina-light-mono-ha.fits',
    description:
      'N.I.N.A. mono narrowband light frame with the full documented rig keyword set: ' +
      'EXPOSURE+EXPTIME, DATE-LOC+DATE-OBS, sexagesimal and degree pointing, ' +
      'GAIN/OFFSET/EGAIN, filter wheel, focuser, and site keywords.',
    program: PROGRAM,
    emulatesVersion: VERSION,
    sources: SOURCES,
    cards: [
      ...baseCards(4656, 3520),
      card('IMAGETYP', 'LIGHT', 'Type of exposure'),
      num('EXPOSURE', 300, '300.0', '[s] Exposure duration'),
      num('EXPTIME', 300, '300.0', '[s] Exposure duration'),
      card('DATE-LOC', '2026-01-14T22:22:10.123', 'Time of observation (local)'),
      card('DATE-OBS', '2026-01-15T03:22:10.123', 'Time of observation (UTC)'),
      ...rig('ZWO ASI2600MM Pro'),
      ...opticalTrain(),
      card('RA', 10.684708, '[deg] RA of telescope'),
      card('DEC', 41.26875, '[deg] Declination of telescope'),
      card('CENTALT', 62.3, '[deg] Altitude of telescope'),
      card('AIRMASS', 1.129, 'Airmass at frame center (Gueymard 1993)'),
      card('PIERSIDE', 'West', 'Telescope pointing state'),
      ...site(),
      card('FWHEEL', 'ZWO EFW', 'Filter Wheel name'),
      card('FILTER', 'Ha 3nm', 'Active filter name'),
      card('OBJECT', 'M 31', 'Name of the object of interest'),
      card('OBJCTRA', '00 42 44', '[H M S] RA of imaged object'),
      card('OBJCTDEC', '+41 16 09', '[D M S] Declination of imaged object'),
      num('OBJCTROT', 0, '0.0', '[deg] planned rotation of imaged object'),
      num('EQUINOX', 2000, '2000.0', 'Equinox of celestial coordinate system'),
    ],
    keywords: {
      OBJECT: 'M 31',
      IMAGETYP: 'LIGHT',
      FILTER: 'Ha 3nm',
      EXPTIME: 300,
      EXPOSURE: 300,
      'DATE-OBS': '2026-01-15T03:22:10.123',
      'DATE-LOC': '2026-01-14T22:22:10.123',
      TELESCOP: 'Sky-Watcher Esprit 100ED',
      INSTRUME: 'ZWO ASI2600MM Pro',
      ...KW_RIG,
      NAXIS1: 4656,
      NAXIS2: 3520,
      RA: 10.684708,
      DEC: 41.26875,
      OBJCTRA: '00 42 44',
      OBJCTDEC: '+41 16 09',
      FWHEEL: 'ZWO EFW',
    },
    notes:
      'DATE-LOC deliberately differs from DATE-OBS: parsers must persist the UTC DATE-OBS ' +
      '(DD-002 rule 4 / DD-004). Both EXPOSURE and EXPTIME are present per N.I.N.A. convention.',
  }),

  validFits({
    file: 'fits/nina/nina-light-osc-lextreme.fits',
    description:
      'N.I.N.A. one-shot-color light frame with BAYERPAT/XBAYROFF/YBAYROFF and a ' +
      'dual-band filter string (DD-005 Dualband canonical filter).',
    program: PROGRAM,
    emulatesVersion: VERSION,
    sources: SOURCES,
    cards: [
      ...baseCards(6248, 4176),
      card('IMAGETYP', 'LIGHT', 'Type of exposure'),
      num('EXPOSURE', 180, '180.0', '[s] Exposure duration'),
      num('EXPTIME', 180, '180.0', '[s] Exposure duration'),
      card('DATE-LOC', '2026-02-11T16:05:44.512', 'Time of observation (local)'),
      card('DATE-OBS', '2026-02-11T21:05:44.512', 'Time of observation (UTC)'),
      ...rig('ZWO ASI2600MC Pro'),
      card('BAYERPAT', 'RGGB', 'Sensor Bayer pattern'),
      card('XBAYROFF', 0, 'Bayer pattern X axis offset'),
      card('YBAYROFF', 0, 'Bayer pattern Y axis offset'),
      ...opticalTrain(),
      card('RA', 314.697417, '[deg] RA of telescope'),
      card('DEC', 44.530833, '[deg] Declination of telescope'),
      ...site(),
      card('FILTER', 'L-eXtreme', 'Active filter name'),
      card('OBJECT', 'NGC 7000', 'Name of the object of interest'),
      card('OBJCTRA', '20 58 47', '[H M S] RA of imaged object'),
      card('OBJCTDEC', '+44 31 51', '[D M S] Declination of imaged object'),
    ],
    keywords: {
      OBJECT: 'NGC 7000',
      IMAGETYP: 'LIGHT',
      FILTER: 'L-eXtreme',
      EXPTIME: 180,
      EXPOSURE: 180,
      'DATE-OBS': '2026-02-11T21:05:44.512',
      TELESCOP: 'Sky-Watcher Esprit 100ED',
      INSTRUME: 'ZWO ASI2600MC Pro',
      ...KW_RIG,
      NAXIS1: 6248,
      NAXIS2: 4176,
      RA: 314.697417,
      DEC: 44.530833,
      BAYERPAT: 'RGGB',
      XBAYROFF: 0,
      YBAYROFF: 0,
    },
    notes: "OSC frame: BAYERPAT present; 'L-eXtreme' maps to the DD-005 Dualband canonical filter.",
  }),

  validFits({
    file: 'fits/nina/nina-dark.fits',
    description: 'N.I.N.A. dark frame: no OBJECT, FILTER, or pointing keywords.',
    program: PROGRAM,
    emulatesVersion: VERSION,
    sources: SOURCES,
    cards: [
      ...baseCards(4656, 3520),
      card('IMAGETYP', 'DARK', 'Type of exposure'),
      num('EXPOSURE', 300, '300.0', '[s] Exposure duration'),
      num('EXPTIME', 300, '300.0', '[s] Exposure duration'),
      card('DATE-LOC', '2026-01-15T07:40:02.001', 'Time of observation (local)'),
      card('DATE-OBS', '2026-01-15T12:40:02.001', 'Time of observation (UTC)'),
      ...rig('ZWO ASI2600MM Pro'),
    ],
    keywords: {
      IMAGETYP: 'DARK',
      EXPTIME: 300,
      EXPOSURE: 300,
      'DATE-OBS': '2026-01-15T12:40:02.001',
      INSTRUME: 'ZWO ASI2600MM Pro',
      ...KW_RIG,
      NAXIS1: 4656,
      NAXIS2: 3520,
    },
  }),

  validFits({
    file: 'fits/nina/nina-flat.fits',
    description: 'N.I.N.A. flat frame with FILTER but no OBJECT or pointing keywords.',
    program: PROGRAM,
    emulatesVersion: VERSION,
    sources: SOURCES,
    cards: [
      ...baseCards(4656, 3520),
      card('IMAGETYP', 'FLAT', 'Type of exposure'),
      num('EXPOSURE', 1.2, '1.2', '[s] Exposure duration'),
      num('EXPTIME', 1.2, '1.2', '[s] Exposure duration'),
      card('DATE-LOC', '2026-01-15T06:58:31.870', 'Time of observation (local)'),
      card('DATE-OBS', '2026-01-15T11:58:31.870', 'Time of observation (UTC)'),
      ...rig('ZWO ASI2600MM Pro'),
      card('FWHEEL', 'ZWO EFW', 'Filter Wheel name'),
      card('FILTER', 'Lum', 'Active filter name'),
    ],
    keywords: {
      IMAGETYP: 'FLAT',
      FILTER: 'Lum',
      EXPTIME: 1.2,
      EXPOSURE: 1.2,
      'DATE-OBS': '2026-01-15T11:58:31.870',
      INSTRUME: 'ZWO ASI2600MM Pro',
      ...KW_RIG,
      NAXIS1: 4656,
      NAXIS2: 3520,
    },
  }),

  validFits({
    file: 'fits/nina/nina-bias.fits',
    description: 'N.I.N.A. bias frame with near-zero exposure time.',
    program: PROGRAM,
    emulatesVersion: VERSION,
    sources: SOURCES,
    cards: [
      ...baseCards(4656, 3520),
      card('IMAGETYP', 'BIAS', 'Type of exposure'),
      card('EXPOSURE', 0.001, '[s] Exposure duration'),
      card('EXPTIME', 0.001, '[s] Exposure duration'),
      card('DATE-LOC', '2026-01-15T07:02:12.334', 'Time of observation (local)'),
      card('DATE-OBS', '2026-01-15T12:02:12.334', 'Time of observation (UTC)'),
      ...rig('ZWO ASI2600MM Pro'),
    ],
    keywords: {
      IMAGETYP: 'BIAS',
      EXPTIME: 0.001,
      EXPOSURE: 0.001,
      'DATE-OBS': '2026-01-15T12:02:12.334',
      INSTRUME: 'ZWO ASI2600MM Pro',
      ...KW_RIG,
      NAXIS1: 4656,
      NAXIS2: 3520,
    },
  }),

  validFits({
    file: 'fits/nina/nina-light-mosaic-panel.fits',
    description:
      "N.I.N.A. mosaic-panel light frame: OBJECT carries a panel suffix ('M 31 Panel 1') " +
      'that DD-005 must resolve to the parent target with a panel attribute.',
    program: PROGRAM,
    emulatesVersion: VERSION,
    sources: SOURCES,
    cards: [
      ...baseCards(4656, 3520),
      card('IMAGETYP', 'LIGHT', 'Type of exposure'),
      num('EXPOSURE', 300, '300.0', '[s] Exposure duration'),
      num('EXPTIME', 300, '300.0', '[s] Exposure duration'),
      card('DATE-LOC', '2026-01-16T21:12:55.208', 'Time of observation (local)'),
      card('DATE-OBS', '2026-01-17T02:12:55.208', 'Time of observation (UTC)'),
      ...rig('ZWO ASI2600MM Pro'),
      ...opticalTrain(),
      card('RA', 10.409167, '[deg] RA of telescope'),
      card('DEC', 40.911389, '[deg] Declination of telescope'),
      ...site(),
      card('FWHEEL', 'ZWO EFW', 'Filter Wheel name'),
      card('FILTER', 'Ha 3nm', 'Active filter name'),
      card('OBJECT', 'M 31 Panel 1', 'Name of the object of interest'),
      card('OBJCTRA', '00 41 38', '[H M S] RA of imaged object'),
      card('OBJCTDEC', '+40 54 41', '[D M S] Declination of imaged object'),
    ],
    keywords: {
      OBJECT: 'M 31 Panel 1',
      IMAGETYP: 'LIGHT',
      FILTER: 'Ha 3nm',
      EXPTIME: 300,
      EXPOSURE: 300,
      'DATE-OBS': '2026-01-17T02:12:55.208',
      TELESCOP: 'Sky-Watcher Esprit 100ED',
      INSTRUME: 'ZWO ASI2600MM Pro',
      ...KW_RIG,
      NAXIS1: 4656,
      NAXIS2: 3520,
      RA: 10.409167,
      DEC: 40.911389,
    },
    notes:
      "DD-005 mosaic groundwork: parsers store OBJECT verbatim ('M 31 Panel 1'); panel " +
      'resolution to the parent target happens in the resolver, not the parser.',
  }),
];
