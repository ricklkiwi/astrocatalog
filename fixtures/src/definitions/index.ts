import { aptDefs } from './apt.js';
import { asistudioDefs } from './asistudio.js';
import { ninaDefs } from './nina.js';
import { sgproDefs } from './sgpro.js';
import { sharpcapDefs } from './sharpcap.js';
import { voyagerDefs } from './voyager.js';
import type { FixtureDef } from './types.js';

/** Program fixture sets keyed by fits/<dir> (counts are spec criteria). */
export const programDefs = {
  nina: ninaDefs,
  sgpro: sgproDefs,
  apt: aptDefs,
  sharpcap: sharpcapDefs,
  asistudio: asistudioDefs,
  voyager: voyagerDefs,
} as const;

/** All FITS definitions in manifest order (edge/malformed appended by later steps). */
export const fitsDefs: FixtureDef[] = [
  ...ninaDefs,
  ...sgproDefs,
  ...aptDefs,
  ...sharpcapDefs,
  ...asistudioDefs,
  ...voyagerDefs,
];

export const xisfDefs: FixtureDef[] = [];
export const rawDefs: FixtureDef[] = [];

export const allSets: ReadonlyArray<{ set: 'fits' | 'xisf' | 'raw'; defs: FixtureDef[] }> = [
  { set: 'fits', defs: fitsDefs },
  { set: 'xisf', defs: xisfDefs },
  { set: 'raw', defs: rawDefs },
];

export const allDefs: FixtureDef[] = allSets.flatMap((s) => s.defs);
