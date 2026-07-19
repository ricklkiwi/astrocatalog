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

export const coreVersion = '0.1.0';

/** Returns a human-readable identifier for this package. */
export function describeCore(): string {
  return `core@${coreVersion}`;
}
