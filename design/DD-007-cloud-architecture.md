# DD-007: Cloud Service & Sync Architecture (Phase 2+)

**Status:** Accepted (direction) — details may be revised at Phase 2 kickoff
**Date:** 2026-07-05

## Decision

- **Service:** Node.js (Fastify) + PostgreSQL, single deployable, hosted on Fly.io (or Render). Same TypeScript domain types as desktop via `packages/core`.
- **Auth:** email magic-link + OAuth (Google), JWT access/refresh. Desktop app holds a device token.
- **Sync model:** metadata-only, one-way-then-merge:
  - Desktop pushes logical entities (targets, frame metadata, sessions, stats rollups) keyed by UUIDv7.
  - Last-writer-wins per field with per-entity `updated_at`; user-edited fields (notes, names, statuses) prompt on conflict rather than silently overwriting.
  - Image files never leave the user's machine. Thumbnails optionally sync (user opt-in, Pro).
- **Recommendation engine** (server-side, also usable offline-degraded on desktop with cached ephemeris):
  - Inputs: user's per-target/per-filter integration, target coordinates, site lat/lon + Bortle, date/moon phase (astronomy-engine lib), weather forecast (Astrospheric/Open-Meteo API), community benchmark table.
  - Output: ranked "tonight" list with reason strings ("M31 needs 4 h OIII to balance Ha", "NGC 7000 transits 23:40 at 78°").
  - Scoring is a transparent weighted formula in v2 (no ML until Phase 5).
- **Privacy:** all community benchmarks computed from opt-in anonymized aggregates; site coordinates rounded to 0.1° in any shared data.
- **Licensing/entitlements:** Pro/Team entitlements validated server-side, cached offline for 14 days grace — desktop core never hard-fails offline (PRD principle 4).

## Consequences

- Desktop v1 must already use UUIDv7 PKs and track `updated_at` per row (in DD-003) so sync bolt-on requires no migration of identity.
- API is versioned (`/v1`) and documented with OpenAPI from the first endpoint; the Team tier's "API access" feature exposes the same API with scoped keys.
