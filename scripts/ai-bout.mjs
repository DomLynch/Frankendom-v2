// Win rates of the V1-port brain over seeded bouts: brain vs brain, and brain vs scripted dummies.
// Usage: node scripts/ai-bout.mjs [bouts=30] [ticks=7200]
import { bout } from './ai-lib.mjs';

const N = Number(process.argv[2]) || 30, TICKS = Number(process.argv[3]) || 60 * 120;
const matches = [
  [{ brain: 'easy' }, { brain: 'easy' }],
  [{ brain: 'hard' }, { brain: 'easy' }],
  [{ brain: 'normal' }, { brain: 'normal' }],
  [{ brain: 'hard' }, { brain: 'hard' }],
  [{ brain: 'easy' }, { dummy: 'idle' }],
  [{ brain: 'hard' }, { dummy: 'idle' }],
  [{ brain: 'easy' }, { dummy: 'turtle' }],
  [{ brain: 'hard' }, { dummy: 'turtle' }],
  [{ brain: 'easy' }, { dummy: 'spammer' }],
  [{ brain: 'novice' }, { dummy: 'spammer' }],
  [{ brain: 'novice' }, { dummy: 'idle' }],
  [{ brain: 'hard' }, { dummy: 'spammer' }],
  [{ brain: 'hard' }, { dummy: 'roller' }],
];
const name = (p) => p.brain || p.dummy;
const SET = process.argv[4] || 'v1';   // the timing set (data/timing-sets.json): v1 | clip
console.log(`${N} seeded bouts each, ${TICKS} ticks max (60 Hz), timing set ${SET}. Wins are for the left side.`);
for (const [a, b] of matches) {
  let w = 0, l = 0, d = 0, len = 0, swings = 0, kicks = 0;
  for (let seed = 1; seed <= N; seed++) {
    const r = bout(a, b, seed, TICKS, undefined, SET);
    if (r.winner === 0) w++; else if (r.winner === 1) l++; else d++;
    len += r.state.tick;
    for (const [, e] of r.log) if (e.t === 'Swing' && e.f === 0) { swings++; if (e.move === 'kick') kicks++; }
  }
  console.log(`${name(a).padEnd(7)} vs ${name(b).padEnd(7)}  wins ${String(w).padStart(2)}  losses ${String(l).padStart(2)}  unfinished ${String(d).padStart(2)}  `
    + `avg ${(len / N / 60).toFixed(1)}s  swings/bout ${(swings / N).toFixed(1)}  kicks/bout ${(kicks / N).toFixed(1)}`);
}
