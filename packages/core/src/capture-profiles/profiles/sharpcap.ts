/**
 * SharpCap capture-software profile (P1-05). Fingerprint: `SWCREATE`
 * `startsWith('SharpCap')` (real fixture value:
 * `"SharpCap v4.1.11962.0, 64 bit"`).
 */
import type { CaptureProfile } from '../types.js';
import { headerStringField } from '../util.js';

export const sharpcapProfile: CaptureProfile = {
  id: 'sharpcap',
  displayName: 'SharpCap',
  detect: (headers) => (headerStringField(headers, 'SWCREATE') ?? '').startsWith('SharpCap'),
  // Investigated and rejected: SharpCap writes GAIN on ZWO's native
  // unitless 0-570 scale (fixture values 100-350), not e-/ADU. But
  // FrameMetadata.gain is number | null with no documented canonical unit
  // to convert INTO — there is no wrong value to correct, just a unit
  // convention a downstream consumer (UI, not this parser layer) needs to
  // know about. No fixup applies; flagging the unit ambiguity is out of
  // this issue's scope.
  fixups: [],
};
