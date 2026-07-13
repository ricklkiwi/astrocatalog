import { useEffect, useState } from 'react';

import type { JobProgressEvent } from '@astrotracker/desktop';

import { ipc } from './ipc';

export function JobDemo() {
  const [jobId, setJobId] = useState<string | null>(null);
  const [event, setEvent] = useState<JobProgressEvent | null>(null);

  useEffect(() => {
    return ipc.on('jobs.progress', (next) => {
      setEvent((current) => {
        if (jobId === null || next.id === jobId) {
          return next;
        }
        return current;
      });
    });
  }, [jobId]);

  const progress =
    event?.progressTotal === null || event?.progressTotal === 0 || event === null
      ? null
      : Math.round((event.progressCurrent / event.progressTotal) * 100);

  return (
    <section aria-labelledby="job-demo-heading">
      <h2 id="job-demo-heading">Worker demo</h2>
      <button
        type="button"
        onClick={() => {
          void ipc.invoke('jobs.enqueueDemo').then(({ jobId: nextJobId }) => {
            setJobId(nextJobId);
            setEvent(null);
          });
        }}
      >
        Start demo job
      </button>
      <button
        type="button"
        disabled={jobId === null}
        onClick={() => {
          if (jobId !== null) {
            void ipc.invoke('jobs.cancel', { jobId });
          }
        }}
      >
        Cancel
      </button>
      <p aria-live="polite">
        {event === null
          ? 'No job running'
          : `${event.status}: ${progress === null ? 'working' : `${progress}%`}`}
      </p>
      <progress
        aria-label="Demo job progress"
        value={progress === null ? undefined : event?.progressCurrent}
        max={progress === null ? undefined : (event?.progressTotal ?? undefined)}
      />
    </section>
  );
}
