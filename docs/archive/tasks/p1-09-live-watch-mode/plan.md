# Plan: [P1-09] Live watch mode (chokidar)

**Slug:** p1-09-live-watch-mode **Issue:** #17 **Date:** 2026-07-22
**Governing DDs:** DD-004 (scanning pipeline — "Watch mode: chokidar watches active folders; new
files debounce 30s (capture software writes sequentially all night) then enter the pipeline";
also the Stage 1 incremental/move-detection rules this plan reuses unchanged), DD-002
(application architecture — three-process layering: fs/chokidar side effects belong in the main
process, never `packages/core`; long-running work goes through the existing worker pool, not a
new one), DD-003 (database schema — UUIDv7 PKs + `updated_at` via `baseColumns()`, migrations via
`drizzle-kit generate`)
**Depends on:** #15 (P1-07) — merged, no blocker. This plan also builds directly on P1-06 (watch
folders + Stage 1 scan) and P1-08 (background hashing, move detection) machinery already merged
to `main` (`orchestrator.ts`, `scan-job.ts`, `files.ts` repository) — read in full below.
**Status:** READY_FOR_SPEC

## Summary

Live watch mode adds a per-folder-toggleable chokidar watcher, running in the Electron main
process, that turns filesystem activity into the **exact same** `'scan'` job the user already
triggers manually today (`orchestrator.enqueueScan`) — it never builds a parallel ingestion path.
A new `main/watch/watch-manager.ts` module owns one chokidar instance per actively-watched folder,
a per-folder 30 s debounce timer (manual `setTimeout`-based, reset on every qualifying fs event —
**not** chokidar's `awaitWriteFinish`, which solves a different, smaller problem: per-file "has
this one file's bytes stopped changing" stability, set to a short 2 s threshold so a half-copied
FITS file is never handed to the pipeline mid-write), and per-folder in-flight tracking so a
scan job already queued/running for a folder is never duplicated by a second debounce firing.
When chokidar reports a watcher-limit error (`ENOSPC`/`EMFILE`/`ENFILE` — OS ran out of inotify
watches or file descriptors), that folder's watcher is torn down and replaced with a periodic
rescan timer (default 5 min), and a `watch.status` IPC event tells the renderer to show an
inline notice — the folder toggling itself back to plain periodic polling, not crashing or
silently going dark.

**Why reuse the full incremental scan instead of building a targeted per-changed-file job:**
DD-004's Stage 1 is already incremental (`knownFiles` size/mtime diff skips unchanged files) and
already handles adds, changes, deletes-to-`missing`, and moves (P1-08's `moveCandidates`/
`reparentMoved`). Chokidar reports renames as `unlink`+`add` with no content identity, so
building a smaller "just this one file" job would have to reinvent move detection from scratch
inside the watcher. Triggering the same `enqueueScan(watchFolderId)` the "Scan now" button already
calls gets adds/changes/deletes/moves/error-isolation for free, keeps the watcher itself
extremely thin (just "something happened, and it's been quiet for 30 s"), and is the literal
reading of "live watch mode ... feeding the pipeline" — one pipeline, two triggers. The memory
note on scan performance (warm-cache rescans run ~6-7k stats/sec even on a slow external HDD)
means a debounce-triggered full rewalk of a typical few-thousand-file active folder is cheap; very
large trees are flagged as a real cost under Invariant Checklist → Performance budgets, with a
scoped-rescan optimization explicitly named as future work, not required here.

**Per-folder toggle:** a new `watch_folders.live_watch_enabled` boolean column (default `false` —
opt-in, since watching consumes OS file-descriptor/inotify budget the user should choose to
spend, especially on network/slow-share folders), toggled via a new `watchFolders.setLiveWatch`
IPC procedure. `WatchManager.start()` attaches a watcher for every folder where
`isActive && liveWatchEnabled` at app boot (mirrors `orchestrator.start()`'s
requeue-orphaned-jobs-at-boot pattern, called right alongside it in `main/index.ts`).

**Testability without real 30 s sleeps:** `WatchManager`'s `debounceMs` and
`fallbackRescanIntervalMs` are constructor options (default 30 000 / 300 000 per DD-004), read
in `main/index.ts` from `process.env['ASTROTRACKER_WATCH_DEBOUNCE_MS']` /
`process.env['ASTROTRACKER_WATCH_FALLBACK_INTERVAL_MS']` (falling back to the defaults on
missing/invalid values) — the same single-env-var-override pattern `main/index.ts` already uses
for `ELECTRON_RENDERER_URL`. Unit tests inject small values directly and drive them with
`vi.useFakeTimers()`; the E2E fixture gains an optional per-test env override (extending
`e2e/fixtures.ts`, **not** editing the existing `watch-folders.spec.ts`) so
`watch-mode.spec.ts` launches the packaged app with a debounce of a few hundred ms and asserts on
job counts, never wall-clock timing.

