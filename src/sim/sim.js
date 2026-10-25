// The duel sim. Fixed 60 Hz, deterministic: the same seed and intent stream give
// the same state and events on any machine. Pure: no DOM, no clock, no Math.random.
// The phone runs it locally, and the server will import this same file.
//
// Intent per fighter per tick:
//   { mx, mz }      world-space move, length 0..1
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
  const R = { ...data.rules, specials };
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
    hp: R.health, st: R.stamina.max, posture: 0, postureHold: 0, rest: 0, exhausted: false,
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

  for (const [f, foe, i] of [[a, b, 0], [b, a, 1]]) decide(f, foe, intents[i] || {}, moves, R, events, i);
  for (const [f, foe, i] of [[a, b, 0], [b, a, 1]]) advance(f, foe, intents[i] || {}, moves, R);
  separate(a, b, R);

  const snap = [structuredCloneLite(a), structuredCloneLite(b)];
  contact(a, b, snap[0], snap[1], 0, moves, R, events);
  contact(b, a, snap[1], snap[0], 1, moves, R, events);
  specials(state.fighters, hpBefore, moves, R, events);

  for (const [f, foe, i] of [[a, b, 0], [b, a, 1]]) upkeep(f, foe, i, R, events);
  if (a.hp <= 0 || b.hp <= 0) state.over = true;
  return events;
}

function structuredCloneLite(f) {
  return { x: f.x, z: f.z, heading: f.heading, phase: f.phase, age: f.age, move: f.move, chained: f.chained, parrying: f.parrying, guardSide: f.guardSide, charged: f.charged, parked: f.parked };
}

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
      else if (press === 'backstep') { spend(f, R, R.backstep.cost); enter(f, 'backstep'); }
      else if (press === 'parry') raiseGuard(f, intent.guard || 'thrust', R, true);
    } else if (!fromBuffer) {
      if (remaining(f, moves, R) <= R.buffer.window) f.buffer = { press, side: intent.side || null, ttl: R.buffer.ttl };
      else events.push({ t: 'PressRefused', f: i, press });
    }
  }

  // held guard without a fresh press (never during a special's windup)
  if (f.special > 0) return;
  if (f.phase === 'ready' && intent.guard && f.exposed === 0 && !f.exhausted) raiseGuard(f, intent.guard, R, false);
  if (f.phase === 'guard') {
    if (intent.guard) f.guardSide = intent.guard;
    else if (!(f.parrying && f.age < R.parry.window)) dropGuard(f, R);
  }
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
      const steps = Math.round(m.knockback * S.react.knock / 100), k = steps * R.move.walk / R.tickHz;
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
  else f.age = R.parry.window + R.guard.perfectBlock;   // already past the parry and perfect-block ticks
  f.move = null;
}

function dropGuard(f, R) {
  // a parry tap that met nothing leaves the fighter exposed
  if (f.parrying && f.age >= R.parry.window && f.age < R.parry.window + R.guard.perfectBlock + 1) f.exposed = R.parry.recovery;
  enter(f, 'ready');
  f.parrying = false;
  f.guardSide = null;
}

