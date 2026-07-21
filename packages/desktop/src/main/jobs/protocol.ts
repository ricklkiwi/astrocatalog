/**
 * The main <-> worker `postMessage` protocol (P0-05). Kept as plain data
 * types with no imports from `@astrotracker/db`/Electron — the worker side
 * (`worker-entry.ts`) never touches SQLite (DD-002 Default 3: main process is
 * the sole writer; workers report results up over `postMessage`).
 *
 * `JobType` lives here, in `packages/desktop`, not `packages/db` — plan
 * Default 2: the DB layer only knows the closed `status` lifecycle;
 * `job_type` is an unconstrained TEXT column, and the union of concrete job
 * types is entirely the desktop package's worker-registry concern. Adding a
 * job type later (P1-06's `'scan'`) means adding a member here and a
 * registry entry in `worker-entry.ts` — not a schema or pool change.
 */

import type { ParsedFrame } from '@astrotracker/core';

/** Every job type the worker registry knows how to run. `'scan'` added in P1-06, `'hash'` in P1-08. */
export type JobType = 'demo' | 'scan' | 'hash';

/** Payload shape for the `'demo'` job type — sleeps through N steps, reporting progress. */
export interface DemoJobPayload {
  /** Default 10 (plan Step 3). */
  totalSteps?: number;
  /** Default 500ms (plan Step 3). */
  stepMs?: number;
  /** Set on resume-after-restart dispatch; skip already-completed steps. */
  resumeFrom?: number;
}

/**
 * Size/mtime of an already-indexed file, keyed by relativePath in
 * {@link ScanJobPayload.knownFiles}. The worker compares each walked file
 * against this to decide whether Stages 2–3 can be skipped (DD-004
 * incremental rule; P1-07).
 */
export interface KnownFileStat {
  sizeBytes: number;
  fileMtimeMs: number | null;
}

/** Payload shape for the `'scan'` job type (P1-06 Stage 1) — a discovery walk of one watch folder. */
export interface ScanJobPayload {
  watchFolderId: string;
  rootPath: string;
  /** Lowercase extensions, no leading dot, e.g. ['fits','fit','xisf','cr2','cr3','nef','arw']. */
  extensions: string[];
  /** Additional basename patterns to skip, beyond the always-skipped hidden (dot-prefixed) entries. Case-insensitive exact basename match (e.g. 'node_modules', '@eaDir', '$RECYCLE.BIN', 'System Volume Information'). */
  skipPatterns?: string[];
  /**
   * Snapshot of the watch folder's already-indexed files (relativePath →
   * size/mtime), captured by the orchestrator from `filesRepo` at dispatch
   * time (P1-07). The worker skips the Stage-2 parse for any walked file whose
   * `sizeBytes`/`fileMtimeMs` match its snapshot entry (DD-004: "a file is
   * re-parsed only if size or mtime changed") — this is what makes a rescan of
   * an unchanged tree perform zero re-parses, independent of `present`/
   * `missing` status. Absent on a first-ever scan (nothing indexed yet).
   */
  knownFiles?: Record<string, KnownFileStat>;
  /**
   * Content-match candidates for DD-004 move detection (P1-08): every
   * `'missing'` `files` row (across ALL watch folders, not just the one being
   * scanned — a file can move between folders) that already carries a
   * `sha256`. When the walker meets a file that looks brand-new (its
   * `relativePath` isn't in `knownFiles`) whose `sizeBytes` matches a
   * candidate, it hashes that one file and, on an exact `sha256` match, reports
   * it as a move (`movedFromFileId` set) rather than a new file — letting the
   * main process re-path the existing row and preserve its frame/session/
   * project links. Built from `filesRepo.listMissingWithHash()` at dispatch
   * time (same freshness pattern as `knownFiles`). Absent when nothing is
   * missing, or when the orchestrator has no `files` repo wired.
   */
  moveCandidates?: Array<{ fileId: string; sha256: string; sizeBytes: number }>;
}

/**
 * One qualifying file found during a scan walk. Stage-1 stat facts are always
 * present; the Stage-2/3 outcome (`parsed` XOR `parseError`) is attached only
 * for files the worker actually parsed — i.e. NEW or CHANGED files. An
 * unchanged file (matched the `knownFiles` snapshot) carries neither, so the
 * orchestrator leaves its existing `frames` row and `parse_error` untouched.
 */
