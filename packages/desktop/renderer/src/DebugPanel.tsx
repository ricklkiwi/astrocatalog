import { useEffect, useState } from 'react';

import type { JobProgressEvent, WatchActivityEvent, WatchStatusEvent } from '@astrotracker/desktop';

import { ipc } from './ipc';

/** Ring-buffer cap — a debug log, not a persisted audit trail. */
const MAX_ENTRIES = 300;

interface LogEntry {
  key: string;
  timestamp: string;
  text: string;
}

let nextKey = 0;

function shortId(id: string): string {
  return id.slice(0, 8);
}

function formatTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    return isoTimestamp;
  }
  return date.toLocaleTimeString(undefined, { hour12: false });
}

function activityText(event: WatchActivityEvent): string {
  return `[watch ${shortId(event.watchFolderId)}] ${event.detail}`;
}

function statusText(event: WatchStatusEvent): string {
  const suffix = event.message !== null ? `: ${event.message}` : '';
  return `[watch ${shortId(event.watchFolderId)}] status → ${event.mode}${suffix}`;
}

function jobText(event: JobProgressEvent): string {
  const progress =
    event.progressTotal !== null
      ? `${event.progressCurrent}/${event.progressTotal}`
      : `${event.progressCurrent}`;
  const suffix = event.message !== null ? ` — ${event.message}` : '';
  return `[job ${shortId(event.id)}] ${event.status} (${progress})${suffix}`;
}

function pushEntry(text: string, timestamp: string): (current: LogEntry[]) => LogEntry[] {
  nextKey += 1;
  const entry: LogEntry = { key: `entry-${nextKey}`, timestamp, text };
  return (current) => [entry, ...current].slice(0, MAX_ENTRIES);
}

/**
 * A live activity log for the watch-folder pipeline (debug aid): every raw
 * fs event, debounce (re)arm, scan request/deferral, and watcher error from
 * `watch.activity`, every live-watch mode transition from `watch.status`, and
 * every scan-job progress update from `jobs.progress` — the same three event
 * streams other panels consume, unified into one newest-first scrolling log
 * so "what is the app doing right now" is answerable without cross-referencing
 * separate UI. Collapsed by default; subscribes regardless of visibility so
 * toggling it open never loses activity that happened while it was closed.
 */
export function DebugPanel() {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<LogEntry[]>([]);

  useEffect(() => {
    return ipc.on('watch.activity', (event) => {
      setEntries(pushEntry(activityText(event), event.timestamp));
    });
  }, []);

  useEffect(() => {
    return ipc.on('watch.status', (event) => {
      setEntries(pushEntry(statusText(event), event.updatedAt));
    });
  }, []);

  useEffect(() => {
    return ipc.on('jobs.progress', (event) => {
      setEntries(pushEntry(jobText(event), new Date().toISOString()));
    });
  }, []);

  return (
    <section aria-labelledby="debug-panel-heading">
      <h2 id="debug-panel-heading">Debug panel</h2>
      <button type="button" onClick={() => setOpen((current) => !current)}>
        {open ? 'Hide debug panel' : 'Show debug panel'}
      </button>
      {open && (
        <>
          <button type="button" onClick={() => setEntries([])} disabled={entries.length === 0}>
            Clear
          </button>
          {entries.length === 0 ? (
            <p>No activity yet — drop a file into a watched folder or run a scan to see it here.</p>
          ) : (
            <ul aria-live="polite" aria-label="Watch and scan activity log">
              {entries.map((entry) => (
                <li key={entry.key}>
                  <code>
                    {formatTime(entry.timestamp)} {entry.text}
                  </code>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
