import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { SCHEMA, validateAll, validateFile } from '../src/sim/validate.js';

const dir = new URL('../data/', import.meta.url);
const files = Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith('.json'))
  .map((f) => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(new URL(f, dir), 'utf8'))]));
const clone = (x) => JSON.parse(JSON.stringify(x));

test('every data file has a schema and the whole set validates', () => {
  for (const name of Object.keys(files)) assert.ok(SCHEMA[name], `${name} has a schema`);
  assert.deepEqual(validateAll(files), []);
});

test('an unknown key in a move row is rejected', () => {
  const bad = clone(files['move-defs']);
  bad.moves[0].dammage = 99;
  assert.match(validateFile('move-defs', bad).join('\n'), /light_right\)\.dammage: unknown key/);
});

test('an armour block or immune field is rejected anywhere', () => {
  const bad = clone(files['fighter-plain']);
  bad.gear.helmet = { class: 'helmet', block: true };
  bad.units.head.immune = 1;
  const errs = validateFile('fighter-plain', bad).join('\n');
  assert.match(errs, /gear\.helmet\.block: armour may not block/);
  assert.match(errs, /units\.head\.immune: armour may not block/);
});

test('the default bodies must be on the 106-joint rig', () => {
  const bad = { ...files, clips: clone(files.clips) };
  bad.clips.bodySets.mixamo = { rig: 'mixamorig-54', player: 'a.glb', opponent: 'b.glb' };
  bad.clips.bodySet = 'mixamo';
  const errs = validateAll(bad).join('\n');
  assert.match(errs, /default bodies must be on the 106-joint rig/);
  assert.match(errs, /bodySets\.mixamo: every body must be on the 106-joint rig/);
});

test('broken links between files are rejected', () => {
  const bad = { ...files, specials: clone(files.specials), clips: clone(files.clips), 'move-defs': clone(files['move-defs']) };
  bad.specials.slots[0].move = 'skill_nothing';
  bad.clips.paths.thrust = 'NoSuchRole';
  bad['move-defs'].moves[0].windup = 20.5;
  const errs = validateAll(bad).join('\n');
  assert.match(errs, /specials\.special1: no move "skill_nothing"/);
  assert.match(errs, /clips\.paths\.thrust: no role "NoSuchRole"/);
  assert.match(errs, /light_right\.windup: whole ticks only/);
});
