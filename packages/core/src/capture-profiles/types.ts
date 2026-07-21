/**
 * Capture-software profile registry types (P1-05, DD-004 "Header parsing
 * specifics"): a data-driven table of per-program detection fingerprints and
 * corrective fixups, operating on the shared {@link FrameMetadata} shape so
 * one registry works uniformly across FITS, XISF, and RAW output.
 */

import type { FrameMetadata } from '../fits/metadata.js';
import type { FitsValue } from '../fits/types.js';

/**
 * One corrective rule. Reads the frame's raw preserved headers (and, when a
 * fixup needs to avoid clobbering a value another mapping already supplied,
 * the current normalized metadata) and returns only the fields it changes.
 * `{}` means "not applicable to this frame" — fixups are safe to run
 * unconditionally against every frame the profile matches.
 */
export type CaptureProfileFixup = (
  headers: Record<string, FitsValue>,
  metadata: FrameMetadata,
) => Partial<FrameMetadata>;

export interface CaptureProfile {
  /** Stable machine id (e.g. 'sgpro'). Never persisted — DD-003 has no column for it; used for logging/debugging and test identification only. */
  id: string;
  /** Human-readable name for logs/debugging. */
  displayName: string;
  /** Pure, side-effect-free predicate over the frame's raw preserved headers. */
  detect: (headers: Record<string, FitsValue>) => boolean;
  /** Self-contained corrective rules, applied in array order against the ORIGINAL metadata (not each other's output — see apply.ts); later entries win on field conflicts. `[]` is valid: a profile that only identifies software with no known quirks to fix (four of the six profiles in this plan). */
  fixups: CaptureProfileFixup[];
}
