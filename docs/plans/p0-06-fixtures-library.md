# Plan: [P0-06] Fixtures library of real-world file headers

**Slug:** p0-06-fixtures-library **Issue:** #6 **Date:** 2026-07-06
**Governing DDs:** DD-004 (scanning pipeline / header parsing specifics), DD-005 (target resolution & filter normalization), DD-002 (module layout — `fixtures/` location and purity rules)
**Status:** READY_FOR_SPEC

## Summary

This issue populates `fixtures/` with the test corpus every Phase 1 parser issue (P1-01 FITS,
P1-02 XISF, P1-03 RAW) and the benchmark harness (P0-07) are contractually tested against:
header-only FITS files matching the documented header conventions of six capture programs
(N.I.N.A., SGPro, APT, SharpCap, ASIStudio/ASIAIR, Voyager), XISF samples (PixInsight-written
and N.I.N.A.-written variants), minimal-valid CR2/CR3/NEF/ARW EXIF samples, a malformed-file
set (truncated header, missing END, non-standard keywords, CONTINUE-card pathologies), a
manifest JSON per fixture set declaring the expected parse output for each file, and a seeded
generator CLI that synthesizes N header-only FITS files with controllable
OBJECT/FILTER/EXPTIME/DATE-OBS distributions for bulk benchmarks.

**Provenance approach (flag for the PR description):** this is an autonomous run with no
access to user-captured files, and downloading astronomy files of unclear license is not
acceptable. Every fixture is therefore _synthesized byte-exactly to each program's documented
header conventions_ (public docs cited per manifest entry) and marked honestly in its
manifest provenance as `"synthesized-to-conventions"` with license `CC0-1.0`
(project-authored). This satisfies "license-clean with provenance noted" by construction; the
manifest schema also defines a `"user-captured"` provenance method so genuinely real files
can be swapped in later as a follow-up without changing the manifest format. The acceptance
criterion's "real-world" wording is interpreted as "real-world _conventions_, faithfully
reproduced and cited" — call this out explicitly in the PR.

Primary keyword sources: N.I.N.A. FITS docs (nighttime-imaging.eu — full keyword table:
SWCREATE, IMAGETYP, EXPOSURE+EXPTIME, DATE-LOC, OBJECT, OBJCTRA/OBJCTDEC, GAIN, OFFSET,
EGAIN, BAYERPAT, ROWORDER, FWHEEL, FOCPOS, weather keywords…), SGPro help ("Data Stored in
the FITS Header"; 7-fractional-digit DATE-OBS/DATE-LOC timestamps; FOCALLEN sometimes
absent), APT user guide/forum (SWCREATE `'Astro Photography Tool - APT v.x.y'`, APTDIA, JD,
TELESCOP/OBSERVER), SharpCap docs/forums (SWCREATE `'SharpCap v4.x'`, EXPTIME, XPIXSZ,
CCD-TEMP, INSTRUME; typically no OBJECT), ZWO manuals/forums (ASIStudio/ASIAIR CREATOR/quirk
keywords), Voyager wiki, the FITS 4.0 standard + registered CONTINUE convention
(fits.gsfc.nasa.gov), the XISF 1.0 specification (pixinsight.com), and PRD §8.2 for the
critical/important keyword extraction list. The Coder must verify exact card text against
these sources while authoring — every manifest entry cites the URLs it was derived from.

## Affected Files

- `pnpm-workspace.yaml` — modified; add `fixtures` as a workspace member (the fixtures
  package holds authoring/generator tooling and structural tests; committed sample binaries
  live alongside)
- `fixtures/package.json` — new; private package `@astrotracker/fixtures` with `lint`,
  `test`, `author` (regenerate committed fixtures), `generate` (bulk synthetic CLI) scripts;
  devDependencies: `tsx` (script runner), `exifr` (RAW smoke-validation only),
  `fast-xml-parser` (XISF well-formedness check only)
- `fixtures/tsconfig.json` — new; extends `tsconfig.base.json`
- `fixtures/README.md` — rewritten; layout, manifest format, provenance policy,
  how to add a fixture, how to regenerate, follow-up note about swapping in user-captured files
