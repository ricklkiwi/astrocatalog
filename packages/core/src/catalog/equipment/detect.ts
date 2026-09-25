/**
 * `detectEquipmentProfiles()` — P1-18, DD-003 `equipment_profiles`. Pure
 * function: collapses a batch of frames' raw telescope/camera/focal-length
 * triples into one candidate profile per distinct `equipmentIdentity()`
 * (DD-002 rule 1, no fs/Electron/DB).
 */
import { defaultProfileName, equipmentIdentity } from './identity.js';
import type { DetectedProfile, EquipmentIdentity, EquipmentIdentityInput } from './types.js';

/**
 * Group a batch of frames' raw triples into distinct equipment identities.
 * Rows whose `equipmentIdentity()` is `null` (both telescope and camera
 * absent — focal length alone never identifies a rig) contribute no
 * profile. The output is one `DetectedProfile` per distinct `matchKey`,
 * carrying the *normalized* identity components (never a copy of whichever
 * input row happened to be seen first — DET-3) and the count of input rows
 * that carried it.
 *
 * Deterministic and order-independent: the result is sorted by `matchKey`
 * ascending, so re-running detection over a shuffled/rescanned batch never
 * changes the output ordering (DET-2).
 */
export function detectEquipmentProfiles(inputs: EquipmentIdentityInput[]): DetectedProfile[] {
  const byKey = new Map<string, { identity: EquipmentIdentity; frameCount: number }>();

  for (const row of inputs) {
    const identity = equipmentIdentity(row);
    if (identity === null) continue;

    const existing = byKey.get(identity.matchKey);
    if (existing === undefined) {
      byKey.set(identity.matchKey, { identity, frameCount: 1 });
    } else {
      existing.frameCount += 1;
    }
  }

  return [...byKey.values()]
    .map(({ identity, frameCount }) => ({
      matchKey: identity.matchKey,
      telescope: identity.telescope,
      camera: identity.camera,
      focalLengthMm: identity.focalLengthMm,
      name: defaultProfileName(identity),
      frameCount,
    }))
    .sort((a, b) => (a.matchKey < b.matchKey ? -1 : a.matchKey > b.matchKey ? 1 : 0));
}
