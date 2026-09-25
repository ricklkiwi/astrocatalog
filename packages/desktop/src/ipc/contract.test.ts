import { describe, expect, it, vi } from 'vitest';

import { createIpcHandlers, registerIpcHandlers } from '../main/ipc/register.js';
import {
  IPC_CHANNELS,
  IPC_EVENT_CHANNELS,
  type AppVersionInfo,
  type EquipmentProfileRecord,
  type EquipmentProfileWithUsageRecord,
  type JobSummary,
  type WatchFolderRecord,
} from './contract.js';

const SAMPLE_WATCH_FOLDER: WatchFolderRecord = {
  id: 'wf-1',
  path: '/mnt/astro',
  driveLabel: null,
  isActive: true,
  lastScanAt: null,
  skipPatterns: null,
  liveWatchEnabled: false,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const SAMPLE_EQUIPMENT_PROFILE: EquipmentProfileRecord = {
  id: 'eq-1',
  name: 'EdgeHD 8 + ASI2600MM',
  telescope: 'EdgeHD 8',
  camera: 'ASI2600MM',
  focalLength: 2032,
  aperture: null,
  pixelSize: null,
  isUserConfirmed: false,
  matchKey: 'k1',
  mergedIntoId: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
};

const SAMPLE_EQUIPMENT_PROFILE_WITH_USAGE: EquipmentProfileWithUsageRecord = {
  ...SAMPLE_EQUIPMENT_PROFILE,
  lightExposureSeconds: 0,
  usageHours: 0,
  lightFrameCount: 0,
};

/** Default equipment stub for tests that don't exercise these handlers. */
function stubEquipment() {
  return {
    list: () => [SAMPLE_EQUIPMENT_PROFILE_WITH_USAGE],
    suggestions: () => [],
    confirm: () => SAMPLE_EQUIPMENT_PROFILE,
    rename: () => SAMPLE_EQUIPMENT_PROFILE,
    merge: () => {},
  };
}

/** Handlers with the demo-enqueue dep mocked and the rest of the contract stubbed. */
function makeValidationHandlers(enqueueDemo: () => { jobId: string }) {
  return createIpcHandlers({
    appVersion: 'test',
    platform: 'test',
    versions: {},
    nativeSmoke: () => ({ sqliteVersion: 'test', sharpVersion: 'test' }),
    jobs: {
      enqueueDemo,
      cancel: vi.fn(),
      list: vi.fn(() => []),
      enqueueScan: vi.fn(() => ({ jobId: 'scan-1' })),
    },
    watchFolders: {
      list: () => [],
      add: () => Promise.resolve(SAMPLE_WATCH_FOLDER),
      remove: () => true,
      setLiveWatch: () => SAMPLE_WATCH_FOLDER,
    },
    files: { listByWatchFolder: () => [] },
    equipment: stubEquipment(),
  });
}

function makeHandlers() {
  return createIpcHandlers({
    appVersion: '0.1.0-test',
    platform: 'darwin',
    versions: { electron: '43.0.0', chrome: '142.0.0.0', node: '22.0.0' },
    nativeSmoke: () => ({ sqliteVersion: '3.46.0', sharpVersion: '0.33.0' }),
    jobs: {
      enqueueDemo: () => ({ jobId: 'job-1' }),
      cancel: () => {},
      list: () => [
        {
          id: 'job-1',
          jobType: 'demo',
          status: 'queued',
          progressCurrent: 0,
          progressTotal: null,
          progressMessage: null,
        },
      ],
      enqueueScan: () => ({ jobId: 'scan-1' }),
    },
    watchFolders: {
      list: () => [],
      add: () => Promise.resolve(SAMPLE_WATCH_FOLDER),
      remove: () => true,
      setLiveWatch: () => SAMPLE_WATCH_FOLDER,
    },
    files: {
      listByWatchFolder: () => [],
    },
    equipment: stubEquipment(),
  });
}

describe('IPC contract registration', () => {
  it('binds every contract channel exactly once, and nothing else', () => {
    const registered: string[] = [];
    registerIpcHandlers({ handle: (channel) => registered.push(channel) }, makeHandlers());

    expect([...registered].sort()).toEqual([...IPC_CHANNELS].sort());
    expect(new Set(registered).size).toBe(registered.length);
  });

  it('has a handler for every contract channel (set equality with IPC_CHANNELS)', () => {
    // IpcHandlers is a mapped type over the contract, so its runtime keys ARE
    // the contract's keys — this pins IPC_CHANNELS against drifting from it.
    expect(Object.keys(makeHandlers()).sort()).toEqual([...IPC_CHANNELS].sort());
  });
});

describe('jobs handlers', () => {
  it('registers job request channels and the jobs.progress event channel', () => {
    expect(IPC_CHANNELS).toEqual([
      'app.version',
      'jobs.enqueueDemo',
      'jobs.cancel',
      'jobs.list',
      'jobs.enqueueScan',
      'watchFolders.list',
      'watchFolders.add',
      'watchFolders.remove',
      'watchFolders.setLiveWatch',
      'files.listByWatchFolder',
      'equipment.list',
      'equipment.suggestions',
      'equipment.confirm',
      'equipment.rename',
      'equipment.merge',
    ]);
    expect(IPC_EVENT_CHANNELS).toEqual(['jobs.progress', 'watch.status', 'watch.activity']);
  });

  it('delegates enqueue/cancel/list to injected job dependencies', async () => {
    const handlers = makeHandlers();

    expect(await handlers['jobs.enqueueDemo']({ totalSteps: 2, stepMs: 3 })).toEqual({
      jobId: 'job-1',
    });
    expect(await handlers['jobs.cancel']({ jobId: 'job-1' })).toBeUndefined();
    const jobs: JobSummary[] = await handlers['jobs.list']();
    expect(jobs[0]?.id).toBe('job-1');
  });

  it.each([
    [undefined, { totalSteps: 10, stepMs: 500 }],
    [{ totalSteps: 12 }, { totalSteps: 12, stepMs: 500 }],
    [{ stepMs: 75 }, { totalSteps: 10, stepMs: 75 }],
    [
      { totalSteps: 1, stepMs: 1 },
      { totalSteps: 1, stepMs: 1 },
    ],
    [
      { totalSteps: 1000, stepMs: 10000 },
      { totalSteps: 1000, stepMs: 10000 },
    ],
  ])('validates and defaults enqueue input %j before delegation', async (input, expected) => {
    const enqueueDemo = vi.fn(() => ({ jobId: 'validated-job' }));
    const handlers = makeValidationHandlers(enqueueDemo);

    expect(handlers['jobs.enqueueDemo'](input)).toEqual({ jobId: 'validated-job' });
    expect(enqueueDemo).toHaveBeenCalledExactlyOnceWith(expected);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 1001])(
    'rejects invalid totalSteps %s before enqueue',
    async (totalSteps) => {
      const enqueueDemo = vi.fn(() => ({ jobId: 'must-not-exist' }));
      const handlers = makeValidationHandlers(enqueueDemo);

      expect(() => handlers['jobs.enqueueDemo']({ totalSteps, stepMs: 5 })).toThrow(
        /totalSteps.*1\.\.1000/,
      );
      expect(enqueueDemo).not.toHaveBeenCalled();
    },
  );

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 10001])(
    'rejects invalid stepMs %s before enqueue',
    async (stepMs) => {
      const enqueueDemo = vi.fn(() => ({ jobId: 'must-not-exist' }));
      const handlers = makeValidationHandlers(enqueueDemo);

      expect(() => handlers['jobs.enqueueDemo']({ totalSteps: 5, stepMs })).toThrow(
        /stepMs.*1\.\.10000/,
      );
      expect(enqueueDemo).not.toHaveBeenCalled();
    },
  );

  it.each([null, [], 42, 'demo'])('rejects malformed runtime input %j before enqueue', (input) => {
    const enqueueDemo = vi.fn(() => ({ jobId: 'must-not-exist' }));
    const handlers = makeValidationHandlers(enqueueDemo);

    expect(() => handlers['jobs.enqueueDemo'](input as never)).toThrow(/input must be an object/);
    expect(enqueueDemo).not.toHaveBeenCalled();
  });
});

