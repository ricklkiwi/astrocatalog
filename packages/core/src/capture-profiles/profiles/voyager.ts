/**
 * Voyager capture-software profile (P1-05). Fingerprint: `SWCREATE`
 * `startsWith('Voyager')` (real fixture value: `"Voyager 2.3.5"`).
 */
import type { CaptureProfile } from '../types.js';
import { headerStringField } from '../util.js';

export const voyagerProfile: CaptureProfile = {
  id: 'voyager',
  displayName: 'Voyager',
  detect: (headers) => (headerStringField(headers, 'SWCREATE') ?? '').startsWith('Voyager'),
  // Investigated and rejected: no software-specific defect was found in the
  // Voyager fixtures. Its sexagesimal-only pointing, absent FOCALLEN in some
  // fixtures, and EXPOSURE-only convention are all already handled
  // correctly by the generic, format-shared mapper (raDegrees/decDegrees
  // sexagesimal fallback, focalLengthMm simply null when absent,
  // exposureSeconds: EXPTIME ?? EXPOSURE) — not software-specific bugs.
  fixups: [],
};