export interface DiscoveredFile {
  relativePath: string; // POSIX-style '/' separators, relative to rootPath, no leading slash
  filename: string;
  extension: string; // lowercase, no leading dot
  sizeBytes: number;
  fileMtimeMs: number | null; // epoch ms, or null if stat didn't report mtime
  /** Stage 2–3 success for a new/changed file (P1-07). Mutually exclusive with `parseError`. */
  parsed?: ParsedFrame;
  /** Stage 2–3 failure for a new/changed file, `${errorCode}: ${message}` (P1-07). Mutually exclusive with `parsed`. */
  parseError?: string;
  /**
   * Set (together with {@link DiscoveredFile.sha256}) when the walker confirmed
   * this newly-walked file's content hash matches a `moveCandidates` entry
   * (DD-004 move detection, P1-08): the `files.id` of the `'missing'` row this
   * file was moved from. The main process re-paths that existing row (via
   * `reparentMoved`) instead of inserting a new one, preserving frame/session/
   * project links. A moved file carries NEITHER `parsed` NOR `parseError` — its
   * content is unchanged by definition (same size+hash as before the move), so
   * Stages 2–3 are redundant, exactly like the "unchanged file" skip path.
   */
  movedFromFileId?: string;
  /**
   * The confirmed content hash, set together with `movedFromFileId` (P1-08).
   * The main process records it on the re-pathed row so duplicate-group state
   * stays consistent after a relocation, without re-hashing.
   */
  sha256?: string;
}

/**
 * One file the background `'hash'` job (DD-004 Stage 5a, P1-08) must stream a
 * full SHA-256 over. `absolutePath` is resolved by the orchestrator at dispatch
 * time (`path.join(watchFolder.path, file.relativePath)`) — the worker never
 * touches the DB, so it can't resolve paths itself (DD-002 Default 3).
 */
export interface HashCandidate {
  fileId: string;
  absolutePath: string;
  sizeBytes: number;
}

/** Payload for the `'hash'` job type — a bounded batch of files to hash (P1-08). */
export interface HashJobPayload {
  files: HashCandidate[];
}

/** A successfully hashed file (P1-08). Discriminated from {@link HashError} by the presence of `sha256`. */
export interface HashedFile {
  fileId: string;
  sha256: string; // lowercase hex
}

/** A file that could not be hashed — vanished, unreadable, permissions (P1-08). Discriminated by `error`. */
export interface HashError {
  fileId: string;
  error: string;
}

/** Main -> worker: start a job. */
export interface RunMessage {
  type: 'run';
  jobId: string;
  jobType: JobType;
  payload: unknown;
}

/** Main -> worker: cooperative cancel request (checked once per step, plan Default 6). */
export interface CancelMessage {
  type: 'cancel';
  jobId: string;
}

export type MainToWorkerMessage = RunMessage | CancelMessage;

/** Worker -> main: progress after a completed step. `total: null` = indeterminate. */
export interface ProgressMessage {
  type: 'progress';
  jobId: string;
  current: number;
  total: number | null;
  message: string | null;
}

/** Worker -> main: the job function returned normally (not cancelled). */
export interface DoneMessage {
  type: 'done';
  jobId: string;
}

/** Worker -> main: the job function threw, or the job type is unknown. */
export interface ErrorMessage {
  type: 'error';
  jobId: string;
  error: string;
}

/** Worker -> main: the job function exited early because `ctx.isCancelled()` tripped. */
export interface CancelledMessage {
  type: 'cancelled';
  jobId: string;
}

/** Worker -> main: a batch of newly-walked files, sent incrementally so main can upsert without buffering the whole tree. */
export interface DiscoveredMessage {
  type: 'discovered';
  jobId: string;
  files: DiscoveredFile[];
}

/**
 * Worker -> main: a batch of hash outcomes from a `'hash'` job (P1-08), sent
 * incrementally like `discovered`. Each result is either a {@link HashedFile}
 * (has `sha256`) or a {@link HashError} (has `error`) — discriminate with
 * `'sha256' in result`.
 */
export interface HashedMessage {
  type: 'hashed';
  jobId: string;
  results: Array<HashedFile | HashError>;
}

export type WorkerToMainMessage =
  | ProgressMessage
  | DoneMessage
  | ErrorMessage
  | CancelledMessage
  | DiscoveredMessage
  | HashedMessage;
