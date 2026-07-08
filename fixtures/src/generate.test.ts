import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { GenerateArgError, parseNumberList, parseWeightedList, run } from './generate.js';

const tmpDirs: string[] = [];
function freshTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'astrotracker-fixtures-gen-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  tmpDirs.length = 0;
});

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

describe('parseWeightedList', () => {
  it('normalizes weights to sum to 1', () => {
    const entries = parseWeightedList('A:2,B:2', 'x');
    expect(entries).toEqual([
      { name: 'A', weight: 0.5 },
      { name: 'B', weight: 0.5 },
    ]);
  });

  it('rejects an all-zero-weight distribution', () => {
    expect(() => parseWeightedList('A:0,B:0', 'x')).toThrow(GenerateArgError);
  });

  it('rejects an entry missing a weight', () => {
    expect(() => parseWeightedList('A', 'x')).toThrow(GenerateArgError);
  });
});

describe('parseNumberList', () => {
  it('parses a comma-separated list of positive numbers', () => {
    expect(parseNumberList('120,300,600', 'exptime')).toEqual([120, 300, 600]);
  });

  it('rejects a nonpositive value', () => {
    expect(() => parseNumberList('120,0,600', 'exptime')).toThrow(GenerateArgError);
  });
});

describe('run — argument validation (no fs writes on failure)', () => {
  it('rejects --count 0 and writes nothing', () => {
    const out = freshTmpDir();
    const subdir = join(out, 'nope');
    expect(() => run(['--count', '0', '--out', subdir])).toThrow(GenerateArgError);
    expect(() => readdirSync(subdir)).toThrow(); // never created
  });

  it('rejects a negative --count', () => {
    expect(() => run(['--count', '-5', '--out', join(freshTmpDir(), 'x')])).toThrow(
      GenerateArgError,
    );
  });

  it('rejects an all-zero filters distribution and writes nothing', () => {
    const out = freshTmpDir();
    const subdir = join(out, 'nope');
    expect(() => run(['--count', '10', '--out', subdir, '--filters', 'Ha:0,OIII:0'])).toThrow(
      GenerateArgError,
    );
    expect(() => readdirSync(subdir)).toThrow();
  });

  it('rejects a pre-existing non-empty --out and leaves it untouched', () => {
    const out = freshTmpDir();
    writeFileSync(join(out, 'dummy.txt'), 'do not touch');
    expect(() => run(['--count', '10', '--out', out])).toThrow(GenerateArgError);
    expect(readdirSync(out)).toEqual(['dummy.txt']);
    expect(readFileSync(join(out, 'dummy.txt'), 'utf8')).toBe('do not touch');
  });
});

describe('run — deterministic generation', () => {
  it('produces exactly --count FITS files plus a generation-summary.json', () => {
    const out = freshTmpDir();
    const summary = run(['--count', '25', '--out', out, '--seed', '3']);
    expect(summary.count).toBe(25);
    const files = readdirSync(out);
    expect(files.filter((f) => f.endsWith('.fits'))).toHaveLength(25);
    expect(files).toContain('generation-summary.json');
  });

  it('every generated file is structurally valid (2880 multiple, SIMPLE first, END present)', () => {
    const out = freshTmpDir();
    run(['--count', '15', '--out', out, '--seed', '9']);
    for (const f of readdirSync(out).filter((n) => n.endsWith('.fits'))) {
      const bytes = readFileSync(join(out, f));
      expect(bytes.length % 2880).toBe(0);
      expect(bytes.subarray(0, 6).toString('latin1')).toBe('SIMPLE');
      let hasEnd = false;
      for (let i = 0; i < bytes.length; i += 80) {
        if (bytes.subarray(i, i + 8).toString('latin1') === 'END     ') hasEnd = true;
      }
      expect(hasEnd).toBe(true);
    }
  });

  it('identical seed + args produce byte-identical output across two different --out dirs', () => {
    const outA = freshTmpDir();
    const outB = freshTmpDir();
    run(['--count', '200', '--out', join(outA, 'run'), '--seed', '7']);
    run(['--count', '200', '--out', join(outB, 'run'), '--seed', '7']);
    const filesA = readdirSync(join(outA, 'run')).sort();
    const filesB = readdirSync(join(outB, 'run')).sort();
    expect(filesA).toEqual(filesB);
    for (const f of filesA) {
      const a = readFileSync(join(outA, 'run', f));
      const b = readFileSync(join(outB, 'run', f));
      expect(sha256(a)).toBe(sha256(b));
    }
  });

  it('a different seed changes the output', () => {
    const outA = freshTmpDir();
    const outB = freshTmpDir();
    run(['--count', '50', '--out', outA, '--seed', '1']);
    run(['--count', '50', '--out', outB, '--seed', '2']);
    const firstFileA = readdirSync(outA)
      .filter((f) => f.endsWith('.fits'))
      .sort()[0]!;
    const firstFileB = readdirSync(outB)
      .filter((f) => f.endsWith('.fits'))
      .sort()[0]!;
    const a = readFileSync(join(outA, firstFileA));
    const b = readFileSync(join(outB, firstFileB));
    expect(sha256(a)).not.toBe(sha256(b));
  });
});

