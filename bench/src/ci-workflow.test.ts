import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const CI_WORKFLOW_PATH = fileURLToPath(new URL('../../.github/workflows/ci.yml', import.meta.url));

describe('CI benchmark evidence artifact wiring', () => {
  it('writes current results at the repo root path that upload-artifact collects', () => {
    const workflow = readFileSync(CI_WORKFLOW_PATH, 'utf8');

    expect(workflow).toContain('run: pnpm bench -- --output-current ../bench-current/results.json');
    expect(workflow).toContain('if: always()');
    expect(workflow).toContain('name: benchmark-current-results');
    expect(workflow).toContain('path: bench-current/results.json');
  });
});
