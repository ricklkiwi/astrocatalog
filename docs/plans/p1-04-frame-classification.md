# Plan: [P1-04] Frame classification (type detection)

**Slug:** p1-04-frame-classification **Issue:** #12 **Date:** 2026-07-19
**Governing DDs:** DD-004 (scanning pipeline — classification order rule, header parsing
specifics), DD-003 (database schema — `frames.frame_type` / `frames.frame_type_source`
enums, already migrated by P0-04; this issue produces values, it does not change schema)
**Status:** READY_FOR_SPEC

## Summary

This issue adds a pure function, `classifyFrame()`, to `packages/core` that maps a parsed
`FrameMetadata` (from any of the three P1-01/02/03 parsers) plus a file path to a
`{ frameType, frameTypeSource }` result, per DD-004's classification order: `IMAGETYP`
header → path-segment heuristics → `unknown`. It is table-driven: a normalized IMAGETYP
lexeme table (≥40 tested input variants across N.I.N.A., SGPro, APT, SharpCap, ASIStudio,
Voyager, MaxIm DL/CCDSoft phrasing, and PixInsight/WBPP conventions, including the real-world
PixInsight single-quote-baked-in quirk) and an ordered, word-boundary-safe path-segment rule
table (≥20 tested path patterns). Ambiguous or unrecognized values never guess silently — they
either fall through to the next stage or land on `unknown`.

### Architecture decision: `classifyFrame()` is format-agnostic

`classifyFrame(metadata: FrameMetadata, filePath: string): ClassificationResult` — it takes the
shared `FrameMetadata` shape (from `packages/core/src/fits/metadata.ts`, re-exported by all
three parsers) plus the file's path, **not** a FITS-specific header type.

Reasoning:

- Issue #12's `Depends on: #9 (P1-01)` and its "IMAGETYP mapping table" phrasing only reflect
  that FITS was the first parser to exist and IMAGETYP is where the concept originates — the
  dependency graph does not say "FITS-only." Nothing in DD-004's classification-order rule
  scopes it to FITS.
- All three P1-01/02/03 parsers were deliberately built to normalize into one shared
  `FrameMetadata` type specifically so downstream Stage 3 logic (classification, target
  resolution, filter normalization — DD-004) is format-agnostic. Coupling `classifyFrame()` to
  a FITS-specific header shape would contradict the reason that convergence exists.
  `packages/core/src/xisf/metadata.ts` and `packages/core/src/raw/metadata.ts` both confirm
  this: they import `FrameMetadata` from `../fits/metadata.js` and produce the identical shape.
- RAW frames have `imageType: null` **always** — `packages/core/src/raw/metadata.ts`'s own
  doc comment states EXIF carries no IMAGETYP-equivalent, "resolved later by Stage 3 path
  heuristics." If `classifyFrame()` took a FITS-specific type, RAW frames could never be
  classified by path at all — a straightforward correctness gap for an app whose PRD explicitly
  covers DSLR/mirrorless RAW capture.
- Taking the full `FrameMetadata` object (not just a bare `imageType: string | null`
  parameter) rather than a narrower projection keeps the signature stable if a future
  refinement needs another field (e.g. distinguishing OSC vs. mono via `bayerPattern` for a
  smarter heuristic) without a breaking change, and matches what the P1-07 pipeline will
  already be holding post-parse (no extra destructuring at the call site).

This is a confident call, not a coin-flip: no DD or fixture data pulls the other way, and the
RAW case makes the FITS-specific alternative actively wrong, not just less elegant.

### Frame-type source quirk: `frame_type_source` has no `unknown`/`none` value