- `fixtures/manifest.schema.json` — new; JSON Schema for all manifests (entry shape,
  provenance methods, error-code enum)
- `fixtures/src/lib/fits.ts` — new; pure FITS card/header builders (80-char card
  serialization, string quoting, CONTINUE emission, 2880-byte block padding)
- `fixtures/src/lib/xisf.ts` — new; pure XISF monolithic-file builder (16-byte signature
  header + XML header block)
- `fixtures/src/lib/tiff-exif.ts` — new; pure minimal TIFF/EXIF builder (IFD0 + EXIF IFD)
  for CR2/NEF/ARW, plus a minimal ISO-BMFF box writer for CR3
- `fixtures/src/lib/prng.ts` — new; small deterministic integer-seeded PRNG (e.g.
  mulberry32-style) so generator output is identical across OSes
- `fixtures/src/definitions/*.ts` — new; declarative per-program fixture definitions
  (nina.ts, sgpro.ts, apt.ts, sharpcap.ts, asistudio.ts, voyager.ts, edge.ts, malformed.ts,
  xisf.ts, raw.ts) — each definition is data (cards + expected manifest entry) in one place
- `fixtures/src/author.ts` — new; writes committed fixture binaries + manifests from the
  definitions (deterministic; CI test asserts re-run produces byte-identical output)
- `fixtures/src/generate.ts` — new; bulk synthetic generator CLI
- `fixtures/src/*.test.ts` — new; structural validation suite (see Step 8)
- `fixtures/fits/{nina,sgpro,apt,sharpcap,asistudio,voyager,edge}/*.fits` — new; committed
  valid fixtures
- `fixtures/fits/malformed/*.fits` — new; committed malformed fixtures
- `fixtures/fits/manifest.json`, `fixtures/xisf/manifest.json`, `fixtures/raw/manifest.json`
  — new; one manifest per fixture set (FITS manifest covers valid + edge + malformed entries)
- `fixtures/xisf/*.xisf`, `fixtures/raw/*.{cr2,cr3,nef,arw}` — new; committed samples
- `.gitattributes` — new (root); mark `*.fits`, `*.xisf`, `*.cr2`, `*.cr3`, `*.nef`, `*.arw`
  as `binary` so git never mangles line endings on Windows checkouts (CI runs on 3 OSes)
- `.gitignore` — modified; ignore `fixtures/generated/` (default bulk-generator output dir)
- `vitest.workspace.ts` — modified; add a `fixtures` project entry
- `package.json` (root) — modified; add `"fixtures:generate"` convenience script

## Implementation Steps

### Step 1 — Fixtures workspace package + manifest schema

**Outcome:** `fixtures/` is a lintable, testable workspace member; `pnpm install && pnpm -r
lint && pnpm -r test` still pass end to end; the manifest contract exists before any fixture
does. The schema defines: `file` (relative path), `format` (`fits|xisf|raw`), `description`,
`provenance` (`method: synthesized-to-conventions | user-captured | cc0-import`, `program`,
`emulatesVersion`, `sources[]` (URLs), `license`, `date`), and `expected` — either
`{ status: "ok", keywords: {…typed JSON values…}, cardCount, headerBytes, notes }` or
`{ status: "error", errorCode }` with a closed error-code enum
(`TRUNCATED_HEADER`, `MISSING_END`, `INVALID_CARD`, `BAD_CONTINUE`, `NOT_FITS`,
`EMPTY_FILE`, `MALFORMED_XML`, `BAD_SIGNATURE`, `UNRECOGNIZED_RAW`). `expected.keywords`
covers at minimum every PRD §8.2 _critical_ keyword present in the file — this is the
contract P1-01/02/03 acceptance tests will assert against.
**Files:** `pnpm-workspace.yaml`, `fixtures/package.json`, `fixtures/tsconfig.json`,
`fixtures/manifest.schema.json`, `fixtures/README.md`, `.gitattributes`, `.gitignore`,
`vitest.workspace.ts`, root `package.json`.
**Depends on:** none

### Step 2 — Pure FITS builder library

