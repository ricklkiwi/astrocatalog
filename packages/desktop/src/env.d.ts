/**
 * Ambient module declarations for electron-vite's special import suffixes
 * (P0-05 plan Step 7 note). `pool.ts` imports the `worker_threads` entry via
 * `./worker-entry?modulePath` (plan Default 7); without this reference,
 * `tsc --noEmit` has no declaration for `*?modulePath` module specifiers.
 */
/// <reference types="electron-vite/node" />
