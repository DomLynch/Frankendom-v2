// The duel sim. Fixed 60 Hz, deterministic: the same seed and intent stream give
// the same state and events on any machine. Pure: no DOM, no clock, no Math.random.
// The phone runs it locally, and the server will import this same file.
//
// Intent per fighter per tick:
//   { mx, mz }      world-space move, length 0..1 (the brain's; also a roll's direction)
//   { sf, ss }      the stick as the walk reads it: forward (back is capped) and strafe to the right, each -1..1; wins over mx, mz
//   run             sprint held
//   press           edge action this tick: 'light' | 'heavy' | 'thrust' | 'kick' | 'parry' | 'dodge' | 'backstep' | null
//   side            for 'light': 'left' | 'right' (null = alternate)
//   guard           held guard side: 'thrust' (straight) | 'left' | 'right' | 'overhead' | 'low' | null
//   hold            the strike is still held (a swing parks at its chamber tick; a parked heavy charges)
//
// Each tick does three things in order. Actions are decided from the pre-tick
// state. Then phases advance and bodies move. Then contacts resolve against a
// snapshot, so trades land both ways.
import { createRng } from './rng.js';

const MIRROR = { left: 'right', right: 'left', overhead: 'overhead', thrust: 'thrust', low: 'low' };
const HEAVY_CLASS = new Set(['heavy_overhead', 'heavy_riposte', 'heavy_counter', 'critical']);

export function createSim(data, seed = 1) {
  const specials = data.specials || { cooldown: 0, slots: [] };
  const R = { ...data.rules, specials, blades: data.blades || null };   // no blades = the plain reach-disc hit test (timing harnesses only)
  const moves = Object.fromEntries(data.moves.moves.map((m) => [m.id, m]));
  const gap = R.body.spawnGap / 2;
  const state = {
    tick: 0,
    rng: createRng(seed),
    over: false,
    fighters: [makeFighter(R, 0, -gap, 0), makeFighter(R, 0, gap, Math.PI)],
  };
  return { state, moves, rules: R, specials, step: (intents) => step(state, intents, moves, R) };
}

function makeFighter(R, x, z, heading) {
  return {
    x, z, heading,
    hp: R.health, st: R.stamina.max, maxSt: R.stamina.max, wound: 0, legWound: false, attackFrom: null, loiter: 0, lashed: false,
    posture: 0, postureHold: 0, rest: 0, exhausted: false,
    phase: 'ready', age: 0, fresh: false, stun: 0, hurtKind: null, chainFrom: null,
    move: null, chained: false, landed: false, parked: 0, charged: false, whiffHang: 0, hung: false,
    guardSide: null, parrying: false, parryCd: 0, exposed: 0,
    // a special: per-slot cooldowns (ready `first` ticks into the fight), the cast's windup left, its slot, damage taken while
    // casting, pushbacks used, and the recovery after release in which no attack is legal
    specialCd: (R.specials.slots || []).map(() => R.specials.first || 0), special: 0, castSlot: -1, castHurt: 0, castPush: 0, specialRecover: 0,
    punish: 0, punishKind: null, counterWindow: 0, chainWindow: 0, lastLight: 'left', evadeEnd: 99,
    buffer: null, rollX: 0, rollZ: 0, speed: 0, moved: 0, sprinted: false,
  };
}

// ---------- helpers ----------

const angleTo = (a, b) => Math.atan2(b.x - a.x, b.z - a.z);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const turnToward = (from, to, max) => from + Math.max(-max, Math.min(max, wrap(to - from)));
const dist = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);
const offFacing = (f, other) => Math.abs(wrap(angleTo(f, other) - f.heading));

function timing(m, f) {
  const t = f.chained && m.chained ? { ...m, ...m.chained } : m;
  return { windup: t.windup, active: t.active, recovery: t.recovery };
}
const attackTotal = (m, f) => { const t = timing(m, f); return t.windup + t.active + t.recovery; };

function spend(f, R, n) {
  f.st -= n;
  f.rest = R.stamina.regenDelay;
  if (f.st <= 0) { f.st = 0; f.exhausted = true; }
}

function gainPosture(f, n) {
  f.posture += n;
  f.postureHold = 0;
}

// a phase is age 0 on the tick it is entered; ages count from the next tick
function enter(f, phase) {
  f.phase = phase;
  f.age = 0;
  f.fresh = true;
}

function bump(f) {
  if (f.fresh) f.fresh = false;
  else f.age++;
}

// committed phases that may buffer a press in their last ticks
function remaining(f, moves, R) {
  if (f.phase === 'attack') return attackTotal(moves[f.move], f) - f.age;
  if (f.phase === 'roll') return R.roll.ticks - f.age;
  if (f.phase === 'backstep') return R.backstep.ticks - f.age;
  if (f.phase === 'hurt') return f.stun;
  return Infinity;
}

// ---------- step ----------

