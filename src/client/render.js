// Draws one fighter from sim state. It reads the sim and never writes to it.
// Attack, roll and reaction clips are scrubbed to the sim's tick, so the strike
// frame (row.hit) lands on the sim's active tick. Loops play at a speed matched
// to the sim's travel speed.
import * as THREE from 'three';

export function createFighterView(scene, color) {
  const root = new THREE.Group();
  scene.add(root);
  // stand-in until the body loads: a capsule with a blade, tinted by state
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  const stand = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.2, 4, 12), mat);
  body.position.y = 0.82;
  body.castShadow = true;
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 1.0), new THREE.MeshStandardMaterial({ color: 0xc8ccd2, metalness: 0.8, roughness: 0.3 }));
  blade.position.set(0.3, 1.0, 0.45);
  blade.castShadow = true;
  stand.add(body, blade);
  root.add(stand);
  return {
    root, stand, mat, blade, base: new THREE.Color(color), body: null, mixer: null, actions: {},
    w: {}, speed: 0, react: null, combatRole: null, primed: false, tilt: { yaw: 0, arm: 0, spine: 0 },
  };
}

export function attachBody(view, body, clips, def, swordModel) {
  view.root.remove(view.stand);
  view.root.add(body);
  view.body = body;
  view.mixer = new THREE.AnimationMixer(body);
  // A guard held while walking: the legs keep walking under the guard's upper body. Each locomotion clip gets a copy that animates only
  // the hips and legs (role + '_L'), and the guard clip a copy without them ('Guard_U'); the renderer blends those while he moves guarded.
  const isLower = (t) => /^mixamorig(Hips|(Left|Right)(UpLeg|Leg|Foot|ToeBase|Toe_End))\./.test(t.name);
  const derived = {};
  for (const r of [def.states.idle, def.states.walk, def.states.strafeLeft, def.states.strafeRight, def.states.run]) {
    if (clips[r]) derived[r + '_L'] = [new THREE.AnimationClip(r + '_L', clips[r].duration, clips[r].tracks.filter(isLower)), def.roles[r]];
  }
  if (clips[def.states.guard]) derived.Guard_U = [new THREE.AnimationClip('Guard_U', clips[def.states.guard].duration, clips[def.states.guard].tracks.filter((t) => !isLower(t))), def.roles[def.states.guard]];
  for (const [role, clip] of [...Object.entries(clips), ...Object.entries(derived).map(([k, [c]]) => [k, c])]) {
    const a = view.mixer.clipAction(clip);
    const row = def.roles[role] || derived[role][1];
    a.setLoop(row.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    a.clampWhenFinished = true;
    // every clip plays all the time at a weight the renderer sets (no crossfades); a one-shot is scrubbed by time, so it never advances itself
    a.enabled = true;
    a.setEffectiveWeight(0);
    a.play();
    if (!row.loop) a.paused = true;
    view.actions[role] = { a, row, dur: clip.duration };
  }
  const grip = handGrip(body);
  if (grip) {
    // the blade gripped across the palm, from the pinky side toward the index side: the library sword,
    // or a plain box if it didn't load. swordSpan = tip and guard heights along its +Y, for the trail
    let sword = swordModel;
    if (sword) view.swordSpan = [def.sword.tip, def.sword.guard];
    else {
      sword = new THREE.Mesh(new THREE.BoxGeometry(0.035, def.sword.length, 0.012), view.blade.material);
      sword.position.y = def.sword.length / 2 - def.sword.handle;
      sword.castShadow = true;
      view.swordSpan = [sword.position.y + def.sword.length / 2, sword.position.y - def.sword.length / 4];
    }
    grip.holder.add(sword);
    view.sword = sword;
  }
  // the soles: each foot and toe bone and its height above the floor in the bind pose (the body stands on y = 0 here)
  view.root.position.y = 0;
  body.updateMatrixWorld(true);
  view.soles = ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'].map((n) => body.getObjectByName('mixamorig' + n)).filter(Boolean)
    .map((b) => [b, b.getWorldPosition(new THREE.Vector3()).y]);
  view.lift = 0;
  view.spine = body.getObjectByName('mixamorigSpine1') || null;
  if (def.guardTilt) {
    const B = def.guardTilt.bones;
    view.tiltBones = { yaw: body.getObjectByName(B.yaw), arm: body.getObjectByName(B.arm), spine: body.getObjectByName(B.spine) };
  }
}

// the world-space hand frame at bind pose, turned into a holder on the hand bone whose +Y is the blade
function handGrip(body) {
  body.updateMatrixWorld(true);
  const bone = (n) => body.getObjectByName('mixamorig' + n);
  const hand = bone('RightHand'), idx = bone('RightHandIndex1'), mid = bone('RightHandMiddle1'), pin = bone('RightHandPinky1');
  if (!hand || !idx || !mid || !pin) return null;
  const at = (o) => o.getWorldPosition(new THREE.Vector3());
  const hp = at(hand), mp = at(mid);
  const finger = mp.clone().sub(hp).normalize();
  const y = at(idx).sub(at(pin)).normalize();
  const x = finger.clone().sub(y.clone().multiplyScalar(finger.dot(y))).normalize();
  const z = new THREE.Vector3().crossVectors(x, y);
  const normal = new THREE.Vector3().crossVectors(finger, y).normalize();
  const boneQ = hand.getWorldQuaternion(new THREE.Quaternion()).invert();
  const scale = hand.getWorldScale(new THREE.Vector3()).x || 1;
  const holder = new THREE.Group();
  holder.quaternion.copy(boneQ).multiply(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)));
  holder.position.copy(hp.clone().lerp(mp, 0.7).add(normal.multiplyScalar(-0.012)).sub(hp).applyQuaternion(boneQ).divideScalar(scale));
  holder.scale.setScalar(1 / scale);
  hand.add(holder);
  return { holder };
}

