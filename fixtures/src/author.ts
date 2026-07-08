/**
 * Authoring entry point (P0-06): regenerates every committed fixture binary
 * and manifest from the declarative definitions in src/definitions/.
 *
 *   pnpm --filter @astrotracker/fixtures run author
 *
 * Deterministic by construction — no wall-clock, no randomness, no absolute
 * paths in any emitted byte. src/author.test.ts rebuilds everything in memory
 * and asserts byte-identity with the committed files.
 *
 * Non-destructive guarantee: this script writes only inside the fixtures/
 * package root (committed fixture sets); it never touches user files.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { allSets } from './definitions/index.js';
import type { ManifestEntry } from './definitions/types.js';

/** Absolute path of the fixtures/ package root (parent of src/). */
export const FIXTURES_ROOT = fileURLToPath(new URL('..', import.meta.url));

export interface BuiltCorpus {
  /** fixture-relative path -> file bytes */
  files: Map<string, Uint8Array>;
  /** manifest path (e.g. 'fits/manifest.json') -> exact JSON text */
  manifests: Map<string, string>;
}

function manifestText(set: string, entries: ManifestEntry[]): string {
  return JSON.stringify({ set, entries }, null, 2) + '\n';
}

/** Build every fixture and manifest in memory (pure aside from definitions). */
export function buildCorpus(): BuiltCorpus {
  const files = new Map<string, Uint8Array>();
  const manifests = new Map<string, string>();
  for (const { set, defs } of allSets) {
    if (defs.length === 0) continue;
    for (const def of defs) {
      if (files.has(def.entry.file)) {
        throw new Error(`duplicate fixture path: ${def.entry.file}`);
      }
      files.set(def.entry.file, def.build());
    }
    manifests.set(
      `${set}/manifest.json`,
      manifestText(
        set,
        defs.map((d) => d.entry),
      ),
    );
  }
  return { files, manifests };
}

/** Write the corpus under `root` (defaults to the fixtures package root). */
export function writeCorpus(root: string = FIXTURES_ROOT): void {
  const corpus = buildCorpus();
  const writeUnder = (relPath: string, data: Uint8Array | string): void => {
    if (relPath.split(/[\\/]/).includes('..')) {
      throw new Error(`refusing to write outside the corpus root: ${relPath}`);
    }
    const target = join(root, relPath);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, data);
  };
  for (const [relPath, bytes] of corpus.files) writeUnder(relPath, bytes);
  for (const [relPath, text] of corpus.manifests) writeUnder(relPath, text);
  const fileCount = corpus.files.size;
  const manifestCount = corpus.manifests.size;
  console.log(
    `authored ${fileCount} fixture file(s) + ${manifestCount} manifest(s) under ${root}${sep}`,
  );
}

const isMain =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  writeCorpus();
}
