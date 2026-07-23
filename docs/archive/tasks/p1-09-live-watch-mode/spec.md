# Spec: [P1-09] Live watch mode (chokidar)

**Slug:** p1-09-live-watch-mode **Issue:** #17 **Plan:** docs/archive/tasks/p1-09-live-watch-mode/plan.md **Date:** 2026-07-22

Criteria are tagged `[local]` (Reviewer verifies directly in this worktree/PR diff — unit tests,
E2E run locally via `pnpm e2e`, lint, typecheck, build) or `[github]` (only observable after push,
on the GitHub-hosted Actions run or repo settings — orchestrator verifies these on the PR, not the
Reviewer locally). This repo's CI (`.github/workflows/ci.yml`) does not run `pnpm e2e` in any job
today — both E2E acceptance scenarios are therefore `[local]`, verified by the Reviewer running
`pnpm e2e` in this worktree, not by a GitHub Actions leg.

**Issue #17 acceptance criteria (verbatim):**

1. Dropping files into a watched folder auto-catalogs them without manual rescan (E2E)
2. Debounce verified: burst of writes → single pipeline batch

## Definition of Done

### Functional Requirements

Given/When/Then, one observable behaviour per criterion, mapped to the plan's 7 Implementation Steps.

**Step 1 — migration**

- [ ] `[local]` Given `packages/db/src/schema/files.ts`'s `watchFolders` table, when read, then it
      gains a `liveWatchEnabled: integer('live_watch_enabled', { mode: 'boolean' }).notNull().default(false)`
      column (same shape/placement convention as the existing `isActive` column), and no other
      column on `watchFolders` or `files` is altered.
- [ ] `[local]` Given `packages/db`, when `pnpm --filter @astrotracker/db db:generate` is run (or
      already-generated output is inspected), then a new numbered migration SQL file plus updated
      `meta/000N_snapshot.json` and `meta/_journal.json` exist under `packages/db/drizzle/`, and the
      migration is hand-inspected to add exactly one column (`live_watch_enabled`, default `0`/`false`)
      to `watch_folders` — no other schema change riding along.
- [ ] `[local]` Given a fresh empty DB, when migrations run to head, then `watch_folders` has the new
      column with default `false`; given a DB seeded with a pre-existing P1-06/P1-08-era
      `watch_folders` row (no `live_watch_enabled` value written), when this migration runs, then
      that row also reads `liveWatchEnabled === false` (existing rows default, not null/undefined).
- [ ] `[local]` Given `packages/db/src/migrations.test.ts`, when read, then it is extended to cover
      the new column **only if** it already enumerates `watch_folders`' full column list (per the
      plan's Affected Files note); if it only checks table/index names today, the Coder documents in
      the PR description that no change was needed rather than silently skipping verification.

**Step 2 — IPC contract: toggle + status event**

- [ ] `[local]` Given `packages/desktop/src/ipc/contract.ts`, when read, then `WatchFolderRecord`
      gains `liveWatchEnabled: boolean`.
- [ ] `[local]` Given `contract.ts`, when read, then it exports a `WatchMode` type equal to
      `'watching' | 'fallback' | 'off'`, a `WatchStatusEvent` interface with exactly
      `{ watchFolderId: string; mode: WatchMode; message: string | null; updatedAt: string }`, and a
      `SetLiveWatchInput` interface with exactly `{ id: string; enabled: boolean }` (or an
      equivalently-named pair of fields carrying a watch-folder id and the desired boolean state —
      Reviewer confirms the actual field names against the Coder's implementation and that they are
      unambiguous).
- [ ] `[local]` Given `IPC_CHANNELS`, when read, then it gains exactly one new entry,
      `'watchFolders.setLiveWatch'`, appended without removing/reordering any existing channel, and
      `IpcContract` gains a matching `'watchFolders.setLiveWatch': { input: SetLiveWatchInput; output: WatchFolderRecord }`
      entry (or equivalent output shape returning the updated record, per the plan).
- [ ] `[local]` Given `IPC_EVENT_CHANNELS`, when read, then it gains exactly one new entry,
      `'watch.status'`, and `IpcEventContract` gains a matching
      `'watch.status': { payload: WatchStatusEvent }` entry.
