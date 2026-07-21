/**
 * The `'hash'` job: DD-004 Stage 5a (ENRICH) background SHA-256 hashing
 * (P1-08). A plain async function with an injected `ctx`, unit-testable
 * directly against real temp files with no `worker_threads` instance;
 * `worker-entry.ts` is the only production caller, wiring `ctx` to real
 * `postMessage` calls and the `cancelled` flag.
 *
 * For each candidate the orchestrator resolved to an absolute path, this
 * streams a FULL SHA-256 (`sha256.ts`) and reports the digest up over
 * `ctx.reportHashed`. Full-file reads are why this is the lowest-priority
 * background stage (dispatched at a negative priority, so `claimNext` always
 * prefers a queued scan) — hashing throttles under active scanning.
 *
 * fs-using but **read-only** (streams bytes to hash; never writes/moves/
 * renames/deletes — CLAUDE.md non-destructive guarantee) and DB-free (never
 * imports `@astrotracker/db`; the main process is the sole SQLite writer,
 * DD-002 Default 3 — results flow up as `postMessage`/`ctx.reportHashed`).
 *
 * Error isolation (DD-004): a file that vanished, is unreadable, or has bad
 * permissions produces a {@link HashError} entry for that file and the job
 * continues with the rest of the batch — one bad file never aborts the whole
 * job, exactly as `scan-job.ts` isolates parse errors.
 */
import type { JobContext } from './job-context.js';
import type { HashError, HashJobPayload, HashedFile } from './protocol.js';
import { sha256File } from './sha256.js';

/**
 * Hash-result batch size before flushing to `ctx.reportHashed`. Smaller than
 * `scan-job.ts`'s 200: each unit here is a full-file read (far slower than a
 * header-only parse), so a smaller batch surfaces `recordHash` results and
 * progress to the UI sooner without waiting on a large tail of slow reads.
 */
const BATCH_SIZE = 50;

export async function runHashJob(payload: HashJobPayload, ctx: JobContext): Promise<void> {
  const candidates = payload.files;
  const total = candidates.length;

  const batch: Array<HashedFile | HashError> = [];
  let processed = 0;

  const flush = (): void => {
    if (batch.length === 0) {
      return;
    }
    // Hand off a fresh array so downstream holders aren't aliased to one we mutate.
    ctx.reportHashed(batch.splice(0, batch.length));
    ctx.reportProgress(processed, total, `hashed ${processed}/${total} files`);
  };

  for (const candidate of candidates) {
    // Cooperative cancel: checked once per file (mid-stream-of-one-file cancel
    // would be over-engineering for this scope). A plain return triggers the
    // 'cancelled' postMessage in worker-entry.ts; we don't flush on cancel.
    if (ctx.isCancelled()) {
      return;
    }

    try {
      const sha256 = await sha256File(candidate.absolutePath);
      batch.push({ fileId: candidate.fileId, sha256 });
    } catch (caught) {
      const error = caught instanceof Error ? caught.message : String(caught);
      batch.push({ fileId: candidate.fileId, error });
    }
    processed += 1;

    if (batch.length >= BATCH_SIZE) {
      flush();
    }
  }

  // Flush the partial final batch.
  flush();
}
