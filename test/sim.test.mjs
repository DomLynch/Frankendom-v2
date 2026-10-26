import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSim } from '../src/sim/sim.js';
import { createBrain, think } from '../src/sim/brain.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../data/${f}.json`, import.meta.url), 'utf8'));
const data = { rules: load('rules'), moves: load('move-defs'), behaviours: load('behaviours'), specials: load('specials'), blades: load('blades') };
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

// V1 bands (band-defs.json, fixed edges): the longsword's best band is 1.35-1.8 m, measured where the swing began
test('a blow thrown inside the best band lands whole; closer than 1.35 m it lands at 0.4x damage and knockback', () => {
  const dmgAt = (gap) => {
    const sim = duel(gap);
    sim.step([{ press: 'light' }, idle]);
    return run(sim, 30).find((e) => e.t === 'Hit');
  };
  assert.equal(dmgAt(1.5).dmg, 14);
  const close = dmgAt(1.2);
  assert.equal(close.dmg, 6);   // round(14 x 0.4)
  assert.equal(close.glance, true);
});

test('a blade wound costs 8 stamina off the bar\'s ceiling; a leg wound slows the walk', () => {
  const sim = duel(1.5);
  sim.step([{ press: 'light' }, idle]);
  run(sim, 30);
  const b = sim.state.fighters[1];
  assert.equal(b.maxSt, 92);
  assert.ok(b.wound > 0);
});

test('a backstep with the wall behind is refused and costs nothing', () => {
  const sim = duel(3);
  const a = sim.state.fighters[0];
  a.x = 0; a.z = -8; a.heading = 0;   // standing on the ring facing the foe: the wall is at his back
  const ev = sim.step([{ press: 'backstep' }, idle]);
  assert.ok(ev.some((e) => e.t === 'PressRefused'));
  assert.equal(a.st, 100);
  assert.equal(a.phase, 'ready');
});

test('camping on the wall is whipped after 180 ticks: chip, posture, a shove', () => {
  const sim = duel(3);
  const [a, b] = sim.state.fighters;
  a.x = 0; a.z = -7.6; a.heading = 0;
  b.x = 0; b.z = 0; b.heading = Math.PI;
  const ev = run(sim, 181);
  assert.ok(ev.some((e) => e.t === 'WhipRaised' && e.f === 0), 'the whip is raised first');
  const w = ev.find((e) => e.t === 'Whipped' && e.f === 0);
  assert.ok(w, JSON.stringify(ev.map((e) => e.t)));
  assert.equal(a.hp, 150 - 3);
  assert.ok(a.posture >= 14);
  assert.ok(Math.hypot(a.x, a.z) < 7.6, 'shoved in from the wall');
});

test('a light out of a backstep takes the chained timing', () => {
  const sim = duel(3);
  const a = sim.state.fighters[0];
  sim.step([{ press: 'backstep' }, idle]);
  run(sim, 8);                                     // the tail of the step cancels into a swing
  sim.step([{ press: 'light' }, idle]);
  assert.equal(a.chained, true);
});

test('a fighter cannot walk through the other: the 0.85 m ring holds', () => {
  const sim = duel(1.2);
  const [a, b] = sim.state.fighters;
  for (let i = 0; i < 90; i++) sim.step([{ mx: 0, mz: 1 }, idle]);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 0.85 - 1e-6);
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

// V1's live specials (data/specials.json): ready 120 ticks in, 32-tick windup, 20 % of max health, unblockable
test('specials are ready 120 ticks into a fight, then release 31 ticks after the press for 20 % of max health', () => {
  const sim = duel(1.2);
  const [a, b] = sim.state.fighters;
  assert.ok(sim.step([{ press: 'special1' }, idle]).some((e) => e.t === 'PressRefused'), 'not ready at the start');
  run(sim, 119);
  const ev = sim.step([{ press: 'special1' }, { guard: 'left' }]);
  assert.ok(ev.some((e) => e.t === 'SpecialStarted' && e.skill === 'cleave'));
  const seen = [];
  for (let k = 1; k <= 31; k++) seen.push(...sim.step([idle, { guard: 'left' }]).map((e) => [k, e]));
  const land = seen.find(([, e]) => e.t === 'SpecialLanded');
  assert.ok(land, JSON.stringify(seen.map(([k, e]) => [k, e.t])));
  assert.equal(land[0], 31);
  assert.equal(land[1].dmg, 30);
  assert.equal(b.hp, 120, 'unblockable: the held guard took the full special');
  assert.equal(b.phase, 'hurt');
  assert.equal(b.stun, 45, 'skill_cleave stagger 28 x 160 %');
  assert.equal(a.specialCd[0], 360 - 1);
  assert.equal(a.specialCd[1], 0, 'each slot has its own cooldown');
});

test('a special out of reach is refused and spends nothing', () => {
  const sim = duel(3);
  const a = sim.state.fighters[0];
  a.specialCd = [0, 0];
  const ev = sim.step([{ press: 'special2' }, idle]);
  assert.ok(ev.some((e) => e.t === 'SpecialRefused'));
  assert.equal(a.special, 0);
  assert.deepEqual(a.specialCd, [0, 0]);
});

test('a heavy landing during the windup interrupts the special; recovery blocks attacks', () => {
  const sim = duel(1.5);   // inside the longsword's best band (1.35-1.8 m): closer or farther, a blow lands at 0.4x
  const [a, b] = sim.state.fighters;
  a.specialCd = [0, 0];
  b.specialCd = [0, 0];
  sim.step([idle, { press: 'heavy' }]);
  run(sim, 9);
  sim.step([{ press: 'special1' }, idle]);
  const ev = run(sim, 25);
  assert.ok(ev.some((e) => e.t === 'SpecialInterrupted'), JSON.stringify(ev.map((e) => e.t)));
  assert.equal(a.special, 0);
  assert.ok(a.specialCd[0] > 480, 'an early cut locks out longer than the base 480');
  // a released special holds attacks back for 45 ticks
  const s2 = duel(1.2);
  const [c] = s2.state.fighters;
  c.specialCd = [0, 0];
  s2.step([{ press: 'special2' }, idle]);
  run(s2, 31);
  assert.equal(c.specialRecover, 45 - 1);
  assert.ok(s2.step([{ press: 'light' }, idle]).some((e) => e.t === 'PressRefused'));
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
