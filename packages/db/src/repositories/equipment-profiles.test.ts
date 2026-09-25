/**
 * Integration tests for `EquipmentProfilesRepository` (P1-18) against a real
 * migrated SQLite database (`openDatabase` on a temp file, `foreign_keys=ON`).
 * Covers REPO-1..7 (detection/key resolution), CONF-1..3, REN-1..5,
 * MRG-1..20 (merge, issue AC "merged only on user confirm"), and USE-1..9
 * (usage hours).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { equipmentIdentity } from '@astrotracker/core';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase, type AstroDatabase } from '../index.js';

let tempDir: string;
let filePath: string;
let db: AstroDatabase;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'astrotracker-equipment-profiles-'));
  filePath = join(tempDir, 'catalog.db');
  db = openDatabase({ filePath });
});

afterEach(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

/** Raw second connection for schema inspection, trigger injection, and full dumps. */
function withRawConnection<T>(fn: (raw: InstanceType<typeof Database>) => T): T {
  const raw = new Database(filePath);
  raw.pragma('foreign_keys = ON');
  try {
    return fn(raw);
  } finally {
    raw.close();
  }
}

/** A fixed, far-past timestamp: any real re-stamp is unambiguously later (MRG-5/8, CONF-1, REN-1/2). */
const SEEDED_BASELINE = new Date('2026-01-01T00:00:00Z').getTime();

function backdateEquipmentProfile(id: string): void {
  withRawConnection((raw) => {
    raw
      .prepare('UPDATE equipment_profiles SET updated_at = ? WHERE id = ?')
      .run(SEEDED_BASELINE, id);
  });
}

function seedWatchFolder() {
  return db.repos.watchFolders.insert({ path: '/Volumes/AstroSSD' });
}

function seedFile(
  watchFolderId: string,
  relativePath: string,
  opts: { status?: 'present' | 'missing' | 'duplicate'; duplicateOfId?: string | null } = {},
) {
  return db.repos.files.insert({
    watchFolderId,
    relativePath,
    filename: relativePath.split('/').pop() as string,
    extension: '.fits',
    sizeBytes: 1_000_000,
    fileMtime: new Date('2026-01-01T00:00:00Z'),
    firstSeenAt: new Date('2026-01-01T00:00:00Z'),
    lastSeenAt: new Date('2026-01-01T00:00:00Z'),
    status: opts.status ?? 'present',
    duplicateOfId: opts.duplicateOfId ?? null,
  });
}

// --- REPO-1..7 ------------------------------------------------------------

/** Test Hints "Detection library (REPO-1..7)". */
function seedDetectionLibrary(): void {
  const wf = seedWatchFolder();
  const f1 = seedFile(wf.id, 'gme28/light1.fits');
  const f2 = seedFile(wf.id, 'gme28/light2.fits');
  const f3 = seedFile(wf.id, 'gme28/light3.fits');
  const f4 = seedFile(wf.id, 'gme28/dark1.fits');
  db.repos.frames.insert({
    fileId: f1.id,
    frameType: 'light',
    frameTypeSource: 'header',
    telescopeRaw: 'Gme28',
    cameraRaw: 'ZWO ASI533MC Pro',
    focalLength: 336.0,
    headersJson: '{}',
  });
  db.repos.frames.insert({
    fileId: f2.id,
    frameType: 'light',
    frameTypeSource: 'header',
    telescopeRaw: "'Gme28'",
    cameraRaw: 'ZWO ASI533MC Pro',
    focalLength: 335.88495,
    headersJson: '{}',
  });
  db.repos.frames.insert({
    fileId: f3.id,
    frameType: 'light',
    frameTypeSource: 'header',
    telescopeRaw: 'Gme28',
    cameraRaw: 'ZWO ASI533MC Pro',
    focalLength: 420,
    headersJson: '{}',
  });
  db.repos.frames.insert({
    fileId: f4.id,
    frameType: 'dark',
    frameTypeSource: 'header',
    telescopeRaw: null,
    cameraRaw: 'ZWO ASI533MC Pro',
    focalLength: null,
    headersJson: '{}',
  });
}

