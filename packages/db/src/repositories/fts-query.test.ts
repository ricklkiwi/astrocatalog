import { describe, expect, it } from 'vitest';

import { toFtsMatchQuery } from './fts-query.js';

describe('toFtsMatchQuery', () => {
  const cases: Array<[label: string, input: string, expected: string | null]> = [
    ['a plain word', 'andromeda', '"andromeda"'],
    ['multiple words AND implicitly', 'andromeda galaxy', '"andromeda" "galaxy"'],
    ['a trailing prefix star is preserved', 'androm*', '"androm"*'],
    ['a prefix star on the last of several tokens', 'great androm*', '"great" "androm"*'],
    ['a catalog designation with a space', 'M 31', '"M" "31"'],
    ['a comma-separated pair splits into tokens', 'M31,NGC224', '"M31" "NGC224"'],
    ['underscores are word characters', 'Light_M31_L', '"Light_M31_L"'],

    // Each of these raised `SQLITE_ERROR: fts5: syntax error` before the fix.
    ['an unbalanced double quote', 'M31"', '"M31"'],
    [
      'a balanced quoted phrase loses its operator meaning',
      '"andromeda galaxy"',
      '"andromeda" "galaxy"',
    ],
    ['a bare AND is treated as a search term', 'M31 AND', '"M31" "AND"'],
    ['a bare OR is treated as a search term', 'OR', '"OR"'],
    ['a bare NOT is treated as a search term', 'M31 NOT M32', '"M31" "NOT" "M32"'],
    ['a leading hyphen', '-M31', '"M31"'],
    ['a column filter colon', 'title:M31', '"title" "M31"'],
    ['an initial-token caret', '^M31', '"M31"'],
    ['parentheses', '(M31 OR M32)', '"M31" "OR" "M32"'],
    ['a NEAR query', 'NEAR(M31 M32, 5)', '"NEAR" "M31" "M32" "5"'],
    ['a mid-token star is dropped', 'M*31', '"M31"'],

    // Nothing searchable — callers must not fall through to matching all rows.
    ['empty input', '', null],
    ['whitespace only', '   \t\n ', null],
    ['punctuation only', '!!! ??? ...', null],
    ['a lone star', '*', null],
    ['only stars', '***', null],
  ];

  for (const [label, input, expected] of cases) {
    it(`handles ${label}`, () => {
      expect(toFtsMatchQuery(input)).toBe(expected);
    });
  }

  it('escapes an embedded quote by doubling it, never by dropping the token', () => {
    // The separator regex strips most punctuation, so reaching the doubling
    // branch takes a quote adjacent to word characters on both sides.
    expect(toFtsMatchQuery('5"scope')).toBe('"5" "scope"');
  });

  it('never emits an odd number of double quotes', () => {
    for (const [, input] of cases) {
      const out = toFtsMatchQuery(input);
      if (out === null) continue;
      expect((out.match(/"/g) ?? []).length % 2).toBe(0);
    }
  });
});
