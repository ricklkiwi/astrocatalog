/**
 * Pure minimal TIFF/EXIF builder for CR2/NEF/ARW fixtures, plus a minimal
 * ISO-BMFF box writer for CR3 (P0-06).
 *
 * CR2/NEF/ARW are TIFF-based RAW containers; a header-only fixture needs only
 * a valid TIFF structure with IFD0 (Make/Model) and an EXIF sub-IFD
 * (ExposureTime, ISOSpeedRatings, DateTimeOriginal, optionally
 * OffsetTimeOriginal) — tag numbers and layout per the TIFF 6.0 / Exif tag
 * registry (https://exiftool.org/TagNames/EXIF.html). No sensor data is
 * written.
 *
 * CR3 is Canon's ISO-BMFF (MP4-family) container. This module writes a
 * best-effort minimal structure (ftyp + moov + a Canon-style uuid metadata
 * box + appended CMT1/CMT2 TIFF/EXIF blocks) documented in the community
 * reverse-engineering write-up at https://github.com/lclevy/canon_cr3. Exact
 * byte-for-byte fidelity to a real Canon CR3 is not guaranteed; see the CR3
 * fixture's manifest notes for exifr parseability.
 *
 * Pure module: Uint8Array in/out, no fs, no Electron (DD-002 layering).
 */

export type TiffType = 'BYTE' | 'ASCII' | 'SHORT' | 'LONG' | 'RATIONAL' | 'SRATIONAL';

export type TiffValue =
  | string // ASCII
  | number // BYTE/SHORT/LONG single value
  | number[] // BYTE/SHORT/LONG array
  | readonly [number, number] // RATIONAL/SRATIONAL single pair
  | ReadonlyArray<readonly [number, number]>; // RATIONAL/SRATIONAL array

export interface TiffEntry {
  tag: number;
  type: TiffType;
  value: TiffValue;
}

function concat(...chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function u16le(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function i32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setInt32(0, n, true);
  return b;
}

function asciiBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length + 1); // NUL-terminated
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

function asPairs(value: TiffValue): ReadonlyArray<readonly [number, number]> {
  if (Array.isArray(value) && value.length > 0 && Array.isArray(value[0])) {
    return value as unknown as ReadonlyArray<readonly [number, number]>;
  }
  return [value as unknown as readonly [number, number]];
}

function asNumberArray(value: TiffValue): number[] {
  return Array.isArray(value) ? (value as number[]) : [value as number];
}

/** Raw value bytes + element count for one entry, per its declared type. */
function encodeEntryValue(entry: TiffEntry): { bytes: Uint8Array; count: number } {
  switch (entry.type) {
    case 'ASCII': {
      const bytes = asciiBytes(entry.value as string);
      return { bytes, count: bytes.length };
    }
    case 'BYTE': {
      const nums = asNumberArray(entry.value);
      return { bytes: Uint8Array.from(nums), count: nums.length };
    }
    case 'SHORT': {
      const nums = asNumberArray(entry.value);
      return { bytes: concat(...nums.map(u16le)), count: nums.length };
    }
    case 'LONG': {
      const nums = asNumberArray(entry.value);
      return { bytes: concat(...nums.map(u32le)), count: nums.length };
    }
    case 'RATIONAL': {
      const pairs = asPairs(entry.value);
      return {
        bytes: concat(...pairs.flatMap(([n, d]) => [u32le(n), u32le(d)])),
        count: pairs.length,
      };
    }
    case 'SRATIONAL': {
      const pairs = asPairs(entry.value);
      return {
        bytes: concat(...pairs.flatMap(([n, d]) => [i32le(n), i32le(d)])),
        count: pairs.length,
      };
    }
  }
}

const TYPE_CODE: Record<TiffType, number> = {
  BYTE: 1,
  ASCII: 2,
  SHORT: 3,
  LONG: 4,
  RATIONAL: 5,
  SRATIONAL: 10,
};

