// prints the V1 parity table as markdown (for PR bodies): node scripts/parity-table.mjs
import { parityRows, V1 } from '../test/parity.mjs';

console.log(`V1: ${V1.source}\n`);
console.log('| what | V2 measured | V1 trunk | |\n|---|---|---|---|');
for (const [what, v2, v1] of parityRows()) console.log(`| ${what} | ${v2} | ${v1} | ${String(v2) === String(v1) ? 'same' : '**DIFF**'} |`);