describe('detectFromFrames / resolveMatchKeys (REPO-1..7)', () => {
  it('REPO-1: first run inserts exactly the expected profile set', () => {
    seedDetectionLibrary();
    const result = db.repos.equipmentProfiles.detectFromFrames();
    expect(result).toEqual({ inserted: 3, existing: 0 });

    const rows = db.repos.equipmentProfiles.list();
    expect(rows).toHaveLength(3);

    const at336 = equipmentIdentity({
      telescopeRaw: 'Gme28',
      cameraRaw: 'ZWO ASI533MC Pro',
      focalLength: 336,
    })!;
    const at420 = equipmentIdentity({
      telescopeRaw: 'Gme28',
      cameraRaw: 'ZWO ASI533MC Pro',
      focalLength: 420,
    })!;
    const cameraOnly = equipmentIdentity({
      telescopeRaw: null,
      cameraRaw: 'ZWO ASI533MC Pro',
      focalLength: null,
    })!;

    const byKey = new Map(rows.map((r) => [r.matchKey, r]));
    for (const identity of [at336, at420, cameraOnly]) {
      const row = byKey.get(identity.matchKey);
      expect(row, `missing row for ${identity.matchKey}`).toBeDefined();
      expect(row?.telescope).toBe(identity.telescope);
      expect(row?.camera).toBe(identity.camera);
      expect(row?.focalLength).toBe(identity.focalLengthMm);
      expect(row?.isUserConfirmed).toBe(false);
      expect(row?.mergedIntoId).toBeNull();
    }
  });

  it('REPO-2: two quote/rounding-variant rows at the same identity resolve to one profile', () => {
    const wf = seedWatchFolder();
    const f1 = seedFile(wf.id, 'gme28/1.fits');
    const f2 = seedFile(wf.id, 'gme28/2.fits');
    db.repos.frames.insert({
      fileId: f1.id,
      frameType: 'light',
      frameTypeSource: 'header',
      telescopeRaw: 'Gme28',
      cameraRaw: 'ZWO ASI533MC Pro',
      focalLength: 336,
      headersJson: '{}',
    });
    db.repos.frames.insert({
      fileId: f2.id,
      frameType: 'light',
      frameTypeSource: 'header',
      telescopeRaw: "'Gme28'",
      cameraRaw: 'ZWO ASI533MC Pro',
      focalLength: 335.88495,
      headersJson: '{}',
    });

    const result = db.repos.equipmentProfiles.detectFromFrames();
    expect(result.inserted).toBe(1);

    const key = equipmentIdentity({
      telescopeRaw: 'Gme28',
      cameraRaw: 'ZWO ASI533MC Pro',
      focalLength: 336,
    })!.matchKey;
    const resolved = db.repos.equipmentProfiles.resolveMatchKeys([key]);
    expect(resolved.get(key)).toBeDefined();
  });

  it('REPO-3: a second run over the same frames inserts nothing', () => {
    seedDetectionLibrary();
    db.repos.equipmentProfiles.detectFromFrames();
    const second = db.repos.equipmentProfiles.detectFromFrames();
    expect(second).toEqual({ inserted: 0, existing: 3 });
    expect(db.repos.equipmentProfiles.list()).toHaveLength(3);
  });

  it('REPO-4: a rename+confirm between runs survives re-detection', () => {
    seedDetectionLibrary();
    db.repos.equipmentProfiles.detectFromFrames();
    const target = db.repos.equipmentProfiles.list()[0]!;
    db.repos.equipmentProfiles.rename(target.id, 'My Rig');
    const confirmed = db.repos.equipmentProfiles.confirm(target.id);

    const result = db.repos.equipmentProfiles.detectFromFrames();
    expect(result.inserted).toBe(0);

    const after = db.repos.equipmentProfiles.getById(target.id)!;
    expect(after.name).toBe('My Rig');
    expect(after.isUserConfirmed).toBe(true);
    expect(after.updatedAt.getTime()).toBe(confirmed.updatedAt.getTime());
  });

  it('REPO-5: detection never writes frames (equipment_profile_id and updated_at unchanged)', () => {
    seedDetectionLibrary();
    const before = db.repos.frames.list().map((f) => ({
      id: f.id,
      equipmentProfileId: f.equipmentProfileId,
      updatedAt: f.updatedAt.getTime(),
    }));

    db.repos.equipmentProfiles.detectFromFrames();

    const after = db.repos.frames.list().map((f) => ({
      id: f.id,
      equipmentProfileId: f.equipmentProfileId,
      updatedAt: f.updatedAt.getTime(),
    }));
    expect(after).toEqual(before);
  });

  it('REPO-6: a legacy null-match_key row is never treated as an existing match', () => {
    const legacy = db.repos.equipmentProfiles.insert({
      name: 'Legacy Gme28 Rig',
      telescope: 'Gme28',
      camera: 'ZWO ASI533MC Pro',
      focalLength: 336,
      isUserConfirmed: false,
    });

    const wf = seedWatchFolder();
    const file = seedFile(wf.id, 'legacy/light.fits');
    db.repos.frames.insert({
      fileId: file.id,
      frameType: 'light',
      frameTypeSource: 'header',
      telescopeRaw: 'Gme28',
      cameraRaw: 'ZWO ASI533MC Pro',
      focalLength: 336,
      headersJson: '{}',
    });

    const before = db.repos.equipmentProfiles.getById(legacy.id);
    const result = db.repos.equipmentProfiles.detectFromFrames();
    expect(result.inserted).toBe(1);

    const after = db.repos.equipmentProfiles.getById(legacy.id);
    expect(after).toEqual(before);

    const key = equipmentIdentity({
      telescopeRaw: 'Gme28',
      cameraRaw: 'ZWO ASI533MC Pro',
      focalLength: 336,
    })!.matchKey;
    const newRow = db.repos.equipmentProfiles.list().find((r) => r.matchKey === key);
    expect(newRow).toBeDefined();
    expect(newRow!.id).not.toBe(legacy.id);

    const resolved = db.repos.equipmentProfiles.resolveMatchKeys([key]);
    expect(resolved.get(key)).toBe(newRow!.id);
  });

  it('REPO-7: resolves only known keys, omitting unknown ones (never mapped to null)', () => {
    const profile = db.repos.equipmentProfiles.insert({
      name: 'Rig',
      matchKey: 'known-key',
      isUserConfirmed: false,
    });
    const resolved = db.repos.equipmentProfiles.resolveMatchKeys(['known-key', 'unknown-key']);
    expect([...resolved.keys()]).toEqual(['known-key']);
    expect(resolved.get('known-key')).toBe(profile.id);
  });
});

