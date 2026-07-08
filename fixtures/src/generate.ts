/**
 * Bulk synthetic FITS generator CLI (P0-06 Step 7 / DD-004 "synthetic 10k-
 * header fixture set"). Reuses the Step 2 FITS builder to produce N
 * structurally valid header-only FITS files with controllable
 * OBJECT/FILTER/EXPTIME/DATE-OBS/IMAGETYP distributions, for P0-07's
 * benchmark harness and DD-006 session-grouping work.
 *
 *   pnpm fixtures:generate -- --count 10000 --out fixtures/generated --seed 42 \
 *     [--profile nina|sgpro|apt|sharpcap|asistudio|voyager] \
 *     [--objects "M 31:0.4,M 42:0.35,NGC 7000:0.25"] \
 *     [--filters "Ha:0.4,OIII:0.3,SII:0.3"] \
 *     [--exptime "120,300,600"] \
 *     [--imagetypes "LIGHT:0.8,DARK:0.1,FLAT:0.1"] \
 *     [--date-start 2026-01-01] [--nights 20]
 *
 * Guarantees:
 *   - Deterministic: identical seed + args -> byte-identical output on every
 *     OS (mulberry32 PRNG; only UTC millisecond arithmetic, no wall clock).
 *   - Non-destructive: refuses a pre-existing non-empty --out directory;
 *     never writes outside --out; bad arguments exit non-zero with no writes
 *     at all (validated before any fs access beyond reading --out's listing).
 */

import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildHeader, card, num, type CardSpec } from './lib/fits.js';
import { mulberry32, weightedIndex } from './lib/prng.js';

export class GenerateArgError extends Error {}

export interface WeightedEntry {
  name: string;
  weight: number;
}

/** "name:weight,name:weight,..." -> entries with normalized (sum-to-1) weights. */
export function parseWeightedList(spec: string, label: string): WeightedEntry[] {
  const entries = spec
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((piece) => {
      const at = piece.lastIndexOf(':');
      if (at === -1) throw new GenerateArgError(`--${label}: '${piece}' is missing a :weight`);
      const name = piece.slice(0, at).trim();
      const weight = Number(piece.slice(at + 1).trim());
      if (name.length === 0) throw new GenerateArgError(`--${label}: empty name in '${piece}'`);
      if (!Number.isFinite(weight) || weight < 0) {
        throw new GenerateArgError(`--${label}: weight for '${name}' must be >= 0`);
      }
      return { name, weight };
    });
  if (entries.length === 0)
    throw new GenerateArgError(`--${label}: at least one entry is required`);
  const total = entries.reduce((n, e) => n + e.weight, 0);
  if (total <= 0) {
    throw new GenerateArgError(`--${label}: weights must sum to a positive value`);
  }
  return entries.map((e) => ({ name: e.name, weight: e.weight / total }));
}

/** "120,300,600" -> [120, 300, 600] (uniform choice among values). */
export function parseNumberList(spec: string, label: string): number[] {
  const values = spec
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number(s));
  if (values.length === 0) throw new GenerateArgError(`--${label}: at least one value is required`);
  for (const v of values) {
    if (!Number.isFinite(v) || v <= 0) {
      throw new GenerateArgError(`--${label}: every value must be a positive number`);
    }
  }
  return values;
}

const PROFILES = {
  nina: { telescop: 'Sky-Watcher Esprit 100ED', instrume: 'ZWO ASI2600MM Pro' },
  sgpro: { telescop: 'GSO RC8', instrume: 'QHY268M' },
  apt: { telescop: 'SkyWatcher 200PDS', instrume: 'Canon EOS 6D' },
  sharpcap: { telescop: 'Celestron C8', instrume: 'ZWO ASI294MC' },
  asistudio: { telescop: 'ZWO FF65 APO', instrume: 'ZWO ASI2600MC Pro' },
  voyager: { telescop: 'TS-Optics 130 APO', instrume: 'Moravian G3-16200' },
} as const;

export type ProfileName = keyof typeof PROFILES;
const DEFAULT_PROFILE: ProfileName = 'nina';

export interface GenerateOptions {
  count: number;
  out: string;
  seed: number;
  profile: ProfileName;
  objects: WeightedEntry[];
  filters: WeightedEntry[];
  exptimes: number[];
  imagetypes: WeightedEntry[];
  dateStart: string;
  nights: number;
}

