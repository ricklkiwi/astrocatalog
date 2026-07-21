/**
 * The `'scan'` job: directory walk (DD-004 Stage 1, P1-06) plus inline
 * header-parse + classify (DD-004 Stages 2–3, P1-07). A plain async function
 * with an injected `ctx`, so it's unit-testable directly against a real temp
 * dir with no `worker_threads` instance. `worker-entry.ts` is the only
 * production caller, wiring `ctx` to real `postMessage` calls and the
 * `cancelled` flag.
 *
 * fs-using but **read-only** (`readdir`/`stat` and bounded header reads via
 * `open()`+`read()` — never write, move, rename, or delete: CLAUDE.md
 * non-destructive guarantee) and DB-free (never imports `@astrotracker/db`;
 * the walker reports discovered files — with their parse result or parse
 * error — up over `ctx.reportDiscovered`, and the main process is the sole
 * SQLite writer, DD-002 Default 3). The Stage-2/3 work itself is done by
 * `@astrotracker/core`'s pure `parseAndClassifyFile` (no fs, no DB); this
 * worker only owns the file I/O feeding it, exactly what the P0-05 pool exists
 * for.
 *
 * Incremental (DD-004): a file is parsed only if it's new or its size/mtime
 * changed since the orchestrator's `knownFiles` snapshot. An unchanged file is
 * reported with its Stage-1 stat facts only (no `parsed`/`parseError`), so the
 * orchestrator leaves its existing `frames` row untouched — a rescan of an
 * unchanged tree performs zero re-parses.
 *
 * Single-pass walk (no separate counting pass — that would double I/O and
 * fight DD-004's "10k files < 5min" budget), so progress `total` is genuinely
 * indeterminate (`null`).
 */