describe('manual overrides survive a rescan (INV-4)', () => {
  it('a rename, a confirm, and a merge made before detectFromFrames() are all intact after it', () => {
    seedDetectionLibrary();
    const first = db.repos.equipmentProfiles.detectFromFrames();
    expect(first).toEqual({ inserted: 3, existing: 0 });

    const at336Key = equipmentIdentity({
      telescopeRaw: 'Gme28',
      cameraRaw: 'ZWO ASI533MC Pro',
      focalLength: 336,
    })!.matchKey;
    const at420Key = equipmentIdentity({
      telescopeRaw: 'Gme28',
      cameraRaw: 'ZWO ASI533MC Pro',
      focalLength: 420,
    })!.matchKey;
    const cameraOnlyKey = equipmentIdentity({
      telescopeRaw: null,
      cameraRaw: 'ZWO ASI533MC Pro',
      focalLength: null,
    })!.matchKey;
    const rows = db.repos.equipmentProfiles.list();
    const survivorId = rows.find((r) => r.matchKey === at336Key)!.id;
    const confirmedOnlyId = rows.find((r) => r.matchKey === at420Key)!.id;
    const loserId = rows.find((r) => r.matchKey === cameraOnlyKey)!.id;

    db.repos.equipmentProfiles.rename(survivorId, 'My Custom Name');
    db.repos.equipmentProfiles.confirm(confirmedOnlyId);
    db.repos.equipmentProfiles.merge(survivorId, [loserId]);

    // Re-run detection over the same frames (a rescan).
    const second = db.repos.equipmentProfiles.detectFromFrames();
    expect(second.inserted).toBe(0);
    expect(db.repos.equipmentProfiles.list()).toHaveLength(3);

    const survivor = db.repos.equipmentProfiles.getById(survivorId);
    expect(survivor?.name).toBe('My Custom Name');
    const confirmedOnly = db.repos.equipmentProfiles.getById(confirmedOnlyId);
    expect(confirmedOnly?.isUserConfirmed).toBe(true);
    const loser = db.repos.equipmentProfiles.getById(loserId);
    expect(loser?.mergedIntoId).toBe(survivorId);

    expect(db.repos.equipmentProfiles.listLive().map((p) => p.id)).not.toContain(loserId);
  });
});

// --- CONF-1..3, REN-1..5 ---------------------------------------------------

describe('confirm (CONF-1..3)', () => {
  it('CONF-1: sets is_user_confirmed and strictly advances updated_at', () => {
    const profile = db.repos.equipmentProfiles.insert({ name: 'Rig', isUserConfirmed: false });
    backdateEquipmentProfile(profile.id);

    const updated = db.repos.equipmentProfiles.confirm(profile.id);
    expect(updated.isUserConfirmed).toBe(true);
    expect(updated.updatedAt.getTime()).toBeGreaterThan(SEEDED_BASELINE);
  });

  it('CONF-2: throws on a merged profile and leaves it unchanged', () => {
    const survivor = db.repos.equipmentProfiles.insert({ name: 'S', isUserConfirmed: false });
    const loser = db.repos.equipmentProfiles.insert({ name: 'L', isUserConfirmed: false });
    db.repos.equipmentProfiles.merge(survivor.id, [loser.id]);
    const before = db.repos.equipmentProfiles.getById(loser.id);

    expect(() => db.repos.equipmentProfiles.confirm(loser.id)).toThrow();
    expect(db.repos.equipmentProfiles.getById(loser.id)).toEqual(before);
  });

  it('CONF-3: throws on an unknown id', () => {
    expect(() =>
      db.repos.equipmentProfiles.confirm('01890000-0000-7000-8000-000000000000'),
    ).toThrow();
  });
});

