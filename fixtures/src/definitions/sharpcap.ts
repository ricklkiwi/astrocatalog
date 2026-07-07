/**
 * SharpCap-convention FITS fixtures (4).
 *
 * Conventions synthesized from the SharpCap user manual
 * (https://www.sharpcap.co.uk/): SWCREATE 'SharpCap v4.x...', EXPTIME,
 * XPIXSZ/YPIXSZ, CCD-TEMP, INSTRUME; EAA-style captures typically carry no
 * OBJECT keyword (DD-005 needs-review path), and SharpCap emits additional
 * vendor keywords that parsers must tolerate and preserve in headers_json.
 */

import { card, num } from '../lib/fits.js';
import { baseCards, validFits } from './common.js';
import { SRC } from './sources.js';
import type { FixtureDef } from './types.js';

const PROGRAM = 'SharpCap';
const VERSION = '4.x';
const SOURCES = [SRC.SHARPCAP_SITE, SRC.FITS_STANDARD];
const SWCREATE = 'SharpCap v4.1.11962.0, 64 bit';

export const sharpcapDefs: FixtureDef[] = [
  validFits({
    file: 'fits/sharpcap/sharpcap-eaa-light.fits',
    description:
      'SharpCap EAA-style light frame with no OBJECT keyword: the frame must land in the ' +
      'DD-005 needs-review bucket (resolution path 5).',
    program: PROGRAM,
    emulatesVersion: VERSION,
    sources: SOURCES,
    cards: [
      ...baseCards(4144, 2822),
      card('IMAGETYP', 'Light', 'Type of image'),
      num('EXPTIME', 8, '8.0', '[s] Exposure time'),
      card('DATE-OBS', '2026-04-02T20:15:09.412', 'Time of observation (UTC)'),
      card('SWCREATE', SWCREATE, 'Software used to create file'),
      card('INSTRUME', 'ZWO ASI294MC', 'Camera model'),
      card('XPIXSZ', 4.63, '[um] Pixel width'),
      card('YPIXSZ', 4.63, '[um] Pixel height'),
      card('XBINNING', 1, 'Horizontal binning'),
      card('YBINNING', 1, 'Vertical binning'),
      card('GAIN', 350, 'Camera gain'),
      card('CCD-TEMP', 22.4, '[degC] Sensor temperature (uncooled)'),
      card('BAYERPAT', 'RGGB', 'Sensor Bayer pattern'),
    ],
    keywords: {
      IMAGETYP: 'Light',
      EXPTIME: 8,
      'DATE-OBS': '2026-04-02T20:15:09.412',
      INSTRUME: 'ZWO ASI294MC',
      'CCD-TEMP': 22.4,
      GAIN: 350,
      XBINNING: 1,
      YBINNING: 1,
      NAXIS1: 4144,
      NAXIS2: 2822,
      SWCREATE,
      BAYERPAT: 'RGGB',
    },
    notes:
      'OBJECT and FILTER are absent by design (EAA session). DD-005 path 5: unresolved ' +
      'frames go to the needs-review bucket; absent FILTER maps to the None canonical filter.',
  }),

  validFits({
    file: 'fits/sharpcap/sharpcap-light-vendor-keywords.fits',
    description:
      'SharpCap light frame carrying extra vendor keywords (BLKLEVEL, USBSPEED, STACKCNT): ' +
      'tolerated non-standard cards that must be preserved in headers_json (DD-004).',
    program: PROGRAM,
    emulatesVersion: VERSION,
    sources: SOURCES,
    cards: [
      ...baseCards(4144, 2822),
      card('IMAGETYP', 'Light', 'Type of image'),
      num('EXPTIME', 15, '15.0', '[s] Exposure time'),
      card('DATE-OBS', '2026-04-02T21:44:30.006', 'Time of observation (UTC)'),
      card('SWCREATE', SWCREATE, 'Software used to create file'),
      card('INSTRUME', 'ZWO ASI294MC', 'Camera model'),
      card('XPIXSZ', 4.63, '[um] Pixel width'),
      card('YPIXSZ', 4.63, '[um] Pixel height'),
      card('XBINNING', 1, 'Horizontal binning'),
      card('YBINNING', 1, 'Vertical binning'),
      card('GAIN', 250, 'Camera gain'),
      card('CCD-TEMP', 21.8, '[degC] Sensor temperature (uncooled)'),
      card('FILTER', 'UV/IR', 'Filter name'),
      card('OBJECT', 'M 13', 'Target name'),
      card('BLKLEVEL', 30, 'Camera black level (vendor keyword)'),
      card('USBSPEED', 40, 'USB traffic setting (vendor keyword)'),
      card('STACKCNT', 1, 'Live stack frame count (vendor keyword)'),
    ],
    keywords: {
      OBJECT: 'M 13',
      IMAGETYP: 'Light',
      FILTER: 'UV/IR',
      EXPTIME: 15,
      'DATE-OBS': '2026-04-02T21:44:30.006',
      INSTRUME: 'ZWO ASI294MC',
      'CCD-TEMP': 21.8,
      GAIN: 250,
      XBINNING: 1,
      YBINNING: 1,
      NAXIS1: 4144,
      NAXIS2: 2822,
      SWCREATE,
      BLKLEVEL: 30,
      USBSPEED: 40,
      STACKCNT: 1,
    },
    notes:
      'BLKLEVEL/USBSPEED/STACKCNT are non-standard vendor cards: a conforming parser keeps ' +
      "them in headers_json (DD-004 'unknown keywords are preserved, never discarded'). " +
      "'UV/IR' maps to the DD-005 L (broadband) canonical filter.",
  }),

  validFits({
    file: 'fits/sharpcap/sharpcap-dark.fits',
    description: 'SharpCap dark frame: no OBJECT, FILTER, or pointing keywords.',
    program: PROGRAM,
    emulatesVersion: VERSION,
    sources: SOURCES,
    cards: [
      ...baseCards(4144, 2822),
      card('IMAGETYP', 'Dark', 'Type of image'),
      num('EXPTIME', 15, '15.0', '[s] Exposure time'),
      card('DATE-OBS', '2026-04-03T03:02:52.190', 'Time of observation (UTC)'),
      card('SWCREATE', SWCREATE, 'Software used to create file'),
      card('INSTRUME', 'ZWO ASI294MC', 'Camera model'),
      card('XBINNING', 1, 'Horizontal binning'),
      card('YBINNING', 1, 'Vertical binning'),
      card('GAIN', 250, 'Camera gain'),
      card('CCD-TEMP', 20.9, '[degC] Sensor temperature (uncooled)'),
    ],
    keywords: {
      IMAGETYP: 'Dark',
      EXPTIME: 15,
      'DATE-OBS': '2026-04-03T03:02:52.190',
      INSTRUME: 'ZWO ASI294MC',
      'CCD-TEMP': 20.9,
      GAIN: 250,
      XBINNING: 1,
      YBINNING: 1,
      NAXIS1: 4144,
      NAXIS2: 2822,
      SWCREATE,
    },
  }),

  validFits({
    file: 'fits/sharpcap/sharpcap-flat.fits',
    description: 'SharpCap flat frame with FILTER but no OBJECT.',
    program: PROGRAM,
    emulatesVersion: VERSION,
    sources: SOURCES,
    cards: [
      ...baseCards(4144, 2822),
      card('IMAGETYP', 'Flat', 'Type of image'),
      num('EXPTIME', 0.5, '0.5', '[s] Exposure time'),
      card('DATE-OBS', '2026-04-03T05:20:11.731', 'Time of observation (UTC)'),
      card('SWCREATE', SWCREATE, 'Software used to create file'),
      card('INSTRUME', 'ZWO ASI294MC', 'Camera model'),
      card('XBINNING', 1, 'Horizontal binning'),
      card('YBINNING', 1, 'Vertical binning'),
      card('GAIN', 120, 'Camera gain'),
      card('CCD-TEMP', 19.6, '[degC] Sensor temperature (uncooled)'),
      card('FILTER', 'UV/IR', 'Filter name'),
    ],
    keywords: {
      IMAGETYP: 'Flat',
      FILTER: 'UV/IR',
      EXPTIME: 0.5,
      'DATE-OBS': '2026-04-03T05:20:11.731',
      INSTRUME: 'ZWO ASI294MC',
      'CCD-TEMP': 19.6,
      GAIN: 120,
      XBINNING: 1,
      YBINNING: 1,
      NAXIS1: 4144,
      NAXIS2: 2822,
      SWCREATE,
    },
  }),
];
