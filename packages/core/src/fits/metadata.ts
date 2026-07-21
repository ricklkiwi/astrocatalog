/**
 * Normalized frame metadata (P1-01): PRD §8.2 critical + important keywords
 * extracted from a parsed FITS header into one typed shape shared with the
 * XISF (P1-02) and RAW (P1-03) parsers. Every parsed keyword — normalized or
 * not — is preserved verbatim in {@link FrameMetadata.headers} (DD-004:
 * tolerate non-standard keywords, store all in `headers_json`).
 */

import type { FitsHeader, FitsValue } from './types.js';

export interface FrameMetadata {
  /* PRD §8.2 critical (MVP) */
  object: string | null;
  /** Raw IMAGETYP value; frame-type classification happens in Stage 3 (DD-004). */
  imageType: string | null;
  filter: string | null;
  /** EXPTIME, falling back to EXPOSURE (capture programs disagree). */
  exposureSeconds: number | null;
  /** DATE-OBS as written (UTC by FITS convention, DD-002 rule 4). */
  dateObs: string | null;
  telescope: string | null;
  instrument: string | null;
  ccdTempCelsius: number | null;
  gain: number | null;
  offset: number | null;
  binningX: number | null;
  binningY: number | null;
  widthPixels: number | null;
  heightPixels: number | null;
  /** Degrees; numeric RA keyword, else sexagesimal OBJCTRA (hours) converted. */
  raDegrees: number | null;
  /** Degrees; numeric DEC keyword, else sexagesimal OBJCTDEC converted. */
  decDegrees: number | null;
  /* PRD §8.2 important (v1.x) */
  observer: string | null;
  siteName: string | null;
  airmass: number | null;
  focalLengthMm: number | null;
  apertureDiameterMm: number | null;
  pierSide: string | null;
  rotatorAngleDegrees: number | null;
  bayerPattern: string | null;
  rowOrder: string | null;
  setTempCelsius: number | null;
  sensorReadoutHz: number | null;
  electronsPerAdu: number | null;
  /** Every parsed keyword, including ones not normalized above. */
  headers: Record<string, FitsValue>;
}

const SEXAGESIMAL_RE = /^([+-]?)(\d{1,3})[ :](\d{1,2})[ :](\d{1,2}(?:\.\d+)?)$/;

/**
 * Parse a sexagesimal `"HH MM SS.s"` / `"±DD MM SS.s"` triplet to a decimal
 * count of the leading unit. Returns null for anything else.
 */
export function parseSexagesimal(text: string): number | null {
  const match = SEXAGESIMAL_RE.exec(text.trim());
  if (match === null) return null;
  const sign = match[1] === '-' ? -1 : 1;
  const primary = Number(match[2]);
  const minutes = Number(match[3]);
  const seconds = Number(match[4]);
  if (minutes >= 60 || seconds >= 60) return null;
  return sign * (primary + minutes / 60 + seconds / 3600);
}

function str(keywords: Record<string, FitsValue>, key: string): string | null {
  const value = keywords[key];
  return typeof value === 'string' ? value : null;
}

function num(keywords: Record<string, FitsValue>, key: string): number | null {
  const value = keywords[key];
  return typeof value === 'number' ? value : null;
}

function raDegrees(keywords: Record<string, FitsValue>): number | null {
  const direct = num(keywords, 'RA');
  if (direct !== null) return direct;
  const sexagesimal = str(keywords, 'OBJCTRA');
  if (sexagesimal === null) return null;
  const hours = parseSexagesimal(sexagesimal);
  return hours === null ? null : hours * 15;
}

function decDegrees(keywords: Record<string, FitsValue>): number | null {
  const direct = num(keywords, 'DEC');
  if (direct !== null) return direct;
  const sexagesimal = str(keywords, 'OBJCTDEC');
  if (sexagesimal === null) return null;
  return parseSexagesimal(sexagesimal);
}

/** Extract PRD §8.2 critical + important keywords from a parsed header. */
export function toFrameMetadata(header: FitsHeader): FrameMetadata {
  const k = header.keywords;
  return {
    object: str(k, 'OBJECT'),
    imageType: str(k, 'IMAGETYP'),
    filter: str(k, 'FILTER'),
    exposureSeconds: num(k, 'EXPTIME') ?? num(k, 'EXPOSURE'),
    dateObs: str(k, 'DATE-OBS'),
    telescope: str(k, 'TELESCOP'),
    instrument: str(k, 'INSTRUME'),
    ccdTempCelsius: num(k, 'CCD-TEMP'),
    gain: num(k, 'GAIN'),
    offset: num(k, 'OFFSET'),
    binningX: num(k, 'XBINNING'),
    binningY: num(k, 'YBINNING'),
    widthPixels: num(k, 'NAXIS1'),
    heightPixels: num(k, 'NAXIS2'),
    raDegrees: raDegrees(k),
    decDegrees: decDegrees(k),
    observer: str(k, 'OBSERVER'),
    siteName: str(k, 'SITENAME'),
    airmass: num(k, 'AIRMASS'),
    focalLengthMm: num(k, 'FOCALLEN'),
    apertureDiameterMm: num(k, 'APTDIA'),
    pierSide: str(k, 'PIERSIDE'),
    rotatorAngleDegrees: num(k, 'OBJCTROT'),
    bayerPattern: str(k, 'BAYERPAT'),
    rowOrder: str(k, 'ROWORDER'),
    setTempCelsius: num(k, 'SET-TEMP'),
    sensorReadoutHz: num(k, 'SENSORHZ'),
    electronsPerAdu: num(k, 'EGAIN'),
    headers: { ...k },
  };
}
