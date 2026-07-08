import { describe, expect, it } from 'vitest';

import { runNativeSmoke } from './native-smoke.js';

describe('native module smoke (plain Node, no Electron)', () => {
  it('reads a semver-shaped sqlite_version() from an in-memory database', () => {
    const { sqliteVersion } = runNativeSmoke();
    expect(sqliteVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("reads sharp's own version from its versions object", () => {
    const { sharpVersion } = runNativeSmoke();
    expect(sharpVersion).toBeTruthy();
    expect(typeof sharpVersion).toBe('string');
  });
});
