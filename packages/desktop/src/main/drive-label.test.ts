import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mocked at module boundary: no real `diskutil`/`findmnt`/`powershell` ever
// runs in unit tests (matches the repo's node-builtin mocking approach).
vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'node:child_process';

import { detectDriveLabel, parseDiskutilVolumeName } from './drive-label.js';

const execFileMock = execFile as unknown as ReturnType<typeof vi.fn>;

/** Make the next execFile call invoke its callback with (error, stdout). */
function stubExecFile(result: { error: Error | null; stdout: string }): void {
  execFileMock.mockImplementation(
    (_command: string, _args: string[], _options: unknown, callback: unknown) => {
      (callback as (error: Error | null, stdout: string) => void)(result.error, result.stdout);
      return undefined;
    },
  );
}

const originalPlatform = process.platform;

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

beforeEach(() => {
  execFileMock.mockReset();
});

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  vi.restoreAllMocks();
});

const DISKUTIL_SAMPLE = [
  '   Device Identifier:         disk3s1',
  '   Device Node:               /dev/disk3s1',
  '   Volume Name:               Astro SSD',
  '   Mounted:                   Yes',
  '   File System Personality:   APFS',
].join('\n');

describe('parseDiskutilVolumeName', () => {
  it('extracts the Volume Name field', () => {
    expect(parseDiskutilVolumeName(DISKUTIL_SAMPLE)).toBe('Astro SSD');
  });

  it('returns null when there is no Volume Name line', () => {
    expect(parseDiskutilVolumeName('   Device Node: /dev/disk3s1\n')).toBeNull();
  });

  it('treats "Not applicable" sentinels as null', () => {
    expect(
      parseDiskutilVolumeName('   Volume Name:               Not applicable (no file system)\n'),
    ).toBeNull();
  });
});

describe('detectDriveLabel', () => {
  it('parses the macOS diskutil output into a label', async () => {
    setPlatform('darwin');
    stubExecFile({ error: null, stdout: DISKUTIL_SAMPLE });

    await expect(detectDriveLabel('/Volumes/Astro SSD/lights')).resolves.toBe('Astro SSD');
    expect(execFileMock).toHaveBeenCalledWith(
      'diskutil',
      ['info', '/Volumes/Astro SSD/lights'],
      expect.objectContaining({ timeout: expect.any(Number) }),
      expect.any(Function),
    );
  });

  it('resolves to null (never throws) when the child process fails', async () => {
    setPlatform('darwin');
    stubExecFile({ error: new Error('diskutil: command not found'), stdout: '' });

    await expect(detectDriveLabel('/Volumes/whatever')).resolves.toBeNull();
  });

  it('resolves to null on an unsupported platform without spawning anything', async () => {
    setPlatform('freebsd' as NodeJS.Platform);

    await expect(detectDriveLabel('/mnt/data')).resolves.toBeNull();
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('parses a Linux findmnt label', async () => {
    setPlatform('linux');
    stubExecFile({ error: null, stdout: 'ASTRO_DATA\n' });

    await expect(detectDriveLabel('/mnt/astro')).resolves.toBe('ASTRO_DATA');
  });

  it('returns null for a Linux mount with no label', async () => {
    setPlatform('linux');
    stubExecFile({ error: null, stdout: '\n' });

    await expect(detectDriveLabel('/mnt/astro')).resolves.toBeNull();
  });

  it('keys Windows Get-Volume off the drive letter', async () => {
    setPlatform('win32');
    stubExecFile({ error: null, stdout: 'Astro Backup\r\n' });

    await expect(detectDriveLabel('E:\\photos\\lights')).resolves.toBe('Astro Backup');
    const call = execFileMock.mock.calls[0];
    expect(call?.[0]).toBe('powershell');
    expect((call?.[1] as string[]).join(' ')).toContain('-DriveLetter E');
  });

  it('returns null for a Windows path with no drive letter (UNC)', async () => {
    setPlatform('win32');

    await expect(detectDriveLabel('\\\\server\\share\\lights')).resolves.toBeNull();
    expect(execFileMock).not.toHaveBeenCalled();
  });
});
