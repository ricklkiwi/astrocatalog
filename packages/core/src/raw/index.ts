/** RAW/EXIF metadata adapter (P1-03, DD-004) — public surface. */
export { extractCr3TiffBlocks, looksLikeCr3, parseRawHeader } from './parse.js';
export { cameraInstrument, normalizeDateObs, toFrameMetadata } from './metadata.js';
export type {
  RawErrorCode,
  RawHeader,
  RawKeywords,
  RawParseError,
  RawParseResult,
  RawValue,
} from './types.js';
