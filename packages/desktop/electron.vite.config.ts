import { resolve } from 'node:path';

import { defineConfig } from 'electron-vite';

/**
 * electron-vite drives dev (Vite dev server + Electron relaunch) and the
 * production build for main/preload/renderer out of this one file.
 *
 * Workspace deps (@astrotracker/*) are bundled into the output so the packaged
 * app never depends on pnpm workspace symlinks; only native modules
 * (better-sqlite3, sharp) are externalized and shipped as real node_modules.
 */
export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, 'src/main/index.ts') },
        external: ['better-sqlite3', 'sharp'],
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, 'src/preload/index.ts') },
        output: {
          // sandbox: true preloads cannot use the ESM loader; force CJS even
          // though the package is "type": "module" (plan Edge Cases).
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
});
