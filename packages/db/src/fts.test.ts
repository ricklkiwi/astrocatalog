import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase, type AstroDatabase } from './index.js';

let tempDir: string;
let filePath: string;
let db: AstroDatabase;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'astrotracker-fts-'));
  filePath = join(tempDir, 'catalog.db');
  db = openDatabase({ filePath });
});

afterEach(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

/** Read raw search_fts rows for one entity via a second connection. */
function ftsRowsFor(entityId: string): Array<{ title: string; body: string }> {
  const raw = new Database(filePath, { readonly: true });
  try {
    return raw
      .prepare('SELECT title, body FROM search_fts WHERE entity_id = ?')
      .all(entityId) as Array<{ title: string; body: string }>;
  } finally {
    raw.close();
  }
}

describe('trigger-maintained FTS5 search (no application-level FTS writes)', () => {
  it('indexes targets, aliases, sessions, and projects on insert', () => {
    const { repos } = db;
    const target = repos.targets.insert({
      canonicalName: 'M 31',
      displayName: 'Andromeda Galaxy',
    });
    const alias = repos.targets.insertAlias({
      targetId: target.id,
      aliasNormalized: 'NGC 224',
      source: 'builtin',
    });
    const session = repos.sessions.insert({
      sessionDate: '2026-01-15',
      notes: 'Imaged Andromeda through thin cloud',
    });
    const project = repos.projects.insert({
      name: 'Widefield mosaic',
      notes: 'Andromeda panel 3 of 4',
    });

    const prefixHits = repos.search.query('androm*');
    const byId = new Map(prefixHits.map((hit) => [hit.entityId, hit]));
    expect(byId.get(target.id)?.entityType).toBe('target');
    expect(byId.get(session.id)?.entityType).toBe('session');
    expect(byId.get(project.id)?.entityType).toBe('project');

    const aliasHits = repos.search.query('ngc');
    expect(aliasHits.map((hit) => hit.entityId)).toContain(alias.id);
    expect(aliasHits.find((hit) => hit.entityId === alias.id)?.entityType).toBe('target_alias');

    for (const hit of [...prefixHits, ...aliasHits]) {
      expect(typeof hit.title).toBe('string');
      expect(typeof hit.snippet).toBe('string');
      expect(hit.title.length).toBeGreaterThan(0);
    }
  });

  it('reflects display_name updates without any application FTS call', () => {
    const target = db.repos.targets.insert({
      canonicalName: 'M 31',
      displayName: 'Andromeda Galaxy',
    });
    expect(db.repos.search.query('androm*').map((h) => h.entityId)).toContain(target.id);

    db.repos.targets.update(target.id, { displayName: 'Great Spiral' });

    expect(db.repos.search.query('androm*').map((h) => h.entityId)).not.toContain(target.id);
    const renamed = db.repos.search.query('spiral');
    expect(renamed.map((h) => h.entityId)).toContain(target.id);
    expect(renamed.find((h) => h.entityId === target.id)?.title).toBe('M 31 Great Spiral');
  });

  it('drops an alias’s hit when the alias row is deleted', () => {
    const target = db.repos.targets.insert({ canonicalName: 'M 31' });
    const alias = db.repos.targets.insertAlias({
      targetId: target.id,
      aliasNormalized: 'NGC 224',
      source: 'builtin',
    });
    expect(db.repos.search.query('ngc').map((h) => h.entityId)).toContain(alias.id);

    // Explicit delete through a raw connection — the trigger, not app code,
    // must clean up the FTS row.
    const raw = new Database(filePath);
    try {
      raw.prepare('DELETE FROM target_aliases WHERE id = ?').run(alias.id);
    } finally {
      raw.close();
    }

    expect(db.repos.search.query('ngc')).toHaveLength(0);
  });

  it('never indexes literal "null" across NULL → text → NULL notes transitions', () => {
    const target = db.repos.targets.insert({ canonicalName: 'M 31', notes: null });

    let rows = ftsRowsFor(target.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.title).toBe('M 31');
    expect(rows[0]?.body).toBe('');

    db.repos.targets.update(target.id, { notes: 'Needs more luminance' });
    rows = ftsRowsFor(target.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toBe('Needs more luminance');

    db.repos.targets.update(target.id, { notes: null });
    rows = ftsRowsFor(target.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toBe('');
    expect(rows[0]?.body).not.toContain('null');
    // Title-only content still indexes while notes is NULL.
    expect(db.repos.search.query('m').map((h) => h.entityId)).toContain(target.id);
    expect(db.repos.search.query('null')).toHaveLength(0);
  });

  it('cascade-deleting a target removes its aliases’ FTS rows via triggers', () => {
    const target = db.repos.targets.insert({ canonicalName: 'M 31' });
    const alias = db.repos.targets.insertAlias({
      targetId: target.id,
      aliasNormalized: 'NGC 224',
      source: 'builtin',
    });

    const raw = new Database(filePath);
    try {
      raw.pragma('foreign_keys = ON');
      raw.prepare('DELETE FROM targets WHERE id = ?').run(target.id);
    } finally {
      raw.close();
    }

    expect(ftsRowsFor(target.id)).toHaveLength(0);
    expect(ftsRowsFor(alias.id)).toHaveLength(0);
  });
});