- [ ] `[local]` Given `packages/desktop/src/ipc/contract.test.ts`, when read, then its channel-list
      assertion (`expect(IPC_CHANNELS).toEqual([...])`) is updated to include
      `'watchFolders.setLiveWatch'` and its event-channel assertion is updated to include
      `'watch.status'`, and the "binds every contract channel exactly once" /
      "has a handler for every contract channel" tests still pass with the new channel wired.
- [ ] `[local]` Given `packages/desktop/src/main/ipc/register.ts`, when read, then
      `IpcHandlerDeps.watchFolders` gains a `setLiveWatch(id: string, enabled: boolean): WatchFolderRecord | Promise<WatchFolderRecord>`
      member (or equivalent), `createIpcHandlers` implements `'watchFolders.setLiveWatch'` by
      validating the input (non-empty id string, boolean `enabled` — reusing the file's existing
      `requireObject`/`requireNonEmptyString` validation helpers) before delegating, and `IpcHandlers`
      being a mapped type over `IpcContract` means omitting the implementation is a compile error
      (Reviewer confirms `tsc` would fail without it, not just that it happens to be present).
- [ ] `[local]` Given `register.test.ts` coverage (in `contract.test.ts` per the plan's note that it
      may be the only exercising file — Reviewer confirms which file actually covers `register.ts`
      and treats that as the authoritative location), when read, then it asserts:
      `'watchFolders.setLiveWatch'` delegates to the injected dependency with the validated
      `{ id, enabled }` shape, and rejects a malformed input (missing/blank id, non-boolean
      `enabled`) before the dependency is ever called (mirroring the existing
      `watchFolders.remove`/`jobs.enqueueScan` id-validation test pattern at
      `packages/desktop/src/ipc/contract.test.ts:258-293`).

**Step 3 — chokidar adapter (DI seam)**

- [ ] `[local]` Given `packages/desktop/package.json`, when read, then `chokidar` (v5.x) is listed
      under `dependencies` (not `devDependencies`), and no `electron-rebuild`/native-module wiring is
      added for it — the existing `predev`/`package`/`pree2e`/`pretest` scripts' `electron-rebuild -f -w better-sqlite3` invocations are unchanged (chokidar v4+ has no native dependency).
- [ ] `[local]` Given `packages/desktop/src/main/watch/types.ts` (new), when read, then it defines a
      `WatcherLike` interface exposing at minimum `on(event: 'add' | 'change' | 'unlink' | 'error', listener: (...) => void): void` and `close(): Promise<void>`, and a `WatcherFactory` type
      `(rootPath: string, options: ...) => WatcherLike` — the DI seam `watch-manager.ts` is built
      against, distinct from any real chokidar type.
