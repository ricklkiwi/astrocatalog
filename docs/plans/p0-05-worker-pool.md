# Plan: [P0-05] Worker pool and persistent job queue

**Slug:** p0-05-worker-pool **Issue:** #5 **Date:** 2026-07-08
**Governing DDs:** DD-002 (application architecture — worker_threads pool, job queue, main
process owns Drizzle/SQLite), DD-004 (resumable staged pipeline — `scan_jobs` records progress,
app restart resumes pending work)
**Status:** READY_FOR_SPEC

## Summary

This issue turns `@astrotracker/desktop` into a real job-processing app: a fixed-size
`worker_threads` pool, a persistent job queue backed by the `scan_jobs` table (extended via a
Drizzle migration with generic queue columns — job type, payload, progress, priority, claim/
cancel bookkeeping), an orchestrator that claims queued rows, dispatches them to idle workers,
persists progress, and requeues anything left `running` at the previous app exit (crash or
graceful quit — both look the same at boot, since no worker survives a process restart), and a
main→renderer IPC _event_ channel (new to the typed contract, alongside the existing
request/response `invoke` pattern) that streams progress to the UI. A demo job — sleep in N
steps, reporting progress after each — exercises the full path end to end and is resumable: a
job interrupted mid-run continues from its last persisted step instead of restarting. Per DD-002's
architecture diagram, the main process remains the sole SQLite writer; worker threads are pure
compute that report results back over `postMessage`, never opening a database connection
themselves — this is how the pool stays reusable for P1-06's real file-scanning jobs without
re-architecting later.

## Defaults & Design Decisions (no DD dictates these — flagged for reviewer attention)

1. **The job queue is `scan_jobs`, generalized — not a new table.** P0-04's plan explicitly
   deferred "worker pool / persistent job-queue semantics on `scan_jobs`" to this issue ("the
   table exists, its claim/resume logic does not"), and the issue text itself says "job queue
   persisted in `scan_jobs`-style tables." This plan adds generic queue columns (`job_type`,
   `payload_json`, `progress_current/total/message`, `priority`, `worker_id`, `claimed_at`,
   `cancel_requested`) to the existing table and makes `watch_folder_id` nullable (the demo job
   has no watch folder). The scan-specific columns (`files_seen/added/updated`) are untouched —
   P1-06's real scan jobs will populate both the generic progress fields (for the UI progress
   bar) and these typed counters (for the scan summary).
2. **`job_type` is a free-form `TEXT NOT NULL` column, no CHECK constraint.** DD-002 lists four
   future worker kinds (FileScanner, HeaderParser, Hasher, ThumbnailGenerator) plus this issue's
   `'demo'`; a CHECK enum would need a migration every time Phase 1 adds a job type. `status`
   _does_ get a CHECK (`'queued'|'running'|'completed'|'failed'|'cancelled'`) — that lifecycle is
   closed and a bad value is a correctness bug worth catching in the DB. The `JobType` union
   (`'demo'` for now) lives in `packages/desktop` (only desktop's worker registry knows what job
   types exist); `packages/db` only knows `status`.
3. **Workers never touch SQLite.** DD-002's diagram places "Drizzle/SQLite | job queue" under the
   _main process_ box, with `worker_threads` drawn as a separate box below reporting up. This
   plan reads DD-003's "single writer (worker)" phrase as "one writer, using the synchronous
   better-sqlite3 API, on the queue-orchestration path" — not literally inside a `worker_threads`
   worker. The main process already owns the one `AstroDatabase` handle (P0-04); workers post
   `progress`/`done`/`error`/`cancelled` messages back to the main thread, which is the only
   thing that ever calls a repository method. This keeps the pool reusable for P1-06+ without a
   second SQLite connection strategy, and keeps worker scripts trivially unit-testable (no native
   module, no file I/O).
4. **No automatic retry-on-failure.** `attempts`/`max_attempts`/backoff are not part of this
   schema. A failed job goes straight to `status='failed'`, terminal. Only crash/restart-orphaned
   `'running'` rows are requeued (a distinct mechanism from retry) — this satisfies the resume
   acceptance criterion without inventing a retry policy nobody asked for.
