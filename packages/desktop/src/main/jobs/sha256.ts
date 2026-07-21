/**
 * Shared full-file SHA-256 helper (P1-08), used by both the background
 * `'hash'` job (`hash-job.ts`) and the scan walker's move-detection path
 * (`scan-job.ts`).
 *
 * Streams the file through `crypto.createHash` so an arbitrarily large image
 * (multi-hundred-MB uncompressed FITS) is hashed with bounded memory. This is a
 * FULL read of the pixel payload — the opposite of Stage 2's header-only read —
 * which is exactly why the `'hash'` stage is the lowest-priority background
 * stage (DD-004 Stage 5). Strictly READ-ONLY (`createReadStream`): never
 * writes, moves, renames, or deletes the file (CLAUDE.md non-destructive
 * guarantee). Rejects on any I/O error (vanished/unreadable file) so callers
 * can isolate the failure to that one file.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/** Resolve to the lowercase-hex SHA-256 of the file at `absolutePath`, or reject on I/O error. */
export async function sha256File(absolutePath: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(absolutePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => {
      resolve(hash.digest('hex'));
    });
  });
}
