/**
 * Deliberately inert usage of the native modules that real DB (P0-04) and
 * thumbnail (Phase 1) work will depend on. Consequence (plan Step 6): if
 * either module was compiled against the wrong ABI (Node instead of
 * Electron, or wrong arch), this call throws visibly at startup instead of
 * the rebuild pipeline silently rotting until P0-04 lands.
 *
 * No user files, no on-disk DB, no image processing: the SQLite database is
 * `:memory:` only and sharp is queried for its version metadata, never given
 * an image to process.
 */
import Database from 'better-sqlite3';
import sharp from 'sharp';

export interface NativeSmokeResult {
  sqliteVersion: string;
  sharpVersion: string;
}

export function runNativeSmoke(): NativeSmokeResult {
  const db = new Database(':memory:');
  try {
    const row = db.prepare('SELECT sqlite_version() AS version').get() as { version: string };
    const sharpVersion = sharp.versions.sharp;
    if (sharpVersion === undefined) {
      throw new Error('sharp.versions.sharp is undefined — native module failed to load');
    }
    return { sqliteVersion: row.version, sharpVersion };
  } finally {
    db.close();
  }
}
