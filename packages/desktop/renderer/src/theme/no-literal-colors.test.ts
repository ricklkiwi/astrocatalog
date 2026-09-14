import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { COLOR_PROPERTIES, findLiteralColorViolations } from './no-literal-colors';

const KNOWN_BAD: Array<{ name: string; source: string; filename: string }> = [
  { name: 'hex 3-digit', source: 'color: #fff;', filename: 'Example.module.css' },
  { name: 'hex 6-digit', source: 'color: #ffffff;', filename: 'Example.module.css' },
  { name: 'hex 8-digit (alpha)', source: 'color: #ffffffcc;', filename: 'Example.module.css' },
  {
    name: 'rgb()',
    source: 'background: rgb(1,2,3);',
    filename: 'Example.module.css',
  },
  {
    name: 'rgba()',
    source: 'background-color: rgba(1,2,3,.5);',
    filename: 'Example.module.css',
  },
  {
    name: 'hsl() space syntax',
    source: 'border-color: hsl(0 0% 0%);',
    filename: 'Example.module.css',
  },
  {
    name: 'border shorthand with hex',
    source: 'border: 1px solid #333;',
    filename: 'Example.module.css',
  },
  {
    name: 'outline shorthand with named colour',
    source: 'outline: 2px solid red;',
    filename: 'Example.module.css',
  },
  {
    name: 'box-shadow with hex',
    source: 'box-shadow: 0 0 4px #000;',
    filename: 'Example.module.css',
  },
  {
    name: 'fill named colour',
    source: 'fill: white;',
    filename: 'Example.module.css',
  },
  {
    name: 'JSX inline style with named colour',
    source: "<div style={{ backgroundColor: 'red' }} />",
    filename: 'Example.tsx',
  },
];

const KNOWN_GOOD: Array<{ name: string; source: string; filename: string }> = [
  {
    name: 'var() reference',
    source: 'color: var(--color-text);',
    filename: 'Example.module.css',
  },
  {
    name: 'var() with a currentColor fallback',
    source: 'color: var(--color-text, currentColor);',
    filename: 'Example.module.css',
  },
  {
    name: 'transparent keyword',
    source: 'background: transparent;',
    filename: 'Example.module.css',
  },
  {
    name: 'currentColor keyword',
    source: 'outline-color: currentColor;',
    filename: 'Example.module.css',
  },
  { name: 'inherit keyword', source: 'border-color: inherit;', filename: 'Example.module.css' },
  {
    name: 'prose containing a colour word outside any declaration/style object',
    source: 'const description = "Search everything from white balance to filters.";',
    filename: 'Example.tsx',
  },
];

describe('findLiteralColorViolations (self-test against known inputs)', () => {
  it.each(KNOWN_BAD)(
    'flags exactly one violation, naming file and line: $name',
    ({ source, filename }) => {
      const violations = findLiteralColorViolations(source, filename);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.file).toBe(filename);
      expect(violations[0]?.line).toBe(1);
    },
  );

  it.each(KNOWN_GOOD)('produces zero violations: $name', ({ source, filename }) => {
    expect(findLiteralColorViolations(source, filename)).toEqual([]);
  });

  it('LIT-3: the colour-bearing property list includes shorthands, not only -color longhands', () => {
    const shorthands = [
      'border',
      'border-top',
      'border-right',
      'border-bottom',
      'border-left',
      'outline',
      'box-shadow',
      'text-shadow',
      'background',
    ];
    for (const property of shorthands) {
      expect(COLOR_PROPERTIES.has(property)).toBe(true);
    }
  });
});

/** Every `.css`/`.module.css` (except tokens.css) and `.tsx` file under
 * `renderer/src`, walked with path.join/path.sep-safe logic and rooted from
 * `import.meta.url` so this passes on Windows and under both `pnpm test`
 * (root) and `pnpm --filter @astrotracker/renderer test`. */
// `path.dirname`/`path.join` off this file's own directory, not
// `new URL('../', import.meta.url)` — see tokens.test.ts for why the
// literal-argument `new URL(...)` form is avoided (Vite's asset-URL
// static-analysis pattern, which misfires under vitest for some extensions).
const SRC_ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function walk(dir: string, acc: string[]): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__snapshots__') {
        continue;
      }
      walk(fullPath, acc);
      continue;
    }
    if (
      (fullPath.endsWith('.css') && !fullPath.endsWith('tokens.css')) ||
      fullPath.endsWith('.tsx')
    ) {
      acc.push(fullPath);
    }
  }
  return acc;
}

describe('no-literal-colors repo scan', () => {
  const files = walk(SRC_ROOT, []);

  it('LIT-6: the file list is non-empty and includes every .module.css this issue adds', () => {
    expect(files.length).toBeGreaterThan(0);
    const relative = files.map((file) => path.relative(SRC_ROOT, file));
    for (const expected of [
      path.join('app', 'AppShell.module.css'),
      path.join('app', 'Sidebar.module.css'),
      path.join('app', 'GlobalScanProgress.module.css'),
      path.join('app', 'PlaceholderPage.module.css'),
    ]) {
      expect(relative).toContain(expected);
    }
  });

  it('LIT-5: zero violations across every scanned file', () => {
    const allViolations = files.flatMap((file) => {
      // Confirm the file is real and readable — a broken walk should fail
      // loudly rather than silently skip a file.
      expect(statSync(file).isFile()).toBe(true);
      const source = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
      return findLiteralColorViolations(source, path.relative(SRC_ROOT, file));
    });

    expect(allViolations).toEqual([]);
  });
});