function step(state, intents, moves, R) {
  const events = [];
  if (state.over) return events;
  state.tick++;
  const [a, b] = state.fighters;
  const hpBefore = [a.hp, b.hp];
  const pre = [placeOf(a), placeOf(b)];   // where each stood when the tick began: bodies move against these, and blades sweep from them

  for (const [f, foe, i] of [[a, b, 0], [b, a, 1]]) decide(f, foe, intents[i] || {}, moves, R, events, i);
  for (const [f, foe, i] of [[a, b, 0], [b, a, 1]]) advance(f, pre[1 - i], intents[i] || {}, moves, R);
  separate(a, b, R);
  loiter(a, b, 0, R, events, state.over);
  loiter(b, a, 1, R, events, state.over);

  const snap =[structuredCloneLite(a), structuredCloneLite(b)];
  contact(a, b, snap[0], snap[1], 0, moves, R, events, pre);
  contact(b, a, snap[1], snap[0], 1, moves, R, events, pre);
  specials(state.fighters, hpBefore, moves, R, events);

  for (const [f, foe, i] of [[a, b, 0], [b, a, 1]]) upkeep(f, foe, i, R, events);
  if (a.hp <= 0 || b.hp <= 0) state.over = true;
  return events;
}

function structuredCloneLite(f) {
  return { x: f.x, z: f.z, heading: f.heading, phase: f.phase, age: f.age, move: f.move, chained: f.chained, parrying: f.parrying, guardSide: f.guardSide, charged: f.charged, parked: f.parked, attackFrom: f.attackFrom, exhausted: f.exhausted, charge: f.parked, stun: f.stun };
}
const placeOf = (f) => ({ x: f.x, z: f.z, heading: f.heading });

// ---------- 1. decide ----------

function resolvePress(f, press, intent) {
  if (press === 'light') {
    if (f.punish > 0) return 'slash_riposte';
    const side = intent.side || (f.lastLight === 'right' ? 'left' : 'right');
    return side === 'left' ? 'light_left' : 'light_right';
  }
  if (press === 'heavy') {
    if (f.punish > 0) return f.punishKind === 'critical' ? 'critical' : 'heavy_riposte';
    if (f.counterWindow > 0) return 'heavy_counter';
    return 'heavy_overhead';
  }
  if (press === 'thrust') return f.punish > 0 ? 'riposte' : 'thrust';
  if (press === 'kick') return 'kick';
  return null;
}

function legal(f, press, moveId, moves, R) {
  if (f.hp <= 0 || f.exhausted || f.special > 0) return false;   // nothing is legal during a special's windup
  const standing = f.phase === 'ready' || f.phase === 'guard';
  const backTail = f.phase === 'backstep' && f.age >= R.backstep.cancelFrom;
  if (f.specialRecover > 0 && moveId) return false;   // the special's recovery: no attack until it ends (guard, roll, steps stay legal)
  if (moveId === 'kick') return standing && f.st >= moves.kick.stamina;
  if (moveId) return (standing || backTail) && f.st >= moves[moveId].stamina;
  if (press === 'dodge') return (standing && f.st >= R.roll.cost) || (f.phase === 'backstep' && f.st >= R.roll.cost - R.backstep.cost);
  if (press === 'backstep') return standing && f.st >= R.backstep.cost;
  if (press === 'parry') return standing && f.exposed === 0;
  return false;
}

function decide(f, foe, intent, moves, R, events, i) {
  if (f.phase === 'dead') return;
  let press = intent.press || null;
  let fromBuffer = false;
  if (!press && f.buffer) {
    press = f.buffer.press;
    intent = { ...intent, side: f.buffer.side };
    fromBuffer = true;
  }

  // feint: a guard press early in a swing turns it into a guard
  if (press === 'parry' && f.phase === 'attack' && f.age < moves[f.move].feintUntil && f.st >= R.feint.cost && !f.exhausted) {
    spend(f, R, R.feint.cost);
    raiseGuard(f, intent.guard || 'thrust', R, true);
    f.buffer = null;
    events.push({ t: 'Feint', f: i });
    return;
  }

  const slot = press ? R.specials.slots.findIndex((s) => s.press === press) : -1;
  if (slot >= 0) {
    castSpecial(f, foe, slot, R, events, i);
  } else if (press) {
    const moveId = resolvePress(f, press, intent);
    if (legal(f, press, moveId, moves, R)) {
      f.buffer = null;
      if (moveId) startAttack(f, foe, moveId, moves, R, events, i);
      else if (press === 'dodge') startRoll(f, foe, intent, R, f.phase === 'backstep');
      else if (press === 'backstep') {
        // cornered, the wall is behind the step: the press is refused and costs nothing (a roll still works) (V1 duel.ts:359)
        if (walled(f, -Math.sin(f.heading), -Math.cos(f.heading), R)) events.push({ t: 'PressRefused', f: i, press });
        else { spend(f, R, R.backstep.cost); enter(f, 'backstep'); f.parrying = false; f.guardSide = null; }
      }
      else if (press === 'parry') raiseGuard(f, intent.guard || 'thrust', R, true);
    } else if (!fromBuffer) {
      if (remaining(f, moves, R) <= R.buffer.window) f.buffer = { press, side: intent.side || null, ttl: R.buffer.ttl };
      else events.push({ t: 'PressRefused', f: i, press });
    }
  }

  // held guard without a fresh press (never during a special's windup)
  if (f.special > 0) return;
  if (f.phase === 'ready' && intent.guard && f.exposed === 0 && !f.exhausted) raiseGuard(f, intent.guard, R, false);
  if (f.phase === 'guard' && intent.guard) f.guardSide = intent.guard;   // the window closing and the guard dropping are advance()'s (V1 duel.ts:405)
}

