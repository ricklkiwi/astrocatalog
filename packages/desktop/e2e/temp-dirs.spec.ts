import { mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { ElectronApplication } from '@playwright/test';

import { expect, runElectronAppFixture, test } from './fixtures.js';
import { resolveBuild } from './support/resolve-build.js';
import { createTempAppDataDir, createTempLibraryDir, type TempDir } from './support/temp-dirs.js';

const fixturesDir = path.join(import.meta.dirname, '../../../fixtures');

async function expectMissing(target: string): Promise<void> {
  await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
}

async function tempLibraryEntries(): Promise<Set<string>> {
  return new Set(
    (await readdir(os.tmpdir())).filter((entry) => entry.startsWith('astrotracker-e2e-library-')),
  );
}

test.describe('temp directory helpers', () => {
  test('creates unique app-data directories and removes them', async () => {
    const first = await createTempAppDataDir();
    const second = await createTempAppDataDir();
    try {
      expect(first.path).not.toBe(second.path);
      await expect(stat(first.path)).resolves.toBeTruthy();
      await expect(stat(second.path)).resolves.toBeTruthy();
    } finally {
      await first.cleanup();
      await second.cleanup();
    }
    await expectMissing(first.path);
    await expectMissing(second.path);
  });

  test('creates an empty library and copies fixture seeds byte-for-byte', async () => {
    const empty = await createTempLibraryDir();
    expect(await readdir(empty.path)).toEqual([]);
    await empty.cleanup();

    const seed = 'fits/nina/nina-dark.fits';
    const seeded = await createTempLibraryDir([seed]);
    try {
      expect(await readdir(seeded.path)).toEqual(['nina-dark.fits']);
      expect(await readFile(path.join(seeded.path, 'nina-dark.fits'))).toEqual(
        await readFile(path.join(fixturesDir, seed)),
      );
    } finally {
      await seeded.cleanup();
    }
  });

  test('rejects absolute paths and traversal without leaving a temp directory', async () => {
    for (const seed of [path.join(os.tmpdir(), 'outside.fit'), '../outside.fit']) {
      const before = await tempLibraryEntries();
      await expect(createTempLibraryDir([seed])).rejects.toThrow(/relative|escapes fixtures/);
      expect(await tempLibraryEntries()).toEqual(before);
    }
  });

  test('rejects a fixture path that resolves through a symlink outside fixtures', async () => {
    const linkedPackage = 'node_modules/@types/node/package.json';
    expect(await realpath(path.join(fixturesDir, linkedPackage))).not.toContain(
      `${path.sep}fixtures${path.sep}`,
    );
    const before = await tempLibraryEntries();
    await expect(createTempLibraryDir([linkedPackage])).rejects.toThrow(/symlink/);
    expect(await tempLibraryEntries()).toEqual(before);
  });

  test('rejects colliding destination basenames before copying', async () => {
    const before = await tempLibraryEntries();
    await expect(createTempLibraryDir(['fits/manifest.json', 'raw/manifest.json'])).rejects.toThrow(
      /basename collision.*manifest\.json/,
    );
    expect(await tempLibraryEntries()).toEqual(before);
  });

  test('removes a partially populated directory when a later copy fails', async () => {
    const before = await tempLibraryEntries();
    await expect(createTempLibraryDir(['README.md', 'fits'])).rejects.toThrow();
    expect(await tempLibraryEntries()).toEqual(before);
  });
});

test.describe('packaged build resolver', () => {
  test('selects exactly one mac app.asar and rejects zero or multiple candidates', async () => {
    const root = await createTempAppDataDir();
    try {
      await expect(() => resolveBuild({ platform: 'darwin', releaseDir: root.path })).toThrow(
        /pree2e/,
      );

      const firstAsar = path.join(
        root.path,
        'mac-arm64',
        'AstroTracker.app',
        'Contents/Resources/app.asar',
      );
      await mkdir(path.dirname(firstAsar), { recursive: true });
      await writeFile(firstAsar, 'first');
      expect(resolveBuild({ platform: 'darwin', releaseDir: root.path }).appPath).toBe(firstAsar);

      const secondAsar = path.join(
        root.path,
        'mac',
        'AstroTracker.app',
        'Contents/Resources/app.asar',
      );
      await mkdir(path.dirname(secondAsar), { recursive: true });
      await writeFile(secondAsar, 'second');
      expect(() => resolveBuild({ platform: 'darwin', releaseDir: root.path })).toThrow(
        new RegExp(
          `mac-arm64.*AstroTracker\\.app[\\s\\S]*mac.*AstroTracker\\.app|mac.*AstroTracker\\.app[\\s\\S]*mac-arm64.*AstroTracker\\.app`,
        ),
      );
    } finally {
      await root.cleanup();
    }
  });

  test('uses the deterministic Windows app.asar path', async () => {
    const root = await createTempAppDataDir();
    try {
      const appPath = path.join(root.path, 'win-unpacked', 'resources', 'app.asar');
      await mkdir(path.dirname(appPath), { recursive: true });
      await writeFile(appPath, 'windows');
      expect(resolveBuild({ platform: 'win32', releaseDir: root.path })).toEqual({
        appPath,
        artifactPath: path.join(root.path, 'win-unpacked'),
      });
    } finally {
      await root.cleanup();
    }
  });
});

function fakeTempDir(name: string, cleanup: () => Promise<void>): TempDir {
  return { path: path.join(os.tmpdir(), name), cleanup };
}

function fakeApp(close: () => Promise<void>): ElectronApplication {
  return { close } as unknown as ElectronApplication;
}

test.describe('electron fixture lifecycle', () => {
  test('cleans app-data when library acquisition fails and preserves the setup error', async () => {
    const calls: string[] = [];
    const setupError = new Error('library setup failed');
    await expect(
      runElectronAppFixture(async () => {}, {
        resolveBuild: () => ({ appPath: '/packaged/app.asar', artifactPath: '/packaged' }),
        createTempAppDataDir: async () =>
          fakeTempDir('app-data', async () => {
            calls.push('app-data');
          }),
        createTempLibraryDir: async () => {
          throw setupError;
        },
        launch: async () => {
          throw new Error('launch must not run');
        },
      }),
    ).rejects.toBe(setupError);
    expect(calls).toEqual(['app-data']);
  });

  test('cleans every acquired resource when launch or the test body fails', async () => {
    for (const failureAt of ['launch', 'use'] as const) {
      const calls: string[] = [];
      const expected = new Error(`${failureAt} failed`);
      await expect(
        runElectronAppFixture(
          async () => {
            if (failureAt === 'use') throw expected;
          },
          {
            resolveBuild: () => ({ appPath: '/packaged/app.asar', artifactPath: '/packaged' }),
            createTempAppDataDir: async () =>
              fakeTempDir('app-data', async () => {
                calls.push('app-data');
              }),
            createTempLibraryDir: async () =>
              fakeTempDir('library', async () => {
                calls.push('library');
              }),
            launch: async () => {
              if (failureAt === 'launch') throw expected;
              return fakeApp(async () => {
                calls.push('app');
              });
            },
          },
        ),
      ).rejects.toBe(expected);
      expect(calls).toEqual(
        failureAt === 'launch' ? ['app-data', 'library'] : ['app', 'app-data', 'library'],
      );
    }
  });

  test('attempts all teardown actions and reports every cleanup failure', async () => {
    const calls: string[] = [];
    const result = runElectronAppFixture(async () => {}, {
      resolveBuild: () => ({ appPath: '/packaged/app.asar', artifactPath: '/packaged' }),
      createTempAppDataDir: async () =>
        fakeTempDir('app-data', async () => {
          calls.push('app-data');
          throw new Error('app-data locked');
        }),
      createTempLibraryDir: async () =>
        fakeTempDir('library', async () => {
          calls.push('library');
          throw new Error('library locked');
        }),
      launch: async () =>
        fakeApp(async () => {
          calls.push('app');
          throw new Error('close failed');
        }),
    });
    await expect(result).rejects.toBeInstanceOf(AggregateError);
    expect(calls).toEqual(['app', 'app-data', 'library']);
    const error = await result.catch((caught: unknown) => caught);
    expect((error as AggregateError).errors).toHaveLength(3);
  });
});
