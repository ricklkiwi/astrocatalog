/**
 * The capture-software profile registry (P1-05). This is the ONLY file a
 * new profile's registration touches, and only ever by import + array
 * append (data, not a conditional). `detect.ts` and `apply.ts` — the
 * dispatch logic — never change when a profile is added.
 */
import { ninaProfile } from './profiles/nina.js';
import { sgproProfile } from './profiles/sgpro.js';
import type { CaptureProfile } from './types.js';

export const ALL_PROFILES: readonly CaptureProfile[] = [ninaProfile, sgproProfile];
