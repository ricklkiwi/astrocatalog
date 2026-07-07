# DD-006: Session Detection & Calibration Matching

**Status:** Accepted
**Date:** 2026-07-05

## Session detection

A **session** is one imaging night on one equipment profile.

- **Astronomical day rule:** a frame belongs to the session dated by local noon-to-noon window (a 01:30 frame on Jul 6 belongs to the Jul 5 session). Local time derived from `DATE-OBS` (UTC) + site longitude when available, else system timezone (user-configurable per watch folder).
- **Gap splitting:** within one astronomical day, a gap > 4 h (configurable) between consecutive frames splits sessions (e.g., evening + pre-dawn runs).
- **Equipment split:** different equipment profiles on the same night are separate sessions (Remote Rita, multi-rig).
- Detection is a **pure function**: `detectSessions(frames[], config) → SessionAssignment[]`, re-runnable idempotently after every scan batch. Manual session edits (merge/split/notes) are preserved via explicit assignment locks.
- Calibration frames shot during a night attach to that session but never define one alone (dark library runs on cloudy nights form "calibration-only" sessions).

## Calibration matching

Goal of `matchCalibration(lights, masters, config)`: for a set of lights, score every candidate master and return ranked suggestions + gap flags.

### Hard requirements (must match, else score 0)

| Master type | Camera | Temp           | Exposure         | Gain/Offset | Binning | Filter | Optical train  |
| ----------- | ------ | -------------- | ---------------- | ----------- | ------- | ------ | -------------- |
| Dark        | ✔      | ±2 °C (config) | ✔ (or scalable*) | ✔           | ✔       | —      | —              |
| Bias        | ✔      | soft           | —                | ✔           | ✔       | —      | —              |
| Flat        | ✔      | soft           | —                | soft        | ✔       | ✔      | ✔ same profile |
| DarkFlat    | ✔      | ±2 °C          | ✔ match flat exp | ✔           | ✔       | —      | —              |

\* exposure-scaled dark matching is v1.x, flagged as "scaled" in UI.

### Scoring (soft factors)

`score = w_temp·tempCloseness + w_recency·recency + w_subcount·subCount`
Flats additionally decay with **days since the lights** (dust/rotation drift): a flat > 30 days (config) from the light session is flagged `stale`.

### Status per target/session (drives UI indicators)

`complete` (all needed master types matched) | `partial` | `stale` | `missing`. Which master types are "needed" depends on camera type (OSC vs mono, set-point cooled vs DSLR) — data-driven rules, user-overridable.

Manual assignments always win and are never overwritten by rescans.

## Consequences

- Both algorithms live in `packages/core/catalog` as pure functions with table-driven tests covering: DSLR (no set-point), mono+filterwheel, OSC+dualband, meridian-flip pier-side, multi-rig nights, calibration-only nights.
