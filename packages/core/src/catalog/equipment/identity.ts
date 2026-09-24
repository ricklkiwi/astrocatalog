/**
 * `equipmentIdentity()` / `defaultProfileName()` — P1-18, DD-003
 * `equipment_profiles`. Pure functions: no fs, no Electron, no DB (DD-002
 * rule 1).
 *
 * Q3 (maintainer-resolved, #26): automatic identity handles representation
 * artifacts only — trim, one pair of wrapping quotes, and focal-length
 * rounding. Case and internal whitespace/punctuation drift are
 * suggestion-only (`suggestProfileMerges`), never merged here.
 */
import type { EquipmentIdentity, EquipmentIdentityInput } from './types.js';

/**
 * Normalize a raw telescope/camera string for identity purposes:
 *
 * 1. `null` → `null`.
 * 2. Trim leading/trailing whitespace.
 * 3. Strip exactly one leading and one trailing `'` character, but only
 *    when both are present (the PixInsight XISF quote quirk — same rule as
 *    `normalizeImageType`, ID-1/ID-3/ID-4). A single strip, not a global
 *    one: `"''Gme28''"` → `"'Gme28'"`, not `"Gme28"`.
 * 4. Trim again (handles FITS padding trapped *inside* the quotes, e.g.
 *    `"'QHY268M '"` → `'QHY268M'`, ID-2).
 * 5. Empty after the above → `null` (ID-5).
 *
 * Deliberately no case-folding, no internal-whitespace/punctuation removal
 * (ID-6/ID-7): that drift is real-data noise the user confirms via a merge
 * suggestion, not something identity silently collapses.
 */
function normalizeIdentityString(raw: string | null): string | null {
  if (raw === null) return null;
  let value = raw.trim();
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1);
  }
  value = value.trim();
  return value === '' ? null : value;
}

/**
 * Normalize a raw `FOCALLEN` reading to a whole-mm identity component:
 *
 * 1. Non-finite (`NaN`/`Infinity`/`-Infinity`) → `null` (ID-13).
 * 2. Round to the nearest whole mm (`Math.round` — a half rounds up,
 *    ID-9/ID-10). Applied *before* the sign/zero guard (orchestrator note,
 *    2026-09-23): `0.4` rounds to `0` and is then treated as null, `0.5`
 *    rounds to `1` and survives.
 * 3. `<= 0` after rounding → `null` — "unknown" sentinels and anything that
 *    rounds away to nothing are not a 0 mm profile (ID-12).
 */
function normalizeFocalLength(raw: number | null): number | null {
  if (raw === null || !Number.isFinite(raw)) return null;
  const rounded = Math.round(raw);
  return rounded <= 0 ? null : rounded;
}

/**
 * Turn a frame's raw telescope/camera/focal-length triple into a
 * deterministic equipment identity, or `null` when neither string carries
 * any identifying value (focal length alone never identifies a rig,
 * ID-14). A camera-only frame (dark, bias, DSLR RAW — Q7) still yields an
 * identity when only the camera is known (ID-15).
 *
 * `matchKey` is an unambiguous JSON serialization of the three normalized
 * components, never a delimiter join: `JSON.stringify` escapes embedded
 * quotes/brackets and distinguishes the string `'null'` from the value
 * `null`, so a header string containing the "delimiter" can never collide
 * with a different triple (ID-16) — the failure mode P1-17 already hit once
 * with a hand-rolled sentinel (`6f796e0`).
 */
export function equipmentIdentity(input: EquipmentIdentityInput): EquipmentIdentity | null {
  const telescope = normalizeIdentityString(input.telescopeRaw);
  const camera = normalizeIdentityString(input.cameraRaw);
  const focalLengthMm = normalizeFocalLength(input.focalLength);

  if (telescope === null && camera === null) {
    return null;
  }

  return {
    telescope,
    camera,
    focalLengthMm,
    matchKey: JSON.stringify([telescope, camera, focalLengthMm]),
  };
}

/**
 * A human-readable default name for a detected profile: `"<telescope> +
 * <camera> @ <focal> mm"`, dropping any missing part, collapsing
 * `telescope === camera` to one name (the DWARF-mini-style smart
 * telescope, NAME-4), and leaving out the `@ … mm` suffix entirely when
 * the focal length is null (NAME-2/NAME-3).
 */
export function defaultProfileName(
  identity: Pick<EquipmentIdentity, 'telescope' | 'camera' | 'focalLengthMm'>,
): string {
  const { telescope, camera, focalLengthMm } = identity;
  const parts: string[] = [];
  if (telescope !== null && camera !== null && telescope === camera) {
    parts.push(telescope);
  } else {
    if (telescope !== null) parts.push(telescope);
    if (camera !== null) parts.push(camera);
  }
  const base = parts.join(' + ');
  return focalLengthMm === null ? base : `${base} @ ${focalLengthMm} mm`;
}
