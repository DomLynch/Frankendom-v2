// The V1-port brain (src/sim/brain.js): determinism, bouts finish, the specials, and the habit reads V1's ai.ts adapts to.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bout, data } from '../scripts/ai-lib.mjs';
import { SCHEMA, validateFile } from '../src/sim/validate.js';

const count = (log, pred) => log.filter(([, e]) => pred(e)).length;
const undying = (sim) => { sim.state.fighters[1].hp = 1e9; };   // the dummy outlasts the sample
const plain = { brain: 'hard', with: { specials: 0 } };          // no special casts, so the sample shows the reads

test('same seed, same brains -> identical log and state; a different seed differs', () => {
  const a = bout({ brain: 'normal' }, { brain: 'hard' }, 11, 3000), b = bout({ brain: 'normal' }, { brain: 'hard' }, 11, 3000);
  assert.deepEqual(a.log, b.log);
  assert.equal(JSON.stringify(a.state.fighters), JSON.stringify(b.state.fighters));
  assert.ok(count(a.log, (e) => e.t === 'Swing') > 3, 'they fight');
  assert.notDeepEqual(a.log, bout({ brain: 'normal' }, { brain: 'hard' }, 12, 3000).log);
});

test('brain vs brain finishes within three minutes on every rank, over several seeds', () => {
  for (const rank of ['easy', 'normal', 'hard']) {
    for (let seed = 1; seed <= 4; seed++) {
      const r = bout({ brain: rank }, { brain: rank }, seed, 60 * 180);
      assert.ok(r.state.over, `${rank} seed ${seed} finished`);
    }
  }
});

test('a brain beats an idle dummy', () => {
  assert.equal(bout({ brain: 'hard' }, { dummy: 'idle' }, 5, 60 * 120).winner, 0);
});

test('a ready special is cast when the foe is in reach, and only then', () => {
  const r = bout({ brain: 'easy' }, { dummy: 'idle' }, 2, 60 * 20, undying);
  assert.ok(count(r.log, (e) => e.t === 'SpecialStarted' && e.f === 0) >= 1, 'it casts');
  const off = bout({ brain: 'easy', with: { specials: 0 } }, { dummy: 'idle' }, 2, 60 * 20, undying);
  assert.equal(count(off.log, (e) => e.t === 'SpecialStarted'), 0, 'the knob turns it off');
});

test('a turtle is read, and a charged heavy goes through his guard', () => {
  const r = bout(plain, { dummy: 'turtle' }, 1, 60 * 40, undying);
  assert.equal(r.players[0].brain.reads.turtle, true, 'guard share over the read window');
  assert.ok(count(r.log, (e) => e.t === 'Swing' && e.f === 0 && e.move === 'heavy_overhead') >= 5, 'heavies at the guard');
  assert.ok(count(r.log, (e) => e.t === 'GuardBroken' && e.a === 0) >= 3, 'and the guard breaks');
});

test('a roller is read, and swings are thrown into the tail of his roll', () => {
  const r = bout(plain, { dummy: 'roller' }, 3, 60 * 40, undying);
  assert.equal(r.players[0].brain.reads.roller, true);
  assert.ok(count(r.log, (e) => e.t === 'Dodged' && e.d === 1) >= 1, 'he does roll through its swings');
  assert.ok(count(r.log, (e) => e.t === 'Hit' && e.a === 0) >= 3, 'and still gets hit');
});

test('a light spammer is read and parried more', () => {
  const r = bout(plain, { dummy: 'spammer' }, 3, 60 * 40, undying);
  assert.equal(r.players[0].brain.reads.spammer, true, 'lights over 70 % of 11 swings');
  assert.ok(count(r.log, (e) => e.t === 'Parried' && e.d === 0) >= 1, 'it parries the cuts');
});

test('a parry-happy player is read and drawn with feints', () => {
  const r = bout(plain, { dummy: 'parrier' }, 3, 60 * 40, undying);
  assert.equal(r.players[0].brain.reads.parryHappy, true, 'parries over half of its swings');
  assert.ok(count(r.log, (e) => e.t === 'Feint' && e.f === 0) >= 1, 'a feint draws the press and meets nothing');
});

test('a man who stands still reads as nothing', () => {
  const reads = bout(plain, { dummy: 'idle' }, 1, 600, undying).players[0].brain.reads;
  assert.ok(!reads.parryHappy && !reads.turtle && !reads.roller && !reads.spammer);
});

test('behaviours data: closed key sets for the dials, the read table and the rows', () => {
  assert.ok(SCHEMA.behaviours.maps.dials.includes('waitBase'));
  const bad = JSON.parse(JSON.stringify(data.behaviours));
  bad.dials.waitBse = 1; bad.read.nope = 1; bad.brains[0].reactoin = 3; bad.surprise = 1;
  const errs = validateFile('behaviours', bad).join('\n');
  for (const k of ['dials.waitBse', 'read.nope', 'reactoin', 'behaviours.surprise']) assert.match(errs, new RegExp(k));
  assert.deepEqual(validateFile('behaviours', data.behaviours), []);
});

test('the easy row keeps V1\'s profile (moves-tables-defs.json:4-13)', () => {
  const easy = data.behaviours.brains.find((b) => b.id === 'easy');
  assert.deepEqual([easy.reaction, easy.accuracy, easy.parry, easy.dodge, easy.aggression, easy.discipline, easy.lapse, easy.read], [24, 0.5, 0.1, 0.1, 0.45, 60, 0.45, 0.5]);
});
