import { useQuery } from '@tanstack/react-query';

import { ipc } from './ipc';
import { JobDemo } from './JobDemo';

/**
 * The P0-03 renderer is a single version screen: it fetches `app.version`
 * over the typed IPC bridge (TanStack Query per DD-002) and renders every
 * field — the visible proof of the renderer → preload → main round trip.
 */
export function App() {
  const { data, error, isPending } = useQuery({
    queryKey: ['app.version'],
    queryFn: () => ipc.invoke('app.version'),
  });

  if (isPending) {
    return <p>Loading version info…</p>;
  }
  if (error) {
    return <p role="alert">Failed to load version info: {String(error)}</p>;
  }

  const rows: Array<[label: string, value: string]> = [
    ['App', data.appVersion],
    ['Electron', data.electronVersion],
    ['Chrome', data.chromeVersion],
    ['Node', data.nodeVersion],
    ['Platform', data.platform],
    ['SQLite', data.sqliteVersion],
    ['sharp', data.sharpVersion],
  ];

  return (
    <main>
      <h1>AstroTracker</h1>
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
    </main>
  );
}