**Outcome:** A unit-tested, side-effect-free module that turns a declarative card list into a
byte-exact FITS header: fixed-format 80-char cards (keyword left-justified in cols 1–8,
`= ` in cols 9–10, strings quoted with `''` escaping, value/comment layout), the registered
CONTINUE long-string convention (`&` continuation + `CONTINUE` cards + LONGSTRN), COMMENT/
HISTORY/blank cards, END card, and space-padding to 2880-byte block boundaries. It can also
deliberately emit _broken_ output (unpadded blocks, missing END, overlong/short cards,
non-ASCII bytes) for Step 4. All output is pure `Uint8Array`/Buffer — fs stays in the
authoring script.
**Files:** `fixtures/src/lib/fits.ts`, `fixtures/src/lib/fits.test.ts`,
`fixtures/src/lib/prng.ts`.
**Depends on:** Step 1

### Step 3 — Per-program valid FITS fixture sets + manifests

**Outcome:** 27 committed header-only `.fits` files across six programs, each with a manifest
entry, regenerable byte-identically via `pnpm --filter @astrotracker/fixtures author`.
Files contain header blocks only (NAXIS1/NAXIS2 declared but no pixel payload) — deliberately:
DD-004 mandates header-only reads, and P1-01 must "never read beyond the header region", so a
parser that over-reads fails loudly on these fixtures. Per-program sets bake in each
program's documented quirks:

- **N.I.N.A. (6):** mono narrowband light (full rig: SWCREATE, IMAGETYP `'LIGHT'`, both
  EXPOSURE and EXPTIME, DATE-LOC + DATE-OBS, OBJECT, OBJCTRA/OBJCTDEC sexagesimal, RA/DEC
  degrees, GAIN/OFFSET/EGAIN, FWHEEL/FILTER, FOCPOS/FOCTEMP, SITELAT/SITELONG/SITEELEV,
  ROWORDER); OSC light with BAYERPAT/XBAYROFF/YBAYROFF; dark; flat; bias; mosaic-panel light
  with `OBJECT = 'M 31 Panel 1'` (DD-005 panel resolution groundwork).
- **SGPro (5):** light with 7-fractional-digit `DATE-OBS`/`DATE-LOC` timestamps and CREATOR
  keyword; light _without_ FOCALLEN (documented intermittent omission); dark; flat; light
  with sexagesimal OBJCTRA/OBJCTDEC.
- **APT (4):** DSLR light (no FILTER keyword — exercises DD-005 `None` canonical filter),
  SWCREATE `'Astro Photography Tool - APT v.4.x'`, APTDIA, JD, TELESCOP/OBSERVER; CCD light;
  dark; flat.
- **SharpCap (4):** EAA-style light with _no OBJECT_ (needs-review bucket path, DD-005 step
  5), SWCREATE `'SharpCap v4.x…'`, EXPTIME, XPIXSZ/YPIXSZ, CCD-TEMP, INSTRUME; light with
  extra vendor keywords (tolerated non-standard, must land in `headers_json`); dark; flat.
- **ASIStudio/ASIAIR (4):** OSC light with its CREATOR/quirk keyword set and BAYERPAT; light
  with GAIN conventions per ZWO docs; dark; flat.
- **Voyager (4):** light with Voyager's software-identification keyword and full pointing
  set; light; dark; flat.
  Filter strings across the sets deliberately cover the DD-005 normalization table:
  `'Ha 3nm'`, `'Halpha'`, `'OIII'`, `'S2'`, `'Lum'`, `'UV/IR'`, `'Red'`, `'L-eXtreme'`,
  `'None'`, absent. All DATE-OBS values are UTC; DATE-LOC entries are present specifically so
  parser tests can prove DATE-OBS (not DATE-LOC) is what gets stored.
  **Files:** `fixtures/src/definitions/{nina,sgpro,apt,sharpcap,asistudio,voyager}.ts`,
  `fixtures/src/author.ts`, `fixtures/fits/<program>/*.fits`, `fixtures/fits/manifest.json`.
  **Depends on:** Step 2

### Step 4 — Edge-case and malformed FITS sets

