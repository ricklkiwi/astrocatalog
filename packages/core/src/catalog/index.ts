/**
 * Catalog domain — session detection (P1-17, DD-006) and, later,
 * calibration matching (P1-20). Pure functions only (DD-002 rule 1).
 */
export type {
  SessionAssignment,
  SessionDetectionConfig,
  SessionInputFrame,
  TimezoneSource,
} from './types.js';
export { astronomicalDayLabel, isValidIana, resolveTimezone } from './timezone.js';
export { splitByGap } from './gap-splitting.js';
export { detectSessions } from './detect-sessions.js';

// --- P1-18 equipment-profile auto-detection (DD-003 `equipment_profiles`,
// DD-006 equipment split rule) -----------------------------------------
// Kept as its own re-export block (rather than merged into the block
// above) so a concurrent branch adding calibration-matching exports here
// can land without a merge conflict.
export {
  equipmentIdentity,
  defaultProfileName,
  detectEquipmentProfiles,
  suggestProfileMerges,
  type DetectedProfile,
  type EquipmentIdentity,
  type EquipmentIdentityInput,
  type EquipmentProfileForSuggestion,
  type MergeSuggestion,
  type MergeSuggestionReason,
  type SuggestProfileMergesConfig,
} from './equipment/index.js';