describe('rename (REN-1..5)', () => {
  it('REN-1: trims the name', () => {
    const profile = db.repos.equipmentProfiles.insert({ name: 'Rig', isUserConfirmed: false });
    const updated = db.repos.equipmentProfiles.rename(profile.id, '  New Name  ');
    expect(updated.name).toBe('New Name');
  });

  it('REN-2: changes name only, and strictly advances updated_at', () => {
    const profile = db.repos.equipmentProfiles.insert({
      name: 'Rig',
      telescope: 'EdgeHD 8',
      camera: 'ASI2600MM',
      focalLength: 2032,
      matchKey: 'k1',
      isUserConfirmed: false,
    });
    backdateEquipmentProfile(profile.id);

    const updated = db.repos.equipmentProfiles.rename(profile.id, 'New Name');
    expect(updated.telescope).toBe('EdgeHD 8');
    expect(updated.camera).toBe('ASI2600MM');
    expect(updated.focalLength).toBe(2032);
    expect(updated.matchKey).toBe('k1');
    expect(updated.isUserConfirmed).toBe(false);
    expect(updated.mergedIntoId).toBeNull();
    expect(updated.updatedAt.getTime()).toBeGreaterThan(SEEDED_BASELINE);
  });

  it('REN-3: rejects a whitespace-only name and leaves the row unchanged', () => {
    const profile = db.repos.equipmentProfiles.insert({ name: 'Rig', isUserConfirmed: false });
    expect(() => db.repos.equipmentProfiles.rename(profile.id, '   ')).toThrow();
    expect(db.repos.equipmentProfiles.getById(profile.id)?.name).toBe('Rig');
  });

  it('REN-4: allows renaming to a name another live profile already holds', () => {
    db.repos.equipmentProfiles.insert({ name: 'Shared Name', isUserConfirmed: false });
    const b = db.repos.equipmentProfiles.insert({ name: 'B', isUserConfirmed: false });
    expect(() => db.repos.equipmentProfiles.rename(b.id, 'Shared Name')).not.toThrow();
    expect(db.repos.equipmentProfiles.getById(b.id)?.name).toBe('Shared Name');
  });

  it('REN-5: throws on a merged id and changes nothing', () => {
    const survivor = db.repos.equipmentProfiles.insert({ name: 'S', isUserConfirmed: false });
    const loser = db.repos.equipmentProfiles.insert({ name: 'L', isUserConfirmed: false });
    db.repos.equipmentProfiles.merge(survivor.id, [loser.id]);
    const before = db.repos.equipmentProfiles.getById(loser.id);

    expect(() => db.repos.equipmentProfiles.rename(loser.id, 'New')).toThrow();
    expect(db.repos.equipmentProfiles.getById(loser.id)).toEqual(before);
  });
});

// --- MRG-1..20 --------------------------------------------------------------

interface MergeLibrary {
  e1Id: string;
  e2Id: string;
  uId: string;
  e1FrameIds: string[];
  e2FrameIds: string[];
  uFrameIds: string[];
  e2LockedFrameId: string;
  e2SessionId: string;
  uSessionId: string;
  e2MasterFrameId: string;
  uMasterFrameId: string;
}

/** Test Hints "Merge library (MRG-*, USE-9)". */
function seedMergeLibrary(): MergeLibrary {
  const wf = seedWatchFolder();

  function seedLight(telescopeRaw: string, cameraRaw: string, focalLength: number, path: string) {
    const file = seedFile(wf.id, path);
    return db.repos.frames.insert({
      fileId: file.id,
      frameType: 'light',
      frameTypeSource: 'header',
      telescopeRaw,
      cameraRaw,
      focalLength,
      exposureSeconds: 300,
      headersJson: '{}',
    });
  }

  const e1Frames = [
    seedLight('EdgeHD 8', 'ZWO ASI2600MM Pro', 2032, 'e1/light1.fits'),
    seedLight('EdgeHD 8', 'ZWO ASI2600MM Pro', 2032, 'e1/light2.fits'),
  ];
  const e2Frames = [
    seedLight('EdgeHD8', 'ZWO ASI2600MM Pro', 2032, 'e2/light1.fits'),
    seedLight('EdgeHD8', 'ZWO ASI2600MM Pro', 2032, 'e2/light2.fits'),
    seedLight('EdgeHD8', 'ZWO ASI2600MM Pro', 2032, 'e2/light3.fits'),
    seedLight('EdgeHD8', 'ZWO ASI2600MM Pro', 2032, 'e2/light4.fits'),
  ];
  const uFrames = [
    seedLight('Esprit', 'ZWO ASI2600MC Pro', 550, 'u/light1.fits'),
    seedLight('Esprit', 'ZWO ASI2600MC Pro', 550, 'u/light2.fits'),
  ];

  const detectResult = db.repos.equipmentProfiles.detectFromFrames();
  expect(detectResult.inserted).toBe(3);

  const e1Key = equipmentIdentity({
    telescopeRaw: 'EdgeHD 8',
    cameraRaw: 'ZWO ASI2600MM Pro',
    focalLength: 2032,
  })!.matchKey;
  const e2Key = equipmentIdentity({
    telescopeRaw: 'EdgeHD8',
    cameraRaw: 'ZWO ASI2600MM Pro',
    focalLength: 2032,
  })!.matchKey;
  const uKey = equipmentIdentity({
    telescopeRaw: 'Esprit',
    cameraRaw: 'ZWO ASI2600MC Pro',
    focalLength: 550,
  })!.matchKey;
  const resolved = db.repos.equipmentProfiles.resolveMatchKeys([e1Key, e2Key, uKey]);
  const e1Id = resolved.get(e1Key)!;
  const e2Id = resolved.get(e2Key)!;
  const uId = resolved.get(uKey)!;

  // Standing in for P1-18a: assign each frame's equipment_profile_id.
  for (const f of e1Frames) db.repos.frames.update(f.id, { equipmentProfileId: e1Id });
  for (const f of e2Frames) db.repos.frames.update(f.id, { equipmentProfileId: e2Id });
  for (const f of uFrames) db.repos.frames.update(f.id, { equipmentProfileId: uId });

  const e2Session = db.repos.sessions.insert({
    sessionDate: '2026-01-15',
    equipmentProfileId: e2Id,
    notes: 'windy',
  });
  const uSession = db.repos.sessions.insert({ sessionDate: '2026-01-16', equipmentProfileId: uId });

  const lockedFrame = e2Frames[3]!;
  db.repos.frames.update(lockedFrame.id, {
    sessionId: e2Session.id,
    sessionAssignmentLocked: true,
  });

  const e2MasterFile = seedFile(wf.id, 'e2/master-dark.fits');
  const e2Master = db.repos.masterFrames.insert({
    fileId: e2MasterFile.id,
    masterType: 'dark',
    equipmentProfileId: e2Id,
  });
  const uMasterFile = seedFile(wf.id, 'u/master-flat.fits');
  const uMaster = db.repos.masterFrames.insert({
    fileId: uMasterFile.id,
    masterType: 'flat',
    equipmentProfileId: uId,
  });

  withRawConnection((raw) => {
    raw.prepare('UPDATE equipment_profiles SET updated_at = ?').run(SEEDED_BASELINE);
    raw.prepare('UPDATE frames SET updated_at = ?').run(SEEDED_BASELINE);
    raw.prepare('UPDATE sessions SET updated_at = ?').run(SEEDED_BASELINE);
    raw.prepare('UPDATE master_frames SET updated_at = ?').run(SEEDED_BASELINE);
  });

  return {
    e1Id,
    e2Id,
    uId,
    e1FrameIds: e1Frames.map((f) => f.id),
    e2FrameIds: e2Frames.map((f) => f.id),
    uFrameIds: uFrames.map((f) => f.id),
    e2LockedFrameId: lockedFrame.id,
    e2SessionId: e2Session.id,
    uSessionId: uSession.id,
    e2MasterFrameId: e2Master.id,
    uMasterFrameId: uMaster.id,
  };
}

