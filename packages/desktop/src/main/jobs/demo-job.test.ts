import { describe, expect, it, vi } from 'vitest';

import { runDemoJob, type JobContext } from './demo-job.js';

function recordingContext(isCancelled: () => boolean = () => false) {
  const calls: Array<{ current: number; total: number | null; message: string | null }> = [];
  const ctx: JobContext = {
    reportProgress: (current, total, message) => {
      calls.push({ current, total, message });
    },
    // Demo jobs never discover files; a no-op keeps the fake ctx conformant.
    reportDiscovered: () => {},
    isCancelled,
  };
  return { ctx, calls };
}

describe('runDemoJob', () => {
  it('reports progress once per step, current 1..totalSteps', async () => {
    const { ctx, calls } = recordingContext();

    await runDemoJob({ totalSteps: 5, stepMs: 1 }, ctx);

    expect(calls).toHaveLength(5);
    expect(calls.map((c) => c.current)).toEqual([1, 2, 3, 4, 5]);
    expect(calls.every((c) => c.total === 5)).toBe(true);
  });

  it('honors resumeFrom, reporting only remaining steps', async () => {
    const { ctx, calls } = recordingContext();

    await runDemoJob({ totalSteps: 5, stepMs: 1, resumeFrom: 3 }, ctx);

    expect(calls.map((c) => c.current)).toEqual([4, 5]);
  });

  it('exits early once ctx.isCancelled() trips, after reporting the tripping step', async () => {
    let callCount = 0;
    const { ctx, calls } = recordingContext(() => {
      callCount += 1;
      return callCount >= 2;
    });

    await runDemoJob({ totalSteps: 10, stepMs: 1 }, ctx);

    expect(calls.map((c) => c.current)).toEqual([1, 2]);
  });

  it('applies default totalSteps=10 and stepMs=500 when omitted', async () => {
    vi.useFakeTimers();
    try {
      const { ctx, calls } = recordingContext();
      const done = runDemoJob({}, ctx);
      // Advance through all 10 default-500ms steps.
      for (let i = 0; i < 10; i += 1) {
        await vi.advanceTimersByTimeAsync(500);
      }
      await done;
      expect(calls).toHaveLength(10);
      expect(calls[9]).toEqual({ current: 10, total: 10, message: 'step 10/10' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports no progress when resumeFrom already equals totalSteps', async () => {
    const { ctx, calls } = recordingContext();

    await runDemoJob({ totalSteps: 3, stepMs: 1, resumeFrom: 3 }, ctx);

    expect(calls).toHaveLength(0);
  });
});