**Outcome:** Valid-but-tricky and invalid fixtures with manifest entries. **Edge (valid,
6):** CONTINUE long OBJECT string with LONGSTRN card; EXPOSURE-only (no EXPTIME) and
EXPTIME-only variants; header exactly filling one 2880-byte block (END as 36th card) and one
spilling END into a second block; COMMENT/HISTORY/blank-card mix; HIERARCH-style non-standard
keyword card (must parse as tolerated unknown, preserved in raw cards). **Malformed (10,
`expected.status: "error"` with specific errorCode):** file truncated mid-block (not a
2880 multiple, no END); complete 2880 block(s) but END never appears before EOF; lowercase /
embedded-space keyword card; unquoted string value where a number is implied (bad value
format); CONTINUE card whose string has no closing quote; orphan CONTINUE (no preceding
`&`-terminated string); non-ASCII (>0x7E) bytes inside a card; zero-length file;
`SIMPLE = F` / missing SIMPLE first card; final card shorter than 80 bytes at EOF. Manifest
notes for each malformed entry state what a conforming parser must do: return the structured
error, never throw, never hang, never abort a batch (DD-004 error isolation).
**Files:** `fixtures/src/definitions/{edge,malformed}.ts`, `fixtures/fits/edge/*.fits`,
`fixtures/fits/malformed/*.fits`, `fixtures/fits/manifest.json` (extended).
**Depends on:** Step 2

### Step 5 — XISF samples + manifest

**Outcome:** Monolithic XISF files per the XISF 1.0 spec: 8-byte signature `XISF0100`,
4-byte little-endian XML header length, 4 reserved bytes, then the UTF-8 XML header. Three
valid samples: a PixInsight-style unit (Image element with `FITSKeyword` elements _and_ XISF
`Property` elements, e.g. `Observation:Object:Name`, `Instrument:ExposureTime`) matching
P1-02's "PixInsight-written variant"; an N.I.N.A.-written-style unit (the FITSKeyword set
N.I.N.A. documents for XISF output, mirroring Step 3's NINA light); a minimal unit. Image
data attachment is declared in the XML (`location="attachment:…"`) but the file is truncated
after the header — same header-only rationale as Step 3. Two malformed samples: well-formed
signature with broken XML (unclosed tag → `MALFORMED_XML`), and a wrong-signature file
(`BAD_SIGNATURE`). Each has a manifest entry whose `expected.keywords` uses the same
normalized keyword names as the FITS manifests (P1-01/P1-02 share `FrameMetadata`).
**Files:** `fixtures/src/lib/xisf.ts` (+ test), `fixtures/src/definitions/xisf.ts`,
`fixtures/xisf/*.xisf`, `fixtures/xisf/manifest.json`.
**Dependson:** Step 2 (authoring flow), Step 1 (schema)

### Step 6 — RAW EXIF samples + manifest