describe('app.version handler', () => {
  it('returns the contract output shape with non-empty string fields', async () => {
    const result: AppVersionInfo = await makeHandlers()['app.version']();

    const expectedKeys: Array<keyof AppVersionInfo> = [
      'appVersion',
      'electronVersion',
      'chromeVersion',
      'nodeVersion',
      'platform',
      'sqliteVersion',
      'sharpVersion',
    ];
    expect(Object.keys(result).sort()).toEqual([...expectedKeys].sort());
    for (const key of expectedKeys) {
      expect(typeof result[key], key).toBe('string');
      expect(result[key], key).not.toHaveLength(0);
    }
    expect(result.appVersion).toBe('0.1.0-test');
    expect(result.platform).toBe('darwin');
  });
});

describe('watch-folder and scan handlers', () => {
  it('wraps the injected watch-folder list output', async () => {
    const list = vi.fn(() => [SAMPLE_WATCH_FOLDER]);
    const handlers = createIpcHandlers({
      appVersion: 'test',
      platform: 'test',
      versions: {},
      nativeSmoke: () => ({ sqliteVersion: 'test', sharpVersion: 'test' }),
      jobs: {
        enqueueDemo: vi.fn(() => ({ jobId: 'job' })),
        cancel: vi.fn(),
        list: vi.fn(() => []),
        enqueueScan: vi.fn(() => ({ jobId: 'scan' })),
      },
      watchFolders: {
        list,
        add: () => Promise.resolve(SAMPLE_WATCH_FOLDER),
        remove: () => true,
        setLiveWatch: () => SAMPLE_WATCH_FOLDER,
      },
      files: { listByWatchFolder: () => [] },
      equipment: stubEquipment(),
    });

    expect(await handlers['watchFolders.list']()).toEqual({ watchFolders: [SAMPLE_WATCH_FOLDER] });
    expect(list).toHaveBeenCalledOnce();
  });

  it('validates the add path and delegates to the injected add dependency', async () => {
    const add = vi.fn(() => Promise.resolve(SAMPLE_WATCH_FOLDER));
    const handlers = createIpcHandlers({
      appVersion: 'test',
      platform: 'test',
      versions: {},
      nativeSmoke: () => ({ sqliteVersion: 'test', sharpVersion: 'test' }),
      jobs: {
        enqueueDemo: vi.fn(() => ({ jobId: 'job' })),
        cancel: vi.fn(),
        list: vi.fn(() => []),
        enqueueScan: vi.fn(() => ({ jobId: 'scan' })),
      },
      watchFolders: {
        list: () => [],
        add,
        remove: () => true,
        setLiveWatch: () => SAMPLE_WATCH_FOLDER,
      },
      files: { listByWatchFolder: () => [] },
      equipment: stubEquipment(),
    });

    expect(await handlers['watchFolders.add']({ path: '/mnt/astro' })).toEqual(SAMPLE_WATCH_FOLDER);
    expect(add).toHaveBeenCalledExactlyOnceWith({ path: '/mnt/astro' });

    // A blank path is rejected (synchronously) before the dependency is ever touched.
    add.mockClear();
    expect(() => handlers['watchFolders.add']({ path: '   ' })).toThrow(
      /path must be a non-empty string/,
    );
    expect(add).not.toHaveBeenCalled();
  });

  it('wraps remove/enqueueScan/listByWatchFolder and validates their ids', async () => {
    const remove = vi.fn(() => true);
    const enqueueScan = vi.fn(() => ({ jobId: 'scan-9' }));
    const listByWatchFolder = vi.fn(() => []);
    const handlers = createIpcHandlers({
      appVersion: 'test',
      platform: 'test',
      versions: {},
      nativeSmoke: () => ({ sqliteVersion: 'test', sharpVersion: 'test' }),
      jobs: {
        enqueueDemo: vi.fn(() => ({ jobId: 'job' })),
        cancel: vi.fn(),
        list: vi.fn(() => []),
        enqueueScan,
      },
      watchFolders: {
        list: () => [],
        add: () => Promise.resolve(SAMPLE_WATCH_FOLDER),
        remove,
        setLiveWatch: () => SAMPLE_WATCH_FOLDER,
      },
      files: { listByWatchFolder },
      equipment: stubEquipment(),
    });

    expect(await handlers['watchFolders.remove']({ id: 'wf-1' })).toEqual({ removed: true });
    expect(remove).toHaveBeenCalledExactlyOnceWith('wf-1');

    expect(await handlers['jobs.enqueueScan']({ watchFolderId: 'wf-1' })).toEqual({
      jobId: 'scan-9',
    });
    expect(enqueueScan).toHaveBeenCalledExactlyOnceWith({ watchFolderId: 'wf-1' });

    expect(await handlers['files.listByWatchFolder']({ watchFolderId: 'wf-1' })).toEqual({
      files: [],
    });
    expect(listByWatchFolder).toHaveBeenCalledExactlyOnceWith('wf-1');

    expect(() => handlers['jobs.enqueueScan']({ watchFolderId: '' })).toThrow(
      /watchFolderId must be a non-empty string/,
    );
  });

  it('validates and delegates watchFolders.setLiveWatch to the injected dependency', async () => {
    const setLiveWatch = vi.fn(() => ({ ...SAMPLE_WATCH_FOLDER, liveWatchEnabled: true }));
    const handlers = createIpcHandlers({
      appVersion: 'test',
      platform: 'test',
      versions: {},
      nativeSmoke: () => ({ sqliteVersion: 'test', sharpVersion: 'test' }),
      jobs: {
        enqueueDemo: vi.fn(() => ({ jobId: 'job' })),
        cancel: vi.fn(),
        list: vi.fn(() => []),
        enqueueScan: vi.fn(() => ({ jobId: 'scan' })),
      },
      watchFolders: {
        list: () => [],
        add: () => Promise.resolve(SAMPLE_WATCH_FOLDER),
        remove: () => true,
        setLiveWatch,
      },
      files: { listByWatchFolder: () => [] },
      equipment: stubEquipment(),
    });

    expect(await handlers['watchFolders.setLiveWatch']({ id: 'wf-1', enabled: true })).toEqual({
      ...SAMPLE_WATCH_FOLDER,
      liveWatchEnabled: true,
    });
    expect(setLiveWatch).toHaveBeenCalledExactlyOnceWith('wf-1', true);

    // Malformed input is rejected before the dependency is ever called
    // (mirroring the watchFolders.remove/jobs.enqueueScan id-validation pattern).
    setLiveWatch.mockClear();
    expect(() => handlers['watchFolders.setLiveWatch']({ id: '', enabled: true })).toThrow(
      /id must be a non-empty string/,
    );
    expect(() =>
      handlers['watchFolders.setLiveWatch']({ id: 'wf-1', enabled: 'yes' } as never),
    ).toThrow(/enabled must be a boolean/);
    expect(setLiveWatch).not.toHaveBeenCalled();
  });
});

