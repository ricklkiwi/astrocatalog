import { describe, expect, it } from 'vitest';

import { dbVersion, describeDb } from './index.js';

describe('db placeholder', () => {
  it('reports the persistence-layer version built on the core workspace dependency', () => {
    expect(describeDb()).toBe(`db@${dbVersion} (core@0.1.0)`);
  });
});
