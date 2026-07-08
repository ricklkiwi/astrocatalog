import { sql } from 'drizzle-orm';

import type { DrizzleDb } from './shared.js';

/** One FTS5 hit. `entityType` discriminates the four indexed source tables. */
export interface SearchHit {
  entityType: 'target' | 'target_alias' | 'session' | 'project';
  entityId: string;
  title: string;
  snippet: string;
}

export interface SearchRepository {
  /**
   * FTS5 MATCH query (supports prefix syntax like `androm*`). The index is
   * maintained entirely by the migration-0001 triggers — no application
   * code writes to `search_fts`.
   */
  query(text: string): SearchHit[];
}

export function createSearchRepository(db: DrizzleDb): SearchRepository {
  return {
    query(text: string): SearchHit[] {
      // Raw SQL per DD-003/DD-001: `search_fts` is an FTS5 virtual table
      // managed outside the Drizzle schema (see drizzle/0001_fts5_search.sql).
      return db.all<SearchHit>(sql`
        SELECT
          entity_type AS entityType,
          entity_id AS entityId,
          title,
          snippet(search_fts, -1, '', '', '…', 12) AS snippet
        FROM search_fts
        WHERE search_fts MATCH ${text}
        ORDER BY rank
      `);
    },
  };
}
