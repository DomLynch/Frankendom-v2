import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSim } from '../src/sim/sim.js';
import { createBrain, think } from '../src/sim/brain.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../data/${f}.json`, import.meta.url), 'utf8'));
const data = { rules: load('rules'), moves: load('move-defs'), behaviours: load('behaviours'), specials: load('specials') };
const easy = data.behaviours.brains.find((b) => b.id === 'easy');

// two brains fight; returns the event log and final state
function bout(seed, ticks) {
  const sim = createSim(data, seed);
  const brains = [createBrain(easy, seed * 2 + 1), createBrain(easy, seed * 2 + 2)];
  const log = [];
  for (let i = 0; i < ticks && !sim.state.over; i++) {
    for (const e of sim.step([think(brains[0], sim, 0), think(brains[1], sim, 1)])) log.push([sim.state.tick, e]);
  }
  return { log, state: sim.state };
}

// place the fighters face to face at a gap
function duel(gap = 1.4) {
  const sim = createSim(data, 7);
  const [a, b] = sim.state.fighters;
  a.x = 0; a.z = -gap / 2; a.heading = 0;
  b.x = 0; b.z = gap / 2; b.heading = Math.PI;
  return sim;
}
const idle = {};
const run = (sim, n, i0 = idle, i1 = idle) => { const ev = []; for (let i = 0; i < n; i++) ev.push(...sim.step([i0, i1])); return ev; };

test('same seed, same intents -> identical event log and state', () => {
  const x = bout(42, 3000), y = bout(42, 3000);
  assert.deepEqual(x.log, y.log);
  assert.deepEqual(JSON.stringify(x.state.fighters), JSON.stringify(y.state.fighters));
  assert.ok(x.log.some(([, e]) => e.t === 'Swing'), 'the brains actually fight');
});

test('two easy brains finish a bout with real exchanges', () => {
  const { log, state } = bout(3, 60 * 180);
  const kinds = new Set(log.map(([, e]) => e.t));
  for (const k of ['Swing', 'Hit']) assert.ok(kinds.has(k), `saw ${k}`);
  assert.ok(state.over, 'someone died inside three minutes');
});

test('light attack: 20 wind-up, 5 active, 25 recovery (live longsword)', () => {
  const sim = duel(3);
  sim.step([{ press: 'light' }, idle]);
  const a = sim.state.fighters[0];
  assert.equal(a.phase, 'attack');
  assert.equal(a.move, 'light_right');
  run(sim, 49);
  assert.equal(a.phase, 'attack');
  run(sim, 1);
  assert.equal(a.phase, 'ready');
});

test('a light lands on tick 20 for 14 damage and staggers 24', () => {
  const sim = duel(1.4);
  sim.step([{ press: 'light' }, idle]);
  const ev = run(sim, 25);
  const hit = ev.find((e) => e.t === 'Hit');
  assert.ok(hit);
  assert.equal(hit.dmg, 14);
  const b = sim.state.fighters[1];
  assert.equal(b.hp, 150 - 14);
});

test('parry inside the 10-tick window stuns the attacker 90 and opens a riposte', () => {
  const sim = duel(1.4);
  sim.step([{ press: 'light' }, idle]);   // light_right, a right cut: mirrored guard is left
  run(sim, 12);
  const ev = [...sim.step([idle, { press: 'parry', guard: 'left' }])];
  ev.push(...run(sim, 10, idle, { guard: 'left' }));
  assert.ok(ev.some((e) => e.t === 'Parried'));
  const [a, b] = sim.state.fighters;
  assert.equal(a.phase, 'hurt');
  assert.ok(b.punish > 0);
  sim.step([idle, { press: 'light' }]);
  assert.equal(b.move, 'slash_riposte');
});

test('roll i-frames 4-20 dodge the blow', () => {
  const sim = duel(1.4);
  sim.step([{ press: 'light' }, idle]);
  run(sim, 13);
  sim.step([idle, { press: 'dodge', mx: 1, mz: 0 }]);   // the hit lands about 6 ticks into the roll
  const ev = run(sim, 10);
  assert.ok(ev.some((e) => e.t === 'Dodged'), JSON.stringify(ev));
  assert.equal(sim.state.fighters[1].hp, 150);
});

test('a held guard on the right side blocks: stamina drain, no damage from a light', () => {
  const sim = duel(1.4);
  sim.step([{ press: 'light' }, { guard: 'left' }]);
  const ev = run(sim, 25, idle, { guard: 'left' });
  const blk = ev.find((e) => e.t === 'Blocked');
  assert.ok(blk);
  const b = sim.state.fighters[1];
  assert.equal(b.hp, 150);
  assert.ok(b.st < 100);
});

test('specials: pommel 18/4/18, cleave 32/5/31, each on its own 900-tick cooldown', () => {
  const sim = duel(3);
  const a = sim.state.fighters[0];
  sim.step([{ press: 'special1' }, idle]);
  assert.equal(a.move, 'skill_pommel');
  assert.equal(a.specialCd[0], 900 - 1);
  run(sim, 39);
  assert.equal(a.phase, 'attack');
  run(sim, 1);
  assert.equal(a.phase, 'ready');
  a.st = 100;
  const ev = [...sim.step([{ press: 'special1' }, idle])];
  assert.equal(a.phase, 'ready', 'slot 1 still cooling');
  assert.ok(ev.some((e) => e.t === 'PressRefused'));
  sim.step([{ press: 'special2' }, idle]);
  assert.equal(a.move, 'skill_cleave');
  run(sim, 67);
  assert.equal(a.phase, 'attack');
  run(sim, 1);
  assert.equal(a.phase, 'ready');
  run(sim, 900);
  assert.deepEqual(a.specialCd, [0, 0]);
});

test('a special lands with its own row: pommel 20 damage, stagger 50', () => {
  const sim = duel(1.2);
  sim.step([{ press: 'special1' }, idle]);
  let hit = null;
  for (let i = 0; i < 25 && !hit; i++) hit = sim.step([idle, idle]).find((e) => e.t === 'Hit');
  assert.ok(hit);
  assert.equal(hit.dmg, 20);
  assert.equal(sim.state.fighters[1].stun, 50);
});

test('heavy is 32/5/31 and a chained light is 16/5/20', () => {
  const sim = duel(3);
  const a = sim.state.fighters[0];
  sim.step([{ press: 'heavy' }, idle]);
  assert.equal(a.move, 'heavy_overhead');
  run(sim, 67);
  assert.equal(a.phase, 'attack');
  run(sim, 1);
  assert.equal(a.phase, 'ready');
  a.st = 100;
  sim.step([{ press: 'light' }, idle]);
  run(sim, 50);
  assert.equal(a.phase, 'ready');
  sim.step([{ press: 'light' }, idle]);
  assert.equal(a.chained, true);
  assert.equal(a.move, 'light_left');
  run(sim, 40);
  assert.equal(a.phase, 'attack');
  run(sim, 1);
  assert.equal(a.phase, 'ready');
});
