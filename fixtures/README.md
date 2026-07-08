# fixtures/ — AstroTracker test fixture corpus (P0-06)

Sample file headers used by the table-driven unit tests in `packages/core` (DD-002), the
Phase 1 parser issues (P1-01 FITS, P1-02 XISF, P1-03 RAW), and the P0-07 benchmark harness.
This directory is a private workspace package (`@astrotracker/fixtures`) so the corpus, its
authoring tooling, and its structural validation tests live together and run under
`pnpm -r lint` / `pnpm -r test`.

## Layout

```
fixtures/
  manifest.schema.json      JSON Schema every manifest below validates against
  fits/
    manifest.json           one entry per FITS fixture (program + edge + malformed)
    nina/      *.fits       6  N.I.N.A.-convention fixtures (mono NB light, OSC light,
                               dark, flat, bias, mosaic-panel light)
    sgpro/     *.fits       5  SGPro-convention fixtures (7-digit-fraction timestamps,
                               missing-FOCALLEN variant, dark, flat, sexagesimal pointing)
    apt/       *.fits       4  APT-convention fixtures (DSLR light without FILTER, CCD
                               light, dark, flat)
    sharpcap/  *.fits       4  SharpCap-convention fixtures (EAA light without OBJECT,
                               vendor-keyword light, dark, flat)
    asistudio/ *.fits       4  ASIStudio/ASIAIR-convention fixtures (OSC light, gain
                               conventions, dark, flat)
    voyager/   *.fits       4  Voyager-convention fixtures (full pointing set, light,
                               dark, flat)
    edge/      *.fits       6  valid-but-tricky: CONTINUE+LONGSTRN long string,
                               EXPOSURE-only, EXPTIME-only, END as 36th card of block 1,
                               END alone in block 2, COMMENT/HISTORY/blank/HIERARCH mix
    malformed/ *.fits       10 invalid files with expected structured error codes
  xisf/
    manifest.json
    *.xisf                  3 valid (PixInsight-style, N.I.N.A.-style, minimal)
                            + 2 malformed (broken XML, wrong signature)
  raw/
    manifest.json
    *.cr2 *.cr3 *.nef *.arw 4 minimal-valid EXIF containers + 2 malformed
  src/                      authoring library, definitions, generator CLI, tests
  generated/                default output of the bulk generator (gitignored)
```

**Totals: 27 valid program FITS across 6 capture programs (≥ 25 across ≥ 5 required), 6 edge,
10 malformed, 5 XISF, 6 RAW — 54 committed fixtures.**

All FITS/XISF fixtures are **header-only**: `NAXIS1`/`NAXIS2` (or the XISF `location`
attachment) declare image data, but the files end after the header region. This is
deliberate — DD-004 mandates header-only reads, so a parser that reads past the header
fails loudly on this corpus instead of passing by accident.

## Manifest format

Each set has one `manifest.json` validated against [`manifest.schema.json`](./manifest.schema.json):

```jsonc
{
  "set": "fits",
  "entries": [
    {
      "file": "fits/nina/nina-light-mono-ha.fits", // relative to fixtures/
      "format": "fits",
      "description": "…",
      "provenance": {
        "method": "synthesized-to-conventions", // | user-captured | cc0-import
        "program": "N.I.N.A.",
        "emulatesVersion": "3.x",
        "sources": ["https://nighttime-imaging.eu/docs/master/site/"],
        "license": "CC0-1.0",
        "date": "2026-07-06",
      },
      "expected": {
        // valid files: the parse contract P1-01/02/03 are tested against
        "status": "ok",
        "keywords": { "OBJECT": "M 31", "EXPTIME": 300 /* … */ },
        "cardCount": 42,
        "headerBytes": 2880,
        "notes": "…",
      },
      // malformed files instead carry:
      // "expected": { "status": "error", "errorCode": "MISSING_END", "notes": "…" }
    },
  ],
}
```

- `expected.keywords` covers **at minimum every PRD §8.2 critical keyword physically present
  in the file** (OBJECT, IMAGETYP, FILTER, EXPTIME, DATE-OBS, TELESCOP, INSTRUME, CCD-TEMP,
  GAIN, OFFSET, XBINNING, YBINNING, NAXIS1, NAXIS2, RA, DEC). Keywords absent by design
  (e.g. SharpCap's missing OBJECT, APT DSLR's missing FILTER) simply have no key; RAW
  entries carry explicit `"OBJECT": null, "FILTER": null` because EXIF has no such fields
  (P1-03 hands those to path heuristics).
- `errorCode` is a **closed enum** (see schema): `TRUNCATED_HEADER`, `MISSING_END`,
  `INVALID_CARD`, `BAD_CONTINUE`, `NOT_FITS`, `EMPTY_FILE`, `MALFORMED_XML`,
  `BAD_SIGNATURE`, `UNRECOGNIZED_RAW`. Malformed entries' `notes` state what a conforming
  parser must do: return the structured error, never throw across the worker boundary,
  never hang, never abort the batch (DD-004 error isolation).
