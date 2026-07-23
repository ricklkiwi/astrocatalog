import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { JobProgressEvent } from '../jobs/orchestrator.js';
import {
  createWatchManager,
  type EnqueueScanInput,
  type EnqueueScanResult,
} from './watch-manager.js';
import type { WatcherFactory, WatcherLike } from './types.js';
import type { WatchStatusEvent } from '../../ipc/contract.js';

type Listener = (arg: never) => void;

/** A fake `WatcherLike` whose event listeners the test can trigger directly. */
class FakeWatcher implements WatcherLike {
  listeners = new Map<string, Listener[]>();
  closeCalls = 0;

  on(event: 'add' | 'change' | 'unlink', listener: (path: string) => void): void;
  on(event: 'error', listener: (error: unknown) => void): void;
  on(event: string, listener: Listener): void {
    const existing = this.listeners.get(event) ?? [];
    existing.push(listener);
    this.listeners.set(event, existing);
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      (listener as (...fnArgs: unknown[]) => void)(...args);
    }
  }

  close(): Promise<void> {
    this.closeCalls += 1;
    return Promise.resolve();
  }
}

interface Harness {
  manager: ReturnType<typeof createWatchManager>;
  createWatcher: ReturnType<typeof vi.fn>;
  watchersByRoot: Map<string, FakeWatcher[]>;
  enqueueScan: ReturnType<typeof vi.fn>;
  statusEvents: WatchStatusEvent[];
  fireJobEvent: (event: JobProgressEvent) => void;
  debounceMs: number;
  fallbackRescanIntervalMs: number;
}

let nextJobId = 0;

function makeHarness(
  overrides: { debounceMs?: number; fallbackRescanIntervalMs?: number } = {},
): Harness {
  const debounceMs = overrides.debounceMs ?? 1000;
  const fallbackRescanIntervalMs = overrides.fallbackRescanIntervalMs ?? 5000;
  const watchersByRoot = new Map<string, FakeWatcher[]>();
  const createWatcher: ReturnType<typeof vi.fn> = vi.fn(((rootPath: string) => {
    const watcher = new FakeWatcher();
    const existing = watchersByRoot.get(rootPath) ?? [];
    existing.push(watcher);
    watchersByRoot.set(rootPath, existing);
    return watcher;
  }) satisfies WatcherFactory);
  const enqueueScan: ReturnType<typeof vi.fn> = vi.fn((() => {
    nextJobId += 1;
    return { jobId: `job-${nextJobId}` };
  }) satisfies (input: EnqueueScanInput) => EnqueueScanResult);
  const statusEvents: WatchStatusEvent[] = [];
  let jobListener: ((event: JobProgressEvent) => void) | undefined;

  const manager = createWatchManager({
    debounceMs,
    fallbackRescanIntervalMs,
    createWatcher: createWatcher as unknown as WatcherFactory,
    enqueueScan: enqueueScan as unknown as (input: EnqueueScanInput) => EnqueueScanResult,
    onJobEvent: (listener) => {
      jobListener = listener;
      return () => {
        jobListener = undefined;
      };
    },
    onStatusChange: (event) => statusEvents.push(event),
    extensions: ['fits', 'xisf'],
  });

  return {
    manager,
    createWatcher,
    watchersByRoot,
    enqueueScan,
    statusEvents,
    fireJobEvent: (event) => jobListener?.(event),
    debounceMs,
    fallbackRescanIntervalMs,
  };
}

function latestWatcher(h: Harness, rootPath: string): FakeWatcher {
  const watchers = h.watchersByRoot.get(rootPath);
  const watcher = watchers?.at(-1);
  if (watcher === undefined) {
    throw new Error(`no watcher created for ${rootPath}`);
  }
  return watcher;
}

/**
 * Completes the most recent `enqueueScan` call made for `watchFolderId`
 * (e.g. the catch-up scan `start()`/`setEnabled(id, true)` fires) so the
 * in-flight guard clears — used by tests that aren't themselves exercising
 * the in-flight-guard/deferred-rescan behavior.
 */
