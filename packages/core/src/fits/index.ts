/** Header-only FITS parser (P1-01, DD-004) — public surface. */
export {
  BLOCK_BYTES,
  CARD_BYTES,
  CARDS_PER_BLOCK,
  MAX_HEADER_BLOCKS,
  parseFitsHeader,
  parseFitsHeaderFromBuffer,
} from './parse.js';
export { parseSexagesimal, toFrameMetadata, type FrameMetadata } from './metadata.js';
export type {
  FitsCard,
  FitsErrorCode,
  FitsHeader,
  FitsParseError,
  FitsParseResult,
  FitsReader,
  FitsValue,
} from './types.js';
