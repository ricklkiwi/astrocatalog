/**
 * Normalized frame metadata (P1-02): extracts the same {@link FrameMetadata}
 * shape as the FITS parser (P1-01) from a parsed XISF header. FITSKeyword
 * values take priority (they mirror the FITS §8.2 keyword semantics
 * directly); native XISF Property elements fill in fields whose FITSKeyword
 * is absent, for writers that emit XISF-native metadata only. Every
 * FITSKeyword — normalized or not — is preserved verbatim in
 * {@link FrameMetadata.headers} (DD-004: store all in `headers_json`).
 */

import { parseSexagesimal, type FrameMetadata } from '../fits/metadata.js';
import type { XisfHeader } from './types.js';

/**
 * Property ids with a documented, unambiguous mapping to a FrameMetadata
 * field, used only when the equivalent FITSKeyword is absent. XISF has no
 * standard property for every §8.2 keyword (e.g. GAIN, OFFSET, binning),
 * so those fields rely on FITSKeyword alone.
 */
const OBJECT_PROPERTY = 'Observation:Object:Name';
const FILTER_PROPERTY = 'Instrument:Filter:Name';
const TELESCOPE_PROPERTY = 'Instrument:Telescope:Name';
const EXPOSURE_PROPERTY = 'Instrument:ExposureTime';
const TEMPERATURE_PROPERTY = 'Instrument:Sensor:Temperature';
const DATE_OBS_PROPERTY = 'Observation:Time:Start';

function str(keywords: Record<string, string>, key: string): string | null {
  const value = keywords[key];
  return value === undefined ? null : value;
}

function num(keywords: Record<string, string>, key: string): number | null {
  const value = keywords[key];
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function strWithPropertyFallback(
  header: XisfHeader,
  keyword: string,
  propertyId: string,
): string | null {
  const direct = str(header.keywords, keyword);
  if (direct !== null) return direct;
  const property = header.properties[propertyId];
  return property === undefined ? null : property.value;
}

function numWithPropertyFallback(
  header: XisfHeader,
  keyword: string,
  propertyId: string,
): number | null {
  const direct = num(header.keywords, keyword);
  if (direct !== null) return direct;
  const property = header.properties[propertyId];
  if (property === undefined) return null;
  const parsed = Number(property.value);
  return Number.isFinite(parsed) ? parsed : null;
}

function raDegrees(keywords: Record<string, string>): number | null {
  const direct = num(keywords, 'RA');
  if (direct !== null) return direct;
  const sexagesimal = str(keywords, 'OBJCTRA');
  if (sexagesimal === null) return null;
  const hours = parseSexagesimal(sexagesimal);
  return hours === null ? null : hours * 15;
}

function decDegrees(keywords: Record<string, string>): number | null {
  const direct = num(keywords, 'DEC');
  if (direct !== null) return direct;
  const sexagesimal = str(keywords, 'OBJCTDEC');
  return sexagesimal === null ? null : parseSexagesimal(sexagesimal);
}

/** Extract PRD §8.2 critical + important keywords from a parsed XISF header. */
export function toFrameMetadata(header: XisfHeader): FrameMetadata {
  const k = header.keywords;
  return {
    object: strWithPropertyFallback(header, 'OBJECT', OBJECT_PROPERTY),
    imageType: str(k, 'IMAGETYP'),
    filter: strWithPropertyFallback(header, 'FILTER', FILTER_PROPERTY),
    exposureSeconds:
      numWithPropertyFallback(header, 'EXPTIME', EXPOSURE_PROPERTY) ?? num(k, 'EXPOSURE'),
    dateObs: strWithPropertyFallback(header, 'DATE-OBS', DATE_OBS_PROPERTY),
    telescope: strWithPropertyFallback(header, 'TELESCOP', TELESCOPE_PROPERTY),
    instrument: str(k, 'INSTRUME'),
    ccdTempCelsius: numWithPropertyFallback(header, 'CCD-TEMP', TEMPERATURE_PROPERTY),
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
