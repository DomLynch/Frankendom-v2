// A map of where a swing lands: the attacker stands at the origin facing +z and throws one move; every cell is a target
// standing still there. '#' = hit (with its zone letter), '.' = miss. Run: node scripts/hit-map.mjs [light|heavy|thrust|kick]
import { readFileSync } from 'node:fs';
import { createSim } from '../src/sim/sim.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../data/${f}.json`, import.meta.url), 'utf8'));
const data = { rules: load('rules'), moves: load('move-defs'), specials: load('specials'), blades: load('blades') };
const press = process.argv[2] || 'light';
const idle = {};

for (let z = 2.4; z >= 0.8; z -= 0.2) {
  let row = z.toFixed(1).padStart(4) + ' ';
  for (let x = -1.4; x <= 1.4; x += 0.2) {
    const sim = createSim(data, 1);
    const [a, b] = sim.state.fighters;
    Object.assign(a, { x: 0, z: 0, heading: 0 });
    Object.assign(b, { x, z, heading: Math.atan2(-x, -z) });
    let zone = null;
    for (let t = 0; t < 70 && !zone; t++) {
      const ev = sim.step([t === 0 ? { press } : idle, idle]);
      const hit = ev.find((e) => e.t === 'Hit');
      if (hit) zone = (hit.loc || '?')[0];
    }
    row += zone || '.';
  }
  console.log(row);
}
console.log('     ' + [-1.4, -1, -0.6, -0.2, 0.2, 0.6, 1, 1.4].map((v) => String(v).padStart(4)).join('') + '   (x, metres; the attacker starts at 0,0)');
