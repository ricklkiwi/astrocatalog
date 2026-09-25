/**
 * Catalog domain — session detection (P1-17, DD-006) and, later,
 * calibration matching (P1-20). Pure functions only (DD-002 rule 1).
 */
export type {
  SessionAssignment,
  SessionDetectionConfig,
  SessionInputFrame,
  TimezoneSource,
} from './types.js';
export { astronomicalDayLabel, isValidIana, resolveTimezone } from './timezone.js';
export { splitByGap } from './gap-splitting.js';
export { detectSessions } from './detect-sessions.js';