import type { Dirent } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import { open, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { parseAndClassifyFile, type BoundedReader } from '@astrotracker/core';

import type { JobContext } from './job-context.js';
import type { DiscoveredFile, KnownFileStat, ScanJobPayload } from './protocol.js';
import { sha256File } from './sha256.js';

/** Target discovered-file batch size before flushing to `ctx.reportDiscovered`. */
const BATCH_SIZE = 200;

/**
 * Baked-in skip that caller-supplied `skipPatterns` extend (not replace): an
 * astrophotography image library never legitimately contains `node_modules`.
 */
const ALWAYS_SKIP = ['node_modules'];

/**
 * Recursively walks `payload.rootPath`, emitting every file whose extension is
 * in `payload.extensions` (case-insensitive) as batched `DiscoveredFile`s.
 *
 * Symlink policy: symlinked *directories* are NOT followed — we recurse only
 * into real directories (`dirent.isDirectory()`), which sidesteps symlink
 * cycles without a visited-inode set. A dirent that is itself a symlink is
 * `stat()`-ed (following the link) so a symlink pointing at a real qualifying
 * *file* is still indexed; if that `stat` resolves to a directory or a broken
 * link, it's simply skipped (not recursed, not emitted).
 *
 * Error isolation (DD-004 principle applied to Stage 1 I/O): a single
 * unreadable directory, a file that vanished between `readdir` and `stat`, or
 * a broken symlink is caught per-entry and skipped — never aborts the walk.
 */
export async function runScanJob(payload: ScanJobPayload, ctx: JobContext): Promise<void> {
  const wantedExtensions = new Set(payload.extensions.map((ext) => ext.toLowerCase()));
  const skipNames = new Set(
    [...ALWAYS_SKIP, ...(payload.skipPatterns ?? [])].map((name) => name.toLowerCase()),
  );
  const knownFiles = payload.knownFiles ?? {};
  const moveCandidates = payload.moveCandidates ?? [];

  const batch: DiscoveredFile[] = [];
  let cumulativeCount = 0;

  const flush = (): void => {
    if (batch.length === 0) {
      return;
    }
    // Hand off a fresh array so downstream holders aren't aliased to one we mutate.
    ctx.reportDiscovered(batch.splice(0, batch.length));
    ctx.reportProgress(cumulativeCount, null, `scanned ${cumulativeCount} files`);
  };

  // Iterative DFS with an explicit stack (avoids deep-tree recursion limits).
  const stack: string[] = [payload.rootPath];

  while (stack.length > 0) {
    // Cooperative cancel: checked once per directory (per demo-job's
    // "once per unit of work" convention — once per file would be too fine).
    // A plain return after cancellation is what triggers the 'cancelled'
    // postMessage in worker-entry.ts's runJob; we deliberately do NOT flush
    // remaining work on cancel.
    if (ctx.isCancelled()) {
      return;
    }

    // Non-null: guarded by stack.length > 0 above.
    const dir = stack.pop() as string;

    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      // Unreadable directory (permissions, vanished mid-walk) — skip, keep going.
      continue;
    }

    for (const entry of entries) {
      const name = entry.name;

      // Always skip hidden (dot-prefixed) entries — covers `.git`, `.DS_Store`, etc.
      if (name.startsWith('.')) {
        continue;
      }
      // Skip baked-in + caller-supplied basename patterns (case-insensitive).
      if (skipNames.has(name.toLowerCase())) {
        continue;
      }

      const fullPath = path.join(dir, name);

      if (entry.isDirectory()) {
        // Real directory: recurse. Symlinked directories are deliberately not
        // followed (isDirectory() is false for a symlink dirent), avoiding cycles.
        stack.push(fullPath);
        continue;
      }

      // Regular file, or a symlink that may point at a file. Only files with a
      // wanted extension are candidates; check the cheap extension test before
      // paying for a stat().
      const extension = extensionOf(name);
      if (extension === null || !wantedExtensions.has(extension)) {
        continue;
      }

      let stats;
      try {
        // stat() follows symlinks so a link to a real file is indexed. A
        // symlink dirent resolving to a directory or a broken link throws or
        // yields a non-file — handled just below / by the catch.
        stats = await stat(fullPath);
      } catch {
        // File vanished between readdir and stat, or broken symlink — skip it.
        continue;
      }

      if (!stats.isFile()) {
        // e.g. a symlink to a directory that slipped past the dirent check.
        continue;
      }

      const relativePath = toPosixRelative(payload.rootPath, fullPath);
      // Truncate to integer ms: the `files.file_mtime` column stores epoch-ms
      // Date, so sub-ms precision (APFS/ext4 report nanoseconds via mtimeMs)
      // would round-trip lossily and make the incremental size/mtime match
      // below spuriously fail on rescan — forcing a needless re-parse. Compare
      // at the same granularity the DB persists.
      const fileMtimeMs = Number.isFinite(stats.mtimeMs) ? Math.floor(stats.mtimeMs) : null;
      const discovered: DiscoveredFile = {
        relativePath,
        filename: name,
        extension,
        sizeBytes: stats.size,
        fileMtimeMs,
      };

      // DD-004 stage gating for this file:
      //   - unchanged (known, same size/mtime): report stat facts only.
      //   - brand-new (relativePath never indexed): try move detection first,
      //     and only parse (Stages 2–3) if it's genuinely a new file.
      //   - changed (known but size/mtime differ): re-parse in place (P1-07).
      const known = knownFiles[relativePath];
      if (known !== undefined) {
        if (!isUnchanged(known, stats.size, fileMtimeMs)) {
          applyParseOutcome(
            discovered,
            await parseDiscoveredFile(fullPath, extension, relativePath),
          );
        }
        // else unchanged — leave frames/parse_error untouched (no outcome).
      } else {
        // Brand-new relativePath: a moved file (DD-004) presents here as "new".
        const moved = await detectMove(fullPath, stats.size, moveCandidates);
        if (moved !== undefined) {
          // Confirmed move: re-path the existing missing row, preserving links.
          // Content is unchanged by definition (same size+hash), so Stages 2–3
          // are skipped — no `parsed`/`parseError` set (protocol invariant).
          discovered.movedFromFileId = moved.fileId;
          discovered.sha256 = moved.sha256;
        } else {
          applyParseOutcome(
            discovered,
            await parseDiscoveredFile(fullPath, extension, relativePath),
          );
        }
      }

      batch.push(discovered);
      cumulativeCount += 1;

      if (batch.length >= BATCH_SIZE) {
        flush();
      }
    }
  }

  // Flush the partial final batch.
  flush();
}

/**
 * True when a walked file's on-disk size/mtime match its snapshot entry — the
 * DD-004 "re-parse only if size or mtime changed" test. A file absent from the
 * snapshot (`known === undefined`) is new, hence never unchanged.
 */
function isUnchanged(
  known: KnownFileStat | undefined,
  sizeBytes: number,
  fileMtimeMs: number | null,
): boolean {
  if (known === undefined) {
    return false;
  }
  return known.sizeBytes === sizeBytes && known.fileMtimeMs === fileMtimeMs;
}

