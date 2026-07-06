# DD-005: Target Name Resolution & Filter Normalization

**Status:** Accepted
**Date:** 2026-07-05

## Target resolution

Goal: "M31", "M 31", "M-31", "NGC 224", "Andromeda Galaxy", "andromeda" all resolve to one target.

### Algorithm (pure function in packages/core/catalog)

1. **Normalize** the raw OBJECT string: trim, uppercase, collapse whitespace, strip punctuation, normalize catalog prefixes (`M`, `NGC`, `IC`, `SH2`/`SH 2-`, `LDN`, `LBN`, `B`, `VDB`, `ABELL`, `CED`, `RCW`, `GUM`, `CR`, `MEL`, `STOCK`, `PGC`, `UGC`) into `PREFIX NUMBER` form.
2. **Exact lookup** against `target_aliases.alias_normalized`.
3. **Built-in catalog lookup:** a bundled offline catalog (~14k objects: Messier, full NGC/IC, common Sharpless/Barnard/vdB + popular names) maps designations ↔ common names ↔ coordinates. Source: OpenNGC (CC-BY-SA) compiled to a JSON/SQLite asset at build time.
4. **Coordinate fallback:** if the name is unresolvable but RA/DEC headers exist, match against catalog objects within a configurable radius (default 1°); propose, don't auto-assign.
5. **Unresolved** frames go to a "Needs review" bucket; user assignment creates a user alias so the same string auto-resolves forever after.

Fuzzy string matching (edit distance) is used only to _suggest_ candidates in the review UI, never to auto-merge — silent mis-merges are worse than manual review.

Mosaic panels: OBJECT values like `M 31 Panel 1`, `NGC 7000_P2` resolve to the parent target with a `panel` attribute captured (groundwork for Phase 4 mosaics).

## Filter normalization

Raw FILTER strings are mapped to canonical filters via a data-driven table:

| Canonical | Band type  | Example raw values                                |
| --------- | ---------- | ------------------------------------------------- |
| L         | broadband  | `L`, `Lum`, `Luminance`, `UV/IR`, `UVIR`, `Clear` |
| R / G / B | broadband  | `Red`, `R`, `G2`, `Blue` …                        |
| Ha        | narrowband | `Ha`, `H-alpha`, `Halpha`, `HA7nm`, `Ha 3nm`      |
| OIII      | narrowband | `OIII`, `O3`, `Oiii 3nm`                          |
| SII       | narrowband | `SII`, `S2`                                       |
| Dualband  | narrowband | `L-eXtreme`, `L-Ultimate`, `NBZ`, `ALP-T`, `Duo`  |
| None      | none       | absent FILTER (OSC without filter), `None`        |

Unknown filter strings become their own canonical entry (visible, groupable) and can be merged by the user; merges are remembered as mappings.

## Consequences

- Both resolvers are deterministic pure functions with large table-driven test suites — ideal isolated issues for coding agents.
- The bundled catalog is a build artifact with a generation script checked into the repo (license attribution for OpenNGC included).
