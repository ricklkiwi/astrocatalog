/**
 * IMAGETYP normalization + lexeme mapping table (P1-04, DD-004 Stage 1 of
 * the classification order: "IMAGETYP header → path heuristics →
 * unknown"). Pure string transforms — no I/O.
 *
 * Sourced from real fixture bytes (N.I.N.A., SGPro, APT, SharpCap,
 * ASIStudio, Voyager casing/phrasing) plus documented MaxIm DL/CCDSoft
 * ("Light Frame"/"Dark Frame"/"Flat Field"/"Bias Frame") and PixInsight/WBPP
 * conventions, including the real-world PixInsight single-quote-baked-in
 * quirk (`'Master Bias'`, quotes included in the stored string).
 */
import type { FrameType } from './types.js';

/**
 * Normalize a raw IMAGETYP value for table lookup:
 *
 * 1. `null` → `null` (RAW frames always hit this branch — P1-03's
 *    `imageType` is always `null`).
 * 2. Trim leading/trailing whitespace.
 * 3. Strip one leading and one trailing `'` character, but only when both
 *    are present (PixInsight quote-quirk).
 * 4. Trim again (handles `" 'LIGHT' "` — outer whitespace, then quotes,
 *    then any inner padding).
 * 5. Replace `_` and `-` with a single space (folds `DARK_FLAT`,
 *    `Dark-Flat` onto the same normalized form as `DARK FLAT`; a
 *    delimiter-free `DARKFLAT` stays its own lexeme since there is nothing
 *    to replace).
 * 6. Collapse runs of whitespace to one space.
 * 7. Uppercase.
 * 8. If the result is `''`, return `null` (whitespace-only original value
 *    is treated identically to an absent header).
 */
export function normalizeImageType(raw: string | null): string | null {
  if (raw === null) return null;
  let value = raw.trim();
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    value = value.slice(1, -1);
  }
  value = value.trim();
  value = value.replace(/[_-]/g, ' ');
  value = value.replace(/\s+/g, ' ').trim();
  value = value.toUpperCase();
  return value === '' ? null : value;
}

/**
 * Canonical normalized lexeme → {@link FrameType}. Built once at module
 * load, not per call (PRD §8.4 10k-file budget). Recognizing
 * `MASTERDARK`/`Master Bias`/etc. maps to the **base** `frame_type`
 * (`dark`, `bias`, …), not a separate "master" value — DD-003's
 * `frame_type` enum has no master variant; the master/non-master
 * distinction lives entirely in the separate `master_frames` table
 * (P1-20), out of scope here.
 */
const IMAGETYP_TABLE: Record<string, FrameType> = {
  LIGHT: 'light',
  'LIGHT FRAME': 'light',
  LIGHTFRAME: 'light',

  DARK: 'dark',
  'DARK FRAME': 'dark',
  DARKFRAME: 'dark',
  MASTERDARK: 'dark',
  'MASTER DARK': 'dark',

  FLAT: 'flat',
  'FLAT FIELD': 'flat',
  FLATFIELD: 'flat',
  MASTERFLAT: 'flat',
  'MASTER FLAT': 'flat',

  BIAS: 'bias',
  'BIAS FRAME': 'bias',
  BIASFRAME: 'bias',
  MASTERBIAS: 'bias',
  'MASTER BIAS': 'bias',

  DARKFLAT: 'darkflat',
  'DARK FLAT': 'darkflat',
  MASTERDARKFLAT: 'darkflat',
  'MASTER DARK FLAT': 'darkflat',
};

/**
 * Normalize `raw`, then do an exact lookup in the module-level lexeme
 * table. Returns `null` on a table miss or when `raw` normalizes to
 * "absent" (`null`/empty/whitespace-only) — never `'unknown'`, which is
 * only produced by the `classifyFrame()` orchestrator.
 */
export function matchImageType(raw: string | null): FrameType | null {
  const normalized = normalizeImageType(raw);
  if (normalized === null) return null;
  return IMAGETYP_TABLE[normalized] ?? null;
}
