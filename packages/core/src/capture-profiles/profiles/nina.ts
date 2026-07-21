/**
 * N.I.N.A. capture-software profile (P1-05). Fingerprint: `SWCREATE`
 * `startsWith('N.I.N.A.')` (real fixture value: `"N.I.N.A. 3.1.2.9001"`).
 */
import type { CaptureProfile } from '../types.js';
import { headerStringField } from '../util.js';

export const ninaProfile: CaptureProfile = {
  id: 'nina',
  displayName: 'N.I.N.A.',
  detect: (headers) => (headerStringField(headers, 'SWCREATE') ?? '').startsWith('N.I.N.A.'),
  // Investigated and rejected: N.I.N.A. fixtures carry SITELAT/SITELONG/
  // SITEELEV but never SITENAME, so FrameMetadata.siteName stays null even
  // though coordinate-level site info exists. Not fixable as a siteName
  // STRING correction (lat/long isn't a name); recovering it would need a
  // new FrameMetadata field (e.g. siteLatDeg/siteLongDeg), which is a
  // P1-01/P1-02 shape change, out of scope for a profile fixup here.
  fixups: [],
};