// V1 duel.ts:287,363-380: a special press commits a cast from standing (or the backstep tail) when its slot has cooled; out of
// reach it is refused and nothing is spent. No stamina: a melee special costs only its cooldown, spent on release.
function castSpecial(f, foe, slot, R, events, i) {
  const S = R.specials, row = S.slots[slot];
  const standing = f.phase === 'ready' || f.phase === 'guard';
  const backTail = f.phase === 'backstep' && f.age >= R.backstep.cancelFrom;
  if (f.hp <= 0 || f.exhausted || f.special > 0 || f.specialRecover > 0 || f.specialCd[slot] > 0 || !(standing || backTail)) {
    events.push({ t: 'PressRefused', f: i, press: row.press });
    return;
  }
  if (dist(f, foe) > S.reach) { events.push({ t: 'SpecialRefused', f: i, skill: row.skill, cue: 'far' }); return; }
  f.special = S.windup;
  f.castSlot = slot;
  f.castHurt = 0;
  f.castPush = 0;
  f.buffer = null;
  enter(f, 'ready');
  f.parrying = false;
  f.guardSide = null;
  events.push({ t: 'SpecialStarted', f: i, skill: row.skill, move: row.move });
}

// V1 duel.ts:641-692, 740-760: releases first (both sides judged before either lands), then every windup still running counts
// down, is pushed back by a hit, or is cut by enough damage
function specials(fighters, hpBefore, moves, R, events) {
  const S = R.specials;
  const releasing = fighters.map((f) => f.special === 1);
  fighters.forEach((A, i) => {
    if (!releasing[i]) return;
    const D = fighters[1 - i], row = S.slots[A.castSlot];
    A.special = 0;
    A.specialCd[A.castSlot] = S.cooldown;
    A.specialRecover = S.recovery;
    if (D.hp <= 0 || D.phase === 'dead') return;
    if (dist(A, D) > S.reach + S.slack) { events.push({ t: 'SpecialFizzled', f: i, skill: row.skill }); return; }
    const damage = Math.round(S.share * R.health);
    D.hp = Math.max(0, D.hp - damage);
    events.push({ t: 'SpecialLanded', a: i, d: 1 - i, skill: row.skill, move: row.move, dmg: damage, heavy: true });
    if (D.hp > 0) {
      const m = moves[row.move], away = angleTo(A, D);
      const steps = Math.round(m.knockback * S.react.knock / 100), k = steps * R.move.knockbackSpeed / R.tickHz;
      D.x += Math.sin(away) * k;
      D.z += Math.cos(away) * k;
      const stun = Math.max(D.phase === 'hurt' ? D.stun : 0, Math.round(m.stagger * S.react.stagger / 100), S.staggerFloor[row.skill] || 0);
      hurt(D, stun, 'hit');
      gainPosture(D, m.posture * S.react.posture / 100);
    }
  });
  fighters.forEach((A, i) => {
    if (!A.special) return;
    if (A.hp <= 0) { A.special = 0; events.push({ t: 'SpecialFizzled', f: i }); return; }
    const took = Math.max(0, hpBefore[i] - A.hp);
    if (took) {
      A.castHurt += took;
      if (A.castHurt >= S.interruptAt * R.health) {
        const left = Math.min(A.special, S.windup);
        A.specialCd[A.castSlot] = Math.round((S.interruptCooldown * (1000 + (S.interruptEarly * left) / S.windup)) / 1000);
        A.special = 0;
        events.push({ t: 'SpecialInterrupted', f: i, dmg: A.castHurt });
        return;
      }
      if (A.castPush < S.pushbackMax) { A.special += S.pushback; A.castPush++; }
    }
    A.special--;
  });
}

function raiseGuard(f, side, R, fresh) {
  const opens = fresh && f.parryCd === 0;
  enter(f, 'guard');
  f.guardSide = side;
  f.parrying = opens;
  if (opens) f.parryCd = R.parry.cooldown;
  else f.age = R.parry.window;   // no fresh parry: it starts past the parry window, so its first ticks are the perfect block (V1 duel.ts:404)
  f.move = null;
}

function dropGuard(f) {
  enter(f, 'ready');
  f.parrying = false;
  f.guardSide = null;
}

