/**
 * Voyager-convention FITS fixtures (4).
 *
 * Conventions synthesized from the Voyager (Astro Imaging Suite)
 * documentation (https://software.starkeeper.it/): SWCREATE software
 * identification and a full pointing keyword set (RA/DEC degrees,
 * sexagesimal OBJCTRA/OBJCTDEC, AIRMASS, PIERSIDE).
 */

import { card, num } from '../lib/fits.js';
import { baseCards, validFits } from './common.js';
import { SRC } from './sources.js';
import type { FixtureDef } from './types.js';

const PROGRAM = 'Voyager';
const VERSION = '2.x';
const SOURCES = [SRC.VOYAGER_SITE, SRC.FITS_STANDARD];
const SWCREATE = 'Voyager 2.3.5';

export const voyagerDefs: FixtureDef[] = [
  validFits({
    file: 'fits/voyager/voyager-light-full-pointing.fits',
    description:
      'Voyager light frame with the software-identification keyword and the full pointing ' +
      'set: RA/DEC degrees, sexagesimal OBJCTRA/OBJCTDEC, AIRMASS, PIERSIDE.',
    program: PROGRAM,
    emulatesVersion: VERSION,
    sources: SOURCES,
    cards: [
      ...baseCards(4499, 3599),
      card('SWCREATE', SWCREATE, 'Software that created this file'),
      card('IMAGETYP', 'LIGHT', 'Type of image'),
      num('EXPTIME', 600, '600.0', '[s] Exposure time'),
      card('DATE-OBS', '2026-05-14T00:45:30.000', 'Time of observation (UTC)'),
      card('INSTRUME', 'Moravian G3-16200', 'Camera model'),
      card('XBINNING', 1, 'X binning'),
      card('YBINNING', 1, 'Y binning'),
      num('SET-TEMP', -20, '-20.0', '[degC] Cooler setpoint'),
      num('CCD-TEMP', -20, '-20.0', '[degC] Sensor temperature'),
      card('TELESCOP', 'TS-Optics 130 APO', 'Telescope name'),
      num('FOCALLEN', 910, '910.0', '[mm] Focal length'),
      card('RA', 311.408333, '[deg] Right ascension of center'),
      card('DEC', 30.708333, '[deg] Declination of center'),
      card('OBJCTRA', '20 45 38', 'Object right ascension (sexagesimal)'),
      card('OBJCTDEC', '+30 42 30', 'Object declination (sexagesimal)'),
      card('AIRMASS', 1.052, 'Airmass at frame center'),
      card('PIERSIDE', 'East', 'Side of pier'),
      card('FILTER', 'S2', 'Filter name'),
      card('OBJECT', 'NGC 6960', 'Target name'),
    ],
    keywords: {
      OBJECT: 'NGC 6960',
      IMAGETYP: 'LIGHT',
      FILTER: 'S2',
      EXPTIME: 600,
      'DATE-OBS': '2026-05-14T00:45:30.000',
      TELESCOP: 'TS-Optics 130 APO',
      INSTRUME: 'Moravian G3-16200',
      'CCD-TEMP': -20,
      XBINNING: 1,
      YBINNING: 1,
      NAXIS1: 4499,
      NAXIS2: 3599,
      RA: 311.408333,
      DEC: 30.708333,
      OBJCTRA: '20 45 38',
      OBJCTDEC: '+30 42 30',
      SWCREATE,
      AIRMASS: 1.052,
      PIERSIDE: 'East',
    },
    notes: "'S2' maps to the DD-005 SII canonical filter.",
  }),

  validFits({
    file: 'fits/voyager/voyager-light.fits',
    description: 'Voyager broadband light frame.',
    program: PROGRAM,
    emulatesVersion: VERSION,
    sources: SOURCES,
    cards: [
      ...baseCards(4499, 3599),
      card('SWCREATE', SWCREATE, 'Software that created this file'),
      card('IMAGETYP', 'LIGHT', 'Type of image'),
      num('EXPTIME', 120, '120.0', '[s] Exposure time'),
      card('DATE-OBS', '2026-05-14T02:31:12.000', 'Time of observation (UTC)'),
      card('INSTRUME', 'Moravian G3-16200', 'Camera model'),
      card('XBINNING', 1, 'X binning'),
      card('YBINNING', 1, 'Y binning'),
      num('CCD-TEMP', -20, '-20.0', '[degC] Sensor temperature'),
      card('TELESCOP', 'TS-Optics 130 APO', 'Telescope name'),
      num('FOCALLEN', 910, '910.0', '[mm] Focal length'),
      card('RA', 250.421667, '[deg] Right ascension of center'),
      card('DEC', 36.461667, '[deg] Declination of center'),
      card('FILTER', 'Lum', 'Filter name'),
      card('OBJECT', 'M 13', 'Target name'),
    ],
    keywords: {
      OBJECT: 'M 13',
      IMAGETYP: 'LIGHT',
      FILTER: 'Lum',
      EXPTIME: 120,
      'DATE-OBS': '2026-05-14T02:31:12.000',
      TELESCOP: 'TS-Optics 130 APO',
      INSTRUME: 'Moravian G3-16200',
      'CCD-TEMP': -20,
      XBINNING: 1,
      YBINNING: 1,
      NAXIS1: 4499,
      NAXIS2: 3599,
      RA: 250.421667,
      DEC: 36.461667,
      SWCREATE,
    },
  }),

  validFits({
    file: 'fits/voyager/voyager-dark.fits',
    description: 'Voyager dark frame: no OBJECT, FILTER, or pointing keywords.',
    program: PROGRAM,
    emulatesVersion: VERSION,
    sources: SOURCES,
    cards: [
      ...baseCards(4499, 3599),
      card('SWCREATE', SWCREATE, 'Software that created this file'),
      card('IMAGETYP', 'DARK', 'Type of image'),
      num('EXPTIME', 600, '600.0', '[s] Exposure time'),
      card('DATE-OBS', '2026-05-14T09:20:00.000', 'Time of observation (UTC)'),
      card('INSTRUME', 'Moravian G3-16200', 'Camera model'),
      card('XBINNING', 1, 'X binning'),
      card('YBINNING', 1, 'Y binning'),
      num('CCD-TEMP', -20, '-20.0', '[degC] Sensor temperature'),
    ],
    keywords: {
      IMAGETYP: 'DARK',
      EXPTIME: 600,
      'DATE-OBS': '2026-05-14T09:20:00.000',
      INSTRUME: 'Moravian G3-16200',
      'CCD-TEMP': -20,
      XBINNING: 1,
      YBINNING: 1,
      NAXIS1: 4499,
      NAXIS2: 3599,
      SWCREATE,
    },
  }),

  validFits({
    file: 'fits/voyager/voyager-flat.fits',
    description: 'Voyager flat frame with FILTER but no OBJECT.',
    program: PROGRAM,
    emulatesVersion: VERSION,
    sources: SOURCES,
    cards: [
      ...baseCards(4499, 3599),
      card('SWCREATE', SWCREATE, 'Software that created this file'),
      card('IMAGETYP', 'FLAT', 'Type of image'),
      num('EXPTIME', 4, '4.0', '[s] Exposure time'),
      card('DATE-OBS', '2026-05-14T08:05:47.000', 'Time of observation (UTC)'),
      card('INSTRUME', 'Moravian G3-16200', 'Camera model'),
      card('XBINNING', 1, 'X binning'),
      card('YBINNING', 1, 'Y binning'),
      num('CCD-TEMP', -20, '-20.0', '[degC] Sensor temperature'),
      card('FILTER', 'S2', 'Filter name'),
    ],
    keywords: {
      IMAGETYP: 'FLAT',
      FILTER: 'S2',
      EXPTIME: 4,
      'DATE-OBS': '2026-05-14T08:05:47.000',
      INSTRUME: 'Moravian G3-16200',
      'CCD-TEMP': -20,
      XBINNING: 1,
      YBINNING: 1,
      NAXIS1: 4499,
      NAXIS2: 3599,
      SWCREATE,
    },
  }),
];
