import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parityRows, V1 } from './parity.mjs';

// V2's sim, measured by input scripts, must match V1 live (the fixture's commit) on every row
test(`V2 timings and costs match V1 (${V1.source.split(' @ ')[1].split(':')[0]})`, () => {
  const diffs = parityRows().filter(([, v2, v1]) => String(v2) !== String(v1));
  assert.deepEqual(diffs, [], diffs.map(([w, v2, v1]) => `${w}: V2 ${v2} vs V1 ${v1}`).join('\n'));
});
