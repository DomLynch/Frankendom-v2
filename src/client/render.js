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
  const hand = body.getObjectByName('mixamorigRightHand');
  if (hand) {
    // a plain blade on the hand bone; the grip is a first guess
    const s = 1 / (hand.getWorldScale(new THREE.Vector3()).x || 1);
    const sword = view.blade.clone();
    sword.geometry = new THREE.BoxGeometry(0.035, 0.95, 0.02);
    sword.position.set(0, 0.5, 0.03).multiplyScalar(s);
    sword.scale.setScalar(s);
    hand.add(sword);
  }
}

function roleFor(f, sim, def) {
  if (f.phase === 'dead') return { role: def.states.dead, scrub: null };
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
  view.root.rotation.y = f.heading;
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
    if (pose.attack) {
      const t = pose.attack, hit = row.hit ?? 0.46;
      const frac = pose.age < t.windup ? (pose.age / t.windup) * hit : hit + ((pose.age - t.windup) / (t.active + t.recovery)) * (1 - hit);
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
