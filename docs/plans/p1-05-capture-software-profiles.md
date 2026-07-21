# Plan: [P1-05] Capture-software profile table

**Slug:** p1-05-capture-software-profiles **Issue:** #13 **Date:** 2026-07-20
**Governing DDs:** DD-004 (scanning pipeline — "Header parsing specifics": capture-software
quirks handled by a data-driven profile table in `packages/core`, community-extensible), DD-002
(layering — `packages/core` pure TypeScript, no fs/Electron), DD-003 (database schema — consulted
to confirm no `frames` column exists for detected software identity)
**Depends on:** #9 (P1-01) — CLOSED, satisfied. Sibling #12 (P1-04, frame classification) is an
**unmerged** PR; this plan does not read, import, or depend on anything from it.
**Status:** READY_FOR_SPEC

## Summary

A data-driven capture-software profile registry in `packages/core/src/capture-profiles/`:
`detectProfile(metadata)` identifies which of six capture programs (N.I.N.A., SGPro, APT,
SharpCap, ZWO ASIAIR/ASIStudio, Voyager) produced a frame from its preserved raw header
keywords, and `applyCaptureProfile(metadata)` applies that profile's corrective fixups (small,
self-contained functions that recompute specific `FrameMetadata` fields from the raw headers
when the generic per-format parser's best-effort mapping missed or mis-mapped them) to return a
corrected `FrameMetadata`. Adding a program is one new file under `profiles/` plus a two-line
addition to the registry array — the dispatch/detection logic itself is proven, by an automated
source-scan test, to contain no per-software branching.

**Headline finding from reading the actual fixture bytes (not assumed from memory):** of the
"e.g., APT temperature keyword, SharpCap gain conventions" quirks named illustratively in the
issue body, **neither manifests as a correctable defect in the committed P0-06 fixture corpus.**
Every APT fixture uses the standard `CCD-TEMP` keyword directly (no nonstandard temperature
keyword exists to remap). SharpCap's and ASIStudio's `GAIN` values are on ZWO's native unitless
0–570 scale, but `FrameMetadata.gain` has no canonical-unit contract to convert into, so there is
nothing to compute — it's a documentation note, not a parsing defect. This plan says so honestly
rather than inventing fixups to hit a count. The one **real, fixture-verified** defect found by
exhaustive review is: **SGPro writes rotator angle as a nonstandard `ANGLE` keyword instead of
the generic mapper's `OBJCTROT`**, so `FrameMetadata.rotatorAngleDegrees` comes back `null` for
SGPro frames that do carry rotation data. That is this plan's one concrete quirk fixup.

RAW/EXIF frames get **no** capture-software profile — confirmed by reading every RAW fixture's
definition: EXIF carries `Make`/`Model` (camera hardware) and never a `Software` tag in this
corpus, and there is no capture-software concept for camera-firmware-written RAW files.
`detectProfile` returns `null` for every RAW frame, always, by design.

## Architecture Decision: what does a profile operate on?

**A profile's `detect` predicate and `fixups` operate on `FrameMetadata.headers` (the raw,
unnormalized keyword dictionary every parser preserves verbatim) plus the already-normalized
`FrameMetadata` for fixups that need to check current field state. The public entry points
(`detectProfile`, `applyCaptureProfile`) accept and return the full `FrameMetadata`.**

Reasoning:

1. **Software identity never lives in a normalized `FrameMetadata` field.** There is no
   `FrameMetadata.captureSoftware` field (checked `packages/core/src/fits/metadata.ts` — the
   canonical shape all three parsers share) and no `frames` table column for it either (checked
   DD-003 §Core tables: `frames(...)` has no software-identity column — the closest is
   `equipment_profile_id`, which is telescope/camera hardware, a different concept entirely).
   `SWCREATE`/`CREATOR`/`PROGRAM` are non-standard, per-program keywords that only survive in the
   catch-all `headers: Record<string, FitsValue>` dict every `toFrameMetadata` populates via
   `headers: { ...k }`. Detection has nowhere else to look.
2. **Quirk fixes are, by definition, "the generic mapping got this field wrong or missed it, go
   recompute it from the raw headers."** The SGPro `ANGLE` fixup only exists because
   `OBJCTROT` (what the generic FITS mapper reads for `rotatorAngleDegrees`) is absent from
   SGPro's convention; recovering the value requires reading `headers.ANGLE`, not anything
   already on the typed `FrameMetadata` shape. A profile restricted to typed fields alone
   couldn't fix anything.
