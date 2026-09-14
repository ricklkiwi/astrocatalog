import { useEffect, useState } from 'react';

import type { JobProgressEvent, JobSummary } from '@astrotracker/desktop';

import { ipc } from '../ipc';
import styles from './GlobalScanProgress.module.css';

type ActiveJob = JobSummary | JobProgressEvent;

function isActiveStatus(status: string): boolean {
  return status === 'queued' || status === 'running';
}

function progressLabel(job: ActiveJob): string {
  if (job.progressTotal === null) {
    return 'Working…';
  }
  return `Scanning… ${job.progressCurrent}/${job.progressTotal}`;
}

/**
 * Header-region aggregate scan/job indicator (DD-008: "Long operations
 * surface as a global progress indicator … UI never blocks"). On mount,
 * seeds from `jobs.list` so a reload mid-scan still shows progress
 * immediately, then subscribes to `jobs.progress` for live updates. Renders
 * nothing when no job is queued/running. Reuses the pre-existing
 * `jobs.list`/`jobs.progress` IPC channels verbatim via the shared `ipc`
 * wrapper — no new contract surface, no direct `window.astrotracker` access.
 *
 * Deliberately an aggregate indicator (one job's worth of state at a time),
 * not a per-pipeline-stage breakdown — see the plan's Out of Scope.
 */
export function GlobalScanProgress() {
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);

  useEffect(() => {
    let cancelled = false;
    void ipc.invoke('jobs.list').then((jobs) => {
      if (cancelled) {
        return;
      }
      const inFlight = jobs.find((job) => isActiveStatus(job.status));
      if (inFlight !== undefined) {
        setActiveJob(inFlight);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return ipc.on('jobs.progress', (event) => {
      setActiveJob(isActiveStatus(event.status) ? event : null);
    });
  }, []);

  if (activeJob === null) {
    return null;
  }

  return (
    <div className={styles.progress} aria-live="polite">
      {progressLabel(activeJob)}
    </div>
  );
}