function startAttack(f, foe, moveId, moves, R, events, i) {
  const m = moves[moveId];
  const isLight = moveId === 'light_left' || moveId === 'light_right';
  // a listed follow-up inside the chain window, or a light out of an evade (a roll just ended, or a backstep still running: V1 duel.ts:389)
  const evading = isLight && (f.evadeEnd <= R.roll.dodgeAttackWindow || f.phase === 'backstep');
  f.chained = !!m.chained && (f.chainWindow > 0 || evading);
  if (f.chained && f.chainFrom && f.chainWindow > 0 && !(moves[f.chainFrom].chain?.follow || []).includes(moveId)) f.chained = evading;
  spend(f, R, m.stamina);
  f.attackFrom = { x: f.x, z: f.z, gap: dist(f, foe) };   // where the swing began: the bands read the gap, the stop-hit reads the point
  enter(f, 'attack');
  f.move = moveId;
  f.landed = false;
  f.parked = 0;
  f.charged = false;
  f.whiffHang = 0;
  f.hung = false;
  f.parrying = false;
  f.guardSide = null;
  f.heading = turnToward(f.heading, angleTo(f, foe), R.turn.start);
  if (isLight) f.lastLight = m.direction;
  if (moveId === 'slash_riposte' || moveId === 'riposte' || moveId === 'heavy_riposte' || moveId === 'critical') { f.punish = 0; f.punishKind = null; }
  if (moveId === 'heavy_counter') f.counterWindow = 0;
  f.chainWindow = 0;
  events.push({ t: 'Swing', f: i, move: moveId, chained: f.chained });
}

function startRoll(f, foe, intent, R, fromBackstep) {
  spend(f, R, fromBackstep ? R.roll.cost - R.backstep.cost : R.roll.cost);
  const mag = Math.hypot(intent.mx || 0, intent.mz || 0);
  if (mag > 0) { f.rollX = intent.mx / mag; f.rollZ = intent.mz / mag; }
  else { const away = angleTo(foe, f); f.rollX = Math.sin(away); f.rollZ = Math.cos(away); }
  enter(f, 'roll');
  f.parrying = false;
  f.guardSide = null;
}

// ---------- 2. advance ----------

// foe = where the other fighter stood when the tick began: every step is blocked against that, so neither is favoured by order
function advance(f, foe, intent, moves, R) {
  f.moved = 0;
  f.vx = f.vz = 0;   // how fast the body walked this tick (m/s, world frame): the renderer reads it for the gait
  f.sprinted = false;
  if (f.phase === 'dead') return;
  const dt = 1 / R.tickHz;
  const pace = R.move.pace;
  const stepTo = (dx, dz, mps) => stepBody(f, foe, dx, dz, mps * dt, R);

  if (f.phase === 'attack') {
    const m = moves[f.move], t = timing(m, f);
    const parks = m.chamber != null && !f.chained && intent.hold && f.age === m.chamber && f.parked < R.charge.max;
    if (parks) {
      f.parked++;
      if (m.charges && f.parked >= R.charge.min) f.charged = true;
    } else if (f.whiffHang > 0) {
      f.whiffHang--;
    } else {
      bump(f);
    }
    if (f.age < t.windup && m.id !== 'kick') f.heading = turnToward(f.heading, angleTo(f, foe), R.turn.windup);
    if (f.age > R.stepInFrom && f.age < t.windup && !parks) stepTo(Math.sin(f.heading) * m.stepIn, Math.cos(f.heading) * m.stepIn, pace);
    if (f.age >= t.windup + t.active + t.recovery) {
      if (!f.chained && m.chain) { f.chainWindow = m.chain.window; f.chainFrom = m.id; }
      enter(f, 'ready');
      f.move = null;
    }
    // rooted through the wind-up and the active ticks only: the walk is free again in recovery
    if (f.phase === 'attack' && R.move.recoveryWalk && f.age >= t.windup + t.active) walkBody(f, foe, intent, R, dt);
    return;
  }
  if (f.phase === 'roll' || f.phase === 'backstep') {
    bump(f);
    const roll = f.phase === 'roll';
    if (f.age >= (roll ? R.roll.ticks : R.backstep.ticks)) { enter(f, 'ready'); f.evadeEnd = 0; return; }
    if (roll) {
      if (stepTo(f.rollX, f.rollZ, R.move.run)) f.heading = Math.atan2(f.rollX, f.rollZ);
    } else {
      stepTo(-Math.sin(f.heading) * R.backstep.speed, -Math.cos(f.heading) * R.backstep.speed, pace);
    }
    return;
  }
  if (f.phase === 'hurt') {
    bump(f);
    if (--f.stun <= 0) { enter(f, 'ready'); f.hurtKind = null; }
    if (R.move.staggerWalk) walkBody(f, foe, intent, R, dt);
    return;
  }

  // ready / guard: the parry window closing, then walk, strafe, sprint
  bump(f);
  if (f.phase === 'guard') {
    // V1 duel.ts:405-407: a parry that met nothing: when its window closes the guard stops parrying; if the thumb has let go by then
    // (and no riposte is open) the fighter is exposed. A guard still held at that moment is simply the standing guard.
    if (f.parrying && f.age >= R.parry.window) {
      f.parrying = false;
      if (!f.punish && !intent.guard) { dropGuard(f); f.exposed = R.parry.recovery; }
    }
    if (f.phase === 'guard' && !intent.guard && f.age >= R.parry.window) dropGuard(f);
  }
  walkBody(f, foe, intent, R, dt);
}

