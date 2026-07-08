/**
 * ASIStudio/ASIAIR-convention FITS fixtures (4).
 *
 * Conventions synthesized from ZWO's ASIAIR/ASIStudio documentation
 * (https://www.zwoastro.com/): CREATOR identification, ZWO unitless GAIN
 * scale, BAYERPAT for OSC cameras, EXPTIME seconds, cooled-sensor SET-TEMP/
 * CCD-TEMP pairs.
 */

import { card, num } from '../lib/fits.js';
import { baseCards, validFits } from './common.js';
import { SRC } from './sources.js';
import type { FixtureDef } from './types.js';

const PROGRAM = 'ASIStudio/ASIAIR';
const VERSION = '2.x';
const SOURCES = [SRC.ZWO_SITE, SRC.FITS_STANDARD];
const ASIAIR_CREATOR = 'ZWO ASIAIR Plus';

export const asistudioDefs: FixtureDef[] = [
  validFits({
    file: 'fits/asistudio/asiair-light-osc.fits',
    description:
      'ASIAIR one-shot-color light frame with the ASIAIR CREATOR keyword and BAYERPAT; ' +
      'no FILTER keyword (OSC camera without a filter wheel).',
    program: PROGRAM,
    emulatesVersion: VERSION,
    sources: SOURCES,
    cards: [
      ...baseCards(6248, 4176),
      card('CREATOR', ASIAIR_CREATOR, 'Capture software'),
      card('IMAGETYP', 'Light', 'Type of image'),
      num('EXPTIME', 120, '120.0', '[s] Exposure time'),
      card('DATE-OBS', '2026-02-18T22:30:15.000', 'Time of observation (UTC)'),
      card('INSTRUME', 'ZWO ASI2600MC Pro', 'Camera model'),
      card('BAYERPAT', 'RGGB', 'Bayer color pattern'),
      card('XBINNING', 1, 'X binning'),
      card('YBINNING', 1, 'Y binning'),
      card('GAIN', 100, 'Gain (ZWO unitless 0-570 scale)'),
      card('OFFSET', 50, 'Offset'),
      num('SET-TEMP', -10, '-10.0', '[degC] Cooler setpoint'),
      num('CCD-TEMP', -10, '-10.0', '[degC] Sensor temperature'),
      num('FOCALLEN', 360, '360.0', '[mm] Focal length'),
      card('TELESCOP', 'ZWO FF65 APO', 'Telescope name'),
      card('RA', 83.822083, '[deg] Right ascension'),
      card('DEC', -5.391111, '[deg] Declination'),
      card('OBJECT', 'M 42', 'Target name'),
    ],
    keywords: {
      OBJECT: 'M 42',
      IMAGETYP: 'Light',
      EXPTIME: 120,
      'DATE-OBS': '2026-02-18T22:30:15.000',
      TELESCOP: 'ZWO FF65 APO',
      INSTRUME: 'ZWO ASI2600MC Pro',
      'CCD-TEMP': -10,
      GAIN: 100,
      OFFSET: 50,
      XBINNING: 1,
      YBINNING: 1,
      NAXIS1: 6248,
      NAXIS2: 4176,
      RA: 83.822083,
      DEC: -5.391111,
      CREATOR: ASIAIR_CREATOR,
      BAYERPAT: 'RGGB',
    },
    notes:
      'OSC without a wheel: FILTER is structurally absent (DD-005 None canonical filter). ' +
      'GAIN uses the ZWO unitless 0-570 scale, not e-/ADU.',
  }),

  validFits({
    file: 'fits/asistudio/asistudio-light-gain-conventions.fits',
    description:
      "ASIStudio mono light frame with a high ZWO-scale GAIN value and a literal 'None' " +
      'FILTER string (DD-005 None canonical filter, spelled out).',
    program: PROGRAM,
    emulatesVersion: VERSION,
    sources: SOURCES,
    cards: [
      ...baseCards(4144, 2822),
      card('CREATOR', 'ZWO ASIStudio ASIImg 4.4', 'Capture software'),
      card('IMAGETYP', 'Light', 'Type of image'),
      num('EXPTIME', 300, '300.0', '[s] Exposure time'),
      card('DATE-OBS', '2026-02-19T01:12:40.000', 'Time of observation (UTC)'),
      card('INSTRUME', 'ZWO ASI294MM Pro', 'Camera model'),
      card('XBINNING', 2, 'X binning'),
      card('YBINNING', 2, 'Y binning'),
      card('GAIN', 300, 'Gain (ZWO unitless 0-570 scale)'),
      card('OFFSET', 30, 'Offset'),
      num('SET-TEMP', -15, '-15.0', '[degC] Cooler setpoint'),
      card('CCD-TEMP', -14.8, '[degC] Sensor temperature'),
      card('FILTER', 'None', 'Filter name'),
      card('OBJECT', 'IC 434', 'Target name'),
    ],
    keywords: {
      OBJECT: 'IC 434',
      IMAGETYP: 'Light',
      FILTER: 'None',
      EXPTIME: 300,
      'DATE-OBS': '2026-02-19T01:12:40.000',
      INSTRUME: 'ZWO ASI294MM Pro',
      'CCD-TEMP': -14.8,
      GAIN: 300,
      OFFSET: 30,
      XBINNING: 2,
      YBINNING: 2,
      NAXIS1: 4144,
      NAXIS2: 2822,
      CREATOR: 'ZWO ASIStudio ASIImg 4.4',
    },
    notes:
      "FILTER carries the literal string 'None' (distinct from an absent card) - both map " +
      'to the DD-005 None canonical filter. 2x2 binning variant.',
  }),

  validFits({
    file: 'fits/asistudio/asiair-dark.fits',
    description: 'ASIAIR dark frame: no OBJECT, FILTER, or pointing keywords.',
    program: PROGRAM,
    emulatesVersion: VERSION,
    sources: SOURCES,
    cards: [
      ...baseCards(6248, 4176),
      card('CREATOR', ASIAIR_CREATOR, 'Capture software'),
      card('IMAGETYP', 'Dark', 'Type of image'),
      num('EXPTIME', 120, '120.0', '[s] Exposure time'),
      card('DATE-OBS', '2026-02-19T05:00:02.000', 'Time of observation (UTC)'),
      card('INSTRUME', 'ZWO ASI2600MC Pro', 'Camera model'),
      card('BAYERPAT', 'RGGB', 'Bayer color pattern'),
      card('XBINNING', 1, 'X binning'),
      card('YBINNING', 1, 'Y binning'),
      card('GAIN', 100, 'Gain (ZWO unitless 0-570 scale)'),
      card('OFFSET', 50, 'Offset'),
      num('CCD-TEMP', -10, '-10.0', '[degC] Sensor temperature'),
    ],
    keywords: {
      IMAGETYP: 'Dark',
      EXPTIME: 120,
      'DATE-OBS': '2026-02-19T05:00:02.000',
      INSTRUME: 'ZWO ASI2600MC Pro',
      'CCD-TEMP': -10,
      GAIN: 100,
      OFFSET: 50,
      XBINNING: 1,
      YBINNING: 1,
      NAXIS1: 6248,
      NAXIS2: 4176,
      CREATOR: ASIAIR_CREATOR,
      BAYERPAT: 'RGGB',
    },
  }),

  validFits({
    file: 'fits/asistudio/asiair-flat.fits',
    description: 'ASIAIR flat frame (OSC: BAYERPAT present, FILTER absent, no OBJECT).',
    program: PROGRAM,
    emulatesVersion: VERSION,
    sources: SOURCES,
    cards: [
      ...baseCards(6248, 4176),
      card('CREATOR', ASIAIR_CREATOR, 'Capture software'),
      card('IMAGETYP', 'Flat', 'Type of image'),
      num('EXPTIME', 1.8, '1.8', '[s] Exposure time'),
      card('DATE-OBS', '2026-02-19T06:10:44.000', 'Time of observation (UTC)'),
      card('INSTRUME', 'ZWO ASI2600MC Pro', 'Camera model'),
      card('BAYERPAT', 'RGGB', 'Bayer color pattern'),
      card('XBINNING', 1, 'X binning'),
      card('YBINNING', 1, 'Y binning'),
      card('GAIN', 100, 'Gain (ZWO unitless 0-570 scale)'),
      card('OFFSET', 50, 'Offset'),
      num('CCD-TEMP', -10, '-10.0', '[degC] Sensor temperature'),
    ],
    keywords: {
      IMAGETYP: 'Flat',
      EXPTIME: 1.8,
      'DATE-OBS': '2026-02-19T06:10:44.000',
      INSTRUME: 'ZWO ASI2600MC Pro',
      'CCD-TEMP': -10,
      GAIN: 100,
      OFFSET: 50,
      XBINNING: 1,
      YBINNING: 1,
      NAXIS1: 6248,
      NAXIS2: 4176,
      CREATOR: ASIAIR_CREATOR,
      BAYERPAT: 'RGGB',
    },
  }),
];
