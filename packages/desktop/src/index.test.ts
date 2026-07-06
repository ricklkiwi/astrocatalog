import { describe, expect, it } from 'vitest';

import { desktopVersion, describeDesktop } from './index.js';

describe('desktop placeholder', () => {
  it('reports the main-process shell version built on core and db workspace dependencies', () => {
    expect(describeDesktop()).toBe(`desktop@${desktopVersion} (core@0.1.0, db@0.1.0)`);
  });
});
