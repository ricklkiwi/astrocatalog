/**
 * Capture-software detection dispatch (P1-05). Contains no per-software
 * branching or program-name string literals — see `detect.test.ts`'s
 * automated source-scan test. A new profile is registered entirely in
 * `registry.ts`; this file never changes as profiles are added.
 */
import { ALL_PROFILES } from './registry.js';
import type { CaptureProfile } from './types.js';
import type { FrameMetadata } from '../fits/metadata.js';

/** First registry entry (declaration order) whose predicate matches, or `null`. Never guesses. */
export function detectProfile(metadata: FrameMetadata): CaptureProfile | null {
  for (const profile of ALL_PROFILES) {
    if (profile.detect(metadata.headers)) return profile;
  }
  return null;
}
