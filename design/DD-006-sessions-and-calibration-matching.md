# DD-006: Session Detection & Calibration Matching

**Status:** Accepted
**Date:** 2026-07-05

## Session detection

A **session** is one imaging night on one equipment profile.

- **Astronomical day rule:** a frame belongs to the session dated by local noon-to-noon window (a 01:30 frame on Jul 6 belongs to the Jul 5 session). Local time is computed from an IANA timezone stored on the watch folder/site settings and copied onto the detected session. When a timezone is unknown, default to the system timezone and flag it as user-confirmable; do not infer civil time from longitude alone because DST and timezone boundaries make that unstable.
- **Gap splitting:** within one astronomical day, a gap > 4 h (configurable) between consecutive frames splits sessions (e.g., evening + pre-dawn runs).
- **Equipment split:** different equipment profiles on the same night are separate sessions (Remote Rita, multi-rig).
- Detection is a **pure function**: `detectSessions(frames[], config) → SessionAssignment[]`, re-runnable idempotently after every scan batch. Manual session edits (merge/split/notes) are preserved via explicit assignment locks.
- Calibration frames shot during a night attach to that session but never define one alone (dark library runs on cloudy nights form "calibration-only" sessions).

## Calibration matching

V1 goal of `matchCalibration(lights, masters, config)`: for a set of lights, return gap flags plus ranked master suggestions. It does not own master provenance editing, superseded-master lifecycle, exposure-scaled darks, or advanced camera-type policy in v1.0.

### Hard requirements (must match, else score 0)

| Master type | Camera | Temp               | Exposure | Gain/Offset | Binning | Filter | Optical train          |
| ----------- | ------ | ------------------ | -------- | ----------- | ------- | ------ | ---------------------- |
| Dark        | ✔      | ±2 °C when present | ✔ exact  | ✔           | ✔       | —      | —                      |
| Bias        | ✔      | soft               | —        | ✔           | ✔       | —      | —                      |
| Flat        | ✔      | soft               | —        | soft        | ✔       | ✔      | soft equipment profile |
| DarkFlat    | ✔      | ±2 °C when present | ✔ exact  | ✔           | ✔       | —      | —                      |

Exposure-scaled dark matching is v1.x, flagged as "scaled" in UI when added.

### Scoring (soft factors)

`score = w_temp·tempCloseness + w_recency·recency + w_subcount·subCount`
Flats additionally decay with **days since the lights** (dust/rotation drift): a flat > 30 days (config) from the light session is flagged `stale`. V1 surfaces this as a suggestion warning, not a lifecycle decision.

### Status per target/session (drives UI indicators)

`complete` (basic required master types appear matched) | `partial` | `stale` | `missing`. V1 uses a conservative default needed-set and lets the user see why; advanced camera-type-specific rules are v1.x unless beta feedback makes them essential.

Manual overrides of a suggestion always win and are never overwritten by rescans.

## Consequences

- Both algorithms live in `packages/core/catalog` as pure functions with table-driven tests covering: mono+filterwheel, OSC+dualband, tolerance boundaries, stale flats, missing masters, multi-rig nights, calibration-only nights. DSLR-specific needed-set policy and other advanced camera-type rules are v1.x.
