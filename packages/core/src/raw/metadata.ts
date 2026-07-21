/**
 * Normalized frame metadata (P1-03): maps the RAW/EXIF {@link RawKeywords}
 * subset into the same {@link FrameMetadata} shape shared with the FITS
 * (P1-01) and XISF (P1-02) parsers. EXIF carries none of FrameMetadata's
 * astronomy-specific fields (OBJECT, FILTER, telescope, CCD temperature,
 * binning, pointing, ...) — those stay `null` here and are resolved later
 * by Stage 3 path heuristics / user input (DD-004 classification order).
 * The full raw EXIF/TIFF tag dictionary is preserved verbatim in
 * {@link FrameMetadata.headers} (DD-004: store everything in
 * `headers_json`).
 */

import type { FrameMetadata } from '../fits/metadata.js';
import type { FitsValue } from '../fits/types.js';
import type { RawHeader, RawKeywords, RawValue } from './types.js';

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

const DATE_TIME_RE = /^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;
const OFFSET_RE = /^([+-])(\d{2}):(\d{2})$/;

/**
 * Normalize EXIF `DateTimeOriginal` (+ optional `OffsetTimeOriginal`) to
 * `FrameMetadata.dateObs`.
 *
 * - Offset present and well-formed: convert the wall-clock reading to a
 *   true UTC instant and format it `YYYY-MM-DDTHH:MM:SSZ` — an unambiguous
 *   UTC timestamp (DD-002 rule 4).
 * - Offset absent (the common case — most cameras never write
 *   `OffsetTimeOriginal`): there is no reliable way to know what UTC
 *   offset the camera's clock was set to, so guessing one would be worse
 *   than admitting the ambiguity. Format the naive local reading
 *   `YYYY-MM-DDTHH:MM:SS` with **no trailing `Z`** — this is deliberately
 *   not a UTC timestamp; it's the camera's wall-clock reading, unconverted.
 *   Downstream consumers must treat a `dateObs` without a `Z` suffix as
 *   approximate local time, not UTC.
 * - Malformed/absent `DateTimeOriginal`: `null`.
 */
export function normalizeDateObs(
  dateTimeOriginal: string | null,
  offsetTimeOriginal: string | null,
): string | null {
  const dateMatch = DATE_TIME_RE.exec(dateTimeOriginal ?? '');
  if (dateMatch === null) return null;
  const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr] = dateMatch;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const second = Number(secondStr);

  const offsetMatch = offsetTimeOriginal === null ? null : OFFSET_RE.exec(offsetTimeOriginal);
  if (offsetMatch === null) {
    return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}T${pad(hour, 2)}:${pad(minute, 2)}:${pad(second, 2)}`;
  }

  const [, sign, offHourStr, offMinuteStr] = offsetMatch;
  const offsetMinutes = (sign === '-' ? -1 : 1) * (Number(offHourStr) * 60 + Number(offMinuteStr));
  const localMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const utc = new Date(localMs - offsetMinutes * 60_000);
  return (
    `${pad(utc.getUTCFullYear(), 4)}-${pad(utc.getUTCMonth() + 1, 2)}-${pad(utc.getUTCDate(), 2)}` +
    `T${pad(utc.getUTCHours(), 2)}:${pad(utc.getUTCMinutes(), 2)}:${pad(utc.getUTCSeconds(), 2)}Z`
  );
}

/**
 * Combine EXIF `Make` + `Model` into `FrameMetadata.instrument`. Camera
 * makers are inconsistent about whether `Model` already repeats the brand
 * name (`Make: "Canon", Model: "Canon EOS 6D"` vs. `Make: "SONY", Model:
 * "ILCE-7M4"`) — concatenating unconditionally would produce
 * "Canon Canon EOS 6D" for the former. Combine only when `Model` doesn't
 * already mention `Make`'s first word (its brand token); otherwise use
 * `Model` alone.
 */
export function cameraInstrument(make: string | null, model: string | null): string | null {
  if (make === null) return model;
  if (model === null) return make;
  const brandToken = make.trim().split(/\s+/)[0] ?? make;
  if (brandToken !== '' && model.toLowerCase().includes(brandToken.toLowerCase())) return model;
  return `${make} ${model}`;
}

/**
 * `FrameMetadata.headers` is typed `Record<string, FitsValue>` (shared
 * across all three adapters) and `FitsValue` has no array variant, but
 * `exifr` can return array-valued tags (e.g. GPS coordinate triplets).
 * Arrays are flattened to their JSON string form here so every tag still
 * round-trips into `headers_json`, just not as a native array.
 */
function toFitsCompatibleHeaders(
  tags: Record<string, RawValue | RawValue[]>,
): Record<string, FitsValue> {
  const headers: Record<string, FitsValue> = {};
  for (const [key, value] of Object.entries(tags)) {
    headers[key] = Array.isArray(value) ? JSON.stringify(value) : value;
  }
  return headers;
}

/** Extract the P1-03 EXIF subset from a parsed RAW header into {@link FrameMetadata}. */
export function toFrameMetadata(header: RawHeader): FrameMetadata {
  const k: RawKeywords = header.keywords;
  return {
    /* EXIF carries no equivalent for either — always null (path heuristics resolve them, DD-004). */
    object: null,
    imageType: null,
    filter: null,
    exposureSeconds: k.ExposureTime,
    dateObs: normalizeDateObs(k.DateTimeOriginal, k.OffsetTimeOriginal),
    /* No telescope concept for a DSLR/mirrorless body shooting RAW. */
    telescope: null,
    instrument: cameraInstrument(k.Make, k.Model),
    ccdTempCelsius: null,
    /** ISO is the closest DSLR/mirrorless analog to GAIN — RAW/EXIF has no true gain concept. */
    gain: k.ISO,
    offset: null,
    binningX: null,
    binningY: null,
    widthPixels: null,
    heightPixels: null,
    raDegrees: null,
    decDegrees: null,
    observer: null,
    siteName: null,
    airmass: null,
    focalLengthMm: null,
    apertureDiameterMm: null,
    pierSide: null,
    rotatorAngleDegrees: null,
    bayerPattern: null,
    rowOrder: null,
    setTempCelsius: null,
    sensorReadoutHz: null,
    electronsPerAdu: null,
    headers: toFitsCompatibleHeaders(header.tags),
  };
}
