import { randomUUID } from 'node:crypto';
import path from 'node:path';

import type { ParsedFrame } from '@astrotracker/core';
import type {
  FilesRepository,
  FramesRepository,
  NewFrame,
  ScanJob,
  ScanJobsRepository,
  WatchFoldersRepository,
} from '@astrotracker/db';

import type { DispatchJob, WorkerPool, WorkerPoolCallbacks } from './pool.js';
import type {
  DiscoveredFile,
  HashCandidate,
  HashJobPayload,
  JobType,
  KnownFileStat,
  ScanJobPayload,
} from './protocol.js';

/**
 * Max unhashed files one `'hash'` job pulls per dispatch (P1-08). Bounded so a
 * single hash job never tries to read an entire multi-hundred-GB drive's
 * unhashed backlog in one shot — that would monopolize the worker slot and
 * starve higher-priority scan work between `pump()` cycles. A backlog larger
 * than this drains across successive hash jobs (each `onDone` re-enqueues one
 * while any remains), and every new hash job re-enters the priority queue, so a
 * scan enqueued meanwhile always wins the next claim (see HASH_JOB_PRIORITY).
 */
const HASH_BATCH_LIMIT = 500;

/**
 * Priority for background `'hash'` jobs — below the default 0 used by
 * `'scan'`/`'demo'`. `scanJobs.claimNext` already orders `desc(priority)`, so a
 * queued scan is always claimed before a queued hash job: hashing throttles
 * under active scanning (DD-004 "lowest priority"; P1-08 acceptance criterion)
 * using machinery that already exists — no scheduler changes.
 */
const HASH_JOB_PRIORITY = -1;

export interface JobProgressEvent {
  jobId: string;
  jobType: string;
  status: string;
  current: number;
  total: number | null;
  message: string | null;
}

export interface JobQueueOrchestrator {
  readonly callbacks: WorkerPoolCallbacks;
  start(): void;
  enqueueDemo(input?: { totalSteps?: number; stepMs?: number }): { jobId: string };
  /**
   * Enqueue a `'scan'` job (P1-06 Stage 1). The caller (an IPC handler) has
   * already resolved the watch folder's `rootPath`/`extensions`/`skipPatterns`
   * and passes the full payload — the orchestrator does no watch-folder lookup.
   */
  enqueueScan(input: {
    watchFolderId: string;
    rootPath: string;
    extensions: string[];
    skipPatterns?: string[];
  }): { jobId: string };
  /**
   * Enqueue a background `'hash'` job (DD-004 Stage 5a, P1-08) at
   * {@link HASH_JOB_PRIORITY}. Unconditional (unlike the internal auto-trigger,
   * which only enqueues when there's an unhashed backlog) — for manual/test
   * triggering. The payload is rebuilt fresh at dispatch time from
   * `filesRepo.listUnhashed(...)`, so an empty enqueue is harmless (it dispatches
   * a no-op job when nothing is unhashed).
   */
  enqueueHash(): { jobId: string };
  cancel(jobId: string): void;
  list(): Array<{
    id: string;
    jobType: string;
    status: string;
    progressCurrent: number;
    progressTotal: number | null;
    progressMessage: string | null;
  }>;
  onEvent(listener: (event: JobProgressEvent) => void): () => void;
}

