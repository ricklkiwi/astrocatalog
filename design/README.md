# AstroTracker — Design Decisions

Durable architecture and design decisions for AstroTracker (repo: [ricklkiwi/astrocatalog](https://github.com/ricklkiwi/astrocatalog)). These persist beyond individual tasks; coding agents must treat them as authoritative. Changes require a new revision of the relevant DD with rationale.

| ID | Title | Scope |
|---|---|---|
| [DD-001](DD-001-tech-stack.md) | Technology Stack | Electron, React, TypeScript, SQLite, tooling |
| [DD-002](DD-002-application-architecture.md) | Application Architecture | Process model, monorepo layout, layering rules |
| [DD-003](DD-003-database-schema.md) | Database Schema | SQLite tables, indexing, UUID keys, migrations |
| [DD-004](DD-004-scanning-pipeline.md) | Scanning & Indexing Pipeline | Staged resumable pipeline, header-only parsing |
| [DD-005](DD-005-target-resolution.md) | Target & Filter Resolution | Name normalization, bundled catalog, aliases |
| [DD-006](DD-006-sessions-and-calibration-matching.md) | Sessions & Calibration Matching | Astronomical-day grouping, matching rules/scoring |
| [DD-007](DD-007-cloud-architecture.md) | Cloud & Sync (Phase 2+) | Backend stack, sync model, recommendations |
| [DD-008](DD-008-ux-structure.md) | UX Structure | Navigation, theming, UI conventions, onboarding |

Related documents: PRD, development plan, and task breakdown in [`../planning/`](../planning/).
