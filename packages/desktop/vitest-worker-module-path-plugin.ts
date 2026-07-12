/**
 * Test-only stand-in for electron-vite's `?modulePath` import plugin. That
 * plugin is registered with `apply: 'build'` inside electron-vite's own
 * config wrapper (`electron-vite build`/`dev`), so it never runs under plain
 * `vitest` — yet `pool.ts` (plan Default 7) statically imports
 * `./worker-entry?modulePath`, exactly as production code does, so
 * `pool.test.ts` can exercise a real `worker_threads` instance running the
 * genuine `worker-entry.ts`. This plugin bundles the referenced entry with
 * Vite's own `build()` API into a standalone ESM file on disk (mirroring,
 * not replacing, electron-vite's production mechanism — `pool.ts`'s import
 * specifier and `electron.vite.config.ts` are both untouched either way) and
 * resolves the `?modulePath` import to that file's absolute path, matching
 * electron-vite's `export default <path>` contract (see
 * `electron-vite/node.d.ts`'s `declare module '*?modulePath'`).
 */
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import type { Plugin } from 'vite';

const MODULE_PATH_SUFFIX = '?modulePath';
const bundleCache = new Map<string, Promise<string>>();

export function testModulePathPlugin(): Plugin {
  return {
    name: 'astrotracker:test-module-path',
    enforce: 'pre',
    async load(id) {
      if (!id.endsWith(MODULE_PATH_SUFFIX)) {
        return null;
      }
      const entry = id.slice(0, -MODULE_PATH_SUFFIX.length);
      let cached = bundleCache.get(entry);
      if (cached === undefined) {
        cached = bundleWorkerEntry(entry);
        bundleCache.set(entry, cached);
      }
      const outputPath = await cached;
      return `export default ${JSON.stringify(outputPath)};`;
    },
  };
}

async function bundleWorkerEntry(entry: string): Promise<string> {
  // Bundling Vite's own `build()` on every call would be wasteful and racy
  // across concurrent test files; `bundleCache` above already de-dupes by
  // entry path within one process.
  const { build } = await import('vite');
  const outDir = join(tmpdir(), 'astrotracker-worker-bundle');
  mkdirSync(outDir, { recursive: true });
  const fileName = `${basename(entry).replace(/\.[^./]+$/, '')}.mjs`;
  await build({
    configFile: false,
    logLevel: 'warn',
    build: {
      outDir,
      emptyOutDir: false,
      ssr: true,
      rollupOptions: {
        input: entry,
        output: { format: 'es', entryFileNames: fileName },
        external: (id: string) => id.startsWith('node:'),
      },
    },
  });
  return join(outDir, fileName);
}
