// usage: node scripts/derive-timings.mjs [--write]  -- derive the clip-length timing set (src/sim/timing.js) from data/clips.json and
// print it; --write stores it as data/timing-sets.json sets.clip (test/timing-sets.test.mjs fails when the stored set drifts).
import { readFileSync, writeFileSync } from 'node:fs';
import { deriveClipSet } from '../src/sim/timing.js';

const file = (f) => new URL(`../data/${f}.json`, import.meta.url);
const load = (f) => JSON.parse(readFileSync(file(f), 'utf8'));
const T = load('timing-sets');
const d = deriveClipSet(load('clips'), T, load('move-defs'), load('specials'), load('rules'));
T.sets.clip = { ...T.sets.clip, moves: d.moves, specials: d.specials, roll: d.roll };
if (process.argv.includes('--write')) writeFileSync(file('timing-sets'), JSON.stringify(T, null, 2) + '\n');
console.log(JSON.stringify(d, null, 1));
