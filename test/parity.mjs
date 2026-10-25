// V1 parity harness. It measures timings by running V2's sim, not by reading V2's
// data, and gives V1's expected numbers from the trunk snapshot (test/fixtures/v1-combat.json).
import { readFileSync } from 'node:fs';
import { createSim } from '../src/sim/sim.js';

const load = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
export const V1 = load('./fixtures/v1-combat.json');
const data = { rules: load('../data/rules.json'), moves: load('../data/move-defs.json'), specials: load('../data/specials.json') };
const idle = {};

// V1's live row = the base row with the longsword rv86 overlay merged field by field
export function v1Move(id) {
  const base = V1.moves[id], o = V1.overlay[id] || {};
  return { ...base, ...o, chained: base.chained && { ...base.chained, ...(o.chained || {}) } };
}

// fighters far apart, facing each other along z
function fresh(gap = 6) {
  const sim = createSim(data, 1);
  const [a, b] = sim.state.fighters;
  Object.assign(a, { x: 0, z: 0, heading: 0 });
  Object.assign(b, { x: 0, z: gap, heading: Math.PI });
  return sim;
}
const inFront = (sim, d = 1) => {
  const [a, b] = sim.state.fighters;
  Object.assign(b, { x: a.x + Math.sin(a.heading) * d, z: a.z + Math.cos(a.heading) * d, heading: a.heading + Math.PI });
};

// ticks from the press to back in ready
function total(press, before) {
  const sim = fresh();
  if (before) before(sim);
  sim.step([{ press }, idle]);
  let n = 0;   // ticks spent in the move: ages 0..n-1; the tick it returns to ready isn't one of them
  while (sim.state.fighters[0].phase !== 'ready' && n < 400) { sim.step([idle, idle]); n++; }
  return n;
}

// the press ticks on which a target stepping into reach is hit: [first, count]
function window(press, before) {
  const ticks = [];
  for (let k = 0; k < 120; k++) {
    const sim = fresh();
    if (before) before(sim);
    sim.step([{ press }, idle]);
    let hit = false;
    for (let s = 1; s <= k && !hit; s++) {
      if (s === k) inFront(sim);
      const hung = sim.state.fighters[0].whiffHang > 0;   // a whiffed thrust's hang isn't part of its active window
      hit = sim.step([idle, idle]).some((e) => e.t === 'Hit' || e.t === 'Blocked') && !hung;
      if (s === k && !hit) break;
    }
    if (hit) ticks.push(k);
  }
  return [ticks[0], ticks.length];
}

// an unchained light just finished, so the next light can chain
const afterLight = (sim) => {
  sim.step([{ press: 'light' }, idle]);
  while (sim.state.fighters[0].phase !== 'ready') sim.step([idle, idle]);
  sim.state.fighters[0].st = 100;
};

export function measureMove(press, before) {
  const sim = fresh();
  if (before) before(sim);
  const st0 = sim.state.fighters[0].st;
  sim.step([{ press }, idle]);
  const [windup, active] = window(press, before);
  const t = total(press, before);
  return { windup, active, recovery: t - windup - active, stamina: st0 - sim.state.fighters[0].st };
}
export const measureChainedLight = () => measureMove('light', afterLight);

// the last tick after a light ends at which the next light still chains
export function measureChainWindow() {
  let last = -1;
  for (let d = 0; d < 40; d++) {
    const sim = fresh();
    afterLight(sim);
    for (let i = 0; i < d; i++) sim.step([idle, idle]);
    sim.step([{ press: 'light' }, idle]);
    if (sim.state.fighters[0].chained) last = d;
  }
  return last + 1;   // a window of n ticks allows delays 0..n-1
}

// the defender's phase ages at which an incoming light is answered with `event`
function sweepAges(event, setup) {
  const ages = [];
  for (let r = -40; r <= 20; r++) {
    const sim = fresh(1.2);
    const [, b] = sim.state.fighters;
    b.st = 100;
    let age = null, seen = false;
    for (let s = Math.min(0, r); s <= 22; s++) {
      const i0 = s === 0 ? { press: 'light' } : idle;
      const i1 = setup(s === r, s >= r);
      for (const e of sim.step([i0, i1])) if (e.t === event) { seen = true; age = b.age; }
      if (b.phase === 'roll') { b.rollX = 0; b.rollZ = 0; }   // hold the defender in place: this sweep measures i-frames, not travel
      if (sim.state.fighters[0].landed) break;
    }
    if (seen) ages.push(age);
  }
  return [...new Set(ages)].sort((x, y) => x - y);
}
export const measureRollIframes = () => sweepAges('Dodged', (now) => (now ? { press: 'dodge', mx: 1, mz: 0 } : idle));
export const measureParryAges = () => sweepAges('Parried', (now, held) => (now ? { press: 'parry', guard: 'left' } : held ? { guard: 'left' } : idle));
export function measurePerfectBlockAges() {
  const ages = [];
  for (let r = -20; r <= 20; r++) {
    const sim = fresh(1.2);
    const b = sim.state.fighters[1];
    for (let s = Math.min(0, r); s <= 22; s++) {
      const ev = sim.step([s === 0 ? { press: 'light' } : idle, s === r ? { press: 'parry', guard: 'left' } : s > r ? { guard: 'left' } : idle]);
      const blk = ev.find((e) => e.t === 'Blocked');
      if (blk) { if (blk.perfect) ages.push(b.age); break; }
    }
  }
  return [...new Set(ages)].sort((x, y) => x - y);
}