// V1 origins/preview/main.ts:434-463: the page's walk. The stick splits into forward (back capped) and strafe (reduced), both doubled when
// running, at the walk speed; the heading is pulled to the foe (lockPull), never snapped; the body is held out of the foe's ring and the wall.
function walkBody(f, foe, intent, R, dt) {
  const M = R.move, sh = Math.sin(f.heading), ch = Math.cos(f.heading);
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  // forward / strafe-right in the stick's own terms; a world-space move (the brain's) is split against the heading
  const sf = intent.sf != null ? intent.sf : (intent.mx || 0) * sh + (intent.mz || 0) * ch;
  const ss = intent.ss != null ? intent.ss : -(intent.mx || 0) * ch + (intent.mz || 0) * sh;
  const running = !!intent.run && Math.hypot(sf, ss) > 0;
  const k = running ? 2 : 1, ground = running ? M.run / 2 : M.walk;
  const fw = clamp(sf, -M.back, 1) * k, sd = clamp(ss, -1, 1) * M.strafe * k;
  const gap0 = dist(f, foe), x0 = f.x, z0 = f.z;
  const dx = sh * fw - ch * sd, dz = ch * fw + sh * sd;
  const moved = fw || sd ? stepBody(f, foe, dx * ground, dz * ground, dt, R, false) : false;
  f.vx = (f.x - x0) / dt;
  f.vz = (f.z - z0) / dt;
  f.speed = Math.hypot(f.vx, f.vz);
  if (running && moved) {
    f.sprinted = true;
    f.st = Math.max(0, f.st - R.stamina.sprintCost);
    f.rest = Math.max(f.rest, 1);
    if (f.st <= 0 && R.stamina.sprintCost > 0) f.exhausted = true;
  }
  // anti-turtling: a tick that opens the gap to the foe by more than `away`, near the wall, regenerates nothing (V1 duel.ts:448)
  if (moved && dist(f, foe) - gap0 > R.retreat.away && Math.hypot(f.x, f.z) >= R.body.arenaRadius - R.wall.band) f.rest = Math.max(f.rest, 1);
  f.heading += wrap(angleTo(f, foe) - f.heading) * (1 - Math.exp(-M.turnPull * dt));
}

// V1 sim.ts advance(): one step along (dx, dz) (length capped at 1) at `speed` m/s x dt, pushed out of the other body's 0.85 m
// ring, held inside the wall, and refused if that still leaves it in the ring. Returns whether the body moved.
function stepBody(f, foe, dx, dz, d, R, cap = true) {
  const length = Math.hypot(dx, dz);
  if (!length || !Number.isFinite(length)) return false;
  const k = cap ? Math.min(1, length) / length : 1;
  let x = f.x + dx * k * d, z = f.z + dz * k * d;
  const tx = x - foe.x, tz = z - foe.z, gap = Math.hypot(tx, tz), min = R.body.spacing;
  if (gap < min) {
    const a = gap > 1e-5 ? Math.atan2(tx, tz) : f.heading + Math.PI;
    x = foe.x + Math.sin(a) * min;
    z = foe.z + Math.cos(a) * min;
  }
  const r = Math.hypot(x, z);
  if (r > R.body.arenaRadius) { x *= R.body.arenaRadius / r; z *= R.body.arenaRadius / r; }
  if (Math.hypot(x - foe.x, z - foe.z) < min - 1e-8) return false;
  f.moved += Math.hypot(x - f.x, z - f.z);
  f.x = x; f.z = z;
  return true;
}

// V1 duel.ts:490-505, the lorarii: camping on the wall is whipped. Attacking, leaving the band or dying resets the clock.
function loiter(f, foe, i, R, events, over) {
  const L = R.wall.loiter, r = Math.hypot(f.x, f.z);
  const still = f.hp > 0 && !over && r >= R.body.arenaRadius - R.wall.band && f.phase !== 'attack' && f.phase !== 'dead';
  f.loiter = still ? f.loiter + 1 : 0;
  if (!still) f.lashed = false;
  const lead = f.lashed ? L.raiseAgain : L.raise;
  if (still && f.loiter === L.ticks - lead) events.push({ t: 'WhipRaised', f: i, lead });
  if (f.loiter < L.ticks) return;
  f.loiter = L.ticks - L.again;   // the next lash comes `again` ticks later while he stays
  f.lashed = true;
  f.hp = Math.max(1, f.hp - L.chip);
  gainPosture(f, L.posture);
  events.push({ t: 'Whipped', f: i, dmg: L.chip });
  // the shove drives him back into the fight: toward the foe when he is near, else toward the centre; a man already at grips is lashed but not moved
  const g = dist(f, foe), toward = g < L.into ? { x: (foe.x - f.x) / g, z: (foe.z - f.z) / g } : { x: -f.x / r, z: -f.z / r };
  if (g >= 1) { f.x += toward.x * L.shove; f.z += toward.z * L.shove; }
}