const DEFAULTS = {
  seed: 1,
  profile: DEFAULT_PROFILE as ProfileName,
  objects: 'M 31:0.4,M 42:0.35,NGC 7000:0.25',
  filters: 'Ha:0.4,OIII:0.3,SII:0.3',
  exptime: '120,300,600',
  imagetypes: 'LIGHT:0.8,DARK:0.1,FLAT:0.1',
  dateStart: '2026-01-01',
  nights: 10,
};

/** Parse and validate CLI argv (no fs access). Throws GenerateArgError on any problem. */
export function parseArgs(argv: readonly string[]): GenerateOptions {
  const raw = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (typeof token !== 'string' || !token.startsWith('--')) continue;
    // pnpm forwards a bare `--` separator (from `pnpm run generate -- --count
    // ...`) through as a literal argv token instead of stripping it; treat it
    // as a no-op so the documented invocation works both directly (tsx
    // src/generate.ts --count ...) and through pnpm's run/--filter chain.
    if (token === '--') continue;
    const name = token.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new GenerateArgError(`--${name}: missing value`);
    }
    raw.set(name, value);
    i++;
  }

  const countStr = raw.get('count');
  if (countStr === undefined) throw new GenerateArgError('--count is required');
  const count = Number(countStr);
  if (!Number.isInteger(count) || count <= 0) {
    throw new GenerateArgError('--count must be a positive integer');
  }

  const out = raw.get('out');
  if (out === undefined || out.trim().length === 0) throw new GenerateArgError('--out is required');

  const seedStr = raw.get('seed') ?? String(DEFAULTS.seed);
  const seed = Number(seedStr);
  if (!Number.isFinite(seed)) throw new GenerateArgError('--seed must be a number');

  const profileStr = raw.get('profile') ?? DEFAULTS.profile;
  if (!(profileStr in PROFILES)) {
    throw new GenerateArgError(
      `--profile must be one of: ${Object.keys(PROFILES).join(', ')} (got '${profileStr}')`,
    );
  }

  const dateStart = raw.get('date-start') ?? DEFAULTS.dateStart;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStart)) {
    throw new GenerateArgError('--date-start must be in YYYY-MM-DD form');
  }

  const nightsStr = raw.get('nights') ?? String(DEFAULTS.nights);
  const nights = Number(nightsStr);
  if (!Number.isInteger(nights) || nights <= 0) {
    throw new GenerateArgError('--nights must be a positive integer');
  }

  return {
    count,
    out,
    seed,
    profile: profileStr as ProfileName,
    objects: parseWeightedList(raw.get('objects') ?? DEFAULTS.objects, 'objects'),
    filters: parseWeightedList(raw.get('filters') ?? DEFAULTS.filters, 'filters'),
    exptimes: parseNumberList(raw.get('exptime') ?? DEFAULTS.exptime, 'exptime'),
    imagetypes: parseWeightedList(raw.get('imagetypes') ?? DEFAULTS.imagetypes, 'imagetypes'),
    dateStart,
    nights,
  };
}

/** Refuses a pre-existing non-empty directory; never deletes or modifies anything. */
export function assertUsableOutDir(out: string): void {
  let entries: string[];
  try {
    entries = readdirSync(out);
  } catch {
    return; // does not exist yet: fine, main() creates it after validation
  }
  if (entries.length > 0) {
    throw new GenerateArgError(
      `--out '${out}' already exists and is not empty (refusing to interleave with or overwrite a previous run)`,
    );
  }
  const stat = statSync(out);
  if (!stat.isDirectory()) {
    throw new GenerateArgError(`--out '${out}' exists and is not a directory`);
  }
}

export interface GeneratedFrame {
  fileName: string;
  bytes: Uint8Array;
  object: string;
  filter: string;
  imagetype: string;
  exptime: number;
  dateObs: string;
}

const SETTLE_GAP_SECONDS = 15;
/** Fixed start-of-first-night clock (UTC) — arbitrary but deterministic, no wall-clock read. */
const NIGHT_START_HOUR_UTC = '22:00:00.000';

function pick<T extends { name: string }>(entries: readonly T[], r: number): T {
  const weights = entries.map((e) => (e as unknown as WeightedEntry).weight);
  const idx = weightedIndex(weights, r);
  const entry = entries[idx];
  if (!entry) throw new Error('pick: index out of range (unreachable)');
  return entry;
}

