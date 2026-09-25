/**
 * Table-driven tests for `suggestProfileMerges()` (P1-18).
 *
 * Test-only fs access to read the committed manifest corpus (SUG-21) is not
 * domain-logic I/O (DD-002 rule 1 governs production code) — same pattern
 * as `detect.test.ts`.
 */
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { cameraInstrument } from '../../raw/index.js';
import { detectEquipmentProfiles } from './detect.js';
import { suggestProfileMerges } from './suggest.js';
import type { EquipmentIdentityInput, EquipmentProfileForSuggestion } from './types.js';

let nextId = 1;
function profile(
  telescope: string | null,
  camera: string | null,
  focalLengthMm: number | null,
  opts: Partial<
    Pick<EquipmentProfileForSuggestion, 'isUserConfirmed' | 'lightUsageSeconds' | 'id'>
  > = {},
): EquipmentProfileForSuggestion {
  return {
    id: opts.id ?? `p${nextId++}`,
    telescope,
    camera,
    focalLengthMm,
    isUserConfirmed: opts.isUserConfirmed ?? false,
    lightUsageSeconds: opts.lightUsageSeconds ?? 0,
  };
}

describe('suggestProfileMerges — canonical form (Q3/Q4)', () => {
  // SUG-1: the issue's own "suggested as one profile" acceptance criterion.
  it('SUG-1: EdgeHD 8 / EdgeHD8 (whitespace drift) are suggested as one profile', () => {
    const a = profile('EdgeHD 8', 'ZWO ASI2600MM Pro', 2032, { id: 'a' });
    const b = profile('EdgeHD8', 'ZWO ASI2600MM Pro', 2032, { id: 'b' });
    const suggestions = suggestProfileMerges([a, b]);
    expect(suggestions).toHaveLength(1);
    expect(new Set(suggestions[0]?.profileIds)).toEqual(new Set(['a', 'b']));
    expect(suggestions[0]?.reason).toBe('canonical_name_match');
  });

  // SUG-2: punctuation drift (hyphen).
  it('SUG-2: Sky-Watcher / SkyWatcher (punctuation drift) are suggested', () => {
    const a = profile('Sky-Watcher Esprit 100ED', 'ZWO ASI2600MM Pro', 550);
    const b = profile('SkyWatcher Esprit 100ED', 'ZWO ASI2600MM Pro', 550);
    expect(suggestProfileMerges([a, b])).toHaveLength(1);
  });

  // SUG-3: case drift.
  it('SUG-3: WO Gt 71 / wo gt 71 (case drift) are suggested', () => {
    const a = profile('WO Gt 71', 'ZWO ASI533MC Pro', 336);
    const b = profile('wo gt 71', 'ZWO ASI533MC Pro', 336);
    expect(suggestProfileMerges([a, b])).toHaveLength(1);
  });

  // SUG-4: colour vs mono twins are never suggested (camera differs).
  it('SUG-4: colour vs mono twins on the same scope+focal are not suggested', () => {
    const a = profile('Esprit', 'ZWO ASI2600MC Pro', 550);
    const b = profile('Esprit', 'ZWO ASI2600MM Pro', 550);
    expect(suggestProfileMerges([a, b])).toEqual([]);
  });

  // SUG-5: substring/containment must not be treated as a match.
  it('SUG-5: substring-related model numbers and vendor-prefix drift are not suggested', () => {
    const mc = profile('Scope', 'ZWO ASI294MC', 400);
    const mcPro = profile('Scope', 'ZWO ASI294MC Pro', 400);
    expect(suggestProfileMerges([mc, mcPro])).toEqual([]);

    const woGt71 = profile('WO Gt 71', 'Cam', 336);
    const gt71 = profile('GT71', 'Cam', 336);
    expect(suggestProfileMerges([woGt71, gt71])).toEqual([]);
  });

  // SUG-6: full-train vs camera-only is never suggested (null is not a wildcard).
  it('SUG-6: a full-train profile is never suggested against a camera-only one', () => {
    const fullTrain = profile('Esprit', 'ZWO ASI2600MM Pro', 550);
    const cameraOnly = profile(null, 'ZWO ASI2600MM Pro', null);
    expect(suggestProfileMerges([fullTrain, cameraOnly])).toEqual([]);
  });
});