- [ ] `[local]` Given `packages/desktop/src/main/watch/chokidar-watcher.ts` (new), when read, then it
      constructs a real watcher via `chokidar.watch(rootPath, options)` with
      `ignoreInitial: true`, `followSymlinks: false`, and
      `awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 }` set explicitly (not left to
      chokidar's defaults), and builds an `ignored` predicate from the union of
      `SUPPORTED_EXTENSION_SET` (imported from `@astrotracker/core`), the folder's `skipPatterns`, and
      the same baked-in dotfile/`node_modules` skip `scan-job.ts` already applies (Reviewer diffs the
      predicate logic against `scan-job.ts`'s equivalent skip logic for consistency, not a literal
      code copy).
- [ ] `[local]` Given `packages/desktop/src/main/watch/chokidar-watcher.test.ts` (new), when run, then
      it unit-tests the `ignored` predicate directly (sample in-scope paths: a supported extension
      under a non-skipped dir; sample out-of-scope paths: a dotfile, a `node_modules/` entry, an
      unsupported extension, a path matching a configured `skipPattern`) without constructing a real
      chokidar watcher or touching the filesystem.

**Step 4 — `WatchManager`**

- [ ] `[local]` Given `packages/desktop/src/main/watch/watch-manager.ts` (new), when read, then it
      exposes at least `start(): void`, `setEnabled(watchFolderId: string, enabled: boolean): void`
      (or equivalent naming — Reviewer confirms against the Coder's actual signatures), `stop(watchFolderId: string): void`, and `stopAll(): Promise<void>`, constructed with injected
      `debounceMs`, `fallbackRescanIntervalMs`, a `WatcherFactory`, `enqueueScan` (matching
      `JobQueueOrchestrator.enqueueScan`'s signature), an orchestrator event source (matching
      `JobQueueOrchestrator.onEvent`'s signature) to detect in-flight/terminal job status per folder,
      and an `onStatusChange(event: WatchStatusEvent-shaped payload): void` callback.
- [ ] `[local]` Given a started watcher for a folder, when any qualifying fs event (`add`/`change`/`unlink`) fires, then the folder's debounce timer is reset (not accumulated), and when the timer
      finally fires with no scan already queued/running for that folder, then exactly one
      `enqueueScan({ watchFolderId, ... })` call happens.
- [ ] `[local]` Given a debounce timer firing while a watch-triggered scan for the same folder is
      already queued or running, then no second `enqueueScan` call happens at that moment, and a
      `pendingRescan` flag is set so that once the in-flight job reaches a terminal status
      (`completed`/`failed`/`cancelled`), exactly one deferred `enqueueScan` call happens for that
      folder — verified via `watch-manager.test.ts` with a fake orchestrator event source and
      `vi.useFakeTimers()`.
- [ ] `[local]` Given a chokidar `'error'` event whose `.code` is `'ENOSPC'`, `'EMFILE'`, or
      `'ENFILE'` for a folder's watcher, then that folder's watcher is closed
      (`WatcherLike.close()` awaited), a periodic-rescan `setInterval`/equivalent timer at
      `fallbackRescanIntervalMs` is started in its place, and `onStatusChange` is invoked with
      `mode: 'fallback'` and a non-null `message`.
- [ ] `[local]` Given a chokidar `'error'` event whose `.code` is anything else (e.g. `'ENOENT'`),
      then the folder's watcher is left running (or, if already torn down by chokidar itself, is
      **not** replaced with a fallback timer) — the error is logged only, no mode transition, no
      `enqueueScan` call, matching the plan's Edge Cases "disconnected/missing watch-folder root"
      case.
- [ ] `[local]` Given `WatchManager.start()` or `setEnabled(id, true)` for a folder, then in addition
      to attaching the live watcher, exactly one immediate catch-up `enqueueScan` call happens
      through the same in-flight-guarded path the debounce uses (covers `ignoreInitial: true`
      meaning pre-existing tree contents produce no chokidar events).
- [ ] `[local]` Given `setEnabled(id, true)` called twice in a row (or from two concurrent callers)
      for the same folder, then only one chokidar watcher instance exists for that folder afterward —
      no duplicate/leaked watcher (idempotency, per the plan's Edge Cases).
- [ ] `[local]` Given every mode transition (`'watching'` → `'fallback'` → `'off'` and back), then
      `onStatusChange` is invoked with a `updatedAt` that is a UTC ISO-8601 string constructed from
      `new Date()` at transition time (Reviewer checks the implementation constructs the timestamp
      with `new Date()`, not a hardcoded/mocked value, and serializes via `.toISOString()` or
      equivalent).
- [ ] `[local]` Given `watch-manager.test.ts`, when run, then it covers — at minimum, as distinct
      test cases — every scenario listed under the plan's Edge Cases section: continuous sub-debounce
      trickle never flushes (documented behavior, not a bug — a test asserting the timer keeps
      resetting and never fires under continuous sub-interval events is sufficient, no max-wait
      ceiling assertion); app-restart/toggle-on catch-up scan; disconnected/missing root leaves mode
      unchanged; rename/move (`unlink`+`add` pair) coalesces into one debounce firing; idempotent
      double-enable; watcher-limit fallback while an unrelated manually-triggered scan is in flight
      for the same folder (no dedup attempted — both may fire); nested watch folders each debounce
      independently (two folders, one nested under the other, each produce their own scoped
      `enqueueScan` call); `stop()`/removal tears down timers/watcher without waiting for or
      cancelling an already-in-flight scan job.
- [ ] `[local]` Given `watch-manager.test.ts`'s timer-driven assertions, then they use
      `vi.useFakeTimers()`/`vi.advanceTimersByTime(...)` (or equivalent deterministic timer control)
      — no test sleeps a real 30 s or waits on wall-clock time.

**Step 5 — wire into `main/index.ts`**

- [ ] `[local]` Given `packages/desktop/src/main/index.ts`, when read, then it constructs a
      `WatchManager` with `debounceMs`/`fallbackRescanIntervalMs` read from
      `process.env['ASTROTRACKER_WATCH_DEBOUNCE_MS']` / `process.env['ASTROTRACKER_WATCH_FALLBACK_INTERVAL_MS']`, falling back to `30_000`/`300_000` on a missing or
      invalid (non-numeric, non-positive) value — the same single-env-var-override pattern already
      used for `ELECTRON_RENDERER_URL` (`main/index.ts:39`).
- [ ] `[local]` Given app boot (`app.whenReady().then(...)`), then `watchManager.start()` is called
      alongside `orchestrator.start()` (`main/index.ts:194` today), and at that point every
      `watch_folders` row with `isActive && liveWatchEnabled` gets a live watcher attached (folders
      that are inactive or not opted in get none).
- [ ] `[local]` Given the `watchFolders.setLiveWatch` handler wiring in `main/index.ts`, then it both
      persists the flag via `database.repos.watchFolders.update(id, { liveWatchEnabled: enabled })`
      (the existing `CrudRepository.update` re-stamps `updated_at`, per
      `packages/db/src/repositories/shared.ts`) and calls `watchManager.setEnabled(id, enabled)` to
      flip the runtime watcher — both effects happen from one IPC call, not one without the other.
- [ ] `[local]` Given a `watch.status` event from `WatchManager`, then it is broadcast to every
      renderer window the same way `jobs.progress` already is (`broadcastIpcEvent(() =>
      BrowserWindow.getAllWindows().map((w) => w.webContents), 'watch.status', payload)`).
- [ ] `[local]` Given the `watchFolders.remove` handler, then it tears down that folder's runtime
      watcher/timers (`watchManager.stop(id)`) before or as part of removing the DB row — no watcher
      left running against a folder whose row no longer exists.
- [ ] `[local]` Given `app.on('before-quit', ...)`, then `watchManager.stopAll()` (or equivalent) is
      called alongside the existing `pool?.terminateAll()`/`database?.close()` shutdown sequence, so
      no `setInterval` or open chokidar handle keeps the process alive after quit.
- [ ] `[local]` Given `packages/desktop/src/main/ipc/broadcast.ts`, when read, then either a
      `toIpcWatchStatusEvent` mapping helper exists alongside `toIpcJobProgressEvent` (if the
      `WatchManager`'s internal event shape needs translating to `WatchStatusEvent`), or the Coder's
      PR description explicitly notes the shapes already match and no mapping helper was needed — the
      Reviewer does not require a helper that isn't necessary.
- [ ] `[local]` Given `broadcast.test.ts`, when read, then it gains coverage for whatever the
      preceding item resolves to (a new mapping function's unit test, or — if no mapping was
      needed — no new test is required and the PR description says so).

**Step 6 — renderer**

- [ ] `[local]` Given `packages/desktop/renderer/src/WatchFolders.tsx`, when read, then each
      watch-folder row gains a toggle control (button or equivalent) that calls
      `ipc.invoke('watchFolders.setLiveWatch', { id: folder.id, enabled: !folder.liveWatchEnabled })`
      (or the actual resolved input shape), labeled to reflect the current state (e.g. "Enable live
      watch" when off, "Disable live watch" when on).
- [ ] `[local]` Given the same row, then an inline `aria-live` status element renders a string seeded
      from `folder.liveWatchEnabled` (e.g. "Live watch: off" / "Live watch: watching") and refined by
      any `watch.status` event received for that folder's id (subscribed via
      `ipc.on('watch.status', ...)`, following the existing `scanEvents`/`folderByJob`
      keyed-by-folder-id local-state pattern already used for `jobs.progress` in this file), including
      the fallback message when `mode === 'fallback'` (e.g. "Live watch: fallback — <message>").
- [ ] `[local]` Given the toggle mutation succeeds, then the `watchFolders.list` query cache is
      invalidated/updated so `folder.liveWatchEnabled` reflects the new state without a manual reload
      (mirroring the existing `addMutation`/`removeMutation` `onSuccess` invalidation pattern).
- [ ] `[local]` Given `packages/desktop/renderer/src/WatchFolders.test.tsx`, when run, then it covers:
      the toggle button invoking `watchFolders.setLiveWatch` with the correct input; the status text
      rendering `'off'`/`'watching'`/`'fallback — <message>'` for each of the three `WatchMode`
      values; and a received `watch.status` event for a given folder id updating only that folder's
      row, not others.

**Step 7 — E2E (the two issue acceptance criteria)**

- [ ] `[local]` Given `packages/desktop/e2e/fixtures.ts`, when read, then it gains an additive,
      defaulted `electronEnv` fixture merged into the env object passed to `_electron.launch()` (per
      `launchElectron`'s current `env` construction at `fixtures.ts:51-60`), settable per-spec via
      `test.use({ electronEnv: {...} })`, and no existing fixture behavior (`electronApp`,
      `appDataDir`, `libraryDir`, the `ELECTRON_RUN_AS_NODE` deletion) is changed for specs that don't
      opt in.
- [ ] `[local]` Given `packages/desktop/e2e/watch-folders.spec.ts`, then it is **not modified** by
      this PR (byte-for-byte diff-empty) — the plan explicitly scopes the new fixture as additive and
      routes both new scenarios through a new spec file instead.
- [ ] `[local]` **Acceptance criterion 1 (issue, verbatim): "Dropping files into a watched folder
      auto-catalogs them without manual rescan."** Given `packages/desktop/e2e/watch-mode.spec.ts`
      (new), when a watch folder is added, live watch is enabled for it via
      `watchFolders.setLiveWatch`, and a fixture file is then copied/written into that folder's
      directory on disk (not via `jobs.enqueueScan` — the test must not itself trigger a scan), then
      polling `files.listByWatchFolder` eventually shows a `files` row for the dropped file, using
      `expect.poll(...)` against a shrunk `electronEnv`-provided debounce (hundreds of ms, not 30 s)
      — no real 30 s wait, no manual scan call anywhere in the test body.
- [ ] `[local]` **Acceptance criterion 2 (issue, verbatim): "Debounce verified: burst of writes →
      single pipeline batch."** Given the same or a sibling test in `watch-mode.spec.ts`, when a
      rapid burst of multiple file writes (at least 3) lands in a live-watched folder within a
      window shorter than the shrunk debounce, then polling `jobs.list` (or an equivalent count of
      `'scan'`-type jobs attributable to that watch folder) shows the `'scan'`-job count for that
      folder increases by **exactly one** across the whole burst, not one per file — asserted via a
      count comparison (before-burst count vs. after-settle count), never a real-time sleep.
- [ ] `[local]` Given both new E2E tests, then they assert on job counts / DB state via polling
      (`expect.poll` with bounded `timeout`/`intervals`, following the existing
      `watch-folders.spec.ts` poll pattern at lines 57-69), never a fixed real-time `page.waitForTimeout`-style sleep for the debounce window itself.
- [ ] `[local]` Given `pnpm --filter @astrotracker/desktop e2e` (or root `pnpm e2e`), when run, then
      `watch-mode.spec.ts`'s tests and the pre-existing `watch-folders.spec.ts`'s test all pass.

### Data Integrity

- [ ] `[local]` `watch_folders.live_watch_enabled` exists as `INTEGER NOT NULL DEFAULT 0` (boolean
      mode), UUIDv7 PK and `updated_at` already present via `baseColumns()` (no new table); created
      by the Step 1 Drizzle-generated migration file.
- [ ] `[local]` Migration round-trips (`up` on an empty DB, and `up` applied to a DB already
      containing pre-existing `watch_folders` rows from earlier migrations) without error or data
      loss to any other column.
- [ ] `[local]` `SetLiveWatchInput`'s `enabled` field is validated as a strict boolean (not a
      truthy/falsy coercion of an arbitrary value) before the `register.ts` handler delegates,
      matching the file's existing validation-before-delegation convention.

### Core Invariants

- [ ] `[local]` **Non-destructive:** the diff contains no fs write/rename/unlink/move call anywhere
      under `packages/desktop/src/main/watch/` or in the `WatchManager`/chokidar-adapter code path —
      Reviewer greps `grep -rnE "fs\.(write|rename|unlink|rm|move)|rename\(|unlink\(" packages/desktop/src/main/watch/` and confirms zero production hits (test-only fixture writes in
      `*.test.ts`/`e2e/*.spec.ts` are expected and fine). All actual file reads for cataloging remain
      inside the existing, unmodified `scan-job.ts` walker.
- [ ] `[local]` **Layering (DD-002):** all new chokidar/timer/fs-event code lives under
      `packages/desktop/src/main/watch/` and `main/index.ts`; `packages/core` is untouched by this
      diff except for the pre-existing `SUPPORTED_EXTENSION_SET`/`SUPPORTED_EXTENSIONS` import
      (Reviewer confirms via `git diff --stat` that no file under `packages/core/` appears).
- [ ] `[local]` **DB (DD-003):** the new column lands on the already-UUIDv7/`updated_at` table
      (`watchFolders`, via `baseColumns()`); no new table is introduced.
- [ ] `[local]` **UTC timestamps:** `WatchStatusEvent.updatedAt` is constructed with `new Date()` in
      the main process and serialized ISO-8601, consistent with every other audit timestamp in this
      codebase.
- [ ] `[local]` **Long-running work through the worker queue:** the watcher/`WatchManager` itself does
      no filesystem scanning or hashing directly — Reviewer confirms `watch-manager.ts` contains no
      call into `scan-job.ts`/the worker protocol directly, only calls to the injected `enqueueScan`
      function, which dispatches through the existing, unmodified `worker_threads` pool
      (`orchestrator.ts`/`pool.ts` diff-empty).
- [ ] `[local]` **Performance budgets — flagged, accepted, not a blocking gap:** the Reviewer must
      **not** require a scoped/per-changed-file rescan optimization. Confirm the PR description (or
      an inline comment in `watch-manager.ts`) states that every debounce/fallback firing triggers a
      full Stage 1 incremental rewalk of the folder (not a targeted rescan), and that this is an
      accepted, documented tradeoff per the plan's Invariant Checklist, not a defect to fix in this
      PR.

### Tests

- [ ] `[local]` Table-driven/scenario unit tests exist and pass for every item in the plan's Edge
      Cases section (see the Step 4 functional-requirement bullet above for the enumerated list) —
      Reviewer treats a missing scenario as a gap, not an omission to wave through.
- [ ] `[local]` All existing tests still pass: `pnpm -r test` (root) or the per-package equivalents
      (`pnpm --filter @astrotracker/db test`, `pnpm --filter @astrotracker/desktop test`) exit 0,
      including the pre-existing, untouched `watch-folders.spec.ts` E2E test.
- [ ] `[local]` `pnpm -r build` (typecheck across all packages) exits 0.
- [ ] `[local]` `pnpm -r lint` (ESLint + Prettier across all packages) exits 0, including the
      renderer's type-only-import ESLint rule on `contract.ts` (no runtime import of `contract.ts`
      crossing into the renderer beyond what's already allowed).
- [ ] `[local]` `pnpm e2e` (or `pnpm --filter @astrotracker/desktop e2e`) exits 0, covering both new
      `watch-mode.spec.ts` scenarios plus the unmodified `watch-folders.spec.ts`.

### GitHub-only verification

- [ ] `[github]` The PR's CI run shows the `test` job green across all three matrix legs
      (`ubuntu-latest`, `windows-latest`, `macos-latest`) — in particular, chokidar's cross-platform
      fs-event behavior (inotify/FSEvents/ReadDirectoryChangesW) does not need OS-specific code in
      this PR, but the matrix run is the only place that's actually confirmed; a Coder claim of
      "should work on Windows/macOS" is not sufficient without this leg passing.
- [ ] `[github]` The PR's CI run shows the `bench` job green (no benchmark regression introduced;
      this PR is not expected to touch any benchmarked code path, but the job must still pass).
- [ ] `[github]` The `ci-ok` aggregate required check is green (both `test` and `bench` succeeded),
      satisfying this repo's branch-protection requirement.
- [ ] `[github]` No new CI job is required for this PR — the plan adds no new workflow file/job; the
      orchestrator confirms `.github/workflows/ci.yml` is diff-empty (or, if the Coder did touch it,
      that the change is unrelated/justified) as part of its `[github]` pass.

## Out of Scope

Copied from the plan's Out of Scope, expanded — the Reviewer must **not** flag any of the following
as a gap:

- Automatic recovery from fallback (periodic-rescan) mode back to live chokidar watching without an
  explicit user toggle-off/on or app restart.
- A scoped/targeted single-changed-file rescan job (a full incremental rewalk is reused instead —
  see the Performance-budgets invariant above).
- Any change to `watch_folders.is_active`'s existing semantics or a new "deactivate a whole folder"
  endpoint; this PR only adds `liveWatchEnabled` as an additional gate alongside the pre-existing,
  unmodified `isActive`.
- A global toast/notification system for the renderer — the fallback notice is an inline, per-row
  status string only.
- Deduplicating a watch-triggered scan against a concurrently manually-triggered scan for the same
  folder (both are accepted as cheap/idempotent; not solved by a new mutex).
- Persisting runtime watch mode (`'watching'`/`'fallback'`) to the database — it is ephemeral,
  recomputed by `WatchManager.start()` at every app boot. No column for it is expected.
- Real OS-level `ENOSPC`/`EMFILE` reproduction in the E2E suite — the watcher-limit fallback path is
  unit-tested only, against a fake `WatcherFactory` synthesizing the error; its absence from
  `watch-mode.spec.ts` is correct, not a gap.
- `watchFolders.add`'s input shape gaining a `liveWatchEnabled` field — every new folder is created
  watch-disabled by default; the toggle is a separate, subsequent call.
- Any change to `packages/core` — no domain logic is added by this issue.
- Any change to `packages/desktop/src/preload/*` — the IPC whitelist is derived mechanically from
  `IPC_CHANNELS`/`IPC_EVENT_CHANNELS` and is already covered by existing generic tests; a new
  channel/event needs no preload edit.
- Any change to the worker protocol (`protocol.ts`, `worker-entry.ts`, `pool.ts`) — the watcher talks
  only to `orchestrator.enqueueScan`/`orchestrator.onEvent`, never to a worker directly.
- `electron-rebuild`/native-module wiring for chokidar — it is pure JS (v4+ dropped `fsevents`); its
  absence from `package.json`'s `predev`/`package`/`pree2e`/`pretest` scripts is correct.

## Test Hints

Concrete scenarios translatable directly into tests, keyed to the plan's Edge Cases and the two
issue acceptance criteria:

- **debounce-resets-on-each-event**: with fake timers, fire `add` at t=0, `change` at t=10ms
  (< debounceMs), assert `enqueueScan` has not yet been called; advance past `debounceMs` from the
  last event, assert exactly one `enqueueScan` call.
- **in-flight-guard-defers-not-drops**: simulate an `enqueueScan`-triggered job still `running` when
  the debounce fires again; assert no second `enqueueScan` call at that moment, then simulate the job
  reaching `completed` and assert exactly one deferred `enqueueScan` call follows.
- **watcher-limit-enters-fallback**: inject a fake `WatcherLike` that emits `{ code: 'EMFILE' }` on
  `'error'`; assert `close()` was called, a fallback interval was armed, and `onStatusChange` fired
  with `mode: 'fallback'`.
- **enoent-does-not-enter-fallback**: inject a fake error with `{ code: 'ENOENT' }`; assert no
  fallback interval armed, no mode-transition callback fired (or `mode` unchanged).
- **catch-up-scan-on-start**: call `start()`/`setEnabled(id, true)` for a folder whose watcher was
  just attached; assert exactly one immediate `enqueueScan` call independent of any fs event.
- **idempotent-double-enable**: call `setEnabled(id, true)` twice; assert the fake `WatcherFactory`
  was invoked exactly once for that folder id.
- **nested-folders-independent-debounce**: two `WatchManager`-tracked folders where one root is a
  subdirectory of the other; a fs event under the nested path fires both folders' handlers; assert
  two separate `enqueueScan` calls, one per `watchFolderId`.
- **e2e-drop-file-autocatalogs** (`watch-mode.spec.ts`): add a watch folder, `setLiveWatch(id, true)`,
  copy one fixture file (e.g. `fits/apt/apt-ccd-light.fits`) into the folder's directory on disk
  using Node `fs` directly (not through any IPC scan call), `expect.poll` on
  `files.listByWatchFolder` until it contains one row matching the dropped file's name/size, with a
  bounded timeout comfortably larger than the `electronEnv`-shrunk debounce.
- **e2e-burst-single-batch** (`watch-mode.spec.ts`): after enabling live watch, read the current
  `'scan'`-job count for the folder from `jobs.list`, write 3+ fixture files into the folder in quick
  succession (well within one shrunk debounce window), `expect.poll` until the count of `files` rows
  matches the burst size (proving cataloging happened), then assert the `'scan'`-job count for that
  folder increased by exactly 1 over the pre-burst count — not by 3.

Spec written: docs/archive/tasks/p1-09-live-watch-mode/spec.md