export function generateFrames(opts: GenerateOptions): {
  frames: GeneratedFrame[];
  realized: {
    objects: Record<string, number>;
    filters: Record<string, number>;
    imagetypes: Record<string, number>;
  };
} {
  const rand = mulberry32(opts.seed);
  const profile = PROFILES[opts.profile];
  const nightStartMs = Date.parse(`${opts.dateStart}T${NIGHT_START_HOUR_UTC}Z`);
  const nightElapsedSeconds = new Array<number>(opts.nights).fill(0);
  const digits = Math.max(4, String(opts.count).length);

  const frames: GeneratedFrame[] = [];
  const realized = {
    objects: {} as Record<string, number>,
    filters: {} as Record<string, number>,
    imagetypes: {} as Record<string, number>,
  };

  for (let i = 0; i < opts.count; i++) {
    const object = pick(opts.objects, rand());
    const filter = pick(opts.filters, rand());
    const imagetype = pick(opts.imagetypes, rand());
    const exptimeIdx = Math.floor(rand() * opts.exptimes.length);
    const exptime =
      opts.exptimes[Math.min(exptimeIdx, opts.exptimes.length - 1)] ?? opts.exptimes[0]!;

    const night = i % opts.nights;
    const frameStartSeconds = nightElapsedSeconds[night]!;
    nightElapsedSeconds[night] = frameStartSeconds + exptime + SETTLE_GAP_SECONDS;
    const dateObsMs = nightStartMs + night * 24 * 3600 * 1000 + frameStartSeconds * 1000;
    const dateObs = new Date(dateObsMs).toISOString().replace('Z', '');

    realized.objects[object.name] = (realized.objects[object.name] ?? 0) + 1;
    realized.filters[filter.name] = (realized.filters[filter.name] ?? 0) + 1;
    realized.imagetypes[imagetype.name] = (realized.imagetypes[imagetype.name] ?? 0) + 1;

    const cards: CardSpec[] = [
      card('SIMPLE', true, 'file does conform to FITS standard'),
      card('BITPIX', 16, 'number of bits per data pixel'),
      card('NAXIS', 2, 'number of data axes'),
      card('NAXIS1', 1024, 'length of data axis 1'),
      card('NAXIS2', 1024, 'length of data axis 2'),
      card('IMAGETYP', imagetype.name, 'Type of exposure'),
      num('EXPTIME', exptime, String(exptime), '[s] Exposure duration'),
      card('DATE-OBS', dateObs, 'Time of observation (UTC)'),
      card('TELESCOP', profile.telescop, 'Name of telescope'),
      card('INSTRUME', profile.instrume, 'Imaging instrument name'),
      card('FILTER', filter.name, 'Active filter name'),
      card('OBJECT', object.name, 'Name of the object of interest'),
    ];
    const bytes = buildHeader(cards);
    const fileName = `frame-${String(i).padStart(digits, '0')}.fits`;
    frames.push({
      fileName,
      bytes,
      object: object.name,
      filter: filter.name,
      imagetype: imagetype.name,
      exptime,
      dateObs,
    });
  }

  return { frames, realized };
}

export interface GenerationSummary {
  seed: number;
  count: number;
  profile: ProfileName;
  dateStart: string;
  nights: number;
  requested: {
    objects: WeightedEntry[];
    filters: WeightedEntry[];
    imagetypes: WeightedEntry[];
    exptime: number[];
  };
  realized: {
    objects: Record<string, number>;
    filters: Record<string, number>;
    imagetypes: Record<string, number>;
  };
}

/** Validate + generate + write, or throw GenerateArgError before touching --out. */
export function run(argv: readonly string[]): GenerationSummary {
  const opts = parseArgs(argv);
  assertUsableOutDir(opts.out);

  const { frames, realized } = generateFrames(opts);

  mkdirSync(opts.out, { recursive: true });
  for (const frame of frames) {
    writeFileSync(join(opts.out, frame.fileName), frame.bytes);
  }
  const summary: GenerationSummary = {
    seed: opts.seed,
    count: opts.count,
    profile: opts.profile,
    dateStart: opts.dateStart,
    nights: opts.nights,
    requested: {
      objects: opts.objects,
      filters: opts.filters,
      imagetypes: opts.imagetypes,
      exptime: opts.exptimes,
    },
    realized,
  };
  writeFileSync(join(opts.out, 'generation-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  return summary;
}

function main(): void {
  try {
    const summary = run(process.argv.slice(2));
    console.log(
      `generated ${summary.count} FITS file(s) (seed ${summary.seed}, profile ${summary.profile})`,
    );
  } catch (err) {
    if (err instanceof GenerateArgError) {
      console.error(`error: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

const isMain =
  typeof process.argv[1] === 'string' && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main();
}
