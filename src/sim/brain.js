// Opponent brain: reads the sim state, returns an intent. One behaviour row drives
// it (data/behaviours.json). It has its own seeded RNG, so it stays deterministic
// and runs the same on the phone and the server.
import { createRng, next } from './rng.js';

const MIRROR = { left: 'right', right: 'left', overhead: 'overhead', thrust: 'thrust', low: 'low' };
const SIDES = ['thrust', 'left', 'right', 'overhead', 'low'];

export function createBrain(row, seed) {
  return {
    row, rng: createRng(seed),
    wait: row.firstWait, mode: 'approach', modeT: 0, attacked: false,
    threat: null,   // { seen, answer, side, at } for the foe's current swing
  };
}

export function think(brain, sim, me) {
  const { row } = brain;
  const r = () => next(brain.rng);
  const f = sim.state.fighters[me], foe = sim.state.fighters[1 - me];
  const intent = { mx: 0, mz: 0, run: false, press: null, side: null, guard: null, hold: false };
  if (f.phase === 'dead' || foe.phase === 'dead') return intent;

  const dx = foe.x - f.x, dz = foe.z - f.z, gap = Math.hypot(dx, dz) || 1;
  const fx = dx / gap, fz = dz / gap;

  // 1. threat: the foe's swing, noticed after the reaction time
  const swing = foe.phase === 'attack' ? sim.moves[foe.move] : null;
  if (swing && !foe.landed) {
    const t = foe.chained && swing.chained ? { ...swing, ...swing.chained } : swing;
    if (!brain.threat || brain.threat.move !== foe.move || foe.age < brain.threat.age) {
      brain.threat = { move: foe.move, age: foe.age, seen: false, answer: null };
    }
    const th = brain.threat;
    th.age = foe.age;
    if (!th.seen && foe.age >= row.reaction) {
      th.seen = true;
      if (gap <= swing.reach + row.reachSlack && r() >= row.lapse) {
        const roll = r();
        th.answer = !swing.parryable ? 'roll' : roll < row.parry ? 'parry' : roll < row.parry + row.dodge ? 'roll' : 'block';
        th.side = r() < row.read ? MIRROR[swing.direction] : SIDES[Math.floor(r() * SIDES.length)];
        th.jitter = (1 - row.accuracy) * row.jitter * (r() * 2 - 1);
      }
    }
    if (th.answer) {
      const eta = t.windup - foe.age + th.jitter;
      if (th.answer === 'parry' && eta <= row.parryLead && f.phase !== 'guard') {
        intent.press = 'parry'; intent.guard = th.side;
      } else if (th.answer === 'roll' && eta >= row.rollMin && eta <= row.rollMax) {
        intent.press = 'dodge'; intent.mx = fz; intent.mz = -fx;   // sideways
      } else if (th.answer === 'block' || th.answer === 'parry') {
        intent.guard = th.side;
      }
      return intent;
    }
  } else {
    brain.threat = null;
  }

  // 2. offence
  const tired = f.st < row.staminaFloor || f.posture >= row.postureFloor;
  const opening = foe.phase === 'hurt' || foe.exhausted || foe.exposed > 0 ||
    (foe.phase === 'attack' && foe.landed === false && foe.age > (sim.moves[foe.move].windup + sim.moves[foe.move].active));
  const inReach = (id) => gap <= sim.moves[id].reach - row.reachIn;
  if (brain.wait > 0) brain.wait--;
  let pick = null;
  if (f.punish > 0 && f.punishKind === 'critical' && inReach('critical')) pick = 'heavy';
  else if (f.punish > 0 && inReach('slash_riposte')) pick = 'light';
  else if (f.counterWindow > 0 && inReach('heavy_counter')) pick = 'heavy';
  else if (opening && inReach('light_right')) pick = 'light';
  else if (!tired && f.chainWindow > 0 && r() < row.aggression) pick = 'light';
  else if (!tired && brain.wait === 0) {
    if (foe.phase === 'guard') pick = r() < row.kick && inReach('kick') ? 'kick' : 'heavy';
    else pick = r() < row.pressure ? 'light' : brain.attacked && r() < row.thrustShare ? 'thrust' : 'heavy';
    const id = pick === 'heavy' ? 'heavy_overhead' : pick === 'thrust' ? 'thrust' : pick === 'kick' ? 'kick' : 'light_right';
    if (!inReach(id)) pick = null;
  }
  if (pick && (f.phase === 'ready' || f.phase === 'guard')) {
    if (pick !== 'light' && r() < (1 - row.aggression) * row.bait && !f.punish) {
      intent.guard = MIRROR[foe.lastLight] || 'thrust';
    } else {
      intent.press = pick;
      brain.attacked = true;
      brain.wait = Math.round((row.waitBase + r() * row.waitRand) * (row.waitAggro - row.aggression));
    }
    return intent;
  }

  // 3. movement
  if (--brain.modeT <= 0) {
    brain.modeT = Math.round(row.modeEvery + r() * row.modeRand);
    brain.mode = gap > row.far ? 'approach' : gap < row.near ? 'retreat' : r() < row.guardChance ? 'guard' : 'circle';
    brain.dir = r() < 0.5 ? 1 : -1;
  }
  const mode = tired && brain.mode === 'approach' ? 'circle' : brain.mode;
  if (mode === 'approach' && gap > row.close) { intent.mx = fx * row.approach; intent.mz = fz * row.approach; }
  else if (mode === 'retreat') { intent.mx = -fx * row.retreat; intent.mz = -fz * row.retreat; }
  else if (mode === 'circle') { intent.mx = fz * row.circle * brain.dir; intent.mz = -fx * row.circle * brain.dir; }
  else if (mode === 'guard') intent.guard = 'thrust';
  return intent;
}
