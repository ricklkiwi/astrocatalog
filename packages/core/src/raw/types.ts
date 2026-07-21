/**
 * Types for the RAW/EXIF metadata adapter (P1-03, DD-004).
 *
 * Pure domain types: no Electron, no fs (DD-002 rule 1). Unlike the FITS
 * (P1-01) and XISF (P1-02) parsers, this module accepts a complete
 * in-memory buffer rather than a bounded-read callback: `exifr` — the
 * library this adapter wraps — parses directly from a
 * Buffer/Uint8Array/ArrayBuffer and exposes no synchronous or
 * incremental-read API of its own (its `parse()` is Promise-based even for
 * buffers already fully in memory). The caller (a future Stage 2 worker,
 * out of scope for this issue) still owns all file I/O and decides how much
 * of the file to read before calling in — DD-004's "header-only" principle
 * is satisfied by the caller reading a bounded prefix, not by this module
 * reaching into the filesystem.
 */

/** A single EXIF/TIFF tag value, normalized to a JSON-safe primitive. */
export type RawValue = string | number | boolean | null;

/**
 * The narrow set of EXIF concepts P1-03 maps (DD-004 §P1-03 scope):
 * camera make/model, exposure time, ISO, and capture time (+ its UTC
 * offset, when the camera wrote one). `OBJECT` and `FILTER` are always
 * `null` — EXIF carries no equivalent field for either; Stage 3 path
 * heuristics resolve them later (DD-004 classification order).
 */
export interface RawKeywords {
  OBJECT: null;
  FILTER: null;
  Make: string | null;
  Model: string | null;
  /** Seconds, e.g. `0.005` for a 1/200s exposure. */
  ExposureTime: number | null;
  ISO: number | null;
  /** Raw EXIF string, `"YYYY:MM:DD HH:MM:SS"`, exactly as the camera wrote it (no UTC conversion applied here — see `toFrameMetadata`). */
  DateTimeOriginal: string | null;
  /** Raw EXIF string, e.g. `"+02:00"`, when the camera wrote one; `null` when structurally absent. */
  OffsetTimeOriginal: string | null;
}

/**
 * Structured error codes drawn from `fixtures/manifest.schema.json`'s closed
 * enum (the RAW subset). The adapter returns these — it never throws on
 * malformed or unrecognized input (DD-004 error isolation): `exifr`'s own
 * exceptions are caught and classified in `parse.ts`.
 */
export type RawErrorCode = 'EMPTY_FILE' | 'TRUNCATED_HEADER' | 'UNRECOGNIZED_RAW';

export interface RawParseError {
  code: RawErrorCode;
  message: string;
}

/** Successful header parse: the manifest-tested keyword subset plus the full raw tag dictionary. */
export interface RawHeader {
  keywords: RawKeywords;
  /**
   * Every EXIF/TIFF tag `exifr` extracted, keyed by its human-readable name,
   * normalized to JSON-safe values (DD-004: preserve everything in
   * `headers_json`). `exifr` can return `Uint8Array`/`Buffer` values for
   * binary blobs (e.g. maker-note fragments) — those are summarized rather
   * than serialized raw; see `normalizeTagValue` in `parse.ts`.
   */
  tags: Record<string, RawValue | RawValue[]>;
}

export type RawParseResult =
  { status: 'ok'; header: RawHeader } | { status: 'error'; error: RawParseError };
