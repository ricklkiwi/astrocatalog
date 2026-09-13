/**
 * User text -> safe FTS5 MATCH expression.
 *
 * `search_fts MATCH ?` is parameterized, so this is not an injection surface —
 * but FTS5 parses the *bound value* as its own query language. Raw user input
 * therefore reaches a second parser that throws `SQLITE_ERROR: fts5: syntax
 * error near ...` on perfectly ordinary typing: an unbalanced quote, a
 * trailing `AND`, a bare `-`, a colon (read as a column filter), or `^`
 * (read as an initial-token match). Every one of those surfaces to the user as
 * a crash rather than "no results".
 *
 * The fix is to stop handing FTS5 an expression at all: every token is emitted
 * as a double-quoted string literal, which FTS5 treats as opaque text, so no
 * character inside it can act as an operator. The one piece of query syntax
 * worth keeping is the trailing `*` prefix search that the Targets page relies
 * on for type-ahead (`androm*`), and `"androm"*` is the documented, safe way
 * to spell it.
 */

/**
 * Characters FTS5 treats as bareword separators. Splitting on these (rather
 * than whitespace alone) means `M31,NGC224` becomes two tokens instead of one
 * unmatchable blob, and guarantees no separator survives into a quoted token.
 */
const TOKEN_SEPARATORS = /[^\p{L}\p{N}_*]+/u;

/** A `"` inside an FTS5 string literal is escaped by doubling it. */
function quote(token: string): string {
  return `"${token.replace(/"/g, '""')}"`;
}

/**
 * Convert free user text into an FTS5 MATCH expression that can never be a
 * syntax error.
 *
 * Tokens are AND-ed implicitly (FTS5's default), so multi-word input narrows
 * rather than widens. A token the user ended with `*` keeps prefix semantics;
 * `*` anywhere else is dropped, since FTS5 only supports trailing prefixes.
 *
 * Returns `null` when the input has no searchable characters at all (empty,
 * whitespace, or pure punctuation). Callers should treat `null` as "no query"
 * and skip the search rather than matching everything.
 */
export function toFtsMatchQuery(text: string): string | null {
  const tokens: string[] = [];
  for (const raw of text.split(TOKEN_SEPARATORS)) {
    if (raw === '') {
      continue;
    }
    // Trailing `*` is the one operator worth preserving (type-ahead). Strip
    // every other `*` — FTS5 rejects a prefix star anywhere else.
    const isPrefix = raw.endsWith('*');
    const bare = raw.replace(/\*/g, '');
    if (bare === '') {
      // The token was nothing but stars: `*` alone is not a valid query.
      continue;
    }
    tokens.push(isPrefix ? `${quote(bare)}*` : quote(bare));
  }
  return tokens.length === 0 ? null : tokens.join(' ');
}