5. **Worker pool size:** `Math.min(4, Math.max(1, os.cpus().length - 1))`, computed once at
   startup in `main/index.ts` and passed into the pool constructor. Cheap to change later; not
   worth a settings-UI surface in Phase 0.
6. **Cancellation is cooperative, checked once per step**, not preemptive mid-sleep. The demo
   job's step granularity (default 10 steps) makes this responsive enough; finer-grained
   cancellation (e.g. wrapping each `setTimeout` in an `AbortController`) is unnecessary until a
   real job type needs sub-step cancellation.
7. **Worker script bundling uses electron-vite's `?modulePath` import suffix**
   (`import workerEntryPath from './worker-entry?modulePath'`), the framework's documented,
   recommended mechanism for `worker_threads` scripts — no manual `electron.vite.config.ts`
   multi-entry configuration needed; electron-vite discovers and bundles the worker file because
   it's a static import.
8. **`@astrotracker/db` moves from `devDependencies` to `dependencies`** in
   `packages/desktop/package.json`. It was added as a devDependency in P0-03 before any runtime
   code used it (a placeholder, unlike the intentional type-only renderer→desktop edge); this is
   the first issue where the main process actually calls `openDatabase()`.
9. **Progress events broadcast to every open `BrowserWindow`**, not just a tracked "originating"
   window. The app is single-window today (P0-03); this is simpler than window-scoped routing
   and stays correct when a second window is added later.

## Affected Files

- `packages/db/src/schema/infra.ts` — modified; `scan_jobs` gains `jobType`, `payloadJson`,
  `progressCurrent`, `progressTotal`, `progressMessage`, `priority`, `workerId`, `claimedAt`,
  `cancelRequested`; `watchFolderId` becomes nullable; `status` gets a CHECK constraint and
  default `'queued'`; new composite index on `(status, priority, createdAt)` for the claim query.
- `packages/db/drizzle/0002_<name>.sql` + `drizzle/meta/*` — new; generated migration (SQLite
  can't ALTER a column to nullable or add a CHECK constraint in place, so `drizzle-kit generate`
  produces a table-rebuild migration: create `__new_scan_jobs`, copy existing rows — with
  `job_type` backfilled to `'scan'` for pre-existing rows, since every `scan_jobs` row before
  this issue was implicitly a scan — drop old table, rename, recreate indexes).
- `packages/db/src/repositories/scan-jobs.ts` — modified; queue primitives beyond the CRUD
  skeleton: `enqueue`, `claimNext`, `updateProgress`, `requestCancel`, `markCancelled`,
  `complete`, `fail`, `requeueOrphaned`.
- `packages/db/src/repositories/scan-jobs.test.ts` — new; claim/resume/cancel semantics
  (satisfies the "Unit tests for queue claim/resume/cancel semantics" acceptance criterion) —
  pure repository-level tests against a temp/`:memory:` DB, no `worker_threads` involved.
- `packages/db/src/index.ts`, `packages/db/src/repositories/index.ts` — modified; export the
  richer `ScanJobsRepository` type and a `JobStatus` union.
- `packages/desktop/package.json` — modified; `@astrotracker/db` moves to `dependencies`.
- `packages/desktop/src/main/jobs/protocol.ts` — new; the main↔worker `postMessage` message
  types (`RunMessage`, `ProgressMessage`, `DoneMessage`, `ErrorMessage`, `CancelMessage`,
  `CancelledMessage`) and the `JobType` union (`'demo'` today).
- `packages/desktop/src/main/jobs/demo-job.ts` — new; the demo job's step logic (sleep N steps,
  report progress, honor `resumeFrom` and a cancellation check), written as a plain async
  function so it's unit-testable without spinning a real thread.
- `packages/desktop/src/main/jobs/worker-entry.ts` — new; the actual `worker_threads` script —
  `parentPort` message loop dispatching to a job-type registry (today: `{ demo: runDemoJob }`).