function fullDump() {
  return withRawConnection((raw) => ({
    equipmentProfiles: raw.prepare('SELECT * FROM equipment_profiles ORDER BY id').all(),
    frames: raw.prepare('SELECT * FROM frames ORDER BY id').all(),
    sessions: raw.prepare('SELECT * FROM sessions ORDER BY id').all(),
    masterFrames: raw.prepare('SELECT * FROM master_frames ORDER BY id').all(),
  }));
}

describe('merge (MRG-1..20, issue AC "merged only on user confirm")', () => {
  let lib: MergeLibrary;

  beforeEach(() => {
    lib = seedMergeLibrary();
  });

  it('MRG-1: before any merge, the pair is suggested and nothing has been repointed', () => {
    const suggestions = db.repos.equipmentProfiles.listMergeSuggestions();
    const pair = suggestions.find(
      (s) => s.profileIds.includes(lib.e1Id) && s.profileIds.includes(lib.e2Id),
    );
    expect(pair).toBeDefined();

    for (const id of lib.e1FrameIds) {
      expect(db.repos.frames.getById(id)?.equipmentProfileId).toBe(lib.e1Id);
    }
    for (const id of lib.e2FrameIds) {
      expect(db.repos.frames.getById(id)?.equipmentProfileId).toBe(lib.e2Id);
    }
    expect(db.repos.sessions.getById(lib.e2SessionId)?.equipmentProfileId).toBe(lib.e2Id);
    expect(db.repos.masterFrames.getById(lib.e2MasterFrameId)?.equipmentProfileId).toBe(lib.e2Id);
    expect(db.repos.equipmentProfiles.getById(lib.e1Id)?.mergedIntoId).toBeNull();
    expect(db.repos.equipmentProfiles.getById(lib.e2Id)?.mergedIntoId).toBeNull();
  });

  it('MRG-2: repoints every frames row of the loser', () => {
    db.repos.equipmentProfiles.merge(lib.e1Id, [lib.e2Id]);
    for (const id of lib.e2FrameIds) {
      expect(db.repos.frames.getById(id)?.equipmentProfileId).toBe(lib.e1Id);
    }
  });

  it("MRG-3: repoints the loser's sessions row", () => {
    db.repos.equipmentProfiles.merge(lib.e1Id, [lib.e2Id]);
    expect(db.repos.sessions.getById(lib.e2SessionId)?.equipmentProfileId).toBe(lib.e1Id);
  });

  it("MRG-4: repoints the loser's master_frames row", () => {
    db.repos.equipmentProfiles.merge(lib.e1Id, [lib.e2Id]);
    expect(db.repos.masterFrames.getById(lib.e2MasterFrameId)?.equipmentProfileId).toBe(lib.e1Id);
  });

  it('MRG-5: every repointed row strictly advances updated_at', () => {
    db.repos.equipmentProfiles.merge(lib.e1Id, [lib.e2Id]);
    for (const id of lib.e2FrameIds) {
      expect(db.repos.frames.getById(id)!.updatedAt.getTime()).toBeGreaterThan(SEEDED_BASELINE);
    }
    expect(db.repos.sessions.getById(lib.e2SessionId)!.updatedAt.getTime()).toBeGreaterThan(
      SEEDED_BASELINE,
    );
    expect(db.repos.masterFrames.getById(lib.e2MasterFrameId)!.updatedAt.getTime()).toBeGreaterThan(
      SEEDED_BASELINE,
    );
  });

  it('MRG-6: an uninvolved third profile keeps its rows byte-identical', () => {
    const beforeFrames = lib.uFrameIds.map((id) => db.repos.frames.getById(id));
    const beforeSession = db.repos.sessions.getById(lib.uSessionId);
    const beforeMaster = db.repos.masterFrames.getById(lib.uMasterFrameId);

    db.repos.equipmentProfiles.merge(lib.e1Id, [lib.e2Id]);

    lib.uFrameIds.forEach((id, i) => {
      expect(db.repos.frames.getById(id)).toEqual(beforeFrames[i]);
    });
    expect(db.repos.sessions.getById(lib.uSessionId)).toEqual(beforeSession);
    expect(db.repos.masterFrames.getById(lib.uMasterFrameId)).toEqual(beforeMaster);
  });

  it('MRG-7: the loser row survives (not hard-deleted), with name/match_key unchanged', () => {
    const before = db.repos.equipmentProfiles.getById(lib.e2Id)!;
    db.repos.equipmentProfiles.merge(lib.e1Id, [lib.e2Id]);
    const after = db.repos.equipmentProfiles.getById(lib.e2Id);
    expect(after).toBeDefined();
    expect(after?.mergedIntoId).toBe(lib.e1Id);
    expect(after?.name).toBe(before.name);
    expect(after?.matchKey).toBe(before.matchKey);
  });

  it('MRG-8: the survivor is confirmed and both sides strictly advance updated_at', () => {
    db.repos.equipmentProfiles.merge(lib.e1Id, [lib.e2Id]);
    const survivor = db.repos.equipmentProfiles.getById(lib.e1Id)!;
    const loser = db.repos.equipmentProfiles.getById(lib.e2Id)!;
    expect(survivor.isUserConfirmed).toBe(true);
    expect(survivor.updatedAt.getTime()).toBeGreaterThan(SEEDED_BASELINE);
    expect(loser.updatedAt.getTime()).toBeGreaterThan(SEEDED_BASELINE);
  });

  it('MRG-9: merging two losers repoints and marks both', () => {
    db.repos.equipmentProfiles.merge(lib.e1Id, [lib.e2Id, lib.uId]);
    for (const id of [...lib.e2FrameIds, ...lib.uFrameIds]) {
      expect(db.repos.frames.getById(id)?.equipmentProfileId).toBe(lib.e1Id);
    }
    expect(db.repos.equipmentProfiles.getById(lib.e2Id)?.mergedIntoId).toBe(lib.e1Id);
    expect(db.repos.equipmentProfiles.getById(lib.uId)?.mergedIntoId).toBe(lib.e1Id);
  });

  it('MRG-10: a second detectFromFrames() after the merge inserts nothing (no resurrection)', () => {
    db.repos.equipmentProfiles.merge(lib.e1Id, [lib.e2Id]);
    const result = db.repos.equipmentProfiles.detectFromFrames();
    expect(result.inserted).toBe(0);
  });

  it("MRG-11: resolveMatchKeys maps the loser's key to the survivor", () => {
    const loserKey = db.repos.equipmentProfiles.getById(lib.e2Id)!.matchKey!;
    db.repos.equipmentProfiles.merge(lib.e1Id, [lib.e2Id]);
    const resolved = db.repos.equipmentProfiles.resolveMatchKeys([loserKey]);
    expect(resolved.get(loserKey)).toBe(lib.e1Id);
  });

  it('MRG-12: listMergeSuggestions() no longer includes the merged-away loser', () => {
    db.repos.equipmentProfiles.merge(lib.e1Id, [lib.e2Id]);
    const suggestions = db.repos.equipmentProfiles.listMergeSuggestions();
    expect(suggestions.some((s) => s.profileIds.includes(lib.e2Id))).toBe(false);
  });

  it('MRG-13: session notes and frame session linkage/lock survive; no sessions row is deleted', () => {
    db.repos.equipmentProfiles.merge(lib.e1Id, [lib.e2Id]);

    const session = db.repos.sessions.getById(lib.e2SessionId);
    expect(session?.notes).toBe('windy');
    const locked = db.repos.frames.getById(lib.e2LockedFrameId);
    expect(locked?.sessionId).toBe(lib.e2SessionId);
    expect(locked?.sessionAssignmentLocked).toBe(true);
    expect(db.repos.sessions.list()).toHaveLength(2);
  });

  it('MRG-14: a chain merge (A into B, then B into C) leaves A pointing at C', () => {
    // A = e2, B = e1, C = u.
    db.repos.equipmentProfiles.merge(lib.e1Id, [lib.e2Id]);
    db.repos.equipmentProfiles.merge(lib.uId, [lib.e1Id]);

    const loser = db.repos.equipmentProfiles.getById(lib.e2Id);
    expect(loser?.mergedIntoId).toBe(lib.uId);
    for (const id of lib.e2FrameIds) {
      expect(db.repos.frames.getById(id)?.equipmentProfileId).toBe(lib.uId);
    }
    const loserKey = loser!.matchKey!;
    expect(db.repos.equipmentProfiles.resolveMatchKeys([loserKey]).get(loserKey)).toBe(lib.uId);
  });

  it('MRG-15: the survivor listed among the merged ids throws, and the dump is unchanged', () => {
    const before = fullDump();
    expect(() => db.repos.equipmentProfiles.merge(lib.e1Id, [lib.e1Id, lib.e2Id])).toThrow();
    expect(fullDump()).toEqual(before);
  });

  it('MRG-16: an empty mergedIds list throws, and the dump is unchanged', () => {
    const before = fullDump();
    expect(() => db.repos.equipmentProfiles.merge(lib.e1Id, [])).toThrow();
    expect(fullDump()).toEqual(before);
  });

  it('MRG-17: an unknown merged id throws, and the known loser is not merged', () => {
    const before = fullDump();
    expect(() =>
      db.repos.equipmentProfiles.merge(lib.e1Id, [
        lib.e2Id,
        '01890000-0000-7000-8000-000000000000',
      ]),
    ).toThrow();
    expect(fullDump()).toEqual(before);
    expect(db.repos.equipmentProfiles.getById(lib.e2Id)?.mergedIntoId).toBeNull();
  });

  it('TEST-2: an unknown survivor id throws, and the dump is unchanged', () => {
    const before = fullDump();
    expect(() =>
      db.repos.equipmentProfiles.merge('01890000-0000-7000-8000-000000000000', [lib.e2Id]),
    ).toThrow();
    expect(fullDump()).toEqual(before);
  });

  it('MRG-18: a merged survivor is rejected, and the dump is unchanged', () => {
    db.repos.equipmentProfiles.merge(lib.e1Id, [lib.e2Id]);
    const before = fullDump();
    expect(() => db.repos.equipmentProfiles.merge(lib.e2Id, [lib.uId])).toThrow();
    expect(fullDump()).toEqual(before);
  });

  it('MRG-19: an already-merged id in mergedIds is rejected, and the other loser is not merged', () => {
    db.repos.equipmentProfiles.merge(lib.e1Id, [lib.e2Id]);
    const before = fullDump();
    expect(() => db.repos.equipmentProfiles.merge(lib.e1Id, [lib.uId, lib.e2Id])).toThrow();
    expect(fullDump()).toEqual(before);
    expect(db.repos.equipmentProfiles.getById(lib.uId)?.mergedIntoId).toBeNull();
  });

  it('MRG-20: a failure injected at the last write merge issues rolls back everything', () => {
    // merge()'s genuinely last statement is the survivor-confirm UPDATE
    // (equipment_profiles.is_user_confirmed) — see the doc comment on
    // EquipmentProfilesRepository.merge. The frames repoint (an earlier
    // statement) precedes it, so this is a meaningful atomicity test.
    withRawConnection((raw) => {
      raw.exec(`
        CREATE TRIGGER merge_abort_test
        BEFORE UPDATE OF is_user_confirmed ON equipment_profiles
        BEGIN
          SELECT RAISE(ABORT, 'injected failure');
        END;
      `);
    });
    const before = fullDump();
    expect(() => db.repos.equipmentProfiles.merge(lib.e1Id, [lib.e2Id])).toThrow();
    withRawConnection((raw) => {
      raw.exec('DROP TRIGGER merge_abort_test');
    });
    expect(fullDump()).toEqual(before);
  });
});

