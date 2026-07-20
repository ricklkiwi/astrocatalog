/** Header-only XISF parser (P1-02, DD-004) — public surface. */
export {
  MAX_XML_BYTES,
  PROLOGUE_BYTES,
  SIGNATURE,
  parseXisfHeader,
  parseXisfHeaderFromBuffer,
} from './parse.js';
export { toFrameMetadata } from './metadata.js';
export type {
  XisfErrorCode,
  XisfHeader,
  XisfParseError,
  XisfParseResult,
  XisfProperty,
  XisfReader,
} from './types.js';
