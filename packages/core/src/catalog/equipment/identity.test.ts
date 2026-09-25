import { describe, expect, it } from 'vitest';

import { defaultProfileName, equipmentIdentity } from './identity.js';
import type { EquipmentIdentityInput } from './types.js';

function input(
  telescopeRaw: string | null,
  cameraRaw: string | null,
  focalLength: number | null,
): EquipmentIdentityInput {
  return { telescopeRaw, cameraRaw, focalLength };
}

describe('equipmentIdentity — quote/trim normalization (Q3)', () => {
  // ID-1: three representations of the same quoted/padded telescope string
  // all normalize to the bare value.
  it.each(['Gme28', "'Gme28'", "  'Gme28'  "])(
    'ID-1: %j normalizes telescope to "Gme28"',
    (raw) => {
      const identity = equipmentIdentity(input(raw, 'ZWO ASI533MC Pro', 336));
      expect(identity?.telescope).toBe('Gme28');
    },
  );

  it('ID-1: all three quote/trim variants share one matchKey', () => {
    const keys = ['Gme28', "'Gme28'", "  'Gme28'  "].map(
      (raw) => equipmentIdentity(input(raw, 'ZWO ASI533MC Pro', 336))?.matchKey,
    );
    expect(new Set(keys).size).toBe(1);
  });

  // ID-2: FITS padding trapped *inside* the quotes needs a second trim.
  it('ID-2: strips padding inside the quotes and matches the unpadded camera', () => {
    const padded = equipmentIdentity(input('Gme28', "'QHY268M '", 336));
    const bare = equipmentIdentity(input('Gme28', 'QHY268M', 336));
    expect(padded?.camera).toBe('QHY268M');
    expect(padded?.matchKey).toBe(bare?.matchKey);
  });

  // ID-3: exactly one wrapping pair is removed, not a global strip.
  it('ID-3: removes exactly one wrapping quote pair', () => {
    const identity = equipmentIdentity(input("''Gme28''", 'X', null));
    expect(identity?.telescope).toBe("'Gme28'");
  });

  // ID-4: an unbalanced leading quote is kept verbatim.
  it('ID-4: an unbalanced leading quote is not stripped', () => {
    const identity = equipmentIdentity(input("'Gme28", 'X', null));
    expect(identity?.telescope).toBe("'Gme28");
  });

  // ID-5: a quote-only or whitespace-only telescope normalizes to null and,
  // paired with a null camera, yields no identity at all.
  it.each([["''"], ['   ']])('ID-5: %j with a null camera yields no identity', (raw) => {
    expect(equipmentIdentity(input(raw, null, 550))).toBeNull();
  });

  // ID-6: internal whitespace drift is never merged automatically.
  it('ID-6: EdgeHD 8 / EdgeHD8 keep distinct matchKeys', () => {
    const a = equipmentIdentity(input('EdgeHD 8', 'ZWO ASI2600MM Pro', 2032));
    const b = equipmentIdentity(input('EdgeHD8', 'ZWO ASI2600MM Pro', 2032));
    expect(a?.matchKey).not.toBe(b?.matchKey);
  });

  // ID-7: case drift is never merged automatically.
  it('ID-7: WO Gt 71 / wo gt 71 keep distinct matchKeys', () => {
    const a = equipmentIdentity(input('WO Gt 71', 'ZWO ASI533MC Pro', 336));
    const b = equipmentIdentity(input('wo gt 71', 'ZWO ASI533MC Pro', 336));
    expect(a?.matchKey).not.toBe(b?.matchKey);
  });
});

