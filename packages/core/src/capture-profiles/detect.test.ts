/**
 * Registry-shape assertions + the automated "no per-software branching in
 * dispatch" source-scan test (P1-05). The source-scan test is the
 * mechanically-checkable enforcement of the "adding a profile requires only
 * a data entry + fixture, no code changes" acceptance criterion: it fails
 * loudly the moment anyone adds a program-name-bearing branch (e.g.
 * `if (profile.id === 'sgpro') { ... }`) to `detect.ts` or `apply.ts`.
 *
 * Test-only fs access: reading this package's own committed source files is
 * not domain-logic I/O (DD-002 rule 1 governs production code; `detect.ts`
 * and `apply.ts` themselves never import fs — see the layering grep in the
 * PR description).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ALL_PROFILES } from './registry.js';

const PROGRAM_NAME_SUBSTRINGS = [
  'N.I.N.A',
  'SGPro',
  'Sequence Generator',
  'Astro Photography Tool',
  'SharpCap',
  'ZWO ASI',
  'Voyager',
];

describe('ALL_PROFILES registry shape', () => {
  it('contains exactly the six documented capture-program profiles', () => {
    expect(ALL_PROFILES.length).toBe(6);
  });

  it('every entry is a well-formed CaptureProfile', () => {
    for (const profile of ALL_PROFILES) {
      expect(typeof profile.id).toBe('string');
      expect(profile.id.length).toBeGreaterThan(0);
      expect(typeof profile.displayName).toBe('string');
      expect(profile.displayName.length).toBeGreaterThan(0);
      expect(typeof profile.detect).toBe('function');
      expect(Array.isArray(profile.fixups)).toBe(true);
    }
  });
});

describe('dispatch files contain no per-software branching', () => {
  it('detect.ts and apply.ts source text names no capture program', () => {
    const detectSource = readFileSync(fileURLToPath(new URL('detect.ts', import.meta.url)), 'utf8');
    const applySource = readFileSync(fileURLToPath(new URL('apply.ts', import.meta.url)), 'utf8');
    const combined = `${detectSource}\n${applySource}`;
    for (const needle of PROGRAM_NAME_SUBSTRINGS) {
      expect(combined.includes(needle), `dispatch source must not contain "${needle}"`).toBe(false);
    }
  });
});