/**
 * Lay out one IFD (entries sorted by tag ascending, per TIFF 6.0) starting at
 * byte offset `ifdStart` in the final file, with out-of-line data placed
 * immediately after the IFD's fixed part. Returns the full bytes for this
 * IFD (fixed part + its out-of-line data + a 4-byte next-IFD-offset of 0)
 * and the file-absolute offset of each entry's data blob (only set for
 * entries that were written out-of-line — used to patch pointer tags like
 * ExifIFDPointer from the caller).
 */
export function layoutIfd(
  entries: readonly TiffEntry[],
  ifdStart: number,
): { bytes: Uint8Array; length: number; dataOffsetOf: Map<number, number> } {
  const sorted = [...entries].sort((a, b) => a.tag - b.tag);
  const fixedSize = 2 + 12 * sorted.length + 4;
  const dataStart = ifdStart + fixedSize;

  const encoded = sorted.map((e) => ({ entry: e, ...encodeEntryValue(e) }));
  const dataOffsetOf = new Map<number, number>();
  let cursor = dataStart;
  const dataChunks: Uint8Array[] = [];
  for (const e of encoded) {
    if (e.bytes.length > 4) {
      dataOffsetOf.set(e.entry.tag, cursor);
      dataChunks.push(e.bytes);
      cursor += e.bytes.length;
    }
  }

  const entryChunks: Uint8Array[] = [];
  for (const e of encoded) {
    const valueField = new Uint8Array(4);
    if (e.bytes.length <= 4) {
      valueField.set(e.bytes, 0);
    } else {
      valueField.set(u32le(dataOffsetOf.get(e.entry.tag) ?? 0), 0);
    }
    entryChunks.push(
      concat(u16le(e.entry.tag), u16le(TYPE_CODE[e.entry.type]), u32le(e.count), valueField),
    );
  }

  const bytes = concat(
    u16le(sorted.length),
    ...entryChunks,
    u32le(0), // next IFD offset (none)
    ...dataChunks,
  );
  return { bytes, length: bytes.length, dataOffsetOf };
}

export interface BuildTiffOptions {
  ifd0: TiffEntry[];
  exifIfd: TiffEntry[];
}

/** ExifIFDPointer tag (0x8769) — value patched once the EXIF IFD's offset is known. */
export const EXIF_IFD_POINTER_TAG = 0x8769;

/** Build a minimal little-endian TIFF file: header + IFD0 (+ExifIFDPointer) + EXIF IFD. */
export function buildTiff(opts: BuildTiffOptions): Uint8Array {
  const HEADER_SIZE = 8;
  const ifd0Entries: TiffEntry[] = [
    ...opts.ifd0,
    { tag: EXIF_IFD_POINTER_TAG, type: 'LONG', value: 0 }, // placeholder, patched below
  ];
  const ifd0 = layoutIfd(ifd0Entries, HEADER_SIZE);
  const exifIfdStart = HEADER_SIZE + ifd0.length;
  const exif = layoutIfd(opts.exifIfd, exifIfdStart);

  // Patch the ExifIFDPointer's inline value field now that exifIfdStart is known.
  // Its entry is inline (LONG, count 1) — 12-byte slot at a fixed position within ifd0.bytes.
  const sortedIfd0 = [...ifd0Entries].sort((a, b) => a.tag - b.tag);
  const idx = sortedIfd0.findIndex((e) => e.tag === EXIF_IFD_POINTER_TAG);
  const entryOffset = 2 + 12 * idx + 8; // count(2) + preceding entries + tag/type/count(8)
  const patched = ifd0.bytes.slice();
  patched.set(u32le(exifIfdStart), entryOffset);

  const header = concat(new Uint8Array([0x49, 0x49]), u16le(42), u32le(HEADER_SIZE));
  return concat(header, patched, exif.bytes);
}

/** Truncate a well-formed TIFF header for the truncated-TIFF malformed fixture. */
export function truncate(bytes: Uint8Array, length: number): Uint8Array {
  return bytes.slice(0, length);
}

// --- Minimal ISO-BMFF box writer (CR3) --------------------------------------