- `packages/desktop/src/main/jobs/pool.ts` — new; `WorkerPool` — fixed-size real
  `worker_threads`, dispatch/cancel/crash-recovery (a worker's uncaught `'error'` event fails its
  in-flight job and respawns the slot)/`terminateAll`.
- `packages/desktop/src/main/jobs/pool.test.ts` — new; real `worker_threads` exercised with small
  step counts/short delays (fast, still a genuine thread — not a mock).
- `packages/desktop/src/main/jobs/orchestrator.ts` — new; `JobQueueOrchestrator` — owns the
  `scanJobs` repository + `WorkerPool`; `start()` requeues orphaned `'running'` rows then begins
  the claim→dispatch pump loop (never claims more rows than idle worker slots); persists
  progress/completion; routes `cancel(jobId)` to a running worker or, if still queued, straight to
  the repository; exposes an `onEvent` hook the IPC layer subscribes to.
- `packages/desktop/src/main/jobs/orchestrator.test.ts` — new; integration-style tests against a
  temp-file `AstroDatabase` and the real pool: full enqueue→progress→complete flow, cancel flow,
  and the restart/resume flow (two orchestrator instances against the same DB file, satisfying
  "survives app restart mid-job and resumes").
- `packages/desktop/src/ipc/contract.ts` — modified; adds `IPC_EVENT_CHANNELS`/
  `IpcEventContract` (main→renderer push, alongside the existing request/response
  `IPC_CHANNELS`/`IpcContract`) with `'jobs.progress'`; adds three new request/response
  procedures: `jobs.enqueueDemo`, `jobs.cancel`, `jobs.list`; `AstroTrackerBridge` gains
  `on(event, listener): () => void`.
- `packages/desktop/src/main/ipc/register.ts` — modified; handlers for the three new procedures,
  injected via `IpcHandlerDeps` (mirroring the existing `nativeSmoke` injection pattern) so
  registration stays unit-testable without Electron.
- `packages/desktop/src/main/ipc/broadcast.ts` — new; injectable `IpcSenderLike` (subset of
  `BrowserWindow.getAllWindows()[].webContents.send`) that the orchestrator's `onEvent` hook
  calls; kept separate from `register.ts` because it's main→renderer, not request/response.
- `packages/desktop/src/preload/create-listen.ts` — new; whitelist-gated `on()` factory mirroring
  `create-invoke.ts` — rejects subscriptions to event names outside `IPC_EVENT_CHANNELS` before
  touching `ipcRenderer`, returns an unsubscribe function.
- `packages/desktop/src/preload/create-listen.test.ts` — new; mirrors `create-invoke.test.ts`.
- `packages/desktop/src/preload/index.ts` — modified; bridge gains `on: createListen(...)`.
- `packages/desktop/src/main/index.ts` — modified; opens the real `AstroDatabase` at
  `app.getPath('userData')`-derived path, constructs the pool + orchestrator, wires
  `orchestrator.onEvent` to broadcast over all windows, extends `createIpcHandlers` deps with the
  three new procedures, calls `orchestrator.start()` after `app.whenReady()`, terminates the pool
  on `before-quit`.
- `packages/desktop/electron.vite.config.ts` — unmodified (see Default 7 — no config change
  needed for the `?modulePath` worker import); `packages/desktop/src/env.d.ts` — new, if
  TypeScript needs an ambient `/// <reference types="electron-vite/node" />` for the
  `?modulePath` import specifier to typecheck (confirm during implementation; add only if needed).
- `packages/desktop/renderer/src/JobDemo.tsx` — new; minimal panel: a button calling
  `jobs.enqueueDemo`, a progress bar driven by `window.astrotracker.on('jobs.progress', ...)`, a
  cancel button — the visible proof of "streams progress to renderer." Not a designed UI (DD-008
  UX work is Phase 1); functional only.
- `packages/desktop/renderer/src/App.tsx`, `src/App.test.tsx` — modified; render `<JobDemo />`
  alongside the existing version view; test mocks `window.astrotracker.on`/`invoke`.
