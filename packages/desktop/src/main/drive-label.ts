/**
 * Best-effort volume/drive-label capture for a watch folder (P1-06, DD-004:
 * "drive-label capture for external drives"). Given a folder path, returns the
 * human-readable label of the volume that contains it (e.g. `"Astro SSD"`,
 * `"Macintosh HD"`) so the UI can tell the user *which* external drive a set
 * of `missing` files lives on.
 *
 * Deliberately isolated in `packages/main` (not a repository, not IPC) — a
 * parallel workstream imports and calls this from the watch-folder-create IPC
 * handler. It is intentionally NOT wired into any db/IPC code here.
 *
 * Hard contract: **never throws, never hangs, resolves to `null` on any
 * failure** — unsupported platform, missing command, path not on a labeled
 * volume, CI container with no real disks. Every OS branch is best-effort and
 * bounded by a child-process timeout.
 */
import { execFile } from 'node:child_process';

/** Upper bound on any single label-probe child process. */
const COMMAND_TIMEOUT_MS = 4000;

/**
 * Detect the label of the volume containing `folderPath`. Resolves to the
 * label string, or `null` if it can't be determined for any reason.
 */
export async function detectDriveLabel(folderPath: string): Promise<string | null> {
  try {
    switch (process.platform) {
      case 'darwin':
        return await detectDarwin(folderPath);
      case 'linux':
        return await detectLinux(folderPath);
      case 'win32':
        return await detectWindows(folderPath);
      default:
        return null;
    }
  } catch {
    // Any failure (command missing, non-zero exit, timeout, parse miss) is a
    // best-effort miss, not an error the caller should have to handle.
    return null;
  }
}

/** macOS: `diskutil info <path>` → the `Volume Name:` field. */
async function detectDarwin(folderPath: string): Promise<string | null> {
  const stdout = await runCommand('diskutil', ['info', folderPath]);
  return parseDiskutilVolumeName(stdout);
}

/** Linux: `findmnt` reports the LABEL of the mount containing the path. */
async function detectLinux(folderPath: string): Promise<string | null> {
  const stdout = await runCommand('findmnt', [
    '--noheadings',
    '--output',
    'LABEL',
    '--target',
    folderPath,
  ]);
  return normalizeLabel(stdout.trim());
}

/** Windows: `Get-Volume -DriveLetter X` → `FileSystemLabel`, keyed off the path's drive letter. */
async function detectWindows(folderPath: string): Promise<string | null> {
  const driveLetter = driveLetterOf(folderPath);
  if (driveLetter === null) {
    return null;
  }
  const stdout = await runCommand('powershell', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `(Get-Volume -DriveLetter ${driveLetter}).FileSystemLabel`,
  ]);
  return normalizeLabel(stdout.trim());
}

/**
 * Extract a single A–Z drive letter from a Windows path (`E:\photos` → `E`),
 * or `null` for a UNC/relative path we can't key `Get-Volume` off.
 */
function driveLetterOf(folderPath: string): string | null {
  const match = /^([A-Za-z]):/.exec(folderPath);
  const letter = match?.[1];
  return letter === undefined ? null : letter.toUpperCase();
}

/** Parse the `Volume Name:` line out of `diskutil info` text output. */
export function parseDiskutilVolumeName(stdout: string): string | null {
  for (const line of stdout.split('\n')) {
    const match = /^\s*Volume Name:\s*(.+?)\s*$/.exec(line);
    const name = match?.[1];
    if (name !== undefined) {
      return normalizeLabel(name);
    }
  }
  return null;
}

/**
 * Collapse the various "no real label" sentinels the OS tools emit into
 * `null`; otherwise return the trimmed label.
 */
function normalizeLabel(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '' || /^not applicable/i.test(trimmed)) {
    return null;
  }
  return trimmed;
}

/** Promisified, timeout-bounded `execFile`; rejects on non-zero exit or timeout. */
function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout: COMMAND_TIMEOUT_MS, windowsHide: true, encoding: 'utf8' },
      (error, stdout) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}
