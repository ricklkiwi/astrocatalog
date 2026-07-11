/**
 * Locates the `electron-builder --dir` unpacked build's executable for the
 * current OS (plan Step 2). E2E always launches this packaged artifact —
 * identical asar/asarUnpack/npmRebuild pipeline to the release DMG/NSIS
 * builds — never a dev-mode `electron .` process (DD-001).
 *
 * macOS: electron-builder's output directory name is not pinned by this
 * repo's config (`mac`, `mac-arm64`, `mac-universal`, … depending on the
 * host arch), so we glob every `.app` inside every `release/mac*` directory
 * instead of hardcoding one name. Windows: `electron-builder.yml` pins a
 * single nsis/x64 target, so `release/win-unpacked/AstroTracker.exe` is
 * deterministic.
 */
import fs from 'node:fs';
import path from 'node:path';

const releaseDir = path.join(import.meta.dirname, '../../release');

const REBUILD_HINT =
  'Run `pnpm --filter @astrotracker/desktop pree2e` to produce the unpacked build ' +
  '(if stale artifacts from a previous `pnpm package` run are the cause, ' +
  '`rm -rf packages/desktop/release` first).';

function listDirectories(parent: string): string[] {
  if (!fs.existsSync(parent)) {
    return [];
  }
  return fs
    .readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(parent, entry.name));
}

function resolveMacExecutable(): string {
  const candidates = listDirectories(releaseDir)
    .filter((dir) => path.basename(dir).startsWith('mac'))
    .flatMap((macDir) =>
      listDirectories(macDir).filter((entry) => path.basename(entry).endsWith('.app')),
    );

  const [appBundle] = candidates;
  if (appBundle === undefined) {
    throw new Error(
      `No unpacked .app build found under ${releaseDir} (in a mac* subdirectory). ${REBUILD_HINT}`,
    );
  }
  if (candidates.length > 1) {
    throw new Error(
      `Found ${candidates.length} unpacked .app builds — refusing to guess which to test:\n` +
        candidates.map((candidate) => `  - ${candidate}`).join('\n') +
        `\n${REBUILD_HINT}`,
    );
  }

  const executable = path.join(appBundle, 'Contents/MacOS/AstroTracker');
  if (!fs.existsSync(executable)) {
    throw new Error(
      `Found ${appBundle} but its executable ${executable} is missing. ${REBUILD_HINT}`,
    );
  }
  return executable;
}

function resolveWinExecutable(): string {
  const executable = path.join(releaseDir, 'win-unpacked', 'AstroTracker.exe');
  if (!fs.existsSync(executable)) {
    throw new Error(`No unpacked build found at ${executable}. ${REBUILD_HINT}`);
  }
  return executable;
}

/**
 * Returns the absolute path to the packaged app's executable, throwing a
 * descriptive error (naming every candidate found and the `pree2e` command)
 * when there is not exactly one unambiguous build to test.
 */
export function resolveBuild(): string {
  switch (process.platform) {
    case 'darwin':
      return resolveMacExecutable();
    case 'win32':
      return resolveWinExecutable();
    default:
      throw new Error(
        `E2E supports darwin and win32 only (DD-001 packages Windows + macOS); got ${process.platform}.`,
      );
  }
}