// --- USE-1..9 ----------------------------------------------------------------

interface UsageLibrary {
  p1: string;
  p2: string;
  p3: string;
  p4: string;
}

/** Test Hints "Usage library (USE-*)". */
function seedUsageLibrary(): UsageLibrary {
  const wf = seedWatchFolder();
  const p1 = db.repos.equipmentProfiles.insert({ name: 'P1', isUserConfirmed: false });
  const p2 = db.repos.equipmentProfiles.insert({ name: 'P2', isUserConfirmed: false });
  const p3 = db.repos.equipmentProfiles.insert({ name: 'P3', isUserConfirmed: false });
  const p4 = db.repos.equipmentProfiles.insert({ name: 'P4', isUserConfirmed: false });

  function frame(
    profileId: string,
    frameType: 'light' | 'dark' | 'flat',
    exposureSeconds: number | null,
    path: string,
    status: 'present' | 'missing' | 'duplicate' = 'present',
    duplicateOfId: string | null = null,
  ) {
    const file = seedFile(wf.id, path, { status, duplicateOfId });
    return db.repos.frames.insert({
      fileId: file.id,
      frameType,
      frameTypeSource: 'header',
      equipmentProfileId: profileId,
      exposureSeconds,
      headersJson: '{}',
    });
  }

  // P1: 7200s / 2h / 4 light frames.
  const canonical = frame(p1.id, 'light', 1800, 'p1/light1.fits');
  frame(p1.id, 'light', 1800, 'p1/light2.fits');
  frame(p1.id, 'light', 3600, 'p1/light3-missing.fits', 'missing');
  frame(p1.id, 'light', 3600, 'p1/light3-dup.fits', 'duplicate', canonical.fileId);
  frame(p1.id, 'light', null, 'p1/light-null.fits');
  frame(p1.id, 'dark', 1800, 'p1/dark.fits');
  frame(p1.id, 'flat', 30, 'p1/flat.fits');

  // P2: 3600s / 1h.
  frame(p2.id, 'light', 1200, 'p2/light1.fits');
  frame(p2.id, 'light', 1200, 'p2/light2.fits');
  frame(p2.id, 'light', 1200, 'p2/light3.fits');

  // P3: 0s / 0h.
  frame(p3.id, 'light', null, 'p3/light1.fits');

  // P4: no frames at all.

  return { p1: p1.id, p2: p2.id, p3: p3.id, p4: p4.id };
}