**Watcher-instance-per-folder, not one shared instance:** an `ENOSPC`/`EMFILE` error from
chokidar is watcher-instance-scoped, not path-scoped — a shared multi-root instance couldn't
attribute the failure to "this one huge folder" and fall only it back to polling while leaving
smaller sibling folders live-watched. One instance per folder costs more file descriptors overall
but is what makes "graceful handling of watcher limits on large trees" (the issue's own phrasing
— singular, per-tree) implementable per-folder at all.

## Affected Files

- `packages/db/src/schema/files.ts` — add `liveWatchEnabled` boolean column (default `false`) to
  `watchFolders`
- `packages/db/drizzle/000N_<generated-name>.sql` + `packages/db/drizzle/meta/000N_snapshot.json`
  - `meta/_journal.json` — generated by `drizzle-kit generate`, not hand-written
- `packages/db/src/migrations.test.ts` — verify whether the round-trip test enumerates
  `watch_folders` columns explicitly; extend only if it does (it currently checks table/index
  names, not full column lists — confirm before assuming a change is needed)
- `packages/desktop/package.json` — add `chokidar` (v5.x — ESM-only, requires Node ≥20; this
  repo's root `engines.node` is `^26`, and `packages/desktop` is already `"type": "module"`, so
  no interop shim needed) as a runtime `dependencies` entry. **No `electron-rebuild` wiring
  needed** — chokidar v4+ dropped its native `fsevents` dependency entirely (down to one pure-JS
  dependency), unlike `better-sqlite3`/`sharp`.
- `packages/desktop/src/ipc/contract.ts` — `WatchFolderRecord.liveWatchEnabled: boolean`;
  new `WatchMode`, `WatchStatusEvent`, `SetLiveWatchInput` types; `'watchFolders.setLiveWatch'`
  added to `IPC_CHANNELS` + `IpcContract`; `'watch.status'` added to `IPC_EVENT_CHANNELS` +
  `IpcEventContract`
- `packages/desktop/src/ipc/contract.test.ts` — extend the channel-registration and
  handler-delegation assertions for the new channel/event
- `packages/desktop/src/main/ipc/register.ts` — `IpcHandlerDeps.watchFolders.setLiveWatch`,
  its handler + input validation
- `packages/desktop/src/main/ipc/register.test.ts` (if it exists as a standalone file — verify;
  `contract.test.ts` may be the only place `register.ts` is exercised) — add coverage for the new
  handler
- `packages/desktop/src/main/ipc/broadcast.ts` — a `toIpcWatchStatusEvent` mapping helper
  alongside the existing `toIpcJobProgressEvent`, if the shapes need translating; otherwise
  `WatchStatusEvent` may be broadcast as-is
- `packages/desktop/src/main/ipc/broadcast.test.ts` — cover the new mapping/broadcast path
- `packages/desktop/src/main/watch/types.ts` (new) — `WatcherLike` / `WatcherFactory` /
  `WatchStatus` internal interfaces (the DI seam between `watch-manager.ts` and the real chokidar
  adapter vs. a fake for unit tests)
- `packages/desktop/src/main/watch/chokidar-watcher.ts` (new) — thin adapter: real
  `chokidar.watch(rootPath, options)` construction (`ignoreInitial: true`,
  `followSymlinks: false`, `awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 }`,
  an `ignored` predicate built from `SUPPORTED_EXTENSION_SET` + the folder's `skipPatterns` +
  the same baked-in `node_modules` skip `scan-job.ts` uses)
- `packages/desktop/src/main/watch/chokidar-watcher.test.ts` (new) — unit-tests the `ignored`
  predicate directly (sample paths in/out) without spinning a real watcher
- `packages/desktop/src/main/watch/watch-manager.ts` (new) — the debounce/coalescing/in-flight/
  fallback state machine (see Implementation Steps)
- `packages/desktop/src/main/watch/watch-manager.test.ts` (new) — the bulk of the new unit-test
  surface; see Implementation Steps and Edge Cases
- `packages/desktop/src/main/index.ts` — construct `WatchManager` (env-derived
  `debounceMs`/`fallbackRescanIntervalMs`, real `createChokidarWatcher` factory,
  `orchestrator.enqueueScan`/`orchestrator.onEvent` bindings), call `watchManager.start()`
  alongside `orchestrator.start()`, wire `watchFolders.setLiveWatch` and broadcast `watch.status`,
  stop the manager for a folder inside the `watchFolders.remove` handler, `stopAll()` in
  `before-quit`
