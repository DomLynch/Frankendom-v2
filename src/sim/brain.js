// Opponent brain: V1's ai.ts decide() for a longsword duel, as data-driven JS. Reads only
// sim.state / sim.moves / sim.rules / sim.specials, never the other side's pending intent, and
// returns an ordinary intent that the sim judges by the same rules as the player's. Every number
// is in data/behaviours.json (profile row + dials + read + fight + defaults). Its only randomness
// is its own seeded rng, so a bout replays exactly. V1 file:line refs are to src/fight/ai.ts.
import { createRng, next } from './rng.js';

const MIRROR = { left: 'right', right: 'left', overhead: 'overhead', thrust: 'thrust', low: 'low' };
const SIDES = ['left', 'right', 'overhead', 'thrust', 'low'];
const LIGHTS = new Set(['light_left', 'light_right']);
const HABITS = { ticks: 0, guard: 0, parries: 0, rolls: 0, steps: 0, lights: 0, heavies: 0, thrusts: 0, kicks: 0, attacks: 0, parks: 0, latch: 0, hold: 0, run: 0 };

// behaviours: the parsed data/behaviours.json (dials, read, fight, defaults, brains)
export function createBrain(row, seed, behaviours) {
  if (!behaviours) throw new Error('createBrain(row, seed, behaviours): the brain tables are data/behaviours.json');
  return {
    row, T: behaviours, p: { ...behaviours.defaults, ...row }, rng: createRng(seed),
    lastGap: behaviours.dials.startLastGap, mode: 'approach', side: 1, decision: behaviours.dials.startDecision, wait: behaviours.dials.startWait,
    next: null, plan: null, planned: false, readSide: null, jitter: 0, retreatUntil: 0, hold: false, feint: false, disengageUntil: 0,
    habits: { ...HABITS }, reads: null, scores: {},
    pLanded: false, pFoeHp: null,   // last tick's view, for the edges V1 got from events
  };
}

// V1 ai.ts:32-55. What the opponent has done so far, read from the counted habits.
export function readOpponent(h, p, READ) {
  const swings = h.lights + h.heavies + h.thrusts;
  const oldSpam = swings >= READ.swings && h.lights / swings >= READ.lightShare;
  const spam = p.spamRun ? h.run >= p.spamRun + (h.ticks < h.latch ? READ.plus : 0) || (!!p.spamBoth && oldSpam) : oldSpam;
  return {
    parryHappy: h.attacks >= READ.after && h.parries / h.attacks >= READ.parry,
    turtle: h.ticks >= READ.guardTicks && h.guard / h.ticks >= READ.guardShare,
    roller: h.attacks >= READ.after && h.rolls / h.attacks >= READ.roll,
    stepper: h.attacks >= READ.after && h.steps / h.attacks >= READ.roll,
    spammer: spam,
    parker: swings >= READ.after && h.parks / swings >= READ.parkShare,
    poker: swings >= READ.after && h.thrusts / swings >= READ.pokerShare,
    kicker: h.kicks >= READ.after && h.kicks / (swings + h.kicks) >= READ.kickerShare,
  };
}

const idleIntent = () => ({ mx: 0, mz: 0, run: false, press: null, side: null, guard: null, hold: false });