function startAttack(f, foe, moveId, moves, R, events, i) {
  const m = moves[moveId];
  const isLight = moveId === 'light_left' || moveId === 'light_right';
  f.chained = !!m.chained && (f.chainWindow > 0 || (isLight && f.evadeEnd <= R.roll.dodgeAttackWindow));
  if (f.chained && f.chainFrom && !(moves[f.chainFrom].chain?.follow || []).includes(moveId)) f.chained = isLight && f.evadeEnd <= R.roll.dodgeAttackWindow;
  spend(f, R, m.stamina);
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

function advance(f, foe, intent, moves, R) {
  f.moved = 0;
  f.sprinted = false;
  if (f.phase === 'dead') return;
  const dt = 1 / R.tickHz;
  const walk = R.move.walk;
  const slow = f.exhausted ? R.stamina.exhaustedSpeed : 1;

  if (f.phase === 'attack') {
    const m = moves[f.move], t = timing(m, f);
    const parks = m.chamber != null && intent.hold && f.age === m.chamber && f.parked < R.charge.max;
    if (parks) {
      f.parked++;
      if (m.charges && f.parked >= R.charge.min) f.charged = true;
    } else if (f.whiffHang > 0) {
      f.whiffHang--;
    } else {
      bump(f);
    }
    if (f.age < t.windup && m.id !== 'kick') f.heading = turnToward(f.heading, angleTo(f, foe), R.turn.windup);
    if (f.age > R.stepInFrom && f.age < t.windup && !parks) moveBy(f, Math.sin(f.heading), Math.cos(f.heading), m.stepIn * walk * dt);
    if (f.age >= t.windup + t.active + t.recovery) {
      if (!f.chained && m.chain) { f.chainWindow = m.chain.window; f.chainFrom = m.id; }
      enter(f, 'ready');
      f.move = null;
    }
    return;
  }
  if (f.phase === 'roll' || f.phase === 'backstep') {
    bump(f);
    const roll = f.phase === 'roll';
    if (f.age >= (roll ? R.roll.ticks : R.backstep.ticks)) { enter(f, 'ready'); f.evadeEnd = 0; return; }
    if (roll) {
      moveBy(f, f.rollX, f.rollZ, R.move.run * dt);
      f.heading = Math.atan2(f.rollX, f.rollZ);
    } else {
      moveBy(f, -Math.sin(f.heading), -Math.cos(f.heading), R.backstep.speed * walk * dt);
    }
    return;
  }
  if (f.phase === 'hurt') {
    bump(f);
    if (--f.stun <= 0) { enter(f, 'ready'); f.hurtKind = null; }
    return;
  }

  // ready / guard: walk, strafe, sprint
  bump(f);
  const mag = Math.min(1, Math.hypot(intent.mx || 0, intent.mz || 0));
  const running = intent.run && mag > 0 && f.phase === 'ready' && !f.exhausted;
  let speed = running ? R.move.run : walk * mag;
  if (f.phase === 'guard') speed *= R.guard.speed;
  speed *= slow;
  if (mag > 0) moveBy(f, intent.mx / mag, intent.mz / mag, speed * dt);
  f.speed = mag > 0 ? speed : 0;
  if (running) {
    f.heading = Math.atan2(intent.mx, intent.mz);
    f.sprinted = true;
    f.st = Math.max(0, f.st - R.stamina.sprintCost);
  } else {
    f.heading = angleTo(f, foe);
  }
}

function moveBy(f, dx, dz, d) {
  f.x += dx * d;
  f.z += dz * d;
  f.moved += d;
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

function contact(att, def, A, D, ai, moves, R, events) {
  if (A.phase !== 'attack' || att.landed || def.phase === 'dead') return;
  const m = moves[A.move], t = timing(m, A);
  if (A.age < t.windup || A.age >= t.windup + t.active) return;
  const arc = m.id === 'kick' ? R.kickArc : R.hitArc;
  if (dist(A, D) > m.reach || offFacing(A, D) > arc) {
    // a whiffed thrust hangs once at full extension (it used to re-arm every time the hang ran out, so it never recovered)
    if (m.id === 'thrust' && A.age === t.windup + t.active - 1 && !att.hung) { att.whiffHang = R.stopHit.whiff; att.hung = true; }
    return;
  }
  att.landed = true;
  const di = 1 - ai;
  const base = { a: ai, d: di, move: m.id, heavy: HEAVY_CLASS.has(m.id) || A.charged };

  // roll i-frames
  if (D.phase === 'roll' && D.age >= R.roll.iframeStart && D.age <= R.roll.iframeEnd) {
    def.counterWindow = R.roll.counterWindow;
    events.push({ t: 'Dodged', ...base });
    return;
  }

  const facing = offFacing(D, A) <= R.guard.arc;
  const covers = D.phase === 'guard' && facing && D.guardSide === MIRROR[m.direction];

  // parry
  if (covers && D.parrying && D.age < R.parry.window && m.parryable) {
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

  // block or guard break
  if (covers) {
    const perfect = D.parrying && D.age >= R.parry.window && D.age < R.parry.window + R.guard.perfectBlock;
    const cost = m.staminaDamage * (perfect ? R.guard.perfectBlockCost : 1);
    if (m.breaksGuard || A.charged || def.st < cost) {
      spend(def, R, R.guard.breakCost);
      def.hp = Math.max(0, def.hp - m.damage);
      def.posture = 0;
      hurt(def, m.stagger, 'broken');
      events.push({ t: 'GuardBroken', ...base, dmg: m.damage });
      return;
    }
    spend(def, R, cost);
    const chip = perfect ? 0 : Math.round(m.damage * m.chip);
    def.hp = Math.max(0, def.hp - chip);
    gainPosture(def, m.posture * (perfect ? R.posture.perfect : 1));
    def.counterWindow = R.guard.counterWindow;
    events.push({ t: 'Blocked', ...base, dmg: chip, perfect });
    return;
  }

  // clean hit
  let dmg = m.damage, stagger = m.stagger, posture = m.posture;
  if (m.vsGuard && D.phase === 'guard') { stagger = m.vsGuard.stagger; spend(def, R, m.vsGuard.staminaDamage); }
  const defMove = D.phase === 'attack' ? moves[D.move] : null;
  // stop-hit: a thrust into a swing, or into a target walking onto the point (stopHit.walk m/s, inferred unit)
  if (m.id === 'thrust' && (defMove || def.speed >= R.stopHit.walk)) {
    dmg *= R.stopHit.damage; stagger *= R.stopHit.stagger;
  } else if (defMove || (D.phase === 'roll' && D.age > R.roll.iframeEnd)) {
    dmg *= R.counter.damage; stagger *= R.counter.stagger;
  }
  if (offFacing(D, A) > Math.PI - R.rear.arc / 2) {
    dmg *= R.rear.damage; stagger *= R.rear.stagger; posture *= R.rear.posture;
  }
  if (A.charged) { dmg *= R.charge.damage; stagger *= R.charge.stagger; }
  dmg = Math.round(dmg);
  def.hp = Math.max(0, def.hp - dmg);
  gainPosture(def, posture);
  const drain = R.cleanDrain[m.id];
  if (drain) spend(def, R, drain);

  const poised = defMove && defMove.poise >= stagger && D.age >= defMove.poiseFrom && D.age < timing(defMove, D).windup + timing(defMove, D).active;
  const hyper = defMove && (D.charged || D.parked > 0) && defMove.charges;
  if (!(poised || hyper)) {
    if (def.exhausted && (base.heavy || m.id === 'kick')) stagger += R.exhaustedHitStun;
    hurt(def, Math.round(stagger), 'hit');
    const away = angleTo(A, D), k = m.knockback * R.move.knockbackSpeed / R.tickHz;
    def.x += Math.sin(away) * k;
    def.z += Math.cos(away) * k;
  }
  events.push({ t: 'Hit', ...base, dmg, poised: !!(poised || hyper) });
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
  if (f.phase !== 'hurt') {
    if (++f.postureHold > R.posture.hold) f.posture = Math.max(0, f.posture - R.posture.decay);
  }
  if (f.rest > 0) f.rest--;
  else if (!f.sprinted && (f.phase === 'ready' || f.phase === 'guard')) {
    f.st = Math.min(R.stamina.max, f.st + R.stamina.regen * (f.phase === 'guard' ? R.stamina.guardRegen : 1));
  }
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