// --- P1-18 equipment-profile channels (IPC-1..8, TEST-4) ------------------

function makeEquipmentHandlers(
  overrides: Partial<{
    list: () => EquipmentProfileWithUsageRecord[];
    suggestions: () => {
      profileIds: string[];
      recommendedSurvivorId: string;
      reason: 'canonical_name_match';
    }[];
    confirm: (id: string) => EquipmentProfileRecord;
    rename: (id: string, name: string) => EquipmentProfileRecord;
    merge: (survivorId: string, mergedIds: string[]) => void;
  }> = {},
) {
  return createIpcHandlers({
    appVersion: 'test',
    platform: 'test',
    versions: {},
    nativeSmoke: () => ({ sqliteVersion: 'test', sharpVersion: 'test' }),
    jobs: {
      enqueueDemo: vi.fn(() => ({ jobId: 'job' })),
      cancel: vi.fn(),
      list: vi.fn(() => []),
      enqueueScan: vi.fn(() => ({ jobId: 'scan' })),
    },
    watchFolders: {
      list: () => [],
      add: () => Promise.resolve(SAMPLE_WATCH_FOLDER),
      remove: () => true,
      setLiveWatch: () => SAMPLE_WATCH_FOLDER,
    },
    files: { listByWatchFolder: () => [] },
    equipment: { ...stubEquipment(), ...overrides },
  });
}

