import { describe, expect, it } from 'vitest';

import { BLOCK_BYTES, CARD_BYTES } from '@astrotracker/fixtures';

import { findFitsHeaderEndBlock } from './benchmarks.js';

describe('findFitsHeaderEndBlock', () => {
  it('returns the FITS 2880-byte block boundary after the END card', () => {
    const buffer = Buffer.alloc(BLOCK_BYTES, ' ');
    buffer.write('SIMPLE  = T'.padEnd(CARD_BYTES, ' '), 0, 'ascii');
    buffer.write('END'.padEnd(CARD_BYTES, ' '), CARD_BYTES, 'ascii');

    expect(findFitsHeaderEndBlock(buffer)).toBe(BLOCK_BYTES);
  });

  it.each([
    { precedingCards: 35, expectedBytes: BLOCK_BYTES },
    { precedingCards: 36, expectedBytes: BLOCK_BYTES * 2 },
  ])(
    'rounds END after $precedingCards preceding cards to $expectedBytes bytes',
    ({ precedingCards, expectedBytes }) => {
      const buffer = Buffer.alloc(BLOCK_BYTES * 2, ' ');
      buffer.write('END'.padEnd(CARD_BYTES, ' '), precedingCards * CARD_BYTES, 'ascii');

      expect(findFitsHeaderEndBlock(buffer)).toBe(expectedBytes);
    },
  );

  it('bounds the scan and throws when END is absent', () => {
    const buffer = Buffer.alloc(BLOCK_BYTES, ' ');
    buffer.write('SIMPLE  = T'.padEnd(CARD_BYTES, ' '), 0, 'ascii');

    expect(() => findFitsHeaderEndBlock(buffer, CARD_BYTES * 2)).toThrow('FITS END card not found');
  });
});
