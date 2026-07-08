/**
 * Ambient declaration of the preload-exposed bridge. The ONLY permitted
 * reference from renderer code to the desktop package is `import type` of the
 * IPC contract — erased at compile time, so no runtime code crosses the
 * renderer/main boundary (DD-002 rule 2; enforced by a scoped ESLint rule).
 */
import type { AstroTrackerBridge } from '@astrotracker/desktop';

declare global {
  interface Window {
    astrotracker: AstroTrackerBridge;
  }
}

export {};
