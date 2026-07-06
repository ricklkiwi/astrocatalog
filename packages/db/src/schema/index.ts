/**
 * DD-003 v1 schema barrel. The FTS5 virtual table `search_fts` deliberately
 * does NOT appear here — it lives only in the raw-SQL migration
 * `drizzle/0001_fts5_search.sql`, so `drizzle-kit generate` diffs ignore it.
 */
export { masterFrames, masterFrameSubs } from './calibration.js';
export { equipmentProfiles } from './equipment.js';
export { files, watchFolders } from './files.js';
export { filters, frames } from './frames.js';
export { scanJobs, settings, thumbnails } from './infra.js';
export { processedImages, processingProjects, projectInputs } from './projects.js';
export { sessions } from './sessions.js';
export { targetAliases, targets } from './targets.js';