describe('suggestProfileMerges — focal tolerance clustering (SUG-7..14)', () => {
  it('SUG-7: exactly 2% apart (500/510) is suggested', () => {
    const a = profile('Test Scope', 'Test Cam', 500);
    const b = profile('Test Scope', 'Test Cam', 510);
    expect(suggestProfileMerges([a, b])).toHaveLength(1);
  });

  it('SUG-8: 2.2% apart (500/511) is not suggested', () => {
    const a = profile('Test Scope', 'Test Cam', 500);
    const b = profile('Test Scope', 'Test Cam', 511);
    expect(suggestProfileMerges([a, b])).toEqual([]);
  });

  it('SUG-9: chained adjacent tolerance (500/510/520) clusters all three', () => {
    const a = profile('Test Scope', 'Test Cam', 500, { id: 'a' });
    const b = profile('Test Scope', 'Test Cam', 510, { id: 'b' });
    const c = profile('Test Scope', 'Test Cam', 520, { id: 'c' });
    const suggestions = suggestProfileMerges([a, b, c]);
    expect(suggestions).toHaveLength(1);
    expect(new Set(suggestions[0]?.profileIds)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('SUG-10: 336/420 (25%) is not suggested; 335/336 (real plate-solve drift) is', () => {
    const a = profile('Gme28', 'ZWO ASI533MC Pro', 336);
    const b = profile('Gme28', 'ZWO ASI533MC Pro', 420);
    expect(suggestProfileMerges([a, b])).toEqual([]);

    const c = profile('Gme28', 'ZWO ASI533MC Pro', 335);
    const d = profile('Gme28', 'ZWO ASI533MC Pro', 336);
    expect(suggestProfileMerges([c, d])).toHaveLength(1);
  });

  it('SUG-11: a tighter configured tolerance excludes 335/336, the default includes it', () => {
    const a = profile('Gme28', 'ZWO ASI533MC Pro', 335);
    const b = profile('Gme28', 'ZWO ASI533MC Pro', 336);
    expect(suggestProfileMerges([a, b], { focalTolerance: 0.001 })).toEqual([]);
    expect(suggestProfileMerges([a, b])).toHaveLength(1);
  });

  it('SUG-12: a null-focal profile joins the sole focal cluster in its canonical group', () => {
    const withFocal = profile('GSO RC8', 'QHY268M', 800);
    const nullFocal = profile('GSO RC8', 'QHY268M', null);
    expect(suggestProfileMerges([withFocal, nullFocal])).toHaveLength(1);
  });

  it('SUG-13: with two focal clusters, the null-focal profile is excluded from both', () => {
    const p335 = profile('Test Scope', 'Test Cam', 335, { id: '335' });
    const p336 = profile('Test Scope', 'Test Cam', 336, { id: '336' });
    const p420 = profile('Test Scope', 'Test Cam', 420, { id: '420' });
    const pNull = profile('Test Scope', 'Test Cam', null, { id: 'null' });

    const suggestions = suggestProfileMerges([p335, p336, p420, pNull]);
    expect(suggestions).toHaveLength(1);
    expect(new Set(suggestions[0]?.profileIds)).toEqual(new Set(['335', '336']));
    expect(suggestions.some((s) => s.profileIds.includes('null'))).toBe(false);
  });

  it('SUG-14: an all-null-focal canonical group (zero non-null clusters) is still suggested', () => {
    const a = profile('EdgeHD 8', 'ZWO ASI2600MM Pro', null);
    const b = profile('EdgeHD8', 'ZWO ASI2600MM Pro', null);
    expect(suggestProfileMerges([a, b])).toHaveLength(1);
  });
});

describe('suggestProfileMerges — confirmation suppression (Q5, SUG-15/16)', () => {
  it('SUG-15: suggestions are suppressed once every member is confirmed', () => {
    const a = profile('EdgeHD 8', 'ZWO ASI2600MM Pro', 2032, { isUserConfirmed: true });
    const b = profile('EdgeHD8', 'ZWO ASI2600MM Pro', 2032, { isUserConfirmed: true });
    expect(suggestProfileMerges([a, b])).toEqual([]);
  });

  it('SUG-16: a suggestion is still emitted when exactly one member is confirmed', () => {
    const a = profile('EdgeHD 8', 'ZWO ASI2600MM Pro', 2032, { isUserConfirmed: true });
    const b = profile('EdgeHD8', 'ZWO ASI2600MM Pro', 2032, { isUserConfirmed: false });
    expect(suggestProfileMerges([a, b])).toHaveLength(1);
  });
});

describe('suggestProfileMerges — recommended survivor (SUG-17..19)', () => {
  const idA = '01900000-0000-7000-8000-00000000000a';
  const idB = '01900000-0000-7000-8000-00000000000b';

  it('SUG-17: a confirmed profile wins over an unconfirmed one with far more usage', () => {
    const confirmed = profile('EdgeHD 8', 'ZWO ASI2600MM Pro', 2032, {
      id: idA,
      isUserConfirmed: true,
      lightUsageSeconds: 3600,
    });
    const unconfirmed = profile('EdgeHD8', 'ZWO ASI2600MM Pro', 2032, {
      id: idB,
      isUserConfirmed: false,
      lightUsageSeconds: 18000,
    });
    const suggestions = suggestProfileMerges([confirmed, unconfirmed]);
    expect(suggestions[0]?.recommendedSurvivorId).toBe(idA);
  });

  it('SUG-18: among unconfirmed profiles, higher usage wins regardless of id ordering', () => {
    const a = profile('EdgeHD 8', 'ZWO ASI2600MM Pro', 2032, { id: idA, lightUsageSeconds: 3600 });
    const b = profile('EdgeHD8', 'ZWO ASI2600MM Pro', 2032, { id: idB, lightUsageSeconds: 18000 });
    const suggestions = suggestProfileMerges([a, b]);
    expect(suggestions[0]?.recommendedSurvivorId).toBe(idB);
  });

  it('SUG-19: equal usage ties break by the lexicographically smallest id, in both orders', () => {
    const a = profile('EdgeHD 8', 'ZWO ASI2600MM Pro', 2032, { id: idA, lightUsageSeconds: 7200 });
    const b = profile('EdgeHD8', 'ZWO ASI2600MM Pro', 2032, { id: idB, lightUsageSeconds: 7200 });
    expect(suggestProfileMerges([a, b])[0]?.recommendedSurvivorId).toBe(idA);
    expect(suggestProfileMerges([b, a])[0]?.recommendedSurvivorId).toBe(idA);
  });
});

describe('suggestProfileMerges — determinism (SUG-20)', () => {
  it('produces deep-equal output, including profileIds order, forward and reversed', () => {
    const p335 = profile('Test Scope', 'Test Cam', 335, { id: '335' });
    const p336 = profile('Test Scope', 'Test Cam', 336, { id: '336' });
    const p420 = profile('Test Scope', 'Test Cam', 420, { id: '420' });
    const pNull = profile('Test Scope', 'Test Cam', null, { id: 'null' });
    const inputs = [p335, p336, p420, pNull];

    expect(suggestProfileMerges([...inputs].reverse())).toEqual(suggestProfileMerges(inputs));
  });

  /**
   * The test above is blind to both `.sort()` calls in `suggest.ts`
   * (cluster.map(p => p.id).sort() and the outer suggestions.sort()):
   * `clusterByFocal`'s own internal focal-sort already happens to put its
   * one cluster in id-ascending order for that data (335 < 336 both
   * numerically and lexically as strings), and there is only ever one
   * suggestion, so the outer sort has nothing to reorder either way.
   *
   * This case forces both sorts to matter: two canonical groups (so the
   * *order of suggestions* is observable), each a two-member cluster whose
   * members share one focal length or are both null-focal (so
   * `clusterByFocal`'s internal sort — driven by focal value — cannot be
   * the thing producing id order; only the id `.sort()` can). The ids are
   * chosen so the first-encountered member of each group has the
   * lexicographically *larger* id, and reversing the input flips which
   * member of each group (and which group) is encountered first — so
   * without either `.sort()`, forward and reversed runs disagree with each
   * other AND with the pinned expected shape.
   */
  it('is not blind to either sort: unsorted-by-construction clusters and group order', () => {
    const q = profile('EdgeHD 8', 'Cam1', null, { id: 'q' }); // group A, encountered 1st forward
    const p = profile('EdgeHD8', 'Cam1', null, { id: 'p' }); // group A, encountered 2nd forward
    const z = profile('Z', 'Cam2', 1, { id: 'z' }); // group B, encountered 1st forward
    const y = profile('Z', 'Cam2', 1, { id: 'y' }); // group B, encountered 2nd forward
    const inputs = [q, p, z, y];

    const expected = [
      { profileIds: ['p', 'q'], recommendedSurvivorId: 'p', reason: 'canonical_name_match' },
      { profileIds: ['y', 'z'], recommendedSurvivorId: 'y', reason: 'canonical_name_match' },
    ];

    const forward = suggestProfileMerges(inputs);
    const reversed = suggestProfileMerges([...inputs].reverse());
    expect(forward).toEqual(expected);
    expect(reversed).toEqual(expected);
  });
});

describe('suggestProfileMerges — fixture corpus (SUG-21)', () => {
  const FIXTURES_ROOT = new URL('../../../../../fixtures/', import.meta.url);

  interface ManifestEntry {
    file: string;
    format: 'fits' | 'xisf' | 'raw';
    expected: { status: 'ok' | 'error'; keywords?: Record<string, unknown> };
  }

  function loadManifest(set: string): ManifestEntry[] {
    const parsed = JSON.parse(
      readFileSync(new URL(`${set}/manifest.json`, FIXTURES_ROOT), 'utf8'),
    ) as { entries: ManifestEntry[] };
    return parsed.entries;
  }

  function str(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
  }

  function num(value: unknown): number | null {
    return typeof value === 'number' ? value : null;
  }

  function toIdentityInput(entry: ManifestEntry): EquipmentIdentityInput {
    const kw = entry.expected.keywords ?? {};
    if (entry.format === 'raw') {
      return {
        telescopeRaw: null,
        cameraRaw: cameraInstrument(str(kw['Make']), str(kw['Model'])),
        focalLength: null,
      };
    }
    return {
      telescopeRaw: str(kw['TELESCOP']),
      cameraRaw: str(kw['INSTRUME']),
      focalLength: num(kw['FOCALLEN']),
    };
  }

  /**
   * Per the note in `detect.test.ts`'s DET-4 block: the spec's Test Hints
   * claims this fixture set yields `[]` from `suggestProfileMerges`
   * ("the shipped fixture corpus has no false-positive suggestions"). That
   * is only true under the spec's incorrect premise that the corpus has 19
   * profiles with no focal lengths at all. The real corpus's GSO RC8 +
   * QHY268M pair (@800 and @null, verified in DET-4) is exactly the
   * SUG-12 case — a legitimate suggestion, not a false positive. So the
   * correct assertion here is exactly one suggestion, covering that pair,
   * and nothing else. See the Coder's final report.
   */
  it('yields exactly one suggestion (the real GSO RC8 + QHY268M focal pair) and no false positives', () => {
    const entries = [...loadManifest('fits'), ...loadManifest('xisf'), ...loadManifest('raw')];
    const inputs = entries.filter((e) => e.expected.status === 'ok').map(toIdentityInput);
    const detected = detectEquipmentProfiles(inputs);
    expect(detected).toHaveLength(20);

    const forSuggestion: EquipmentProfileForSuggestion[] = detected.map((d, index) => ({
      id: `fixture-${index}`,
      telescope: d.telescope,
      camera: d.camera,
      focalLengthMm: d.focalLengthMm,
      isUserConfirmed: false,
      lightUsageSeconds: 0,
    }));

    const suggestions = suggestProfileMerges(forSuggestion);
    expect(suggestions).toHaveLength(1);

    const suggestedIds = new Set(suggestions[0]?.profileIds);
    const suggestedProfiles = detected.filter((_, index) => suggestedIds.has(`fixture-${index}`));
    expect(suggestedProfiles).toHaveLength(2);
    for (const p of suggestedProfiles) {
      expect(p.telescope).toBe('GSO RC8');
      expect(p.camera).toBe('QHY268M');
    }
    expect(new Set(suggestedProfiles.map((p) => p.focalLengthMm))).toEqual(new Set([800, null]));
  });
});