function completeLastScan(h: Harness, watchFolderId: string): void {
  const calls = h.enqueueScan.mock.calls as unknown as [EnqueueScanInput][];
  const index = calls.map((call) => call[0].watchFolderId).lastIndexOf(watchFolderId);
  if (index === -1) {
    throw new Error(`no enqueueScan call recorded for ${watchFolderId}`);
  }
  const jobId = (h.enqueueScan.mock.results[index]?.value as EnqueueScanResult).jobId;
  h.fireJobEvent({
    jobId,
    jobType: 'scan',
    status: 'completed',
    current: 1,
    total: 1,
    message: null,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  nextJobId = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('start() / catch-up scan', () => {
  it('attaches a watcher and fires exactly one immediate catch-up scan, independent of any fs event', () => {
    const h = makeHarness();
    h.manager.start([{ id: 'wf-1', rootPath: '/mnt/astro', enabled: true }]);

    expect(h.createWatcher).toHaveBeenCalledExactlyOnceWith('/mnt/astro', {
      skipPatterns: undefined,
    });
    expect(h.enqueueScan).toHaveBeenCalledExactlyOnceWith({
      watchFolderId: 'wf-1',
      rootPath: '/mnt/astro',
      extensions: ['fits', 'xisf'],
    });
  });

  it('does not attach a watcher for a disabled folder', () => {
    const h = makeHarness();
    h.manager.start([{ id: 'wf-1', rootPath: '/mnt/astro', enabled: false }]);

    expect(h.createWatcher).not.toHaveBeenCalled();
    expect(h.enqueueScan).not.toHaveBeenCalled();
  });
});

describe('debounce-resets-on-each-event', () => {
  it('resets the debounce timer on every qualifying fs event and fires exactly once after quiet', () => {
    const h = makeHarness();
    h.manager.start([{ id: 'wf-1', rootPath: '/mnt/astro', enabled: true }]);
    completeLastScan(h, 'wf-1'); // clear the in-flight catch-up scan
    h.enqueueScan.mockClear();

    const watcher = latestWatcher(h, '/mnt/astro');
    watcher.emit('add', '/mnt/astro/a.fits');
    vi.advanceTimersByTime(10);
    watcher.emit('change', '/mnt/astro/a.fits');

    // Still short of debounceMs from the *last* event.
    vi.advanceTimersByTime(h.debounceMs - 10);
    expect(h.enqueueScan).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10);
    expect(h.enqueueScan).toHaveBeenCalledOnce();
  });
});

describe('continuous sub-debounce trickle', () => {
  it('never flushes while events keep arriving inside the debounce window', () => {
    const h = makeHarness();
    h.manager.start([{ id: 'wf-1', rootPath: '/mnt/astro', enabled: true }]);
    completeLastScan(h, 'wf-1');
    h.enqueueScan.mockClear();
    const watcher = latestWatcher(h, '/mnt/astro');

    for (let i = 0; i < 20; i += 1) {
      watcher.emit('add', `/mnt/astro/f${i}.fits`);
      vi.advanceTimersByTime(h.debounceMs / 2);
    }

    expect(h.enqueueScan).not.toHaveBeenCalled();
  });
});

describe('in-flight-guard-defers-not-drops', () => {
  it('defers a debounce firing while a watch-triggered scan is already in flight, then fires exactly one deferred call on terminal', () => {
    const h = makeHarness();
    h.manager.start([{ id: 'wf-1', rootPath: '/mnt/astro', enabled: true }]);
    expect(h.enqueueScan).toHaveBeenCalledOnce();
    const firstJobId = (h.enqueueScan.mock.results[0]?.value as EnqueueScanResult).jobId;
    h.enqueueScan.mockClear();

    const watcher = latestWatcher(h, '/mnt/astro');
    watcher.emit('add', '/mnt/astro/a.fits');
    vi.advanceTimersByTime(h.debounceMs);

    // The catch-up scan is still in flight, so the debounce firing must not
    // enqueue a second scan.
    expect(h.enqueueScan).not.toHaveBeenCalled();

    h.fireJobEvent({
      jobId: firstJobId,
      jobType: 'scan',
      status: 'completed',
      current: 10,
      total: 10,
      message: null,
    });

    expect(h.enqueueScan).toHaveBeenCalledExactlyOnceWith({
      watchFolderId: 'wf-1',
      rootPath: '/mnt/astro',
      extensions: ['fits', 'xisf'],
    });
  });

  it('does not defer for an unrelated jobId reaching a terminal status', () => {
    const h = makeHarness();
    h.manager.start([{ id: 'wf-1', rootPath: '/mnt/astro', enabled: true }]);
    h.enqueueScan.mockClear();

    const watcher = latestWatcher(h, '/mnt/astro');
    watcher.emit('add', '/mnt/astro/a.fits');
    vi.advanceTimersByTime(h.debounceMs);
    // Still in flight (the catch-up job never completed), so this should defer.
    expect(h.enqueueScan).not.toHaveBeenCalled();

    h.fireJobEvent({
      jobId: 'some-unrelated-job',
      jobType: 'scan',
      status: 'completed',
      current: 1,
      total: 1,
      message: null,
    });
    expect(h.enqueueScan).not.toHaveBeenCalled();
  });
});

describe('watcher-limit-enters-fallback', () => {
  it('closes the watcher, arms a fallback interval, and reports fallback mode on ENOSPC/EMFILE/ENFILE', () => {
    for (const code of ['ENOSPC', 'EMFILE', 'ENFILE']) {
      const h = makeHarness();
      h.manager.start([{ id: 'wf-1', rootPath: '/mnt/astro', enabled: true }]);
      completeLastScan(h, 'wf-1');
      const watcher = latestWatcher(h, '/mnt/astro');
      h.statusEvents.length = 0;

      const error = Object.assign(new Error('boom'), { code });
      watcher.emit('error', error);

      expect(watcher.closeCalls).toBe(1);
      expect(h.statusEvents).toHaveLength(1);
      expect(h.statusEvents[0]?.mode).toBe('fallback');
      expect(h.statusEvents[0]?.message).not.toBeNull();
      expect(h.statusEvents[0]?.watchFolderId).toBe('wf-1');

      // The fallback timer fires a rescan on its own schedule.
      h.enqueueScan.mockClear();
      vi.advanceTimersByTime(h.fallbackRescanIntervalMs);
      expect(h.enqueueScan).toHaveBeenCalledOnce();
    }
  });

  it('still fires its own fallback rescan even while an unrelated manually-triggered scan is in flight for the folder (no dedup)', () => {
    const h = makeHarness();
    h.manager.start([{ id: 'wf-1', rootPath: '/mnt/astro', enabled: true }]);
    completeLastScan(h, 'wf-1'); // clear WatchManager's own in-flight tracking
    const watcher = latestWatcher(h, '/mnt/astro');

    // A manually-triggered "Scan now" job independently in flight for this
    // folder — WatchManager never enqueued it, so it has no way to know
    // (JobProgressEvent carries no watchFolderId, per plan Edge Cases).
    h.fireJobEvent({
      jobId: 'manual-scan-77',
      jobType: 'scan',
      status: 'running',
      current: 1,
      total: 10,
      message: null,
    });

    h.enqueueScan.mockClear();
    watcher.emit('error', Object.assign(new Error('boom'), { code: 'EMFILE' }));
    expect(watcher.closeCalls).toBe(1);

    vi.advanceTimersByTime(h.fallbackRescanIntervalMs);
    // Fires regardless of the unrelated manual scan still "running" — both may fire.
    expect(h.enqueueScan).toHaveBeenCalledOnce();
  });
});

describe('enoent-does-not-enter-fallback', () => {
  it('leaves the watcher running and does not transition mode on ENOENT', () => {
    const h = makeHarness();
    h.manager.start([{ id: 'wf-1', rootPath: '/mnt/astro', enabled: true }]);
    completeLastScan(h, 'wf-1');
    const watcher = latestWatcher(h, '/mnt/astro');
    h.statusEvents.length = 0;

    const error = Object.assign(new Error('vanished'), { code: 'ENOENT' });
    watcher.emit('error', error);

    expect(watcher.closeCalls).toBe(0);
    expect(h.statusEvents).toHaveLength(0);
  });
});

describe('rename/move coalesces into one debounce firing', () => {
  it('an unlink+add pair resets the same timer and fires exactly once', () => {
    const h = makeHarness();
    h.manager.start([{ id: 'wf-1', rootPath: '/mnt/astro', enabled: true }]);
    completeLastScan(h, 'wf-1');
    h.enqueueScan.mockClear();
    const watcher = latestWatcher(h, '/mnt/astro');

    watcher.emit('unlink', '/mnt/astro/old-name.fits');
    vi.advanceTimersByTime(5);
    watcher.emit('add', '/mnt/astro/new-name.fits');
    vi.advanceTimersByTime(h.debounceMs);

    expect(h.enqueueScan).toHaveBeenCalledOnce();
  });
});

describe('idempotent-double-enable', () => {
  it('creates exactly one chokidar watcher instance when setEnabled(id, true) is called twice', () => {
    const h = makeHarness();
    h.manager.registerFolder({ id: 'wf-1', rootPath: '/mnt/astro' });

    h.manager.setEnabled('wf-1', true);
    h.manager.setEnabled('wf-1', true);

    expect(h.createWatcher).toHaveBeenCalledOnce();
  });
});

describe('nested watch folders debounce independently', () => {
  it('a fs event under the nested path fires both folders scoped enqueueScan calls', () => {
    const h = makeHarness();
    h.manager.start([
      { id: 'parent', rootPath: '/mnt/astro', enabled: true },
      { id: 'nested', rootPath: '/mnt/astro/2026-01-15', enabled: true },
    ]);
    completeLastScan(h, 'parent');
    completeLastScan(h, 'nested');
    h.enqueueScan.mockClear();

    const parentWatcher = latestWatcher(h, '/mnt/astro');
    const nestedWatcher = latestWatcher(h, '/mnt/astro/2026-01-15');
    parentWatcher.emit('add', '/mnt/astro/2026-01-15/new.fits');
    nestedWatcher.emit('add', '/mnt/astro/2026-01-15/new.fits');

    vi.advanceTimersByTime(h.debounceMs);

    expect(h.enqueueScan).toHaveBeenCalledTimes(2);
    expect(h.enqueueScan).toHaveBeenCalledWith(
      expect.objectContaining({ watchFolderId: 'parent' }),
    );
    expect(h.enqueueScan).toHaveBeenCalledWith(
      expect.objectContaining({ watchFolderId: 'nested' }),
    );
  });
});

describe('stop() / removal', () => {
  it('tears down timers/watcher without waiting for or cancelling an in-flight scan job', () => {
    const h = makeHarness();
    h.manager.start([{ id: 'wf-1', rootPath: '/mnt/astro', enabled: true }]);
    // Catch-up scan is in flight (never completed).
    expect(h.enqueueScan).toHaveBeenCalledOnce();
    const watcher = latestWatcher(h, '/mnt/astro');

    h.manager.stop('wf-1');

    expect(watcher.closeCalls).toBe(1);

    // A pending debounce timer that would have fired must not fire post-stop.
    h.enqueueScan.mockClear();
    vi.advanceTimersByTime(1_000_000);
    expect(h.enqueueScan).not.toHaveBeenCalled();
  });

  it('stopAll() closes every watcher and clears every timer', async () => {
    const h = makeHarness();
    h.manager.start([
      { id: 'wf-1', rootPath: '/mnt/astro', enabled: true },
      { id: 'wf-2', rootPath: '/mnt/other', enabled: true },
    ]);
    const w1 = latestWatcher(h, '/mnt/astro');
    const w2 = latestWatcher(h, '/mnt/other');

    await h.manager.stopAll();

    expect(w1.closeCalls).toBe(1);
    expect(w2.closeCalls).toBe(1);

    h.enqueueScan.mockClear();
    vi.advanceTimersByTime(1_000_000);
    expect(h.enqueueScan).not.toHaveBeenCalled();
  });
});

describe('setEnabled(id, false) / re-enable', () => {
  it('reports mode "off" and stops firing scans while disabled, then resumes on re-enable', () => {
    const h = makeHarness();
    h.manager.start([{ id: 'wf-1', rootPath: '/mnt/astro', enabled: true }]);
    completeLastScan(h, 'wf-1');
    h.statusEvents.length = 0;
    h.enqueueScan.mockClear();

    h.manager.setEnabled('wf-1', false);
    expect(h.statusEvents.at(-1)?.mode).toBe('off');

    vi.advanceTimersByTime(1_000_000);
    expect(h.enqueueScan).not.toHaveBeenCalled();

    h.manager.setEnabled('wf-1', true);
    expect(h.enqueueScan).toHaveBeenCalledOnce(); // fresh catch-up scan
    expect(h.statusEvents.at(-1)?.mode).toBe('watching');
  });
});

describe('mode transitions stamp updatedAt with new Date()', () => {
  it('uses the current (fake) system time for every transition', () => {
    vi.setSystemTime(new Date('2026-07-22T10:00:00.000Z'));
    const h = makeHarness();
    h.manager.start([{ id: 'wf-1', rootPath: '/mnt/astro', enabled: true }]);

    expect(h.statusEvents).toHaveLength(1);
    expect(h.statusEvents[0]?.updatedAt).toBe('2026-07-22T10:00:00.000Z');

    vi.setSystemTime(new Date('2026-07-22T10:05:00.000Z'));
    const watcher = latestWatcher(h, '/mnt/astro');
    watcher.emit('error', Object.assign(new Error('x'), { code: 'EMFILE' }));

    expect(h.statusEvents.at(-1)?.updatedAt).toBe('2026-07-22T10:05:00.000Z');
  });
});
