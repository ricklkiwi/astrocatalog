/**
 * The demo job's step logic (P0-05 plan Step 3) — plain async function with
 * an injected `ctx`, so it's unit-testable directly with no real
 * `worker_threads` instance. `worker-entry.ts` is the only caller in
 * production, wiring `ctx` to real `postMessage` calls and a `cancelled` flag
 * flipped by an incoming `CancelMessage`.
 *
 * No fs, no `@astrotracker/db`, no Electron import here (DD-002 Default 3):
 * this file is pure compute plus the injected callback context.
 */
import type { DemoJobPayload } from './protocol.js';

export type { DemoJobPayload };

export interface JobContext {
  /** Report progress after a completed step. `total` is `null` for indeterminate progress. */
  reportProgress(current: number, total: number | null, message: string | null): void;
  /**
   * Checked once per step (plan Default 6 — cooperative, not preemptive
   * mid-sleep): after a step finishes and its progress is reported, before
   * starting the next one.
   */
  isCancelled(): boolean;
}

const DEFAULT_TOTAL_STEPS = 10;
const DEFAULT_STEP_MS = 500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sleeps through `payload.totalSteps` steps of `payload.stepMs` each,
 * reporting progress after every step. Honors `payload.resumeFrom` by
 * skipping already-completed steps, so a resumed run reports only its
 * remaining progress (never restarting the sequence from 0).
 */
export async function runDemoJob(payload: DemoJobPayload, ctx: JobContext): Promise<void> {
  const totalSteps = payload.totalSteps ?? DEFAULT_TOTAL_STEPS;
  const stepMs = payload.stepMs ?? DEFAULT_STEP_MS;
  const resumeFrom = payload.resumeFrom ?? 0;

  for (let step = resumeFrom + 1; step <= totalSteps; step += 1) {
    await sleep(stepMs);
    ctx.reportProgress(step, totalSteps, `step ${step}/${totalSteps}`);
    if (ctx.isCancelled()) {
      return;
    }
  }
}