export interface CreateJobQueueOrchestratorOptions {
  scanJobs: ScanJobsRepository;
  /**
   * Files repository for `'scan'`-job Stage-1 upserts (P1-06). Optional so the
   * P0-05 demo-only wiring (and any caller that never enqueues scans) still
   * constructs an orchestrator; when absent, `'scan'` discovery batches are
   * ignored. Production (`main/index.ts`) must supply it for scans to persist.
   */
  files?: FilesRepository;
  /**
   * Frames repository for `'scan'`-job Stage-2/3 upserts (P1-07). Optional for
   * the same reason as `files`: demo-only wiring and pure Stage-1 callers omit
   * it. When present (production, and P1-07 tests), a successfully parsed
   * new/changed file gets its `frames` row written via `upsertByFileId`; when
   * absent, parse results are ignored (files/parse-errors still persist).
   */
  frames?: FramesRepository;
  /**
   * Watch-folders repository, needed only to resolve a `'hash'` job's
   * candidate files to absolute paths (`path.join(watchFolder.path,
   * file.relativePath)`) — `files` rows store only `relativePath` +
   * `watchFolderId` (P1-08). Optional, same reasoning as `files`/`frames`: when
   * absent, `'hash'` jobs simply resolve zero candidates (`dispatchJobFor` can't
   * build absolute paths), so they complete as no-ops — mirroring how `'scan'`
   * payloads are unaffected when `files` is absent.
   */
  watchFolders?: WatchFoldersRepository;
  /**
   * Runs `fn` inside a single DB transaction, used to batch each discovered
   * file group's upserts atomically (DD-002 single-writer). Optional — when
   * omitted, upserts still happen, just one statement at a time (no batch
   * atomicity). Wire it as `(fn) => database.transaction(() => fn())`
   * (`AstroDatabase.transaction` is also directly assignable here).
   */
  transaction?: <T>(fn: () => T) => T;
  createPool(callbacks: WorkerPoolCallbacks): WorkerPool;
}

