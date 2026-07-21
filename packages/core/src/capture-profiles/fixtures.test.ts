/**
 * Full-corpus acceptance suite for the capture-software profile table
 * (P1-05), against the committed P0-06 fixture corpus (FITS program + edge,
 * XISF, RAW), mirroring `fits/fixtures.test.ts` / `raw/fixtures.test.ts`'s
 * `FIXTURES_ROOT` + manifest-reading pattern.
 *
 * Test-only fs access: reading the committed corpus is not domain-logic I/O
 * (DD-002 rule 1 governs production code; `detect.ts`/`apply.ts` themselves
 * never import fs), matching the established pattern.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { detectProfile } from './detect.js';
import { toFrameMetadata } from '../fits/metadata.js';
import { parseFitsHeaderFromBuffer } from '../fits/parse.js';
import type { FitsValue } from '../fits/types.js';
import { parseRawHeader } from '../raw/parse.js';
import { toFrameMetadata as rawToFrameMetadata } from '../raw/metadata.js';
import { parseXisfHeaderFromBuffer } from '../xisf/parse.js';
import { toFrameMetadata as xisfToFrameMetadata } from '../xisf/metadata.js';

const FIXTURES_ROOT = new URL('../../../../fixtures/', import.meta.url);

function fixtureBytes(file: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(file, FIXTURES_ROOT))));
}

/** Maps each manifest `provenance.program` string to its expected profile id. */
const PROGRAM_TO_PROFILE_ID: Record<string, string> = {
  'N.I.N.A.': 'nina',
  SGPro: 'sgpro',
  APT: 'apt',
  SharpCap: 'sharpcap',
  'ASIStudio/ASIAIR': 'asiair-asistudio',
  Voyager: 'voyager',
};

interface FitsManifestEntry {
  file: string;
  provenance?: { program?: string };
  expected:
    { status: 'ok'; keywords: Record<string, FitsValue> } | { status: 'error'; errorCode: string };
}

const fitsManifest = JSON.parse(
  readFileSync(new URL('fits/manifest.json', FIXTURES_ROOT), 'utf8'),
) as { entries: FitsManifestEntry[] };

const programEntries = fitsManifest.entries.filter(
  (entry): entry is FitsManifestEntry & { provenance: { program: string } } =>
    entry.expected.status === 'ok' && typeof entry.provenance?.program === 'string',
);

const edgeEntries = fitsManifest.entries.filter(
  (entry) => entry.expected.status === 'ok' && entry.file.startsWith('fits/edge/'),
);

const XISF_NULL_FILE_COUNT = 3;
const RAW_NULL_FILE_COUNT = 4;

describe('capture-profiles fixture corpus (manifest contract)', () => {
  describe('FITS program fixtures resolve to the correct profile id', () => {
    it('the manifest still carries exactly 27 program-bearing fixtures', () => {
      expect(programEntries.length).toBe(27);
    });

    describe.each(programEntries.map((entry) => [entry.file, entry] as const))(
      '%s',
      (_file, entry) => {
        it(`detectProfile resolves to '${PROGRAM_TO_PROFILE_ID[entry.provenance.program]}'`, () => {
          const parsed = parseFitsHeaderFromBuffer(fixtureBytes(entry.file));
          expect(parsed.status).toBe('ok');
          if (parsed.status !== 'ok') return;
          const metadata = toFrameMetadata(parsed.header);
          const expectedId = PROGRAM_TO_PROFILE_ID[entry.provenance.program];
          expect(expectedId, `unknown program '${entry.provenance.program}'`).toBeDefined();
          expect(detectProfile(metadata)?.id).toBe(expectedId);
        });
      },
    );
  });

  describe('FITS edge fixtures resolve to null (no false positives)', () => {
    it('the manifest still carries exactly 6 edge fixtures', () => {
      expect(edgeEntries.length).toBe(6);
    });

    describe.each(edgeEntries.map((entry) => [entry.file, entry] as const))(
      '%s',
      (_file, entry) => {
        it('detectProfile returns null', () => {
          const parsed = parseFitsHeaderFromBuffer(fixtureBytes(entry.file));
          expect(parsed.status).toBe('ok');
          if (parsed.status !== 'ok') return;
          const metadata = toFrameMetadata(parsed.header);
          expect(detectProfile(metadata)).toBeNull();
        });
      },
    );
  });

  // Malformed FITS fixtures are not exercised here: they never reach
  // toFrameMetadata (Stage 2 parse failure short-circuits before profile
  // application, per DD-004 error isolation).

  describe('valid XISF fixtures resolve to null', () => {
    // Correct v1 outcome, not a missing feature: neither XISF fixture
    // carries a FITSKeyword-level software-identity field, and the native
    // <Property> elements that would structurally distinguish
    // PixInsight-style from N.I.N.A.-style output are not copied into
    // FrameMetadata.headers by P1-02's toFrameMetadata (see the plan's
    // Architecture Decision section / Open Question #1).
    const files = [
      'xisf/pixinsight-unit-mono-ha.xisf',
      'xisf/nina-unit-mono-oiii.xisf',
      'xisf/minimal-unit.xisf',
    ];

    it.each(files)('%s: detectProfile returns null', (file) => {
      const parsed = parseXisfHeaderFromBuffer(fixtureBytes(file));
      expect(parsed.status).toBe('ok');
      if (parsed.status !== 'ok') return;
      const metadata = xisfToFrameMetadata(parsed.header);
      expect(detectProfile(metadata)).toBeNull();
    });

    it('covers exactly the 3 documented valid XISF fixtures', () => {
      expect(files.length).toBe(XISF_NULL_FILE_COUNT);
    });
  });

  describe('valid RAW fixtures resolve to null', () => {
    // Correct by design: EXIF carries Make/Model (camera hardware), never a
    // capture-software fingerprint. No profile predicate keys on a tag RAW
    // ever produces.
    const files = [
      'raw/canon-6d-light.cr2',
      'raw/canon-r6-light.cr3',
      'raw/nikon-z6-light.nef',
      'raw/sony-a7iv-light.arw',
    ];

    it.each(files)('%s: detectProfile returns null', async (file) => {
      const parsed = await parseRawHeader(fixtureBytes(file));
      expect(parsed.status).toBe('ok');
      if (parsed.status !== 'ok') return;
      const metadata = rawToFrameMetadata(parsed.header);
      expect(detectProfile(metadata)).toBeNull();
    });

    it('covers exactly the 4 documented valid RAW fixtures', () => {
      expect(files.length).toBe(RAW_NULL_FILE_COUNT);
    });
  });

  it('exercises at least 40 detection assertions total (27 + 6 + 3 + 4)', () => {
    // Computed from the same counts each describe block above asserts
    // individually (programEntries/edgeEntries lengths + the two static
    // XISF/RAW file-list constants), so an accidental empty test table
    // cannot pass vacuously.
    const total =
      programEntries.length + edgeEntries.length + XISF_NULL_FILE_COUNT + RAW_NULL_FILE_COUNT;
    expect(total).toBeGreaterThanOrEqual(40);
  });
});