- `packages/desktop/renderer/src/WatchFolders.tsx` — per-row live-watch toggle button, a status
  badge/inline notice driven by `watch.status` events (same local-state-keyed-by-folder-id pattern
  already used for `scanEvents`/`folderByJob`)
- `packages/desktop/renderer/src/WatchFolders.test.tsx` — cover the new toggle + status rendering
- `packages/desktop/e2e/fixtures.ts` — add an optional, defaulted `electronEnv` fixture merged
  into the env passed to `_electron.launch()`, so a spec can shrink the debounce/fallback
  intervals via `test.use({ electronEnv: {...} })` without mutating global `process.env`
- `packages/desktop/e2e/watch-mode.spec.ts` (new) — the two acceptance-criteria E2E tests. Does
  **not** modify `packages/desktop/e2e/watch-folders.spec.ts`.

No changes needed in: `packages/core` (nothing new belongs there — no domain logic is added, only
fs-event plumbing), `packages/desktop/src/preload/*` (the whitelist is derived mechanically from
`IPC_CHANNELS`/`IPC_EVENT_CHANNELS`, already covered by existing generic tests), worker protocol
(`protocol.ts`, `worker-entry.ts`, `pool.ts`) — the watcher never talks to a worker directly, only
to `orchestrator.enqueueScan`/`orchestrator.onEvent`.

## Implementation Steps

### Step 1 — Migration: `live_watch_enabled` column

- **Outcome:** `watch_folders` rows carry a persisted per-folder live-watch opt-in flag, defaulting
  `false` for every existing and newly-added row.
- **Files:** `packages/db/src/schema/files.ts` (add the column next to `skipPatterns`, same
  `integer(..., { mode: 'boolean' }).notNull().default(false)` shape as `isActive`), generated
  migration + snapshot + journal via `pnpm --filter @astrotracker/db db:generate`.
- **Depends on:** none.

### Step 2 — IPC contract: toggle + status event

- **Outcome:** the typed contract exposes `watchFolders.setLiveWatch` (persist + report the
  updated row) and a `watch.status` push event (`{ watchFolderId, mode: 'watching'|'fallback'|
'off', message: string | null, updatedAt: string }`); `WatchFolderRecord` gains
  `liveWatchEnabled`. `register.ts`'s `IpcHandlers` mapped type makes a missing implementation a
  compile error, same as every other procedure.
- **Files:** `contract.ts`, `contract.test.ts`, `register.ts`, its test coverage.
- **Depends on:** Step 1 (the handler's dependency shape returns the DB row with the new field).

### Step 3 — Chokidar adapter (DI seam)

- **Outcome:** a small, swappable `WatcherFactory` interface (`(rootPath, options) =>
WatcherLike`, where `WatcherLike` exposes `on('add'|'change'|'unlink'|'error', cb)` and
  `close(): Promise<void>`) with one real implementation wrapping `chokidar.watch(...)`. The
  `ignored` predicate is unit-testable in isolation from any real filesystem or watcher lifecycle.
- **Files:** `watch/types.ts`, `watch/chokidar-watcher.ts` + its test, `package.json` dependency
  add.
- **Depends on:** none (parallel to Steps 1-2).

### Step 4 — `WatchManager`: debounce, coalescing, in-flight guard, fallback

- **Outcome:** a folder can be `start()`-ed (attach watcher + fire one immediate catch-up scan —
  see Edge Cases on app-restart gaps), `setEnabled(id, bool)`-toggled, and `stop()`-ped. Any
  qualifying fs event resets that folder's debounce timer; when the timer fires, exactly one
  `enqueueScan` call happens **unless** a watch-triggered scan for that folder is already
  queued/running, in which case a `pendingRescan` flag defers the call until that job reaches a
  terminal status. A chokidar `'error'` whose `.code` is `ENOSPC`/`EMFILE`/`ENFILE` closes that
  folder's watcher and starts a periodic-rescan interval instead (any other error code is left
  alone — logged, no fallback, no crash: see Edge Cases on disconnected/missing roots). Every
  mode transition (`'watching'` / `'fallback'` / `'off'`) invokes an injected `onStatusChange`
  callback with a UTC timestamp.
- **Files:** `watch/watch-manager.ts`, `watch/watch-manager.test.ts` (see Edge Cases for the
  required scenario list — this is the test-heavy step).