DD-003's schema (confirmed in `packages/db/src/schema/frames.ts`) constrains
`frame_type_source` to exactly `'header' | 'path_heuristic' | 'manual'` — there is **no**
fourth value for "neither stage produced a match." DD-004's prose lists three stages ("IMAGETYP
header → path heuristics → unknown") but only two of those are backed by a source enum value;
`'manual'` is a UI-applied override this pure function never emits. This is a real, if minor,
inconsistency between DD-004's prose and DD-003's already-migrated enum — see **Open
Questions**. This plan's resolution (used throughout, not a silent guess): **path heuristics is
the last automated stage before user resolution, so whatever it produces — a match, or no
match — is what `frame_type_source` records.** `frameTypeSource: 'path_heuristic'` therefore
covers both "classified by path" and the terminal `unknown` case; `'header'` is used only when
the IMAGETYP table produces a match. `classifyFrame()`'s own `FrameTypeSource` type is
therefore `'header' | 'path_heuristic'` — a strict subset of DD-003's persisted 3-value enum,
matching that `'manual'` is applied later by explicit user action (DD-004: "manual overrides
always win and survive rescans"), never by this function.

### PixInsight quote-quirk decision

(a) **Yes, normalization strips wrapping single quotes.** PixInsight-converted XISF files have
been observed in the wild carrying the original FITS single-quote string delimiters baked into
the IMAGETYP *value itself* (e.g. the stored string is literally `'Master Bias'`, quotes
included, not `Master Bias`). `packages/core/src/xisf/metadata.ts`'s `toFrameMetadata()` does a
direct pass-through of the `IMAGETYP` FITSKeyword value with no quote-stripping (confirmed by
reading the source — `str(k, 'IMAGETYP')`, nothing more), so if this quirk occurs, the quoted
string reaches `classifyFrame()` unchanged. Stripping is cheap, has no downside for
already-clean values, and is exactly the kind of thing a normalization step should own rather
than pushing back onto P1-02 (which has already merged and correctly treats IMAGETYP as an
opaque string).

(b) **No new fixture is added.** As of this plan, no committed fixture demonstrates the quirk
(`fixtures/xisf/pixinsight-unit-mono-ha.xisf` has a clean `IMAGETYP="LIGHT"`, verified by
reading its manifest entry and the XML directly). `classifyFrame()`'s own tests operate on
literal `FrameMetadata`-shaped inputs, not binary fixtures — this matches the established
convention already used by `packages/core/src/fits/metadata.test.ts` and
`packages/core/src/xisf/metadata.test.ts`, which construct header/keyword objects directly
rather than reading fixture files (fixture-integration coverage lives in the separate
`fixtures.test.ts` files per domain). A literal test case
`{ ...metadata, imageType: "'Master Bias'" }` exercises the quirk exactly as thoroughly as a
binary fixture would, without pulling `fixtures/` (a separate workspace package with its own
generator/manifest-schema pipeline, P0-06) into this `pkg:core`-only issue's scope. Flagged as
a documented follow-up, not done here: fixtures maintainers could add a
`pixinsight-quoted-imagetyp.xisf` + manifest entry later for end-to-end (XISF-parse →
classify) integration coverage — see **Out of Scope**.

## Module layout

New top-level domain folder `packages/core/src/classification/`, parallel to `fits/`, `xisf/`,
`raw/` (not nested under a `catalog/` folder — DD-005 and DD-006 explicitly reserve
`packages/core/catalog` for target-resolution and filter-normalization algorithms that consult
the bundled OpenNGC catalog asset; frame-type classification has no external catalog
dependency, it is a self-contained string/path lookup consumed directly by P1-07, so it gets
its own domain folder rather than being folded into `catalog/`):

```
packages/core/src/classification/
  types.ts                    # FrameType, FrameTypeSource, ClassificationResult
  imagetyp-table.ts           # normalizeImageType() + the lexeme table + matchImageType()
  imagetyp-table.test.ts      # ≥40-row table-driven test
  path-heuristics.ts          # matchPath() + the ordered word-boundary rule table
  path-heuristics.test.ts     # ≥20-row table-driven test
  classify.ts                 # classifyFrame() orchestrator (precedence algorithm)
  classify.test.ts            # precedence/integration + edge cases
  index.ts                    # barrel export
```

Three implementation files (rather than one) mirrors the granularity already used by `fits/`
and `xisf/` (each splits `parse.ts` from `metadata.ts`) — IMAGETYP-table matching and
path-heuristic matching are independent, separately-testable concerns that `classify.ts` only
composes.

## Classification result type

```ts
/** DD-003 frames.frame_type CHECK constraint, exactly. */
export type FrameType = 'light' | 'dark' | 'flat' | 'bias' | 'darkflat' | 'unknown';

/**
 * Subset of DD-003's persisted frame_type_source enum
 * ('header' | 'path_heuristic' | 'manual') that classifyFrame() can produce.
 * 'manual' is applied later, only by explicit user action in the UI/DB layer
 * (DD-004: "manual overrides always win and survive rescans") — this pure
 * function never emits it.
 */
export type FrameTypeSource = 'header' | 'path_heuristic';

export interface ClassificationResult {
  frameType: FrameType;
  frameTypeSource: FrameTypeSource;
}
```

Field names (`frameType`, `frameTypeSource`) deliberately match the camelCase column names in
`packages/db/src/schema/frames.ts` (`frameType`, `frameTypeSource`) so P1-07's pipeline can
spread `classifyFrame(...)`'s result directly into a `frames` insert without renaming. No extra
diagnostic fields (e.g. "which token matched") are added to the public result — DD-003 persists
only these two columns, and test coverage for *why* a result was produced comes from the
table-driven test cases themselves, not a runtime-visible field.

## Precedence / fallback algorithm

```
classifyFrame(metadata, filePath):
  headerType = matchImageType(metadata.imageType)     # null | FrameType
  if headerType !== null:
    return { frameType: headerType, frameTypeSource: 'header' }

  pathType = matchPath(filePath)                       # null | FrameType
  if pathType !== null:
    return { frameType: pathType, frameTypeSource: 'path_heuristic' }

  return { frameType: 'unknown', frameTypeSource: 'path_heuristic' }
```

Decisions, stated precisely per the issue's "ambiguous → unknown, never guessed silently"
criterion:

- **A header match always short-circuits.** This is a strict fallback *chain*, not a vote
  between header and path — if IMAGETYP maps to `light` but the file's path contains
  `/darks/`, the result is `light`/`header`; path heuristics are not even computed. This
  reading matches DD-004's literal wording ("IMAGETYP header → path heuristics → unknown" is an
  ordered chain) and avoids inventing a disagreement-resolution policy the issue never asked
  for. A conflicting path is far more likely to be stale/reused folder structure (e.g. darks
  captured into a folder originally set up for lights) than a wrong header — trusting the more
  structured, machine-written signal over an inferred one is the safer default.
