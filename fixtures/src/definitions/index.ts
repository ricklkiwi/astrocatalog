import { aptDefs } from './apt.js';
import { asistudioDefs } from './asistudio.js';
import { edgeDefs } from './edge.js';
import { malformedDefs } from './malformed.js';
import { ninaDefs } from './nina.js';
import { rawDefs as rawFixtureDefs } from './raw.js';
import { sgproDefs } from './sgpro.js';
import { sharpcapDefs } from './sharpcap.js';
import { voyagerDefs } from './voyager.js';
import { xisfDefs as xisfFixtureDefs } from './xisf.js';
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

/** All FITS definitions in manifest order: program sets, then edge, then malformed. */
export const fitsDefs: FixtureDef[] = [
  ...ninaDefs,
  ...sgproDefs,
  ...aptDefs,
  ...sharpcapDefs,
  ...asistudioDefs,
  ...voyagerDefs,
  ...edgeDefs,
  ...malformedDefs,
];

export const xisfDefs: FixtureDef[] = [...xisfFixtureDefs];
export const rawDefs: FixtureDef[] = [...rawFixtureDefs];

export const allSets: ReadonlyArray<{ set: 'fits' | 'xisf' | 'raw'; defs: FixtureDef[] }> = [
  { set: 'fits', defs: fitsDefs },
  { set: 'xisf', defs: xisfDefs },
  { set: 'raw', defs: rawDefs },
];

export const allDefs: FixtureDef[] = allSets.flatMap((s) => s.defs);
