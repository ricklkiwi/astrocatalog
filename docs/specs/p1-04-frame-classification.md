# Spec: [P1-04] Frame classification (type detection)

**Slug:** p1-04-frame-classification **Issue:** #12 **Plan:** docs/plans/p1-04-frame-classification.md **Date:** 2026-07-19
**Governing DDs:** DD-004 (scanning pipeline — classification order), DD-003 (schema — `frames.frame_type` / `frames.frame_type_source` enums, already migrated by P0-04)

## Scope

This issue delivers one pure, format-agnostic function, `classifyFrame(metadata: FrameMetadata, filePath: string): ClassificationResult`, plus its supporting data tables, all under a new `packages/core/src/classification/` domain folder. It maps a parsed `FrameMetadata` (from any of the P1-01/02/03 parsers) plus a file path to a `{ frameType, frameTypeSource }` result following DD-004's classification order: `IMAGETYP` header → path-segment heuristics → `unknown`. It ships a normalized IMAGETYP lexeme table (with `normalizeImageType()` + `matchImageType()`), an ordered word-boundary-safe path-heuristic table (`matchPath()`), the orchestrator, table-driven tests, and a public export from the package root.

It does **not** deliver: P1-07 pipeline/worker wiring or any `frames` row writes; P1-05 capture-software profile detection (SWCREATE/CREATOR fingerprinting); any `packages/db` schema, column, migration, or CHECK-constraint change; the P1-16 "Needs review" UI or the manual-override (`frame_type_source = 'manual'`) plumbing; P1-20 calibration matching / `master_frames` population; and any new binary fixture. See **Non-Goals** below (copied from the plan's Out of Scope).

## Public API Contract

Reviewer checks each item against the actual diff; signatures and union members must match **exactly** (not merely be supersets).

- [ ] `packages/core/src/classification/types.ts` exports these three symbols, exactly:
  - [ ] `export type FrameType = 'light' | 'dark' | 'flat' | 'bias' | 'darkflat' | 'unknown';` — all six members, no more, no fewer; matches the DD-003 `frames.frame_type` CHECK constraint verbatim (`packages/db/src/schema/frames.ts`: `IN ('light', 'dark', 'flat', 'bias', 'darkflat', 'unknown')`).
  - [ ] `export type FrameTypeSource = 'header' | 'path_heuristic';` — exactly these two members. It is a strict subset of DD-003's persisted 3-value enum (`'header' | 'path_heuristic' | 'manual'`); `'manual'` must **not** appear, because this pure function never emits it (it is applied later by explicit user action).
  - [ ] `export interface ClassificationResult { frameType: FrameType; frameTypeSource: FrameTypeSource; }` — exactly two fields, named `frameType` and `frameTypeSource` (camelCase, matching the `frames` table columns in `packages/db/src/schema/frames.ts`), with those types. No extra diagnostic/"which token matched" field.
- [ ] `classifyFrame` has signature `classifyFrame(metadata: FrameMetadata, filePath: string): ClassificationResult` — it takes the full shared `FrameMetadata` object (imported from `../fits/metadata.js` / re-exported by core), **not** a FITS-specific header type and **not** a bare `string | null` projection.
- [ ] `packages/core/src/index.ts` gains a classification export block equivalent to:
  ```ts
  export {
    classifyFrame,
    type ClassificationResult,
    type FrameType,
    type FrameTypeSource,
  } from './classification/index.js';
  ```
  All four names are reachable from the package root (`@astrotracker/core`) with no deep import path. The `.js` extension on the specifier is present (ESM/NodeNext convention already used throughout `index.ts`).
- [ ] `packages/core/src/classification/index.ts` (barrel) re-exports `classifyFrame` and the three types from the module's internal files.

### Internal (non-root) helper contracts — required to exist for the unit tables to assert against

- [ ] `normalizeImageType(raw: string | null): string | null` exists in `imagetyp-table.ts`.
- [ ] `matchImageType(raw: string | null): FrameType | null` exists in `imagetyp-table.ts` and returns `null` on a table miss (never `'unknown'` — `'unknown'` is only produced by the orchestrator).
- [ ] `matchPath(filePath: string): FrameType | null` exists in `path-heuristics.ts` and returns `null` when no rule fires.

## Behavioral Contract / Acceptance Criteria

Each item is independently checkable against the diff.

### IMAGETYP mapping table (issue AC: "≥ 40 IMAGETYP variants")

- [ ] `packages/core/src/classification/imagetyp-table.test.ts` is table-driven (one `it.each`/`test.each` over a literal case array). Reviewer counts the rows in that case array and confirms the count is **≥ 40** (plan enumerates 47).
- [ ] Spot-check: a sample of rows matches the plan's enumerated table (docs/plans §"≥40 tested IMAGETYP input variants"), e.g. `LIGHT`→light, `Light Frame`→light, `masterDark`→dark, `MASTER DARK`→dark, `Master Flat`→flat, `BIAS`→bias, `DARKFLAT`→darkflat, `Dark-Flat`→darkflat, `Dark_Flat`→darkflat, `Master Dark Flat`→darkflat.
- [ ] Master-frame values map to the **base** type, not a separate master enum: `masterDark`/`MasterDark`/`Master Dark`/`MASTER DARK` → `dark`; `MasterFlat`/`Master Flat` → `flat`; `masterBias`/`'Master Bias'` → `bias`; `Master Dark Flat`/`MASTERDARKFLAT` → `darkflat`. There is no `'master'`-flavored `FrameType` value anywhere (DD-003 alignment; master/non-master lives only in the separate `master_frames` table, P1-20).
- [ ] MaxIm DL / CCDSoft phrasing has its own entries (does not fall out of case-folding alone): `Light Frame`→light, `Dark Frame`→dark, `Flat Field`→flat, `Bias Frame`→bias, all present and passing.
- [ ] `matchImageType` reads its lookup from a module-level constant table built once (not rebuilt per call).

### Path-pattern heuristic table (issue AC: "≥ 20 path patterns")

- [ ] `packages/core/src/classification/path-heuristics.test.ts` is table-driven. Reviewer counts the rows and confirms **≥ 20** (plan enumerates 26).
- [ ] Spot-check: sample rows match the plan's enumerated table (docs/plans §"≥20 tested path patterns"), e.g. `/data/M31/2026-01-15/lights/frame_001.fits`→light, `/data/calibration/darks/…`→dark, `/data/calibration/flats/flat_L_001.fits`→flat, `/data/calibration/biases/bias_001.fits`→bias, `/data/calibration/darkflats/…`→darkflat.
- [ ] Singular and plural directory segments both match (`/light/`↔`/lights/`, `/dark/`↔`/darks/`, `/flat/`↔`/flats/`, `/bias/`↔`/biases/`).
- [ ] Filename-embedded tokens match without a dedicated directory: `/data/M42/2026-02-02/flat_L_001.xisf` → flat (DD-004's `_flat_` example shape).

### Precedence / fallback algorithm

- [ ] A recognized IMAGETYP header **short-circuits** and path heuristics are not consulted: `classify.test.ts` proves `imageType: 'LIGHT'` with a `filePath` containing `/darks/` → `{ frameType: 'light', frameTypeSource: 'header' }` (header wins even when the path disagrees).
- [ ] An **unrecognized-but-present** header falls through to path heuristics — it is **not** immediately `unknown`: `classify.test.ts` proves an unrecognized `imageType` (e.g. `'TEST FRAME'`) **with** a matching path resolves via that path (`frameTypeSource: 'path_heuristic'`), not `unknown`. This must be a distinct assertion from the table-miss/no-path case.
- [ ] Empty-string and whitespace-only headers are treated identically to `null` (absent), falling through to path: `classify.test.ts` proves `imageType: ''` and `imageType: '   '` both behave like `null`. `normalizeImageType()` returns `null` for these before any table lookup.
- [ ] Final fallback is `unknown` attributed to `path_heuristic`: when neither stage matches, the result is exactly `{ frameType: 'unknown', frameTypeSource: 'path_heuristic' }` (not `'header'`, and there is deliberately no fourth "none" source value — plan Open Question #1).
- [ ] `frameTypeSource: 'header'` is emitted **only** when the IMAGETYP table produces a match; every path-derived result and the terminal `unknown` carry `'path_heuristic'`.

### Ambiguous → `unknown`, never guessed silently (issue AC)

- [ ] A concrete, explicit assertion exists: an unrecognized IMAGETYP **and** no path signal → `{ frameType: 'unknown', frameTypeSource: 'path_heuristic' }`. Reviewer confirms this is a literal assertion in `classify.test.ts` (not inferable only via the union of two separate cases). The expected value is exactly `'unknown'` — no other frame type is produced from thin evidence.

### PixInsight single-quote quirk

- [ ] A concrete test case covers `imageType: "'Master Bias'"` (literal wrapping single quotes) classifying identically to the unquoted `Master Bias` → `bias`. Present in both `imagetyp-table.test.ts` (row-level, via `matchImageType`) and `classify.test.ts` (end-to-end).
- [ ] `classify.test.ts` also proves the quirk combined with a conflicting path (`imageType: "'Master Bias'"`, path containing `/lights/`) still resolves to `bias`/`header` — quotes are stripped, the value is recognized, and header precedence holds.
- [ ] `normalizeImageType()` strips exactly one leading and one trailing `'` only when **both** are present, with trimming before and after, so `" 'LIGHT' "` normalizes to `LIGHT`.

### Windows path handling

- [ ] Backslash-separated paths classify identically to their forward-slash equivalents: `path-heuristics.test.ts` includes `C:\Astro\M42\2026-02-02\LIGHT\frame_002.fits` → light. `matchPath()` replaces all `\` with `/` before matching (no POSIX-separator assumption; CI runs the 3-OS matrix).

### Word-boundary safety (negative controls)

- [ ] Negative-control tests exist and pass proving no false positives from embedded substrings: `starlight` does not match `light`, `flatiron` does not match `flat`, `biassing` does not match `bias`. Plan rows 22–24: `/data/M31/starlight_project/…`, `/data/M31/flatiron_survey/…`, `/data/M31/biassing_test/…` all → `unknown`. Boundary set is start/end-of-string or one of `/ _ - .`.

### RAW-frame case (`imageType` always `null`)

- [ ] With `imageType: null` (the P1-03 RAW invariant) **and** a path signal, classification proceeds via path: `classify.test.ts` proves `imageType: null` + a matching path → the path's type with `frameTypeSource: 'path_heuristic'`. `path-heuristics.test.ts` row 20 (`/data/raw/bias_g100_001.cr2`) → bias covers the path-signal side.
- [ ] With `imageType: null` **and** no path signal → `{ frameType: 'unknown', frameTypeSource: 'path_heuristic' }`.

### darkflat-before-dark ordering & multi-signal precedence

- [ ] `dark_flat` / `dark-flat` / concatenated `darkflat` segments resolve to `darkflat`, not `dark` — the darkflat rule is checked before the bare `dark` rule. Plan rows 9–11 and row 25 (`…/DarkFlat_Library/master_darkflat_-10C.fits` → darkflat) cover this; all pass.
- [ ] When one path contains two type-indicating segments, the **deepest** (closest to the filename) wins: plan row 26 `/data/M31/2026-01-15/lights/darks/frame_008.fits` → dark (deeper `darks` beats shallower `lights`).
- [ ] `masters/`, `master_`, `master-` path tokens are noise (match no rule) and require no special-case code: plan rows 12–15 (`…/masters/dark/master_dark_-10c.fits` → dark, etc.) pass by virtue of the inner `dark`/`flat`/`bias`/`darkflat` segment, not a `masters` rule.

### Purity (no I/O)

- [ ] `classifyFrame()` and every helper are pure over their arguments — no filesystem access, no I/O, no writes. Reviewer verifies mechanically: `grep -rE "(^|[^a-zA-Z])(node:)?fs\b|require\(['\"](node:)?fs|from ['\"](node:)?fs" packages/core/src/classification/` returns **no matches**, and there are no `electron`, network, or other side-effecting imports anywhere under `packages/core/src/classification/`. The function operates only on the passed `FrameMetadata` object and the path string.

## Non-Functional / Repo-Rule Conformance

- [ ] **TypeScript strict:** compiles under the repo's strict config with no errors.
- [ ] **No untagged `any`:** no `any` in the diff without a `// justified:` comment (CLAUDE.md convention); the classification code is expected to need none.
- [ ] **Layering (DD-002):** all new logic is in `packages/core`, pure TypeScript, with no Electron imports and no fs side effects (covered by the Purity grep above).
- [ ] **DB (DD-003):** N/A — no new table, column, or migration. `ClassificationResult`'s two fields are a strict subset of the already-migrated `frames.frame_type` / `frames.frame_type_source` CHECK-constrained enums, so P1-07 can insert the result with no translation layer. Reviewer confirms `packages/db` is untouched by this diff.
- [ ] **UUIDv7 / `updated_at` / UTC timestamps:** N/A — this issue introduces no table and handles no timestamps.
- [ ] **Performance (PRD §8.4):** `classifyFrame()` is synchronous and allocation-light — the IMAGETYP table and path regexes are module-level constants built once, not per call. No dynamic table construction inside the function body. (Benchmarking is P1-07's concern; not blocking here.)
- [ ] **All existing tests still pass:** no other `packages/core` (or any package's) tests regress.
- [ ] `pnpm --filter @astrotracker/core build` (`tsc -p tsconfig.json`) exits 0. Root equivalent: `pnpm -r build`.
- [ ] `pnpm --filter @astrotracker/core lint` (`eslint src && prettier --check src`) exits 0. Root equivalent: `pnpm -r lint`.
- [ ] `pnpm --filter @astrotracker/core test` (`vitest run --dir src`) exits 0 with all three new test files green. Root equivalent: `pnpm -r test`.

## File-by-File Expected Diff

All paths are new unless marked *modified*. Reviewer confirms each runtime file is placed exactly where the plan says (new top-level `classification/` folder, parallel to `fits/`, `xisf/`, `raw/` — **not** nested under `catalog/`).

- [ ] `packages/core/src/classification/types.ts` — new; `FrameType`, `FrameTypeSource`, `ClassificationResult` exactly per the Public API Contract.
- [ ] `packages/core/src/classification/imagetyp-table.ts` — new; `normalizeImageType()`, `matchImageType()`, and the module-level lexeme→`FrameType` table (≥21 canonical lexemes covering all 5 non-`unknown` types, MaxIm "Frame"/"Field" phrasing, and `MASTER*` variants folding to base type).
- [ ] `packages/core/src/classification/imagetyp-table.test.ts` — new; table-driven, ≥40 rows, asserting `matchImageType(raw)` directly.
- [ ] `packages/core/src/classification/path-heuristics.ts` — new; `matchPath()` with separator normalization, lowercasing, the 5 ordered word-boundary-safe rules (darkflat first), deepest-segment-wins precedence.
- [ ] `packages/core/src/classification/path-heuristics.test.ts` — new; table-driven, ≥20 rows, including the 3 negative controls, the Windows path, the RAW/`.cr2` path, the `masters/` nesting cases, and the multi-signal precedence case; asserts `matchPath(path)` directly.
- [ ] `packages/core/src/classification/classify.ts` — new; `classifyFrame()` orchestrator implementing the precedence/fallback algorithm exactly.
- [ ] `packages/core/src/classification/classify.test.ts` — new; precedence/integration/edge-case tests per the "Test plan" (header-wins-over-path, RAW-null variants, empty/whitespace-as-absent, unrecognized-header-falls-through, fully-ambiguous→unknown, quote-quirk-with-conflicting-path, plus a handful of fixture-derived byte strings re-asserted through the full entry point).
- [ ] `packages/core/src/classification/index.ts` — new; barrel exporting `classifyFrame` + the three types.
- [ ] `packages/core/src/index.ts` — *modified*; adds the four-name classification export block from `./classification/index.js`. No other export block is altered or removed.

## Non-Goals (copied from plan's Out of Scope — do not flag these as gaps)

- **P1-05** — capture-software profile table / software detection via SWCREATE/CREATOR fingerprints. `classifyFrame()` normalizes IMAGETYP vocabulary generically and does not detect which program produced a file.
- **P1-07** — wiring `classifyFrame()` into the worker pipeline, writing `frames` rows, batching, error isolation. This issue ships only the pure function and its exports.
- **Any `packages/db` schema/migration change** — none needed; DD-003's `frame_type` / `frame_type_source` columns and CHECK constraints already accept every value this function can produce.
- **P1-16** — the "Needs review" UI for `unknown`-classified frames and the manual-override plumbing that sets `frame_type_source = 'manual'`.
- **P1-20** — calibration matching / `master_frames` population. Recognizing that `masterDark` implies dark-type data is in scope; deciding a frame is *the* master for a rig/session is not.
- **A new `fixtures/xisf` binary fixture for the PixInsight quote quirk** — explicitly unnecessary here (tests use literal `FrameMetadata`-shaped objects, matching the `metadata.test.ts` convention); flagged as a possible P0-06-maintainers follow-up only.
- **`bench/src/lib/seed-db.ts`'s placeholder `FRAME_TYPE_BY_IMAGETYP` map** — untouched by this issue; not part of any acceptance criterion here.

## Evidence the Coder Must Produce in the PR Description

- [ ] The two counted row totals, stated explicitly:
  - `imagetyp-table.test.ts: N rows, N ≥ 40` (plan target 47).
  - `path-heuristics.test.ts: N rows, N ≥ 20` (plan target 26).
- [ ] Named test cases proving the required behaviors, at minimum: the ambiguous→`unknown` assertion; the PixInsight `'Master Bias'` quote-quirk case; the Windows backslash path case; the three word-boundary negative controls (`starlight`/`flatiron`/`biassing`); the header-wins-over-conflicting-path case; the RAW `imageType: null` with-path and no-path cases.
- [ ] Confirmation commands, all shown green:
  - `pnpm --filter @astrotracker/core test`
  - `pnpm --filter @astrotracker/core build`
  - `pnpm --filter @astrotracker/core lint`
  - (or the root equivalents `pnpm -r test` / `pnpm -r build` / `pnpm -r lint`)
- [ ] The Purity grep result (no `fs`/`node:fs`/`electron` under `packages/core/src/classification/`) noted as evidence for the DD-002 layering criterion.

## Notes on Plan ↔ Issue Alignment (for Reviewer awareness — not defects)

- The issue's two literal acceptance criteria ("≥ 40 IMAGETYP variants and ≥ 20 path patterns"; "Ambiguous cases → `unknown`, never guessed silently") are both met and exceeded (47 and 26 rows; an explicit ambiguous→`unknown` assertion is required above).
- The issue's `Depends on: #9 (P1-01)` and its "IMAGETYP mapping table" phrasing originate from FITS being the first parser. The plan deliberately makes `classifyFrame()` **format-agnostic** (takes `FrameMetadata`, not a FITS header) so RAW frames (`imageType` always `null`) can be classified by path — a correctness requirement, not a scope creep. Reviewer should not flag the non-FITS-specific signature as a deviation.
- The plan resolves a genuine DD-004↔DD-003 gap (DD-004's prose lists a terminal `unknown` stage, but DD-003's `frame_type_source` enum has no "neither matched" value) by attributing terminal `unknown` to `'path_heuristic'`. This is the plan's Open Question #1 and should be confirmed by a human maintainer in the PR discussion, not silently settled by the Reviewer.
- MaxIm DL / CCDSoft is not among AstroTracker's six officially-named capture programs, but issue #12's body cites `'Light Frame'` as a variant to support, and that phrasing's real-world origin is MaxIm DL/CCDSoft; its inclusion is the plan's Open Question #2 (harmless extra table entries), flagged for awareness.

Spec written: docs/specs/p1-04-frame-classification.md
