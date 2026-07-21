/**
 * Frame classification orchestrator (P1-04, DD-004): maps a parsed
 * {@link FrameMetadata} (from any of the FITS/XISF/RAW parsers) plus a file
 * path to a {@link ClassificationResult}, following DD-004's classification
 * order: `IMAGETYP` header → path-segment heuristics → `unknown`. Pure
 * function — no I/O.
 */
import type { FrameMetadata } from '../fits/metadata.js';
import { matchImageType } from './imagetyp-table.js';
import { matchPath } from './path-heuristics.js';
import type { ClassificationResult } from './types.js';

/**
 * Classify a frame, per DD-004's strict fallback chain (not a vote between
 * header and path):
 *
 * 1. A recognized `IMAGETYP` header always short-circuits — even when the
 *    file's path disagrees, the header wins and path heuristics are not
 *    even computed. A conflicting path is far more likely to be a
 *    stale/reused folder structure than a wrong header.
 * 2. An unrecognized-but-present `IMAGETYP` (custom/unlisted capture
 *    software) falls through to path heuristics — it is not immediately
 *    `unknown`. "Ambiguous → unknown" is about not guessing from thin
 *    evidence, not about skipping a well-defined deterministic stage.
 *    Empty-string and whitespace-only headers are treated identically to
 *    an absent (`null`) header by {@link matchImageType}'s own
 *    normalization, so they fall through here too.
 * 3. If neither stage produces a match, the result is `unknown`. DD-003's
 *    persisted `frame_type_source` enum has no dedicated "neither stage
 *    matched" value, so — per this issue's plan — the terminal `unknown`
 *    is attributed to `'path_heuristic'`, the last automated stage before
 *    user resolution.
 */
export function classifyFrame(metadata: FrameMetadata, filePath: string): ClassificationResult {
  const headerType = matchImageType(metadata.imageType);
  if (headerType !== null) {
    return { frameType: headerType, frameTypeSource: 'header' };
  }

  const pathType = matchPath(filePath);
  if (pathType !== null) {
    return { frameType: pathType, frameTypeSource: 'path_heuristic' };
  }

  return { frameType: 'unknown', frameTypeSource: 'path_heuristic' };
}