describe('usage hours (USE-1..9)', () => {
  it('USE-1: counts only light frames — the seeded dark/flat carry nonzero exposure but do not count', () => {
    const lib = seedUsageLibrary();
    expect(db.repos.equipmentProfiles.usageHours(lib.p1)).toEqual({
      lightExposureSeconds: 7200,
      usageHours: 2,
    });
  });

  it('USE-2: a missing-file light still counts', () => {
    const lib = seedUsageLibrary();
    // 7200 total includes the 3600s missing-file light (USE-1); isolate here
    // by checking it is not silently excluded (would leave 3600 total).
    expect(db.repos.equipmentProfiles.usageHours(lib.p1).lightExposureSeconds).toBeGreaterThan(
      3600,
    );
  });

  it('USE-3: a duplicate-file light is excluded', () => {
    const lib = seedUsageLibrary();
    // Would be 10800 if the duplicate's 3600s counted.
    expect(db.repos.equipmentProfiles.usageHours(lib.p1).lightExposureSeconds).toBe(7200);
  });

  it('USE-4: a null-exposure light contributes 0, not null/NaN — in both usageHours() and listLive()', () => {
    const lib = seedUsageLibrary();
    expect(db.repos.equipmentProfiles.usageHours(lib.p3)).toEqual({
      lightExposureSeconds: 0,
      usageHours: 0,
    });

    // listLive() has its own SQL query (not a call through usageHours()), so
    // a COALESCE dropped from only one of the two would otherwise be blind
    // here: P4 (no frames at all) already exercises the outer
    // COALESCE(SUM(...), 0), but only P3's null-exposure light exercises
    // the inner per-row COALESCE(exposure_seconds, 0).
    const p3Live = db.repos.equipmentProfiles.listLive().find((p) => p.id === lib.p3);
    expect(p3Live).toBeDefined();
    expect(p3Live?.lightExposureSeconds).toBe(0);
    expect(p3Live?.usageHours).toBe(0);
    expect(p3Live?.lightFrameCount).toBe(1);
  });

  it('USE-5: usageHours = seconds / 3600 exactly', () => {
    const lib = seedUsageLibrary();
    expect(db.repos.equipmentProfiles.usageHours(lib.p2)).toEqual({
      lightExposureSeconds: 3600,
      usageHours: 1,
    });
  });

  it('USE-6: listLive() returns exactly {p1,p2,p3,p4}, matching usageHours() per profile', () => {
    const lib = seedUsageLibrary();
    const live = db.repos.equipmentProfiles.listLive();
    expect(new Set(live.map((p) => p.id))).toEqual(new Set([lib.p1, lib.p2, lib.p3, lib.p4]));

    for (const p of live) {
      const usage = db.repos.equipmentProfiles.usageHours(p.id);
      expect(p.lightExposureSeconds).toBe(usage.lightExposureSeconds);
      expect(p.usageHours).toBe(usage.usageHours);
    }
    const p4 = live.find((p) => p.id === lib.p4)!;
    expect(p4.lightExposureSeconds).toBe(0);
    expect(p4.usageHours).toBe(0);
    expect(p4.lightFrameCount).toBe(0);
  });

  it('USE-7: after a merge, listLive() excludes the loser and the survivor absorbs its usage', () => {
    const lib = seedUsageLibrary();
    db.repos.equipmentProfiles.merge(lib.p1, [lib.p2]);
    const live = db.repos.equipmentProfiles.listLive();
    expect(live.some((p) => p.id === lib.p2)).toBe(false);
    const survivor = live.find((p) => p.id === lib.p1)!;
    expect(survivor.lightExposureSeconds).toBe(7200 + 3600);
  });

  it('USE-8: lightFrameCount counts non-duplicate lights (including null-exposure/missing), excludes dark/flat/duplicate', () => {
    const lib = seedUsageLibrary();
    const p1 = db.repos.equipmentProfiles.listLive().find((p) => p.id === lib.p1)!;
    expect(p1.lightFrameCount).toBe(4);
  });

  it('USE-9: recommendedSurvivorId reflects real repository usage, not a stubbed 0', () => {
    const lib = seedMergeLibrary();
    const suggestions = db.repos.equipmentProfiles.listMergeSuggestions();
    const pair = suggestions.find(
      (s) => s.profileIds.includes(lib.e1Id) && s.profileIds.includes(lib.e2Id),
    );
    expect(pair).toBeDefined();
    // E2 has 4 lights x 300s = 1200s vs E1's 2 x 300s = 600s, both unconfirmed.
    expect(pair?.recommendedSurvivorId).toBe(lib.e2Id);
  });
});