function parsePayload(job: ScanJob): Record<string, unknown> {
  if (job.payloadJson === null) {
    return {};
  }
  const parsed: unknown = JSON.parse(job.payloadJson);
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function toDispatchJob(job: ScanJob): DispatchJob {
  const payload = {
    ...parsePayload(job),
    resumeFrom: job.progressCurrent,
  };
  return {
    id: job.id,
    jobType: job.jobType as JobType,
    payload,
  };
}

/**
 * Resolve the watch-folder id for a scan job: prefer the dedicated
 * `watch_folder_id` column, falling back to the JSON payload. Both are
 * persisted by `enqueueScan`, so this survives the orphan-requeue-after-restart
 * path (no in-memory map needed). Returns `undefined` for a non-scan job.
 */
function watchFolderIdOf(job: ScanJob): string | undefined {
  if (job.watchFolderId !== null) {
    return job.watchFolderId;
  }
  const payload = parsePayload(job);
  return typeof payload.watchFolderId === 'string' ? payload.watchFolderId : undefined;
}

/**
 * Parse a `FrameMetadata.dateObs` string to a UTC `Date` for the
 * `frames.date_obs_utc` timestamp column, or `null` when absent/unparseable.
 * FITS `DATE-OBS` and the RAW normalizer both emit ISO-8601 (RAW without a
 * `Z` when the camera wrote no UTC offset — treated as-written, which
 * `Date.parse` reads in the host zone; acceptable for an approximate local
 * capture time, and the raw string is preserved in `headers_json` regardless).
 */
function parseDateObs(dateObs: string | null): Date | null {
  if (dateObs === null) {
    return null;
  }
  const ms = Date.parse(dateObs);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/**
 * Map a worker-parsed {@link ParsedFrame} onto a `frames` insert row (P1-07).
 * The classification field names already match the columns; the normalized
 * metadata scalars are renamed to their `frames` columns, and the full raw
 * keyword dict is serialized into `headers_json` (DD-004: preserve everything
 * for forward-compat). Columns owned by later stages / the user (target,
 * filter, session, equipment, quality metrics) are intentionally omitted so
 * `upsertByFileId` never clobbers them on re-parse.
 */
function toFrameRow(fileId: string, parsed: ParsedFrame): NewFrame {
  const m = parsed.metadata;
  return {
    fileId,
    frameType: parsed.frameType,
    frameTypeSource: parsed.frameTypeSource,
    objectRaw: m.object,
    filterRaw: m.filter,
    exposureSeconds: m.exposureSeconds,
    dateObsUtc: parseDateObs(m.dateObs),
    telescopeRaw: m.telescope,
    cameraRaw: m.instrument,
    ccdTemp: m.ccdTempCelsius,
    setTemp: m.setTempCelsius,
    gain: m.gain,
    offset: m.offset,
    binningX: m.binningX,
    binningY: m.binningY,
    widthPx: m.widthPixels,
    heightPx: m.heightPixels,
    raDeg: m.raDegrees,
    decDeg: m.decDegrees,
    focalLength: m.focalLengthMm,
    aperture: m.apertureDiameterMm,
    pierSide: m.pierSide,
    airmass: m.airmass,
    observer: m.observer,
    siteName: m.siteName,
    bayerPattern: m.bayerPattern,
    headersJson: JSON.stringify(m.headers),
  };
}

export function createJobQueueOrchestrator({
  scanJobs,
  files,
  frames,
  watchFolders,
  transaction = (fn) => fn(),
  createPool,
}: CreateJobQueueOrchestratorOptions): JobQueueOrchestrator {
  const listeners = new Set<(event: JobProgressEvent) => void>();
  let started = false;

  /**
   * Attach dispatch-time-fresh payload fields per job type: `'scan'` gets its
   * `knownFiles` snapshot + move `moveCandidates` (P1-07/P1-08); `'hash'` gets a
   * freshly-rebuilt candidate list (P1-08). Everything else (and the
   * no-files-repo wiring) dispatches unchanged.
   */
  function dispatchJobFor(job: ScanJob): DispatchJob {
    const base = toDispatchJob(job);
    if (job.jobType === 'hash') {
      return dispatchHashJob(base);
    }
    if (job.jobType === 'scan' && files !== undefined) {
      return dispatchScanJob(job, base, files);
    }
    return base;
  }

  /**
   * Build the `knownFiles` snapshot (relativePath → size/mtime) the worker uses
   * for the DD-004 incremental skip (P1-07), plus the `moveCandidates` list —
   * every `'missing'` row (across ALL watch folders) that already has a
   * `sha256` — for DD-004 move detection (P1-08). Both are read at dispatch time
   * so they reflect the freshest indexed state.
   */
  function dispatchScanJob(
    job: ScanJob,
    base: DispatchJob,
    filesRepo: FilesRepository,
  ): DispatchJob {
    const watchFolderId = watchFolderIdOf(job);
    if (watchFolderId === undefined) {
      return base;
    }
    const knownFiles: Record<string, KnownFileStat> = {};
    for (const file of filesRepo.listByWatchFolder(watchFolderId)) {
      knownFiles[file.relativePath] = {
        sizeBytes: file.sizeBytes,
        fileMtimeMs: file.fileMtime === null ? null : file.fileMtime.getTime(),
      };
    }
    const moveCandidates = filesRepo.listMissingWithHash().map((candidate) => ({
      fileId: candidate.fileId,
      sha256: candidate.sha256,
      sizeBytes: candidate.sizeBytes,
    }));
    return {
      ...base,
      payload: { ...(base.payload as ScanJobPayload), knownFiles, moveCandidates },
    };
  }

  /**
   * Rebuild a `'hash'` job's payload fresh at dispatch time (P1-08): pull up to
   * {@link HASH_BATCH_LIMIT} unhashed files and resolve each to its absolute
   * path via its watch folder. Always yields a valid `HashJobPayload` (an empty
   * `files` list when `files`/`watchFolders` aren't wired or nothing is
   * unhashed), so the worker never sees a malformed payload.
   */
  function dispatchHashJob(base: DispatchJob): DispatchJob {
    const candidates: HashCandidate[] = [];
    if (files !== undefined && watchFolders !== undefined) {
      for (const file of files.listUnhashed(HASH_BATCH_LIMIT)) {
        const watchFolder = watchFolders.getById(file.watchFolderId);
        if (watchFolder === undefined) {
          continue;
        }
        candidates.push({
          fileId: file.id,
          absolutePath: path.join(watchFolder.path, file.relativePath),
          sizeBytes: file.sizeBytes,
        });
      }
    }
    const payload: HashJobPayload = { files: candidates };
    return { ...base, payload };
  }

  function emit(job: ScanJob, message: string | null = job.progressMessage): void {
    const event: JobProgressEvent = {
      jobId: job.id,
      jobType: job.jobType,
      status: job.status,
      current: job.progressCurrent,
      total: job.progressTotal,
      message,
    };
    for (const listener of listeners) {
      listener(event);
    }
  }

  function pump(): void {
    while (pool.idleCount() > 0) {
      const claimed = scanJobs.claimNext(`worker-${randomUUID()}`);
      if (claimed === undefined) {
        return;
      }
      if (claimed.cancelRequested) {
        const cancelled = scanJobs.markCancelled(claimed.id);
        if (cancelled !== undefined) {
          emit(cancelled, 'cancelled before resume');
        }
        continue;
      }
      const dispatched = pool.dispatch(dispatchJobFor(claimed));
      if (!dispatched) {
        return;
      }
      // Do not reuse the last persisted progress message on a resumed claim:
      // renderer consumers distinguish real worker progress ticks by their
      // step message, and replaying it here would duplicate the restart
      // sequence even though no step ran twice.
      emit(claimed, 'running');
    }
  }

  /**
   * Persist one discovered-file batch (DD-004 Stages 1–3). For every file:
   * upsert its `files` row (Stage 1, P1-06); then, when the worker attached a
   * Stage-2/3 outcome (i.e. the file was new/changed), either write its
   * `frames` row and clear any stale parse error (parse ok), or record the
   * parse error and leave no `frames` row (parse failed) — a bad file never
   * aborts the batch (DD-004 error isolation). Unchanged files carry neither
   * outcome, so their existing `frames`/`parse_error` are left as-is (P1-07
   * incremental idempotency).
   *
   * `seenAt` is the scan job's persisted `startedAt` (one cutoff for the whole
   * run's missing-detection, not `new Date()` per batch). The whole batch runs
   * in one transaction for atomicity / write throughput; the scan-summary
   * counters are bumped once after it commits.
   */
  function processDiscoveredBatch(jobId: string, discovered: DiscoveredFile[]): void {
    if (files === undefined || discovered.length === 0) {
      return;
    }
    const job = scanJobs.getById(jobId);
    if (job === undefined || job.startedAt === null) {
      return;
    }
    const watchFolderId = watchFolderIdOf(job);
    if (watchFolderId === undefined) {
      return;
    }
    const seenAt = job.startedAt;
    const filesRepo = files;
    const framesRepo = frames;
    let seen = 0;
    let added = 0;
    let updated = 0;
    let errored = 0;

    transaction(() => {
      for (const file of discovered) {
        // DD-004 move detection (P1-08): the worker confirmed this file's
        // content matches a `'missing'` row — re-path that existing row instead
        // of inserting a new one, preserving frame/session/project links. Both
        // fields are set together (protocol invariant); guarding on both
        // narrows `sha256` to a string.
        if (file.movedFromFileId !== undefined && file.sha256 !== undefined) {
          const reparented = filesRepo.reparentMoved(
            file.movedFromFileId,
            {
              watchFolderId,
              relativePath: file.relativePath,
              filename: file.filename,
              extension: file.extension,
              sizeBytes: file.sizeBytes,
              fileMtime: file.fileMtimeMs === null ? null : new Date(file.fileMtimeMs),
              sha256: file.sha256,
            },
            seenAt,
          );
          if (reparented !== undefined) {
            // Cheap idempotent re-resolution of duplicate-group state after the
            // relocation (recordHash is a no-op-ish re-hash record).
            filesRepo.recordHash(reparented.id, file.sha256);
            seen += 1;
            updated += 1;
            continue;
          }
          // Race: the row was no longer `'missing'` (e.g. restored by a
          // concurrent scan). Fall through and treat this as a brand-new file.
        }

        const upsert = filesRepo.upsertDiscovered(
          {
            watchFolderId,
            relativePath: file.relativePath,
            filename: file.filename,
            extension: file.extension,
            sizeBytes: file.sizeBytes,
            fileMtime: file.fileMtimeMs === null ? null : new Date(file.fileMtimeMs),
          },
          seenAt,
        );
        seen += 1;
        if (upsert.isNew) {
          added += 1;
        } else if (upsert.changed) {
          updated += 1;
        }

        const fileId = upsert.file.id;
        if (file.parseError !== undefined) {
          // New/changed file that failed to parse: record on the row, no frame.
          filesRepo.recordParseError(fileId, file.parseError);
          errored += 1;
        } else if (file.parsed !== undefined) {
          // New/changed file that parsed: write its frame + clear any prior error.
          if (framesRepo !== undefined) {
            framesRepo.upsertByFileId(toFrameRow(fileId, file.parsed));
          }
          filesRepo.recordParseError(fileId, null);
        }
        // else: unchanged/skipped — leave frames + parse_error untouched.
      }
    });

    scanJobs.bumpCounters(jobId, {
      filesSeen: seen,
      filesAdded: added,
      filesUpdated: updated,
      filesErrored: errored,
    });
  }

  /**
   * Enqueue one background `'hash'` job at {@link HASH_JOB_PRIORITY}, but only
   * when there's an unhashed backlog AND we can actually resolve paths
   * (`files` + `watchFolders` both wired) — avoids queuing no-op jobs that
   * would complete and re-trigger themselves forever. The payload is minimal
   * here; `dispatchHashJob` rebuilds it fresh at claim time. Does NOT `pump()` —
   * callers (onDone) pump right after.
   */
  function enqueueHashIfBacklog(): void {
    if (files === undefined || watchFolders === undefined) {
      return;
    }
    if (files.listUnhashed(1).length === 0) {
      return;
    }
    const payload: HashJobPayload = { files: [] };
    const job = scanJobs.enqueue({
      jobType: 'hash',
      payloadJson: JSON.stringify(payload),
      priority: HASH_JOB_PRIORITY,
    });
    emit(job, 'queued');
  }

  const callbacks: WorkerPoolCallbacks = {
    onProgress(jobId, current, total, message) {
      const updated = scanJobs.updateProgress(jobId, { current, total, message });
      if (updated !== undefined) {
        emit(updated, message);
      }
    },
    onDiscovered(jobId, discovered) {
      processDiscoveredBatch(jobId, discovered);
    },
    onHashed(_jobId, results) {
      // Persist each hash outcome (P1-08 Stage 5a). A success records the
      // sha256 (recordHash also resolves duplicate-group membership: oldest
      // first-seen wins as canonical). A per-file error is skipped — no `files`
      // row mutation, so the file simply stays a `listUnhashed` candidate and
      // is retried on the next hash pass (we don't overload `parse_error`,
      // which is documented as Stage-2-specific). Batched in one transaction
      // for write throughput (DD-002 single-writer).
      if (files === undefined || results.length === 0) {
        return;
      }
      const filesRepo = files;
      transaction(() => {
        for (const result of results) {
          if ('sha256' in result) {
            filesRepo.recordHash(result.fileId, result.sha256);
          }
        }
      });
    },
    onDone(jobId) {
      const completed = scanJobs.complete(jobId);
      if (completed !== undefined) {
        emit(completed, 'completed');
        // Stage-1 missing-detection (P1-06 / DD-004): every `'present'` row
        // under this watch folder not re-seen by *this* scan (deleted, or the
        // whole drive disconnected) flips to `'missing'`. The cutoff is the
        // scan's own persisted `startedAt` — the same timestamp used as
        // `seenAt` for every upsert in this run — so files re-discovered this
        // run (lastSeenAt === startedAt) survive the strict `<` comparison,
        // while stale rows (older startedAt) don't. Restoring them later is
        // free: a subsequent successful rescan re-upserts and `wasRestored`
        // flips them back to `'present'`.
        if (completed.jobType === 'scan' && files !== undefined && completed.startedAt !== null) {
          const watchFolderId = watchFolderIdOf(completed);
          if (watchFolderId !== undefined) {
            files.markMissingNotSeenSince(watchFolderId, completed.startedAt);
          }
        }
        // Auto-trigger a background hash pass (P1-08): after every scan (pick up
        // newly-discovered files) and after every hash job (chain forward when
        // the backlog exceeds one HASH_BATCH_LIMIT batch). Each new hash job
        // re-enters the priority queue below any queued scan, so hashing always
        // yields to active scanning. The helper is gated on a real backlog, so
        // this never spins on empty no-op jobs.
        if (completed.jobType === 'scan' || completed.jobType === 'hash') {
          enqueueHashIfBacklog();
        }
      }
      pump();
    },
    onError(jobId, error) {
      const failed = scanJobs.fail(jobId, error);
      if (failed !== undefined) {
        emit(failed, error);
      }
      pump();
    },
    onCancelled(jobId) {
      const cancelled = scanJobs.markCancelled(jobId);
      if (cancelled !== undefined) {
        emit(cancelled, 'cancelled');
      }
      pump();
    },
  };

  const pool = createPool(callbacks);

  return {
    callbacks,

    start(): void {
      if (started) {
        return;
      }
      started = true;
      for (const job of scanJobs.requeueOrphaned()) {
        emit(job, 'requeued after restart');
      }
      pump();
    },

    enqueueDemo(input = {}): { jobId: string } {
      const payload = {
        totalSteps: input.totalSteps ?? 10,
        stepMs: input.stepMs ?? 500,
      };
      const job = scanJobs.enqueue({
        jobType: 'demo',
        payloadJson: JSON.stringify(payload),
      });
      emit(job, 'queued');
      pump();
      return { jobId: job.id };
    },

    enqueueScan(input): { jobId: string } {
      const payload: ScanJobPayload = {
        watchFolderId: input.watchFolderId,
        rootPath: input.rootPath,
        extensions: input.extensions,
        ...(input.skipPatterns !== undefined ? { skipPatterns: input.skipPatterns } : {}),
      };
      const job = scanJobs.enqueue({
        jobType: 'scan',
        // Persist the id on the dedicated column too (not just inside the
        // payload) so onDiscovered/onDone can resolve it without re-parsing,
        // and it survives the orphan-requeue-after-restart path.
        watchFolderId: input.watchFolderId,
        payloadJson: JSON.stringify(payload),
      });
      emit(job, 'queued');
      pump();
      return { jobId: job.id };
    },

    enqueueHash(): { jobId: string } {
      // Minimal payload — dispatchHashJob rebuilds the real candidate list fresh
      // at claim time. Priority is below scan/demo so a queued scan always wins.
      const payload: HashJobPayload = { files: [] };
      const job = scanJobs.enqueue({
        jobType: 'hash',
        payloadJson: JSON.stringify(payload),
        priority: HASH_JOB_PRIORITY,
      });
      emit(job, 'queued');
      pump();
      return { jobId: job.id };
    },

    cancel(jobId: string): void {
      const job = scanJobs.requestCancel(jobId);
      if (job === undefined) {
        return;
      }
      emit(job, 'cancel requested');
      if (job.status === 'running') {
        pool.cancel(jobId);
      }
      pump();
    },

    list() {
      return scanJobs.list().map((job) => ({
        id: job.id,
        jobType: job.jobType,
        status: job.status,
        progressCurrent: job.progressCurrent,
        progressTotal: job.progressTotal,
        progressMessage: job.progressMessage,
      }));
    },

    onEvent(listener: (event: JobProgressEvent) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