3. **Operating on `FrameMetadata` (not a parser-specific raw shape, e.g. `FitsCard[]`) is what
   makes the registry format-agnostic**, satisfying DD-004's framing of this as one shared table
   in `packages/core`, not three per-parser tables. `FrameMetadata.headers` has the identical
   shape (`Record<string, FitsValue>`) across FITS, XISF, and RAW output (RAW's own
   `toFitsCompatibleHeaders` explicitly normalizes to it), so one registry, one dispatch function,
   and one fixup signature work uniformly post-parse regardless of source format. This places
   profile application after Stage 2 PARSE (which is exactly where DD-004 documents it, under
   "Header parsing specifics") and before Stage 3 RESOLVE consumes the corrected metadata.
4. **Fixups return `Partial<FrameMetadata>` patches, never a full replacement object.** This
   keeps each fixup a small, pure, independently unit-testable function
   (`(headers, metadata) => Partial<FrameMetadata>`) and keeps `applyCaptureProfile`'s merge
   logic (`{ ...metadata, ...patches }`) generic — the merge code never needs to know which
   fields any given profile touches.
5. **No DB/schema change is proposed.** Detected profile identity is not persisted in v1 (no
   column exists to persist it to); the registry's effect is entirely transient — it corrects
   `FrameMetadata` fields before Stage 3 (P1-04 classification, DD-005 resolution) and Stage-2-row
   assembly (P1-07) ever see them. `id`/`displayName` exist on `CaptureProfile` for logging and
   test identification only. This matches the issue's `pkg:core`-only label — no `pkg:db` work is
   in scope.

## Software-detection design

### Detection fingerprints (real values, pulled from the committed fixture bytes)

| Profile id         | Program (task-breakdown naming) | Fingerprint field | Real fixture value(s)                             | Match rule                                                                                                                                             |
| ------------------ | ------------------------------- | ----------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `nina`             | N.I.N.A.                        | `SWCREATE`        | `"N.I.N.A. 3.1.2.9001"`                           | `startsWith('N.I.N.A.')`                                                                                                                               |
| `sgpro`            | SGPro                           | `CREATOR`         | `"Sequence Generator Pro v4.2.0.1024"`            | `includes('Sequence Generator Pro')`                                                                                                                   |
| `apt`              | APT                             | `SWCREATE`        | `"Astro Photography Tool - APT v.4.10"`           | `startsWith('Astro Photography Tool')`                                                                                                                 |
| `sharpcap`         | SharpCap                        | `SWCREATE`        | `"SharpCap v4.1.11962.0, 64 bit"`                 | `startsWith('SharpCap')`                                                                                                                               |
| `asiair-asistudio` | ASIStudio/ASIAIR                | `CREATOR`         | `"ZWO ASIAIR Plus"`, `"ZWO ASIStudio ASIImg 4.4"` | `startsWith('ZWO ASI')` (covers both writers under one profile, matching how the task-breakdown and P0-06 fixtures already bundle them as one program) |
| `voyager`          | Voyager                         | `SWCREATE`        | `"Voyager 2.3.5"`                                 | `startsWith('Voyager')`                                                                                                                                |

Every one of these values was read directly from `fixtures/src/definitions/{nina,sgpro,apt,
sharpcap,asistudio,voyager}.ts` and cross-checked against the corresponding `fixtures/fits/
manifest.json` entries — not assumed from prior knowledge of these programs.

The issue body also names `PROGRAM` as a possible fingerprint field. No committed fixture uses
it. The registry design doesn't special-case any field name — each profile's `detect` predicate
is free to check whatever header field it needs (`SWCREATE`, `CREATOR`, a hypothetical `PROGRAM`,
or several at once) — so a future community-contributed profile keyed on `PROGRAM` needs no
change to the dispatcher, only a new profile file.

### Detection precedence

`detectProfile` walks the registry array (`ALL_PROFILES`) in declaration order and returns the
**first** profile whose `detect(headers)` returns `true`. Given the fingerprints above, every
committed fixture matches at most one profile — no two profiles' predicates are known to overlap
on any real fixture (verified by running each predicate against the full FITS manifest during
planning research). Array order is still the documented, deterministic tie-break rule for the
case a future community profile's predicate does overlap another's; it is not exercised by any
fixture today.

### The "no profile" outcome (never guess silently)

`detectProfile` returns `null`, explicitly, when no registered profile's predicate matches. This
is a first-class outcome, not an error path:

- **FITS edge/malformed-but-parseable fixtures** (`fixtures/fits/edge/*.fits`) carry no
  `SWCREATE`/`CREATOR`/`PROGRAM` keyword (confirmed by scanning every edge-set manifest entry) →
  `null`, correctly.