function box(fourcc: string, ...payload: readonly Uint8Array[]): Uint8Array {
  const body = concat(...payload);
  const size = 8 + body.length;
  const fourccBytes = Uint8Array.from(fourcc, (c) => c.charCodeAt(0));
  return concat(u32beManual(size), fourccBytes, body);
}

function u32beManual(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, false);
  return b;
}

/** 16-byte UUID from its canonical hex-dashed string form. */
function uuidBytes(uuid: string): Uint8Array {
  const hex = uuid.replaceAll('-', '');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Canon's documented CR3 metadata uuid (per lclevy/canon_cr3). */
export const CANON_CR3_UUID = '85c0b687-820f-11e0-8111-f4ce462b6a48';

export interface BuildCr3Options {
  /** Full main-image TIFF/EXIF blob (CMT1: IFD0 + EXIF), reused from buildTiff. */
  cmt1: Uint8Array;
  /** EXIF-only TIFF blob (CMT2), reused from buildTiff. */
  cmt2: Uint8Array;
}

/**
 * Best-effort minimal CR3: ftyp + moov (uuid metadata box referencing CMT1/
 * CMT2 by absolute file offset via a CTBO-style table) + the CMT1/CMT2 blocks
 * appended after moov. Structure follows the community write-up at
 * https://github.com/lclevy/canon_cr3 but is not asserted to be byte-exact to
 * a camera-produced file — see the fixture manifest for exifr parseability.
 */
export function buildCr3({ cmt1, cmt2 }: BuildCr3Options): Uint8Array {
  const ftyp = box(
    'ftyp',
    Uint8Array.from('crx ', (c) => c.charCodeAt(0)),
    u32beManual(0),
    Uint8Array.from('crx isom', (c) => c.charCodeAt(0)),
  );

  const cncv = box(
    'CNCV',
    Uint8Array.from('CanonCRM-1000000/00.09.00/00.00.00', (c) => c.charCodeAt(0)),
  );

  // CTBO: version/flags(4) + entryCount(4) + entries of {index(4) offset(8) length(8)}.
  // Offsets are patched below once we know the final layout.
  const ctboEntryCount = 2;
  const ctboBody = (offsets: [number, number][]): Uint8Array =>
    concat(
      u32beManual(0), // version/flags
      u32beManual(ctboEntryCount),
      ...offsets.flatMap(([offset, length], i) => [
        u32beManual(i + 1),
        u64beManual(offset),
        u64beManual(length),
      ]),
    );

  // First pass with placeholder offsets to compute sizes.
  const placeholderCtbo = box(
    'CTBO',
    ctboBody([
      [0, cmt1.length],
      [0, cmt2.length],
    ]),
  );
  const cctp = box('CCTP', u32beManual(0), u32beManual(0), placeholderCtbo);
  const uuidMeta = box('uuid', uuidBytes(CANON_CR3_UUID), cncv, cctp);
  const moov = box('moov', uuidMeta);

  const cmt1Offset = ftyp.length + moov.length;
  const cmt2Offset = cmt1Offset + cmt1.length;

  // Second pass with the real absolute offsets.
  const finalCtbo = box(
    'CTBO',
    ctboBody([
      [cmt1Offset, cmt1.length],
      [cmt2Offset, cmt2.length],
    ]),
  );
  const finalCctp = box('CCTP', u32beManual(0), u32beManual(0), finalCtbo);
  const finalUuidMeta = box('uuid', uuidBytes(CANON_CR3_UUID), cncv, finalCctp);
  const finalMoov = box('moov', finalUuidMeta);

  return concat(ftyp, finalMoov, cmt1, cmt2);
}

function u64beManual(n: number): Uint8Array {
  const b = new Uint8Array(8);
  const view = new DataView(b.buffer);
  // n is always small (well within Number.MAX_SAFE_INTEGER) for fixture sizes.
  view.setUint32(4, n >>> 0, false);
  view.setUint32(0, Math.floor(n / 2 ** 32), false);
  return b;
}
