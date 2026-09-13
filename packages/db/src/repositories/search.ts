import { sql } from 'drizzle-orm';

import { toFtsMatchQuery } from './fts-query.js';
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
   * Free-text search over the FTS5 index. `text` is raw user input: it is
   * normalized by {@link toFtsMatchQuery} into quoted tokens before it reaches
   * `MATCH`, so no character the user types can be parsed as FTS5 query syntax
   * and no input can raise a syntax error. Trailing `*` still means prefix
   * search (`androm*`).
   *
   * Returns `[]` for input with no searchable characters, rather than matching
   * everything. The index is maintained entirely by the migration-0001
   * triggers — no application code writes to `search_fts`.
   */
  query(text: string): SearchHit[];
}

export function createSearchRepository(db: DrizzleDb): SearchRepository {
  return {
    query(text: string): SearchHit[] {
      const match = toFtsMatchQuery(text);
      if (match === null) {
        return [];
      }
      // Raw SQL per DD-003/DD-001: `search_fts` is an FTS5 virtual table
      // managed outside the Drizzle schema (see drizzle/0001_fts5_search.sql).
      return db.all<SearchHit>(sql`
        SELECT
          entity_type AS entityType,
          entity_id AS entityId,
          title,
          snippet(search_fts, -1, '', '', '…', 12) AS snippet
        FROM search_fts
        WHERE search_fts MATCH ${match}
        ORDER BY rank
      `);
    },
  };
}
