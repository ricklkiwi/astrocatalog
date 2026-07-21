/**
 * Capture-software profile application (P1-05). Contains no per-software
 * branching or program-name string literals — see `detect.test.ts`'s
 * automated source-scan test. A new profile's fixups are folded generically;
 * this file never changes as profiles are added.
 */
import { detectProfile } from './detect.js';
import type { FrameMetadata } from '../fits/metadata.js';

/** Detect + apply in one call — what Stage 2 (DD-004) actually calls per frame. */
export function applyCaptureProfile(metadata: FrameMetadata): FrameMetadata {
  const profile = detectProfile(metadata);
  if (profile === null) return metadata;
  let patch: Partial<FrameMetadata> = {};
  for (const fixup of profile.fixups) {
    // Every fixup reads the ORIGINAL metadata, not the accumulating patch —
    // fixups stay order-independent and individually testable; only the
    // final merge (last-fixup-wins on a literal field collision) cares about
    // array order, and no shipped profile has colliding fixups.
    patch = { ...patch, ...fixup(metadata.headers, metadata) };
  }
  return { ...metadata, ...patch };
}