describe('run — requested distribution tolerance (±0.05)', () => {
  it(
    'realizes OBJECT/FILTER/IMAGETYP proportions within tolerance for a 1000-file run',
    { timeout: 30000 },
    () => {
      const out = freshTmpDir();
      const summary = run([
        '--count',
        '1000',
        '--out',
        out,
        '--seed',
        '1',
        '--objects',
        'M 31:0.6,M 42:0.4',
        '--filters',
        'L:0.7,Ha:0.3',
        '--imagetypes',
        'LIGHT:0.8,DARK:0.2',
      ]);
      const total = Object.values(summary.realized.objects).reduce((a, b) => a + b, 0);
      expect(total).toBe(1000);
      expect(summary.realized.objects['M 31']! / total).toBeGreaterThan(0.55);
      expect(summary.realized.objects['M 31']! / total).toBeLessThan(0.65);
      expect(summary.realized.objects['M 42']! / total).toBeGreaterThan(0.35);
      expect(summary.realized.objects['M 42']! / total).toBeLessThan(0.45);

      const filterTotal = Object.values(summary.realized.filters).reduce((a, b) => a + b, 0);
      expect(filterTotal).toBe(1000);
      expect(summary.realized.filters['L']! / filterTotal).toBeGreaterThan(0.65);
      expect(summary.realized.filters['L']! / filterTotal).toBeLessThan(0.75);
      expect(summary.realized.filters['Ha']! / filterTotal).toBeGreaterThan(0.25);
      expect(summary.realized.filters['Ha']! / filterTotal).toBeLessThan(0.35);

      const typeTotal = Object.values(summary.realized.imagetypes).reduce((a, b) => a + b, 0);
      expect(typeTotal).toBe(1000);
      expect(summary.realized.imagetypes['LIGHT']! / typeTotal).toBeGreaterThan(0.75);
      expect(summary.realized.imagetypes['LIGHT']! / typeTotal).toBeLessThan(0.85);
      expect(summary.realized.imagetypes['DARK']! / typeTotal).toBeGreaterThan(0.15);
      expect(summary.realized.imagetypes['DARK']! / typeTotal).toBeLessThan(0.25);
    },
  );
});

describe('run — session-shaped DATE-OBS', () => {
  it('spreads DATE-OBS across --nights nights with strictly increasing intra-night timestamps', () => {
    const out = freshTmpDir();
    const nights = 3;
    run([
      '--count',
      '60',
      '--out',
      out,
      '--seed',
      '4',
      '--nights',
      String(nights),
      '--date-start',
      '2026-02-01',
    ]);
    const indexOf = (f: string): number => Number(/frame-(\d+)\.fits/.exec(f)?.[1]);
    const files = readdirSync(out)
      .filter((f) => f.endsWith('.fits'))
      .sort((a, b) => indexOf(a) - indexOf(b));
    const dateObsOf = (bytes: Buffer): string => {
      for (let i = 0; i < bytes.length; i += 80) {
        const card = bytes.subarray(i, i + 80).toString('latin1');
        if (card.startsWith('DATE-OBS')) {
          const match = /'([^']+)'/.exec(card);
          if (match) return match[1]!;
        }
      }
      throw new Error('DATE-OBS not found');
    };
    // Frame index i belongs to night (i % nights) — a night's local calendar
    // date isn't a safe grouping key since nights start at 22:00 UTC and run
    // past midnight into the next calendar date.
    const byNight = new Map<number, string[]>();
    for (const f of files) {
      const night = indexOf(f) % nights;
      const dateObs = dateObsOf(readFileSync(join(out, f)));
      const list = byNight.get(night) ?? [];
      list.push(dateObs);
      byNight.set(night, list);
    }
    expect(byNight.size).toBe(nights);
    for (const timestamps of byNight.values()) {
      const sorted = [...timestamps].sort();
      expect(timestamps).toEqual(sorted);
      expect(new Set(timestamps).size).toBe(timestamps.length); // no duplicates
    }
  });
});
