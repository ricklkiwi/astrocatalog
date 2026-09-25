/**
 * Equipment-profile domain types (P1-18, DD-003 `equipment_profiles`, DD-006
 * equipment split rule). Pure data shapes only — no behavior lives here
 * (DD-002 rule 1).
 */

/** Raw header triple `equipmentIdentity()` normalizes into an identity. */
export interface EquipmentIdentityInput {
  /** `frames.telescope_raw` verbatim (may carry the PixInsight XISF wrapping-quote quirk). */
  telescopeRaw: string | null;
  /** `frames.camera_raw` verbatim. */
  cameraRaw: string | null;
  /** `frames.focal_length` verbatim, unrounded. */
  focalLength: number | null;
}

/**
 * A frame's deterministic equipment identity: normalized telescope/camera
 * strings, focal length rounded to the nearest whole mm, and an unambiguous
 * serialization of the three (`matchKey`) suitable as a stable grouping/
 * lookup key. `null` when the frame carries no identifying string at all
 * (focal length alone never identifies a rig).
 */
export interface EquipmentIdentity {
  telescope: string | null;
  camera: string | null;
  focalLengthMm: number | null;
  matchKey: string;
}

/** One distinct identity `detectEquipmentProfiles()` found in a batch of frames. */
export interface DetectedProfile {
  matchKey: string;
  telescope: string | null;
  camera: string | null;
  focalLengthMm: number | null;
  /** `defaultProfileName()` of the normalized components. */
  name: string;
  /** Count of input rows that carried this identity. */
  frameCount: number;
}

/**
 * A live equipment profile as `suggestProfileMerges()` needs it: the
 * normalized identity components a repository already resolved (or read
 * straight from `equipment_profiles`, which stores them normalized), plus
 * the confirmation flag and light-frame usage the survivor ranking depends
 * on (DD-006 "visible reasons": usage breaks a tie between two unconfirmed
 * candidates).
 */
export interface EquipmentProfileForSuggestion {
  id: string;
  telescope: string | null;
  camera: string | null;
  focalLengthMm: number | null;
  isUserConfirmed: boolean;
  /** Σ `exposure_seconds` over this profile's light frames (usage-hours basis). */
  lightUsageSeconds: number;
}

/** Visible reason code for a merge suggestion (DD-006 "visible reasons"). */
export type MergeSuggestionReason = 'canonical_name_match';

/** One proposed (never applied) consolidation of near-identical profiles. */
export interface MergeSuggestion {
  /** Every profile id in the suggested group, sorted ascending. */
  profileIds: string[];
  recommendedSurvivorId: string;
  reason: MergeSuggestionReason;
}

export interface SuggestProfileMergesConfig {
  /**
   * Relative focal-length tolerance for clustering within a canonical
   * group, measured against the smaller of two adjacent sorted values
   * (DD-006 default 2%, "configurable").
   */
  focalTolerance?: number;
}
