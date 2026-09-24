/**
 * `suggestProfileMerges()` — P1-18, DD-006 "visible reasons". Pure function:
 * proposes, never applies, consolidations of near-identical equipment
 * profiles (DD-002 rule 1, no fs/Electron/DB).
 *
 * Q4 (maintainer-resolved, #26): canonical-form equality only (case-folded,
 * non-alphanumerics removed) plus a relative focal-length tolerance. No
 * edit distance and no vendor-prefix table — both would pair strings that
 * are genuinely different equipment (`ASI2600MC`/`ASI2600MM`,
 * `ASI294MC`/`ASI294MC Pro`) and are deferred to the v1.x Equipment
 * workspace.
 */
import type {
  EquipmentProfileForSuggestion,
  MergeSuggestion,
  SuggestProfileMergesConfig,
} from './types.js';

const DEFAULT_FOCAL_TOLERANCE = 0.02;

/**
 * Canonical form for grouping: case-folded, every non-alphanumeric
 * character removed (`EdgeHD 8`/`EdgeHD8` -> `edgehd8`,
 * `Sky-Watcher`/`SkyWatcher` -> `skywatcher`). `null` stays `null` so "both
 * telescope canonical forms are null" counts as equal (a camera-only
 * profile never canonically matches a full-train one, SUG-6).
 */
function canonicalForm(value: string | null): string | null {
  if (value === null) return null;
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Single-linkage clusters of a canonical group's profiles by focal length.
 * Non-null focal values are sorted ascending and joined to the running
 * cluster while each is within `tolerance` of its immediate predecessor
 * (not the cluster's minimum — SUG-9's chained 500/510/520 case). A
 * null-focal profile joins the sole resulting cluster (SUG-12/SUG-14); with
 * zero clusters (every focal null) the whole group is one cluster; with two
 * or more clusters, null-focal profiles are excluded from all of them
 * (SUG-13) — the group is ambiguous and nothing is guessed.
 */
function clusterByFocal(
  group: EquipmentProfileForSuggestion[],
  tolerance: number,
): EquipmentProfileForSuggestion[][] {
  const withFocal = group
    .filter((p) => p.focalLengthMm !== null)
    .sort((a, b) => (a.focalLengthMm as number) - (b.focalLengthMm as number));
  const nullFocal = group.filter((p) => p.focalLengthMm === null);

  const clusters: EquipmentProfileForSuggestion[][] = [];
  for (const profile of withFocal) {
    const current = clusters[clusters.length - 1];
    const previous = current?.[current.length - 1];
    if (previous !== undefined) {
      const previousFocal = previous.focalLengthMm as number;
      const diff = ((profile.focalLengthMm as number) - previousFocal) / previousFocal;
      if (diff <= tolerance) {
        (current as EquipmentProfileForSuggestion[]).push(profile);
        continue;
      }
    }
    clusters.push([profile]);
  }

  if (clusters.length === 0) {
    return nullFocal.length > 0 ? [nullFocal] : [];
  }
  if (clusters.length === 1) {
    return [[...(clusters[0] as EquipmentProfileForSuggestion[]), ...nullFocal]];
  }
  return clusters;
}

/**
 * Recommended survivor for a cluster: a confirmed profile first (a user
 * confirmation always outranks usage), then the highest light-frame usage,
 * then the lexicographically smallest id — deterministic and
 * order-independent (SUG-17..19).
 */
function chooseSurvivor(cluster: EquipmentProfileForSuggestion[]): string {
  const confirmed = cluster.filter((p) => p.isUserConfirmed);
  const pool = confirmed.length > 0 ? confirmed : cluster;
  const best = pool.reduce((leader, candidate) => {
    if (candidate.lightUsageSeconds > leader.lightUsageSeconds) return candidate;
    if (candidate.lightUsageSeconds < leader.lightUsageSeconds) return leader;
    return candidate.id < leader.id ? candidate : leader;
  });
  return best.id;
}

/**
 * Propose consolidations of near-identical equipment profiles. Never
 * applies a merge — that is always an explicit user action
 * (`EquipmentProfilesRepository.merge`).
 *
 * Two profiles are grouping candidates when their telescope canonical
 * forms are equal **and** their camera canonical forms are equal (both
 * null counts as equal; canonical equality is an equivalence relation, so
 * the groups are clean with no transitivity surprises). Within a canonical
 * group, profiles additionally cluster by focal length within
 * `config.focalTolerance` (default 2%, relative to the smaller of two
 * adjacent sorted values). A suggestion is emitted for a cluster of >= 2
 * profiles only when at least one member is unconfirmed — once every
 * member is confirmed, that is the user saying "these really are
 * different" (Q5). `recommendedSurvivorId` and `reason` (always
 * `'canonical_name_match'`, DD-006's visible-reason contract) are
 * documented above on `chooseSurvivor`/`canonicalForm`.
 *
 * Output is fully deterministic and independent of input order: each
 * suggestion's `profileIds` is sorted ascending, and the suggestions
 * themselves are sorted by their (already-ascending) first id.
 */
export function suggestProfileMerges(
  profiles: EquipmentProfileForSuggestion[],
  config?: SuggestProfileMergesConfig,
): MergeSuggestion[] {
  const tolerance = config?.focalTolerance ?? DEFAULT_FOCAL_TOLERANCE;

  const groups = new Map<string, EquipmentProfileForSuggestion[]>();
  for (const profile of profiles) {
    const key = JSON.stringify([canonicalForm(profile.telescope), canonicalForm(profile.camera)]);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [profile]);
    } else {
      group.push(profile);
    }
  }

  const suggestions: MergeSuggestion[] = [];
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const cluster of clusterByFocal(group, tolerance)) {
      if (cluster.length < 2) continue;
      if (!cluster.some((p) => !p.isUserConfirmed)) continue;
      suggestions.push({
        profileIds: cluster.map((p) => p.id).sort(),
        recommendedSurvivorId: chooseSurvivor(cluster),
        reason: 'canonical_name_match',
      });
    }
  }

  return suggestions.sort((a, b) => {
    const idA = a.profileIds[0] ?? '';
    const idB = b.profileIds[0] ?? '';
    return idA < idB ? -1 : idA > idB ? 1 : 0;
  });
}
