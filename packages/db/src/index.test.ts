import { readFileSync } from 'node:fs';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase, type AstroDatabase } from './index.js';

const REPO_NAMES = [
  'watchFolders',
  'files',
  'frames',
  'targets',
  'filters',
  'sessions',
  'equipmentProfiles',
  'masterFrames',
  'projects',
  'scanJobs',
  'settings',
  'search',
] as const;

let db: AstroDatabase;

beforeEach(() => {
  db = openDatabase({ filePath: ':memory:' });
});

afterEach(() => {
  db.close();
});

describe('public API surface', () => {
  it('exposes repos, transaction, and close on the AstroDatabase handle', () => {
    expect(Object.keys(db).sort()).toEqual(['close', 'repos', 'transaction']);
    expect(typeof db.transaction).toBe('function');
    expect(typeof db.close).toBe('function');
  });

  it('exposes one repository per aggregate', () => {
    expect(Object.keys(db.repos).sort()).toEqual([...REPO_NAMES].sort());
  });

  it('every repository exposes the skeleton CRUD surface', () => {
    for (const name of REPO_NAMES) {
      if (name === 'settings' || name === 'search') continue;
      const repo = db.repos[name];
      expect(typeof repo.insert, `${name}.insert`).toBe('function');
      expect(typeof repo.getById, `${name}.getById`).toBe('function');
      expect(typeof repo.list, `${name}.list`).toBe('function');
      expect(typeof repo.update, `${name}.update`).toBe('function');
    }
    expect(typeof db.repos.settings.get).toBe('function');
    expect(typeof db.repos.settings.set).toBe('function');
    expect(typeof db.repos.search.query).toBe('function');
  });

  it('settings.get/set round-trip JSON values keyed by name', () => {
    expect(db.repos.settings.get('ui.theme')).toBeUndefined();
    db.repos.settings.set('ui.theme', { mode: 'red-night', dim: 0.4 });
    expect(db.repos.settings.get('ui.theme')).toEqual({ mode: 'red-night', dim: 0.4 });
    db.repos.settings.set('ui.theme', 'dark');
    expect(db.repos.settings.get('ui.theme')).toBe('dark');
  });

  it('transaction hands the same repos object to the callback and returns its result', () => {
    const result = db.transaction((repos) => {
      expect(repos).toBe(db.repos);
      return 42;
    });
    expect(result).toBe(42);
  });

  it('transaction rolls back all writes when the callback throws', () => {
    expect(() =>
      db.transaction((repos) => {
        repos.watchFolders.insert({ path: '/mnt/astro' });
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(db.repos.watchFolders.list()).toHaveLength(0);
  });
});

describe('encapsulation (issue #4: no raw connection escapes)', () => {
  /** Collect every value reachable from `root` via own enumerable properties. */
  function reachableValues(root: unknown): unknown[] {
    const seen = new Set<unknown>();
    const queue: unknown[] = [root];
    const out: unknown[] = [];
    while (queue.length > 0) {
      const value = queue.pop();
      if (value === null || value === undefined) continue;
      if (typeof value !== 'object' && typeof value !== 'function') continue;
      if (seen.has(value)) continue;
      seen.add(value);
      out.push(value);
      for (const key of Object.keys(value as object)) {
        queue.push((value as Record<string, unknown>)[key]);
      }
    }
    return out;
  }

  it('no value reachable from AstroDatabase is a better-sqlite3 Database or Statement', () => {
    for (const value of reachableValues(db)) {
      const ctor = (value as { constructor?: { name?: string } }).constructor?.name ?? '';
      expect(ctor).not.toBe('Database');
      expect(ctor).not.toBe('Statement');
      // Drizzle handles wrap the connection too — they must not leak either.
      expect(ctor).not.toBe('BetterSQLite3Database');
    }
  });

  it('the public entry point never mentions the driver (no better-sqlite3 re-exports)', () => {
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('better-sqlite3');
  });
});
