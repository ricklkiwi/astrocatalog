/**
 * RAW/EXIF metadata adapter (P1-03).
 *
 * Wraps `exifr` to extract the PRD §8.1 "High priority" RAW formats
 * (CR2, CR3, NEF, ARW) plus plain TIFF — all of them TIFF-structured
 * containers `exifr` reads natively from an in-memory buffer, no filesystem
 * access required (DD-002 rule 1).
 *
 * Canon's CR3 is the one exception: it's an ISO-BMFF (MP4-family) container,
 * not a bare TIFF, and `exifr`'s CR3 reader expects the exact box/offset
 * layout Canon firmware produces — it throws `"Unknown file format"` on
 * anything else. Real Canon EXIF is still in there, though: CR3 stores it as
 * one or more small, independently-valid TIFF/EXIF blocks (`CMT1`/`CMT2`/
 * `CMT3`/`CMT4`) that are **direct sibling boxes** inside the Canon metadata
 * `uuid` box under `moov` — each one's payload opens with a plain TIFF
 * header (`II*\0`) and can be handed to `exifr` on its own, unmodified.
 * `extractCr3TiffBlocks` walks `moov/uuid(CNCV)/CMT*` and slices out each
 * one's payload.
 *
 * An earlier version of this walker instead parsed the `CTBO` box — which
 * looks, from its name and the public community write-up
 * (https://github.com/lclevy/canon_cr3), like it should be an offset table
 * for exactly these blocks. Byte-level inspection of a real Canon-firmware
 * CR3 file (2026-07-21) showed that's not what it indexes: its entries
 * point to a preview-image `uuid` box and the main `mdat` pixel payload —
 * not the `CMT*` blocks, which don't need an offset table at all since
 * they're plain sibling boxes findable by direct structural walk. Both the
 * old `CTBO`-table approach and the fixture it was tested against shared
 * the same (wrong) assumption, which is why the fixture-only test suite
 * didn't catch this — real camera output did.
 *
 * Any CR3 whose box layout doesn't match this walk falls through to asking
 * `exifr` to parse the whole file, which reports the same `UNRECOGNIZED_RAW`
 * a non-Canon or corrupt file would.
 *
 * Malformed input never throws across this module's boundary (DD-004 error
 * isolation): `exifr`'s exceptions are caught and classified into a
 * {@link RawParseError}.
 */

import exifr from 'exifr';

import type { RawErrorCode, RawHeader, RawKeywords, RawParseResult, RawValue } from './types.js';

/** Canon's CR3 metadata UUID (`85c0b687-820f-11e0-8111-f4ce462b6a48`), marking the `uuid` box under `moov` that carries `CNCV`/`CCTP`. */
const CANON_CR3_UUID = new Uint8Array([
  0x85, 0xc0, 0xb6, 0x87, 0x82, 0x0f, 0x11, 0xe0, 0x81, 0x11, 0xf4, 0xce, 0x46, 0x2b, 0x6a, 0x48,
]);

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

interface Box {
  /** Absolute offset of the box's `size` field (start of the box). */
  start: number;
  /** Absolute offset of the byte just past this box. */
  end: number;
  /** Absolute offset where this box's payload begins (after size+type, and past the extended `uuid` type when applicable). */
  payloadStart: number;
  type: string;
}

/**
 * Read one ISO-BMFF box header at `offset`. Only supports the plain 32-bit
 * `size` form (no 64-bit `largesize`, no `size === 0` "to EOF" form) — CR3's
 * metadata boxes never need either, and rejecting them here just means an
 * unsupported layout falls through to the whole-buffer `exifr` attempt.
 */
function readBox(bytes: Uint8Array, offset: number): Box | null {
  if (offset + 8 > bytes.length) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = view.getUint32(offset);
  if (size < 8 || offset + size > bytes.length) return null;
  const type = String.fromCharCode(
    bytes[offset + 4] ?? 0,
    bytes[offset + 5] ?? 0,
    bytes[offset + 6] ?? 0,
    bytes[offset + 7] ?? 0,
  );
  let payloadStart = offset + 8;
  if (type === 'uuid') {
    if (offset + 24 > bytes.length) return null;
    payloadStart = offset + 24;
  }
  return { start: offset, end: offset + size, payloadStart, type };
}

/** Find the first direct child box of the given type within `[start, end)`. */
function findChildBox(bytes: Uint8Array, start: number, end: number, type: string): Box | null {
  let offset = start;
  while (offset < end) {
    const box = readBox(bytes, offset);
    if (box === null || box.end > end) return null;
    if (box.type === type) return box;
    offset = box.end;
  }
  return null;
}

/** Matches `CMT1`..`CMT4` (Canon's four metadata block box types) — checked structurally, not by an exhaustive literal list, in case a future firmware adds `CMT5`+. */
const CMT_BOX_TYPE_RE = /^CMT[1-9]\d*$/;