**Outcome:** Minimal-valid camera-RAW containers that `exifr` (the P1-03 adapter library)
successfully parses: CR2, NEF, ARW as TIFF-based files (TIFF header + IFD0 with Make/Model +
EXIF IFD with ExposureTime, ISOSpeedRatings, DateTimeOriginal, and — on exactly one sample —
OffsetTimeOriginal, so P1-03's "UTC normalization using EXIF offset _when present_" has both
a with-offset and a without-offset fixture); CR3 as a minimal ISO-BMFF box structure (ftyp +
moov with Canon's CMT1/CMT2 metadata boxes carrying the same TIFF-format EXIF payload). No
sensor data — headers/metadata only. Two malformed samples: truncated TIFF header, and a
correctly-extensioned file of garbage bytes (`UNRECOGNIZED_RAW`). A structural test in this
issue already runs `exifr` (as a devDependency of the fixtures package only) over each valid
sample and asserts the manifest's expected ExposureTime/ISO/DateTimeOriginal come back — so
P1-03 inherits pre-verified fixtures rather than discovering builder bugs later. Manifest
notes record that OBJECT/FILTER are structurally absent in EXIF (null in `FrameMetadata`,
per P1-03 path-heuristics handoff).
**Files:** `fixtures/src/lib/tiff-exif.ts` (+ test), `fixtures/src/definitions/raw.ts`,
`fixtures/raw/*.{cr2,cr3,nef,arw}`, `fixtures/raw/manifest.json`.
**Depends on:** Step 1; independent of Steps 2–5

### Step 7 — Bulk synthetic FITS generator CLI

**Outcome:** `pnpm fixtures:generate -- --count 10000 --out fixtures/generated --seed 42
[--profile nina|sgpro|apt|sharpcap|asistudio|voyager] [--objects "M 31:0.4,M 42:0.35,NGC 7000:0.25"]
[--filters "Ha:0.4,OIII:0.3,SII:0.3"] [--exptime "120,300,600"]
[--date-start 2026-01-01] [--nights 20] [--imagetypes "LIGHT:0.8,DARK:0.1,FLAT:0.1"]`
produces N structurally valid header-only FITS files reusing Step 2's builder and Step 3's
program profiles, plus a `generation-summary.json` recording the seed, arguments, and
realized distributions. Weighted distributions are drawn from the seeded PRNG (identical
output for identical seed on all OSes — required for P0-07's stored CI baselines); DATE-OBS
values are spread across `--nights` sessions with realistic intra-night cadence (exposure
length + settle gap) so P0-04/DD-006 session-grouping work can also use the output. Output
directory is gitignored; the generator refuses to write outside its `--out` directory. This
step is the DD-004 "synthetic 10k-header fixture set" and P0-07 benchmark feedstock.
**Files:** `fixtures/src/generate.ts`, `fixtures/src/generate.test.ts`, root `package.json`
script, `.gitignore` entry (from Step 1).
**Depends on:** Steps 2–3

### Step 8 — Cross-cutting validation suite + docs

**Outcome:** `pnpm -r test` proves the corpus is self-consistent without any parser existing
yet: (a) every manifest validates against `manifest.schema.json`; (b) every fixture file on
disk has exactly one manifest entry and vice versa; (c) every manifest entry cites ≥1
provenance source URL and a license; (d) valid FITS fixtures are byte-structurally sound
(size multiple of 2880, printable-ASCII header, SIMPLE first card, END present, every
manifest keyword appears verbatim in a card); (e) each malformed fixture demonstrably
exhibits its declared defect (e.g. asserts END is truly absent); (f) XISF signatures and
declared header lengths are consistent and the XML is well-formed (fast-xml-parser); (g)
re-running `author.ts` reproduces every committed binary byte-for-byte (determinism guard —
catches platform-dependent authoring bugs on the 3-OS CI matrix); (h) the generator test
from Step 7 (same seed → identical bytes; distributions within tolerance for a 1k-file run).
The README documents the acceptance-criteria mapping: fixture counts per program (27 program

- 6 edge valid FITS across 6 programs ≥ the required 25 across 5), the provenance policy and
  the user-captured-files follow-up, and how P1-01/02/03 and P0-07 consume the corpus.
  **Files:** `fixtures/src/manifest.test.ts`, `fixtures/src/structure.test.ts`,
  `fixtures/README.md` (final), `fixtures/src/author.test.ts`.
  **Depends on:** Steps 1–7

## Edge Cases

- Header exactly 36 cards: END is the last card of the block and no padding block follows —
  vs. a 37-card header where END sits alone in a second, otherwise space-padded block. Both
  shapes exist in the edge set (off-by-one block-loop bugs in P1-01 die here).
- CONTINUE card whose continued string never closes its quote — must be a _malformed_ fixture
  with `BAD_CONTINUE`, distinct from the _valid_ CONTINUE fixture with LONGSTRN.
- SGPro timestamps carry seven fractional digits (`2023-05-25T06:45:26.0000000`) — more
  precision than JS `Date` holds; the manifest stores the expected value as the original
  string so P1-01 decides truncation policy explicitly, not accidentally.
- Both EXPOSURE and EXPTIME present (N.I.N.A.) vs only one of them — manifests must not
  assume EXPTIME always exists.
- `OBJECT = 'M 31 Panel 1'` (mosaic) and `OBJECT` absent (SharpCap EAA) — DD-005 resolution
  paths 1 and 5 need corpus coverage now so P1-04+/catalog issues don't retrofit fixtures.
- FILTER strings that normalize to the same canonical filter (`'Ha 3nm'` vs `'Halpha'`) and
  a dual-band OSC filter (`'L-eXtreme'`) — DD-005 table coverage.
- Git on Windows converting bytes in fixture binaries: without `.gitattributes` `binary`
  markings, a `0x0D0A` sequence inside a header could be rewritten and every determinism/
  structure test would fail only on the Windows CI leg.
- Prettier/ESLint attempting to format committed `.json` manifests vs the generator's
  `generation-summary.json` in a gitignored dir — manifests are prettier-formatted source;
  generated output must be excluded via `.prettierignore`-effective paths (gitignored dir).
- `exifr` failing to parse a hand-built CR3: the CMT box payload must be genuine
  little-endian TIFF; if minimal CR3 proves unparseable by exifr, the fixture stays (it is
  still a valid provenance-clean sample) but its manifest `notes` must record the exifr
  limitation and P1-03 planning must be informed — do not silently drop CR3 coverage.
- Generator asked for `--count 0` or a distribution summing to ≠ 1.0 — normalize weights,
  reject nonpositive counts with a clear CLI error (exit code, no partial output).
- Generator `--out` pointed at an existing non-empty directory — refuse rather than
  interleave with (or appear to overwrite) previous runs; never delete anything
  (non-destructive guarantee applies to tooling too).

## Invariant Checklist

- [x] Non-destructive: authoring/generator scripts only write inside `fixtures/` (committed
      sets) or the explicit `--out` directory; nothing modifies, moves, or deletes existing
      files — the generator refuses non-empty targets
- [x] Layering: no `packages/core` changes at all in this issue; all builder logic lives in
      the dev-only `fixtures` workspace package; fs usage is confined to the authoring/
      generator entry points, builders are pure (Buffer in/out)
- [x] DB: N/A — no schema, no migrations, no runtime DB code
- [x] Timestamps stored UTC: all DATE-OBS fixture values are UTC; DATE-LOC fixtures exist
      precisely to test that local time is _not_ what gets persisted
- [x] Long-running work through worker queue: N/A — dev-time CLI tooling only, nothing runs
      inside the app
- [x] Performance budgets: no runtime code paths touched; this issue _enables_ P0-07's
      budget enforcement (10k synthetic headers, deterministic seeds for stable baselines)

## Out of Scope

- The actual parsers: FITS (P1-01), XISF (P1-02), RAW/exifr adapter (P1-03) — this issue
  ships expectations, not implementations; `expected.keywords` is the contract they meet
- The capture-software profile table in `packages/core` (DD-004) — fixtures encode the
  quirks; the mapping table is parser-side work
- Benchmark harness, baselines, CI regression gates (P0-07) — this issue only provides its
  feedstock
- Target resolution / filter normalization logic and the OpenNGC catalog build (DD-005,
  P1-04+)
- Replacing synthesized fixtures with user-captured real files — explicit follow-up,
  supported by the manifest's `user-captured` provenance method
- Compressed/tiled FITS, multi-HDU extensions, XISF distributed (non-monolithic) units,
  full-sensor-data RAW samples — beyond MVP parser scope (PRD §8.1/8.2)
- Any `packages/db`, `packages/desktop`, IPC, or worker-queue changes

## Open Questions

None. Defaults chosen (flag in PR if any looks wrong):

1. **Provenance:** all fixtures synthesized to documented conventions with cited sources and
   CC0 project-authored licensing — the only license-clean option available to this run;
   "real-world" acceptance wording is met at the conventions level, with user-captured
   replacements as a documented follow-up.
2. **`fixtures/` becomes a workspace member** to host tooling and structural tests (rather
   than a bare data directory with scripts elsewhere) — keeps fixture data, builders, and
   validation colocated; DD-002's layout lists `fixtures/` at root, which is unchanged.
3. **One manifest per fixture set** (`fits/`, `xisf/`, `raw/`; malformed entries live inside
   their format's manifest) per the existing `fixtures/README.md` wording, plus a single
   shared JSON Schema.
4. **Fixture binaries are committed** _and_ regenerable from checked-in definitions, with a
   byte-determinism test — reviewability of binaries comes from the declarative definitions.

Plan written: docs/plans/p0-06-fixtures-library.md — 8 steps
