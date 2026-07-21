# Spec: [P1-05] Capture-software profile table

**Slug:** p1-05-capture-software-profiles **Issue:** #13 **Plan:** docs/plans/p1-05-capture-software-profiles.md **Date:** 2026-07-20
**Governing DDs:** DD-004 (scanning pipeline — "Header parsing specifics": capture-software quirks handled by a data-driven **software profile table in `packages/core`**, unit-tested against fixtures, community-extensible), DD-002 (layering — `packages/core` pure TypeScript, no Electron, no fs side effects in domain logic), DD-003 (schema — consulted only to confirm no `frames` column exists for detected software identity; no schema change is proposed)

## Scope

This issue delivers a data-driven capture-software profile registry under a new `packages/core/src/capture-profiles/` domain folder. It ships two public entry points — `detectProfile(metadata: FrameMetadata): CaptureProfile | null` (identifies which of six capture programs produced a frame from its preserved raw header keywords, or returns `null`) and `applyCaptureProfile(metadata: FrameMetadata): FrameMetadata` (detects, then applies the matched profile's corrective fixups and returns corrected metadata) — plus the `CaptureProfile` / `CaptureProfileFixup` types, the `ALL_PROFILES` registry array, six profile object literals (`nina`, `sgpro`, `apt`, `sharpcap`, `asiair-asistudio`, `voyager`), one genuine quirk fixup (SGPro `ANGLE` → `rotatorAngleDegrees`), table-driven tests against the committed P0-06 fixture corpus, an automated source-scan "no per-software branching" regression test, and a public export block from the package root.

It does **not** deliver:

- **P1-07** — wiring `applyCaptureProfile` into the Stage 2 worker pipeline / `frames` row assembly. This issue ships only the pure functions and their exports.
- **Any `packages/core/src/xisf/metadata.ts` change** to preserve `<Property>` elements into `FrameMetadata.headers` (would be a P1-02 shape change needed before XISF software detection could ever be possible).
- **Any new `FrameMetadata` field** (e.g. `siteLatDeg`, a canonical gain-scale field) that a future fixup would need to correct currently-uncorrectable data — a P1-01/P1-02 concern.
- **Any `packages/db` schema/column/migration** or persistence of the detected profile id. DD-003 has no `frames` column for it and none is proposed; the registry's effect is entirely transient.
- **P1-04** (frame classification) — an unmerged sibling; not read, not imported, not depended on, not duplicated. IMAGETYP-string classification is P1-04's table, not a capture-software "quirk fix" here.
- **DD-005** filter/target normalization; **community-extensibility mechanics** beyond "add a file + a registry line" (no plugin loader, no user-editable JSON).

See **Non-Goals** below (copied from the plan's Out of Scope).

## Public API Contract

Reviewer checks each item against the actual diff; signatures and types must match **exactly** (not merely be supersets).

- [ ] `packages/core/src/capture-profiles/types.ts` exports exactly these two symbols:
  - [ ] `export type CaptureProfileFixup = (headers: Record<string, FitsValue>, metadata: FrameMetadata) => Partial<FrameMetadata>;` — a fixup takes the frame's raw preserved header dict **and** the current normalized `FrameMetadata`, and returns **only the fields it changes** (a `Partial`, never a full replacement object). `FitsValue` is imported from `../fits/types.js`; `FrameMetadata` from `../fits/metadata.js`.
  - [ ] `export interface CaptureProfile` with exactly these four members, named and typed as follows:
    - `id: string` — stable machine id (e.g. `'sgpro'`). Never persisted; used for logging/debugging and test identification only.
    - `displayName: string` — human-readable name for logs/debugging.
    - `detect: (headers: Record<string, FitsValue>) => boolean` — a pure, side-effect-free predicate over the frame's raw preserved headers. Note it takes **`headers`**, not the full `FrameMetadata` (the public `detectProfile` passes `metadata.headers` in).
    - `fixups: CaptureProfileFixup[]` — self-contained corrective rules, applied in array order against the **original** metadata; later entries win on field conflicts. `[]` is valid and expected for four of the six profiles.
- [ ] `packages/core/src/capture-profiles/detect.ts` exports `detectProfile(metadata: FrameMetadata): CaptureProfile | null` — it takes the full shared `FrameMetadata` object (not a FITS-specific header type, not a bare headers dict), reads `metadata.headers`, walks `ALL_PROFILES` in declaration order, and returns the **first** profile whose `detect` returns `true`, else `null`. It never throws and never guesses a default.
- [ ] `packages/core/src/capture-profiles/apply.ts` exports `applyCaptureProfile(metadata: FrameMetadata): FrameMetadata` — calls `detectProfile`, returns `metadata` unchanged (see reference-identity criterion below) when it is `null`, otherwise folds every fixup's patch over the original metadata and returns `{ ...metadata, ...patch }`.
- [ ] `packages/core/src/capture-profiles/registry.ts` exports `export const ALL_PROFILES: readonly CaptureProfile[]` containing exactly the six profile literals in this declaration order: `ninaProfile`, `sgproProfile`, `aptProfile`, `sharpcapProfile`, `asiairAsistudioProfile`, `voyagerProfile`. Its body is `import` statements plus a single array literal — no conditionals, no function calls, no per-software branching.
- [ ] `packages/core/src/capture-profiles/index.ts` (barrel) re-exports `detectProfile`, `applyCaptureProfile`, `ALL_PROFILES`, and the `CaptureProfile` / `CaptureProfileFixup` types from the module's internal files.
- [ ] `packages/core/src/index.ts` gains a capture-profiles export block equivalent to:
  ```ts
  export {
    detectProfile,
    applyCaptureProfile,
    ALL_PROFILES,
    type CaptureProfile,
    type CaptureProfileFixup,
  } from './capture-profiles/index.js';
  ```
  All five names are reachable from the package root (`@astrotracker/core`) with no deep import path. The `.js` extension on the specifier is present (ESM/NodeNext convention already used throughout `index.ts`). No other export block in `index.ts` is altered or removed.

### Internal helper contract

- [ ] `packages/core/src/capture-profiles/util.ts` exports at least `headerStringField(headers: Record<string, FitsValue>, key: string): string | null` (or equivalently-typed) — returns the header value as a string when it is a string, else `null` — so each profile's `detect` predicate can safely `startsWith`/`includes` against a guaranteed string (`(headerStringField(headers, 'CREATOR') ?? '')...`). Any other tiny shared header helper a profile needs lives here.

## Behavioral Contract / Acceptance Criteria

Each item is independently checkable against the diff.

### The "no code changes to add a profile" criterion (issue AC #2), as a mechanically-checkable requirement

The issue's literal criterion is: _"Adding a profile requires only a data entry + fixture, no code changes."_ This is decomposed into concrete, verifiable requirements:

- [ ] **The dispatch files contain zero per-software branching.** `detect.ts` and `apply.ts` contain **no** conditional, string literal, or identifier that names any of the six programs. Reviewer verifies by reading both files: each is a single generic loop/fold over `ALL_PROFILES` (or the matched profile's `fixups`), with no `if (profile.id === '…')`, no `switch`, and no program-name string anywhere. `registry.ts` and `profiles/**` **are** expected to name programs (that is the "data" side) and are explicitly out of this check's scope.
- [ ] **An automated source-scan test enforces it** (`detect.test.ts`): a test `readFileSync`s the source of `detect.ts` and `apply.ts` (and **not** `registry.ts` or `profiles/**`) and asserts the combined source text contains **none** of the program-identifying substrings: `'N.I.N.A'`, `'SGPro'`, `'Sequence Generator'`, `'Astro Photography Tool'`, `'SharpCap'`, `'ZWO ASI'`, `'Voyager'`. Reviewer confirms this test exists, runs, and is green.
- [ ] **The test would actually fail if a branch were added.** Reviewer spot-checks the test's teeth by reasoning through (or, if desired, momentarily editing locally and reverting) the scenario: adding `if (profile.id === 'sgpro') { /* SGPro-specific */ }` — or any equivalent inline-named branch — to `detect.ts`/`apply.ts` would introduce one of the guarded substrings and turn the source-scan test red. A test that could not go red for such an edit does not satisfy this criterion. The spec acknowledges this is a string-literal heuristic (a sufficiently obfuscated branch could dodge it) — it directly encodes the acceptance criterion rather than relying on review discipline alone, and is paired with the by-reading check above.
- [ ] **The "one file + one registry line" additivity holds.** Reviewer confirms, by inspecting the module layout, that a hypothetical 7th profile would require exactly (a) one new file under `profiles/` (a `CaptureProfile` object literal) and (b) a two-line edit to `registry.ts` (one `import`, one array entry). No change to `types.ts`, `util.ts`, `detect.ts`, `apply.ts`, or `index.ts` would be needed. The only shared file any profile registration touches is `registry.ts`, and that edit is mechanical data composition (import + array append), never a branch. Reviewer should sanity-check this by asking: _"if I added a 7th profile file plus one registry line, would any other file need to change, and would the no-branching test still pass?"_ — the answer must be _no change elsewhere_ and _test still green_.
- [ ] **Registry shape test** (`detect.test.ts`): `ALL_PROFILES.length === 6`; every entry has a non-empty `id` and `displayName`, `detect` is a function, and `fixups` is an array.

### Per-fixture detection acceptance (issue AC #1: "Each fixture's software correctly detected")

Driven by `fixtures.test.ts`, table-driven against the real committed corpus, mirroring `fits/fixtures.test.ts`'s `FIXTURES_ROOT` + manifest-reading pattern (`new URL('../../../../fixtures/', import.meta.url)`, `readFileSync`, `parseFitsHeaderFromBuffer` + `toFrameMetadata`). **Every** fixture below is asserted individually (not one-per-program sampling); each row is an independently checkable assertion.

- [ ] **All 27 FITS program fixtures resolve to the correct profile id.** For every `fits/` manifest entry that carries a `provenance.program`, parsing the file's bytes and calling `detectProfile(metadata)?.id` yields the expected profile id. The expected id is derived from the manifest's `provenance.program` string via a small program→id map in the test. Exact counts, cross-checked against `fixtures/fits/manifest.json`:
  - `N.I.N.A.` → `nina` — **6** fixtures (`fits/nina/*.fits`).
  - `SGPro` → `sgpro` — **5** fixtures (`fits/sgpro/*.fits`).
  - `APT` → `apt` — **4** fixtures (`fits/apt/*.fits`).
  - `SharpCap` → `sharpcap` — **4** fixtures (`fits/sharpcap/*.fits`).
  - `ASIStudio/ASIAIR` → `asiair-asistudio` — **4** fixtures (`fits/asistudio/*.fits`).
  - `Voyager` → `voyager` — **4** fixtures (`fits/voyager/*.fits`).
  - Total: **27**. The test asserts the number of program-bearing entries it iterated is exactly 27 (a guard against the manifest silently losing a fixture).
- [ ] **All 6 FITS edge fixtures resolve to `null`.** Every `fits/edge/*.fits` fixture (`status: "ok"`, no `provenance.program`) — `edge-commentary-hierarch`, `edge-continue-longstrn`, `edge-end-36th-card`, `edge-end-block2`, `edge-exposure-only`, `edge-exptime-only` — parses and `detectProfile(metadata) === null`. This proves no false positives from parseable files carrying no software-id keyword. Each is an explicit assertion.
- [ ] **Malformed FITS fixtures are not exercised here.** They never reach `toFrameMetadata` (Stage 2 parse failure short-circuits before profile application, per DD-004 error isolation); the test filters to `expected.status === 'ok'` before attempting detection.
- [ ] **All 3 valid XISF fixtures resolve to `null`.** `xisf/pixinsight-unit-mono-ha.xisf`, `xisf/nina-unit-mono-oiii.xisf`, and `xisf/minimal-unit.xisf` each parse (via the XISF parser + its `toFrameMetadata`) and `detectProfile(metadata) === null`. This is asserted as the **correct** v1 outcome, with an inline comment pointing at the plan's Architecture Decision / Open Question #1 (neither fixture carries a FITSKeyword-level software-id field, and native `<Property>` elements are not copied into `headers`), so a future reader does not mistake three passing null-assertions for a missing feature.
- [ ] **All 4 valid RAW fixtures resolve to `null`.** `raw/canon-6d-light.cr2`, `raw/canon-r6-light.cr3`, `raw/nikon-z6-light.nef`, `raw/sony-a7iv-light.arw` each parse (via the RAW parser + its `toFrameMetadata`) and `detectProfile(metadata) === null`, unconditionally by design (EXIF carries `Make`/`Model` hardware identity, never a capture-software fingerprint; no profile predicate keys on a tag RAW produces). Each is an explicit assertion.
- [ ] **Corpus-coverage guard.** The suite asserts its total detection-assertion count is at least 40 (27 program + 6 edge + 3 XISF + 4 RAW), so an accidental empty test table cannot pass vacuously.

### Quirk-fixup acceptance: SGPro `ANGLE` → `rotatorAngleDegrees`

This is the plan's one genuine, fixture-verified defect: SGPro writes rotator angle as the nonstandard `ANGLE` keyword, never `OBJCTROT` (what the generic FITS mapper reads for `rotatorAngleDegrees`), so `rotatorAngleDegrees` comes back `null` for SGPro frames carrying rotation data. It must be tested **both** ways:

- [ ] **Fixture-driven, end-to-end** (`apply.test.ts`): parse `fixtures/fits/sgpro/sgpro-light-precision-timestamps.fits`, then:
  - Assert `toFrameMetadata(header).rotatorAngleDegrees === null` **before** applying the profile (proves the defect is real, not already handled by the generic mapper — this fixture has an `ANGLE` card of `182.4` and no `OBJCTROT` card, both verifiable in the fixture bytes).
  - Assert `applyCaptureProfile(metadata).rotatorAngleDegrees === 182.4` **after** (proves the fixup recovers the value). Note `ANGLE` is intentionally **not** in the manifest's `expected.keywords` (it is outside PRD §8.2's critical list), yet it is present in the fixture bytes and preserved verbatim in `FrameMetadata.headers` by `toFrameMetadata`'s `headers: { ...k }`; the test relies on parsing real bytes, not the manifest keyword list.
- [ ] **Literal-object unit tests** (`profiles/sgpro.test.ts`): call the fixup function directly (no parser involved) with hand-built `(headers, metadata)` pairs, asserting each of:
  - `ANGLE: 182.4` present + `rotatorAngleDegrees: null` → returns `{ rotatorAngleDegrees: 182.4 }` (patch applied).
  - `ANGLE` present + `rotatorAngleDegrees` already non-null (simulating a hypothetical future `OBJCTROT` co-occurrence) → returns `{}` (never clobbers a legitimately-mapped value; generic mapping wins).
  - `ANGLE` absent → returns `{}`.
  - `ANGLE` present but non-numeric (e.g. the string `"182.4 deg"`, a defensive malformed-header case) → returns `{}` (the `typeof angle === 'number'` guard treats it as "not applicable" rather than coercing or throwing).
- [ ] The SGPro profile's `detect` predicate matches on `CREATOR` including `'Sequence Generator Pro'`, so the `ANGLE` fixup can only ever run on a frame already identified as SGPro — an unrelated program's stray `ANGLE` header can never trigger a false correction.

### Rejected-quirk documentation (must not be silently absent)

The plan investigated and rejected several quirks named in the issue body. Their absence as fixups must be **documented with inline comments** in the corresponding profile files, so the Reviewer sees a deliberate decision, not an oversight. Reviewer checks for these comments; an empty `fixups: []` with no explanation does not satisfy this.

- [ ] **`profiles/apt.ts`** carries a comment recording that the issue's own "APT temperature keyword" example does **not** manifest: every APT fixture uses the standard `CCD-TEMP` card directly, which the generic mapper already reads correctly, so no fixup applies.
- [ ] **`profiles/sharpcap.ts`** and **`profiles/asiair-asistudio.ts`** each carry a comment recording that `GAIN` is on ZWO's native unitless 0–570 scale, but `FrameMetadata.gain` has no documented canonical unit to convert into, so there is no wrong value to correct — a documentation note, not a parsing defect; flagging the unit ambiguity is out of scope.
- [ ] **`profiles/nina.ts`** carries a comment recording that `SITELAT`/`SITELONG`/`SITEELEV` are present but `SITENAME` never is, so `siteName` stays `null`; this is not fixable as a `siteName` **string** correction (lat/long is not a name) and would require a new `FrameMetadata` field, which is out of scope for a profile fixup.
- [ ] Each of the four zero-fixup profiles (`apt`, `sharpcap`, `asiair-asistudio`, `voyager`) ships `fixups: []`. `voyager.ts` may note that no software-specific defect was found in its fixtures.

### Merge / precedence semantics

- [ ] **Fixups read the ORIGINAL metadata, not each other's output** (`apply.ts`): the fold passes `metadata.headers` and `metadata` (the original) into every fixup, accumulating patches (`patch = { ...patch, ...fixup(metadata.headers, metadata) }`); no fixup ever sees a previous fixup's mutation. Reviewer verifies by reading `apply.ts`. (The six shipped profiles have at most one fixup, so this is a design guarantee for future multi-fixup profiles, verified by inspection of the fold, not exercised by a colliding-fixup fixture today.)
- [ ] **Last-fixup-wins on a literal field collision:** when two fixups return the same field, the later one (higher array index) wins, by virtue of `{ ...patch, ...later }` spread order. Documented in an `apply.ts` comment; no shipped profile has colliding fixups.
- [ ] **`null`-profile pass-through returns the SAME object reference** (`apply.test.ts`): construct a `FrameMetadata` whose `headers` contains no known fingerprint, call `applyCaptureProfile`, and assert the result is the identical object with `expect(result).toBe(metadata)` — **not** `toStrictEqual`. This proves "no profile" truly short-circuits (no reconstruction, no allocation), rather than rebuilding an identical-looking object.
- [ ] **No-op pass-through for zero-fixup profiles** (`apply.test.ts`): for each of `nina`, `apt`, `sharpcap`, `asiair-asistudio`, `voyager`, run `applyCaptureProfile` against that program's representative fixture and assert the result equals the pre-fixup `toFrameMetadata` output field-for-field with `toStrictEqual`. This catches an accidental future fixup silently mutating a previously-untouched field. (These profiles have empty `fixups`, so the returned object is value-equal to the input; the same-reference `toBe` guarantee is asserted only for the `null`-profile case above, since a matched-but-empty-fixups profile still flows through the `{ ...metadata, ...patch }` merge.)

## Non-Functional / Repo-Rule Conformance

- [ ] **TypeScript strict:** compiles under the repo's strict config with no errors.
- [ ] **No untagged `any`:** no `any` in the diff without a `// justified:` comment (CLAUDE.md convention); this code is expected to need none.
- [ ] **Layering (DD-002):** all new production logic is in `packages/core`, pure TypeScript, with no Electron imports and no fs side effects. Every profile predicate/fixup and both entry points are synchronous pure functions over already-in-memory data. Reviewer verifies mechanically: `grep -rE "(^|[^a-zA-Z])(node:)?fs\b|from ['\"](node:)?fs|require\(['\"](node:)?fs|electron" packages/core/src/capture-profiles/ --include='*.ts' -l` returns **only** test files (`*.test.ts`), never a production file. Test files reading the committed `fixtures/` corpus is permitted — it is not domain-logic I/O — matching the established `fits/fixtures.test.ts` pattern.
- [ ] **DB (DD-003):** N/A — no new table, column, or migration; `packages/db` is untouched by this diff. Confirmed no `frames` column exists for detected software identity and none is proposed; the registry's effect is transient (corrects `FrameMetadata` before Stage 3 / P1-07 ever consume it).
- [ ] **Non-destructive guarantee:** N/A to production code (no fs access at all); test files only **read** committed fixtures.
- [ ] **UUIDv7 / `updated_at` / UTC timestamps:** N/A — this issue introduces no table and touches no timestamp field (the one fixup writes the numeric `rotatorAngleDegrees`, not a date).
- [ ] **Performance (PRD §8.4):** detection is at most six `startsWith`/`includes` string checks per frame; application runs at most one fixup. No dynamic table construction inside any hot function — `ALL_PROFILES` is a module-level constant. Negligible against the DD-004 10k-header scan budget. (Benchmarking is P1-07's concern; not blocking here.)
- [ ] **All existing tests still pass:** no other `packages/core` (or any package's) tests regress; no fixture and no DD document is modified.
- [ ] `pnpm --filter @astrotracker/core build` (`tsc -p tsconfig.json`) exits 0. Root equivalent: `pnpm -r build`.
- [ ] `pnpm --filter @astrotracker/core lint` (`eslint src && prettier --check src`) exits 0. Root equivalent: `pnpm -r lint`.
- [ ] `pnpm --filter @astrotracker/core test` (`vitest run --dir src`) exits 0 with all new test files green. Root equivalent: `pnpm -r test`.

## File-by-File Expected Diff

All paths are new unless marked _modified_. Reviewer confirms each runtime file is placed exactly per the plan's module layout: a new top-level `capture-profiles/` folder parallel to `fits/`, `xisf/`, `raw/`, with the six program files grouped under a `profiles/` subdirectory (data), visually separated from the dispatch files (`detect.ts`, `apply.ts`, `registry.ts`).

- [ ] `packages/core/src/capture-profiles/types.ts` — new; `CaptureProfile`, `CaptureProfileFixup` exactly per the Public API Contract.
- [ ] `packages/core/src/capture-profiles/util.ts` — new; `headerStringField()` and any other tiny shared header helper.
- [ ] `packages/core/src/capture-profiles/registry.ts` — new; `ALL_PROFILES: readonly CaptureProfile[]` — six imports + one array literal, no branching.
- [ ] `packages/core/src/capture-profiles/detect.ts` — new; `detectProfile()` — one generic loop over `ALL_PROFILES`, no program names.
- [ ] `packages/core/src/capture-profiles/apply.ts` — new; `applyCaptureProfile()` — detect + generic fixup fold, no program names.
- [ ] `packages/core/src/capture-profiles/index.ts` — new; barrel re-exporting the public surface.
- [ ] `packages/core/src/capture-profiles/profiles/nina.ts` — new; `ninaProfile`, `fixups: []` with the rejected-`SITENAME`-quirk comment.
- [ ] `packages/core/src/capture-profiles/profiles/sgpro.ts` — new; `sgproProfile`, the one non-empty `fixups` (`ANGLE` → `rotatorAngleDegrees`).
- [ ] `packages/core/src/capture-profiles/profiles/apt.ts` — new; `aptProfile`, `fixups: []` with the rejected-`CCD-TEMP`-quirk comment.
- [ ] `packages/core/src/capture-profiles/profiles/sharpcap.ts` — new; `sharpcapProfile`, `fixups: []` with the rejected-`GAIN`-scale comment.
- [ ] `packages/core/src/capture-profiles/profiles/asiair-asistudio.ts` — new; `asiairAsistudioProfile`, `detect` matching `startsWith('ZWO ASI')` (covers both ASIAIR and ASIStudio writers under one profile), `fixups: []` with the rejected-`GAIN`-scale comment.
- [ ] `packages/core/src/capture-profiles/profiles/voyager.ts` — new; `voyagerProfile`, `fixups: []`.
- [ ] `packages/core/src/capture-profiles/profiles/sgpro.test.ts` — new; literal-object fixup unit tests (four cases per the quirk-fixup criteria).
- [ ] `packages/core/src/capture-profiles/detect.test.ts` — new; registry-shape test + the source-scan "no per-software branching" test.
- [ ] `packages/core/src/capture-profiles/apply.test.ts` — new; SGPro fixture-driven fixup test, merge/precedence tests, zero-fixup no-op (`toStrictEqual`) tests, and the `null`-profile same-reference (`toBe`) test.
- [ ] `packages/core/src/capture-profiles/fixtures.test.ts` — new; full-corpus detection acceptance suite (27 FITS program + 6 FITS edge + 3 XISF + 4 RAW).
- [ ] `packages/core/src/index.ts` — _modified_; adds the five-name capture-profiles export block from `./capture-profiles/index.js`. No other export block is altered or removed.

No changes to `fixtures/` (every fixture needed already exists from P0-06), `packages/db`, `packages/desktop`, or any DD document.

## Non-Goals (copied from plan's Out of Scope — do not flag these as gaps)

- **P1-07** — wiring `applyCaptureProfile` into the Stage 2 worker pipeline. This issue ships only the table + pure functions; P1-07 lists P1-05 as a dependency precisely so the table exists first.
- **`packages/core/src/xisf/metadata.ts`** change to preserve `<Property>` elements into `FrameMetadata.headers` — a P1-02 shape change, flagged (Open Question #1) not implemented; XISF frames correctly return `null` for now.
- **Any new `FrameMetadata` field** (e.g. `siteLatDeg`, a canonical gain-scale field) — a P1-01/P1-02 concern.
- **P1-04** (frame classification) — unmerged sibling; not read, imported, depended on, or duplicated.
- **DD-005** filter/target normalization (`'S2'`→SII, `'UV/IR'`→L).
- **Any DB column or persistence** of the detected profile id — no schema change proposed.
- **Community-extensibility mechanics** beyond "add a file + a registry line" — no plugin loader, no user-editable profile JSON; DD-004's "community-extensible in later versions" ships here as the v1 in-repo, statically-typed registry only.

## Evidence the Coder Must Produce in the PR Description

- [ ] The detection-assertion counts, stated explicitly and matching the corpus:
  - FITS program fixtures detected: **27** (nina 6, sgpro 5, apt 4, sharpcap 4, asistudio 4, voyager 4).
  - FITS edge fixtures → `null`: **6**.
  - Valid XISF fixtures → `null`: **3** (`pixinsight-unit-mono-ha`, `nina-unit-mono-oiii`, `minimal-unit`).
  - Valid RAW fixtures → `null`: **4** (`cr2`, `cr3`, `nef`, `arw`).
  - Total detection assertions ≥ **40**.
- [ ] Confirmation the **no-per-software-branching source-scan test** in `detect.test.ts` exists and passes, named explicitly.
- [ ] Named test cases proving the required behaviors, at minimum: the SGPro `ANGLE`→`rotatorAngleDegrees` fixture-driven before/after case (`apply.test.ts`); the four literal-object SGPro fixup cases (`profiles/sgpro.test.ts`); the `null`-profile same-reference (`toBe`) pass-through; the zero-fixup `toStrictEqual` no-op cases.
- [ ] The layering grep result (`packages/core/src/capture-profiles/` — no `fs`/`node:fs`/`electron` in any production file, only in `*.test.ts`) noted as evidence for the DD-002 criterion.
- [ ] Confirmation commands, all shown green:
  - `pnpm --filter @astrotracker/core test`
  - `pnpm --filter @astrotracker/core build`
  - `pnpm --filter @astrotracker/core lint`
  - (or the root equivalents `pnpm -r test` / `pnpm -r build` / `pnpm -r lint`)

## Notes on Plan ↔ Issue Alignment (for Reviewer awareness — not defects)

- **The issue body's illustrative quirks do not all manifest in the corpus.** The issue names "e.g., APT temperature keyword, SharpCap gain conventions" as examples of quirk fixes. The plan's fixture-byte review found that **neither** is a correctable defect in the committed P0-06 corpus (APT uses standard `CCD-TEMP`; SharpCap/ASIStudio `GAIN` has no canonical unit to convert into). Rather than invent fixups to hit a count, the plan ships **one** genuine, fixture-verified fixup (SGPro `ANGLE`→`rotatorAngleDegrees`) and documents the rejected quirks as inline comments. The "e.g." phrasing is illustrative, not a required-fixup list; the issue's actual AC ("quirk mappings tested per software") is met by testing each program's detection plus the one real quirk, with the rejected quirks explicitly recorded. Reviewer should not flag the absence of an APT-temperature or SharpCap-gain fixup as a gap.
- **The issue names `PROGRAM` as a possible fingerprint field; no committed fixture uses it.** The registry design special-cases no field name — each profile's `detect` is free to check `SWCREATE`, `CREATOR`, a future `PROGRAM`, or several — so a future `PROGRAM`-keyed profile needs no dispatcher change. Not a deviation.
- **`ASIStudio` and `ASIAIR` are bundled under one `asiair-asistudio` profile** (`startsWith('ZWO ASI')`), matching how the task-breakdown and P0-06 fixtures already treat them as one program. The issue text mentions "ASIStudio"; the single-profile treatment is intentional.
- **XISF and RAW frames returning `null` is the correct v1 outcome, not a missing feature.** XISF software fingerprinting is currently _impossible_ (no software-id FITSKeyword in either fixture; native `<Property>` elements not preserved into `headers`) — the plan's Open Question #1, needing a product/research call, not a Reviewer decision. RAW frames have no coherent capture-software concept (camera-firmware-written). Both are asserted as correct `null` outcomes with explanatory comments.
- **Whether detected software identity is ever persisted/surfaced** (e.g. an Equipment screen) is the plan's Open Question #2 — DD-003 has no column and this issue's AC does not require persistence. Flagged as a possible future DD-003 revision, not blocking.

Spec written: docs/specs/p1-05-capture-software-profiles.md
