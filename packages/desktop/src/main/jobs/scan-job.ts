/**
 * The `'scan'` job's directory-walk logic (P1-06 Stage 1 of the DD-004
 * pipeline). A plain async function with an injected `ctx`, so it's
 * unit-testable directly against a real temp dir with no `worker_threads`
 * instance. `worker-entry.ts` is the only production caller, wiring `ctx` to
 * real `postMessage` calls and the `cancelled` flag.
 *
 * fs-using but **read-only** (`readdir`/`lstat`/`stat` only — never write,
 * move, rename, or delete: CLAUDE.md non-destructive guarantee) and DB-free
 * (never imports `@astrotracker/db`; the walker reports discovered files up
 * over `ctx.reportDiscovered`, and the main process is the sole SQLite
 * writer — DD-002 Default 3). DD-002's "no fs side effects in domain logic"
 * bans fs in `packages/core`; a desktop-package worker doing fs *reads* is
 * exactly what the P0-05 pool exists for.
 *
 * Single-pass walk (no separate counting pass — that would double I/O and
 * fight DD-004's "10k files < 5min" budget that P1-07 inherits), so progress
 * `total` is genuinely indeterminate (`null`).
 */
import type { Dirent } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import type { JobContext } from './job-context.js';
import type { DiscoveredFile, ScanJobPayload } from './protocol.js';

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

      batch.push({
        relativePath: toPosixRelative(payload.rootPath, fullPath),
        filename: name,
        extension,
        sizeBytes: stats.size,
        fileMtimeMs: Number.isFinite(stats.mtimeMs) ? stats.mtimeMs : null,
      });
      cumulativeCount += 1;

      if (batch.length >= BATCH_SIZE) {
        flush();
      }
    }
  }

  // Flush the partial final batch.
  flush();
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