// What the combat layer is doing now. Returns { role, fade (target weight of that clip), frac (scrub position as a clip
// fraction, null = let it run), snap (weight jumps, no ease), guard (side tilt) }, or null when only locomotion shows.
function combatOf(f, view, sim, def, A) {
  const fade = (p, out = true) => Math.min(1, p * A.fadeIn, out ? (1 - p) * A.fadeOut : 1);
  if (f.phase === 'dead') return { role: def.states.dead, fade: 1, free: true };
  // a special: its clip runs start..strike over the windup (longer if a hit pushed it back), then strike..end over the recovery
  const S = sim.specials, slot = S && f.castSlot >= 0 ? S.slots[f.castSlot] : null;
  const scrub = (role, p) => {
    const row = def.roles[role] || {}, hit = row.hit ?? 0.46, s0 = row.start ?? 0;
    return [row, hit, s0, p];
  };
  if (slot && (f.special > 0 || (f.specialRecover > 0 && f.phase === 'ready'))) {
    const wind = f.special > 0, p = wind ? 1 - Math.min(f.special, S.windup) / S.windup : 1 - f.specialRecover / S.recovery;
    const [, hit, s0] = scrub(slot.clip, p);
    return { role: slot.clip, fade: wind ? fade(p, false) : fade(p), frac: wind ? s0 + p * (hit - s0) : hit + p * (1 - hit) };
  }
  if (f.phase === 'attack') {
    const m = sim.moves[f.move];
    const path = f.chained && m.chainPath ? m.chainPath : m.path || m.id;
    const t = f.chained && m.chained ? { ...m, ...m.chained } : m;
    const role = def.paths[path] || def.paths[m.path] || def.paths.heavy_overhead;
    const total = t.windup + t.active + t.recovery, p = Math.min(1, f.age / total), c = t.windup / total;
    // V1 swingProgress: sim progress through a slow wind-up, a snap through contact, a slow tail
    const [, hit, s0] = scrub(role, p), W = A.swing;
    const keys = [[0, s0], [c * W.windupKey, s0 + (hit - s0) * W.windupValue], [c, hit], [Math.min(1, c + W.followKey), hit + (1 - hit) * W.followValue], [1, 1]];
    let frac = 1;
    for (let i = 1; i < keys.length; i++) if (p <= keys[i][0]) { const [x, y] = keys[i - 1], [x1, y1] = keys[i]; frac = x1 > x ? y + (y1 - y) * (p - x) / (x1 - x) : y1; break; }
    const snap = f.age >= t.windup - W.snapBefore && f.age <= t.windup + W.snapAfter;
    return { role, fade: fade(p), frac, snap };
  }
  if (f.phase === 'roll' || f.phase === 'backstep') {
    const p = Math.min(1, f.age / (f.phase === 'roll' ? sim.rules.roll.ticks : sim.rules.backstep.ticks));
    return { role: def.states[f.phase], fade: fade(p), frac: p };
  }
  if (f.phase === 'hurt') {
    if (f.hurtKind === 'parried' || f.hurtKind === 'broken') {
      // the attacker's line is lost: Deflected opens on the contact pose, thrown widest by its .35 key, and snaps (V1 characters.ts defenceReaction)
      const p = Math.min(1, f.age / A.react.deflected);
      return { role: def.states.parried, fade: 1, frac: A.react.deflectFrom + p * (1 - A.react.deflectFrom), snap: true };
    }
    const p = Math.min(1, f.age / Math.max(1, f.age + f.stun));
    return { role: def.states.hurt, fade: fade(p), frac: p };
  }
  if (f.phase === 'ready' || f.phase === 'guard') {
    // a block or a parry just landed on this fighter: its short reaction clip over the guard
    const r = view.react;
    if (r && r.age < A.react[r.pose]) {
      const p = r.age / A.react[r.pose];
      if (r.pose === 'deflected') return { role: def.states.parried, fade: 1, frac: A.react.deflectFrom + p * (1 - A.react.deflectFrom), snap: true, guard: f.guardSide || 'thrust' };
      return { role: r.pose === 'blocked' ? def.states.blockHit : def.states.parry, fade: 1, frac: p, guard: f.guardSide || 'thrust' };
    }
  }
  if (f.phase === 'guard') return { role: def.states.guard, fade: 1, guard: f.guardSide || 'thrust' };
  return null;
}