// at the wall with the direction pointing out of the ring: the wall is behind a step that way (V1 duel.ts:215)
function walled(f, dx, dz, R) {
  return Math.hypot(f.x, f.z) >= R.body.arenaRadius - R.wall.edge && f.x * dx + f.z * dz > 0;
}

function separate(a, b, R) {
  const d = dist(a, b), min = R.body.spacing;
  if (d < min && d > 1e-6) {
    const push = (min - d) / 2, nx = (b.x - a.x) / d, nz = (b.z - a.z) / d;
    a.x -= nx * push; a.z -= nz * push;
    b.x += nx * push; b.z += nz * push;
  }
  for (const f of [a, b]) {
    const r = Math.hypot(f.x, f.z);
    if (r > R.body.arenaRadius) { f.x *= R.body.arenaRadius / r; f.z *= R.body.arenaRadius / r; }
  }
}

// ---------- 3. contact ----------

// V1 sim.ts segmentDistance: the closest approach of two finite segments (a-b and c-d), 3D
function segmentDistance(a, b, c, d) {
  const sub = (p, q) => p.map((v, i) => v - q[i]), dot = (p, q) => p.reduce((s, v, i) => s + v * q[i], 0);
  const mix = (p, q, u) => p.map((v, i) => v + (q[i] - v) * u), clamp = (x) => Math.max(0, Math.min(1, x));
  const u = sub(b, a), v = sub(d, c), w = sub(a, c);
  const aa = dot(u, u), bb = dot(u, v), cc = dot(v, v), dd = dot(u, w), ee = dot(v, w), den = aa * cc - bb * bb;
  let s = aa < 1e-12 ? 0 : cc < 1e-12 ? clamp(-dd / aa) : den > 1e-12 ? clamp((bb * ee - cc * dd) / den) : 0;
  let t = cc < 1e-12 ? 0 : (bb * s + ee) / cc;
  if (t < 0) { t = 0; s = aa < 1e-12 ? 0 : clamp(-dd / aa); }
  else if (t > 1) { t = 1; s = aa < 1e-12 ? 0 : clamp((bb - dd) / aa); }
  return Math.hypot(...sub(mix(a, b, s), mix(c, d, t)));
}

// V1 blade.ts bladeImpact: the baked hilt and tip of the swing at the last tick and this one, in the target's frame; swept in
// 2 cm steps; a blow lands when the blade passes within `radius` of the target's body line. Returns where it landed, or null.
function bladeLocation(Bd, kind, A, D, preA, preD) {
  const frames = Bd.kinds[kind], H = Bd.hit;
  const pose = (age) => {
    const at = Math.max(0, Math.min(frames.length - 1, age)), i = Math.floor(at), j = Math.min(frames.length - 1, i + 1), u = at - i;
    return frames[i].map((v, k) => v + (frames[j][k] - v) * u);
  };
  const world = (p, actor, target) => [0, 3].map((o) => {
    const c = Math.cos(actor.heading), s = Math.sin(actor.heading), x = p[o], y = p[o + 1], z = p[o + 2];
    return [actor.x - target.x + x * c + z * s, y, actor.z - target.z + z * c - x * s];
  });
  const a = world(pose(A.age - 1), preA, preD), b = world(pose(A.age), A, D);
  const mix = (p, q, u) => p.map((v, i) => v + (q[i] - v) * u);
  const steps = Math.max(1, Math.ceil(Math.max(Math.hypot(...a[0].map((v, i) => v - b[0][i])), Math.hypot(...a[1].map((v, i) => v - b[1][i]))) / H.sampleStep));
  for (let i = 0; i <= steps; i++) {
    const start = mix(a[0], b[0], i / steps), end = mix(a[1], b[1], i / steps);
    if (segmentDistance(start, end, [0, H.bodyLow, 0], [0, H.bodyHigh, 0]) > H.radius) continue;
    const regions = [['head', H.bodyHigh, H.bodyHigh], ['torso', H.torsoLow, H.torsoHigh], ['legs', H.bodyLow, H.legsHigh]];
    return regions.map(([name, lo, hi]) => [name, segmentDistance(start, end, [0, lo, 0], [0, hi, 0])]).sort((x, y) => x[1] - y[1])[0][0];
  }
  return null;
}