/**
 * Walk `moov/uuid(CNCV)/CMT*` and return each `CMT1`..`CMT4` sibling box's
 * payload, in the order they appear. Returns `[]` (never throws) when the
 * expected box structure isn't present — callers fall through to the
 * generic `exifr.parse(wholeBuffer)` path in that case.
 */
export function extractCr3TiffBlocks(bytes: Uint8Array): Uint8Array[] {
  const moov = findChildBox(bytes, 0, bytes.length, 'moov');
  if (moov === null) return [];

  let offset = moov.payloadStart;
  let canonUuid: Box | null = null;
  while (offset < moov.end) {
    const box = readBox(bytes, offset);
    if (box === null || box.end > moov.end) break;
    if (box.type === 'uuid') {
      const uuidBytes = bytes.subarray(box.start + 8, box.start + 24);
      if (bytesEqual(uuidBytes, CANON_CR3_UUID)) {
        canonUuid = box;
        break;
      }
    }
    offset = box.end;
  }
  if (canonUuid === null) return [];

  const blocks: Uint8Array[] = [];
  offset = canonUuid.payloadStart;
  while (offset < canonUuid.end) {
    const box = readBox(bytes, offset);
    if (box === null || box.end > canonUuid.end) break;
    if (CMT_BOX_TYPE_RE.test(box.type)) {
      blocks.push(bytes.subarray(box.payloadStart, box.end));
    }
    offset = box.end;
  }
  return blocks;
}

/** True when `bytes` opens with an ISO-BMFF `ftyp` box declaring the `crx ` (Canon RAW) major brand. */
export function looksLikeCr3(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const box = readBox(bytes, 0);
  if (box === null || box.type !== 'ftyp') return false;
  const brand = String.fromCharCode(bytes[8] ?? 0, bytes[9] ?? 0, bytes[10] ?? 0, bytes[11] ?? 0);
  return brand === 'crx ';
}

/**
 * `exifr` options fixed for this adapter, not left to the caller:
 * - `reviveValues: false` — `exifr`'s built-in date reviver constructs
 *   `DateTimeOriginal`/`OffsetTimeOriginal` via the *host machine's* local
 *   timezone (`new Date(year, month, day, ...)`), completely ignoring the
 *   EXIF offset tag. That's non-deterministic across machines/CI runners.
 *   Keeping raw strings here lets `metadata.ts` do its own, portable UTC
 *   normalization from `DateTimeOriginal` + `OffsetTimeOriginal`.
 * - `translateKeys: true` / `translateValues: true` — human-readable tag
 *   names (`Make`, `ExposureTime`, ...) matching the fixture manifest.
 * - `mergeOutput: true`, `sanitize: true` — flat output, IFD-pointer
 *   artifacts stripped.
 * - `silentErrors: false` — a malformed file always throws instead of
 *   sometimes coming back as `{ errors: [...] }`; this module wants one
 *   control point (the try/catch below) for error classification.
 */
const EXIFR_OPTIONS = {
  reviveValues: false,
  translateKeys: true,
  translateValues: true,
  mergeOutput: true,
  sanitize: true,
  silentErrors: false,
} as const;

/**
 * `exifr.parse()`'s own type declares `Promise<any>` (it has no generic
 * output type). Narrow immediately to `unknown` and validate shape before
 * touching anything, rather than letting `any` propagate.
 * justified: exifr ships no typed return for `parse()`; this is the single
 * point that absorbs its `any` and turns it into a checked `unknown`.
 */
