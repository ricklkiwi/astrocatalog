/**
 * DD-004 Stage 2 + Stage 3 as one pure, worker-callable step (P1-07):
 * dispatch a discovered file to the right header parser by extension, map the
 * parse to the shared {@link FrameMetadata}, apply the capture-software
 * profile, then classify the frame type — returning either a fully-parsed
 * frame or a structured parse error. Never throws on file content (DD-004
 * error isolation): every underlying parser already returns a discriminated
 * result, and this module only forwards those.
 *
 * Pure by construction (DD-002 rule 1): no fs, no Electron. All I/O stays in
 * the caller's {@link BoundedReader} callback, exactly like the FITS/XISF
 * parsers this wraps — the desktop scan worker backs that reader with a real
 * file descriptor, but this module never sees one, so it's unit-testable
 * against an in-memory buffer.
 *
 * Pipeline order is fixed (see the capture-profiles doc comment): parse →
 * toFrameMetadata → applyCaptureProfile → classifyFrame. The profile runs
 * *before* classification because it can fix up `imageType` (and other
 * fields) that classification then reads.
 */
import { applyCaptureProfile } from '../capture-profiles/index.js';
import { classifyFrame } from '../classification/index.js';
import {
  parseFitsHeader,
  toFrameMetadata as fitsToFrameMetadata,
  type FrameMetadata,
} from '../fits/index.js';
import { parseRawHeader, toFrameMetadata as rawToFrameMetadata } from '../raw/index.js';
import { parseXisfHeader, toFrameMetadata as xisfToFrameMetadata } from '../xisf/index.js';
import { FITS_EXTENSIONS, RAW_EXTENSIONS, XISF_EXTENSIONS } from './supported-extensions.js';
import type { ClassificationResult } from '../classification/index.js';

/** Which of the three P1-01…P1-03 header parsers owns a given extension. */
export type FileFormat = 'fits' | 'xisf' | 'raw';

/**
 * Bounded random-access read callback (same shape as {@link FitsReader} /
 * {@link XisfReader}): returns up to `length` bytes at `offset`, fewer (or
 * none) at EOF. FITS/XISF drive it on demand a header region at a time; for
 * RAW this module reads a single bounded prefix through it (see
 * {@link RAW_HEADER_PREFIX_BYTES}).
 */
export type BoundedReader = (offset: number, length: number) => Uint8Array | Promise<Uint8Array>;

/**
 * How many leading bytes of a RAW file to hand to `exifr`. The RAW parser
 * (P1-03) has no bounded-reader API — it consumes a whole in-memory buffer —
 * so, to honor DD-004's "header-only reads, never the pixel payload" rule
 * (real RAW files run 30–80 MB), the caller reads only this prefix.
 *
 * 1 MiB is chosen to comfortably contain the metadata region of every
 * supported RAW container: CR2/NEF/ARW are TIFF-structured with EXIF/maker-
 * note IFDs near the start, and Canon's CR3 keeps its `moov/uuid/CMT*`
 * metadata boxes ahead of the multi-MB `mdat` pixel payload — all well within
 * 1 MiB in practice, while still reading ~30–80× less than the whole file.
 * If `exifr` needs a tag whose offset falls past the prefix it reports a
 * TRUNCATED_HEADER error rather than crashing; the eventual 10k-file
 * benchmark workstream can lower this once tuned against a real large-file
 * corpus (the committed fixtures are all a few KB, so any prefix reads them
 * whole).
 */
export const RAW_HEADER_PREFIX_BYTES = 1024 * 1024;

/** A successfully parsed + classified frame (DD-004 Stages 2–3 output). */
export interface ParsedFrame {
  frameType: ClassificationResult['frameType'];
  frameTypeSource: ClassificationResult['frameTypeSource'];
  /**
   * Normalized metadata (post-capture-profile). `metadata.headers` is the raw
   * keyword dict destined for `frames.headers_json`; the normalized scalar
   * fields map onto the `frames` columns.
   */
  metadata: FrameMetadata;
}

export type ParseFileResult =
  { status: 'ok'; frame: ParsedFrame } | { status: 'error'; errorCode: string; message: string };

const FITS_SET = new Set<string>(FITS_EXTENSIONS);
const XISF_SET = new Set<string>(XISF_EXTENSIONS);
const RAW_SET = new Set<string>(RAW_EXTENSIONS);

/**
 * Map a discovered file's extension (lowercase, no leading dot) to the format
 * whose parser handles it, or `null` when no parser claims it. Pure data
 * routing, kept beside the parsers so the desktop worker never hard-codes the
 * extension→parser table.
 */
export function formatForExtension(extension: string): FileFormat | null {
  const ext = extension.toLowerCase();
  if (FITS_SET.has(ext)) return 'fits';
  if (XISF_SET.has(ext)) return 'xisf';
  if (RAW_SET.has(ext)) return 'raw';
  return null;
}

/** Stage-3 tail shared by all three formats: profile fix-ups, then classify. */
function classifyMetadata(metadata: FrameMetadata, filePath: string): ParseFileResult {
  const profiled = applyCaptureProfile(metadata);
  const classification = classifyFrame(profiled, filePath);
  return {
    status: 'ok',
    frame: {
      frameType: classification.frameType,
      frameTypeSource: classification.frameTypeSource,
      metadata: profiled,
    },
  };
}

/**
 * Parse + classify one discovered file. `filePath` is used only by Stage-3
 * path heuristics (pass the watch-folder-relative POSIX path so classification
 * is portable and stable across machines). Returns a structured error — never
 * throws — for malformed input, an unsupported extension, or a truncated
 * prefix.
 */
export async function parseAndClassifyFile(
  extension: string,
  read: BoundedReader,
  filePath: string,
): Promise<ParseFileResult> {
  const format = formatForExtension(extension);
  if (format === null) {
    return {
      status: 'error',
      errorCode: 'UNSUPPORTED_EXTENSION',
      message: `no header parser is registered for extension ".${extension}"`,
    };
  }

  if (format === 'fits') {
    const result = await parseFitsHeader(read);
    if (result.status === 'error') {
      return { status: 'error', errorCode: result.error.code, message: result.error.message };
    }
    return classifyMetadata(fitsToFrameMetadata(result.header), filePath);
  }

  if (format === 'xisf') {
    const result = await parseXisfHeader(read);
    if (result.status === 'error') {
      return { status: 'error', errorCode: result.error.code, message: result.error.message };
    }
    return classifyMetadata(xisfToFrameMetadata(result.header), filePath);
  }

  // RAW: no bounded-reader API — read a single bounded prefix and parse it.
  const prefix = await read(0, RAW_HEADER_PREFIX_BYTES);
  const result = await parseRawHeader(prefix);
  if (result.status === 'error') {
    return { status: 'error', errorCode: result.error.code, message: result.error.message };
  }
  return classifyMetadata(rawToFrameMetadata(result.header), filePath);
}
