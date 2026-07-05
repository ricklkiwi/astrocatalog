# DD-004: File Scanning & Indexing Pipeline

**Status:** Accepted
**Date:** 2026-07-05

## Decision

A staged, resumable pipeline running in a worker pool. Stages are decoupled so cheap stages complete fast and expensive stages trail behind.

```
Stage 1 DISCOVER   walk watch folders → upsert files rows (path, size, mtime)
Stage 2 PARSE      header-only read → frames row (FITS 2880-byte blocks /
                   XISF XML header / RAW EXIF)
Stage 3 RESOLVE    frame classification, target resolution, filter
                   normalization, equipment profile detection (pure functions
                   in packages/core)
Stage 4 GROUP      session detection + calibration auto-matching (set-based,
                   runs after a scan batch completes)
Stage 5 ENRICH     background: SHA-256 hashing → duplicate marking;
                   thumbnail generation (lowest priority)
```

## Rules

- **Incremental:** a file is re-parsed only if `size` or `mtime` changed. Unchanged files skip stages 2-3.
- **Header-only reads:** Stage 2 reads at most the header region (seek + bounded read), never the pixel payload. This is what makes "10,000 FITS in < 5 min" feasible.
- **Resumable:** each stage records progress in `scan_jobs`; app restart resumes pending work.
- **Move detection:** a "new" file whose (size, sha256) matches a `missing` file is treated as a move — the `files` row is re-pathed, preserving frame/session/project links.
- **Classification order** for frame type: `IMAGETYP` header → path heuristics (`/lights/`, `/darks/`, `_flat_`, etc.) → `unknown` (user resolves in UI). Source recorded in `frame_type_source`; manual overrides always win and survive rescans.
- **Watch mode:** chokidar watches active folders; new files debounce 30 s (capture software writes sequentially all night) then enter the pipeline.
- **Error isolation:** a malformed file logs a parse error on its `files` row and never aborts the batch.
- **Benchmarks in CI:** a synthetic 10k-header fixture set must scan (stages 1-3) under a CI-adjusted time budget; regression fails the build.

## Header parsing specifics

- FITS: read 2880-byte blocks until `END` card; parse 80-char cards; handle CONTINUE convention, quoted strings, comments. Tolerate non-standard keywords (store all in `headers_json`).
- XISF: validate signature, read XML header block length from the 16-byte header, parse `<Image>` FITSKeyword/Property elements.
- Capture-software quirks (N.I.N.A. vs SGPro vs APT vs SharpCap vs ASIStudio keyword differences) are handled by a **software profile table in `packages/core`** — a data-driven mapping, unit-tested against the fixtures library. Community-extensible in later versions.
