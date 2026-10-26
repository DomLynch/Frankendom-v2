import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSim } from '../src/sim/sim.js';
import { applyTimingSet, bladeAge, deriveClipSet } from '../src/sim/timing.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../data/${f}.json`, import.meta.url), 'utf8'));
const data = { rules: load('rules'), moves: load('move-defs'), specials: load('specials'), blades: load('blades') };
const clips = load('clips'), T = load('timing-sets');

test('the stored clip set is what the clips derive (run scripts/derive-timings.mjs --write)', () => {
  const d = deriveClipSet(clips, T, data.moves, data.specials, data.rules);
  assert.deepEqual(T.sets.clip.moves, d.moves);
  assert.deepEqual(T.sets.clip.specials, d.specials);
  assert.deepEqual(T.sets.clip.roll, d.roll);
});

test('the clip set pins the numbers Dom and Strategy signed off (26 Oct)', () => {
  const m = T.sets.clip.moves;
  assert.deepEqual([m.light_right.windup, m.light_right.active, m.light_right.recovery], [26, 5, 39]);
  assert.deepEqual([m.thrust.windup, m.thrust.active, m.thrust.recovery], [32, 6, 90]);   // Standing Torch Melee Attack Stab, mirrored (26 Oct)
  assert.deepEqual(T.sets.clip.specials, { cleave: { windup: 40, recovery: 86 }, reaping: { windup: 40, recovery: 125 }, stomp: { windup: 61, recovery: 119 }, lunge: { windup: 19, recovery: 105 } });
  assert.equal(T.sets.clip.roll.ticks, 84);
});

test('directional heavies: the light clip with a x1.5 wind-up in the clip set, V1 heavy windows in v1', () => {
  const m = T.sets.clip.moves;
  assert.deepEqual([m.heavy_right.windup, m.heavy_right.active, m.heavy_right.recovery], [39, 5, 39]);
  assert.deepEqual([m.heavy_left.windup, m.heavy_left.recovery], [39, 39]);
  assert.deepEqual([m.heavy_thrust.windup, m.heavy_thrust.active, m.heavy_thrust.recovery], [48, 6, 90]);
  const v1 = Object.fromEntries(data.moves.moves.map((x) => [x.id, x]));
  assert.deepEqual([v1.heavy_right.windup, v1.heavy_right.active, v1.heavy_right.recovery], [32, 5, 31]);
  assert.equal(v1.heavy_right.damage, v1.heavy_overhead.damage);   // the heavy's damage, stagger and charge come with them
  assert.equal(v1.heavy_left.charges, true);
});

test('hold + slide picks the heavy: a side, the stab, or V1 overhead with no side', () => {
  const pick = (side) => {
    const sim = createSim(data, 2);
    const [a] = sim.state.fighters;
    sim.step([{ press: 'heavy', side }, {}]);
    return a.move;
  };
  assert.equal(pick('left'), 'heavy_left');
  assert.equal(pick('right'), 'heavy_right');
  assert.equal(pick('thrust'), 'heavy_thrust');
  assert.equal(pick(null), 'heavy_overhead');
});

test('a directional heavy lands on a standing foe along its light blade, in both sets', () => {
  for (const name of ['v1', 'clip']) for (const side of ['left', 'right', 'thrust']) {
    const sim = createSim(applyTimingSet(data, T, name), 5);
    const [a, b] = sim.state.fighters;
    a.x = 0; a.z = -0.7; a.heading = 0; b.x = 0; b.z = 0.7; b.heading = Math.PI;
    sim.step([{ press: 'heavy', side }, {}]);
    for (let i = 0; i < 160; i++) sim.step([{}, {}]);
    assert.ok(b.hp < sim.rules.health, `${name} heavy ${side}: no damage`);
  }
});

test('the v1 set changes nothing: V1 moves, specials and roll come through untouched', () => {
  const v1 = applyTimingSet(data, T, 'v1');
  assert.deepEqual(v1.moves, data.moves);
  assert.deepEqual(v1.specials, data.specials);
  assert.deepEqual(v1.rules, data.rules);
  const unknown = applyTimingSet(data, T, 'nope');
  assert.deepEqual(unknown.moves, data.moves);
});

test('the clip set lengthens only the derived moves and keeps V1 windows in v1', () => {
  const c = applyTimingSet(data, T, 'clip');
  const by = (d) => Object.fromEntries(d.moves.moves.map((m) => [m.id, m]));
  assert.equal(by(c).light_right.windup, 26);
  assert.deepEqual(by(c).light_right.v1, { windup: 20, active: 5, recovery: 25, chained: { windup: 16, active: 5, recovery: 20 } });
  assert.equal(by(c).heavy_overhead.windup, data.moves.moves.find((m) => m.id === 'heavy_overhead').windup);   // heavy untouched
  assert.equal(c.specials.slots[0].windup, 40);
  assert.equal(c.specials.slots[1].recovery, 125);
  assert.equal(c.rules.roll.ticks, 84);
  assert.equal(data.moves.moves.find((m) => m.id === 'light_right').windup, 20);   // the source table is not mutated
});

test('a special casts with its slot windup and recovers for its slot recovery', () => {
  const c = applyTimingSet(data, T, 'clip');
  const sim = createSim(c, 3);
  const [a, b] = sim.state.fighters;
  a.x = 0; a.z = -0.8; a.heading = 0; b.x = 0; b.z = 0.8; b.heading = Math.PI;
  sim.state.fighters.forEach((f) => { f.specialCd = [0, 0]; });
  sim.step([{ press: 'special1' }, {}]);
  assert.ok(a.special >= 39 && a.special <= 40, `windup ${a.special}`);
  for (let i = 0; i < 45 && !a.specialRecover; i++) sim.step([{}, {}]);
  assert.ok(a.specialRecover > 80, `recovery ${a.specialRecover}`);
});

test('the blade follows the move phases: V1 frames map onto the stretched windows', () => {
  const t = { windup: 26, active: 5, recovery: 39 }, v = { windup: 20, active: 5, recovery: 25 };
  assert.equal(bladeAge(0, t, v), 0);
  assert.equal(bladeAge(26, t, v), 20);
  assert.equal(bladeAge(31, t, v), 25);
  assert.equal(bladeAge(70, t, v), 50);
  assert.equal(bladeAge(13, t, v), 10);
});

test('a light still lands on a standing foe in the clip set, as it does in v1', () => {
  for (const name of ['v1', 'clip']) {
    const sim = createSim(applyTimingSet(data, T, name), 5);
    const [a, b] = sim.state.fighters;
    a.x = 0; a.z = -0.7; a.heading = 0; b.x = 0; b.z = 0.7; b.heading = Math.PI;
    const hit = [];
    sim.step([{ press: 'light' }, {}]);
    for (let i = 0; i < 90; i++) for (const e of sim.step([{}, {}])) if (e.t === 'Hit' || e.t === 'Blocked' || e.t === 'Dodged' || e.t === 'Landed') hit.push(e.t);
    assert.ok(b.hp < sim.rules.health || hit.length, `${name}: no contact in 90 ticks`);
  }
});