// the factor on a blow's damage and knockback from the gap at the start of its swing (V1 bands.ts bandFactor, fixed-edge mode)
function bandFactor(R, att) {
  const B = R.bands, g = att.attackFrom && att.attackFrom.gap;
  if (!B || g == null) return 1;
  return (g < B.innerEdge ? 'inner' : g < B.midEdge ? 'mid' : 'outer') === B.best ? 1 : B.off;
}

function contact(att, def, A, D, ai, moves, R, events, pre) {
  if (A.phase !== 'attack' || att.landed || def.phase === 'dead') return;
  const m = moves[A.move], t = timing(m, A);
  if (A.age < t.windup || A.age >= t.windup + t.active) return;
  const di = 1 - ai;
  const kind = A.chained && m.chainPath ? m.chainPath : m.path;
  let loc = null;
  if (kind && R.blades) loc = bladeLocation(R.blades, kind, A, D, pre[ai], pre[di]);
  else if (dist(A, D) <= m.reach && offFacing(A, D) <= (m.id === 'kick' ? R.kickArc : R.hitArc)) loc = 'torso';   // the kick (no blade), or a harness with no blade tables
  if (!loc) {
    // a whiffed thrust hangs once at full extension (it used to re-arm every time the hang ran out, so it never recovered)
    if (m.id === 'thrust' && A.age === t.windup + t.active - 1 && !att.hung) { att.whiffHang = R.stopHit.whiff; att.hung = true; }
    return;
  }
  att.landed = true;
  const charged = A.charged, mark = !!m.path;
  const base = { a: ai, d: di, move: m.id, heavy: HEAVY_CLASS.has(m.id) || charged, loc };

  // roll i-frames
  if (D.phase === 'roll' && D.age >= R.roll.iframeStart && D.age <= R.roll.iframeEnd) {
    def.counterWindow = R.roll.counterWindow;
    events.push({ t: 'Dodged', ...base });
    return;
  }

  const facing = offFacing(D, A) <= R.guard.arc;
  const raised = D.phase === 'guard' && facing;
  const guarding = raised && D.guardSide === MIRROR[m.direction];   // raised: any guard up; guarding: the side covers this cut

  // a blow's hit points, and what the wall behind a shoved fighter adds: knockback that ends against the wall is a second impact
  let walledHit = false;
  const wound = (dmg, knock, marks = mark) => {
    def.hp = Math.max(0, def.hp - dmg);
    if (marks) {
      const W = R.wound;
      def.wound = W.ticks;
      def.maxSt = Math.max(W.capFloor, def.maxSt - W.staminaCap);   // a blade wound costs part of the stamina bar's ceiling for the rest of the bout
      def.st = Math.min(def.st, def.maxSt);
      if (loc === 'legs') def.legWound = true;                        // and a leg wound slows the walk
    }
    const away = angleTo(D, A) + Math.PI;
    for (let k = 0; k < knock; k++) stepBody(def, att, Math.sin(away), Math.cos(away), R.move.knockbackSpeed / R.tickHz, R);
    walledHit = knock > 0 && def.hp > 0 && walled(def, Math.sin(away), Math.cos(away), R);
  };
  const stagger = (ticks, kindName) => {
    const wall = walledHit ? R.wall.stagger : 0;
    hurt(def, ticks + wall + (def.exhausted && (m.charges || m.id === 'kick') ? R.exhaustedHitStun : 0), kindName);
    if (walledHit) gainPosture(def, R.wall.posture);
  };

  // parry
  if (guarding && D.age < R.parry.window && m.parryable) {
    enter(att, 'hurt');
    att.stun = R.parry.stun;
    att.hurtKind = 'parried';
    att.move = null;
    gainPosture(att, R.posture.parry);
    def.punish = R.parry.stun;
    def.punishKind = 'riposte';
    events.push({ t: 'Parried', ...base });
    return;
  }

  // a kick into a guard held on any other side: the shove lands, the guard only costs stamina
  if (raised && !guarding && m.vsGuard) {
    spend(def, R, m.vsGuard.staminaDamage);
    wound(m.damage, m.knockback);
    events.push({ t: 'Hit', ...base, dmg: m.damage, poised: false, guarded: true });
    stagger(m.vsGuard.stagger, 'hit');
    gainPosture(def, m.posture);
    return;
  }

  // block (a guard raised just in time pays half and stops the chip: its first perfectBlock ticks are past the parry window)
  const perfect = D.age - R.parry.window < R.guard.perfectBlock;
  const cost = m.staminaDamage * (perfect ? R.guard.perfectBlockCost : 1);
  if (guarding && !(m.breaksGuard || charged) && def.st >= cost) {
    spend(def, R, cost);
    const chip = perfect ? 0 : Math.round(m.damage * m.chip);
    wound(chip, 0, false);
    gainPosture(def, m.posture * (perfect ? R.posture.perfect : 1));
    def.counterWindow = R.guard.counterWindow;
    events.push({ t: 'Blocked', ...base, dmg: chip, perfect });
    return;
  }

  const bandPM = bandFactor(R, att);
  const damage = Math.round(m.damage * (charged ? R.charge.damage : 1) * bandPM);
  const baseStun = Math.round(m.stagger * (charged ? R.charge.stagger : 1));

  // guard break: a breaking move, a charged heavy, or a guard that cannot pay
  if (guarding) {
    spend(def, R, R.guard.breakCost);
    wound(damage, m.knockback);
    events.push({ t: 'GuardBroken', ...base, dmg: damage });
    stagger(baseStun, 'broken');
    def.posture = 0;
    return;
  }

  // clean hit
  const defMove = D.phase === 'attack' ? moves[D.move] : null;
  const counter = !!defMove || (D.phase === 'roll' && D.age > R.roll.iframeEnd);
  // the thrust is the stop-hit: into a swing, or into a target that has walked onto the point (closer to where the thrust began, by stopHit.walk m)
  const advancing = (D.phase === 'ready' || D.phase === 'guard') && A.attackFrom && dist(D, A.attackFrom) < A.attackFrom.gap - R.stopHit.walk;
  const stop = m.id === 'thrust' && (counter || advancing);
  const rear = offFacing(D, A) > Math.PI - R.rear.arc / 2;
  const side = D.phase === 'guard' && !facing && !rear;   // a side blow on a raised guard
  const dmg = Math.round(damage * (stop ? R.stopHit.damage : counter ? R.counter.damage : 1) * (rear ? (D.phase === 'hurt' ? R.rear.downed : R.rear.damage) : 1) * (side ? R.flank.damage : 1));
  const stun = Math.round(baseStun * (stop ? R.stopHit.stagger : counter ? R.counter.stagger : 1) * (rear ? R.rear.stagger : 1));
  const drain = R.cleanDrain[m.id];
  if (drain) spend(def, R, drain);

  // hyper-armour: a heavy parked at its chamber or charged, or any move past its poise point
  const live = defMove && D.age < timing(defMove, D).windup + timing(defMove, D).active;
  const poised = !!(live && ((defMove.charges && (D.charged || (D.parked > 0 && D.age === defMove.chamber))) || (defMove.poise >= m.stagger && D.age >= defMove.poiseFrom)));
  wound(dmg, poised ? 0 : m.knockback * bandPM);
  events.push({ t: 'Hit', ...base, dmg, poised, counter: counter || stop, rear, charged, glance: bandPM < 1, ...(raised ? { guarded: true } : {}), ...(stop ? { stop: true } : {}) });
  if (!poised || def.hp <= 0) stagger(stun, 'hit');
  gainPosture(def, m.posture * (counter ? R.counter.damage : 1) * (rear ? R.rear.posture : 1) * (side ? R.flank.posture : 1));
}

