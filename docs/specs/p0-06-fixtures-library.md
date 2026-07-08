# Spec: [P0-06] Fixtures library of real-world file headers

**Slug:** p0-06-fixtures-library **Issue:** #6 **Plan:** docs/plans/p0-06-fixtures-library.md **Date:** 2026-07-06

## Definition of Done

### Functional Requirements

- [ ] Given the `fixtures` workspace package, when `pnpm install` is run at the repo root, then `fixtures` resolves as a workspace member (appears in `pnpm -r list --depth -1`) with private `@astrotracker/fixtures` package name.
- [ ] Given the installed workspace, when `pnpm --filter @astrotracker/fixtures lint` and `pnpm --filter @astrotracker/fixtures test` are run, then both exit 0, and `pnpm -r lint`/`pnpm -r test` at the root also pick up and pass the fixtures package.
- [ ] Given `fixtures/fits/{nina,sgpro,apt,sharpcap,asistudio,voyager}/*.fits`, when counted, then there are exactly 27 valid program fixtures distributed as: N.I.N.A. 6, SGPro 5, APT 4, SharpCap 4, ASIStudio/ASIAIR 4, Voyager 4 — 6 distinct capture programs, satisfying "≥ 25 fixtures across ≥ 5 programs."
- [ ] Given `fixtures/fits/manifest.json`, when read, then every file under `fixtures/fits/**/*.fits` (program + edge + malformed) has exactly one corresponding manifest entry and every manifest entry's `file` path resolves to an existing file (no orphans either direction).
- [ ] Given a valid FITS fixture's manifest entry, when its `expected.keywords` is compared against PRD §8.2's critical keyword list (OBJECT, IMAGETYP, FILTER, EXPTIME, DATE-OBS, TELESCOP, INSTRUME, CCD-TEMP, GAIN, OFFSET, XBINNING, YBINNING, NAXIS1, NAXIS2, RA, DEC), then every critical keyword actually present as a card in that file appears in `expected.keywords` with its typed value (absent-by-design keywords, e.g. SharpCap's missing OBJECT, are simply not required — see Edge Cases below).
- [ ] Given `fixtures/src/author.ts`, when run twice in succession (`pnpm --filter @astrotracker/fixtures author` then re-run), then every committed fixture binary under `fixtures/{fits,xisf,raw}/**` is byte-identical across both runs (determinism guard, verified by SHA-256 comparison in a test).
- [ ] Given a fixture defined with `OBJECT = 'M 31 Panel 1'` (N.I.N.A. mosaic-panel light), when its manifest entry is read, then `expected.keywords.OBJECT` is exactly `'M 31 Panel 1'` (DD-005 panel-resolution groundwork; parsing, not resolution, is in scope here).
- [ ] Given `fixtures/src/generate.ts`, when invoked as `pnpm fixtures:generate -- --count 500 --out <tmp-dir> --seed 42`, then it exits 0, writes exactly 500 header-only `.fits` files plus a `generation-summary.json` recording seed/args/realized distributions into `<tmp-dir>`, and every generated file is structurally valid per the Step-8 structural checks (2880-byte multiple, SIMPLE first card, END present).
- [ ] Given two generator invocations with identical `--seed` and identical other arguments targeting two different empty output directories, when their outputs are compared file-by-file (by name and byte content), then they are byte-identical (deterministic PRNG requirement for P0-07 CI baselines).
- [ ] Given `--objects "M 31:0.5,M 42:0.5"`, `--filters "Ha:0.5,OIII:0.5"`, `--imagetypes "LIGHT:0.8,DARK:0.2"` and `--count 1000`, when the generator runs, then the realized OBJECT/FILTER/IMAGETYP distributions across the 1000 generated files are within a stated tolerance (e.g. ±5 percentage points) of the requested weights, and `generation-summary.json` records the realized distribution alongside the requested one.
- [ ] Given `--date-start 2026-01-01 --nights 20`, when the generator runs, then all generated DATE-OBS values fall within 20 distinct calendar nights starting at the given date, with intra-night timestamps spaced by exposure length plus a settle gap (no two frames on the same night with identical or out-of-order DATE-OBS).
- [ ] Given `--count 0` or a distribution string whose weights sum to a value where the normalized total is not 1.0 after normalization is impossible (e.g. all-zero weights) or a nonpositive `--count`, when the generator runs, then it exits with a non-zero exit code and a clear error message, and writes no files to `--out`.
- [ ] Given `--out` pointed at a pre-existing non-empty directory, when the generator runs, then it exits non-zero with an error and does not write, modify, or delete any file in or under that directory.
- [ ] Given `fixtures/xisf/*.xisf`, when read, then there are exactly 3 valid samples (PixInsight-style with FITSKeyword + Property elements, N.I.N.A.-style, minimal) and exactly 2 malformed samples (unclosed-tag XML, wrong signature), each with a `fixtures/xisf/manifest.json` entry.
- [ ] Given the PixInsight-style XISF sample's manifest entry, when its `expected.keywords` is compared to the N.I.N.A.-style FITS fixture's manifest keywords for the same conceptual frame, then both use identical normalized keyword names (e.g. both key exposure time the same way) so P1-01/P1-02 share one `FrameMetadata` shape.
- [ ] Given `fixtures/raw/*.{cr2,nef,arw}` valid samples, when the fixtures package's structural test runs `exifr` against each, then `exifr` returns ExposureTime, ISOSpeedRatings, and DateTimeOriginal values matching the manifest's `expected.keywords` exactly, and exactly one of the three has an `OffsetTimeOriginal`/offset field present while the other(s) do not.
- [ ] Given the CR3 sample, when the fixtures package's structural test runs `exifr` against it, then either it parses successfully and its manifest keywords match, or (if exifr cannot parse the hand-built box structure) the manifest's `notes` field records the exifr limitation explicitly — the fixture is not silently dropped either way.
- [ ] Given `fixtures/raw/manifest.json` entries, when read, then `expected.keywords.OBJECT` and `expected.keywords.FILTER` are both `null` for every RAW sample (EXIF has no such fields; P1-03 path-heuristics handoff).
- [ ] Given the 6 edge-case valid FITS fixtures (CONTINUE long string, EXPOSURE-only, EXPTIME-only, 36-card END-in-block-one, 37-card END-in-block-two, COMMENT/HISTORY/blank mix, HIERARCH-style card), when parsed structurally, then each demonstrates its named property (e.g. the 36-card file's END is the last of exactly one 2880-byte block; the 37-card file's END sits alone in a second, otherwise-padded block).
- [ ] Given the 10 malformed FITS fixtures, when each is inspected against its manifest's `expected.errorCode`, then the file demonstrably exhibits that exact defect (e.g. the `MISSING_END` fixture is confirmed to contain no `END ` card anywhere in its bytes; the truncated fixture's size is confirmed not a multiple of 2880).
- [ ] Given every fixture's manifest entry, when its `provenance` field is read, then `method` is one of `synthesized-to-conventions | user-captured | cc0-import`, `sources` is a non-empty array of URLs when `method` is `synthesized-to-conventions`, and `license` is `CC0-1.0` for every currently-committed fixture (all are project-authored synthesized-to-conventions in this issue).
- [ ] Given `fixtures/manifest.schema.json`, when every manifest JSON file (`fixtures/fits/manifest.json`, `fixtures/xisf/manifest.json`, `fixtures/raw/manifest.json`) is validated against it, then validation passes with zero schema errors.
- [ ] Given `fixtures/README.md`, when read, then it documents: fixture counts per program, the provenance policy (why synthesized-to-conventions was chosen for this run, cited per-program sources), the `user-captured` follow-up path, the manifest format, and how to run `author`/`generate`.
- [ ] Given `.gitattributes` at repo root, when read, then `*.fits`, `*.xisf`, `*.cr2`, `*.cr3`, `*.nef`, `*.arw` are each marked `binary`.
- [ ] Given `.gitignore`, when read, then `fixtures/generated/` (or the generator's default `--out` directory) is ignored.
- [ ] Given `vitest.workspace.ts`, when read, then it includes a project entry for the `fixtures` package so `pnpm -r test` executes its suite.

### Data Integrity

- [ ] N/A — no database schema, table, or migration is introduced by this issue (fixtures are static files + JSON manifests, no runtime DB code).
- [ ] `fixtures/manifest.schema.json` is the closed contract for manifest shape: `file`, `format` (`fits|xisf|raw`), `description`, `provenance` (`method`, `program`, `emulatesVersion`, `sources[]`, `license`, `date`), `expected` (`{status:"ok", keywords, cardCount, headerBytes, notes}` or `{status:"error", errorCode}` with the closed enum `TRUNCATED_HEADER | MISSING_END | INVALID_CARD | BAD_CONTINUE | NOT_FITS | EMPTY_FILE | MALFORMED_XML | BAD_SIGNATURE | UNRECOGNIZED_RAW`) — validated as a rule before any manifest is considered committed (Step 8 schema test).
- [ ] Every manifest entry's `expected.errorCode` (when `status: "error"`) is one of the closed enum values; the Reviewer rejects any manifest using an errorCode string not in the schema enum.

### Core Invariants

- [ ] No code path in the diff writes, moves, renames, or deletes files outside `fixtures/` (committed sets) or the generator's explicit `--out` directory — Reviewer greps `fixtures/src/**` for `fs.write*`/`fs.rename*`/`fs.unlink*`/`fs.rm*` calls and verifies every target path is derived from `fixtures/` or the `--out` CLI argument, never from a hardcoded external or ambient path.
- [ ] New domain logic is in packages/core with no Electron/fs imports — N/A/adapted: this issue introduces no `packages/core` changes at all; instead, Reviewer verifies `fixtures/src/lib/{fits,xisf,tiff-exif,prng}.ts` (the builder libraries) contain no `fs`/`node:fs`/`electron` imports — they are pure Buffer-in/Buffer-out functions; fs usage is confined to `fixtures/src/author.ts` and `fixtures/src/generate.ts` only.
- [ ] All persisted timestamps are UTC — applies: every DATE-OBS value across all committed FITS/XISF fixtures is UTC; DATE-LOC fixtures exist specifically as a negative-control (Reviewer spot-checks at least one N.I.N.A. and one SGPro fixture where DATE-OBS ≠ DATE-LOC, confirming they are genuinely different values, not copies).
- [ ] Manual user overrides (target/filter/type/session assignments) survive a rescan — N/A, this issue has no scanning, assignment, or session logic; it ships static test data only.

### Performance

- [ ] N/A for this issue directly — no scanning, query, thumbnail, or UI-list code path is touched. However, the generator's determinism and non-destructive `--out` guarantees are a hard prerequisite for P0-07's benchmark harness; Reviewer confirms the generator can produce 10,000 files (smoke-run with a smaller count, e.g. 1,000, is acceptable for this issue's own test suite — a full 10k timed run is P0-07's concern, not this issue's).

### Tests

- [ ] Table-driven unit tests in `fixtures/src/lib/fits.test.ts` cover: 80-char card serialization/padding, string quoting with `''` escaping, CONTINUE + LONGSTRN emission, COMMENT/HISTORY/blank cards, END card placement at block boundaries (36th vs 37th card), and deliberate breakage modes (unpadded block, missing END, overlong/short card, non-ASCII byte).
- [ ] `fixtures/src/lib/xisf.test.ts` covers: correct 16-byte signature + little-endian header-length encoding, and a broken-XML / wrong-signature negative case.
- [ ] `fixtures/src/lib/tiff-exif.test.ts` covers: IFD0 Make/Model + EXIF IFD ExposureTime/ISOSpeedRatings/DateTimeOriginal roundtrip via `exifr`, the with-offset vs without-offset case, and the CR3 ISO-BMFF box structure.
- [ ] `fixtures/src/manifest.test.ts` (Step 8a–c): every manifest validates against `manifest.schema.json`; every fixture file has exactly one manifest entry and vice versa; every entry cites ≥1 provenance source URL and a license.
- [ ] `fixtures/src/structure.test.ts` (Step 8d–f): valid FITS fixtures are byte-structurally sound (size multiple of 2880, printable-ASCII header bytes, SIMPLE first card, END present, every manifest keyword appears verbatim in a card); each malformed fixture demonstrably exhibits its declared defect; XISF signatures/header lengths are internally consistent and XML is well-formed per `fast-xml-parser`.
- [ ] `fixtures/src/author.test.ts` (Step 8g): re-running `author.ts` reproduces every committed binary byte-for-byte.
- [ ] `fixtures/src/generate.test.ts` (Step 8h + Step 7): same seed → identical bytes across two runs; requested distributions land within tolerance for a ≥1,000-file run; `--count 0`, degenerate weights, and non-empty `--out` are all rejected with non-zero exit and no partial output.
- [ ] All existing tests still pass (`pnpm -r test`) — no other package's tests regress from adding the `fixtures` workspace member.
- [ ] E2E: N/A — this issue has no UI or Electron surface.

## Out of Scope

- The actual parsers: FITS (P1-01), XISF (P1-02), RAW/exifr adapter (P1-03) — this issue ships `expected.keywords` as a contract, not an implementation; the Reviewer must not require parser code in this diff.
- The capture-software profile table in `packages/core` (DD-004) — fixtures encode program quirks in data/manifests only; the mapping/detection table is P1-05's job.
- Benchmark harness, baselines, CI regression gates, and any timed 10k-file run (P0-07) — this issue only proves the generator _can_ produce a large, deterministic, distribution-controlled batch at a smaller scale; the Reviewer must not require a full 10,000-file timed benchmark here.
- Target resolution / filter normalization _logic_ and the OpenNGC catalog build (DD-005, P1-04+) — fixtures deliberately contain OBJECT/FILTER strings that exercise these paths (`M 31 Panel 1`, `Ha 3nm` vs `Halpha`, `L-eXtreme`, absent OBJECT/FILTER), but no resolution or normalization code is in scope.
- Replacing synthesized fixtures with genuinely user-captured real files — explicitly deferred; the manifest's `user-captured` provenance method exists to support this later without a format change. The Reviewer must not reject this issue for lacking real captured files — the plan's documented deviation (see below) covers this.
- Compressed/tiled FITS, multi-HDU extensions, XISF distributed (non-monolithic) units, full-sensor-data RAW samples — beyond MVP parser scope per PRD §8.1/8.2.
- Any `packages/db`, `packages/desktop`, IPC, or worker-queue changes — none exist in this diff.
- Exact prose/wording of `fixtures/README.md` beyond the required content list above — Reviewer checks content presence, not phrasing.

### Documented deviation: provenance interpretation (flag for Reviewer, do not treat as a defect)

The issue's acceptance wording says "real-world fixtures... license-clean (self-captured or CC0)". This autonomous run has no access to user-captured files and downloading files of unclear license is disallowed. The plan's chosen interpretation — accepted as meeting the criterion — is:

- Every fixture is **synthesized byte-exactly to each program's publicly documented header conventions**, not copied from any real captured file.
- Each manifest entry's `provenance.method` is honestly `"synthesized-to-conventions"` (never falsely `"user-captured"`), `provenance.license` is `"CC0-1.0"` (project-authored, so licensing is clean by construction), and `provenance.sources` cites the actual public documentation URL(s) the header conventions were derived from (N.I.N.A. FITS docs, SGPro help, APT guide/forum, SharpCap docs/forums, ZWO/ASIStudio manuals, Voyager wiki, FITS 4.0 standard, XISF 1.0 spec, PRD §8.2).
- This satisfies "license-clean with provenance noted" by construction (nothing is downloaded; everything is authored). It reinterprets "real-world" as "real-world _conventions_, faithfully reproduced and cited" rather than "bytes from an actual captured file."
- **Reviewer check:** confirm every manifest entry's `provenance.method` is truthfully `synthesized-to-conventions` (not mislabeled `user-captured`), that `sources` is non-empty and points to a real, citable public document per program, and that the PR description explicitly calls out this interpretation (per the plan). This is not grounds for rejection; it is grounds for verifying honesty of labeling.

## Test Hints

- **program-fixture-count**: `find fixtures/fits/{nina,sgpro,apt,sharpcap,asistudio,voyager} -name '*.fits' | wc -l` equals 27; per-directory counts are 6/5/4/4/4/4 respectively.
- **manifest-schema-valid**: for each of `fixtures/fits/manifest.json`, `fixtures/xisf/manifest.json`, `fixtures/raw/manifest.json`, run an AJV (or equivalent) validation against `fixtures/manifest.schema.json`; assert zero errors.
- **manifest-file-bijection**: build the set of files on disk under `fixtures/{fits,xisf,raw}/**/*.{fits,xisf,cr2,cr3,nef,arw}` and the set of `file` values across all manifests; assert the two sets are identical (no orphan file, no dangling manifest entry).
- **nina-panel-keyword**: parse the N.I.N.A. mosaic-panel fixture's manifest entry, assert `expected.keywords.OBJECT === 'M 31 Panel 1'`.
- **sgpro-precision-string**: parse the SGPro 7-fractional-digit DATE-OBS fixture's manifest entry, assert `expected.keywords['DATE-OBS']` is stored as the exact original string `'2023-05-25T06:45:26.0000000'` (or equivalent per definition), not a truncated/rounded value.
- **block-boundary-pair**: parse the two END-placement edge fixtures; assert the 36-card file's byte length is exactly 2880 and the 37-card file's byte length is exactly 5760 with the second block END-padded with spaces.
- **malformed-defect-match**: for each of the 10 malformed fixtures, assert the specific declared defect is present — e.g. `MISSING_END`: no `'END'` bytes at any 80-byte-aligned card offset; `TRUNCATED_HEADER`: `size % 2880 !== 0`; `BAD_CONTINUE`: an unterminated quoted string in a CONTINUE card; `EMPTY_FILE`: size === 0.
- **determinism-author**: run `author.ts`, SHA-256 every committed binary, re-run `author.ts`, SHA-256 again; assert identical hash sets.
- **determinism-generate**: run `generate.ts --seed 7 --count 200 --out <tmpA>` and again with `--out <tmpB>`; assert the file lists and byte contents are identical between `<tmpA>` and `<tmpB>`.
- **generate-distribution-tolerance**: run `generate.ts --count 1000 --seed 1 --objects "M 31:0.6,M 42:0.4"`; count OBJECT occurrences in generated files; assert each realized proportion is within ±0.05 of 0.6/0.4.
- **generate-rejects-nonempty-out**: create `<tmpDir>` with one dummy file in it; run `generate.ts --out <tmpDir> --count 10`; assert non-zero exit and that the dummy file plus directory contents are unchanged (no new files written).
- **generate-rejects-bad-args**: run `generate.ts --count 0` and `generate.ts --filters "Ha:0,OIII:0"`; assert both exit non-zero with no files written to any `--out`.
- **raw-exifr-roundtrip**: run `exifr.parse()` over each valid CR2/NEF/ARW fixture; assert `ExposureTime`, `ISOSpeedRatings`, `DateTimeOriginal` match the manifest's `expected.keywords` exactly; assert exactly one sample has an offset field populated.
- **raw-object-filter-null**: for every `fixtures/raw/manifest.json` entry, assert `expected.keywords.OBJECT === null` and `expected.keywords.FILTER === null`.
- **provenance-completeness**: for every manifest entry across all three manifests, assert `provenance.method` is a valid enum value, `provenance.license === 'CC0-1.0'`, and `provenance.sources.length >= 1` with each entry a well-formed URL string.
- **gitattributes-binary**: read `.gitattributes`, assert `*.fits binary`, `*.xisf binary`, `*.cr2 binary`, `*.cr3 binary`, `*.nef binary`, `*.arw binary` (or equivalent glob coverage) are present.

Spec written: docs/specs/p0-06-fixtures-library.md — 43 criteria
