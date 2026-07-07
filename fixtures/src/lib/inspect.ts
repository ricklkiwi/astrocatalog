/**
 * Minimal FITS card inspector used ONLY by this package's structural tests to
 * prove the corpus is self-consistent (spec Step 8). This is intentionally not
 * a parser and must never be exported to packages/core — P1-01 implements the
 * real parser against the manifests, not against this helper.
 *
 * Pure module: bytes in, values out. No fs, no Electron.
 */

import { BLOCK_BYTES, CARD_BYTES } from './fits.js';

/** Split a byte buffer into 80-char card strings (last partial card included as-is). */
export function cardsOf(bytes: Uint8Array): string[] {
  const cards: string[] = [];
  for (let i = 0; i < bytes.length; i += CARD_BYTES) {
    const slice = bytes.subarray(i, Math.min(i + CARD_BYTES, bytes.length));
    cards.push(String.fromCharCode(...slice));
  }
  return cards;
}

export function keywordOf(cardText: string): string {
  return cardText.slice(0, 8).trimEnd();
}

/** Index of the END card at an 80-byte-aligned offset, or -1. */
export function endCardIndex(bytes: Uint8Array): number {
  const cards = cardsOf(bytes);
  return cards.findIndex((c) => c.length === CARD_BYTES && c.slice(0, 8) === 'END     ');
}

export function isBlockAligned(bytes: Uint8Array): boolean {
  return bytes.length > 0 && bytes.length % BLOCK_BYTES === 0;
}

export function isPrintableAscii(bytes: Uint8Array): boolean {
  for (const b of bytes) {
    if (b < 0x20 || b > 0x7e) return false;
  }
  return true;
}

/** Parse the quoted string starting at `text[from]`; returns value + '&'-continuation flag. */
function parseQuoted(text: string, from: number): { value: string; continued: boolean } | null {
  if (text[from] !== "'") return null;
  let out = '';
  let i = from + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === "'") {
      if (text[i + 1] === "'") {
        out += "'";
        i += 2;
        continue;
      }
      // FITS: trailing spaces inside the quotes are not significant.
      const trimmed = out.trimEnd();
      if (trimmed.endsWith('&')) return { value: trimmed.slice(0, -1), continued: true };
      return { value: trimmed, continued: false };
    }
    out += ch;
    i += 1;
  }
  return null; // unterminated string
}

export type FitsScalar = string | number | boolean;

/**
 * Read the value of `keyword` from the header cards, reassembling the
 * CONTINUE long-string convention. Returns undefined when the keyword has no
 * value card. Throws on structurally broken value text (tests only feed this
 * valid fixtures).
 */
export function valueOf(bytes: Uint8Array, keyword: string): FitsScalar | undefined {
  const cards = cardsOf(bytes);
  const index = cards.findIndex(
    (c) => keywordOf(c) === keyword && c.slice(8, 10) === '= ' && c.length === CARD_BYTES,
  );
  if (index === -1) return undefined;
  const cardText = cards[index] ?? '';

  const body = cardText.slice(10);
  const firstNonSpace = body.length - body.trimStart().length;
  if (body.trimStart().startsWith("'")) {
    let parsed = parseQuoted(body, firstNonSpace);
    if (!parsed) throw new Error(`unterminated string value for ${keyword}`);
    let value = parsed.value;
    let cursor = index + 1;
    while (parsed.continued) {
      const next = cards[cursor];
      if (!next || keywordOf(next) !== 'CONTINUE') {
        throw new Error(`dangling '&' continuation for ${keyword}`);
      }
      const quoteAt = next.indexOf("'");
      if (quoteAt === -1) throw new Error(`CONTINUE card without string for ${keyword}`);
      parsed = parseQuoted(next, quoteAt);
      if (!parsed) throw new Error(`unterminated CONTINUE string for ${keyword}`);
      value += parsed.value;
      cursor += 1;
    }
    return value;
  }

  const token = body.split('/', 1)[0]?.trim() ?? '';
  if (token === 'T') return true;
  if (token === 'F') return false;
  const parsed = Number(token);
  if (token === '' || Number.isNaN(parsed)) {
    throw new Error(`unparseable value for ${keyword}: '${token}'`);
  }
  return parsed;
}