// V1 gaitWeights: blend idle, walk, jog and run across the speed knots
function gaitWeights(speed, knots) {
  for (let i = 1; i < knots.length; i++) if (speed < knots[i]) {
    const t = (speed - knots[i - 1]) / (knots[i] - knots[i - 1]);
    return knots.map((_, k) => (k === i ? t : k === i - 1 ? 1 - t : 0));
  }
  return knots.map((_, k) => (k === knots.length - 1 ? 1 : 0));
}
const smoothstep = (x, a, b) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// The clips are fitted by hip height only, so a deep step or a lunge can drop a foot through the floor. Each frame the lowest sole
// (a foot or toe bone against its own height in the bind pose) lifts the whole body just enough to stand on the ground: up only,
// eased, never more than `maxLift`. A body in the air (a roll) is left alone.
const _p = new THREE.Vector3();
function keepOnGround(view, step, A) {
  if (!view.soles) return;
  view.root.position.y = 0;
  view.body.updateMatrixWorld(true);
  let gap = Infinity;
  for (const [bone, base] of view.soles) gap = Math.min(gap, bone.getWorldPosition(_p).y - base);
  const want = Math.min(A.ground.maxLift, Math.max(0, -gap));
  view.lift += (want - view.lift) * (1 - Math.exp(-step * A.ground.rate));
  view.root.position.y = view.lift;
}

// a block, a parry or a guard break landed on this view's fighter: the reaction clip plays over the next few ticks
export function reactTo(view, pose) { view.react = { pose, age: 0 }; }

