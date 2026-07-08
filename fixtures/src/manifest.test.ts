/**
 * Cross-cutting manifest validation (P0-06 Step 8a-c). Proves the corpus is
 * self-consistent without any parser existing yet:
 *   (a) every manifest validates against manifest.schema.json
 *   (b) every fixture file on disk has exactly one manifest entry and vice
 *       versa (no orphan file, no dangling manifest entry)
 *   (c) every manifest entry cites >=1 provenance source URL and a license
 */
import { Ajv } from 'ajv';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIXTURES_ROOT, buildCorpus } from './author.js';

const SETS = ['fits', 'xisf', 'raw'] as const;

// manifest.schema.json declares draft-07 ($schema header) — the default Ajv
// build (not the 2020-12 build) is the correct validator for it.
const schema = JSON.parse(readFileSync(join(FIXTURES_ROOT, 'manifest.schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: true, allowUnionTypes: true });
const validate = ajv.compile(schema);

interface ManifestEntry {
  file: string;
  format: string;
  provenance: { method: string; sources: string[]; license: string };
  expected: { status: string };
}
interface Manifest {
  set: string;
  entries: ManifestEntry[];
}

function loadManifest(set: (typeof SETS)[number]): Manifest {
  return JSON.parse(readFileSync(join(FIXTURES_ROOT, set, 'manifest.json'), 'utf8')) as Manifest;
}

/** Recursively list fixture data files under fixtures/<set>/ (excludes manifest.json). */
function listFixtureFiles(set: (typeof SETS)[number]): string[] {
  const root = join(FIXTURES_ROOT, set);
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry !== 'manifest.json') {
        out.push(relative(FIXTURES_ROOT, full).split('\\').join('/'));
      }
    }
  };
  walk(root);
  return out;
}

describe('manifest.schema.json validity', () => {
  it('is itself a valid JSON Schema (Ajv compiles it without error)', () => {
    expect(validate).toBeTypeOf('function');
  });

  it.each(SETS)('%s/manifest.json validates against the schema with zero errors', (set) => {
    const manifest = loadManifest(set);
    const ok = validate(manifest);
    expect(validate.errors, JSON.stringify(validate.errors, null, 2)).toBeNull();
    expect(ok).toBe(true);
  });

  it.each(SETS)("%s/manifest.json declares set: '%s'", (set) => {
    expect(loadManifest(set).set).toBe(set);
  });
});

describe('fixture file <-> manifest entry bijection', () => {
  it.each(SETS)('every %s fixture file has exactly one manifest entry', (set) => {
    const filesOnDisk = new Set(listFixtureFiles(set));
    const manifestFiles = loadManifest(set).entries.map((e) => e.file);
    const manifestFileSet = new Set(manifestFiles);

    expect(manifestFiles.length, 'duplicate file entries in manifest').toBe(manifestFileSet.size);

    const orphanFiles = [...filesOnDisk].filter((f) => !manifestFileSet.has(f));
    const danglingEntries = [...manifestFileSet].filter((f) => !filesOnDisk.has(f));
    expect(orphanFiles, 'files on disk with no manifest entry').toEqual([]);
    expect(danglingEntries, "manifest entries whose file doesn't exist on disk").toEqual([]);
  });

  it('the in-memory corpus (src/definitions) matches what is committed on disk', () => {
    const corpus = buildCorpus();
    for (const set of SETS) {
      const manifestFiles = new Set(loadManifest(set).entries.map((e) => e.file));
      const inMemoryFiles = new Set(
        [...corpus.files.keys()].filter((f) => f.startsWith(`${set}/`)),
      );
      expect(inMemoryFiles).toEqual(manifestFiles);
    }
  });
});

describe('provenance completeness', () => {
  const allEntries = SETS.flatMap((set) => loadManifest(set).entries.map((e) => ({ set, e })));

  it('every entry has a valid provenance.method, a CC0-1.0 license, and >=1 source URL', () => {
    for (const { set, e } of allEntries) {
      const label = `${set}/${e.file}`;
      expect(['synthesized-to-conventions', 'user-captured', 'cc0-import'], label).toContain(
        e.provenance.method,
      );
      expect(e.provenance.license, label).toBe('CC0-1.0');
      expect(e.provenance.sources.length, label).toBeGreaterThanOrEqual(1);
      for (const url of e.provenance.sources) {
        expect(url, `${label}: '${url}'`).toMatch(/^https?:\/\//);
      }
    }
  });

  it('never mislabels synthesized fixtures as user-captured (honesty check)', () => {
    // This corpus is 100% synthesized-to-conventions per the P0-06 plan; if this
    // ever fires, someone added a fixture without going through validFits()/the
    // explicit malformed/xisf/raw builders and must set provenance by hand correctly.
    for (const { set, e } of allEntries) {
      expect(e.provenance.method, `${set}/${e.file}`).toBe('synthesized-to-conventions');
    }
  });
});

describe('errorCode is always a member of the closed enum', () => {
  const CLOSED_ENUM = [
    'TRUNCATED_HEADER',
    'MISSING_END',
    'INVALID_CARD',
    'BAD_CONTINUE',
    'NOT_FITS',
    'EMPTY_FILE',
    'MALFORMED_XML',
    'BAD_SIGNATURE',
    'UNRECOGNIZED_RAW',
  ];

  it.each(SETS)('%s manifest errorCodes are all in the closed enum', (set) => {
    const errored = loadManifest(set).entries.filter(
      (e): e is ManifestEntry & { expected: { status: 'error'; errorCode: string } } =>
        e.expected.status === 'error',
    );
    for (const e of errored) {
      expect(CLOSED_ENUM, e.file).toContain(e.expected.errorCode);
    }
  });
});
