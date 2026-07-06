import { describe, expect, it } from 'vitest';

import { rendererVersion, describeRenderer } from './index.js';

describe('renderer placeholder', () => {
  it('identifies the standalone UI package without any workspace dependency edges', () => {
    expect(describeRenderer()).toBe(`renderer@${rendererVersion}`);
  });
});
