# Spec: [P1-18] Equipment profile auto-detection

**Slug:** p1-18-equipment-profiles **Issue:** #26 **Plan:** docs/plans/p1-18-equipment-profiles.md **Date:** 2026-09-23
**Governing DDs:** DD-003 (schema, amended in this PR per the Q1/Q2 decisions; see DB-1…DB-10 and J-1), DD-006 (equipment split rule, "visible reasons"), DD-004 (Stage 3: detection is pure functions in `packages/core`), DD-008 (no Equipment page in v1.0), DD-002 (layering, typed IPC), ADR-004 (alter, never recreate), ADR-007 (falsifiability)
**Decisions applied:** the maintainer's "Open Questions resolved" comment on #26 (2026-09-23). Q1–Q8 are settled as the plan recommends, and every criterion below assumes them.

## Scope

This slice has three layers. **Core** gets three pure functions in `packages/core/src/catalog/equipment/`: `equipmentIdentity`/`defaultProfileName`, `detectEquipmentProfiles` and `suggestProfileMerges`, all exported from the package root. **DB** gets migration **0008**, which adds `equipment_profiles.match_key` (with a partial unique index where it is not null), `equipment_profiles.merged_into_id` (a self-FK), and the index `frames_equipment_profile_id_idx`. **DB** also gets an `EquipmentProfilesRepository` that extends CRUD with `detectFromFrames`, `resolveMatchKeys`, `listLive`, `usageHours`, `listMergeSuggestions`, `confirm`, `rename` and `merge`. **IPC** gets five `equipment.*` channels, with validation and main-process wiring. The slice has no renderer code and no scan-pipeline wiring. See **Out of Scope**.

Every criterion is numbered so the Reviewer's Mutation Log can refer to it. Each mechanical criterion names one edit to **production source** that must turn it red. The Reviewer applies the edit, confirms that the failure names the criterion's property (a crash or an unrelated assertion does not count), then reverts it.

When a criterion's subject is a set (profile ids, column names, index names, channel names, `matchKey`s), assert it by **equality over the whole expected set**, not by per-element containment (`#111`).