export function drawFighter(view, f, sim, def, dt, frozen, A) {
  view.root.position.set(f.x, 0, f.z);
  view.root.rotation.set(0, f.heading, 0);   // the fx layer adds flinch and recoil on top each frame
  const cm = combatOf(f, view, sim, def, A);

  if (!view.mixer) {
    // capsule: tint the active frames red, guard blue, hurt grey
    const m = f.phase === 'attack' ? sim.moves[f.move] : null, t = m && (f.chained && m.chained ? { ...m, ...m.chained } : m);
    const active = t && f.age >= t.windup && f.age < t.windup + t.active;
    view.mat.color.set(f.phase === 'dead' ? 0x333333 : active ? 0xff3030 : f.phase === 'guard' ? 0x3a6cff : f.phase === 'hurt' ? 0x8a8a8a : f.phase === 'roll' ? 0xffd166 : view.base);
    view.stand.rotation.z = f.phase === 'roll' ? Math.sin(f.age / 36 * Math.PI) * 1.2 : 0;
    view.blade.rotation.y = t ? -1.2 + 2.4 * Math.min(1, f.age / (t.windup + t.active)) : 0;
    return;
  }

  const step = frozen ? 0 : Math.min(dt, A.stepMax);
  if (view.react && !frozen) view.react.age += dt * sim.rules.tickHz;

  // travel speed in the fighter's own frame: forward (signed), and the share of it that is sideways (left positive)
  const lh = f.lockHeading ?? f.heading, sh = Math.sin(lh), ch = Math.cos(lh);
  const speedNow = Math.hypot(f.vx || 0, f.vz || 0);
  const forward = (f.vx || 0) * sh + (f.vz || 0) * ch, left = (f.vx || 0) * ch - (f.vz || 0) * sh;
  const lateral = speedNow > 1e-6 ? left / speedNow : 0;
  view.speed += (speedNow - view.speed) * (1 - Math.exp(-step * A.speedRate));
  if (view.speed < A.gait.stopBelow) view.speed = 0;
  const back = forward < -1e-6 ? -1 : 1;

  // locomotion weights (V1 characters.ts:832-837, armed): idle <-> movement by speed; movement = walk / strafe / run
  const G = A.gait, gait = gaitWeights(view.speed, G.knots), movement = 1 - gait[0];
  const side = Math.min(1, Math.abs(lateral)), run = smoothstep(view.speed, G.runFrom, G.runTo);
  const loco = {
    [def.states.idle]: gait[0],
    [def.states.walk]: movement * (1 - side) * (1 - run),
    [def.states.strafeLeft]: lateral > 0 ? movement * side * (1 - run) : 0,
    [def.states.strafeRight]: lateral <= 0 ? movement * side * (1 - run) : 0,
    [def.states.run]: movement * run,
  };
  const rate = (role, min) => { const row = view.actions[role]?.row; return row?.speed ? Math.max(min, view.speed / row.speed) : 1; };
  const set = (role, ts) => { const e = view.actions[role]; if (e) e.a.timeScale = ts; };
  set(def.states.walk, back * rate(def.states.walk, G.walkRateMin));
  set(def.states.strafeLeft, rate(def.states.strafeLeft, G.walkRateMin));
  set(def.states.strafeRight, rate(def.states.strafeRight, G.walkRateMin));
  set(def.states.run, back * rate(def.states.run, G.runRateMin));
  for (const r of [def.states.walk, def.states.strafeLeft, def.states.strafeRight, def.states.run]) { const e = view.actions[r], l = view.actions[r + '_L']; if (e && l) l.a.timeScale = e.a.timeScale; }
  // guarded and moving: the guard's upper body over walking legs (the full Guard clip only when he stands still)
  const guardMove = cm && cm.guard && cm.role === def.states.guard && view.actions.Guard_U;
  const split = {};
  if (guardMove) {
    split[cm.role] = cm.fade * (1 - movement);
    split.Guard_U = cm.fade * movement;
    for (const r of [def.states.idle, def.states.walk, def.states.strafeLeft, def.states.strafeRight, def.states.run]) split[r + '_L'] = cm.fade * movement * (loco[r] || 0);
  }

  // the combat clip over it, and every weight eased toward its target (snapping through the live blade and a deflect)
  if (cm && cm.role !== view.combatRole) {
    const e = view.actions[cm.role];
    if (cm.free && e) { e.a.reset(); e.a.paused = false; e.a.play(); }   // a one-shot that runs by itself (the death clip) starts from its first frame
  }
  view.combatRole = cm ? cm.role : null;
  const ease = 1 - Math.exp(-step * A.weightRate);
  for (const [role, e] of Object.entries(view.actions)) {
    const isCombat = cm && role === cm.role, fadeW = cm ? cm.fade : 0;
    const target = guardMove ? (split[role] ?? (loco[role] || 0) * (1 - fadeW)) : (loco[role] || 0) * (1 - fadeW) + (isCombat ? fadeW : 0);
    if (!view.primed) view.w[role] = target;
    else view.w[role] = cm && cm.snap ? (isCombat ? 1 : 0) : view.w[role] + (target - view.w[role]) * ease;
    if (view.w[role] < A.weightFloor && target === 0) view.w[role] = 0;   // an eased weight never reaches 0 by itself: a clip left at 1e-9 would still be evaluated every frame
    e.a.setEffectiveWeight(view.w[role]);
    if (isCombat && cm.frac != null) { e.a.paused = true; e.a.time = Math.min(e.dur, cm.frac * e.dur); }
  }
  view.primed = true;
  view.mixer.update(step);
  keepOnGround(view, step, A);

  // the guard side, V1's way: one Guard clip plus a per-side tilt of the torso, chest and sword arm, eased in and out
  if (def.guardTilt) {
    const goal = cm && cm.guard ? def.guardTilt.sides[cm.guard] : def.guardTilt.sides.thrust, b = view.tiltBones, k = 1 - Math.exp(-step * A.tiltRate);
    for (const key of ['yaw', 'arm', 'spine']) view.tilt[key] += ((goal[key] || 0) - view.tilt[key]) * k;
    if (view.tilt.yaw) b.yaw?.rotateY(view.tilt.yaw);
    if (view.tilt.arm) b.arm?.rotateX(view.tilt.arm);
    if (view.tilt.spine) b.spine?.rotateX(view.tilt.spine);
  }
}