export function think(brain, sim, me) {
  const { T, p: P } = brain, D = T.dials, READ = T.read, R = sim.rules, moves = sim.moves, S = sim.state, tick = S.tick;
  const f = S.fighters[me], foe = S.fighters[1 - me];
  const intent = idleIntent();
  if (f.phase === 'dead' || foe.phase === 'dead' || f.hp <= 0 || foe.hp <= 0) return intent;
  const roll = () => next(brain.rng);

  // ---- the move tables, V2 names for V1's reads
  const timingOf = (x) => { const m = moves[x.move]; return x.chained && m.chained ? { ...m, ...m.chained } : m; };
  const gap = Math.hypot(foe.x - f.x, foe.z - f.z);
  const facing = Math.atan2(foe.x - f.x, foe.z - f.z);
  const walled = (b, dx, dz) => Math.hypot(b.x, b.z) >= R.body.arenaRadius - R.wall.edge && b.x * dx + b.z * dz > 0;
  const canAct = (f.phase === 'ready' || f.phase === 'guard');
  const light = moves.light_right, heavy = moves.heavy_overhead, thrust = moves.thrust;
  const inside = gap < (thrust.minReach ?? 0);   // inside a pole's point (ai.ts:86); a sword never is
  const prevGap = brain.lastGap; brain.lastGap = gap;
  const elapsed = foe.age + foe.parked;   // duel.ts:218: a parked swing is still a swing that started this many ticks ago
  const charging = (x) => x.phase === 'attack' && x.move !== null && x.parked > 0 && moves[x.move].charges;

  // ---- what V1 got from events, derived from state edges (the sim hands the brain no events)
  const landedEdge = f.landed && !brain.pLanded;   // my swing's contact resolved since last tick (hit, block, parry or dodge)
  const hit = landedEdge && brain.pFoeHp !== null && foe.hp < brain.pFoeHp && foe.phase !== 'guard';   // 'Hit' by me
  const defended = landedEdge && !hit && (foe.phase === 'guard' || foe.phase === 'roll');            // 'Blocked' | 'Parried' | 'Dodged' by him
  const ownT = f.phase === 'attack' && f.move ? timingOf(f) : null;
  const missed = !!ownT && !f.landed && f.age === ownT.windup + ownT.active && foe.phase === 'backstep';   // 'AttackMissed' on a backstepper
  brain.pLanded = f.landed; brain.pFoeHp = foe.hp;

  if (f.special > 0) return intent;   // nothing is legal during a special's windup

  // ---- legality (sim.js legal())
  const legalMove = (id) => canAct && !f.exhausted && f.specialRecover === 0 && f.st >= moves[id].stamina;
  const legalBackstep = () => canAct && !f.exhausted && f.st >= R.backstep.cost && !walled(f, -Math.sin(f.heading), -Math.cos(f.heading));
  const done = () => {
    // a raised guard or a parry press carries the side read for the current threat; with nothing coming the guard stands straight (ai.ts:81)
    if (intent.guard === true) intent.guard = (threat && noticed && brain.readSide) || D.guardSide;
    return intent;
  };
  let threat = false, noticed = false;

  // ---- specials (ai.ts:99-101): cast whenever one is ready and the foe is in reach; no roll is drawn
  if (P.specials && canAct && !f.exhausted && f.specialRecover === 0 && gap <= R.specials.reach) {
    const slot = f.specialCd.findIndex((cd) => cd === 0);
    if (slot >= 0) { intent.press = R.specials.slots[slot].press; return intent; }
  }

  // ---- hit and run (ai.ts:105)
  if (P.disengage && hit && roll() < P.disengage) brain.disengageUntil = tick + D.disengageTicks;

  // ---- observe the foe's habits from state edges and read them (ai.ts:107-132)
  const h = brain.habits; h.ticks++;
  if (foe.phase === 'guard') h.guard++;
  if (foe.phase === 'guard' && foe.parrying && foe.age === 0) h.parries++;
  if (foe.phase === 'roll' && foe.age === 0) h.rolls++;
  if (foe.phase === 'backstep' && foe.age === 0) h.steps++;
  h.hold = foe.phase === 'guard' ? h.hold + 1 : 0;
  const decayRun = () => { h.run = READ.decay ? Math.max(0, h.run - D.readDecayStep) : 0; h.latch = h.ticks + READ.latch; };
  // a guard held through my windup is a commitment, not a tap (RV31)
  if (f.phase === 'attack' && f.move && f.age === moves[f.move].windup && h.hold >= READ.holdTicks) decayRun();
  // a defence that actually meets a blow ends the masher's run
  if (defended || missed) decayRun();
  if (foe.phase === 'attack' && foe.parked === 1 && foe.move && foe.age === moves[foe.move].chamber) h.parks++;
  if (foe.phase === 'attack' && foe.age === 0 && foe.move) {   // ripostes, counters and criticals are earned, not habits
    const punishes = f.phase === 'hurt' || (f.phase === 'attack' && !!f.move && f.age >= moves[f.move].windup + moves[f.move].active);
    if (LIGHTS.has(foe.move)) { if (!punishes) h.run++; } else h.run = 0;
    if (foe.move === 'heavy_overhead' || moves[foe.move]?.charges) h.heavies++;   // a directional heavy counts as the heavy it is
    else if (foe.move === 'thrust') h.thrusts++;
    else if (LIGHTS.has(foe.move)) h.lights++;
    else if (foe.move === 'kick') h.kicks++;
  }
  if (f.phase === 'attack' && f.age === 0 && f.move !== 'kick') h.attacks++;
  const reads = brain.reads = readOpponent(h, P, READ);

  // ---- a held swing, a feint (ai.ts:135-141)
  if (f.phase !== 'attack') { brain.hold = false; brain.feint = false; }
  if (brain.feint && f.phase === 'attack' && f.move && f.age === moves[f.move].feintUntil - 1) {
    brain.feint = false;
    if (f.st >= R.feint.cost) { intent.press = 'parry'; intent.guard = 'thrust'; return intent; }
  }
  intent.hold = brain.hold && f.phase === 'attack' && (f.move === 'heavy_overhead' ? f.parked < R.charge.min : f.parked < READ.baitHold);

  // ---- being hit: back off briefly, then decide afresh (ai.ts:151-154)
  if (f.phase === 'hurt' && f.age === 1) {
    brain.retreatUntil = tick + D.retreatTicks; brain.decision = D.retreatTicks; brain.mode = 'retreat'; brain.plan = null; brain.next = null;
    brain.wait = Math.round((D.waitBase + roll() * D.waitSpread) * (D.waitAggrCeil - P.aggression));
  }

  // ---- perception (ai.ts:157-222). A swing is a threat until its active window closes.
  const ftm = foe.phase === 'attack' && foe.move ? timingOf(foe) : null;
  threat = !!ftm && !foe.landed && foe.age < ftm.windup + ftm.active;
  // a read cut-spammer's cuts are anticipated; a tell (the thrust, the pommel) is noticed on its own clock where the profile has one
  const reaction = threat && reads.spammer && LIGHTS.has(foe.move) ? Math.min(P.reaction, P.anticipate ?? READ.anticipate)
    : threat && READ.tells.includes(foe.move) ? Math.min(P.reaction, P.tellReaction) : P.reaction;
  noticed = threat && elapsed >= reaction;
  if (!threat) { brain.plan = null; brain.readSide = null; brain.planned = false; }
  else if (!brain.planned && elapsed >= reaction) {
    brain.planned = true;   // one response is planned per attack
    const move = moves[foe.move];
    // the side: the warden reads which side the blow arrives on; a misread picks one of the other four (rolled once per threat)
    const want = MIRROR[move.direction];
    brain.readSide = P.guard === 0 ? null : roll() < P.read ? want : SIDES.filter((d) => d !== want)[Math.floor(roll() * (SIDES.length - 1))];
    const r = roll(), inRange = gap <= move.reach + D.rangeSlack;
    const unblockable = move.breaksGuard || charging(foe);
    const affordable = f.st >= move.staminaDamage, canRoll = f.st >= R.roll.cost;
    const jitter = () => Math.round((1 - P.accuracy) * D.jitterAmp * (roll() * 2 - 1));
    if (inRange && !move.parryable) {   // the kick: no guard or parry answers it; a read low guard braces it
      brain.plan = r < P.dodge ? (canRoll ? 'dodge' : 'evade') : brain.readSide === 'low' && P.guard > 0 && affordable ? 'block' : 'ignore';
      brain.jitter = jitter();
    } else {
      const lapse = reads.spammer ? P.lapse * READ.spammerLapseShare : P.lapse;   // reads sharpen attention
      const parryChance = reads.spammer ? Math.min(READ.parryCap, 1 - P.dodge, P.parry * READ.parryBoost) : P.parry;   // a cut-only player is parried more
      if (!inRange || roll() < lapse) brain.plan = 'ignore';
      else if (r < parryChance && !f.parryCd) brain.plan = 'parry';
      else if (r < parryChance + P.dodge && canRoll) brain.plan = 'dodge';
      else if (unblockable) brain.plan = canRoll ? 'dodge' : !f.parryCd && P.guard > 0 ? 'parry' : 'evade';
      else brain.plan = affordable && (P.guard >= 1 || roll() < P.guard) ? 'block' : 'evade';
      brain.jitter = jitter();
    }
  } else if (noticed && brain.plan === 'block' && charging(foe)) {   // a heavy seen to be charging will break the guard: change the answer
    brain.plan = f.st >= R.roll.cost ? 'dodge' : !f.parryCd && P.guard > 0 ? 'parry' : 'evade';
  }

  // ---- openings (ai.ts:225-233)
  const opening = (foe.phase === 'hurt' && foe.age >= P.reaction) || foe.exhausted || foe.exposed > 0
    || (ftm && foe.phase === 'attack' && !foe.landed && foe.age - ftm.windup - ftm.active >= P.reaction)
    || (reads.roller && foe.phase === 'roll' && foe.age >= R.roll.iframeEnd);
  const guarded = foe.phase === 'guard' && foe.age >= P.reaction;
  // walking onto the point: the foe moved this tick and the gap closed from beyond cutting range to inside the thrust's
  const advancing = (foe.phase === 'ready' || foe.phase === 'guard') && foe.moved > 0 && prevGap > gap + D.advanceEps
    && gap < thrust.reach - D.reachInset && gap > light.reach - D.reachInset;
  const pressured = reads.spammer && foe.phase === 'ready' && gap <= light.reach + D.reachInset;   // a read spammer will cut before a slow swing lands

  // ---- timers pause while staggered (ai.ts:236)
  if (f.phase !== 'hurt') { brain.decision = Math.max(0, brain.decision - 1); brain.wait = Math.max(0, brain.wait - 1); }
  const floor = P.discipline * f.maxSt / 100, low = f.st < floor;   // the stamina floor is a share of the bar's current ceiling
  const shaky = f.posture >= R.posture.max * D.shakyShare;
  // the lorarii: three quarters of a loiter clock at the wall and the next opener is now (ai.ts:243)
  if (f.loiter >= R.wall.loiter.ticks * D.loiterShare) {
    brain.wait = 0;
    if (brain.mode === 'circle' && f.st >= floor) brain.mode = 'approach';
  }
  // when the cadence timer expires the warden commits to the kind of attack it will close in for (ai.ts:247)
  if (!brain.wait && !brain.next && canAct) {
    const lightShare = reads.parryHappy ? Math.max(P.pressure, READ.baitShare) : P.pressure;
    brain.next = roll() < lightShare ? 'light' : h.attacks > 0 && roll() < T.fight.thrustShare ? 'thrust' : 'heavy';
  }
  // an opener the bar's worn ceiling can no longer pay for becomes a cut
  if (brain.next && brain.next !== 'light' && moves[brain.next === 'heavy' ? 'heavy_overhead' : 'thrust'].stamina > f.maxSt) brain.next = 'light';
  // a planned cut with a minReach is useless against a man standing inside it
  if (brain.next === 'light' && gap < (light.minReach ?? 0) + D.reachInset) {
    const can = (id) => gap >= (moves[id].minReach ?? 0) + D.reachInset && gap <= moves[id].reach - D.reachInset && legalMove(id);
    if (can('heavy_overhead')) brain.next = 'heavy';
    else if (can('thrust')) brain.next = 'thrust';
  }
  // never a slow opener into a ready spammer: the cut lands first
  if (pressured && brain.next === 'heavy') brain.next = 'light';

  // ---- movement mode: seeded, bounded decisions (ai.ts:269-285)
  if (!brain.decision) {
    const r = roll();
    brain.decision = D.guardHoldBase + Math.floor(r * D.guardHoldSpread); brain.side = roll() < D.sideShare ? 1 : -1;
    brain.mode = low || shaky ? (gap < D.lowRetreatGap || f.st < R.roll.cost ? 'retreat' : 'circle')
      : gap > D.farApproachGap ? 'approach' : gap < D.nearGap ? 'retreat' : r < D.guardRollShare * P.guard ? 'guard' : 'circle';
  }
  if (gap > D.hardApproachGap || (!low && !shaky && gap > D.midApproachGap)) brain.mode = 'approach';
  if (tick < brain.retreatUntil || ((low || shaky) && gap < D.lowCloseRetreatGap)) brain.mode = 'retreat';
  else if ((low || shaky) && brain.mode === 'retreat' && gap >= D.circleReturnGap) brain.mode = 'circle';
  // the ring wall: a retreat that would put its own back to the wall becomes a circle along it, on the side that leads inward;
  // a foe with the wall at his back is pressed straight
  const myBack = walled(f, -Math.sin(facing), -Math.cos(facing)), theirBack = walled(foe, Math.sin(facing), Math.cos(facing));
  if (brain.mode === 'retreat' && myBack) {
    brain.mode = 'circle';
    brain.side = (f.x * Math.cos(facing) - f.z * Math.sin(facing)) > 0 ? -1 : 1;
  }
  if (brain.mode === 'circle' && theirBack && !low && !shaky) brain.mode = 'approach';

  // ---- answer the noticed swing (ai.ts:286-308)
  if (canAct && noticed && brain.plan && brain.plan !== 'ignore') {
    const window = R.parry.window;
    const estimate = ftm.windup - foe.age + brain.jitter;   // contact on the animation clock: a swing parked at its chamber does not draw the press
    brain.scores = { [brain.plan]: 1, estimate };
    if (brain.plan === 'parry') {
      // press when the window will cover the estimated contact; hold an open window; release a stale standing guard so a fresh press can parry
      if (f.phase === 'ready') { if (estimate <= window - D.parryWindowMargin && f.exposed === 0) { intent.press = 'parry'; intent.guard = true; } }
      else intent.guard = f.age < window || estimate <= D.estimateMax;
    } else if (brain.plan === 'dodge' && f.st >= R.roll.cost && estimate <= R.roll.iframeEnd - D.dodgeSafeEndMargin && estimate >= R.roll.iframeStart) intent.press = 'dodge';
    else if (brain.plan === 'evade') {   // step out of the blow's reach (one step while inside it), then keep walking back, still facing the blade
      if (legalBackstep() && gap <= moves[foe.move].reach + D.backstepSlack) intent.press = 'backstep';
      else { intent.mx = -Math.sin(facing); intent.mz = -Math.cos(facing); }
    } else if (P.guard > 0) intent.guard = true;   // a block, or a roll whose moment has not come: wait behind the guard
    return done();
  }

  // ---- offence: utility scores over what the foe is committed to (ai.ts:311-365)
  if (canAct && !f.exhausted) {
    const inReach = (id) => gap <= moves[id].reach - D.reachInset && gap >= (moves[id].minReach ?? 0) + D.reachInset && legalMove(id);
    const r = roll();
    // the kick: inside a pole's point; a turtle is kicked more and a kick goes through a parry window, so a parrier is kicked too;
    // P.kick is a kicker's answer to a read roller or backstepper
    const kickNow = (inside && !threat && tick >= brain.retreatUntil)
      || ((guarded || reads.parryHappy) && r < READ.guardedKickBase + (reads.turtle || reads.parryHappy ? READ.kickBoost : 0))
      || (!!P.kick && !threat && (reads.roller || reads.stepper) && r < P.kick);
    const followsThrust = f.chainFrom && (moves[f.chainFrom].chain?.follow || []).includes('thrust');
    const scores = {
      critical: f.punish > 0 && f.punishKind === 'critical' && inReach('heavy_overhead') ? 1.6 : 0,   // a broken posture is finished with the critical
      counter: f.counterWindow > 0 && inReach('heavy_overhead') ? 1.4 : 0,   // a block opens the guard counter
      punish: opening && inReach('light_right') ? 1.5 : 0,
      chain: f.chainWindow > 0 && (inReach('light_right') || (followsThrust && inReach('thrust'))) && r < P.aggression ? 1.2 : 0,
      kick: inReach('kick') && kickNow ? D.kickWeight + (reads.turtle ? READ.kickBoost : 0) : 0,
      heavy: guarded && inReach('heavy_overhead') ? 1 : brain.next === 'heavy' && !threat && !pressured && inReach('heavy_overhead') ? 0.8 : 0,
      light: brain.next === 'light' && !threat && !guarded && inReach('light_right') ? 0.8 : 0,
      // a fast fighter's counter-swing into a slower tell that will land first
      interrupt: P.interrupt && threat && !foe.landed && ftm.windup - foe.age > light.windup + D.interruptWindupMargin
        && inReach('light_right') && r < P.interrupt ? 1.3 : 0,
      // the thrust: a stop-hit into a foe walking onto the point, or the scheduled opener; blockable, so never into a standing guard
      thrust: !threat && !guarded && inReach('thrust') && brain.next !== null && (advancing || brain.next === 'thrust') ? (advancing ? 0.9 : 0.8) : 0,
    };
    if (low) for (const key of ['chain', 'kick', 'heavy', 'light', 'thrust', 'interrupt']) scores[key] = 0;   // stamina discipline: only punishes below the floor
    brain.scores = scores;
    let best = null, score = 0;
    for (const [key, v] of Object.entries(scores)) if (v > score) { best = key; score = v; }
    if (score > 0) {
      const press = best === 'kick' ? 'kick'
        : best === 'heavy' || best === 'critical' || best === 'counter' ? 'heavy'
        : best === 'thrust' || ((best === 'chain' || best === 'punish') && !inReach('light_right')) ? 'thrust' : 'light';
      brain.wait = Math.round((D.waitBase + roll() * D.waitSpread) * (D.waitAggrCeil - P.aggression)); brain.next = null;
      // a less aggressive warden sometimes baits instead: a visible guard the player must open; the stop-hit is never traded for a bait
      const baitable = best === 'heavy' || best === 'light' || (best === 'thrust' && !advancing);
      if (baitable && !guarded && roll() < (1 - P.aggression) * D.baitChance * P.guard) {
        brain.mode = 'guard'; brain.decision = D.guardHoldBase + Math.floor(roll() * D.guardHoldSpread); intent.guard = true;
        return done();
      }
      // a guard is charged through more often by level (and against a turtle or a roller, whose answer a charge outlasts);
      // a parry-happy player has lights held past the parry window as baits
      const chargeChance = P.aggression - D.chargeOffset + (reads.turtle || reads.roller || reads.parryHappy ? READ.chargeBoost : 0);
      brain.hold = best === 'heavy' ? (guarded || reads.roller || reads.parryHappy) && roll() < chargeChance : best === 'light' && reads.parryHappy && roll() < READ.baitShare;
      // one swing in six at a parrier is a feint; a feinting fighter (P.feint) feints anyone
      const feintChance = Math.max(P.feint, reads.parryHappy ? READ.feint : 0);
      brain.feint = feintChance > 0 && (press === 'heavy' || press === 'light') && !brain.hold && roll() < feintChance;
      intent.press = press; intent.hold = brain.hold;
      return intent;
    }
  }

  // against a read cut-spammer the warden walks in guard inside cutting range when it is not swinging (ai.ts:369)
  if (pressured && canAct && !f.exhausted && !threat && !low && P.guard > 0) intent.guard = true;
  if (brain.mode === 'guard' && canAct && !f.exhausted) { intent.guard = true; return done(); }
  // inside the point with no kick to give: a backstep out to where the pole works
  if (inside && canAct && !threat && legalBackstep()) { intent.press = 'backstep'; return intent; }
  // hit and run: the hop back out after a landed blow
  if (tick < brain.disengageUntil && canAct && !threat && legalBackstep()) { brain.disengageUntil = 0; intent.press = 'backstep'; return intent; }

  // ---- closing distance (ai.ts:378-443)
  const cramped = brain.mode === 'approach' && gap < (thrust.minReach ?? 0) + D.reachInset;
  const forward = brain.mode === 'approach' && gap > (brain.next === 'thrust' ? thrust.reach - D.thrustCloseInset : T.fight.close) ? D.forwardSpeed
    : brain.mode === 'retreat' && gap < (low ? D.retreatGapLow : D.retreatGap) ? -D.backSpeed
    : cramped ? -D.backSpeed : 0;
  const lateral = brain.mode === 'circle' ? brain.side * D.lateralStep : brain.mode === 'approach' && forward ? brain.side * D.lateralStep * P.circle : 0;
  // the dart: a sprint into an opening from outside reach
  const dash = !!P.dash && opening && forward > 0 && gap > T.fight.close + D.dashSlack && f.st > R.roll.cost && roll() < P.dash;
  intent.mx = Math.sin(facing) * forward + Math.cos(facing) * lateral;
  intent.mz = Math.cos(facing) * forward - Math.sin(facing) * lateral;
  intent.run = dash;
  // the lorarii: three quarters of a loiter clock in the wall band and the fighter walks off it toward the centre, whatever his mode
  if (f.loiter >= R.wall.loiter.ticks * D.loiterShare && intent.press === null && gap > T.fight.close + D.wallSlack) {
    const rr = Math.hypot(f.x, f.z) || 1;
    intent.mx = intent.mx * (1 - D.loiterInward) + (-f.x / rr) * D.loiterInward;
    intent.mz = intent.mz * (1 - D.loiterInward) + (-f.z / rr) * D.loiterInward;
    intent.run = false;
  }
  return done();
}