- `packages/desktop/renderer/src/window.d.ts` — modified; ambient type picks up the extended
  `AstroTrackerBridge`.

## Implementation Steps

### Step 1 — `scan_jobs` migration: generic job-queue columns

**Outcome:** The Drizzle schema for `scan_jobs` carries every column a generic, persisted job
queue needs (job type, payload, progress, priority, claim ownership, cancellation flag) on top of
its existing scan-specific columns; `watch_folder_id` is nullable; `status` is constrained to the
five-state lifecycle with a `'queued'` default; a composite index supports the claim query
efficiently. `pnpm --filter @astrotracker/db db:generate` produces the committed migration.
Existing rows (none in production yet, but the migration must be correct for any future
mid-flight upgrade) get `job_type='scan'` on backfill.
**Files:** `packages/db/src/schema/infra.ts`, `packages/db/drizzle/0002_*.sql`,
`packages/db/drizzle/meta/*`.
**Depends on:** none

### Step 2 — Queue primitives on the `scan_jobs` repository

**Outcome:** `repos.scanJobs` exposes, beyond the existing CRUD skeleton: `enqueue(input)`
(stamps `status='queued'`, `progressCurrent=0`, sensible defaults for `priority`/
`cancelRequested`); `claimNext(workerId)` (transactionally picks the highest-priority, oldest
queued row, flips it to `'running'`, stamps `workerId`/`claimedAt`/`startedAt`-if-unset, returns
it — or `undefined` if the queue is empty); `updateProgress(id, {current, total?, message?})`;
`requestCancel(id)` (sets `cancelRequested` on a running row; on a still-queued row, transitions
it straight to `'cancelled'` — no worker to signal) and `markCancelled(id)` (the running→cancelled
terminal transition, called once a worker acknowledges); `complete(id)`/`fail(id, error)`
(terminal transitions, stamp `finishedAt`, clear `workerId`); `requeueOrphaned()` (resets every
`'running'` row to `'queued'`, clearing `workerId`/`claimedAt` but preserving `progressCurrent`/
`progressTotal`/`payloadJson`/**`cancelRequested`** — a job that was mid-cancel when the app died
must still honor that cancel immediately after resume, not resume running). Every terminal/claim
write no-ops cleanly on a row already in a terminal state (late cancel after completion is not an
error). Unit tests cover: enqueue→claim ordering (priority desc, then FIFO by `createdAt`);
claiming an empty queue; `requeueOrphaned` preserving progress and a pending cancel flag; cancel
on queued vs. running rows; cancel/complete/fail on an already-terminal row being a no-op, not a
throw.
**Files:** `packages/db/src/repositories/scan-jobs.ts`, `scan-jobs.test.ts`,
`packages/db/src/repositories/index.ts`, `packages/db/src/index.ts`.
**Depends on:** Step 1

### Step 3 — Demo job logic and the worker-side message loop

**Outcome:** `runDemoJob(payload, ctx)` sleeps through `payload.totalSteps` (default 10) steps of
`payload.stepMs` (default 500ms) each, calling `ctx.reportProgress(current, total, message)`
after every step and checking `ctx.isCancelled()` between steps, honoring `payload.resumeFrom` by
skipping already-completed steps (so a resumed run reports only its remaining progress, not a
restart from zero). This is plain async logic with an injected `ctx`, so it's tested directly —
no real thread — for: correct progress sequence, `resumeFrom` skipping, and early exit on
cancellation. `worker-entry.ts` (the actual `worker_threads` script) wraps this in a
`parentPort.on('message', ...)` loop against a `{ demo: runDemoJob }` registry (designed so a
future `'scan'` entry is a one-line addition, not a pool/orchestrator change), translating
`ctx.reportProgress`/completion/errors into `postMessage` calls per `protocol.ts`, and reacting to
an incoming `{type:'cancel'}` message by flipping an internal flag `ctx.isCancelled()` reads.
**Files:** `packages/desktop/src/main/jobs/protocol.ts`, `demo-job.ts`, `demo-job.test.ts`,
`worker-entry.ts`.
**Depends on:** none (parallel with Steps 1-2)

### Step 4 — `WorkerPool`: real `worker_threads`, dispatch, crash recovery

**Outcome:** `WorkerPool` owns a fixed number of `worker_threads` instances (each running
`worker-entry.ts` via the `?modulePath` import), tracks idle vs. busy, and offers: run a claimed
job on an idle worker with progress/done/error/cancelled callbacks; forward a cancel request to
the worker currently running a given job id; terminate everything (app shutdown). A worker whose
process-level `'error'` event fires (uncaught exception, not a graceful protocol message) fails
its in-flight job and gets replaced so pool capacity isn't permanently lost. Tests spin up a real
pool against the real `worker-entry.ts` with small step counts/short delays (tens of
milliseconds, not seconds) and assert on message-count/ordering promises rather than wall-clock
sleeps, keeping the suite fast while genuinely exercising `worker_threads` (satisfies "runs in
worker").
**Files:** `packages/desktop/src/main/jobs/pool.ts`, `pool.test.ts`.
**Depends on:** Step 3

### Step 5 — `JobQueueOrchestrator`: the pump loop, persistence, resume-on-restart

**Outcome:** `JobQueueOrchestrator(repo, pool)` ties the queue to the pool. `start()` first calls
`repo.requeueOrphaned()` — every `'running'` row at boot is, by construction, orphaned (no
`worker_threads` instance survives a process restart, clean or crashed) — then begins a pump loop
that claims and dispatches jobs up to the pool's idle capacity, never claiming a row it can't
immediately hand to a worker. Progress messages from the pool persist via
`repo.updateProgress`; done/error/cancelled messages persist via `complete`/`fail`/
`markCancelled` and free the slot for the next claim. `enqueue(type, payload, opts)` inserts and
immediately attempts a claim/dispatch if a slot is free. `cancel(jobId)` calls
`repo.requestCancel` and, if the job was running, forwards the cancel to its worker. Every state
change (including intermediate progress) calls the injected `onEvent` hook so the IPC layer can
broadcast it. Integration tests use a real temp-file `AstroDatabase` and real pool: (a) a demo job
enqueued with small `totalSteps`/`stepMs` runs to completion with observed progress events
0→total and a final `'completed'` DB row; (b) **restart/resume**: enqueue a demo job, let it
observably progress partway (wait on a progress-count promise, not a timer), then terminate that
orchestrator/pool (simulating an app-restart kill, not a graceful stop) without letting the job
finish — the DB row is left `'running'`; open a **second**, independent orchestrator/pool pair
against the same DB file and call `start()` — assert the row is requeued and reclaimed, the
worker resumes from `progressCurrent` (total observed progress ticks across both runs equals
`totalSteps`, no double-counted or skipped steps), and it reaches `'completed'`; (c) **cancel**:
enqueue a longer demo job, cancel it shortly after it starts running, assert the worker receives
the cancel, the row reaches `'cancelled'`, and the freed slot picks up the next queued job.
**Files:** `packages/desktop/src/main/jobs/orchestrator.ts`, `orchestrator.test.ts`.
**Depends on:** Steps 2, 4

### Step 6 — IPC event channel + three request/response procedures

**Outcome:** The typed contract gains a second, parallel surface for main→renderer push:
`IPC_EVENT_CHANNELS`/`IpcEventContract` (today: `'jobs.progress'` → a `JobProgressEvent` carrying
`jobId`, `jobType`, `status`, `current`, `total | null` for indeterminate, `message | null`) sitting
alongside the existing request/response `IPC_CHANNELS`/`IpcContract`, which gains
`jobs.enqueueDemo` (input: optional `{totalSteps?, stepMs?}` → `{jobId}`), `jobs.cancel` (input
`{jobId}` → `void`), `jobs.list` (→ job summaries). `AstroTrackerBridge` gains
`on<E>(event, listener): () => void`. Main-side: `register.ts`'s handlers for the three
procedures are injected (mirroring the existing `nativeSmoke` pattern) so they're unit-testable
without Electron or a real orchestrator; a new `broadcast.ts` exposes an injectable
`IpcSenderLike` the orchestrator's `onEvent` hook drives. Preload-side: `create-listen.ts` mirrors
`create-invoke.ts`'s hard whitelist — subscribing to an event name outside
`IPC_EVENT_CHANNELS` throws before touching `ipcRenderer.on`. Tests mirror the existing
`contract.test.ts`/`create-invoke.test.ts` pin tests, extended for the event surface.
**Files:** `packages/desktop/src/ipc/contract.ts`, `contract.test.ts`,
`packages/desktop/src/main/ipc/register.ts`, `broadcast.ts`,
`packages/desktop/src/preload/create-listen.ts`, `create-listen.test.ts`, `preload/index.ts`.
**Depends on:** none (parallel with Steps 1-5; wired together in Step 7)

### Step 7 — Wire it up in `main/index.ts`

**Outcome:** On `app.whenReady()`, before creating the window: open the real `AstroDatabase` at
`path.join(app.getPath('userData'), 'astrotracker.db')` (the first real use of `openDatabase()` —
P0-04's bootstrap.ts explicitly deferred resolving this path to "P0-05+"); construct the
`WorkerPool` (size per Default 5) and `JobQueueOrchestrator`; call `orchestrator.start()`; wire
`orchestrator.onEvent` to broadcast `jobs.progress` over every open `BrowserWindow`; extend the
`createIpcHandlers` deps object with the three new procedures backed by the orchestrator/repo.
`before-quit` calls `pool.terminateAll()` and `db.close()` (best-effort — correctness relies on
`requeueOrphaned()` at next boot regardless of whether shutdown was clean). `@astrotracker/db`
moves to `dependencies` in `package.json` (Default 8).
**Files:** `packages/desktop/src/main/index.ts`, `packages/desktop/package.json`.
**Depends on:** Steps 5, 6

### Step 8 — Minimal renderer demo panel

**Outcome:** A small, purely functional `JobDemo` component (no design polish — Phase 1 owns
DD-008 UX) renders alongside the existing version view: a button enqueues a demo job via
`jobs.enqueueDemo`, a progress bar/percentage subscribes to `jobs.progress` filtered to that job
id via `window.astrotracker.on`, unsubscribing on unmount, and a cancel button calls `jobs.cancel`.
This is the visible, manually-verifiable proof of "streams progress to renderer." A Vitest test
mocks `window.astrotracker.invoke`/`on` and asserts the button triggers `enqueueDemo`, a
simulated progress event updates the displayed percentage, and unmounting calls the unsubscribe
function returned by `on`.
**Files:** `packages/desktop/renderer/src/JobDemo.tsx`, `App.tsx`, `App.test.tsx`, `window.d.ts`.
**Depends on:** Steps 6, 7

## Edge Cases

- **App restart mid-job** (crash or graceful quit — indistinguishable at boot): `requeueOrphaned()`
  resets every `'running'` row to `'queued'` unconditionally at startup, since no `worker_threads`
  instance can possibly still be alive at that point in the new process. The resumed job continues
  from `progressCurrent`/`payloadJson.resumeFrom`, not from zero.
- **App died while a cancel was in flight** (cancel message sent, `'cancelled'` ack never
  arrived): `requeueOrphaned()` must **not** clear `cancelRequested`. The resumed job's worker
  sees `cancelRequested=true` immediately (via `resumeFrom`/payload) and the orchestrator must
  check it _before_ dispatching to a fresh worker at all, marking the job `'cancelled'` directly
  rather than spinning up a worker just to cancel it.
- **Late cancel on an already-finished job** (renderer's cancel click races the job's own
  completion): `requestCancel`/`markCancelled` on a row already in a terminal state is a no-op,
  not an error — checked via `WHERE status IN ('queued','running')` in the update, not by
  pre-reading status in application code (avoids a check-then-act race even though the main
  process is single-threaded here).
- **Cancel on a still-queued (never-claimed) job**: no worker to signal; the repository
  transitions it straight to `'cancelled'`; the orchestrator must not attempt a pool-level cancel
  call for a job id the pool never dispatched.
- **Worker throws an uncaught exception** (not a graceful `{type:'error'}` protocol message): the
  pool's `worker.on('error', ...)` handler must fail the in-flight job and replace the dead
  worker slot — otherwise pool capacity silently shrinks by one every crash.
- **Two jobs enqueued with equal priority**: FIFO via `createdAt`; UUIDv7's monotonic
  within-millisecond counter (P0-04) keeps this stable even for jobs enqueued in the same
  millisecond.
- **Orchestrator claiming faster than the pool has idle slots**: claim and dispatch must be
  paired — the pump loop only calls `claimNext` when it has already confirmed an idle worker,
  never claims speculatively (a claimed-but-undispatched row would show `'running'` in the DB with
  no worker actually processing it, silently stalling until the next restart's requeue).
- **`progressTotal` is `null`** (indeterminate progress, for future job types that don't know a
  total up front): the IPC event and the renderer panel must render an indeterminate state, never
  divide by zero.
- **Multiple `BrowserWindow`s open**: progress events broadcast to all of them (Default 9); no
  per-window job ownership in this issue.

## Invariant Checklist

- [x] Non-destructive: no code path writes/moves/renames/deletes user image files — the demo job
      touches nothing on disk; the worker pool introduced here is DB- and filesystem-free by
      design (Default 3), and future scan/hash job types (P1-06+) inherit that constraint from
      the same pool/orchestrator plumbing
- [x] Layering: pool/orchestrator/worker-entry code lives entirely in `packages/desktop`
      (Electron/infra, not domain logic) — `packages/core` is untouched; the demo job has no
      domain logic to place there
- [x] DB: `scan_jobs` extended via a committed Drizzle migration (Step 1), keeping its existing
      UUIDv7 PK + `updated_at`; no new table needed
- [x] Timestamps stored UTC: `claimedAt`/`startedAt`/`finishedAt` reuse the existing
      `timestamp_ms` column mode (epoch-ms, UTC by construction)
- [x] Long-running work goes through the worker job queue: this issue _builds_ that mechanism;
      the demo job is the first thing to use it, proving the path P1-06+ real scanning jobs will
      reuse
- [x] Performance budgets (PRD §8.4): the composite `(status, priority, createdAt)` index keeps
      the claim query cheap as the queue grows; progress writes are single-row indexed updates on
      the main thread at a coarse cadence (once per job step) — flagged for P0-07 to include a
      job-queue write-throughput check once P1-07's real per-batch progress cadence exists, since
      that issue (not this one) determines how frequently real scan jobs call `updateProgress`

## Out of Scope

- Real scan/hash/thumbnail job types (P1-06, P1-08, Phase 1 thumbnail work) — only `'demo'` ships;
  the message protocol and worker registry are shaped so adding a type is additive
- Retry-on-failure / backoff policy (Default 4) — failed jobs are terminal
- Heartbeat-based detection of a hung-but-alive worker (distinct from an app restart) — only
  protocol-level `'error'` events and boot-time orphan requeue are handled; a worker that hangs
  forever without the app restarting is not detected in this issue
- Job history/pagination UI, priority-setting UI — `jobs.list` is a minimal debug surface, not
  designed UX (DD-008 is Phase 1)
- chokidar/watch-folder scanning itself (P1-06) — this issue only builds the queue P1-06 will
  enqueue into
- CI benchmark gates (P0-07)
- Free-tier limits, cloud sync (Phase 2)
- Multi-process DB contention beyond P0-04's existing `busy_timeout` (no new concern introduced —
  the main process remains the sole writer, per Default 3)

## Open Questions

None. The nine defaults above are judgment calls no DD constrains — each is flagged for reviewer
attention rather than blocking work, and each is cheap to reverse (schema columns are additive,
the job-type registry is a lookup table, the pool size is one constant).

Plan written: docs/plans/p0-05-worker-pool.md — 8 steps
