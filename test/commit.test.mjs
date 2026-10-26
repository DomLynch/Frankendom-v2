import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSim } from '../src/sim/sim.js';
import { applyTimingSet } from '../src/sim/timing.js';

// A2, attack commit (feel layer item 2): once a swing's wind-up starts, no other action cancels it; the only exits are being hit,
// the parry window, and the early-swing feint (V1 duel.ts feintUntil, a per-move row: 0 turns it off). A roll never cancels a swing.
const load = (f) => JSON.parse(readFileSync(new URL(`../data/${f}.json`, import.meta.url), 'utf8'));
const data = { rules: load('rules'), moves: load('move-defs'), specials: load('specials'), blades: load('blades') };
const T = load('timing-sets');

function swing(set, press, side, ticks, then) {
  const sim = createSim(applyTimingSet(data, T, set), 4);
  const [a, b] = sim.state.fighters;
  a.x = 0; a.z = -3; a.heading = 0; b.x = 0; b.z = 3; b.heading = Math.PI;   // out of reach: nothing hits, nothing is hit
  sim.step([{ press, side }, {}]);
  for (let i = 0; i < ticks; i++) sim.step([{}, {}]);
  const move = a.move, age = a.age;
  const events = sim.step([then, {}]);
  return { sim, a, move, age, events };
}

for (const set of ['v1', 'clip']) {
  for (const [press, side, id] of [['light', 'right', 'light_right'], ['heavy', null, 'heavy_overhead'], ['heavy', 'left', 'heavy_left'], ['thrust', null, 'thrust']]) {
    const m = data.moves.moves.find((x) => x.id === id);
    const midWindup = Math.max(m.feintUntil + 1, 12);   // past the early feint window, still in the wind-up
    for (const then of [{ press: 'dodge' }, { press: 'light' }, { press: 'kick' }, { press: 'heavy' }, { press: 'thrust' }]) {
      test(`${set}: ${id} in its wind-up refuses ${then.press} (no cancel)`, () => {
        const { a, move, age } = swing(set, press, side, midWindup, then);
        assert.equal(a.phase, 'attack', 'still swinging');
        assert.equal(a.move, move, 'the same move');
        assert.equal(a.age, age + 1, 'its clock kept running');
      });
    }
  }
}

test('a roll pressed in the recovery is held, not executed: the swing finishes first', () => {
  const sim = createSim(applyTimingSet(data, T, 'clip'), 4);
  const [a, b] = sim.state.fighters;
  a.x = 0; a.z = -3; a.heading = 0; b.x = 0; b.z = 3; b.heading = Math.PI;
  sim.step([{ press: 'light', side: 'right' }, {}]);
  const m = sim.moves.light_right;
  for (let i = 0; i < m.windup + m.active + 5; i++) sim.step([{}, {}]);   // into the recovery
  assert.equal(a.phase, 'attack');
  sim.step([{ press: 'dodge' }, {}]);
  assert.equal(a.phase, 'attack', 'the roll did not cancel the recovery');
});

test('the one exit early in a swing is the feint (a guard press before feintUntil), a per-move row', () => {
  for (const id of ['light_right', 'heavy_overhead', 'thrust']) assert.ok(data.moves.moves.find((m) => m.id === id).feintUntil > 0, `${id} feintUntil`);
  const sim = createSim(data, 4);
  const [a, b] = sim.state.fighters;
  a.x = 0; a.z = -3; a.heading = 0; b.x = 0; b.z = 3; b.heading = Math.PI;
  sim.step([{ press: 'light', side: 'right' }, {}]);
  sim.step([{ press: 'parry', guard: 'thrust' }, {}]);
  assert.equal(a.phase, 'guard', 'an early parry press turns the swing into a guard (V1 feint)');
});
