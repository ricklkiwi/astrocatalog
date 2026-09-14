import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Proves DD-008's own text was actually amended (DOC-1/DOC-2), and that the
 * amendment and the token layer never drift apart (DOC-3) — the #111
 * lesson applied to a documentation change: a guard that can only detect
 * presence is not enough, so this checks presence of the new wording AND
 * absence of the superseded wording, in the same test.
 *
 * Path resolved from `import.meta.url` (never `process.cwd()`) and CRLF
 * normalised before matching, so this passes on the Windows CI leg and
 * under both root `pnpm test` and `pnpm --filter @astrotracker/renderer
 * test`, whose working directories differ (DOC-4).
 */
const THIS_DIR = path.dirname(fileURLToPath(import.meta.url));
// packages/desktop/renderer/src/theme -> repo root is five levels up.
const REPO_ROOT = path.join(THIS_DIR, '..', '..', '..', '..', '..');
const DD_008_PATH = path.join(REPO_ROOT, 'design', 'DD-008-ux-structure.md');
const TOKENS_CSS_PATH = path.join(THIS_DIR, 'tokens.css');

function readDd008(): string {
  return readFileSync(DD_008_PATH, 'utf8').replace(/\r\n/g, '\n');
}

function readTokensCss(): string {
  return readFileSync(TOKENS_CSS_PATH, 'utf8').replace(/\r\n/g, '\n');
}

/** Collapses whitespace runs (including line breaks) to a single space, so
 * substring checks against the DD's prose survive Prettier's markdown
 * reflow (it word-wraps at printWidth, so a sentence can span a hard line
 * break that a literal, un-normalised substring match would trip on). */
function normalizeProse(text: string): string {
  return text.replace(/\s+/g, ' ');
}

describe('DD-008 conformance', () => {
  it('DOC-4: the DD-008 document resolves and exists at the expected repo-relative path', () => {
    // A wrong depth here should fail with a clear message, not an ENOENT
    // stack trace three layers down.
    expect(() => readDd008()).not.toThrow();
  });

  it('DOC-2: the amended sentence is present and the superseded wording is absent', () => {
    // Normalised because Prettier's markdown formatter word-wraps at
    // printWidth, so this sentence spans a hard line break in the committed
    // file — an un-normalised substring match would false-fail on that
    // formatting, not on content.
    const text = normalizeProse(readDd008());

    expect(text).toContain(
      'Red night-vision mode overrides these with a dimmed, red-shifted treatment of the same seven bands',
    );
    // The pre-amendment wording had no "in dark and light themes"
    // qualifier — its exact substring must no longer be present, or a
    // Coder could satisfy DOC-2 by merely appending the new sentence
    // without removing the old (superseded) claim.
    expect(text).not.toContain('per-filter bars use consistent filter colors (L=white');
  });

  it('DOC-3: every filter band DD-008 names has a --filter-* token, re-declared under red-night-vision', () => {
    const dd008Text = readDd008();
    const tokensCss = readTokensCss();

    const bandToToken: Record<string, string> = {
      L: '--filter-l',
      R: '--filter-r',
      G: '--filter-g',
      B: '--filter-b',
      Ha: '--filter-ha',
      OIII: '--filter-oiii',
      SII: '--filter-sii',
    };

    const redNightVisionBlockStart = tokensCss.indexOf("[data-theme='red-night-vision']");
    expect(redNightVisionBlockStart).toBeGreaterThan(-1);
    const braceStart = tokensCss.indexOf('{', redNightVisionBlockStart);
    const braceEnd = tokensCss.indexOf('}', braceStart);
    const redNightVisionBlock = tokensCss.slice(braceStart + 1, braceEnd);

    for (const [band, token] of Object.entries(bandToToken)) {
      // The band is actually named in DD-008's amended bullet.
      expect(dd008Text, `DD-008 no longer names band "${band}"`).toMatch(
        new RegExp(`\\b${band}\\b`),
      );
      // Declared somewhere in tokens.css (the base .app-root rule).
      expect(tokensCss, `tokens.css is missing ${token}`).toMatch(new RegExp(`${token}\\s*:`));
      // Re-declared inside the red-night-vision override block specifically
      // — not merely present anywhere in the file.
      expect(
        redNightVisionBlock,
        `${token} is not re-declared under [data-theme='red-night-vision']`,
      ).toMatch(new RegExp(`${token}\\s*:`));
    }
  });
});
