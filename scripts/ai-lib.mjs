// Shared by scripts/ai-bout.mjs and test/brain.test.mjs: load the data, scripted dummies, run a bout.
import { readFileSync } from 'node:fs';
import { createSim } from '../src/sim/sim.js';
import { createBrain, think } from '../src/sim/brain.js';
import { applyTimingSet } from '../src/sim/timing.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../data/${f}.json`, import.meta.url), 'utf8'));
export const data = { rules: load('rules'), moves: load('move-defs'), behaviours: load('behaviours'), specials: load('specials'), blades: load('blades') };
export const row = (id) => data.behaviours.brains.find((b) => b.id === id);

// scripted opponents: (sim, me) -> intent
export const dummies = {
  idle: () => ({}),
  turtle: () => ({ guard: 'overhead' }),   // a guard held up against the heavy, the blow a standing guard invites
  spammer: () => ({ press: 'light' }),
  // presses parry 8 ticks before the other side's swing lands
  parrier: (sim, me) => {
    const foe = sim.state.fighters[1 - me];
    return foe.phase === 'attack' && sim.moves[foe.move].windup - foe.age <= 8 && !foe.landed ? { press: 'parry' } : {};
  },
  // rolls as soon as the other side's swing is a couple of ticks old
  roller: (sim, me) => {
    const foe = sim.state.fighters[1 - me];
    return foe.phase === 'attack' && foe.age >= 2 ? { press: 'dodge' } : {};
  },
};

// a player is { brain: rowId, with?: row overrides } or { dummy: name }; returns the events, the final state and the brains
export function bout(a, b, seed, ticks = 60 * 120, tweak, timing = 'v1') {
  const sim = createSim(applyTimingSet(data, load('timing-sets'), timing), seed);
  if (tweak) tweak(sim);
  const players = [a, b].map((p, i) => p.brain
    ? {
      brain: createBrain({ ...row(p.brain), ...p.with }, seed * 2 + 1 + i, data.behaviours), seen: {},
      think: (s) => {
        const intent = think(players[i].brain, s, i);
        for (const [k, v] of Object.entries(players[i].brain.reads || {})) if (v) players[i].seen[k] = true;   // every read it ever held
        return intent;
      },
    }
    : { think: (s) => dummies[p.dummy](s, i) });
  const log = [];
  for (let t = 0; t < ticks && !sim.state.over; t++) {
    const intents = players.map((p) => p.think(sim));
    for (const e of sim.step(intents)) log.push([sim.state.tick, e]);
  }
  const [x, y] = sim.state.fighters;
  const winner = !sim.state.over ? -1 : x.hp > 0 ? 0 : 1;
  return { log, state: sim.state, sim, players, winner };
}
