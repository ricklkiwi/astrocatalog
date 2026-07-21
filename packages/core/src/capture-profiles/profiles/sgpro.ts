/**
 * SGPro (Sequence Generator Pro) capture-software profile (P1-05).
 * Fingerprint: `CREATOR` `includes('Sequence Generator Pro')` (real fixture
 * value: `"Sequence Generator Pro v4.2.0.1024"`).
 *
 * Ships the plan's one genuine, fixture-verified quirk fixup: SGPro writes
 * rotator angle as the nonstandard `ANGLE` keyword, never `OBJCTROT` (what
 * the generic FITS mapper reads for `rotatorAngleDegrees`), so the field
 * comes back `null` for SGPro frames that do carry rotation data.
 */
import type { CaptureProfile } from '../types.js';
import { headerStringField } from '../util.js';

export const sgproProfile: CaptureProfile = {
  id: 'sgpro',
  displayName: 'Sequence Generator Pro (SGPro)',
  detect: (headers) =>
    (headerStringField(headers, 'CREATOR') ?? '').includes('Sequence Generator Pro'),
  fixups: [
    // SGPro writes rotator angle as the nonstandard ANGLE keyword, never
    // OBJCTROT (what the generic FITS mapper reads). Recover it from the raw
    // header, but only when nothing else already supplied a value — never
    // clobber a legitimately-mapped OBJCTROT from another convention.
    (headers, metadata) => {
      if (metadata.rotatorAngleDegrees !== null) return {};
      const angle = headers.ANGLE;
      return typeof angle === 'number' ? { rotatorAngleDegrees: angle } : {};
    },
  ],
};
