/**
 * APT (Astro Photography Tool) capture-software profile (P1-05).
 * Fingerprint: `SWCREATE` `startsWith('Astro Photography Tool')` (real
 * fixture value: `"Astro Photography Tool - APT v.4.10"`).
 */
import type { CaptureProfile } from '../types.js';
import { headerStringField } from '../util.js';

export const aptProfile: CaptureProfile = {
  id: 'apt',
  displayName: 'Astro Photography Tool (APT)',
  detect: (headers) =>
    (headerStringField(headers, 'SWCREATE') ?? '').startsWith('Astro Photography Tool'),
  // Investigated and rejected: the issue body's own "APT temperature
  // keyword" example does not manifest in the fixture corpus. Every APT
  // fixture (apt-ccd-light.fits, apt-dark.fits, apt-flat.fits) uses the
  // standard CCD-TEMP card directly, which the generic FITS mapper already
  // reads correctly. No fixup applies.
  fixups: [],
};
