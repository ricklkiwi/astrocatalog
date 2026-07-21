/**
 * Frame classification result shape (P1-04, DD-004): the output of
 * `classifyFrame()`, mapping a parsed {@link FrameMetadata} plus a file path
 * to a `frame_type` / `frame_type_source` pair. Field names deliberately
 * match the camelCase columns in `packages/db/src/schema/frames.ts` so
 * P1-07's pipeline can spread the result directly into a `frames` insert.
 */

/** DD-003 `frames.frame_type` CHECK constraint, exactly. */
export type FrameType = 'light' | 'dark' | 'flat' | 'bias' | 'darkflat' | 'unknown';

/**
 * Subset of DD-003's persisted `frame_type_source` enum
 * (`'header' | 'path_heuristic' | 'manual'`) that `classifyFrame()` can
 * produce. `'manual'` is applied later, only by explicit user action in the
 * UI/DB layer (DD-004: "manual overrides always win and survive rescans") —
 * this pure function never emits it.
 */
export type FrameTypeSource = 'header' | 'path_heuristic';

export interface ClassificationResult {
  frameType: FrameType;
  frameTypeSource: FrameTypeSource;
}