- **XISF fixtures — both of them.** Read the actual bytes of `fixtures/xisf/
pixinsight-unit-mono-ha.xisf` and `fixtures/xisf/nina-unit-mono-oiii.xisf`: neither carries a
  `SWCREATE`/`CREATOR` `<FITSKeyword>` element, and P1-02's `xisf/metadata.ts` `toFrameMetadata`
  only copies the `<FITSKeyword>` dict into `FrameMetadata.headers` — the native `<Property>`
  elements (`Observation:Object:Name`, `Instrument:ExposureTime`, ...), which _would_
  structurally distinguish "has Properties" (PixInsight-style) from "FITSKeyword-only"
  (N.I.N.A.-style), are **not** copied into `headers` at all. So neither XISF sample is
  detectable under this design, and `detectProfile` correctly returns `null` for both. This
  plan deliberately does **not** invent a heuristic (e.g. "both `EXPOSURE` and `EXPTIME` present
  ⇒ N.I.N.A.") to force a positive detection: that pattern isn't a documented software-identity
  convention, it's an artifact of how the P0-06 fixture author happened to write two test files,
  and reusing it for identification would be exactly the kind of silent guess DD-004's
  classification philosophy (`unknown`, never guessed) rejects. See Open Questions.
- **RAW fixtures — all of them, always.** No RAW/EXIF fixture in the corpus carries a `Software`
  tag; `Make`/`Model` identify camera hardware, not capture software, and there is no
  intervening capture program for camera-firmware-written RAW files in this corpus.
  `detectProfile` returns `null` unconditionally for RAW frames (see dedicated section below).

`applyCaptureProfile` returns `metadata` unchanged (same object reference, no allocation) when
`detectProfile` returns `null` — "no profile" never silently substitutes a default profile's
fixups.

## Profile registry data structure (the load-bearing design)

```ts
// packages/core/src/capture-profiles/types.ts
import type { FitsValue } from '../fits/types.js';
import type { FrameMetadata } from '../fits/metadata.js';

/**
 * One corrective rule. Reads the frame's raw preserved headers (and, when a
 * fixup needs to avoid clobbering a value another mapping already supplied,
 * the current normalized metadata) and returns only the fields it changes.
 * `{}` means "not applicable to this frame" — fixups are safe to run
 * unconditionally against every frame the profile matches.
 */
export type CaptureProfileFixup = (
  headers: Record<string, FitsValue>,
  metadata: FrameMetadata,
) => Partial<FrameMetadata>;

export interface CaptureProfile {
  /** Stable machine id (e.g. 'sgpro'). Never persisted — DD-003 has no column for it; used for logging/debugging and test identification only. */
  id: string;
  /** Human-readable name for logs/debugging. */
  displayName: string;
  /** Pure, side-effect-free predicate over the frame's raw preserved headers. */
  detect: (headers: Record<string, FitsValue>) => boolean;
  /** Self-contained corrective rules, applied in array order against the ORIGINAL metadata (not each other's output — see apply.ts); later entries win on field conflicts. `[]` is valid: a profile that only identifies software with no known quirks to fix (four of the six profiles in this plan). */
  fixups: CaptureProfileFixup[];
}
```

```ts
// packages/core/src/capture-profiles/profiles/sgpro.ts — a complete profile, the only
// non-empty `fixups` in this plan.
import type { CaptureProfile } from '../types.js';
import { headerStringField } from '../util.js';

export const sgproProfile: CaptureProfile = {
  id: 'sgpro',
  displayName: 'Sequence Generator Pro (SGPro)',
  detect: (headers) =>
    (headerStringField(headers, 'CREATOR') ?? '').includes('Sequence Generator Pro'),
  fixups: [
    // SGPro writes rotator angle as the nonstandard ANGLE keyword, never
    // OBJCTROT (what the generic FITS mapper reads). Recover it from the raw
    // header, but only when nothing else already supplied a value — never
    // clobber a legitimately-mapped OBJCTROT from another convention.
    (headers, metadata) => {
      if (metadata.rotatorAngleDegrees !== null) return {};
      const angle = headers.ANGLE;
      return typeof angle === 'number' ? { rotatorAngleDegrees: angle } : {};
    },
  ],
};
```

```ts
// packages/core/src/capture-profiles/registry.ts — the ONLY file a new profile's
// registration touches, and only ever by import + array append (data, not a conditional).
import { ninaProfile } from './profiles/nina.js';
import { sgproProfile } from './profiles/sgpro.js';
import { aptProfile } from './profiles/apt.js';
import { sharpcapProfile } from './profiles/sharpcap.js';
import { asiairAsistudioProfile } from './profiles/asiair-asistudio.js';
import { voyagerProfile } from './profiles/voyager.js';
import type { CaptureProfile } from './types.js';

export const ALL_PROFILES: readonly CaptureProfile[] = [
  ninaProfile,
  sgproProfile,
  aptProfile,
  sharpcapProfile,
  asiairAsistudioProfile,
  voyagerProfile,
];
```

```ts
// packages/core/src/capture-profiles/detect.ts
import { ALL_PROFILES } from './registry.js';
import type { CaptureProfile } from './types.js';
import type { FrameMetadata } from '../fits/metadata.js';

/** First registry entry (declaration order) whose predicate matches, or `null`. Never guesses. */
export function detectProfile(metadata: FrameMetadata): CaptureProfile | null {
  for (const profile of ALL_PROFILES) {
    if (profile.detect(metadata.headers)) return profile;
  }
  return null;
}
```

```ts
// packages/core/src/capture-profiles/apply.ts
import { detectProfile } from './detect.js';
import type { FrameMetadata } from '../fits/metadata.js';

/** Detect + apply in one call — what Stage 2 (DD-004) actually calls per frame. */
export function applyCaptureProfile(metadata: FrameMetadata): FrameMetadata {
  const profile = detectProfile(metadata);
  if (profile === null) return metadata;
  let patch: Partial<FrameMetadata> = {};
  for (const fixup of profile.fixups) {
    // Every fixup reads the ORIGINAL metadata, not the accumulating patch —
    // fixups stay order-independent and individually testable; only the
    // final merge (last-fixup-wins on a literal field collision) cares about
    // array order, and no shipped profile has colliding fixups.
    patch = { ...patch, ...fixup(metadata.headers, metadata) };
  }
  return { ...metadata, ...patch };
}
```

Why this satisfies "adding a profile requires only a data entry + fixture, no code changes": a
new program means (a) one new file under `profiles/` — a `CaptureProfile` object literal, and
(b) a two-line addition to `registry.ts`'s import list and array literal. Neither `detect.ts` nor
`apply.ts` — the actual dispatch logic — is ever touched, and neither contains any per-software
conditional today or in this design (enforced by an automated test, see Test Plan). `registry.ts`
itself is intentionally the one shared file every profile's registration touches, but that edit
is mechanical data composition (import + `Array.push`-shaped literal), never a branch.

## Concrete quirk fixup

**SGPro `ANGLE` → `rotatorAngleDegrees`** (the only genuine, fixture-verifiable defect found).
Fixture: `fixtures/fits/sgpro/sgpro-light-precision-timestamps.fits`. Its card list (read from
`fixtures/src/definitions/sgpro.ts`) includes `card('ANGLE', 182.4, '[deg] Rotation angle')` and
`card('FLIPPED', false, 'Is image flipped')` — neither is in the manifest's
`expected.keywords` (they're outside PRD §8.2's critical list) but both parse into
`FrameMetadata.headers` since every card is preserved verbatim. Without the fixup,
`rotatorAngleDegrees` is `null` for this frame (no `OBJCTROT` card exists in any SGPro fixture).
With the fixup, `applyCaptureProfile` returns `rotatorAngleDegrees: 182.4`. (`FLIPPED` has no
corresponding `FrameMetadata` field — nothing to fix, it stays in `headers` only.)

**Quirks explicitly investigated and rejected as fixups**, with the fixture evidence for each —
listed so the Reviewer can see this wasn't skipped, it was checked and found not to apply:

- **APT temperature keyword** (issue body's own example): every APT fixture
  (`apt-ccd-light.fits`, `apt-dark.fits`, `apt-flat.fits`) uses the standard `CCD-TEMP` card
  directly — `num('CCD-TEMP', -10, '-10.0', ...)` in `fixtures/src/definitions/apt.ts`. The
  generic FITS mapper already reads `CCD-TEMP` correctly. No fixup applies.
- **SharpCap / ASIStudio gain conventions**: both write `GAIN` on ZWO's native unitless 0–570
  scale (fixture values 100–350), per the fixture authors' own notes
  (`"GAIN uses the ZWO unitless 0-570 scale, not e-/ADU"`). `FrameMetadata.gain` is
  `number | null` with no documented canonical unit to convert _into_ — there's no wrong value to
  correct, just a unit convention a downstream consumer (UI, not this parser layer) needs to know
  about. No fixup applies; flagging the unit ambiguity is out of this issue's scope.
- **N.I.N.A.**: `SITELAT`/`SITELONG`/`SITEELEV` are present but `SITENAME` never is, so
  `FrameMetadata.siteName` stays `null` even though coordinate-level site info exists. Not
  fixable as a `siteName` **string** correction (lat/long isn't a name); would require a new
  `FrameMetadata` field (`siteLatDeg`/`siteLongDeg`), which is out of scope for a _profile_
  fixup (it's a shape change to `FrameMetadata` itself, a P1-01/P1-02 concern). No fixup applies.
  `FWHEEL`/`FOCPOS`/`FOCTEMP` etc. have no corresponding `FrameMetadata` fields either — nothing
  to fix, they're preserved in `headers` only.
- **Voyager, SGPro's sexagesimal-only pointing, SGPro's absent `FOCALLEN`, SGPro's `EXPOSURE`-
  only convention**: all already handled correctly by the _generic_, format-shared mapper
  (`raDegrees`/`decDegrees` sexagesimal fallback, `focalLengthMm` simply `null` when absent,
  `exposureSeconds: EXPTIME ?? EXPOSURE`) — these aren't software-specific bugs, they're the
  generic mapper doing its documented job. No profile involvement needed or added.

## RAW/EXIF handling

**RAW frames get no capture-software profile.** `detectProfile` returns `null` unconditionally
for every RAW-derived `FrameMetadata`. This is not a gap — it's the correct behavior, for two
independent reasons confirmed by reading every RAW fixture definition
(`fixtures/src/definitions/raw.ts`) and its manifest entries:

1. **No fixture carries a capture-software fingerprint.** EXIF's `Make`/`Model` tags identify
   camera _hardware_ (`"Canon"`/`"Canon EOS 6D"`, `"NIKON CORPORATION"`/`"NIKON Z 6"`,
   `"SONY"`/`"ILCE-7M4"`) — there is no `Software` EXIF tag populated anywhere in this corpus.
2. **"Originating capture software" isn't a coherent concept for camera-written RAW in the first
   place.** RAW/CR2/CR3/NEF/ARW files are written directly by camera firmware at shutter time;
   there is no intervening capture program (N.I.N.A., SGPro, etc.) whose keyword conventions
   could differ the way they do for FITS/XISF written by dedicated astro-imaging software. Even
   if a `Software` tag existed, it would identify firmware/editing-software version, not a
   "capture-software profile" in DD-004's sense.

No profile in the registry has a `detect` predicate that could ever match `FrameMetadata.headers`
derived from RAW input (the fingerprints all key on `SWCREATE`/`CREATOR`, tags RAW never
produces), so this is enforced structurally, not by a special-cased RAW check in the dispatcher —
consistent with the "no per-software/per-format branching" design.

## Public exports

Added to `packages/core/src/capture-profiles/index.ts`, then re-exported from
`packages/core/src/index.ts` alongside the existing FITS/XISF/RAW exports:

```ts
export { detectProfile } from './detect.js';
export { applyCaptureProfile } from './apply.js';
export { ALL_PROFILES } from './registry.js';
export type { CaptureProfile, CaptureProfileFixup } from './types.js';
```

`detectProfile` is exported standalone (not just folded into `applyCaptureProfile`) because Stage
3 / future logging or a settings UI may want to know _which_ profile matched without needing the
corrected metadata, and because it's the natural seam for the fixture acceptance tests (Test Plan
below) to assert against directly.

## Module layout

```
packages/core/src/capture-profiles/
  types.ts                        # CaptureProfile, CaptureProfileFixup
  util.ts                         # headerStringField() and any other tiny shared header helpers
  registry.ts                     # ALL_PROFILES: readonly CaptureProfile[] — the one file every new profile registers into
  detect.ts                       # detectProfile()
  apply.ts                        # applyCaptureProfile()
  index.ts                        # public surface
  profiles/
    nina.ts
    sgpro.ts
    apt.ts
    sharpcap.ts
    asiair-asistudio.ts
    voyager.ts
    sgpro.test.ts                 # literal-object unit tests for the one real fixup
  detect.test.ts                  # registry shape + "no branching in dispatch" source-scan test
  apply.test.ts                   # merge semantics, no-op-when-null, patch precedence
  fixtures.test.ts                # end-to-end acceptance suite against the full P0-06 corpus
```

This mirrors the existing per-domain convention (`fits/{types,parse,metadata,index}.ts`,
`xisf/{...}`, `raw/{...}`) and the fixtures package's own "one file per unit, aggregated array in
an `index`" pattern (`fixtures/src/definitions/{nina,sgpro,...}.ts` → `definitions/index.ts`).
`profiles/` is a subdirectory (not flat files in `capture-profiles/`) so the six program files
are visually grouped apart from the three dispatch files — the distinction the "no code changes"
criterion cares about (data vs. dispatch) is legible from the directory layout itself.

## Test Plan

1. **Registry shape** (`detect.test.ts`): `ALL_PROFILES.length === 6`; every entry has a
   non-empty `id`/`displayName`, `detect` is a function, `fixups` is an array.
2. **"No per-software branching in dispatch"** (`detect.test.ts`): a source-scan test that
   `readFileSync`s `detect.ts` and `apply.ts` (not `registry.ts`, not `profiles/**` — those are
   expected to name programs) and asserts the source text contains **none** of the known
   program-identifying substrings (`'N.I.N.A'`, `'SGPro'`, `'Sequence Generator'`,
   `'Astro Photography Tool'`, `'SharpCap'`, `'ZWO ASI'`, `'Voyager'`). This is a concrete,
   automated, currently-passing-by-construction regression test for the literal claim the
   Reviewer needs to check: it fails loudly the moment anyone adds
   `if (profile.id === 'sgpro') { ... }` with the name inline, or any equivalent branch, to the
   dispatcher. It is a string-literal heuristic, not a formal proof (a sufficiently obfuscated
   branch could dodge it), but it directly encodes the acceptance criterion rather than relying
   on code-review discipline alone.
3. **Per-fixture detection acceptance** (`fixtures.test.ts`, table-driven against the real
   corpus, mirroring `fits/fixtures.test.ts`'s `FIXTURES_ROOT` pattern):
   - Every FITS program fixture (all 27 across `nina/sgpro/apt/sharpcap/asistudio/voyager/`,
     not just one per program) parses (`parseFitsHeaderFromBuffer` + `toFrameMetadata`) and
     `detectProfile(metadata)?.id` equals the program's expected profile id, keyed off each
     manifest entry's `provenance.program` string.
   - Every FITS **edge** fixture (6 files, `status: "ok"`) → `detectProfile(metadata) === null`
     (no false positives from files with no software-id keyword).
   - Malformed FITS fixtures are not exercised here — they never reach `toFrameMetadata` (Stage 2
     parse failure short-circuits before profile application, per DD-004 error isolation).
   - Both valid XISF fixtures (`pixinsight-unit-mono-ha.xisf`, `nina-unit-mono-oiii.xisf`) and
     the minimal unit → `detectProfile(metadata) === null`, asserted as the _correct_ outcome
     with a comment pointing at the Architecture Decision section's reasoning (so a future reader
     doesn't mistake three passing null-assertions for a missing feature).
   - All four valid RAW fixtures (`cr2`/`nef`/`arw`/`cr3`) → `detectProfile(metadata) === null`.
4. **Quirk fixup — fixture-driven** (`apply.test.ts`): parse
   `sgpro-light-precision-timestamps.fits`, confirm `toFrameMetadata(...).rotatorAngleDegrees` is
   `null` _before_ the fixup (proves the defect is real, not already handled), then confirm
   `applyCaptureProfile(...).rotatorAngleDegrees === 182.4` _after_.
5. **Quirk fixup — literal-object unit tests** (`profiles/sgpro.test.ts`): call the fixup
   function directly (no parser involved) with hand-built `(headers, metadata)` pairs: `ANGLE`
   present + `rotatorAngleDegrees: null` → patch applied; `ANGLE` present but
   `rotatorAngleDegrees` already non-null (simulating a hypothetical future `OBJCTROT` co-
   occurrence) → `{}` (never clobbers); `ANGLE` absent → `{}`; `ANGLE` present but non-numeric
   (defensive, malformed-header case) → `{}`.
6. **No-op pass-through for zero-fixup profiles** (`apply.test.ts`): for each of `nina`, `apt`,
   `sharpcap`, `asiair-asistudio`, `voyager`, run `applyCaptureProfile` against that program's
   representative fixture and assert every field equals the pre-fixup `toFrameMetadata` output
   exactly (`toStrictEqual`) — catches an accidental future fixup silently mutating a field that
   was previously untouched.
7. **`null`-profile pass-through** (`apply.test.ts`): construct a `FrameMetadata` whose `headers`
   contains no known fingerprint; assert `applyCaptureProfile` returns the **same object
   reference** (`toBe`, not just `toStrictEqual`) — proves "no profile" truly short-circuits
   rather than reconstructing an identical-looking object.

## Affected Files

- `packages/core/src/capture-profiles/types.ts` — new; `CaptureProfile`, `CaptureProfileFixup`.
- `packages/core/src/capture-profiles/util.ts` — new; `headerStringField` and any other tiny
  shared predicate/fixup helpers profiles need.
- `packages/core/src/capture-profiles/registry.ts` — new; `ALL_PROFILES` array.
- `packages/core/src/capture-profiles/detect.ts` — new; `detectProfile`.
- `packages/core/src/capture-profiles/apply.ts` — new; `applyCaptureProfile`.
- `packages/core/src/capture-profiles/index.ts` — new; public surface of the sub-module.
- `packages/core/src/capture-profiles/profiles/{nina,sgpro,apt,sharpcap,asiair-asistudio,
voyager}.ts` — new; one `CaptureProfile` object literal each.
- `packages/core/src/capture-profiles/profiles/sgpro.test.ts` — new; literal-object fixup tests.
- `packages/core/src/capture-profiles/detect.test.ts` — new; registry-shape + no-branching tests.
- `packages/core/src/capture-profiles/apply.test.ts` — new; merge semantics, no-op/null-passthrough tests.
- `packages/core/src/capture-profiles/fixtures.test.ts` — new; full-corpus detection acceptance
  suite (FITS program + edge, XISF, RAW).
- `packages/core/src/index.ts` — modified; re-export `detectProfile`, `applyCaptureProfile`,
  `ALL_PROFILES`, `CaptureProfile`, `CaptureProfileFixup`.

No changes to `fixtures/` (every fixture this plan needs already exists from P0-06), `packages/db`,
`packages/desktop`, or any DD document.

## Implementation Steps

### Step 1 — Types, dispatch, empty registry, no-branching guard

**Outcome:** `detectProfile`/`applyCaptureProfile` exist and compile against an empty
`ALL_PROFILES = []`; both always return `null`/pass-through respectively; the source-scan
no-branching test and registry-shape test are green before any profile exists — proving the
dispatch mechanism itself needs zero future edits as profiles are added (steps 2–3 are then
provably additive-only).
**Files:** `types.ts`, `util.ts`, `registry.ts` (empty array), `detect.ts`, `apply.ts`,
`index.ts`, `detect.test.ts`, `apply.test.ts` (null-passthrough case only at this point).
**Depends on:** none (P1-01 already merged, supplies `FrameMetadata`/`FitsValue`).

### Step 2 — N.I.N.A. + SGPro profiles, including the one real quirk fixup

**Outcome:** Two working profiles prove the full registration pattern (new file + two-line
registry addition) and ship the plan's one genuine corrective fixup
(`ANGLE → rotatorAngleDegrees`), fully unit-tested both as a literal-object function and
end-to-end against `sgpro-light-precision-timestamps.fits`.
**Files:** `profiles/nina.ts`, `profiles/sgpro.ts`, `profiles/sgpro.test.ts`, `registry.ts`
(updated), `apply.test.ts` (extended with the SGPro fixture case).
**Depends on:** Step 1.

### Step 3 — APT, SharpCap, ZWO ASIAIR/ASIStudio, Voyager profiles

**Outcome:** All six FITS-fixture programs detectable; each of these four profiles ships
`fixups: []` with an inline comment recording _why_ (the investigated-and-rejected quirks
documented above), so a future reader sees a deliberate decision, not an oversight.
**Files:** `profiles/apt.ts`, `profiles/sharpcap.ts`, `profiles/asiair-asistudio.ts`,
`profiles/voyager.ts`, `registry.ts` (updated).
**Depends on:** Step 1 (independent of Step 2's content, sequenced after only for review size).

### Step 4 — Full-corpus acceptance suite + public exports

**Outcome:** `fixtures.test.ts` proves "each fixture's software correctly detected" against
every relevant fixture in the P0-06 corpus (27 FITS program fixtures, 6 FITS edge fixtures, 3
valid XISF fixtures, 4 valid RAW fixtures — 40 assertions minimum) using the same
`FIXTURES_ROOT`/manifest-reading pattern already established in `fits/fixtures.test.ts` and
`raw/fixtures.test.ts`. `packages/core/src/index.ts` re-exports the public surface. `pnpm -r
build && pnpm -r lint && pnpm -r test` green.
**Files:** `fixtures.test.ts`, `packages/core/src/index.ts`.
**Depends on:** Steps 1–3.

## Edge Cases

- **A frame with both `SWCREATE` and `CREATOR` present** (not seen in any committed fixture —
  every fixture uses exactly one or the other): registry order decides; no fixture exercises this,
  documented as the defensive tie-break rule only.
- **`ANGLE` present but not a number** (e.g. a hypothetical string `"182.4 deg"`): the fixup's
  `typeof angle === 'number'` guard returns `{}` — never throws, never coerces a string, treats
  it as "not applicable" rather than guessing a parse. Covered by a literal-object test.
- **A non-SGPro frame that happens to carry an `ANGLE` header** (not in the corpus, but
  plausible in the wild for an unrelated program): the fixup only ever _runs_ when `detect`
  already matched SGPro's `CREATOR` fingerprint first — `ANGLE` alone never triggers the SGPro
  profile, so this can't cause a false correction on another program's frame.
- **`rotatorAngleDegrees` already non-null when SGPro's fixup runs** (not in the current corpus,
  since no SGPro fixture has `OBJCTROT`, but defensive against a future SGPro fixture that adds
  one): the fixup checks `metadata.rotatorAngleDegrees !== null` first and returns `{}` —
  generic mapping always wins over a profile fixup when both could apply.
- **Empty/whitespace `SWCREATE`/`CREATOR` string** (e.g. `""`): `startsWith`/`includes` against
  an empty needle-bearing prefix naturally return `false` for the profiles here (none of their
  match prefixes are empty strings), so this can't cause an accidental universal match.
- **XISF "PixInsight-style" vs "N.I.N.A.-style" genuinely indistinguishable today**: both
  correctly produce `null`; not treated as a defect (see Architecture Decision + Open Questions).

## Invariant Checklist

- [x] Non-destructive: no fs access outside test files (which only _read_ the committed
      `fixtures/` corpus, same test-only pattern already used by `fits/fixtures.test.ts` and
      `raw/fixtures.test.ts`); production code (`detect.ts`/`apply.ts`/`registry.ts`/`profiles/**`)
      touches no fs at all.
- [x] Layering: pure `packages/core` TypeScript, no Electron imports, no fs in domain logic —
      every profile predicate/fixup is a synchronous pure function over already-in-memory data.
- [x] DB: N/A — no schema/migration change; confirmed no `frames` column exists for detected
      software identity and none is proposed (see Architecture Decision).
- [x] Timestamps stored UTC: N/A — this issue touches no timestamp field; the one fixup
      (`rotatorAngleDegrees`) is a plain numeric field, not a date.
- [x] Long-running work through worker queue: N/A — synchronous, in-process pure functions;
      Stage 2 wiring that calls `applyCaptureProfile` per frame is P1-07's concern, not this
      issue's.
- [x] Performance budgets: negligible — six `startsWith`/`includes` string checks and at most one
      fixup function per frame; no measurable impact on the DD-004 10k-header scan budget.

## Out of Scope

- Wiring `applyCaptureProfile` into the actual Stage 2 worker pipeline — that's P1-07 ("Parse +
  resolve pipeline stages"), which lists P1-05 as a dependency precisely so this table exists
  first.
- Any change to `packages/core/src/xisf/metadata.ts` to preserve `<Property>` elements into
  `FrameMetadata.headers` — would be needed to ever make XISF software detection possible, but
  it's a P1-02 shape change, not a P1-05 profile-table change; flagged, not implemented (see Open
  Questions).
- Any new `FrameMetadata` field (e.g. `siteLatDeg`, a canonical gain-scale field) that would let
  a future fixup correct fields this plan identified as currently uncorrectable — a P1-01/P1-02
  concern.
- P1-04 (frame classification) — unmerged sibling; not read, not depended on, not duplicated.
  IMAGETYP-string classification (`'Light'` vs `'LIGHT'` vs `'masterDark'`) is P1-04's table, not
  a capture-software "quirk fix" in this table's sense.
- DD-005 filter/target normalization — the `'S2'` → SII, `'UV/IR'` → L mappings noted in fixture
  comments belong to P1-11/DD-005, not this profile table.
- Any DB column or persistence of the detected profile id — no schema change proposed (see
  Architecture Decision).
- Community-extensibility mechanics beyond "add a file + a registry line" (e.g. a plugin-loading
  system, user-editable profile JSON) — DD-004 says "community-extensible in later versions";
  this plan ships the v1 in-repo, statically-typed registry only.

## Open Questions

1. **XISF software fingerprinting is currently impossible**, not merely unimplemented: neither
   committed XISF fixture carries any FITSKeyword-level software-identity field, and the
   structural signal that _would_ distinguish PixInsight-style from N.I.N.A.-style output
   (presence of native `<Property>` elements) isn't preserved in `FrameMetadata.headers` by
   P1-02's current `toFrameMetadata`. Is `null` for all XISF frames acceptable for v1 (this
   plan's position), or should a follow-up (a) research whether PixInsight/N.I.N.A. actually
   write a real software-identity `FITSKeyword` in genuine XISF output (none of the cited public
   docs were checked for this specifically during P0-06's fixture authoring) and (b), if so,
   extend P1-02 to preserve whatever native fields are needed for detection? Not resolvable from
   CLAUDE.md, DD-004, the issue text, or the fixtures alone — genuinely needs a product/research
   call.
2. **Should detected capture-software identity ever be persisted or surfaced to the user** (e.g.
   an Equipment/Settings screen showing "12 frames detected as SharpCap")? DD-003's current
   schema has no column for it and this issue's acceptance criteria don't require persistence.
   Not blocking this issue — flagged as a possible future DD-003 revision if product wants it.

Plan written: docs/plans/p1-05-capture-software-profiles.md — 4 steps
