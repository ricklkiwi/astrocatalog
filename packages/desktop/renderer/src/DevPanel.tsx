import { useState } from 'react';

import { useQuery } from '@tanstack/react-query';

import { DebugPanel } from './DebugPanel';
import { ipc } from './ipc';
import { JobDemo } from './JobDemo';
import { WatchFolders } from './WatchFolders';

/**
 * TEMPORARY SCAFFOLDING (P1-13a): bundles the pre-shell debug/dev widgets —
 * version info, JobDemo, WatchFolders, DebugPanel (#95) — so they stay
 * reachable now that the DD-008 shell has replaced the old single-screen
 * renderer. This is not a committed product surface: a later issue may
 * retire, relocate, or split up any part of it without that being a
 * breaking change to plan around. Do not add new functionality here on the
 * assumption DevPanel itself is permanent.
 */
export function DevPanel() {
  const [open, setOpen] = useState(false);
  const { data, error, isPending } = useQuery({
    queryKey: ['app.version'],
    queryFn: () => ipc.invoke('app.version'),
  });

  const rows: Array<[label: string, value: string]> | undefined =
    data === undefined
      ? undefined
      : [
          ['App', data.appVersion],
          ['Electron', data.electronVersion],
          ['Chrome', data.chromeVersion],
          ['Node', data.nodeVersion],
          ['Platform', data.platform],
          ['SQLite', data.sqliteVersion],
          ['sharp', data.sharpVersion],
        ];

  return (
    <section aria-labelledby="dev-panel-heading">
      <h2 id="dev-panel-heading">Developer tools</h2>
      <button type="button" onClick={() => setOpen((current) => !current)}>
        {open ? 'Hide developer tools' : 'Show developer tools'}
      </button>
      {open && (
        <>
          {isPending && <p>Loading version info…</p>}
          {!isPending && error && <p role="alert">Failed to load version info: {String(error)}</p>}
          {!isPending && !error && rows !== undefined && (
            <>
              <p>Versions reported by the main process over typed IPC:</p>
              <dl>
                {rows.map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <JobDemo />
              <WatchFolders />
              <DebugPanel />
            </>
          )}
        </>
      )}
    </section>
  );
}
