/**
 * Session-detection domain types (P1-17, DD-006). Pure data shapes only —
 * no behavior lives here (DD-002 rule 1).
 */
import type { FrameType } from '../classification/types.js';

/**
 * Provenance of a session's `timezone`: whether it came from the frame's
 * watch folder (DD-003 "Timezone source") or the caller-resolved system
 * default (DD-006: "default to the system timezone... flag it as
 * user-confirmable").
 */
export type TimezoneSource = 'watch_folder' | 'system_fallback';

/**
 * One already-parsed/classified frame, as `detectSessions()` needs it.
 * Deliberately carries no temperature, quality, or other capture-metric
 * field (J-2): grouping cannot structurally depend on CCD-TEMP or similar.
 */
export interface SessionInputFrame {
  id: string;
  /** `null` = unparseable DATE-OBS; excluded from every output assignment. */
  dateObsUtc: Date | null;
  equipmentProfileId: string | null;
  frameType: FrameType;
  /** Current `watch_folders.timezone` for this frame's file, if any. */
  watchFolderTimezone: string | null;
  /** Current `frames.session_id`, if this frame has already been sessioned. */
  existingSessionId: string | null;
  /** Current `sessions.timezone` for `existingSessionId`, if any. */
  existingSessionTimezone: string | null;
  /** Current `sessions.timezone_source` for `existingSessionId`, if any. */
  existingSessionTimezoneSource: TimezoneSource | null;
  /** Current `frames.session_assignment_locked`. */
  sessionAssignmentLocked: boolean;
}

export interface SessionDetectionConfig {
  /** Gap threshold in hours; DD-006 default 4, "configurable". */
  gapHours?: number;
  /**
   * Caller-resolved system default timezone, used when a frame has no
   * usable watch-folder timezone. Must itself be a valid IANA zone — an
   * invalid value is a caller configuration bug and `detectSessions` throws
   * rather than silently mislabeling a whole batch.
   */
  fallbackTimezone: string;
}

/** One detected/re-detected imaging-night grouping. */
export interface SessionAssignment {
  /** Existing session id to reuse, or `null` — minting a row is the caller's job. */
  sessionId: string | null;
  frameIds: string[];
  /** Local astronomical-day label, `YYYY-MM-DD` (noon-to-noon, DD-006). */
  sessionDate: string;
  timezone: string;
  timezoneSource: TimezoneSource;
  equipmentProfileId: string | null;
  startedAtUtc: Date;
  endedAtUtc: Date;
  /** `true` iff no member frame has `frameType === 'light'`. */
  isCalibrationOnly: boolean;
}