**Boundary rule (the lesson from P1-17's first review).** Every threshold is tested with one input exactly at the boundary and one input just past it. Those inputs are the pinned values in **Test Hints**. An input far from the boundary lets the named mutation pass without crossing it, and the check goes blind.

**Quote handling and bug #129.** The wrapping-quote strip in `equipmentIdentity` is defence in depth. No criterion depends on any parser still emitting quoted values. The quoted strings below are literal test inputs, either passed to core functions or seeded directly into `frames.telescope_raw`, and never come from parsing a fixture.

> **Orchestrator note (2026-09-23):** FOCALLEN values that round to 0 mm (e.g. 0.4) are treated as null. The ≤ 0 / non-finite → null rule applies **after** rounding to whole mm, closing ambiguity 5 from the spec-writing stage. Test it with 0.4 → null and 0.5 → 1.

## Definition of Done

### Functional Requirements

#### Public surface

- [ ] **API-1** — Given a consumer that imports from `@astrotracker/core` (the package root, no deep path), `equipmentIdentity`, `defaultProfileName`, `detectEquipmentProfiles`, `suggestProfileMerges`, and their input/output types are all reachable — **fails under:** deleting `suggestProfileMerges` from the catalog export block in `packages/core/src/index.ts`.

#### Identity: automatic, representation artifacts only (Q3)

- [ ] **ID-1** — Given the telescope strings `'Gme28'`, `"'Gme28'"` (one pair of wrapping single quotes) and `"  'Gme28'  "`, each with camera `'ZWO ASI533MC Pro'` and focal `336`, all three produce the same `matchKey`, and each reports `telescope === 'Gme28'` — **fails under:** removing the wrapping-quote strip from `equipmentIdentity` in `packages/core/src/catalog/equipment/identity.ts`.
- [ ] **ID-2** — Given the camera `"'QHY268M '"` (FITS padding _inside_ the quotes), the normalized camera is `'QHY268M'` and its `matchKey` equals the one for `'QHY268M'` — **fails under:** dropping the second trim (the one after the quote strip) in `equipmentIdentity`.
- [ ] **ID-3** — Given `"''Gme28''"`, the normalized telescope is `"'Gme28'"`: exactly one wrapping pair is removed — **fails under:** replacing the one-pair strip with a global strip such as `.replace(/^'+|'+$/g, '')`.
- [ ] **ID-4** — Given `"'Gme28"` (unbalanced leading quote only), the normalized telescope is `"'Gme28"` verbatim — **fails under:** stripping a leading quote and a trailing quote independently (`.replace(/^'/, '').replace(/'$/, '')`).
- [ ] **ID-5** — Given the telescope `"''"` or `'   '` together with a null camera and any focal, `equipmentIdentity` returns `null` — **fails under:** checking for emptiness before the quote strip instead of after it (so `"''"` normalizes to an empty string, not `null`, and yields an identity).
- [ ] **ID-6** — Given `'EdgeHD 8'` and `'EdgeHD8'` with the same camera and focal, the two `matchKey`s **differ** (internal whitespace drift is suggested, never merged automatically) — **fails under:** adding `.replace(/\s+/g, '')` to the string normalization in `equipmentIdentity`.
- [ ] **ID-7** — Given `'WO Gt 71'` and `'wo gt 71'` with the same camera and focal, the two `matchKey`s **differ** — **fails under:** adding `.toLowerCase()` to the string normalization in `equipmentIdentity`.
- [ ] **ID-8** — Given the focal inputs `336.0`, `336` and `335.88495`, each yields `focalLengthMm === 336`, and all three share one `matchKey` — **fails under:** removing the rounding from `equipmentIdentity` (so the raw value is stored).
- [ ] **ID-9** — Given the focal input `335.5`, `focalLengthMm` is `336` (a half rounds up) — **fails under:** rounding with `Math.floor` instead of `Math.round` in `equipmentIdentity`.
- [ ] **ID-10** — Given the focal input `335.49`, `focalLengthMm` is `335` — **fails under:** rounding with `Math.ceil` instead of `Math.round` in `equipmentIdentity`.
- [ ] **ID-11** — Given the focal input `336` next to the focal input `420` on identical strings, the two `matchKey`s differ (a reducer makes a different optical train) — **fails under:** leaving `focalLengthMm` out of the `matchKey` serialization.
- [ ] **ID-12** — Given the focal input `0`, `focalLengthMm` is `null`, and the `matchKey` equals the key for a null focal — **fails under:** changing the guard from `<= 0` to `< 0` in `equipmentIdentity`.
- [ ] **ID-13** — Given the focal input `NaN` or `Infinity`, the returned `focalLengthMm` is `null` itself (asserted on the component, not only on `matchKey`, because `JSON.stringify` renders both `NaN` and `Infinity` as `null` and would hide the defect) — **fails under:** removing the `Number.isFinite` check from `equipmentIdentity`.
- [ ] **ID-14** — Given a null telescope and camera, and a finite focal of `550`, `equipmentIdentity` returns `null`: focal length alone does not identify a rig — **fails under:** the no-identity guard in `equipmentIdentity` also requiring `focalLengthMm === null` before it returns `null`.
- [ ] **ID-15** — Given a null telescope with camera `'QHY268M'` (a camera-only frame such as a dark or bias, Q7), `equipmentIdentity` returns a non-null identity with `telescope === null` and `camera === 'QHY268M'` — **fails under:** the no-identity guard returning `null` when _either_ string is null (`||` instead of `&&`).
- [ ] **ID-16** — The pairs of triples (`'A|B'`, `'C'`) vs (`'A'`, `'B|C'`), (`'A,B'`, `'C'`) vs (`'A'`, `'B,C'`), (`'A"]'`, `'C'`) vs (`'A'`, `'"]C'`), and (`'null'`, `'X'`) vs (`null`, `'X'`), all at the same focal, each produce two distinct `matchKey`s — **fails under:** building `matchKey` as a template-literal join (`` `${telescope}|${camera}|${focalLengthMm}` ``) instead of an unambiguous serialization.

#### Default naming

- [ ] **NAME-1** — `defaultProfileName` for `'Gme28'` + `'ZWO ASI533MC Pro'` @ `336` is exactly `'Gme28 + ZWO ASI533MC Pro @ 336 mm'` — **fails under:** formatting focal with `.toFixed(1)` in `defaultProfileName` in `identity.ts`.
- [ ] **NAME-2** — `defaultProfileName` for a null telescope + `'QHY268M'` with a null focal is exactly `'QHY268M'` (no `null`, no stray `+`, no `@`) — **fails under:** `defaultProfileName` always appending `` ` @ ${focalLengthMm} mm` `` whether or not the focal is null.
- [ ] **NAME-3** — `defaultProfileName` for a null telescope + `'QHY268M'` is not prefixed by any telescope text — **fails under:** `defaultProfileName` joining `${telescope} + ${camera}` without dropping the null part, which renders `'null + QHY268M'`.
- [ ] **NAME-4** — `defaultProfileName` for `'DWARF mini'` + `'DWARF mini'` @ `7` is exactly `'DWARF mini @ 7 mm'` — **fails under:** removing the `telescope === camera` collapse from `defaultProfileName`.

#### Detection

- [ ] **DET-1** — Given six input rows (three `Gme28` variants, `'Gme28'`/`"'Gme28'"`/`'Gme28  '`, at focal 336.0/336/335.88495, plus two rows of `'Gme28'` @ 420, all with camera `'ZWO ASI533MC Pro'`, plus one row with a null telescope and camera), `detectEquipmentProfiles` returns exactly two profiles, with row counts `3` (the @ 336 profile) and `2` (the @ 420 profile) — **fails under:** keying the grouping map in `detect.ts` on the raw `telescopeRaw` string instead of `matchKey`.
- [ ] **DET-2** — Given the input from DET-1 in its given order and reversed, the two outputs are deep-equal and sorted by `matchKey` ascending — **fails under:** removing the final sort in `detect.ts`, which leaves output in first-seen order.
- [ ] **DET-3** — Given input whose **first** row for the @ 336 identity is `"'Gme28'"` (quoted) at `335.88495`, the detected profile's `telescope` is `'Gme28'`, its `focalLengthMm` is `336`, and its `name` equals `defaultProfileName` of those normalized components. The input order is pinned so the first-seen row is the raw-looking one; otherwise the mutation is blind — **fails under:** `detect.ts` copying the first row's raw `telescopeRaw` into the profile instead of the normalized identity component.

> **Orchestrator correction (2026-09-25), supersedes the DET-4 / SUG-21 Test Hints below.** The hint that manifest entries carry no `FOCALLEN` is false: `fits/sgpro/sgpro-light-precision-timestamps.fits` records `FOCALLEN: 800` for `GSO RC8 + QHY268M`, while `sgpro-light-sexagesimal.fits` has the same train with no FOCALLEN. So DET-4 expects **8 full-train profiles / 20 total** (RC8+QHY268M @ 800 and @ null are distinct, per the identity rules), and SUG-21 expects **exactly one** suggestion, that RC8 pair (the SUG-12 shape), not `[]`. SUG-21's fails-under still holds: a camera-only comparison would add false pairs beyond that one. Verified against the manifest by the orchestrator.

- [ ] **DET-4** — Given the ok-status entries of `fixtures/{fits,xisf,raw}/manifest.json` mapped to inputs (telescope from `TELESCOP`, camera from `INSTRUME` or, for RAW, `cameraInstrument(Make, Model)`, focal from `FOCALLEN`), the detected set of `(telescope, camera, focalLengthMm)` triples equals **exactly** the 19-element set in Test Hints: seven full-train profiles and twelve camera-only profiles, with no profile for `minimal-unit.xisf` or any malformed entry — **fails under:** `detect.ts` skipping rows whose normalized telescope is `null` (which drops every camera-only profile).

#### Merge suggestions: never applied automatically (Q4, Q5)

- [ ] **SUG-1** — Given unconfirmed profiles `'EdgeHD 8'` and `'EdgeHD8'` with the same camera and focal (`2032`), `suggestProfileMerges` returns exactly one suggestion whose `profileIds` set equals both ids and whose `reason` is `'canonical_name_match'`. This is the issue's "suggested as one profile" — **fails under:** the canonical-form regex in `suggest.ts` keeping whitespace (`/[^a-z0-9\s]/g` instead of `/[^a-z0-9]/g`).
- [ ] **SUG-2** — Given unconfirmed `'Sky-Watcher Esprit 100ED'` and `'SkyWatcher Esprit 100ED'` with the same camera and focal, one suggestion covers both — **fails under:** the canonical form in `suggest.ts` removing only whitespace (`/\s+/g`) rather than every non-alphanumeric character.
- [ ] **SUG-3** — Given unconfirmed `'WO Gt 71'` and `'wo gt 71'` with the same camera and focal, one suggestion covers both — **fails under:** removing `.toLowerCase()` from the canonical form in `suggest.ts`.
- [ ] **SUG-4** — Given unconfirmed `'Esprit' + 'ZWO ASI2600MC Pro'` and `'Esprit' + 'ZWO ASI2600MM Pro'` at the same focal, the result is `[]` (colour vs mono twins) — **fails under:** `suggest.ts` grouping on the telescope canonical form alone and ignoring the camera canonical form.
- [ ] **SUG-5** — Given unconfirmed `'ZWO ASI294MC'` vs `'ZWO ASI294MC Pro'` on one scope and focal, and separately `'WO Gt 71'` vs `'GT71'` on one camera and focal, the result is `[]` — **fails under:** `suggest.ts` treating two canonical forms as matching when one contains the other (`a.includes(b) || b.includes(a)`) instead of requiring equality.
- [ ] **SUG-6** — Given unconfirmed `'Esprit' + 'ZWO ASI2600MM Pro'` @ 550 and camera-only `null + 'ZWO ASI2600MM Pro'` @ null, the result is `[]` (full-train vs camera-only is never suggested) — **fails under:** `suggest.ts` treating a null telescope canonical as a wildcard that matches any telescope.
- [ ] **SUG-7** — Given identical strings at focal `500` and `510` (exactly 2% of the smaller value), one suggestion covers both — **fails under:** changing the tolerance comparison in `suggest.ts` from `<=` to `<`.
- [ ] **SUG-8** — Given identical strings at focal `500` and `511` (2.2% of the smaller value), the result is `[]` — **fails under:** `suggest.ts` comparing the percentage rounded to a whole number (`Math.round((b - a) / a * 100) <= 2`) instead of the exact ratio.
- [ ] **SUG-9** — Given identical strings at focal `500`, `510` and `520`, where each adjacent pair is within 2% but 500 vs 520 is 4%, one suggestion covers all three (single-linkage clustering of sorted adjacent values) — **fails under:** `suggest.ts` comparing each value to its cluster's first (minimum) value instead of the previous adjacent value.
- [ ] **SUG-10** — Given identical strings at `336` and `420`, the result is `[]`, and given `335` and `336` (the real-data plate-solve drift), one suggestion covers both — **fails under:** raising the default tolerance constant in `suggest.ts` from `0.02` to `0.25`.
- [ ] **SUG-11** — Given `config.focalTolerance` (or the implementation's equivalently named field) set to `0.001`, the pair `335`/`336` is **not** suggested, while the same input with the config omitted is suggested — **fails under:** `suggest.ts` using the literal default and ignoring the config value.
- [ ] **SUG-12** — Given `'GSO RC8' + 'QHY268M'` at `800` and the same strings at a null focal (a group with exactly one focal cluster), one suggestion covers both — **fails under:** `suggest.ts` excluding every null-focal profile from clustering unconditionally.
- [ ] **SUG-13** — Given identical strings at `335`, `336`, `420` and a null focal (two focal clusters), the result is exactly one suggestion whose `profileIds` set is exactly {335, 336}. The null-focal profile appears in no suggestion — **fails under:** `suggest.ts` attaching a null-focal profile to the first cluster when the group has two or more clusters.
- [ ] **SUG-14** — Given `'EdgeHD 8'` and `'EdgeHD8'`, both with a null focal (a group with zero non-null focal values), one suggestion covers both. This keeps the issue's acceptance criterion true for frames that lack `FOCALLEN` — **fails under:** `suggest.ts` emitting null-focal members only when the group has exactly one _non-null_ cluster, which leaves an all-null group unsuggested.
- [ ] **SUG-15** — Given the SUG-1 pair with **both** profiles `isUserConfirmed: true`, the result is `[]` (Q5: confirming both means "these are different") — **fails under:** removing the all-confirmed suppression check from `suggest.ts`.
- [ ] **SUG-16** — Given the SUG-1 pair with exactly **one** profile confirmed, the suggestion is still emitted — **fails under:** `suggest.ts` suppressing with `.some(p => p.isUserConfirmed)` instead of `.every(...)`.
- [ ] **SUG-17** — Given one confirmed profile with 1 h of light usage and one unconfirmed profile with 5 h, `recommendedSurvivorId` is the confirmed profile's id — **fails under:** `suggest.ts` ranking survivors by usage before confirmation.
- [ ] **SUG-18** — Given two unconfirmed profiles where the one with the lexicographically **larger** id has more light usage, `recommendedSurvivorId` is that higher-usage id — **fails under:** `suggest.ts` ignoring usage and choosing the smallest id.
- [ ] **SUG-19** — Given two unconfirmed profiles with equal usage, `recommendedSurvivorId` is the lexicographically smaller id, in both input orders — **fails under:** `suggest.ts` breaking ties by input position instead of by id.
- [ ] **SUG-20** — Given the SUG-13 input in its given order and reversed, the two outputs are deep-equal, including the order of `profileIds` inside each suggestion and the order of the suggestions — **fails under:** `suggest.ts` emitting `profileIds` in input order without sorting.
- [ ] **SUG-21** — Given the 19 fixture-derived profiles from DET-4, all unconfirmed, `suggestProfileMerges` returns `[]`. The shipped fixture corpus has no false-positive suggestions — **fails under:** `suggest.ts` comparing only the camera canonical form, which then pairs `'Sky-Watcher Esprit 100ED' + 'ZWO ASI2600MC Pro'` with `'ZWO FF65 APO' + 'ZWO ASI2600MC Pro'`.

#### Repository: detection and key resolution

All REPO/MRG/USE criteria run against a real SQLite database migrated to head (`openDatabase` on a temp file), with `foreign_keys=ON`.

- [ ] **REPO-1** — Given a seeded library whose frames carry the triples in Test Hints (including a dark with no `telescope_raw`), the first `detectFromFrames()` returns `{ inserted: 3, existing: 0 }`. The `equipment_profiles` rows then equal **exactly** the expected set of `(telescope, camera, focal_length, match_key, name, is_user_confirmed = false, merged_into_id = null)` — **fails under:** `detectFromFrames` reading `SELECT DISTINCT … FROM frames WHERE frame_type = 'light'`, which drops the camera-only dark's profile.
- [ ] **REPO-2** — Given one frame with `telescope_raw = 'Gme28'` and one with `"'Gme28'"` (same camera, focal `336` and `335.88495`), detection inserts exactly **one** profile, and `resolveMatchKeys` maps the identity of each frame's triple to that one id — **fails under:** `detectFromFrames` computing keys from the raw column values instead of calling `equipmentIdentity`.
- [ ] **REPO-3** — Given REPO-1's library, a second `detectFromFrames()` returns `{ inserted: 0, existing: 3 }` and the `equipment_profiles` row count is unchanged — **fails under:** omitting `matchKey` from the insert values in `detectFromFrames` (every row is stored with a null key, so nothing is ever found as existing).
- [ ] **REPO-4** — Given a profile renamed to `'My Rig'` and confirmed after the first detection, a second `detectFromFrames()` leaves its `name`, `is_user_confirmed`, and `updated_at` unchanged — **fails under:** switching the detection insert to an upsert (`onConflictDoUpdate({ target: equipmentProfiles.matchKey, set: { name: …, isUserConfirmed: false } })`).
- [ ] **REPO-5** — After `detectFromFrames()`, every `frames` row has the same `equipment_profile_id` (null) and `updated_at` it had before (detection never assigns frames; that is P1-18a) — **fails under:** `detectFromFrames` also issuing `UPDATE frames SET equipment_profile_id = …` for resolved keys.
- [ ] **REPO-6** — Given a pre-existing profile row inserted through CRUD with `match_key = null` and `telescope 'Gme28'`/`camera 'ZWO ASI533MC Pro'`/`focal_length 336` (a shape that 0000 allows), detection over a matching frame completes without error. It inserts a new keyed row, and `resolveMatchKeys` maps that key to the **new** row's id, never the legacy row. The legacy row is unchanged — **fails under:** `detectFromFrames` treating a row as existing when its `(telescope, camera, focal_length)` columns match, instead of matching on `match_key`.
- [ ] **REPO-7** — `resolveMatchKeys([knownKey, unknownKey])` returns a `Map` whose key set equals exactly `{knownKey}` — **fails under:** `resolveMatchKeys` initializing the result with every requested key mapped to `null`.

#### Repository: confirm and rename

- [ ] **CONF-1** — `confirm(id)` on an unconfirmed live profile sets `is_user_confirmed = true`, and its `updated_at` is strictly greater than the seeded value — **fails under:** `confirm` writing through a raw `db.update(equipmentProfiles).set({ isUserConfirmed: true })` that omits `updatedAt`.
- [ ] **CONF-2** — `confirm(id)` on a merged profile throws, and the row (including `is_user_confirmed` and `updated_at`) is unchanged — **fails under:** removing the merged-row check from `confirm`.
- [ ] **CONF-3** — `confirm(id)` with an unknown id throws — **fails under:** `confirm` returning `undefined` silently when the update matches no row.
- [ ] **REN-1** — `rename(id, '  New Name  ')` stores `name === 'New Name'` — **fails under:** removing the `.trim()` from `rename`.
- [ ] **REN-2** — `rename` changes `name` only: `telescope`, `camera`, `focal_length`, `match_key`, `is_user_confirmed` and `merged_into_id` are unchanged, and `updated_at` advances — **fails under:** `rename` also setting `isUserConfirmed: true` (the "rename implies confirm" shortcut).
- [ ] **REN-3** — `rename(id, '   ')` throws, and the row is unchanged — **fails under:** `rename` checking `name === ''` before trimming instead of after.
- [ ] **REN-4** — Renaming profile B to profile A's current name succeeds (names are labels, not identity) — **fails under:** `rename` rejecting a name already held by another live profile.
- [ ] **REN-5** — `rename` on a merged id throws and changes nothing — **fails under:** removing the merged-row check from `rename`.

#### Repository: merge (issue AC "merged only on user confirm")

Seed for MRG criteria: see **Merge library** in Test Hints. Every seeded row's `updated_at` is `2026-01-01T00:00:00Z`, so any re-stamp is strictly greater.

- [ ] **MRG-1** — Given the EdgeHD pair after `detectFromFrames()`, and with frames pre-assigned by the test, `listMergeSuggestions()` contains the pair, **and** every frame, session and master frame still carries its original `equipment_profile_id`, **and** neither profile has `merged_into_id` set. This is observed on the data, not inferred from a missing call — **fails under:** `listMergeSuggestions` applying its first suggestion via `merge` before returning.
- [ ] **MRG-2** — `merge(survivorId, [loserId])` repoints every `frames` row of the loser to the survivor — **fails under:** omitting the `frames` UPDATE from `merge`.
- [ ] **MRG-3** — The same merge repoints every `sessions` row of the loser to the survivor — **fails under:** omitting the `sessions` UPDATE from `merge`.
- [ ] **MRG-4** — The same merge repoints every `master_frames` row of the loser to the survivor — **fails under:** omitting the `master_frames` UPDATE from `merge`.
- [ ] **MRG-5** — Every repointed `frames`, `sessions` and `master_frames` row has an `updated_at` strictly greater than its seeded value — **fails under:** the `sessions` repoint in `merge` setting only `equipmentProfileId`, without `updatedAt`.
- [ ] **MRG-6** — Rows of a third, uninvolved profile keep their `equipment_profile_id` **and** `updated_at` byte-identical after the merge — **fails under:** dropping the `.where(inArray(frames.equipmentProfileId, mergedIds))` from the `frames` repoint, which then repoints every frame.
- [ ] **MRG-7** — After the merge, the loser row still exists, with `merged_into_id = survivorId` and its `name`/`match_key` unchanged. It is not hard-deleted (DD-003) — **fails under:** `merge` deleting the loser rows instead of setting `merged_into_id`.
- [ ] **MRG-8** — After the merge, the survivor has `is_user_confirmed = true`, and both the survivor's and the loser's `updated_at` are strictly greater than their seeded values — **fails under:** omitting the survivor-confirm write from `merge`.
- [ ] **MRG-9** — `merge(S, [L1, L2])` repoints the rows of **both** losers and marks both merged — **fails under:** `merge` processing only `mergedIds[0]`.
- [ ] **MRG-10** — After the merge, a second `detectFromFrames()` returns `inserted: 0`. The rescan does not resurrect the merged-away profile — **fails under:** `detectFromFrames` looking up existing keys among live rows only (`WHERE merged_into_id IS NULL`).
- [ ] **MRG-11** — After the merge, `resolveMatchKeys([loserKey]).get(loserKey) === survivorId` — **fails under:** `resolveMatchKeys` returning the row's own `id` and ignoring `merged_into_id`.
- [ ] **MRG-12** — After the merge, `listMergeSuggestions()` contains no suggestion that includes the loser's id — **fails under:** `listMergeSuggestions` passing all rows (merged ones included) to `suggestProfileMerges`.
- [ ] **MRG-13** — A merge leaves every session's `notes`/`weather_notes`, every frame's `session_id`, and every frame's `session_assignment_locked` unchanged, and deletes no `sessions` row — **fails under:** `merge` clearing `frames.session_id` on repointed frames (an anticipated re-grouping).
- [ ] **MRG-14** — Given A merged into B, then B merged into C, A's `merged_into_id` is C, A's frames point at C, and `resolveMatchKeys([A.key])` gives C — **fails under:** removing the chain-flattening UPDATE (`SET merged_into_id = survivor WHERE merged_into_id IN mergedIds`) from `merge`.
- [ ] **MRG-15** — `merge(S, [S, L])` (the survivor listed among the merged ids) throws, and a full dump of `equipment_profiles`, `frames`, `sessions` and `master_frames` is identical before and after — **fails under:** removing the survivor-in-list guard from `merge`.
- [ ] **MRG-16** — `merge(S, [])`, with S unconfirmed, throws and the full dump is unchanged — **fails under:** removing the empty-list guard from `merge` (S would be confirmed).
- [ ] **MRG-17** — `merge(S, [L, unknownId])` throws, and the full dump is unchanged (L is **not** merged) — **fails under:** removing the unknown-merged-id guard from `merge`.
- [ ] **MRG-18** — `merge(M, [L])`, where M is itself merged, throws and the full dump is unchanged — **fails under:** removing the merged-survivor guard from `merge`.
- [ ] **MRG-19** — `merge(S, [L, X])`, where X is already merged elsewhere, throws and the full dump is unchanged (L is **not** merged) — **fails under:** removing the already-merged guard from `merge`.
- [ ] **MRG-20** — Given a failure injected at the **last** write statement that `merge` issues (for example, a test-installed SQLite trigger `RAISE(ABORT)` on whichever table the implementation writes last; the test names which statement it targets), `merge` throws, and the full dump is identical to the pre-merge dump, so no frame, session or master frame is left repointed — **fails under:** removing the transaction wrapper from `merge`.

#### Usage hours (issue AC, Q6)

Seed: see **Usage library** in Test Hints.

- [ ] **USE-1** — `usageHours(P1)` is exactly `2` and its seconds figure is exactly `7200`. Only `light` frames count, and the seeded P1 dark (1800 s) and flat (30 s) carry non-zero exposure — **fails under:** dropping the `frame_type = 'light'` predicate from the usage query.
- [ ] **USE-2** — P1's usage includes its 3600 s light whose file is `missing` — **fails under:** filtering the usage query on `files.status = 'present'`.
- [ ] **USE-3** — P1's usage excludes its 3600 s light whose file is `duplicate` — **fails under:** dropping the `status <> 'duplicate'` predicate from the usage query.
- [ ] **USE-4** — P3, whose only light has a null `exposure_seconds`, reports seconds `0` and hours `0` (numbers, not `null` or `NaN`) — **fails under:** removing the `COALESCE(…, 0)` around `SUM(exposure_seconds)`.
- [ ] **USE-5** — `usageHours` equals the seconds divided by `3600`, so P2's 3600 s gives exactly `1` — **fails under:** dividing by `60` in the usage computation.
- [ ] **USE-6** — `listLive()` returns a live-profile id set that equals exactly `{P1, P2, P3, P4}` (P4 has no frames and reports `0`), and each entry's `lightExposureSeconds`/`usageHours`/`lightFrameCount` match `usageHours()` for that id — **fails under:** `listLive` using an INNER JOIN to `frames`, which drops P4.
- [ ] **USE-7** — After `merge(P1, [P2])`, `listLive()` excludes P2, and P1's seconds equal `7200 + 3600 = 10800` — **fails under:** `listLive` omitting the `merged_into_id IS NULL` filter.
- [ ] **USE-8** — `lightFrameCount` for P1 is `4`. It counts non-duplicate lights, including the missing-file light and the null-exposure light, and excludes the duplicate, the dark and the flat — **fails under:** counting with `COUNT(exposure_seconds)` instead of `COUNT(*)` over the same predicate, which skips the null-exposure light.
- [ ] **USE-9** — In the merge library, where the `EdgeHD8` profile has more light seconds than `EdgeHD 8` and both are unconfirmed, `listMergeSuggestions()` gives `recommendedSurvivorId` = the `EdgeHD8` id. Usage really reaches the core function — **fails under:** `listMergeSuggestions` passing `0` usage for every profile.

#### IPC contract (Q8)

- [ ] **IPC-1** — The set of channels bound by `registerIpcHandlers` equals exactly the ten pre-existing channels plus `equipment.list`, `equipment.suggestions`, `equipment.confirm`, `equipment.rename` and `equipment.merge`, asserted against an explicit literal list rather than `IPC_CHANNELS` itself — **fails under:** removing `'equipment.merge'` from `IPC_CHANNELS` in `packages/desktop/src/ipc/contract.ts`.
- [ ] **IPC-2** — `equipment.merge` with `{ survivorId: 'S', mergedIds: ['L1', 'L2'] }` calls the injected dep exactly once, with survivor `'S'` and merged ids `['L1', 'L2']` in their correct positions, and returns its result — **fails under:** the `equipment.merge` handler in `packages/desktop/src/main/ipc/register.ts` passing the arguments in swapped order.
- [ ] **IPC-3** — `equipment.list`, `equipment.suggestions`, `equipment.confirm({ id })` and `equipment.rename({ id, name })` each forward to their own injected dep and return its output — **fails under:** the `equipment.suggestions` handler calling `deps.equipment.list()`.
- [ ] **IPC-4** — `equipment.confirm({ id: '   ' })` throws, and the confirm dep is never called — **fails under:** the `equipment.confirm` handler forwarding `input.id` without `requireNonEmptyString`.
- [ ] **IPC-5** — `equipment.rename({ id: 'x', name: '   ' })` throws, and the rename dep is never called — **fails under:** the rename validator checking only `typeof name === 'string'`.
- [ ] **IPC-6** — `equipment.merge({ survivorId: 'S', mergedIds: 'L1' })` (a string, not an array) throws, and the dep is never called — **fails under:** the merge validator checking `mergedIds.length > 0` instead of `Array.isArray(mergedIds)`.
- [ ] **IPC-7** — `equipment.merge({ survivorId: 'S', mergedIds: [] })` throws, and the dep is never called — **fails under:** dropping the non-empty-array check from the merge validator.
- [ ] **IPC-8** — `equipment.merge({ survivorId: 'S', mergedIds: ['L1', ''] })` and `mergedIds: ['L1', 42]` each throw, and the dep is never called — **fails under:** the merge validator checking `Array.isArray` without validating each element as a non-empty string.

### Data Integrity

Migration criteria follow the P1-17 DB-1…DB-8 pattern. A pre-0008 database is built with `buildPartialMigrationsFolder(dir, 7)` and seeded with one `equipment_profiles` row. A `watch_folders` → `files` → `frames` row, a `sessions` row and a `master_frames` row all reference that profile. The database is then migrated to head.

- [ ] **DB-1** — After migration, `equipment_profiles.match_key` exists as nullable TEXT, and the pre-existing row reads back `null` — **fails under:** deleting the `ALTER TABLE equipment_profiles ADD match_key` statement from `packages/db/drizzle/0008_*.sql`.
- [ ] **DB-2** — After migration, `equipment_profiles.merged_into_id` exists as nullable TEXT, and the pre-existing row reads back `null` — **fails under:** deleting the `ADD merged_into_id` statement from `0008_*.sql`.
- [ ] **DB-3** — With `foreign_keys=ON`, setting `merged_into_id` to an id with no `equipment_profiles` row is rejected — **fails under:** removing the `REFERENCES equipment_profiles(id)` clause from the `merged_into_id` ADD statement in `0008_*.sql`.
- [ ] **DB-4** — Two `equipment_profiles` rows with the same non-null `match_key` are rejected — **fails under:** deleting the `CREATE UNIQUE INDEX … ON equipment_profiles (match_key)` statement from `0008_*.sql`.
- [ ] **DB-5** — Two `equipment_profiles` rows with `match_key` null are both accepted — **fails under:** changing the column to `match_key text DEFAULT '' NOT NULL` in `0008_*.sql` (the second empty key then collides).
- [ ] **DB-6** — The unique index on `match_key` is **partial**: `PRAGMA index_list(equipment_profiles)` reports it with `unique = 1` and `partial = 1`, and its `sqlite_master.sql` contains `WHERE` … `match_key` … `IS NOT NULL` — **fails under:** dropping the `WHERE match_key IS NOT NULL` clause from the index statement in `0008_*.sql`. (Behavioural inserts cannot see this: a full UNIQUE index in SQLite also admits multiple NULLs, so DB-5 is green under this mutation. This structural check carries the Q1 decision.)
- [ ] **DB-7** — The named (non-`sqlite_autoindex_*`) index sets equal exactly the following. For `frames`: `{frames_target_filter_type_idx, frames_session_id_idx, frames_date_obs_utc_idx, frames_equipment_profile_id_idx}`. For `equipment_profiles`: `{<the match_key partial unique index>}`. `frames_equipment_profile_id_idx` covers exactly the column `equipment_profile_id` — **fails under:** deleting the `CREATE INDEX frames_equipment_profile_id_idx` statement from `0008_*.sql`.
- [ ] **DB-8** — The migrated column-name set of `equipment_profiles` equals exactly `{id, created_at, updated_at, name, telescope, camera, focal_length, aperture, pixel_size, is_user_confirmed, match_key, merged_into_id}`. The column sets of `frames`, `sessions` and `master_frames` equal exactly their pre-0008 lists. Both are asserted by set equality (`#111`) — **fails under:** appending ``ALTER TABLE `equipment_profiles` ADD `dismissed_at` integer;`` to `0008_*.sql` (a persisted-dismissal column Q5 rejected).
- [ ] **DB-9** — Migrating the seeded pre-0008 database completes without error. Every seeded row survives with the same id and column values, and the frame, session and master frame still reference the seeded profile — **fails under:** replacing the `equipment_profiles` ALTER statements in `0008_*.sql` with `DROP TABLE equipment_profiles` + `CREATE TABLE equipment_profiles (…new shape…)`, which ADR-004 forbids.
- [ ] **DB-10** — Migration 0008 is registered in `packages/db/drizzle/meta/_journal.json` directly after 0007 (the journal `idx` values are exactly `0…8`). A fresh empty database migrated to head exposes `matchKey`/`mergedIntoId` through `repos.equipmentProfiles` — **fails under:** removing the 0008 entry from `_journal.json`.
- [ ] **DB-11** — Writing `matchKey` and `mergedIntoId` through `repos.equipmentProfiles.insert`/`update` and reading them back round-trips both unchanged, under their camelCase names — **fails under:** deleting the `mergedIntoId` column declaration from `packages/db/src/schema/equipment.ts`.

### Core Invariants

- [ ] **INV-1** — No code path in the diff writes, moves, renames or deletes files. `merge` is FK repointing only. The Reviewer greps the diff for `fs.`/`writeFile`/`rename(`/`unlink`/`rm(` calls: there must be none in `packages/core/src/catalog/equipment/` or `packages/db/src/repositories/equipment-profiles.ts`, and the only writes are SQL against the app-data database.
- [ ] **INV-2** — The new domain logic lives in `packages/core/src/catalog/equipment/` with no Electron, `fs`, `path`, network, DB, `process.env` or `Date.now()` use. The Reviewer greps that directory and checks the import graph. Only `packages/db` contains SQL.
- [ ] **INV-3** — Every timestamp this slice writes (`created_at`, `updated_at`) is stamped via `new Date()`, which is epoch-ms UTC through the existing `timestamp_ms` columns and helpers (`insertStamp`, the CRUD `update`). No local-time formatting is persisted. The Reviewer greps `equipment-profiles.ts` for timestamp writes.
- [ ] **INV-4** — Manual user overrides survive a rescan. A rename, a confirm and a merge made before `detectFromFrames()` are all intact after it, including the renamed profile's name, the confirmed flag, the loser's `merged_into_id`, and the fact that no new row appears for the loser's key — **fails under:** switching the detection insert to `onConflictDoUpdate` that resets `name`, `isUserConfirmed` and `mergedIntoId` to their detected defaults.
- [ ] **INV-5** — After migration, `equipment_profiles` still satisfies DD-003's UUIDv7-TEXT-PK + `created_at`/`updated_at` conformance (the existing conformance test stays green) — **fails under:** 0008 rebuilding `equipment_profiles` without its `updated_at` column.
- [ ] **INV-6** — Nothing in the scan path calls the new operations. The Reviewer greps `packages/desktop/src/main/jobs/` and `packages/core/src/scanning/` for `detectFromFrames`, `resolveMatchKeys`, `detectEquipmentProfiles` and `equipmentIdentity`, and finds none (P1-18a wires them).
- [ ] **INV-7** — The renderer is untouched. The Reviewer confirms that the diff changes no file under `packages/desktop/src/renderer/`.
- [ ] **INV-8** — Long-running work goes through the worker queue: **N/A**. No operation here runs in the scan path, detection reads the DISTINCT triples (tens of rows), and `merge` issues one indexed UPDATE per table.

### Performance

- [ ] **PERF-1** — `pnpm bench` shows no regression beyond threshold on the P0-07 scan benchmark. The Reviewer runs it on this branch and on its base, and compares the output. The one risk is the new `frames_equipment_profile_id_idx`, which adds one B-tree maintenance per frame write. Nothing else touches Stages 1–4, and no new benchmark case is added.

### Tests

- [ ] **TEST-1** — `identity.test.ts`, `detect.test.ts` and `suggest.test.ts` are table-driven and cover every ID/NAME/DET/SUG case above, using the literal values from Test Hints.
- [ ] **TEST-2** — `equipment-profiles.test.ts` runs against a real migrated temp-file database and covers every REPO/CONF/REN/MRG/USE case. It also covers `merge` with an unknown **survivor** id, which must throw and leave the dump unchanged. That case has no separate mechanical criterion: the `merged_into_id` FK rejects it inside the transaction even without a guard, so any guard-removal mutation is equivalent.
- [ ] **TEST-3** — `migrations.test.ts` has a 0008 describe block that mirrors the 0007 block (partial migrations folder through idx 7, seeded, migrated, asserted) and carries DB-1…DB-10. `DD003_INDEXES` gains `frames_equipment_profile_id_idx`.
- [ ] **TEST-4** — `contract.test.ts` carries IPC-1…IPC-8. It also rejects a non-object input (`null`, a string) on `confirm`/`rename`/`merge` before the dep is reached.
- [ ] **TEST-5** — All existing tests pass, and `pnpm -r build`, `pnpm lint` and `pnpm test` are each green (the exact commands CI runs, per CLAUDE.md).
- [ ] **TEST-6** — E2E: **N/A**. This slice adds no renderer surface. The inline confirmation UI belongs to P1-21/P1-22.
- [ ] **TEST-7** — TypeScript strict passes, with no `any` in the diff that lacks a `// justified:` comment.

## Judgement Criteria

- [ ] **J-1** — In `design/DD-003-database-schema.md`, the `equipment_profiles(…)` listing gains exactly two columns, `match_key` (annotated as partial-unique where not null) and `merged_into_id` (annotated as a self-reference to the survivor). The "Key design points" index list gains exactly `frames(equipment_profile_id)`. The diff removes and rewords nothing else. The Reviewer checks this by reading the DD-003 diff.
- [ ] **J-2** — Every statement in `0008_*.sql` is `ALTER TABLE … ADD`, `CREATE INDEX` or `CREATE UNIQUE INDEX … WHERE`, with no `CREATE TABLE`, `DROP TABLE`, `__new_` rebuild or `RENAME` (ADR-004). The Reviewer reads the file end to end.
- [ ] **J-3** — `listLive()` computes usage with one aggregate `GROUP BY` query over live profiles, not one query per profile, and `merge` issues one UPDATE per referencing table, not one per row. The Reviewer inspects `equipment-profiles.ts`.
- [ ] **J-4** — The new IPC record types in `contract.ts` are local and import-free, like `WatchFolderRecord`, and carry `createdAt`/`updatedAt` as `Date`. `packages/desktop/src/main/index.ts` wires `deps.equipment` to `database.repos.equipmentProfiles`. The Reviewer inspects both files, because the main-process wiring has no unit-test seam.
- [ ] **J-5** — The `reason` code `'canonical_name_match'` and the survivor-ranking rule (confirmed, then light usage, then smallest id) are documented in a doc comment on `suggestProfileMerges`, so that P1-21/P1-22 can show the "visible reason" DD-006 asks for. The Reviewer inspects `suggest.ts`.

## Out of Scope

The Reviewer must **not** flag any of the following as gaps:

- **P1-18a (#125):** assigning `frames.equipment_profile_id` during scans, calling `detectFromFrames`/`resolveMatchKeys` from the scan pipeline or job queue, re-running `detectSessions()` after a merge, persisting sessions, and deciding how camera-only calibration frames attach to a night's light session.
- **Any renderer UI:** no Equipment page, no inline confirmation widget and no renderer call to the new channels. Inline confirmation belongs to P1-21/P1-22.
- **The v1.x Equipment workspace** and everything deferred to it: vendor-prefix tables (`WO Gt 71` ~ `GT71` is correctly _not_ suggested), edit-distance or ML fuzzy matching, and "same camera + same focal, different telescope string" signature suggestions.
- An `equipment.detect` IPC channel (detection is pipeline work).
- Unmerge or split of profiles, persisted "not the same rig" dismissals beyond the confirm-all rule, and user-created profiles.
- Populating `aperture` or `pixel_size`, and treating rotator, mount or filter wheel as identity components.
- Integration-time rollups beyond per-profile usage (P1-13) and the Dashboard equipment-usage widget (P1-26).
- Calibration matching's use of profiles (P1-20/P1-21).
- `usageHours` behaviour for a merged or unknown id. The plan does not specify it, and no consumer exists.
- Converting the existing `DD003_INDEXES` containment loop in `migrations.test.ts` into set equality across the whole database. DB-7 asserts equality for the two tables this slice touches.
- Migration renumbering against parallel branches (P1-12/P1-12a/P1-21). Whichever merges second regenerates.
- New binary fixtures under `fixtures/`.

## Test Hints

- **Quote/trim (ID-1…ID-5):** `'Gme28'`, `"'Gme28'"`, `"  'Gme28'  "` → `'Gme28'`; `"'QHY268M '"` → `'QHY268M'`; `"''Gme28''"` → `"'Gme28'"`; `"'Gme28"` → `"'Gme28"`; `"''"` and `'   '` → `null`.
- **Rounding (ID-8…ID-13):** `336.0`, `336`, `335.88495` → 336. `335.5` → 336. `335.49` → 335. `0`, `-5`, `NaN`, `Infinity`, `-Infinity` → `null`. `7` → 7 (DWARF).
- **Delimiter collisions (ID-16):** use the four pairs literally, all at focal `null`.
- **Tolerance (SUG-7…SUG-11):** the relative difference of adjacent sorted focal values `a < b` is `(b − a) / a`, measured against the **smaller** value, and "within tolerance" is `≤ 0.02`. The pinned pairs are 500/510 (exactly 0.02, suggested), 500/511 (0.022, not suggested), 500/510/520 (chained), 335/336 (0.30%, suggested) and 336/420 (25%, not suggested). Use one telescope (`'Test Scope'`) and one camera (`'Test Cam'`) for all of them, so any grouping is attributable to focal alone.
- **Survivor (SUG-17…SUG-19):** use ids `'01900000-0000-7000-8000-00000000000a'` and `'…00b'`. In SUG-18, `…00b` has 5 h and `…00a` has 1 h, so `…00b` wins. In SUG-19, both have 2 h, so `…00a` wins in both orders.
- **Fixture set (DET-4, SUG-21):** the ok-status manifest entries carry no `FOCALLEN`, so every expected focal is `null`. Full-train profiles (7): `Sky-Watcher Esprit 100ED + ZWO ASI2600MM Pro`, `Sky-Watcher Esprit 100ED + ZWO ASI2600MC Pro`, `GSO RC8 + QHY268M`, `SkyWatcher 200PDS + Canon EOS 6D`, `SkyWatcher 200PDS + Atik 460EX`, `ZWO FF65 APO + ZWO ASI2600MC Pro`, `TS-Optics 130 APO + Moravian G3-16200`. Camera-only profiles (12): `ZWO ASI2600MM Pro`, `ZWO ASI2600MC Pro`, `QHY268M`, `Atik 460EX`, `ZWO ASI294MC`, `ZWO ASI294MM Pro`, `Moravian G3-16200`, `Fixture Cam`, and the RAW bodies via `cameraInstrument`: `Canon EOS 6D`, `NIKON Z 6`, `SONY ILCE-7M4`, `Canon EOS R6`. No profile comes from `xisf/minimal-unit.xisf` or from any `status: "error"` entry.
- **Detection library (REPO-1…REPO-7):** seed frames with direct `repos.frames.insert` calls, `equipment_profile_id` null. Seed a `'Gme28' + 'ZWO ASI533MC Pro'` light @ `336.0`, a `"'Gme28'" + 'ZWO ASI533MC Pro'` master-style light @ `335.88495`, a `'Gme28' + 'ZWO ASI533MC Pro'` light @ `420`, and a dark with `telescope_raw` null + `'ZWO ASI533MC Pro'` @ null. Expect 3 profiles: Gme28@336, Gme28@420, and camera-only ASI533MC Pro. For REPO-2 specifically, isolate the two `Gme28`@336 variants.
- **Merge library (MRG-\*, USE-9):** there are three profiles. `E1 = 'EdgeHD 8' + 'ZWO ASI2600MM Pro' @ 2032`, with 2 lights × 300 s. `E2 = 'EdgeHD8' + 'ZWO ASI2600MM Pro' @ 2032`, with 4 lights × 300 s, one session (with `notes: 'windy'`) and one master dark. `U = 'Esprit' + 'ZWO ASI2600MC Pro' @ 550`, with 2 lights, one session and one master flat. One E2 frame is `session_assignment_locked = true` with a non-null `session_id`. After `detectFromFrames()`, the test assigns each frame's `equipment_profile_id` via `resolveMatchKeys` (standing in for P1-18a). It then force-sets every row's `updated_at` to `2026-01-01T00:00:00Z` with raw SQL. Merges run as `merge(E1, [E2])` unless a criterion says otherwise.
- **Atomicity (MRG-20):** for example, `CREATE TRIGGER t BEFORE UPDATE OF merged_into_id ON equipment_profiles BEGIN SELECT RAISE(ABORT, 'injected'); END;`, but only if setting `merged_into_id` really is the last statement `merge` issues. Otherwise put the trigger on the implementation's actual final table. The test comment states the order it relies on, and the Reviewer confirms that at least one repoint precedes the injected failure. If none does, the check is blind.
- **Usage library (USE-\*):**
  - **P1:** light 1800 s present, light 1800 s present, light 3600 s `missing`, light 3600 s `duplicate`, light with `exposure_seconds` null (present), dark 1800 s, flat 30 s. That gives 7200 s, 2 h, `lightFrameCount` 4.
  - **P2:** three lights × 1200 s present. That gives 3600 s and 1 h.
  - **P3:** one light with null exposure. That gives 0 s and 0 h.
  - **P4:** no frames. That gives 0 s and 0 h.
- **Migration (DB-\*):** use `buildPartialMigrationsFolder(dir, 7)`. Seed with raw SQL using only pre-0008 columns: one `equipment_profiles` row, `watch_folders` → `files` → `frames` with `equipment_profile_id` set to it, a `sessions` row and a `master_frames` row (needing its own `files` row) with `equipment_profile_id` set to it. Then `openDatabase` to migrate to head. Expected pre-0008 column lists for `frames`/`sessions` are those in the 0007 block. For `master_frames` they are `{id, created_at, updated_at, file_id, master_type, camera_raw, equipment_profile_id, filter_id, exposure_seconds, ccd_temp, gain, offset, binning_x, binning_y, created_date, sub_count, notes}`.