- XISF manifests use the **same normalized keyword names** as the FITS manifests
  (`OBJECT`, `EXPTIME`, …) so P1-01 and P1-02 share one `FrameMetadata` shape.

## Provenance policy

Every committed fixture is marked `"method": "synthesized-to-conventions"` with
`"license": "CC0-1.0"`: the bytes were **authored in this repository, byte-exactly to each
program's publicly documented header conventions** — never copied or downloaded from a real
captured file. This is the only license-clean option for an autonomous build (no access to
user captures; downloading astronomy files of unclear license is not acceptable), and it
satisfies "license-clean with provenance noted" by construction. Each entry's
`provenance.sources` cites the public documentation the conventions were derived from:

| Program          | Primary sources                                                              |
| ---------------- | ---------------------------------------------------------------------------- |
| N.I.N.A.         | https://nighttime-imaging.eu/docs/master/site/ (FITS keyword documentation)  |
| SGPro            | https://www.sequencegeneratorpro.com/ (help: Data Stored in the FITS Header) |
| APT              | https://www.astrophotography.app/ (user guide)                               |
| SharpCap         | https://www.sharpcap.co.uk/ (user manual)                                    |
| ASIStudio/ASIAIR | https://www.zwoastro.com/ (ASIAIR/ASIStudio manuals)                         |
| Voyager          | https://software.starkeeper.it/ (Voyager documentation)                      |
| FITS format      | https://fits.gsfc.nasa.gov/fits_standard.html (FITS 4.0, incl. CONTINUE)     |
| XISF format      | https://pixinsight.com/xisf/ (XISF 1.0 specification)                        |
| EXIF/TIFF tags   | https://exiftool.org/TagNames/EXIF.html                                      |
| CR3 container    | https://github.com/lclevy/canon_cr3                                          |

**Follow-up (deliberate):** the manifest schema also defines a `"user-captured"` provenance
method so genuinely real, user-donated files can replace or extend the synthesized corpus
later without any manifest-format change. Until then, "real-world" is met at the level of
_real-world conventions, faithfully reproduced and cited_.

## Regenerating the committed corpus

Fixture binaries are committed **and** fully regenerable from the declarative definitions in
`src/definitions/*.ts`:

```sh
pnpm --filter @astrotracker/fixtures run author
```

The authoring pipeline is deterministic — a CI test (`src/author.test.ts`) rebuilds every
binary and manifest in memory and asserts byte-identity with what is committed. If you edit a
definition, re-run `author` and commit both the definition and the regenerated output.

### Adding a fixture

1. Add a definition (cards/XML/EXIF tags + `description`, `provenance`, `expected`) in the
   matching `src/definitions/*.ts` file. Cite real public documentation URLs in
   `provenance.sources` — never fabricate a URL, and never label synthesized output as
   `user-captured`.
2. Run `pnpm --filter @astrotracker/fixtures run author`.
3. Run `pnpm --filter @astrotracker/fixtures test` — the structural suite enforces
   manifest⇄file bijection, schema validity, provenance completeness, and byte determinism.

## Bulk synthetic generator (P0-07 feedstock)

```sh
pnpm fixtures:generate -- --count 10000 --out fixtures/generated --seed 42 \
  [--profile nina|sgpro|apt|sharpcap|asistudio|voyager] \
  [--objects "M 31:0.4,M 42:0.35,NGC 7000:0.25"] \
  [--filters "Ha:0.4,OIII:0.3,SII:0.3"] \
  [--exptime "120,300,600"] \
  [--imagetypes "LIGHT:0.8,DARK:0.1,FLAT:0.1"] \
  [--date-start 2026-01-01] [--nights 20]
```

Produces N structurally valid header-only FITS files (same builders as the committed corpus)
plus a `generation-summary.json` recording the seed, arguments, and realized distributions.
Guarantees:

- **Deterministic:** identical seed + arguments → byte-identical output on every OS
  (mulberry32 PRNG; no timestamps or absolute paths in any output byte).
- **Non-destructive:** refuses to run against an existing non-empty `--out` directory and
  never writes outside it; bad arguments (nonpositive `--count`, all-zero weights) exit
  non-zero without writing anything.
- **Session-shaped:** DATE-OBS values spread across `--nights` nights from `--date-start`
  with intra-night cadence of exposure length + settle gap, so DD-006 session-grouping work
  can use the output too.

## How downstream issues consume this corpus

- **P1-01 (FITS parser):** parses every `fits/` fixture; must produce `expected.keywords`
  for `status: "ok"` entries and the exact `errorCode` for malformed ones, reading only the
  header region.
- **P1-02 (XISF parser):** same contract against `xisf/`; keyword names are shared with FITS.
- **P1-03 (RAW/exifr adapter):** same contract against `raw/`; `OBJECT`/`FILTER` are `null`
  by design. The valid samples are pre-verified against `exifr` by this package's own tests.
- **P0-07 (benchmarks):** uses the generator for its 10k-header corpus; determinism keeps
  stored baselines comparable across runs and OSes.