async function exifrParse(bytes: Uint8Array): Promise<unknown> {
  const result: unknown = await exifr.parse(bytes, EXIFR_OPTIONS);
  return result;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Normalize one `exifr` tag value to a JSON-safe {@link RawValue}. `exifr`
 * can return `Uint8Array`/`Buffer` for binary blobs (e.g. undecoded
 * maker-note fragments) — those aren't meaningfully serializable, so they're
 * summarized as a `"<N bytes>"` marker instead of thrown on or dropped
 * silently. Arrays of primitives (e.g. GPS coordinate triplets) are mapped
 * element-wise.
 */
function normalizeTagValue(value: unknown): RawValue | RawValue[] {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return `<${value.length} bytes>`;
  if (Array.isArray(value)) {
    return value.map((entry) => {
      const normalized = normalizeTagValue(entry);
      return Array.isArray(normalized) ? JSON.stringify(normalized) : normalized;
    });
  }
  // Unexpected shape (nested object) — stringify rather than drop, so
  // headers_json still records that something was there.
  return JSON.stringify(value);
}

function normalizeTags(raw: unknown): Record<string, RawValue | RawValue[]> {
  if (!isPlainRecord(raw)) return {};
  const tags: Record<string, RawValue | RawValue[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    tags[key] = normalizeTagValue(value);
  }
  return tags;
}

/**
 * Standard EXIF/TIFF tag numbers (EXIF 2.3 registry), used as a fallback
 * when `exifr` returns a tag under its raw numeric key instead of its
 * translated name. Confirmed necessary against a real Canon CR3
 * (2026-07-21): each `CMT*` block is parsed independently as its own
 * top-level TIFF (see `extractCr3TiffBlocks`), so `exifr` reads the block
 * that carries the Exif sub-IFD tags as if that sub-IFD's tag numbers were
 * IFD0 tag numbers — they aren't valid IFD0 tags, so `translateKeys`
 * doesn't recognize them and leaves them as bare numeric keys. The
 * *values* are still correctly typed (RATIONAL→number, ASCII→trimmed
 * string, ...) via `translateValues`; only the name lookup is affected.
 * CR2/NEF/ARW (plain TIFF, parsed as one coherent file) don't hit this —
 * `exifr` resolves their Exif sub-IFD normally and these fallbacks are
 * simply unused.
 */
const EXIF_TAG = {
  ExposureTime: 33434,
  ISOSpeedRatings: 34855,
  DateTimeOriginal: 36867,
  OffsetTimeOriginal: 36881,
} as const;

function str(tags: Record<string, unknown>, key: string, fallbackTag?: number): string | null {
  const value = tags[key];
  if (typeof value === 'string') return value;
  if (fallbackTag === undefined) return null;
  const fallback = tags[String(fallbackTag)];
  return typeof fallback === 'string' ? fallback : null;
}

function num(tags: Record<string, unknown>, key: string, fallbackTag?: number): number | null {
  const value = tags[key];
  if (typeof value === 'number') return value;
  if (fallbackTag === undefined) return null;
  const fallback = tags[String(fallbackTag)];
  return typeof fallback === 'number' ? fallback : null;
}

function toKeywords(tags: Record<string, unknown>): RawKeywords {
  return {
    OBJECT: null,
    FILTER: null,
    Make: str(tags, 'Make'),
    Model: str(tags, 'Model'),
    ExposureTime: num(tags, 'ExposureTime', EXIF_TAG.ExposureTime),
    ISO: num(tags, 'ISO', EXIF_TAG.ISOSpeedRatings),
    DateTimeOriginal: str(tags, 'DateTimeOriginal', EXIF_TAG.DateTimeOriginal),
    OffsetTimeOriginal: str(tags, 'OffsetTimeOriginal', EXIF_TAG.OffsetTimeOriginal),
  };
}

function okResult(tags: Record<string, unknown>): RawParseResult {
  const header: RawHeader = { keywords: toKeywords(tags), tags: normalizeTags(tags) };
  return { status: 'ok', header };
}

function errorResult(code: RawErrorCode, message: string): RawParseResult {
  return { status: 'error', error: { code, message } };
}

/**
 * Classify an `exifr` exception into a {@link RawErrorCode}. `exifr` throws
 * a `RangeError` specifically when it tries to read a declared-length
 * structure (an IFD entry table, a value offset, ...) that runs past the
 * end of the supplied bytes — i.e. the input is truncated relative to what
 * its own header declares. Anything else (unrecognized signature, garbage
 * bytes, an unsupported container) is `UNRECOGNIZED_RAW`.
 */
function classifyError(err: unknown): RawParseResult {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof RangeError) return errorResult('TRUNCATED_HEADER', message);
  return errorResult('UNRECOGNIZED_RAW', message);
}

/**
 * Parse RAW/TIFF EXIF metadata from a complete in-memory buffer. Accepts
 * CR2, CR3, NEF, ARW, and plain TIFF — all TIFF-structured (CR3 via the
 * `CTBO` block extraction above); `exifr` distinguishes them by magic bytes,
 * never by file extension, so this function does too.
 */
export async function parseRawHeader(bytes: Uint8Array): Promise<RawParseResult> {
  if (bytes.length === 0) return errorResult('EMPTY_FILE', 'file contains no bytes');

  try {
    if (looksLikeCr3(bytes)) {
      const blocks = extractCr3TiffBlocks(bytes);
      if (blocks.length > 0) {
        let merged: Record<string, unknown> = {};
        let anyParsed = false;
        for (const block of blocks) {
          const parsed = await exifrParse(block);
          if (isPlainRecord(parsed)) {
            merged = { ...merged, ...parsed };
            anyParsed = true;
          }
        }
        if (anyParsed) return okResult(merged);
        // Every extracted block failed to parse: fall through to the
        // whole-buffer attempt below, which will itself throw and get
        // classified — never silently succeed with an empty result.
      }
    }

    const parsed = await exifrParse(bytes);
    if (parsed === undefined || parsed === null) {
      // A structurally valid file `exifr` found no requested tags in —
      // distinct from a malformed one; report an empty-but-ok result
      // rather than manufacturing an error.
      return okResult({});
    }
    return okResult(isPlainRecord(parsed) ? parsed : {});
  } catch (err) {
    return classifyError(err);
  }
}
