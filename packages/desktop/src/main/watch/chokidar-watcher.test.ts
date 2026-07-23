import { describe, expect, it } from 'vitest';

import { createIgnoredPredicate } from './chokidar-watcher.js';

describe('createIgnoredPredicate', () => {
  it('does not ignore a supported extension under a non-skipped directory', () => {
    const ignored = createIgnoredPredicate();
    expect(ignored('/mnt/astro/2026-01-15/Light_M31_L_300s_001.fits')).toBe(false);
    expect(ignored('/mnt/astro/2026-01-15/Light_M31_L_300s_002.CR2')).toBe(false);
  });

  it('does not ignore a plain directory path (no extension)', () => {
    const ignored = createIgnoredPredicate();
    expect(ignored('/mnt/astro/2026-01-15')).toBe(false);
  });

  it('ignores a dotfile anywhere in the path', () => {
    const ignored = createIgnoredPredicate();
    expect(ignored('/mnt/astro/.DS_Store')).toBe(true);
    expect(ignored('/mnt/astro/.git/config')).toBe(true);
  });

  it('ignores a node_modules entry', () => {
    const ignored = createIgnoredPredicate();
    expect(ignored('/mnt/astro/node_modules')).toBe(true);
    expect(ignored('/mnt/astro/node_modules/pkg/index.js')).toBe(true);
  });

  it('ignores an unsupported extension', () => {
    const ignored = createIgnoredPredicate();
    expect(ignored('/mnt/astro/notes.txt')).toBe(true);
    expect(ignored('/mnt/astro/readme.md')).toBe(true);
  });

  it('ignores a path matching a configured skipPattern', () => {
    const ignored = createIgnoredPredicate(['@eaDir', '$RECYCLE.BIN']);
    expect(ignored('/mnt/astro/@eaDir/thumb.fits')).toBe(true);
    expect(ignored('/mnt/astro/$RECYCLE.BIN/light.fits')).toBe(true);
    // Case-insensitive, matching scan-job.ts's basename comparison.
    expect(ignored('/mnt/astro/@EADIR/thumb.fits')).toBe(true);
  });

  it('does not ignore a file just because its directory name resembles a skip pattern substring', () => {
    const ignored = createIgnoredPredicate(['@eaDir']);
    // "@eaDirectory" is not an exact segment match for "@eaDir".
    expect(ignored('/mnt/astro/@eaDirectory/light.fits')).toBe(false);
  });
});