- **Depends on:** Step 3 (constructs against the `WatcherFactory`/`WatcherLike` interfaces, injected
  with a fake in tests).

### Step 5 — Wire into `main/index.ts`

- **Outcome:** at boot, every `isActive && liveWatchEnabled` folder gets a live watcher; the
  `watchFolders.setLiveWatch` IPC call both persists the flag (`watchFolders.update`) and flips
  the runtime watcher on/off; `watch.status` events reach every renderer window the same way
  `jobs.progress` already does; removing a watch folder tears down its watcher/timers first;
  app shutdown stops every watcher/timer cleanly (no leaked `setInterval`/chokidar handle keeping
  the process alive).
- **Files:** `main/index.ts`.
- **Depends on:** Steps 2, 4.

### Step 6 — Renderer: toggle + inline status

- **Outcome:** each watch-folder row gets an "Enable live watch"/"Disable live watch" button
  (mutating `watchFolders.setLiveWatch`) and an inline, `aria-live` status string — "Live watch:
  off" / "Live watch: watching" / "Live watch: fallback — <message>" — seeded from
  `folder.liveWatchEnabled` and refined by any `watch.status` event received for that folder id.
  No new toast/banner component; reuses this file's existing inline-message conventions.
- **Files:** `WatchFolders.tsx`, `WatchFolders.test.tsx`.
- **Depends on:** Step 5.

### Step 7 — E2E: both acceptance criteria

- **Outcome:** `watch-mode.spec.ts` proves (a) dropping files into a watched folder produces
  `files` rows with no `jobs.enqueueScan` call from the test, and (b) a rapid burst of file drops
  increases the `'scan'`-job count by exactly one, not one per file — both assertions are
  count/state-polling based, never a real 30 s wait, via the shrunk env-driven debounce.
- **Files:** `e2e/fixtures.ts` (additive `electronEnv` fixture), `e2e/watch-mode.spec.ts` (new).
- **Depends on:** Steps 5, 6 (exercises the full stack through real IPC).

## Edge Cases

- **Continuous sub-30s trickle all night never flushes.** This is DD-004's own stated intent
  ("capture software writes sequentially all night" is the reason the 30 s window exists) —
  a plain per-folder debounce with no max-wait ceiling is correct here, not a bug: real capture
  sessions have multi-second-to-multi-minute gaps between subs, so the debounce naturally flushes
  many times through a session. Documented, not special-cased.
- **App restarted (or live-watch just toggled on) while files already sit unwatched in the
  folder.** `ignoreInitial: true` means chokidar reports nothing for pre-existing tree contents at
  attach time, so those files would otherwise sit uncatalogued until an unrelated fs event nudges
  the folder. `WatchManager.start()`/`setEnabled(id, true)` therefore fires one immediate
  catch-up `enqueueScan` (through the same in-flight-guarded helper the debounce uses) in
  addition to attaching the live watcher.
- **Disconnected/missing watch-folder root.** A chokidar `'error'` on a vanished mount (typically
  `ENOENT`, not `ENOSPC`/`EMFILE`/`ENFILE`) does **not** enter fallback-periodic-rescan mode —
  it's logged and left alone, matching DD-003's existing "missing, never auto-deleted" framing;
  reconnecting the drive and toggling live-watch off/on (or clicking "Scan now") recovers. A
  watch-triggered scan against a currently-missing root degrades the same way a manual scan
  already does today (`scan-job.ts`'s per-directory try/catch starts at `rootPath` itself, so an
  unreadable root walks to zero discovered files, not a crash) — no new handling required.
- **Rename/move inside a watched folder.** Chokidar reports `unlink`+`add` with no content
  identity; both reset the same debounce timer and typically land in one coalesced burst, which
  triggers the existing Stage 1 `moveCandidates`/`reparentMoved` logic unchanged — no watcher-side
  move detection needed.
- **`setLiveWatch(id, true)` called on an already-watching folder** (double click, or toggled on
  from two windows) must be idempotent — no duplicate chokidar instance leaked for the same id.
- **Watcher-limit fallback while a manual "Scan now" is independently in flight for the same
  folder**, or a debounce firing while an _unrelated_ manually-triggered scan is queued for that
  folder: `WatchManager`'s in-flight guard only tracks jobs _it_ enqueued (it has no visibility
  into jobs started elsewhere, since `JobProgressEvent` carries no `watchFolderId`). An occasional
  redundant second scan job is accepted as harmless — DD-004 Stage 1 is idempotent/incremental, so
  the extra job finds nothing new and finishes fast. Not deduped against; documented as a known,
  low-cost overlap rather than solved with a new global per-folder scan mutex (out of scope — see
  below).
