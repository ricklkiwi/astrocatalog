/**
 * Astro Photography Tool-convention FITS fixtures (4).
 *
 * Conventions synthesized from the APT user guide
 * (https://www.astrophotography.app/): SWCREATE 'Astro Photography Tool - APT
 * v.x.y', APTDIA aperture diameter, JD Julian date, TELESCOP/OBSERVER; DSLR
 * captures have no FILTER keyword (DD-005 'None' canonical filter).
 */

import { card, num } from '../lib/fits.js';
import { baseCards, validFits } from './common.js';
import { SRC } from './sources.js';
import type { FixtureDef } from './types.js';

const PROGRAM = 'APT';
const VERSION = '4.x';
const SOURCES = [SRC.APT_SITE, SRC.FITS_STANDARD];
const SWCREATE = 'Astro Photography Tool - APT v.4.10';

export const aptDefs: FixtureDef[] = [
  validFits({
    file: 'fits/apt/apt-dslr-light.fits',
    description:
      'APT DSLR light frame: no FILTER keyword at all (exercises the DD-005 None ' +
      'canonical filter), with APTDIA, JD, TELESCOP, and OBSERVER.',
    program: PROGRAM,
    emulatesVersion: VERSION,
    sources: SOURCES,
    cards: [
      ...baseCards(5472, 3648),
      card('IMAGETYP', 'Light', 'Type of image'),
      num('EXPTIME', 240, '240.0', '[s] Exposure time'),
      card('DATE-OBS', '2026-03-19T04:03:51.000', 'Time of observation (UTC)'),
      card('SWCREATE', SWCREATE, 'Capture software'),
      card('INSTRUME', 'Canon EOS 6D', 'Camera name'),
      card('XBINNING', 1, 'X binning'),
      card('YBINNING', 1, 'Y binning'),
      card('TELESCOP', 'SkyWatcher 200PDS', 'Telescope name'),
      num('APTDIA', 200, '200.0', '[mm] Aperture diameter'),
      num('FOCALLEN', 1000, '1000.0', '[mm] Focal length'),
      card('JD', 2461118.66934, 'Julian Date'),
      card('OBSERVER', 'AstroTracker Fixtures', 'Observer name'),
      card('RA', 83.822083, '[deg] Right ascension'),
      card('DEC', -5.391111, '[deg] Declination'),
      card('OBJECT', 'M 42', 'Target name'),
    ],
    keywords: {
      OBJECT: 'M 42',
      IMAGETYP: 'Light',
      EXPTIME: 240,
      'DATE-OBS': '2026-03-19T04:03:51.000',
      TELESCOP: 'SkyWatcher 200PDS',
      INSTRUME: 'Canon EOS 6D',
      XBINNING: 1,
      YBINNING: 1,
      NAXIS1: 5472,
      NAXIS2: 3648,
      RA: 83.822083,
      DEC: -5.391111,
      SWCREATE,
      APTDIA: 200,
      JD: 2461118.66934,
      OBSERVER: 'AstroTracker Fixtures',
    },
    notes:
      'DSLR capture: FILTER is structurally absent, not empty - DD-005 maps the absence ' +
      'to the None canonical filter. No CCD-TEMP/GAIN either (DSLR sensor).',
  }),

  validFits({
    file: 'fits/apt/apt-ccd-light.fits',
    description: 'APT cooled-CCD light frame with FILTER and CCD-TEMP.',
    program: PROGRAM,
    emulatesVersion: VERSION,
    sources: SOURCES,
    cards: [
      ...baseCards(2749, 2199),
      card('IMAGETYP', 'Light', 'Type of image'),
      num('EXPTIME', 300, '300.0', '[s] Exposure time'),
      card('DATE-OBS', '2026-03-20T02:51:20.000', 'Time of observation (UTC)'),
      card('SWCREATE', SWCREATE, 'Capture software'),
      card('INSTRUME', 'Atik 460EX', 'Camera name'),
      card('XBINNING', 1, 'X binning'),
      card('YBINNING', 1, 'Y binning'),
      num('CCD-TEMP', -10, '-10.0', '[degC] Sensor temperature'),
      card('TELESCOP', 'SkyWatcher 200PDS', 'Telescope name'),
      num('APTDIA', 200, '200.0', '[mm] Aperture diameter'),
      num('FOCALLEN', 1000, '1000.0', '[mm] Focal length'),
      card('JD', 2461119.61899, 'Julian Date'),
      card('OBSERVER', 'AstroTracker Fixtures', 'Observer name'),
      card('FILTER', 'Red', 'Filter name'),
      card('RA', 324.746208, '[deg] Right ascension'),
      card('DEC', 57.489167, '[deg] Declination'),
      card('OBJECT', 'IC 1396', 'Target name'),
    ],
    keywords: {
      OBJECT: 'IC 1396',
      IMAGETYP: 'Light',
      FILTER: 'Red',
      EXPTIME: 300,
      'DATE-OBS': '2026-03-20T02:51:20.000',
      TELESCOP: 'SkyWatcher 200PDS',
      INSTRUME: 'Atik 460EX',
      'CCD-TEMP': -10,
      XBINNING: 1,
      YBINNING: 1,
      NAXIS1: 2749,
      NAXIS2: 2199,
      RA: 324.746208,
      DEC: 57.489167,
      SWCREATE,
      APTDIA: 200,
      JD: 2461119.61899,
    },
  }),

  validFits({
    file: 'fits/apt/apt-dark.fits',
    description: 'APT dark frame: no OBJECT, FILTER, or pointing keywords.',
    program: PROGRAM,
    emulatesVersion: VERSION,
    sources: SOURCES,
    cards: [
      ...baseCards(2749, 2199),
      card('IMAGETYP', 'Dark', 'Type of image'),
      num('EXPTIME', 300, '300.0', '[s] Exposure time'),
      card('DATE-OBS', '2026-03-20T10:14:07.000', 'Time of observation (UTC)'),
      card('SWCREATE', SWCREATE, 'Capture software'),
      card('INSTRUME', 'Atik 460EX', 'Camera name'),
      card('XBINNING', 1, 'X binning'),
      card('YBINNING', 1, 'Y binning'),
      num('CCD-TEMP', -10, '-10.0', '[degC] Sensor temperature'),
      card('JD', 2461119.92647, 'Julian Date'),
    ],
    keywords: {
      IMAGETYP: 'Dark',
      EXPTIME: 300,
      'DATE-OBS': '2026-03-20T10:14:07.000',
      INSTRUME: 'Atik 460EX',
      'CCD-TEMP': -10,
      XBINNING: 1,
      YBINNING: 1,
      NAXIS1: 2749,
      NAXIS2: 2199,
      SWCREATE,
    },
  }),

  validFits({
    file: 'fits/apt/apt-flat.fits',
    description: 'APT flat frame with FILTER but no OBJECT.',
    program: PROGRAM,
    emulatesVersion: VERSION,
    sources: SOURCES,
    cards: [
      ...baseCards(2749, 2199),
      card('IMAGETYP', 'Flat', 'Type of image'),
      num('EXPTIME', 3.5, '3.5', '[s] Exposure time'),
      card('DATE-OBS', '2026-03-20T09:48:40.000', 'Time of observation (UTC)'),
      card('SWCREATE', SWCREATE, 'Capture software'),
      card('INSTRUME', 'Atik 460EX', 'Camera name'),
      card('XBINNING', 1, 'X binning'),
      card('YBINNING', 1, 'Y binning'),
      num('CCD-TEMP', -10, '-10.0', '[degC] Sensor temperature'),
      card('FILTER', 'Red', 'Filter name'),
      card('JD', 2461119.9088, 'Julian Date'),
    ],
    keywords: {
      IMAGETYP: 'Flat',
      FILTER: 'Red',
      EXPTIME: 3.5,
      'DATE-OBS': '2026-03-20T09:48:40.000',
      INSTRUME: 'Atik 460EX',
      'CCD-TEMP': -10,
      XBINNING: 1,
      YBINNING: 1,
      NAXIS1: 2749,
      NAXIS2: 2199,
      SWCREATE,
    },
  }),
];
