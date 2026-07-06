import { describe, expect, it } from 'vitest';

import { coreVersion, describeCore } from './index.js';

describe('core placeholder', () => {
  it('exposes the pure-domain package version via describeCore()', () => {
    expect(describeCore()).toBe(`core@${coreVersion}`);
  });
});
