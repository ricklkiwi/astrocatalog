/**
 * Equipment-profile domain (P1-18, DD-003 `equipment_profiles`, DD-006
 * equipment split rule). Pure functions only (DD-002 rule 1).
 */
export { equipmentIdentity, defaultProfileName } from './identity.js';
export { detectEquipmentProfiles } from './detect.js';
export { suggestProfileMerges } from './suggest.js';
export type {
  DetectedProfile,
  EquipmentIdentity,
  EquipmentIdentityInput,
  EquipmentProfileForSuggestion,
  MergeSuggestion,
  MergeSuggestionReason,
  SuggestProfileMergesConfig,
} from './types.js';
