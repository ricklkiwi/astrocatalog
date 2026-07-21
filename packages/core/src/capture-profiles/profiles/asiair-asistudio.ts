/**
 * ZWO ASIAIR / ASIStudio capture-software profile (P1-05). One profile
 * covers both writers under `startsWith('ZWO ASI')` (real fixture values:
 * `"ZWO ASIAIR Plus"`, `"ZWO ASIStudio ASIImg 4.4"`), matching how the
 * task-breakdown and P0-06 fixtures already bundle them as one program.
 */
import type { CaptureProfile } from '../types.js';
import { headerStringField } from '../util.js';

export const asiairAsistudioProfile: CaptureProfile = {
  id: 'asiair-asistudio',
  displayName: 'ZWO ASIAIR / ASIStudio',
  detect: (headers) => (headerStringField(headers, 'CREATOR') ?? '').startsWith('ZWO ASI'),
  // Investigated and rejected: like SharpCap, ASIStudio/ASIAIR write GAIN on
  // ZWO's native unitless 0-570 scale, not e-/ADU. FrameMetadata.gain has no
  // documented canonical unit to convert into, so there is no wrong value to
  // correct — a documentation note, not a parsing defect. No fixup applies.
  fixups: [],
};
