import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const anim = JSON.parse(readFileSync(new URL('../data/anim.json', import.meta.url), 'utf8'));
const rows = (o, path = '') => Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' ? rows(v, `${path}${k}.`) : [[`${path}${k}`, v]]));

test('A1: every blend is a row in milliseconds, and none is above 150 (V1\'s fadeIn / fadeOut / weightRate are gone)', () => {
  for (const k of ['fadeIn', 'fadeOut', 'weightRate', 'rollFadeOut']) assert.ok(!(k in anim), `${k} was replaced by blendMs rows`);
  const blends = rows(anim.blendMs);
  assert.ok(blends.length >= 8, 'a row per transition');
  for (const [name, ms] of blends) assert.ok(ms > 0 && ms <= 150, `blendMs.${name} = ${ms} ms`);
});

test('the transitions Strategy named: locomotion 120, attack in 60-90 and out 80, hit in 40', () => {
  assert.equal(anim.blendMs.locomotion, 120);
  assert.ok(anim.blendMs.attack.in >= 60 && anim.blendMs.attack.in <= 90);
  assert.equal(anim.blendMs.attack.out, 80);
  assert.equal(anim.blendMs.hurt.in, 40);
});

test('the one exception to the cap is named: the roll-to-run settle', () => {
  assert.deepEqual(Object.keys(anim.settleMs), ['roll']);
  assert.equal(anim.settleMs.roll, 300);
});
