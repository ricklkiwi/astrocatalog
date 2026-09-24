import { describe, expect, it } from 'vitest';

import {
  coreVersion,
  defaultProfileName,
  describeCore,
  detectEquipmentProfiles,
  equipmentIdentity,
  suggestProfileMerges,
  type DetectedProfile,
  type EquipmentIdentity,
  type EquipmentIdentityInput,
  type EquipmentProfileForSuggestion,
  type MergeSuggestion,
  type MergeSuggestionReason,
  type SuggestProfileMergesConfig,
} from './index.js';

describe('core placeholder', () => {
  it('exposes the pure-domain package version via describeCore()', () => {
    expect(describeCore()).toBe(`core@${coreVersion}`);
  });
});

// API-1: the equipment-profile public surface is reachable from the
// package root (no deep `catalog/equipment/*` import path).
describe('equipment-profile public surface (API-1)', () => {
  it('exposes equipmentIdentity, defaultProfileName, detectEquipmentProfiles, suggestProfileMerges', () => {
    expect(typeof equipmentIdentity).toBe('function');
    expect(typeof defaultProfileName).toBe('function');
    expect(typeof detectEquipmentProfiles).toBe('function');
    expect(typeof suggestProfileMerges).toBe('function');

    const identity = equipmentIdentity({
      telescopeRaw: 'Gme28',
      cameraRaw: 'ZWO ASI533MC Pro',
      focalLength: 336,
    });
    expect(identity?.matchKey).toBeDefined();

    const detected = detectEquipmentProfiles([
      { telescopeRaw: 'Gme28', cameraRaw: 'ZWO ASI533MC Pro', focalLength: 336 },
    ]);
    expect(detected).toHaveLength(1);

    const suggestions = suggestProfileMerges([
      {
        id: 'a',
        telescope: 'EdgeHD 8',
        camera: 'ASI2600MM',
        focalLengthMm: 2032,
        isUserConfirmed: false,
        lightUsageSeconds: 0,
      },
      {
        id: 'b',
        telescope: 'EdgeHD8',
        camera: 'ASI2600MM',
        focalLengthMm: 2032,
        isUserConfirmed: false,
        lightUsageSeconds: 0,
      },
    ]);
    expect(suggestions).toHaveLength(1);

    // Type-only reachability check: this line fails to compile (not just
    // fails at runtime) if any of these types stop being exported from the
    // package root.
    const typesReachable: [
      EquipmentIdentity,
      EquipmentIdentityInput,
      DetectedProfile,
      EquipmentProfileForSuggestion,
      MergeSuggestion,
      MergeSuggestionReason,
      SuggestProfileMergesConfig,
    ] = [
      { telescope: null, camera: null, focalLengthMm: null, matchKey: 'k' },
      { telescopeRaw: null, cameraRaw: null, focalLength: null },
      {
        matchKey: 'k',
        telescope: null,
        camera: null,
        focalLengthMm: null,
        name: '',
        frameCount: 0,
      },
      {
        id: 'x',
        telescope: null,
        camera: null,
        focalLengthMm: null,
        isUserConfirmed: false,
        lightUsageSeconds: 0,
      },
      { profileIds: [], recommendedSurvivorId: 'x', reason: 'canonical_name_match' },
      'canonical_name_match',
      {},
    ];
    expect(typesReachable).toHaveLength(7);
  });
});
