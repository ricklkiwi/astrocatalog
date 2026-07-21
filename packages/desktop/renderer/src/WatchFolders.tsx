import { useEffect, useRef, useState } from 'react';

import type { JobProgressEvent, WatchFolderRecord } from '@astrotracker/desktop';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ipc } from './ipc';

const WATCH_FOLDERS_KEY = ['watchFolders.list'] as const;

function progressLabel(event: JobProgressEvent | undefined): string {
  if (event === undefined) {
    return 'No scan run yet';
  }
  if (event.progressTotal === null || event.progressTotal === 0) {
    return `${event.status}: working`;
  }
  const percent = Math.round((event.progressCurrent / event.progressTotal) * 100);
  return `${event.status}: ${percent}%`;
}

/**
 * P1-06 watch-folder settings: list the configured folders, add one by
 * absolute path, remove a folder, and trigger a scan whose live progress is
 * shown per row (reusing the generic `jobs.progress` event stream).
 */
export function WatchFolders() {
  const queryClient = useQueryClient();
  const [pathInput, setPathInput] = useState('');
  const [addError, setAddError] = useState<string | null>(null);

  // Latest scan-progress event keyed by watch-folder id.
  const [scanEvents, setScanEvents] = useState<Record<string, JobProgressEvent>>({});
  // jobId → watchFolderId, read inside the (stable) progress listener without stale closures.
  const folderByJob = useRef<Map<string, string>>(new Map());

  const {
    data: folders,
    error,
    isPending,
  } = useQuery({
    queryKey: WATCH_FOLDERS_KEY,
    queryFn: () => ipc.invoke('watchFolders.list').then((result) => result.watchFolders),
  });

  useEffect(() => {
    return ipc.on('jobs.progress', (event) => {
      const folderId = folderByJob.current.get(event.id);
      if (folderId === undefined) {
        return;
      }
      setScanEvents((current) => ({ ...current, [folderId]: event }));
    });
  }, []);

  const addMutation = useMutation({
    mutationFn: (path: string) => ipc.invoke('watchFolders.add', { path }),
    onSuccess: async () => {
      setPathInput('');
      setAddError(null);
      await queryClient.invalidateQueries({ queryKey: WATCH_FOLDERS_KEY });
    },
    onError: (mutationError: unknown) => {
      setAddError(mutationError instanceof Error ? mutationError.message : String(mutationError));
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => ipc.invoke('watchFolders.remove', { id }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: WATCH_FOLDERS_KEY });
    },
  });

  function handleScan(folder: WatchFolderRecord) {
    void ipc.invoke('jobs.enqueueScan', { watchFolderId: folder.id }).then(({ jobId }) => {
      folderByJob.current.set(jobId, folder.id);
      setScanEvents((current) => {
        const next = { ...current };
        delete next[folder.id];
        return next;
      });
    });
  }

  return (
    <section aria-labelledby="watch-folders-heading">
      <h2 id="watch-folders-heading">Watch folders</h2>

      <form
        onSubmit={(submitEvent) => {
          submitEvent.preventDefault();
          const trimmed = pathInput.trim();
          if (trimmed !== '') {
            addMutation.mutate(trimmed);
          }
        }}
      >
        <label htmlFor="watch-folder-path">Folder path</label>
        <input
          id="watch-folder-path"
          type="text"
          value={pathInput}
          placeholder="/absolute/path/to/folder"
          onChange={(changeEvent) => setPathInput(changeEvent.target.value)}
        />
        <button type="submit" disabled={addMutation.isPending || pathInput.trim() === ''}>
          Add folder
        </button>
      </form>
      {addError !== null && (
        <p role="alert" aria-live="assertive">
          Failed to add folder: {addError}
        </p>
      )}

      {isPending ? (
        <p>Loading watch folders…</p>
      ) : error ? (
        <p role="alert">Failed to load watch folders: {String(error)}</p>
      ) : folders.length === 0 ? (
        <p>No watch folders configured yet.</p>
      ) : (
        <ul>
          {folders.map((folder) => (
            <li key={folder.id}>
              <span>{folder.path}</span>
              {folder.driveLabel !== null && <span> ({folder.driveLabel})</span>}
              <button type="button" onClick={() => handleScan(folder)}>
                Scan now
              </button>
              <button
                type="button"
                onClick={() => removeMutation.mutate(folder.id)}
                disabled={removeMutation.isPending}
              >
                Remove
              </button>
              <span aria-live="polite">{progressLabel(scanEvents[folder.id])}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
