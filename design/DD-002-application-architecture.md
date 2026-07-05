# DD-002: Application Architecture

**Status:** Accepted
**Date:** 2026-07-05

## Decision

Three-process Electron architecture with strict layering. The renderer is a pure UI client; all file-system and database access lives in the main process and worker threads.

```
┌────────────────────────────────────────────────────────┐
│ Renderer (React + TS)                                  │
│  Pages: Dashboard | Targets | Sessions | Calibration   │
│         Projects | Equipment | Settings                │
│  - TanStack Query against typed IPC                    │
│  - No direct fs/db/network access (contextIsolation)   │
└──────────────────────┬─────────────────────────────────┘
                       │ typed IPC (electron-trpc)
┌──────────────────────┴─────────────────────────────────┐
│ Main process (Node/TS)                                 │
│  ┌───────────────┐ ┌──────────────┐ ┌───────────────┐  │
│  │ CatalogService │ │ ScanOrch-    │ │ SyncService   │  │
│  │ (queries, agg) │ │ estrator     │ │ (Phase 2+)    │  │
│  └───────┬───────┘ └──────┬───────┘ └───────────────┘  │
│          │  Drizzle/SQLite │ job queue                  │
└──────────┼────────────────┼────────────────────────────┘
           │                │ worker_threads pool
┌──────────┴────────────────┴────────────────────────────┐
│ Workers: FileScanner | HeaderParser | Hasher |         │
│          ThumbnailGenerator                             │
└─────────────────────────────────────────────────────────┘
```

## Module layout (monorepo)

```
astrocatalog/
├── packages/
│   ├── core/          # Pure domain logic, zero Electron deps
│   │   ├── fits/      # FITS header parser
│   │   ├── xisf/      # XISF header parser
│   │   ├── raw/       # EXIF extraction adapters
│   │   ├── catalog/   # Target resolution, session detection,
│   │   │              # calibration matching, integration math
│   │   └── types/     # Shared domain types
│   ├── db/            # Drizzle schema, migrations, repositories
│   ├── desktop/       # Electron app (main, preload, workers)
│   │   └── renderer/  # React UI
│   └── cloud/         # Phase 2+: Fastify API + recommendation engine
├── fixtures/          # Real-world FITS/XISF/RAW header samples
└── .github/workflows/
```

## Rules

1. `packages/core` is pure TypeScript with no Electron, no fs side effects in domain logic (parsers accept Buffers/streams). This is where ~all business logic and unit tests live.
2. Renderer communicates only through the typed IPC contract; every IPC procedure is defined once in a shared router type.
3. Long-running work (scan, hash, thumbnail) runs in a worker pool with a persistent job queue (jobs table in SQLite) so interrupted scans resume.
4. All timestamps stored UTC; session grouping applies local "astronomical day" logic at query/grouping time (see DD-006).
5. Non-destructive guarantee: no code path writes to user image files. The only writes outside the app data directory are explicit user-invoked exports.

## Consequences

- Coding agents can work on `core` (pure logic, heavily unit-tested) independently from `desktop` UI tasks — issues are parallelizable.
- The Phase 2 cloud service reuses `core` types and recommendation-relevant logic.
