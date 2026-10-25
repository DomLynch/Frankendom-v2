// Draws one fighter from sim state. It reads the sim and never writes to it.
// Attack, roll and reaction clips are scrubbed to the sim's tick, so the strike
// frame (row.hit) lands on the sim's active tick. Loops play at a speed matched
// to the sim's travel speed.
import * as THREE from 'three';

const GUARD_KEY = { thrust: 'mid', overhead: 'high', low: 'low', left: 'left', right: 'right' };
const FADE = 0.12;

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
  return { root, stand, mat, blade, base: new THREE.Color(color), body: null, mixer: null, actions: {}, current: null };
}

export function attachBody(view, body, clips, def) {
  view.root.remove(view.stand);
  view.root.add(body);
  view.body = body;
  view.mixer = new THREE.AnimationMixer(body);
  for (const [role, clip] of Object.entries(clips)) {
    const a = view.mixer.clipAction(clip);
    const row = def.roles[role];
    a.setLoop(row.loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    a.clampWhenFinished = true;
    view.actions[role] = { a, row, dur: clip.duration };
  }
  const grip = handGrip(body);
  if (grip) {
    // a plain blade gripped across the palm, from the pinky side toward the index side
    const sword = new THREE.Mesh(new THREE.BoxGeometry(0.035, def.sword.length, 0.012), view.blade.material);
    sword.position.y = def.sword.length / 2 - def.sword.handle;
    sword.castShadow = true;
    grip.holder.add(sword);
    view.sword = sword;
  }
  view.spine = body.getObjectByName('mixamorigSpine1') || null;
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

function roleFor(f, sim, def) {
  if (f.phase === 'dead') return { role: def.states.dead, scrub: null };
  // a special: its clip runs start..strike over the windup (longer if a hit pushed it back), then strike..end over the recovery
  const S = sim.specials, slot = S && f.castSlot >= 0 ? S.slots[f.castSlot] : null;
  if (slot && f.special > 0) return { role: slot.clip, special: 'windup', p: 1 - Math.min(f.special, S.windup) / S.windup };
  if (slot && f.specialRecover > 0 && f.phase === 'ready') return { role: slot.clip, special: 'recover', p: 1 - f.specialRecover / S.recovery };
  if (f.phase === 'attack') {
    const m = sim.moves[f.move];
    const path = f.chained && m.chainPath ? m.chainPath : m.path || m.id;
    const t = f.chained && m.chained ? { ...m, ...m.chained } : m;
    return { role: def.paths[path] || def.paths[m.path] || def.paths.heavy_overhead, attack: t, age: f.age };
  }
  if (f.phase === 'roll') return { role: def.states.roll, frac: f.age / sim.rules.roll.ticks };
  if (f.phase === 'backstep') return { role: def.states.backstep, frac: f.age / sim.rules.backstep.ticks };
  if (f.phase === 'hurt') {
    const k = f.hurtKind === 'parried' || f.hurtKind === 'broken' || f.hurtKind === 'posture' ? def.states.parried : def.states.hurt;
    return { role: k, frac: Math.min(1, f.age / Math.max(1, f.age + f.stun)) };
  }
  if (f.phase === 'guard') return { role: def.states.guard[GUARD_KEY[f.guardSide] || 'mid'] };
  if (f.speed > 0.05) {
    if (f.speed > 3.5) return { role: def.states.run, speed: f.speed };
    return { role: def.states.walk, speed: f.speed };
  }
  return { role: def.states.idle };
}

export function drawFighter(view, f, sim, def, dt, frozen) {
  view.root.position.set(f.x, 0, f.z);
  view.root.rotation.set(0, f.heading, 0);   // the fx layer adds flinch and recoil on top each frame
  const pose = roleFor(f, sim, def);

  if (!view.mixer) {
    // capsule: tint the active frames red, guard blue, hurt grey
    const active = pose.attack && pose.age >= pose.attack.windup && pose.age < pose.attack.windup + pose.attack.active;
    view.mat.color.set(f.phase === 'dead' ? 0x333333 : active ? 0xff3030 : f.phase === 'guard' ? 0x3a6cff : f.phase === 'hurt' ? 0x8a8a8a : f.phase === 'roll' ? 0xffd166 : view.base);
    view.stand.rotation.z = f.phase === 'roll' ? Math.sin(f.age / 36 * Math.PI) * 1.2 : 0;
    view.blade.rotation.y = pose.attack ? -1.2 + 2.4 * Math.min(1, pose.age / (pose.attack.windup + pose.attack.active)) : 0;
    return;
  }

  const entry = view.actions[pose.role];
  if (entry && view.current !== pose.role) {
    const prev = view.actions[view.current];
    entry.a.reset().play();
    if (prev) entry.a.crossFadeFrom(prev.a, FADE, false);
    view.current = pose.role;
  }
  if (entry) {
    const { a, row, dur } = entry;
    if (pose.special) {
      const hit = row.hit ?? 0.46, s0 = row.start ?? 0;
      const frac = pose.special === 'windup' ? s0 + pose.p * (hit - s0) : hit + pose.p * (1 - hit);
      a.paused = true;
      a.time = Math.min(dur, frac * dur);
    } else if (pose.attack) {
      const t = pose.attack, hit = row.hit ?? 0.46, s0 = row.start ?? 0;
      const frac = pose.age < t.windup ? s0 + (pose.age / t.windup) * (hit - s0) : hit + ((pose.age - t.windup) / (t.active + t.recovery)) * (1 - hit);
      a.paused = true;
      a.time = Math.min(dur, frac * dur);
    } else if (pose.frac != null) {
      a.paused = true;
      a.time = Math.min(dur, pose.frac * dur);
    } else {
      a.paused = false;
      a.timeScale = pose.speed && row.speed ? pose.speed / row.speed : 1;
    }
  }
  view.mixer.update(frozen ? 0 : dt);
}
