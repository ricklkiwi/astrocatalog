/**
 * Public surface of `@astrotracker/core` — pure domain logic only
 * (DD-002 rule 1: no Electron, no fs side effects).
 */
export { isUuid, uuidv7 } from './ids/uuidv7.js';
export {
  BLOCK_BYTES,
  CARD_BYTES,
  CARDS_PER_BLOCK,
  MAX_HEADER_BLOCKS,
  parseFitsHeader,
  parseFitsHeaderFromBuffer,
  parseSexagesimal,
  toFrameMetadata,
  type FitsCard,
  type FitsErrorCode,
  type FitsHeader,
  type FitsParseError,
  type FitsParseResult,
  type FitsReader,
  type FitsValue,
  type FrameMetadata,
} from './fits/index.js';
export {
  MAX_XML_BYTES,
  PROLOGUE_BYTES as XISF_PROLOGUE_BYTES,
  SIGNATURE as XISF_SIGNATURE,
  parseXisfHeader,
  parseXisfHeaderFromBuffer,
  toFrameMetadata as xisfToFrameMetadata,
  type XisfErrorCode,
  type XisfHeader,
  type XisfParseError,
  type XisfParseResult,
  type XisfProperty,
  type XisfReader,
} from './xisf/index.js';
export {
  cameraInstrument,
  extractCr3TiffBlocks,
  looksLikeCr3,
  normalizeDateObs,
  parseRawHeader,
  toFrameMetadata as rawToFrameMetadata,
  type RawErrorCode,
  type RawHeader,
  type RawKeywords,
  type RawParseError,
  type RawParseResult,
  type RawValue,
} from './raw/index.js';
export {
  detectProfile,
  applyCaptureProfile,
  ALL_PROFILES,
  type CaptureProfile,
  type CaptureProfileFixup,
} from './capture-profiles/index.js';
export {
  classifyFrame,
  type ClassificationResult,
  type FrameType,
  type FrameTypeSource,
} from './classification/index.js';
export {
  FITS_EXTENSIONS,
  XISF_EXTENSIONS,
  RAW_EXTENSIONS,
  SUPPORTED_EXTENSIONS,
  SUPPORTED_EXTENSION_SET,
  isSupportedExtension,
} from './scanning/supported-extensions.js';
export {
  RAW_HEADER_PREFIX_BYTES,
  formatForExtension,
  parseAndClassifyFile,
  type BoundedReader,
  type FileFormat,
  type ParseFileResult,
  type ParsedFrame,
} from './scanning/parse-file.js';

export const coreVersion = '0.1.0';

/** Returns a human-readable identifier for this package. */
export function describeCore(): string {
  return `core@${coreVersion}`;
}
