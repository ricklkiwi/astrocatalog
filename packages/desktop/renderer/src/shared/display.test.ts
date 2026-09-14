import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as display from './display';
import { FILTER_COLORS, formatIntegrationTime, getFilterColor } from './display';

const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
const RENDERER_SRC_ROOT = path.join(THIS_DIR, '..');

describe('module surface', () => {
  it('DSP-1: exports exactly formatIntegrationTime, FILTER_COLORS, and getFilterColor at runtime', () => {
    // FilterColorBand is a type — erased at compile time, so it never
    // appears in the runtime export list; the other three are the whole
    // runtime surface.
    expect(Object.keys(display).sort()).toEqual(
      ['FILTER_COLORS', 'formatIntegrationTime', 'getFilterColor'].sort(),
    );
  });
});

describe('formatIntegrationTime', () => {
  it.each([
    [0, '00h 00m'],
    [59, '00h 00m'],
    [60, '00h 01m'],
    [3599, '00h 59m'],
    [3600, '01h 00m'],
    [3661, '01h 01m'],
    [36000, '10h 00m'],
    [360000, '100h 00m'],
    [90.9, '00h 01m'],
  ])('DSP-2: formatIntegrationTime(%s) === %s', (input, expected) => {
    expect(formatIntegrationTime(input)).toBe(expected);
  });

  it('DSP-3: throws RangeError on a negative input', () => {
    expect(() => formatIntegrationTime(-1)).toThrow(RangeError);
    expect(() => formatIntegrationTime(-0.5)).toThrow(RangeError);
  });
});

describe('FILTER_COLORS / getFilterColor', () => {
  it('DSP-4: has exactly the seven DD-008 band keys', () => {
    expect(Object.keys(FILTER_COLORS).sort()).toEqual(['B', 'G', 'Ha', 'L', 'OIII', 'R', 'SII']);
  });

  it('DSP-5: every value is a bare var(--filter-…) reference', () => {
    for (const value of Object.values(FILTER_COLORS)) {
      expect(value).toMatch(/^var\(--filter-[a-z]+\)$/);
    }
  });

  it('DSP-7: getFilterColor falls back to --filter-unknown for unrecognised bands', () => {
    for (const unknown of ['UVIR', 'None', 'none', 'Dualband', '', 'not-a-real-band']) {
      expect(getFilterColor(unknown)).toBe('var(--filter-unknown)');
    }
  });

  it('DSP-7: getFilterColor returns the exact FILTER_COLORS value for all seven known bands', () => {
    for (const band of Object.keys(FILTER_COLORS) as Array<keyof typeof FILTER_COLORS>) {
      expect(getFilterColor(band)).toBe(FILTER_COLORS[band]);
    }
  });

  it('DSP-6: the --filter-* tokens tokens.css declares exactly match the tokens display.ts references', () => {
    const tokensCssPath = path.join(RENDERER_SRC_ROOT, 'theme', 'tokens.css');
    const css = readFileSync(tokensCssPath, 'utf8').replace(/\r\n/g, '\n');

    const declared = new Set<string>();
    const declarationPattern = /(--filter-[a-z-]+)\s*:/g;
    let match: RegExpExecArray | null;
    while ((match = declarationPattern.exec(css)) !== null) {
      const [, name] = match;
      if (name !== undefined) {
        declared.add(name);
      }
    }

    const referenced = new Set<string>();
    for (const value of Object.values(FILTER_COLORS)) {
      const tokenMatch = value.match(/--filter-[a-z-]+/);
      if (tokenMatch) {
        referenced.add(tokenMatch[0]);
      }
    }
    const fallbackMatch = getFilterColor('not-a-real-band').match(/--filter-[a-z-]+/);
    if (fallbackMatch) {
      referenced.add(fallbackMatch[0]);
    }

    expect([...referenced].sort()).toEqual([...declared].sort());
  });
});

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(fullPath, acc);
      continue;
    }
    if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) {
      acc.push(fullPath);
    }
  }
  return acc;
}

describe('single-source guards', () => {
  const files = collectSourceFiles(RENDERER_SRC_ROOT);
  const displayTsPath = path.join(RENDERER_SRC_ROOT, 'shared', 'display.ts');
  const displayTestPath = path.join(RENDERER_SRC_ROOT, 'shared', 'display.test.ts');

  it('DSP-8: "var(--filter-" appears in exactly one non-test file: shared/display.ts', () => {
    const matching = files.filter((file) => {
      if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) {
        return false;
      }
      const source = readFileSync(file, 'utf8');
      return source.includes('var(--filter-');
    });
    expect(matching).toEqual([displayTsPath]);
  });

  it('DSP-9: "3600" appears in no .ts/.tsx file other than shared/display.ts and shared/display.test.ts', () => {
    const matching = files.filter((file) => readFileSync(file, 'utf8').includes('3600'));
    const others = matching.filter((file) => file !== displayTsPath && file !== displayTestPath);
    expect(others).toEqual([]);
  });

  it('DSP-11: display.ts is pure — no fs, electron, or window.astrotracker access, no React import', () => {
    const source = readFileSync(displayTsPath, 'utf8');
    // Strip comments first — the module's own doc comment names
    // `window.astrotracker` in prose to explain what it does NOT do, which
    // must not itself trip this guard.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(/from\s+['"](node:)?fs['"]/.test(code)).toBe(false);
    expect(/from\s+['"]electron['"]/.test(code)).toBe(false);
    expect(code.includes('window.astrotracker')).toBe(false);
    expect(/from\s+['"]react['"]/i.test(code)).toBe(false);
  });
});