function hurt(f, stun, kind) {
  enter(f, 'hurt');
  f.stun = Math.max(1, stun);
  f.hurtKind = kind;
  f.move = null;
  f.buffer = null;
  f.counterWindow = 0;
  f.parrying = false;
  f.guardSide = null;
}

// ---------- 4. upkeep ----------

function upkeep(f, foe, i, R, events) {
  if (f.phase === 'dead') return;
  if (f.hp <= 0) {
    enter(f, 'dead');
    f.stun = R.death;
    events.push({ t: 'Killed', f: i, by: 1 - i });
    return;
  }
  if (f.posture >= R.posture.max) {
    f.posture = 0;
    hurt(f, R.posture.stun, 'posture');
    foe.punish = R.posture.stun;
    foe.punishKind = 'critical';
    events.push({ t: 'PostureBroken', f: i });
  }
  // the hold timer runs down through a stagger too; posture itself only decays while standing, and half as fast under 30 % health (V1 duel.ts:309)
  if (++f.postureHold > R.posture.hold && f.phase !== 'hurt') f.posture = Math.max(0, f.posture - R.posture.decay * (f.hp < R.bloodied.below * R.health ? R.bloodied.postureDecay : 1));
  if (f.rest > 0) f.rest--;
  else if (!f.sprinted && (f.phase === 'ready' || f.phase === 'guard')) {
    f.st = Math.min(f.maxSt, f.st + R.stamina.regen * (f.wound > 0 ? R.wound.regen : 1) * (f.phase === 'guard' ? R.stamina.guardRegen : 1));
  }
  if (f.wound > 0) f.wound--;
  if (f.exhausted && f.st >= R.stamina.exhaustRecover) f.exhausted = false;
  if (f.parryCd > 0) f.parryCd--;
  if (f.exposed > 0) f.exposed--;
  if (f.punish > 0 && --f.punish === 0) f.punishKind = null;
  if (f.counterWindow > 0) f.counterWindow--;
  if (f.chainWindow > 0) f.chainWindow--;
  for (let s = 0; s < f.specialCd.length; s++) if (f.specialCd[s] > 0) f.specialCd[s]--;
  if (f.specialRecover > 0) f.specialRecover--;
  if (f.evadeEnd < 99) f.evadeEnd++;
  if (f.buffer && --f.buffer.ttl <= 0) f.buffer = null;
}