describe('equipmentIdentity — focal-length rounding', () => {
  // ID-8: 336.0 / 336 / 335.88495 all round to 336 and share one matchKey.
  it.each([336.0, 336, 335.88495])('ID-8: focal %s rounds to 336', (focal) => {
    const identity = equipmentIdentity(input('GSO RC8', 'QHY268M', focal));
    expect(identity?.focalLengthMm).toBe(336);
  });

  it('ID-8: all three focal representations share one matchKey', () => {
    const keys = [336.0, 336, 335.88495].map(
      (focal) => equipmentIdentity(input('GSO RC8', 'QHY268M', focal))?.matchKey,
    );
    expect(new Set(keys).size).toBe(1);
  });

  // ID-9/ID-10: the rounding boundary — .5 rounds up, .49 rounds down.
  it('ID-9: 335.5 rounds up to 336', () => {
    expect(equipmentIdentity(input('GSO RC8', 'QHY268M', 335.5))?.focalLengthMm).toBe(336);
  });

  it('ID-10: 335.49 rounds down to 335', () => {
    expect(equipmentIdentity(input('GSO RC8', 'QHY268M', 335.49))?.focalLengthMm).toBe(335);
  });

  // Orchestrator note (2026-09-23): rounding happens before the <=0 guard.
  it('rounds 0.4 to 0mm, which the <=0 guard then nulls out', () => {
    expect(equipmentIdentity(input('GSO RC8', 'QHY268M', 0.4))?.focalLengthMm).toBeNull();
  });

  it('rounds 0.5 up to 1mm, which survives the guard', () => {
    expect(equipmentIdentity(input('GSO RC8', 'QHY268M', 0.5))?.focalLengthMm).toBe(1);
  });

  // ID-11: a reducer at a different focal length is a different optical train.
  it('ID-11: 336mm and 420mm on identical strings differ', () => {
    const a = equipmentIdentity(input('Gme28', 'ZWO ASI533MC Pro', 336));
    const b = equipmentIdentity(input('Gme28', 'ZWO ASI533MC Pro', 420));
    expect(a?.matchKey).not.toBe(b?.matchKey);
  });

  // ID-12: zero is treated as "unknown", not a 0mm profile — the boundary
  // against negative values.
  it('ID-12: focal 0 normalizes to null focalLengthMm', () => {
    const identity = equipmentIdentity(input('Gme28', 'ZWO ASI533MC Pro', 0));
    expect(identity?.focalLengthMm).toBeNull();
  });

  it('ID-12: focal 0 shares its matchKey with an explicit null focal', () => {
    const zero = equipmentIdentity(input('Gme28', 'ZWO ASI533MC Pro', 0));
    const nul = equipmentIdentity(input('Gme28', 'ZWO ASI533MC Pro', null));
    expect(zero?.matchKey).toBe(nul?.matchKey);
  });

  it('ID-12: a negative focal also normalizes to null', () => {
    expect(equipmentIdentity(input('Gme28', 'ZWO ASI533MC Pro', -5))?.focalLengthMm).toBeNull();
  });

  // ID-13: NaN/Infinity must be asserted on the component itself, because
  // JSON.stringify renders both as null and would hide a broken guard.
  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'ID-13: focal %s normalizes focalLengthMm itself to null',
    (focal) => {
      const identity = equipmentIdentity(input('Gme28', 'ZWO ASI533MC Pro', focal));
      expect(identity?.focalLengthMm).toBeNull();
    },
  );
});

describe('equipmentIdentity — no-identity and camera-only guards', () => {
  // ID-14: focal length alone never identifies a rig.
  it('ID-14: null telescope and camera with a finite focal yields no identity', () => {
    expect(equipmentIdentity(input(null, null, 550))).toBeNull();
  });

  // ID-15: a camera-only frame (dark/bias/DSLR RAW, Q7) still gets an identity.
  it('ID-15: a null telescope with a known camera yields a camera-only identity', () => {
    const identity = equipmentIdentity(input(null, 'QHY268M', null));
    expect(identity).not.toBeNull();
    expect(identity?.telescope).toBeNull();
    expect(identity?.camera).toBe('QHY268M');
  });

  // ID-16: matchKey is an unambiguous serialization — a naive delimiter join
  // would collide these pairs.
  const delimiterCollisionPairs: Array<[[string, string], [string, string]]> = [
    [
      ['A|B', 'C'],
      ['A', 'B|C'],
    ],
    [
      ['A,B', 'C'],
      ['A', 'B,C'],
    ],
    [
      ['A"]', 'C'],
      ['A', '"]C'],
    ],
  ];
  it.each(delimiterCollisionPairs)(
    'ID-16: %j and %j produce distinct matchKeys',
    ([t1, c1], [t2, c2]) => {
      const a = equipmentIdentity(input(t1, c1, null));
      const b = equipmentIdentity(input(t2, c2, null));
      expect(a?.matchKey).not.toBe(b?.matchKey);
    },
  );

  it('ID-16: the string "null" and the value null produce distinct matchKeys', () => {
    const a = equipmentIdentity(input('null', 'X', null));
    const b = equipmentIdentity(input(null, 'X', null));
    expect(a?.matchKey).not.toBe(b?.matchKey);
  });
});

describe('defaultProfileName', () => {
  // NAME-1: full-train name, integer focal formatting (no .toFixed).
  it('NAME-1: telescope + camera @ focal', () => {
    expect(
      defaultProfileName({ telescope: 'Gme28', camera: 'ZWO ASI533MC Pro', focalLengthMm: 336 }),
    ).toBe('Gme28 + ZWO ASI533MC Pro @ 336 mm');
  });

  // NAME-2/NAME-3: camera-only, null focal — no "null", no stray "+"/"@".
  it('NAME-2/NAME-3: camera-only with null focal has no null/plus/at', () => {
    const name = defaultProfileName({ telescope: null, camera: 'QHY268M', focalLengthMm: null });
    expect(name).toBe('QHY268M');
    expect(name).not.toContain('null');
    expect(name).not.toContain('+');
    expect(name).not.toContain('@');
  });

  // NAME-4: telescope === camera collapses to one (DWARF mini smart telescope).
  it('NAME-4: telescope === camera collapses to one name', () => {
    expect(
      defaultProfileName({ telescope: 'DWARF mini', camera: 'DWARF mini', focalLengthMm: 7 }),
    ).toBe('DWARF mini @ 7 mm');
  });
});
