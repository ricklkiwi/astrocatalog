/**
 * Locates the `electron-builder --dir` unpacked build's packaged `app.asar`
 * for the current OS (plan Step 2). E2E always launches this packaged
 * artifact — identical asar/asarUnpack/npmRebuild pipeline to the release
 * DMG/NSIS builds — never the dev-mode source directory (DD-001).
 *
 * macOS: electron-builder's output directory name is not pinned by this
 * repo's config (`mac`, `mac-arm64`, `mac-universal`, … depending on the
 * host arch), so we glob every `.app` inside every `release/mac*` directory
 * instead of hardcoding one name. Windows: `electron-builder.yml` pins a
 * single nsis/x64 target, so `release/win-unpacked/resources/app.asar` is
 * deterministic.
 */
import fs from 'node:fs';
import path from 'node:path';

const defaultReleaseDir = path.join(import.meta.dirname, '../../release');

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

export interface PackagedBuild {
  /** Path passed as the app argument to Playwright's Electron launcher. */
  appPath: string;
  /** Human-readable packaged artifact path for diagnostics. */
  artifactPath: string;
}

function requirePackagedAppAsar(appBundle: string): string {
  const appPath = path.join(appBundle, 'Contents/Resources/app.asar');
  if (!fs.existsSync(appPath)) {
    throw new Error(`Found ${appBundle} but packaged app ${appPath} is missing. ${REBUILD_HINT}`);
  }
  return appPath;
}

function resolveMacBuild(releaseDir: string): PackagedBuild {
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

  return { appPath: requirePackagedAppAsar(appBundle), artifactPath: appBundle };
}

function resolveWinBuild(releaseDir: string): PackagedBuild {
  const appPath = path.join(releaseDir, 'win-unpacked', 'resources', 'app.asar');
  if (!fs.existsSync(appPath)) {
    throw new Error(`No packaged app.asar found at ${appPath}. ${REBUILD_HINT}`);
  }
  return { appPath, artifactPath: path.join(releaseDir, 'win-unpacked') };
}

/**
 * Returns the absolute path to the packaged app payload, throwing a
 * descriptive error (naming every candidate found and the `pree2e` command)
 * when there is not exactly one unambiguous build to test.
 */
export interface ResolveBuildOptions {
  /** Test seam for exercising both OS layouts without touching release/. */
  platform?: NodeJS.Platform;
  /** Test seam for exercising candidate selection in a temp directory. */
  releaseDir?: string;
}

export function resolveBuild(options: ResolveBuildOptions = {}): PackagedBuild {
  const releaseDir = options.releaseDir ?? defaultReleaseDir;
  const platform = options.platform ?? process.platform;
  switch (platform) {
    case 'darwin':
      return resolveMacBuild(releaseDir);
    case 'win32':
      return resolveWinBuild(releaseDir);
    default:
      throw new Error(
        `E2E supports darwin and win32 only (DD-001 packages Windows + macOS); got ${platform}.`,
      );
  }
}