- **An unrecognized-but-present IMAGETYP falls through to path heuristics — it is not
  immediately `unknown`.** "Ambiguous → unknown" is about not *guessing* a type from thin
  evidence, not about refusing to consult the next well-defined stage in the chain. Path
  heuristics are themselves a deterministic, non-guessing rule set (exact/bounded token
  matches, no fuzzy scoring) — consulting them for a custom or unrecognized capture program is
  exactly what "path heuristics" is *for*. Only after both stages produce no match does the
  frame become `unknown`.
- **Empty string and whitespace-only IMAGETYP are treated identically to `null`** (i.e., as "no
  header signal," not as "an unrecognized non-empty value") — `normalizeImageType()` returns
  `null` for these before the table lookup even runs, so they fall through to path heuristics
  like any absent header.

## IMAGETYP normalization + mapping table

`normalizeImageType(raw: string | null): string | null`:

1. `null` → `null` (RAW frames always hit this branch).
2. Trim leading/trailing whitespace.
3. Strip one leading and one trailing `'` character if both are present (PixInsight
   quote-quirk).
4. Trim again (handles `" 'LIGHT' "` — outer whitespace, then quotes, then any inner padding).
5. Replace `_` and `-` with a single space (folds `DARK_FLAT`, `Dark-Flat` onto the same
   normalized form as `DARK FLAT`; a delimiter-free `DARKFLAT` stays its own lexeme since there
   is nothing to replace).
6. Collapse runs of whitespace to one space.
7. Uppercase.
8. If the result is `''`, return `null` (whitespace-only original value).

`matchImageType(raw)` normalizes, then does an exact lookup in a module-level
`Record<string, FrameType>` table (built once, not per call — relevant to the PRD §8.4 10k-file
budget). Returns `null` on a table miss.

**Mapping table** (canonical normalized lexeme → `FrameType`; casing/delimiter variants below
all fold to one of these through the normalization above):

| Normalized lexeme  | → FrameType | Notes                                      |
| ------------------- | ----------- | ------------------------------------------- |
| `LIGHT`             | light       | N.I.N.A./Voyager/edge fixtures (`LIGHT`); APT/SGPro/SharpCap/ASIStudio fixtures fold here too (`Light`) |
| `LIGHT FRAME`        | light       | MaxIm DL / CCDSoft convention (also the issue's own cited example) |
| `LIGHTFRAME`         | light       | defensive no-delimiter variant |
| `DARK`               | dark        | N.I.N.A./Voyager fixtures (`DARK`); APT/SGPro/SharpCap/ASIStudio fixtures fold here too (`Dark`) |
| `DARK FRAME`         | dark        | MaxIm DL |
| `DARKFRAME`          | dark        | defensive |
| `MASTERDARK`         | dark        | issue's own cited example; "master-ness" doesn't change `frame_type` — see below |
| `MASTER DARK`        | dark        | |
| `FLAT`               | flat        | N.I.N.A./Voyager fixtures (`FLAT`); APT/SGPro/SharpCap/ASIStudio fixtures fold here too (`Flat`) |
| `FLAT FIELD`         | flat        | MaxIm DL |
| `FLATFIELD`          | flat        | defensive |
| `MASTERFLAT`         | flat        | |
| `MASTER FLAT`        | flat        | |
| `BIAS`               | bias        | N.I.N.A. fixture (`BIAS`) |
| `BIAS FRAME`         | bias        | MaxIm DL |
| `BIASFRAME`          | bias        | defensive |
| `MASTERBIAS`         | bias        | |
| `MASTER BIAS`        | bias        | PixInsight quote-quirk example (`'Master Bias'`) strips to this |
| `DARKFLAT`           | darkflat    | |
| `DARK FLAT`           | darkflat    | (also reached from `Dark_Flat`/`Dark-Flat` via delimiter folding) |
| `MASTERDARKFLAT`      | darkflat    | |
| `MASTER DARK FLAT`    | darkflat    | |

Recognizing `MASTERDARK`/`Master Bias`/etc. maps to the **base** `frame_type` (`dark`, `bias`,
…), not a separate "master" value — DD-003's `frame_type` enum has no master variant; the
master/non-master distinction lives entirely in the separate `master_frames` table
(`master_type: 'dark'|'flat'|'bias'|'darkflat'`), populated later by calibration-matching logic
(P1-20), which is out of scope here.

### ≥40 tested IMAGETYP input variants

Every row is a distinct byte string fed to `classifyFrame()`'s test via a literal
`FrameMetadata`-shaped object; expected result noted. Sourced from real fixture bytes (verified
by reading `fixtures/fits/**/*.fits` directly — `strings`-dumped and cross-checked against
`fixtures/xisf/manifest.json`) plus documented MaxIm DL/CCDSoft and PixInsight/WBPP
conventions and the issue's own cited examples.

| # | Raw IMAGETYP value | Origin | Expected |
|---|---|---|---|
| 1 | `LIGHT` | fixture: nina, voyager, edge/malformed set | light |
| 2 | `Light` (trailing-space-trimmed) | fixture: apt, sgpro, sharpcap, asistudio | light |
| 3 | `light` | defensive lowercase | light |
| 4 | `  LIGHT  ` | defensive whitespace padding | light |
| 5 | `Light Frame` | MaxIm DL/CCDSoft; issue's cited example | light |
| 6 | `LIGHT FRAME` | MaxIm DL casing variant | light |
| 7 | `LightFrame` | defensive no-space | light |
| 8 | `Light_Frame` | defensive underscore | light |
| 9 | `Light-Frame` | defensive hyphen | light |
| 10 | `'LIGHT'` | PixInsight quote-quirk | light |
| 11 | `DARK` | fixture: nina, voyager | dark |
| 12 | `Dark` | fixture: apt, sgpro, sharpcap, asistudio | dark |
| 13 | `dark` | defensive lowercase | dark |
| 14 | `Dark Frame` | MaxIm DL | dark |
| 15 | `DARK FRAME` | MaxIm DL casing variant | dark |
| 16 | `DarkFrame` | defensive | dark |
| 17 | `masterDark` | issue's cited example | dark |
| 18 | `MasterDark` | casing variant | dark |
| 19 | `Master Dark` | spaced variant | dark |
| 20 | `MASTER DARK` | uppercase variant | dark |
| 21 | `FLAT` | fixture: nina, voyager | flat |
| 22 | `Flat` | fixture: apt, sgpro, sharpcap, asistudio | flat |
| 23 | `flat` | defensive lowercase | flat |
| 24 | `Flat Field` | MaxIm DL | flat |
| 25 | `FLAT FIELD` | MaxIm DL casing variant | flat |
| 26 | `FlatField` | defensive | flat |
| 27 | `MasterFlat` | | flat |
| 28 | `Master Flat` | | flat |
| 29 | `BIAS` | fixture: nina | bias |
| 30 | `Bias` | plausible Title-case (no fixture has a Title-case Bias sample; inferred from the same sibling-software convention that produces Title-case Light/Dark/Flat) | bias |
| 31 | `bias` | defensive lowercase | bias |
| 32 | `Bias Frame` | MaxIm DL | bias |
| 33 | `BIAS FRAME` | MaxIm DL casing variant | bias |
| 34 | `masterBias` | | bias |
| 35 | `'Master Bias'` | PixInsight quote-quirk, exact scenario from the issue's known-quirk description | bias |
| 36 | `DARKFLAT` | | darkflat |
| 37 | `DarkFlat` | | darkflat |
| 38 | `Dark Flat` | | darkflat |
| 39 | `DARK FLAT` | | darkflat |
| 40 | `Dark-Flat` | hyphenated | darkflat |
| 41 | `Dark_Flat` | underscored | darkflat |
| 42 | `Master Dark Flat` | | darkflat |
| 43 | `MASTERDARKFLAT` | | darkflat |
| 44 | `TEST FRAME` | unrecognized custom-software value, no path signal in the same test case | unknown (falls through both stages) |
| 45 | `''` (empty after quote-strip, i.e. raw was `"''"`) | defensive | unknown / falls to path (treated as absent) |
| 46 | `null` | RAW frames (P1-03: `imageType` is always `null`) | falls to path (header stage skipped) |
| 47 | `'   '` (whitespace-only) | defensive | falls to path (treated as absent) |

(47 rows — comfortably over the ≥40 minimum, including deliberate negative/fallthrough cases
required by the acceptance criterion's "never guessed silently" wording.)

## Path-segment heuristic design

`matchPath(filePath: string): FrameType | null`:

1. Replace all `\` with `/` (Windows paths from a Windows watch-folder scan reach this
   function as backslash-separated — `packages/core` must not assume POSIX separators; CI runs
   the 3-OS matrix per `CLAUDE.md`).
2. Lowercase the whole string.
3. Apply an **ordered** list of word-boundary-safe regexes against the full normalized path
   (boundary = start/end of string or one of `/ _ - .` — this covers both whole directory
   segments like `/darks/` and filename-embedded tokens like `dark_-10c_300s.fits`, matching
   DD-004's own two example forms `/lights/`, `/darks/` and `_flat_`). Checked in this order,
   first match wins for a given scan position:
   1. `darkflat`/`darkflats` or `dark[ _-]flat[s]?` → `darkflat` (checked first so
      `dark_flat`/`dark-flat` don't get caught by the plain `dark` rule below; a bare
      concatenated `darkflat` never matches the bare `dark` rule anyway since there is no
      boundary between `dark` and `flat` in that token)
   2. `light[s]?` → `light`
   3. `dark[s]?` → `dark`
   4. `flat[s]?` → `flat`
   5. `bias(es)?` → `bias`
4. **Multiple candidate segments in one path (precedence):** scan path segments **deepest
   first** (closest to the filename, working back toward the root) and return the first match.
   Directory structure typically narrows from a broad project/target folder toward a specific
   calibration bucket at the leaf (e.g. `.../M31/lights/darks/frame.fits` — an unusual but
   possible layout if calibration subs were filed under a light-session folder — the `darks`
   segment nearer the file wins over the higher `lights` segment).
5. `masters/`, `master_`, `master-` tokens are **not** matched by any rule above and are
   therefore silently skipped as noise — `masters/dark/master_dark_-10c.fits` still matches
   rule 3 (`dark`) via its `dark` segment; no special-case code is needed for the masters/
   nesting convention.
6. No match anywhere in the path → `null` → `unknown`.

Word-boundary anchoring is what keeps `starlight`, `flatiron`, and `biassing` from
false-positively matching `light`, `flat`, `bias` — none of those substrings sit at a
delimiter/start/end boundary in those words, so the regexes correctly do not fire.

### ≥20 tested path patterns

| # | Path | Notes | Expected |
|---|---|---|---|
| 1 | `/data/M31/2026-01-15/lights/frame_001.fits` | plural segment | light |
| 2 | `/data/M31/2026-01-15/light/frame_001.fits` | singular segment | light |
| 3 | `/data/calibration/darks/dark_-10c_300s_001.fits` | plural segment + filename token both dark | dark |
| 4 | `/data/calibration/dark/dark_001.fits` | singular segment | dark |
| 5 | `/data/calibration/flats/flat_L_001.fits` | plural segment | flat |
| 6 | `/data/calibration/flat/flat_001.fits` | singular segment | flat |
| 7 | `/data/calibration/bias/bias_001.fits` | singular | bias |
| 8 | `/data/calibration/biases/bias_001.fits` | plural | bias |
| 9 | `/data/calibration/darkflats/darkflat_001.fits` | concatenated darkflat segment | darkflat |
| 10 | `/data/calibration/dark_flat/df_001.fits` | underscore-delimited darkflat segment | darkflat |
| 11 | `/data/calibration/dark-flat/df_001.fits` | hyphen-delimited darkflat segment | darkflat |
| 12 | `/data/calibration/masters/dark/master_dark_-10c_300s.fits` | `masters/` noise segment skipped | dark |
| 13 | `/data/calibration/masters/flat/master_flat_L.fits` | masters/ nesting | flat |
| 14 | `/data/calibration/masters/bias/master_bias.fits` | masters/ nesting | bias |
| 15 | `/data/calibration/masters/darkflat/master_darkflat.fits` | masters/ nesting | darkflat |
| 16 | `C:\Astro\M42\2026-02-02\LIGHT\frame_002.fits` | Windows backslashes + uppercase segment | light |
| 17 | `/data/M31/lights_Ha/frame_003.fits` | delimiter-bounded prefix token in a compound segment | light |
| 18 | `/data/sessions/2026-01-15/DARK_-10C/frame.fits` | uppercase segment with trailing detail | dark |
| 19 | `/data/M42/2026-02-02/flat_L_001.xisf` | no dedicated directory — filename-embedded token (DD-004's `_flat_` example shape) | flat |
| 20 | `/data/raw/bias_g100_001.cr2` | RAW frame, `imageType` always `null` — path is the *only* signal | bias |
| 21 | `/data/M31/2026-01-15/frame_004.fits` | no type-indicating segment anywhere | unknown |
| 22 | `/data/M31/starlight_project/frame_005.fits` | negative control: `light` substring inside `starlight`, not boundary-matched | unknown |
| 23 | `/data/M31/flatiron_survey/frame_006.fits` | negative control: `flat` substring inside `flatiron` | unknown |
| 24 | `/data/M31/biassing_test/frame_007.fits` | negative control: `bias` substring inside `biassing` (no `es` plural, no boundary after `bias`) | unknown |
| 25 | `/data/M31/2026-01-15/DarkFlat_Library/master_darkflat_-10C.fits` | mixed-case concatenated darkflat, rule 1 must win over rule 3 (`dark`) | darkflat |
| 26 | `/data/M31/2026-01-15/lights/darks/frame_008.fits` | conflicting segments in one path — deepest (`darks`) wins over shallower `lights` | dark |

(26 rows — over the ≥20 minimum, including 3 negative controls proving word-boundary
correctness, a Windows-path case, a RAW/header-null case, a `masters/` nesting case, and a
same-path multiple-signal precedence case.)

## Test plan

- `packages/core/src/classification/imagetyp-table.test.ts` — one `it.each`-style table
  covering all 47 rows above, asserting `matchImageType(raw)` directly (unit-level, below
  `classifyFrame()`).
- `packages/core/src/classification/path-heuristics.test.ts` — one `it.each`-style table
  covering all 26 rows above, asserting `matchPath(path)` directly.
- `packages/core/src/classification/classify.test.ts` — precedence/integration behavior that
  the two unit-level tables above can't exercise in isolation:
  - Header match wins even when the path disagrees (`imageType: 'LIGHT'`,
    `filePath` containing `/darks/`) → `{ frameType: 'light', frameTypeSource: 'header' }`,
    proving path heuristics are not even consulted on a header hit.
  - RAW-style `imageType: null` with a path match → `frameTypeSource: 'path_heuristic'`.
  - RAW-style `imageType: null` with no path signal → `{ frameType: 'unknown', frameTypeSource: 'path_heuristic' }`.
  - `imageType: ''` and `imageType: '   '` both behave identically to `null` (fall to path).
  - Unrecognized-but-present `imageType` (e.g. `'TEST FRAME'`) *with* a matching path still
    resolves via path, not immediately `unknown` — proves the fall-through rule, not just the
    table-miss rule.
  - Fully ambiguous: unrecognized `imageType` and no path signal → `unknown`/`path_heuristic`.
  - PixInsight quote-quirk combined with a conflicting path (`imageType: "'Master Bias'"`,
    path containing `/lights/`) → header still wins once quotes are stripped and recognized.
  - A handful of the literal fixture-derived byte strings (rows 1–2, 11–12, 21–22, 29 of the
    IMAGETYP table above) re-asserted through the full `classifyFrame()` entry point, each
    paired with a plausible realistic path, to close the loop against the real corpus without
    adding a `fixtures/` binary dependency to this package.
- All three files follow the existing colocated-per-implementation-file test convention already
  used by `fits/`, `xisf/`, `raw/` (e.g. `metadata.ts` + `metadata.test.ts`).

## Fixture additions

None. See "PixInsight quote-quirk decision" above for the reasoning — `classifyFrame()`'s tests
operate on literal `FrameMetadata`-shaped objects (matching the `metadata.test.ts` convention
already established in `fits/`, `xisf/`, `raw/`), not binary fixtures, so no new file under
`fixtures/` and no `fixtures/xisf/manifest.json` entry are needed for this issue's acceptance
criteria.

## Public export additions

`packages/core/src/index.ts` gains a new export block (matching the existing per-domain
grouping style):

```ts
export {
  classifyFrame,
  type ClassificationResult,
  type FrameType,
  type FrameTypeSource,
} from './classification/index.js';
```

## Affected Files

- `packages/core/src/classification/types.ts` — new; `FrameType`, `FrameTypeSource`,
  `ClassificationResult`
- `packages/core/src/classification/imagetyp-table.ts` — new; `normalizeImageType()`,
  `matchImageType()`, the lexeme table
- `packages/core/src/classification/imagetyp-table.test.ts` — new; ≥40-row table-driven test
- `packages/core/src/classification/path-heuristics.ts` — new; `matchPath()`, the ordered
  word-boundary rule table
- `packages/core/src/classification/path-heuristics.test.ts` — new; ≥20-row table-driven test
- `packages/core/src/classification/classify.ts` — new; `classifyFrame()` orchestrator
- `packages/core/src/classification/classify.test.ts` — new; precedence/integration/edge-case
  tests
- `packages/core/src/classification/index.ts` — new; barrel export
- `packages/core/src/index.ts` — modified; add the classification export block above

## Implementation Steps

### Step 1 — Classification types + module scaffold

**Outcome:** `packages/core/src/classification/` exists with `types.ts` defining `FrameType`,
`FrameTypeSource`, `ClassificationResult` exactly as specified above, and a barrel `index.ts`
re-exporting them. No classification behavior yet.
**Files:** `packages/core/src/classification/types.ts`,
`packages/core/src/classification/index.ts`
**Depends on:** none

### Step 2 — IMAGETYP normalization + mapping table

**Outcome:** `matchImageType(raw: string | null): FrameType | null` is implemented exactly per
the "IMAGETYP normalization + mapping table" design above (quote-stripping, delimiter folding,
case-folding, module-level constant table, ≥21 canonical lexemes covering all 5 non-`unknown`
frame types plus MaxIm DL "Frame"/"Field" phrasing and `MASTER*`-prefixed variants collapsing to
their base type). `imagetyp-table.test.ts` proves all 47 rows of the enumerated table above.
**Files:** `packages/core/src/classification/imagetyp-table.ts`,
`packages/core/src/classification/imagetyp-table.test.ts`
**Depends on:** Step 1

### Step 3 — Path-segment heuristic

**Outcome:** `matchPath(filePath: string): FrameType | null` is implemented exactly per the
"Path-segment heuristic design" above (separator normalization, lowercasing, the 5
word-boundary-safe rules checked in order with `darkflat` variants first, deepest-segment-wins
precedence, `masters/` noise tokens requiring no special-case code). `path-heuristics.test.ts`
proves all 26 rows of the enumerated table above, including the 3 negative controls.
**Files:** `packages/core/src/classification/path-heuristics.ts`,
`packages/core/src/classification/path-heuristics.test.ts`
**Depends on:** Step 1

### Step 4 — `classifyFrame()` orchestrator

**Outcome:** `classifyFrame(metadata: FrameMetadata, filePath: string): ClassificationResult`
implements the precedence/fallback algorithm above exactly: header match short-circuits;
unrecognized/absent header falls through to path; no match anywhere yields
`{ frameType: 'unknown', frameTypeSource: 'path_heuristic' }`. `classify.test.ts` proves every
scenario listed in "Test plan" above.
**Files:** `packages/core/src/classification/classify.ts`,
`packages/core/src/classification/classify.test.ts`
**Depends on:** Steps 2, 3

### Step 5 — Public export

**Outcome:** `@astrotracker/core` exposes `classifyFrame`, `ClassificationResult`, `FrameType`,
`FrameTypeSource` from the package root (`packages/core/src/index.ts`), consumable by P1-07's
future pipeline wiring without a deep import path.
**Files:** `packages/core/src/index.ts`
**Depends on:** Steps 1–4

## Edge Cases

- PixInsight XISF single-quote-baked-in IMAGETYP quirk (`"'Master Bias'"`) — must classify
  identically to the unquoted form.
- Two conflicting type-indicating segments in the same path (e.g. calibration subs filed under
  a light-session folder) — deepest segment (closest to the filename) wins, by explicit design.
- IMAGETYP present but blank/whitespace-only (a FITS fixed-width string field with only padding
  — distinct from the field being structurally absent) — must be treated identically to `null`,
  not as an unrecognized non-empty value.
- RAW frames: `imageType` is always `null`, never merely absent for one file — path is
  necessarily the *only* signal for every RAW frame in the library (P1-03's own doc comment).
- Unrecognized-but-present IMAGETYP (custom/unlisted capture software) must still fall through
  to path heuristics rather than becoming `unknown` immediately — the acceptance criterion
  "never guessed silently" is about not fabricating a type from weak evidence, not about
  skipping a well-defined deterministic stage.
- Windows-style backslash paths (files scanned from a Windows watch folder; CI runs the 3-OS
  matrix) must classify identically to the equivalent forward-slash path.
- Path segments/filenames that merely *contain* a type word without a delimiter boundary
  (`starlight`, `flatiron`, `biassing`) must never false-positive.
- `masters/<type>/` nested calibration-library folder structures — "master-ness" does not
  change `frame_type`; it is a separate downstream concept (`master_frames.master_type`,
  P1-20), out of scope here, and requires no special-case path-matching code since `masters`
  itself never matches any rule.
- A file path with no calibration/type-indicating segment anywhere (e.g. dumped directly in the
  watch-folder root, or named only by target/date) combined with an absent/unrecognized header
  → `unknown`, never a guess.
- MaxIm DL / CCDSoft's `"Light Frame"`/`"Dark Frame"`/`"Flat Field"`/`"Bias Frame"` phrasing is
  lexically distinct from bare `LIGHT`/`DARK`/`FLAT`/`BIAS` and needs its own table entries —
  it does not fall out "for free" from case-folding alone.

## Invariant Checklist

- [x] Non-destructive: `classifyFrame()` is a pure function over its arguments; no filesystem
      access, no writes, anywhere in `packages/core/src/classification/`
- [x] Layering: new domain logic lives entirely in `packages/core`, pure TypeScript, no
      Electron imports, no `fs` — `classifyFrame()` operates only on an already-parsed
      `FrameMetadata` object and a path string
- [x] DB: N/A — no new tables/columns/migration. `frames.frame_type` and
      `frames.frame_type_source` already exist (P0-04, DD-003); `ClassificationResult`'s two
      fields are typed as a strict subset of those already-migrated CHECK-constrained enums, so
      P1-07 can insert the result directly with no translation layer
- [x] Timestamps stored UTC: N/A — no timestamp handling in this issue
- [x] Long-running work through worker queue: N/A — `classifyFrame()` is synchronous,
      allocation-light (module-level constant tables, no per-call rebuilding), and intended to
      run inline inside P1-07's per-file Stage 3 step, not as its own job
- [x] Performance budgets respected (PRD §8.4): flagged for P1-07's benchmark, not blocking
      here — `classifyFrame()` runs once per file inside the PARSE→RESOLVE stages that must
      complete for 10k files in under the CI-adjusted time budget (DD-004); its implementation
      must stay O(1)-ish per call (string ops + a handful of regex tests against a
      pre-normalized string, no dynamic table construction, no I/O)

## Out of Scope

- **P1-05** (capture-software profile table / software detection via SWCREATE/CREATOR
  fingerprints) — a separate issue; `classifyFrame()` does not need to know which program
  produced a file, since IMAGETYP vocabulary is normalized generically rather than detected
  per-software.
- **P1-07** (wiring `classifyFrame()` into the worker pipeline, writing `frames` rows, batching,
  error isolation) — a separate issue; this plan only ships the pure function and its exports.
- Any `packages/db` schema or migration change — none needed; DD-003's `frame_type` /
  `frame_type_source` columns and CHECK constraints already accept every value this function
  can produce.
- **P1-16**-style "Needs review" UI for `unknown`-classified frames, and the manual-override
  plumbing that eventually sets `frame_type_source = 'manual'` — separate, later issues.
- **P1-20** calibration matching / `master_frames` population — recognizing that an IMAGETYP
  value like `masterDark` implies "this is dark-type calibration data" is in scope; recognizing
  "this specific frame is *the* master for a given rig/session and should get a `master_frames`
  row" is not.
- A new `fixtures/xisf` binary fixture demonstrating the PixInsight quote quirk — explicitly
  decided unnecessary for this issue (see "PixInsight quote-quirk decision"); flagged as a
  possible follow-up for the `fixtures/` (P0-06) maintainers if end-to-end XISF-parse→classify
  integration coverage is later wanted.
- `bench/src/lib/seed-db.ts`'s existing placeholder `FRAME_TYPE_BY_IMAGETYP` map (a small
  4-entry lookup used only to seed synthetic benchmark data) — untouched by this issue; could
  optionally be swapped to call the real `classifyFrame()` in a later cleanup, but that is not
  this issue's concern and the placeholder's behavior is not part of any acceptance criterion
  here.

## Open Questions

1. **DD-003/DD-004 `frame_type_source` gap for the terminal `unknown` case.** DD-004's prose
   describes three classification stages ending in `unknown`, but DD-003's already-migrated
   `frame_type_source` CHECK constraint only has three values (`header`, `path_heuristic`,
   `manual`) — none of which is a dedicated "neither stage matched" value. This plan resolves it
   by attributing the terminal `unknown` to `'path_heuristic'` (reasoning above), which requires
   no schema change and is internally consistent, but per `CLAUDE.md`'s explicit instruction
   ("if your implementation must deviate, stop and propose a DD revision... never diverge
   silently"), this reading should be confirmed or corrected by a human maintainer in the
   issue/PR discussion rather than treated as silently settled — it is a genuine, if small, gap
   between two "law" documents, not something resolvable by reading them more carefully.
2. **MaxIm DL / CCDSoft as a named convention source.** No planning document (`task-breakdown.md`,
   the P1-05 profile-table issue, or the fixtures library) lists MaxIm DL/CCDSoft among
   AstroTracker's target capture programs (the named six are N.I.N.A., SGPro, APT, SharpCap,
   ASIStudio, Voyager). This plan includes MaxIm's well-documented `"Light Frame"` /
   `"Dark Frame"` / `"Flat Field"` / `"Bias Frame"` phrasing anyway, because issue #12's own body
   text cites `"Light Frame"` as a variant to support and that exact phrasing's real-world origin
   is MaxIm DL/CCDSoft — but this is this plan's judgment call to broaden coverage slightly
   beyond the officially-named six programs, not a documented requirement. Low risk either way
   (an unused table entry is harmless), flagged for awareness only.
3. **Short/abbreviated folder conventions** (e.g. `df/`, `bf/`, `cal/`) are deliberately **not**
   included in the path-heuristic table — they are too short and semantically ambiguous to match
   safely without a much higher false-positive risk, and neither DD-004's examples nor the
   issue's ≥20-pattern minimum require them. Flagged as a possible future extension if real user
   folder structures turn out to need it, not a gap in this plan's own scope.

Plan written: docs/plans/p1-04-frame-classification.md — 5 steps