- **Nested watch folders** (e.g. `/mnt/astro` and `/mnt/astro/2026-07-20` both added
  independently): a file landing in the nested path triggers both folders' watchers/debounces
  independently, producing two legitimately-scoped scan jobs (one per `watchFolderId`) — expected,
  not a duplicate-batch violation of the single-folder debounce guarantee.
- **`watchFolders.remove` for a folder with a pending debounce timer or in-flight watch-triggered
  scan job.** The DB row and its runtime watcher/timers are torn down; any already-running/queued
  scan job is left to finish (pre-existing P1-06 behavior — folder removal has never cancelled
  in-flight jobs, and this plan doesn't change that).

## Invariant Checklist

- [x] Non-destructive: the watcher only subscribes to fs change _notifications_ (chokidar's
      `add`/`change`/`unlink`/`error` events) and never writes/moves/renames/deletes anything;
      all actual reads remain the existing read-only `scan-job.ts` walker.
- [x] Layering: all new code (chokidar import, timers, fs-event handling) lives under
      `packages/desktop/src/main/watch/` and `main/index.ts`. `packages/core` is untouched — the
      only core import is the existing pure `SUPPORTED_EXTENSION_SET` constant.
- [x] DB: `live_watch_enabled` added via a Drizzle migration to an already-UUIDv7/`updated_at`
      table (`baseColumns()`); no new table needed.
- [x] Timestamps stored UTC: `WatchStatusEvent.updatedAt` is constructed with `new Date()` in the
      main process and serialized ISO-8601, same convention as every other audit timestamp.
- [x] Long-running work goes through the worker job queue: the watcher itself does no scanning —
      every debounce/fallback firing calls `orchestrator.enqueueScan`, which dispatches to the
      existing `worker_threads` pool unchanged. The watcher's own footprint (fs event listening,
      idle between events) is not "long-running work" in the budget sense, matching the existing
      main-process precedent of `detectDriveLabel`'s direct fs calls.
- [ ] **Performance budgets — flag, not a hard pass:** live watch re-triggers a **full** Stage 1
      incremental rewalk of the folder on every debounce/fallback firing, not a scoped
      per-changed-path scan. For a typical active folder (hundreds to a few thousand files) this
      is cheap (warm-cache rewalks measured ~6-7k stats/sec even on slow external media per prior
      benchmarking). For a very large single watch folder (tens of thousands of files) with
      frequent activity, repeated full rewalks could be a real, currently-unbudgeted cost; a
      scoped/targeted rescan is a reasonable future optimization but is explicitly out of scope
      here (see below) since neither the issue nor DD-004 require it and reusing the full
      incremental scan is what keeps move/delete/error-isolation handling free.

## Out of Scope

- Automatic recovery from fallback (periodic-rescan) mode back to live chokidar watching without
  an explicit user toggle-off/on or app restart.
- A scoped/targeted single-changed-file rescan job (perf optimization over the full incremental
  rewalk this plan reuses).
- Any change to the pre-existing `watch_folders.is_active` column's semantics, or a new
  "deactivate a whole folder" IPC endpoint — `is_active` is currently always `true` (no endpoint
  sets it otherwise); this plan only reads it as an additional gate (`isActive &&
liveWatchEnabled`) for which folders get a watcher at boot.
- A global toast/notification system for the renderer — the fallback notice is an inline,
  per-row status string, consistent with this screen's existing minimal UI.
- Deduplicating a watch-triggered scan against a concurrently manually-triggered scan for the
  same folder (both are cheap/idempotent; see Edge Cases).
- Persisting runtime watch mode (`'watching'`/`'fallback'`) to the database — it is ephemeral,
  recomputed by `WatchManager.start()` at every app boot.
- Real OS-level ENOSPC/EMFILE reproduction in the E2E suite (exhausting real inotify/file-handle
  limits in CI is unsafe/non-portable across macOS/Windows/Linux runners); the watcher-limit
  fallback path is covered by unit tests against a fake `WatcherFactory` that synthesizes the
  error, not by E2E.
- `watchFolders.add`'s input shape (no new `liveWatchEnabled` field added there) — every new
  folder is created watch-disabled and the user opts in afterward via the dedicated toggle.

## Open Questions

None. The two candidate blocking questions I considered — "should chokidar be one shared instance
or one per folder" and "manual timer vs. `awaitWriteFinish` for the 30s window" — both have a
clear DD-004/issue-consistent answer (per-folder instance; manual timer, with `awaitWriteFinish`
solving the separate smaller per-file-stability problem) argued above, so I made the call rather
than deferring it.
