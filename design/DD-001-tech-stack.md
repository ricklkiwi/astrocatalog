# DD-001: Technology Stack

**Status:** Accepted
**Date:** 2026-07-05
**Decision owner:** Rick Laird

## Decision

AstroTracker is built as an **Electron desktop application** with **React + TypeScript** UI and a **Node.js (TypeScript) main process**, backed by **SQLite** via `better-sqlite3`.

| Layer                    | Choice                                                                                 | Notes                                                                           |
| ------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Desktop shell            | Electron (latest LTS)                                                                  | Windows primary, macOS secondary; single codebase                               |
| Language                 | TypeScript (strict mode) everywhere                                                    | Shared types between main and renderer                                          |
| UI framework             | React 18+                                                                              | Component library: shadcn/ui + Tailwind CSS                                     |
| State management         | Zustand (UI state) + TanStack Query (data fetching from main process)                  | Keep it simple; no Redux                                                        |
| Build tooling            | Vite + electron-builder                                                                | Fast dev loop, cross-platform packaging                                         |
| Database                 | SQLite via better-sqlite3 (synchronous, runs in main/worker)                           | See DD-003 for schema                                                           |
| ORM/queries              | Drizzle ORM (typed schema + migrations)                                                | Raw SQL allowed for aggregation hot paths                                       |
| FITS parsing             | Custom TypeScript header-only parser (FITS headers are simple 2880-byte blocks)        | Full-image reads via `fitsjs`-style typed-array decode only for thumbnails      |
| XISF parsing             | Custom parser: XML header section per XISF spec                                        | Header-only for metadata                                                        |
| RAW EXIF                 | `exifr` (CR2/CR3/NEF/ARW support)                                                      | Header-only                                                                     |
| Image/thumbnail pipeline | `sharp` for stretch/resize/encode; custom debayer + STF autostretch in a worker thread | Cache as JPEG/WebP                                                              |
| File watching            | `chokidar`                                                                             | Watch-folder monitoring                                                         |
| Hashing                  | Node crypto SHA-256, streamed                                                          | Duplicate detection                                                             |
| IPC                      | Typed contract via `electron-trpc` (or hand-rolled typed IPC)                          | Renderer never touches fs/db directly                                           |
| Testing                  | Vitest (unit), Playwright (E2E on packaged app)                                        | Fixture library of real FITS headers from N.I.N.A./SGPro/APT/SharpCap/ASIStudio |
| Backend (Phase 2+)       | Node.js (Fastify) + PostgreSQL, deployed on Fly.io/Render                              | Same language as desktop; shared metadata types                                 |
| CI                       | GitHub Actions: lint, typecheck, unit tests, package on Win+mac                        |                                                                                 |

## Rationale

- Cross-platform Windows+macOS from one codebase is a hard PRD requirement; Electron is the most mature option.
- TypeScript end-to-end maximizes coding-agent velocity and enables shared domain types (desktop, cloud service, and future web dashboard).
- FITS **header** parsing is trivial (fixed-width ASCII cards); we don't need a heavy scientific library. Header-only reads keep the 10k-files-in-5-minutes performance target achievable in Node.
- `better-sqlite3` synchronous API in a worker thread outperforms async wrappers for bulk-insert indexing workloads.
- CPU-heavy work (scanning, hashing, thumbnailing) runs in Node **worker threads**, never the renderer or main-process event loop.

## Alternatives considered

- **Tauri + Rust:** smaller binaries and faster parsing, but smaller ecosystem, slower iteration, split-language codebase. Rejected for v1; a Rust scanning sidecar remains a future optimization option if profiling demands it.
- **.NET/Avalonia:** aligns with N.I.N.A. (C#) but weaker macOS story and web-code reuse. Rejected.

## Consequences

- Bundle size ~100 MB — acceptable for this audience.
- Native module (`better-sqlite3`, `sharp`) rebuilds must be wired into electron-builder for both platforms and architectures (x64 + arm64 mac).
- Performance targets (§8.4 of PRD) must be validated by benchmark tests in CI (see DD-004).