describe('equipment handlers (IPC-1..8)', () => {
  it('IPC-2: equipment.merge forwards survivorId and mergedIds in their correct positions', async () => {
    const merge = vi.fn();
    const handlers = makeEquipmentHandlers({ merge });

    await handlers['equipment.merge']({ survivorId: 'S', mergedIds: ['L1', 'L2'] });
    expect(merge).toHaveBeenCalledExactlyOnceWith('S', ['L1', 'L2']);
  });

  it('IPC-3: equipment.list/suggestions/confirm/rename each forward to their own dep and return its output', async () => {
    const list = vi.fn(() => [SAMPLE_EQUIPMENT_PROFILE_WITH_USAGE]);
    const suggestions = vi.fn(() => [
      {
        profileIds: ['a', 'b'],
        recommendedSurvivorId: 'a',
        reason: 'canonical_name_match' as const,
      },
    ]);
    const confirm = vi.fn(() => ({ ...SAMPLE_EQUIPMENT_PROFILE, isUserConfirmed: true }));
    const rename = vi.fn(() => ({ ...SAMPLE_EQUIPMENT_PROFILE, name: 'New Name' }));
    const handlers = makeEquipmentHandlers({ list, suggestions, confirm, rename });

    expect(await handlers['equipment.list']()).toEqual({
      profiles: [SAMPLE_EQUIPMENT_PROFILE_WITH_USAGE],
    });
    expect(list).toHaveBeenCalledOnce();

    expect(await handlers['equipment.suggestions']()).toEqual({
      suggestions: [
        { profileIds: ['a', 'b'], recommendedSurvivorId: 'a', reason: 'canonical_name_match' },
      ],
    });
    expect(suggestions).toHaveBeenCalledOnce();

    expect(await handlers['equipment.confirm']({ id: 'eq-1' })).toEqual({
      ...SAMPLE_EQUIPMENT_PROFILE,
      isUserConfirmed: true,
    });
    expect(confirm).toHaveBeenCalledExactlyOnceWith('eq-1');

    expect(await handlers['equipment.rename']({ id: 'eq-1', name: 'New Name' })).toEqual({
      ...SAMPLE_EQUIPMENT_PROFILE,
      name: 'New Name',
    });
    expect(rename).toHaveBeenCalledExactlyOnceWith('eq-1', 'New Name');
  });

  it('IPC-4: equipment.confirm rejects a whitespace-only id before the dep is reached', () => {
    const confirm = vi.fn(() => SAMPLE_EQUIPMENT_PROFILE);
    const handlers = makeEquipmentHandlers({ confirm });

    expect(() => handlers['equipment.confirm']({ id: '   ' })).toThrow(
      /id must be a non-empty string/,
    );
    expect(confirm).not.toHaveBeenCalled();
  });

  it('IPC-5: equipment.rename rejects a whitespace-only name before the dep is reached', () => {
    const rename = vi.fn(() => SAMPLE_EQUIPMENT_PROFILE);
    const handlers = makeEquipmentHandlers({ rename });

    expect(() => handlers['equipment.rename']({ id: 'eq-1', name: '   ' })).toThrow(
      /name must be a non-empty string/,
    );
    expect(rename).not.toHaveBeenCalled();
  });

  it('IPC-6: equipment.merge rejects a non-array mergedIds before the dep is reached', () => {
    const merge = vi.fn();
    const handlers = makeEquipmentHandlers({ merge });

    expect(() =>
      handlers['equipment.merge']({ survivorId: 'S', mergedIds: 'L1' } as never),
    ).toThrow(/mergedIds must be a non-empty array of strings/);
    expect(merge).not.toHaveBeenCalled();
  });

  it('IPC-7: equipment.merge rejects an empty mergedIds array before the dep is reached', () => {
    const merge = vi.fn();
    const handlers = makeEquipmentHandlers({ merge });

    expect(() => handlers['equipment.merge']({ survivorId: 'S', mergedIds: [] })).toThrow(
      /mergedIds must be a non-empty array of strings/,
    );
    expect(merge).not.toHaveBeenCalled();
  });

  it('IPC-8: equipment.merge rejects an empty-string or non-string element before the dep is reached', () => {
    const merge = vi.fn();
    const handlers = makeEquipmentHandlers({ merge });

    expect(() => handlers['equipment.merge']({ survivorId: 'S', mergedIds: ['L1', ''] })).toThrow(
      /mergedIds must be a non-empty array of strings/,
    );
    expect(() =>
      handlers['equipment.merge']({ survivorId: 'S', mergedIds: ['L1', 42] } as never),
    ).toThrow(/mergedIds must be a non-empty array of strings/);
    expect(merge).not.toHaveBeenCalled();
  });

  // TEST-4: non-object input rejected before the dep is reached, on every equipment handler that takes input.
  it.each([null, 'not-an-object', 42, []])(
    'TEST-4: rejects non-object input %j on confirm/rename/merge before the dep is reached',
    (input) => {
      const confirm = vi.fn(() => SAMPLE_EQUIPMENT_PROFILE);
      const rename = vi.fn(() => SAMPLE_EQUIPMENT_PROFILE);
      const merge = vi.fn();
      const handlers = makeEquipmentHandlers({ confirm, rename, merge });

      expect(() => handlers['equipment.confirm'](input as never)).toThrow(/must be an object/);
      expect(() => handlers['equipment.rename'](input as never)).toThrow(/must be an object/);
      expect(() => handlers['equipment.merge'](input as never)).toThrow(/must be an object/);
      expect(confirm).not.toHaveBeenCalled();
      expect(rename).not.toHaveBeenCalled();
      expect(merge).not.toHaveBeenCalled();
    },
  );
});
