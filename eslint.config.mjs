// Shared ESLint flat config for the AstroTracker monorepo.
// Every package's `lint` script resolves this root config via ancestor lookup.
import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // DD-002 rule 1: packages/core is pure TypeScript — no Electron, no fs.
    // This rule is the mechanical enforcement point (`pnpm -r lint` fails),
    // not a manual code-review convention.
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'electron',
              message: 'packages/core must stay Electron-free (DD-002 rule 1).',
            },
            {
              name: 'fs',
              message:
                'packages/core has no fs side effects (DD-002 rule 1); parsers accept Buffers/streams.',
            },
            {
              name: 'node:fs',
              message:
                'packages/core has no fs side effects (DD-002 rule 1); parsers accept Buffers/streams.',
            },
            {
              name: 'fs/promises',
              message:
                'packages/core has no fs side effects (DD-002 rule 1); parsers accept Buffers/streams.',
            },
            {
              name: 'node:fs/promises',
              message:
                'packages/core has no fs side effects (DD-002 rule 1); parsers accept Buffers/streams.',
            },
          ],
          patterns: [
            {
              group: ['electron/*', 'fs/*', 'node:fs/*'],
              message: 'packages/core must not import Electron or fs modules (DD-002 rule 1).',
            },
          ],
        },
      ],
    },
  },
  {
    // DD-002 rule 2 (P0-03): the renderer never imports runtime code from the
    // desktop package — the ONLY permitted reference is `import type` of the
    // IPC contract, which is erased at compile time. A value import here must
    // fail `pnpm -r lint`, not merely misbehave at bundle time.
    files: ['packages/desktop/renderer/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@astrotracker/desktop',
              message:
                'Renderer may only `import type` from @astrotracker/desktop (typed IPC contract); runtime code never crosses the boundary (DD-002 rule 2).',
              allowTypeImports: true,
            },
          ],
          patterns: [
            {
              group: ['@astrotracker/desktop/*'],
              message:
                'Renderer may only `import type` from @astrotracker/desktop (typed IPC contract); runtime code never crosses the boundary (DD-002 rule 2).',
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
  prettierConfig,
);
