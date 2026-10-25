import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../data/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

test('every data file parses', () => {
  for (const f of files) {
    assert.doesNotThrow(() => JSON.parse(readFileSync(new URL(f, dir), 'utf8')), f);
  }
});

// Armour is a threshold multiplier only; no row may block or grant immunity.
test('no data row has a block or immune field', () => {
  const banned = /"(block|immune)\w*"\s*:/i;
  for (const f of files) {
    assert.ok(!banned.test(readFileSync(new URL(f, dir), 'utf8')), `${f} has a block/immune field`);
  }
});