export function measureRoll() {
  const sim = fresh();
  sim.step([idle, idle]);
  const st0 = sim.state.fighters[0].st;
  sim.step([{ press: 'dodge', mx: 1, mz: 0 }, idle]);
  const cost = st0 - sim.state.fighters[0].st;
  let n = 0;
  while (sim.state.fighters[0].phase !== 'ready' && n < 100) { sim.step([idle, idle]); n++; }
  return { ticks: n, cost };
}

export function measureParryOutcome() {
  const sim = fresh(1.2);
  const [a] = sim.state.fighters;
  for (let s = 0; s <= 22; s++) {
    const ev = sim.step([s === 0 ? { press: 'light' } : idle, s === 15 ? { press: 'parry', guard: 'left' } : s > 15 ? { guard: 'left' } : idle]);
    if (ev.some((e) => e.t === 'Parried')) return { stun: a.stun, posture: a.posture };
  }
  return null;
}

export function measureBlockCost() {
  const sim = fresh(1.2);
  const b = sim.state.fighters[1];
  sim.step([idle, { guard: 'left' }]);
  for (let i = 0; i < 20; i++) sim.step([idle, { guard: 'left' }]);   // well past the parry and perfect-block ticks
  b.st = 100;
  for (let s = 0; s <= 22; s++) if (sim.step([s === 0 ? { press: 'light' } : idle, { guard: 'left' }]).some((e) => e.t === 'Blocked')) return 100 - b.st;
  return null;
}

// the rows the parity test asserts and the table prints: [what, V2 measured, V1 trunk]
export function parityRows() {
  const R = V1.rules, rows = [];
  for (const [label, press, id] of [['light', 'light', 'light_right'], ['heavy', 'heavy', 'heavy_overhead'], ['stab', 'thrust', 'thrust'], ['kick', 'kick', 'kick']]) {
    const m = measureMove(press), v = v1Move(id);
    // measured with nothing in reach, so a thrust whiffs and adds V1's whiff hang (rules-defs stopHit.whiff)
    const rec = v.recovery + (id === 'thrust' ? R['stopHit.whiff'] : 0);
    rows.push([`${label} wind-up / active / recovery${id === 'thrust' ? ' (whiffed)' : ''}`, `${m.windup}/${m.active}/${m.recovery}`, `${v.windup}/${v.active}/${rec}`]);
    rows.push([`${label} stamina`, m.stamina, v.stamina]);
  }
  const c = measureChainedLight(), vc = v1Move('light_right').chained;
  rows.push(['chained light wind-up / active / recovery', `${c.windup}/${c.active}/${c.recovery}`, `${vc.windup}/${vc.active}/${vc.recovery}`]);
  // V1 sets the window as the attack ends (duel.ts:421) and counts every window down at the start of each tick before
  // actions (duel.ts:309), so `window` 18 lets a chained light come on the 17 ticks after the end
  rows.push(['light combo window (ticks a chained press can land)', measureChainWindow(), V1.moves.light_right.chainWindow - 1]);
  const roll = measureRoll();
  rows.push(['roll ticks', roll.ticks, R.roll], ['roll stamina', roll.cost, R.rollCost]);
  const ifr = measureRollIframes();
  rows.push(['roll i-frames (ages)', `${ifr[0]}-${ifr.at(-1)}`, `${R.safeStart}-${R.safeEnd}`]);
  const par = measureParryAges();
  rows.push(['parry window (guard ages)', `${par[0]}-${par.at(-1)}`, `0-${R.parry - 1}`]);
  const pb = measurePerfectBlockAges();
  rows.push(['perfect block (guard ages)', `${pb[0]}-${pb.at(-1)}`, `${R.parry}-${R.parry + R.perfectBlock - 1}`]);
  const po = measureParryOutcome();
  rows.push(['parried attacker stun', po.stun, R.parryStun], ['parried attacker posture', po.posture, R['posture.parry']]);
  rows.push(['block stamina vs a light', measureBlockCost(), V1.moves.light_right.staminaDamage]);
  rows.push(['health', createSim(data, 1).state.fighters[0].hp, V1.pools.health], ['stamina max', createSim(data, 1).state.fighters[0].st, V1.pools.stamina]);
  return rows;
}
