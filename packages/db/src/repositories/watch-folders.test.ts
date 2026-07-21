import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase, type AstroDatabase } from '../index.js';

let db: AstroDatabase;

beforeEach(() => {
  db = openDatabase({ filePath: ':memory:' });
});

afterEach(() => {
  db.close();
});

describe('insert / list', () => {
  it('inserts a watch folder, stamping id and audit timestamps, and lists it back', () => {
    const folder = db.repos.watchFolders.insert({
      path: '/mnt/astro',
      driveLabel: 'External SSD',
      isActive: true,
      lastScanAt: null,
    });

    expect(folder.id).toBeTruthy();
    expect(folder.path).toBe('/mnt/astro');
    expect(folder.driveLabel).toBe('External SSD');
    expect(folder.isActive).toBe(true);
    expect(folder.createdAt).toBeInstanceOf(Date);
    expect(folder.updatedAt).toBeInstanceOf(Date);

    expect(db.repos.watchFolders.list().map((f) => f.id)).toEqual([folder.id]);
  });
});

describe('remove', () => {
  it('hard-deletes an existing row and reports true', () => {
    const folder = db.repos.watchFolders.insert({
      path: '/mnt/astro',
      driveLabel: null,
      isActive: true,
      lastScanAt: null,
    });

    const removed = db.repos.watchFolders.remove(folder.id);

    expect(removed).toBe(true);
    expect(db.repos.watchFolders.getById(folder.id)).toBeUndefined();
    expect(db.repos.watchFolders.list()).toHaveLength(0);
  });

  it('returns false for a non-existent id, without throwing', () => {
    expect(() =>
      db.repos.watchFolders.remove('01930000-0000-7000-8000-000000000000'),
    ).not.toThrow();
    expect(db.repos.watchFolders.remove('01930000-0000-7000-8000-000000000000')).toBe(false);
  });
});
