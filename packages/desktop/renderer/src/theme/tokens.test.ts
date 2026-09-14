import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Parses `tokens.css` as text and resolves the effective custom-property map
 * per theme (base `.app-root` declarations, overridden by the matching
 * `[data-theme='…']` block where one exists). Asserting on these resolved
 * maps — never on raw file text — means declaration order/formatting
 * changes can't cause a false failure (Test Hints).
 */
type TokenMap = Record<string, string>;

// `path.join` off this file's own directory, not `new URL('./tokens.css',
// import.meta.url)` — Vite statically pattern-matches that literal-argument
// form as an asset-URL reference and rewrites it, which breaks under vitest
// (`TypeError: The URL must be of scheme file`) precisely because `.css` is
// one of the extensions its asset pipeline claims.
const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const TOKENS_CSS_PATH = path.join(THIS_DIR, 'tokens.css');

function readTokensCss(): string {
  return readFileSync(TOKENS_CSS_PATH, 'utf8').replace(/\r\n/g, '\n');
}

function extractBlock(css: string, selectorText: string): string {
  const selectorStart = css.indexOf(selectorText);
  if (selectorStart === -1) {
    throw new Error(`Selector not found in tokens.css: ${selectorText}`);
  }
  const braceStart = css.indexOf('{', selectorStart);
  const braceEnd = css.indexOf('}', braceStart);
  if (braceStart === -1 || braceEnd === -1) {
    throw new Error(`Malformed rule block for selector: ${selectorText}`);
  }
  return css.slice(braceStart + 1, braceEnd);
}

function parseDeclarations(block: string): TokenMap {
  const withoutComments = block.replace(/\/\*[\s\S]*?\*\//g, '');
  const map: TokenMap = {};
  const declarationPattern = /(--[a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = declarationPattern.exec(withoutComments)) !== null) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) {
      map[name] = value.trim();
    }
  }
  return map;
}

function sortedKeys(map: TokenMap): string[] {
  return Object.keys(map).sort();
}

function filterKeys(map: TokenMap): string[] {
  return sortedKeys(map).filter((key) => key.startsWith('--filter-'));
}

interface ResolvedThemes {
  base: TokenMap;
  dark: TokenMap;
  light: TokenMap;
  redNightVision: TokenMap;
}

function resolveThemes(): ResolvedThemes {
  const css = readTokensCss();
  const base = parseDeclarations(extractBlock(css, '.app-root {'));
  const lightOverrides = parseDeclarations(extractBlock(css, ".app-root[data-theme='light'] {"));
  const redOverrides = parseDeclarations(
    extractBlock(css, ".app-root[data-theme='red-night-vision'] {"),
  );
  return {
    base,
    dark: { ...base },
    light: { ...base, ...lightOverrides },
    redNightVision: { ...base, ...redOverrides },
  };
}

const EXPECTED_FILTER_TOKENS = [
  '--filter-b',
  '--filter-g',
  '--filter-ha',
  '--filter-l',
  '--filter-oiii',
  '--filter-r',
  '--filter-sii',
  '--filter-unknown',
].sort();

describe('theme tokens', () => {
  it('TOK-2: dark, light, and red-night-vision resolve to an identical key set', () => {
    const { dark, light, redNightVision } = resolveThemes();
    expect(sortedKeys(light)).toEqual(sortedKeys(dark));
    expect(sortedKeys(redNightVision)).toEqual(sortedKeys(dark));
  });

  it('TOK-3: the filter-token key set is exactly the eight expected names', () => {
    const { base } = resolveThemes();
    expect(filterKeys(base)).toEqual(EXPECTED_FILTER_TOKENS);
  });

  it('TOK-4: every --filter-* value is identical between dark and light', () => {
    const { dark, light } = resolveThemes();
    for (const key of filterKeys(dark)) {
      expect(light[key]).toBe(dark[key]);
    }
  });

  it('TOK-5: every --filter-* value differs under red-night-vision from dark', () => {
    const { dark, redNightVision } = resolveThemes();
    for (const key of filterKeys(dark)) {
      expect(redNightVision[key]).not.toBe(dark[key]);
    }
  });

  it('TOK-6: --color-bg and --color-text are pairwise distinct across all three themes', () => {
    const { dark, light, redNightVision } = resolveThemes();
    for (const key of ['--color-bg', '--color-text']) {
      expect(dark[key]).not.toBe(light[key]);
      expect(dark[key]).not.toBe(redNightVision[key]);
      expect(light[key]).not.toBe(redNightVision[key]);
    }
  });

  it('TOK-7: each resolved theme map matches a committed snapshot', () => {
    const { dark, light, redNightVision } = resolveThemes();
    expect(dark).toMatchSnapshot('dark');
    expect(light).toMatchSnapshot('light');
    expect(redNightVision).toMatchSnapshot('red-night-vision');
  });

  it('TOK-8: no selector in tokens.css targets :root, html, or body', () => {
    const css = readTokensCss();
    const lines = css.split('\n');
    const offendingSelectors = lines.filter((line) => /^\s*(:root|html|body)\b/.test(line));
    expect(offendingSelectors).toEqual([]);
  });
});
