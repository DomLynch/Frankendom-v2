import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const clips = load('../data/clips.json'), S = load('../assets/opentrident/SOURCES.json');

// every file the page loads from the OpenTrident library: the bodies of every set, every clip role, and a library sword
function loaded() {
  const files = new Set();
  for (const set of Object.values(clips.bodySets)) if (typeof set === 'object' && set.player) { files.add(set.player); files.add(set.opponent); }
  for (const row of Object.values(clips.roles)) files.add(row.file);
  if (clips.sword.file && !clips.sword.file.startsWith('./')) files.add(clips.sword.file);
  files.add('assets/weapon-011.glb');   // ?sword=half
  return [...files];
}
const rowFor = (file) => S.rows.filter((r) => file.startsWith(r.prefix)).sort((a, b) => b.prefix.length - a.prefix.length)[0];

test('every file data/clips.json loads from opentrident.org has a SOURCES row', () => {
  for (const f of loaded()) assert.ok(rowFor(f), `${f} has no row in assets/opentrident/SOURCES.json`);
});

test('rows are complete, and no licence is invented for the gladio and hs clips', () => {
  for (const r of S.rows) for (const k of ['prefix', 'kind', 'name', 'origin', 'license']) assert.ok(r[k], `${r.prefix} lacks ${k}`);
  for (const p of ['mixamo/clips/gladio/', 'mixamo/clips/hs/']) assert.equal(S.rows.find((r) => r.prefix === p).license, 'unconfirmed');
});

test('the gladio and hs clips resolve to their own unconfirmed rows, not the Mixamo row', () => {
  assert.equal(rowFor('mixamo/clips/gladio/gl046-gladius-right-overhead-slash.glb').prefix, 'mixamo/clips/gladio/');
  assert.equal(rowFor('mixamo/clips/hs/hs066-kick-right.glb').prefix, 'mixamo/clips/hs/');
  assert.equal(rowFor('mixamo/clips/122340901-great-sword-slash.glb').prefix, 'mixamo/clips/');
});