/** Outcome of a single file's Stage-2/3 attempt: exactly one field is set. */
type ParseOutcome =
  | { parsed: DiscoveredFile['parsed']; parseError?: undefined }
  | { parseError: string; parsed?: undefined };

/**
 * Header-parse + classify one new/changed file (DD-004 Stages 2–3). Opens the
 * file read-only and hands `@astrotracker/core`'s pure `parseAndClassifyFile`
 * a bounded reader backed by the file descriptor — FITS/XISF pull header
 * blocks on demand, RAW pulls a single bounded prefix — so the pixel payload
 * is never read (DD-004 header-only). Any fs error (unreadable/vanished file)
 * is caught and surfaced as a `parseError` string, never thrown: one bad file
 * must not abort the batch (DD-004 error isolation).
 */
async function parseDiscoveredFile(
  fullPath: string,
  extension: string,
  relativePath: string,
): Promise<ParseOutcome> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(fullPath, 'r');
    const fd = handle;
    const read: BoundedReader = async (offset, length) => {
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await fd.read(buffer, 0, length, offset);
      return buffer.subarray(0, bytesRead);
    };
    const result = await parseAndClassifyFile(extension, read, relativePath);
    if (result.status === 'error') {
      return { parseError: `${result.errorCode}: ${result.message}` };
    }
    return { parsed: result.frame };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    return { parseError: `READ_ERROR: ${message}` };
  } finally {
    if (handle !== undefined) {
      // Closing can itself throw on an already-broken handle — never let that
      // abort the walk (non-destructive read path).
      await handle.close().catch(() => undefined);
    }
  }
}

/** Attach a Stage-2/3 outcome (exactly one of `parsed`/`parseError`) onto a discovered file. */
function applyParseOutcome(discovered: DiscoveredFile, outcome: ParseOutcome): void {
  if (outcome.parseError !== undefined) {
    discovered.parseError = outcome.parseError;
  } else {
    discovered.parsed = outcome.parsed;
  }
}

/**
 * DD-004 move detection (P1-08): decide whether a brand-new file (its
 * `relativePath` was never indexed) is actually a `'missing'` file that moved.
 * A cheap `sizeBytes` pre-filter runs first; only on a size match do we pay for
 * a full SHA-256 (hash-on-demand — DD-004's lazy hashing: we hash just this one
 * candidate file, not the whole tree). Returns the matched candidate's `fileId`
 * plus the computed `sha256` on an exact content match, else `undefined` (no
 * size match, no hash match, or the file was unreadable — in which case the
 * caller falls through to the normal new-file parse path). Among multiple
 * candidates sharing BOTH size and hash (rare content-duplicate-among-missing
 * rows), the lowest `fileId` wins deterministically.
 */
async function detectMove(
  fullPath: string,
  sizeBytes: number,
  moveCandidates: NonNullable<ScanJobPayload['moveCandidates']>,
): Promise<{ fileId: string; sha256: string } | undefined> {
  const sizeMatches = moveCandidates.filter((candidate) => candidate.sizeBytes === sizeBytes);
  if (sizeMatches.length === 0) {
    return undefined;
  }
  let hash: string;
  try {
    hash = await sha256File(fullPath);
  } catch {
    // Unreadable/vanished — can't confirm a move; let the normal new-file path
    // handle it (it will surface its own READ_ERROR when it tries to parse).
    return undefined;
  }
  const hashMatches = sizeMatches.filter((candidate) => candidate.sha256 === hash);
  if (hashMatches.length === 0) {
    return undefined;
  }
  const winner = hashMatches.reduce((lowest, candidate) =>
    candidate.fileId < lowest.fileId ? candidate : lowest,
  );
  return { fileId: winner.fileId, sha256: hash };
}

/** Lowercased extension without leading dot, or `null` if the name has no extension. */
function extensionOf(filename: string): string | null {
  const ext = path.extname(filename);
  if (ext === '') {
    return null;
  }
  return ext.slice(1).toLowerCase();
}

/**
 * `rootPath`-relative path with POSIX '/' separators and no leading slash,
 * regardless of host platform (so DB rows are portable / stable across OSes).
 */
function toPosixRelative(rootPath: string, fullPath: string): string {
  const rel = path.relative(rootPath, fullPath);
  return rel.split(path.sep).join('/');
}
