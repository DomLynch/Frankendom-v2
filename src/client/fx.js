// The impact layer: what a contact does on screen, ported from V1 (numbers in data/feel.json).
// It reads sim events and fighter state and never writes to the sim. Every effect runs on the
// frame clock, so effects keep moving while the sim is frozen by hit-stop.
import * as THREE from 'three';

const HEAVY = new Set(['heavy_overhead', 'heavy_riposte', 'heavy_counter', 'critical', 'skill_cleave']);
const UP = new THREE.Vector3(0, 1, 0);

export function createFx(scene, def) {
  const kicks = [];                    // camera shoves: { v, hold, settle, t }
  const body = [{}, {}];               // per fighter: flinch and block recoil
  let dip = 0;                         // kill exposure dip, frames left
  let hurtFlash = 0;

  // ---- particle pools: instanced spheres (contact dots) and stretched boxes (sparks) ----
  const pool = (geo, n) => {
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false }), n);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    mesh.frustumCulled = false;
    mesh.count = 0;
    scene.add(mesh);
    return { mesh, items: [] };
  };
  const dots = pool(new THREE.SphereGeometry(0.5, 6, 4), 96);
  const sparks = pool(new THREE.BoxGeometry(0.12, 0.12, 1), 64);
  sparks.mesh.material.opacity = def.sparks.opacity;
  const tmp = new THREE.Object3D(), col = new THREE.Color(), hot = new THREE.Color(def.sparks.hot), cool = new THREE.Color(def.sparks.cool);

  // the contact point: on the defender, toward the attacker, at chest height
  const contactOf = (a, d) => {
    const dx = d.x - a.x, dz = d.z - a.z, len = Math.hypot(dx, dz) || 1;
    return { p: new THREE.Vector3(d.x - (dx / len) * 0.25, def.dots.height, d.z - (dz / len) * 0.25), dir: new THREE.Vector3(dx / len, 0, dz / len) };
  };

  function spray(at, dir, n, colour, size, life, speed) {
    for (let i = 0; i < n && dots.items.length < 96; i++) {
      const v = dir.clone().multiplyScalar(0.6 + Math.random() * 0.8)
        .add(new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5)).normalize().multiplyScalar(speed * (0.5 + Math.random()));
      dots.items.push({ p: at.clone(), v, t: 0, life, size, c: new THREE.Color(colour) });
    }
  }

  function clash(at, dir, strength) {
    const s = def.sparks, n = Math.round(s.min + (s.max - s.min) * strength);
    for (let i = 0; i < n && sparks.items.length < 64; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.2, Math.random() - 0.5).add(dir.clone().multiplyScalar(-0.4))
        .normalize().multiplyScalar(s.speed * (0.5 + Math.random() * strength));
      sparks.items.push({ p: at.clone(), v, t: 0, life: s.life[0] + Math.random() * (s.life[1] - s.life[0]), bounced: false });
    }
    // the glint: one bright dot that lives a few frames
    dots.items.push({ p: at.clone(), v: new THREE.Vector3(), t: 0, life: s.glint, size: s.size * 2.2, c: hot.clone() });
  }

  function shove(row, dir) {
    if (!row) return;
    const side = new THREE.Vector3().crossVectors(UP, dir).normalize();
    const v = dir.clone().multiplyScalar(row.along).add(side.multiplyScalar(row.side)).add(new THREE.Vector3(0, -row.drop, 0));
    kicks.push({ v, hold: row.holdFrames / 60, settle: row.settle, t: 0 });
  }

  function flinch(i, dir, kill, hero) {
    const f = def.flinch, share = hero ? f.heroShare : 1;
    body[i].flinch = { dir, amt: (kill ? f.killLean : f.lean) * share, nudge: f.nudge * share, hold: kill ? f.killHold : f.hold, t: 0 };
  }

  return {
    get hurtFlash() { return hurtFlash > 0; },
    get exposureDip() { return dip > 0 ? def.killDip.depth : 0; },

    onEvents(events, sim) {
      const F = sim.state.fighters, K = def.cameraKick;
      for (const e of events) {
        if (e.a == null && e.t !== 'Killed') continue;
        const a = F[e.a], d = F[e.d];
        const c = a && d ? contactOf(a, d) : null;
        const heavy = e.heavy || HEAVY.has(e.move);
        if (e.t === 'Hit' || e.t === 'SpecialLanded') {   // a landed special plays the heavy impact layer (V1: no dedicated special VFX)
          const kill = d.hp <= 0;
          shove(e.move === 'kick' ? K.kick : heavy ? K.heavyHit : K.hit, c.dir);
          spray(c.p, c.dir, def.dots.count, e.move === 'kick' ? def.dots.color.bloodless : def.dots.color.flesh, def.dots.size.flesh,
            kill ? def.dots.life.kill : def.dots.life.flesh, def.dots.speed);
          if (!e.poised) flinch(e.d, c.dir, kill, e.d === 0);
          if (e.d === 0) hurtFlash = def.hurtFlashMs / 1000;
        } else if (e.t === 'Blocked') {
          shove(heavy ? K.heavyGuard : e.perfect ? K.perfectGuard : K.guard, c.dir);
          clash(c.p, c.dir, e.perfect ? def.sparks.strength.perfectGuard : heavy ? def.sparks.strength.heavy : def.sparks.strength.guard);
          spray(c.p, c.dir, 4, def.dots.color.guard, def.dots.size.other, def.dots.life.other, def.dots.speed);
          body[e.d].block = { dir: c.dir, t: 0, k: heavy ? def.blockRecoil.heavy : 1 };
        } else if (e.t === 'Parried') {
          shove(K.parry, c.dir);
          clash(c.p, c.dir, def.sparks.strength.parry);
        } else if (e.t === 'GuardBroken') {
          shove(K.guardBreak, c.dir);
          clash(c.p, c.dir, def.sparks.strength.guardBreak);
          spray(c.p, c.dir, def.dots.count, def.dots.color.flesh, def.dots.size.flesh, def.dots.life.flesh, def.dots.speed);
          flinch(e.d, c.dir, false, e.d === 0);
        } else if (e.t === 'Killed') {
          dip = def.killDip.frames;
        }
      }
    },

    // per-frame: particles, camera shove, the roll tilt; returns the camera offset and roll
    update(dt, sim) {
      for (const [P, stretch] of [[dots, false], [sparks, true]]) {
        P.items = P.items.filter((it) => (it.t += dt) < it.life);
        P.items.forEach((it, i) => {
          it.v.y -= (stretch ? def.sparks.gravity : def.dots.gravity) * dt;
          it.p.addScaledVector(it.v, dt);
          if (it.p.y < 0.01) {
            if (stretch && !it.bounced) { it.p.y = 0.01; it.v.y *= -def.sparks.bounce; it.bounced = true; } else { it.p.y = 0.01; it.v.set(0, 0, 0); }
          }
          const k = 1 - it.t / it.life;
          tmp.position.copy(it.p);
          if (stretch) {
            tmp.lookAt(it.p.clone().add(it.v.lengthSq() > 1e-6 ? it.v : UP));
            const len = Math.min(0.25, it.v.length() * 0.035) + 0.02;
            tmp.scale.set(def.sparks.size * 0.25, def.sparks.size * 0.25, len);
            col.copy(hot).lerp(cool, 1 - k);
          } else {
            tmp.rotation.set(0, 0, 0);
            tmp.scale.setScalar(it.size * Math.max(0.15, k));
            col.copy(it.c);
          }
          tmp.updateMatrix();
          P.mesh.setMatrixAt(i, tmp.matrix);
          P.mesh.setColorAt(i, col);
        });
        P.mesh.count = P.items.length;
        P.mesh.instanceMatrix.needsUpdate = true;
        if (P.mesh.instanceColor) P.mesh.instanceColor.needsUpdate = true;
      }

      const off = new THREE.Vector3();
      for (const k of kicks) {
        k.t += dt;
        const w = k.t < k.hold ? 1 : Math.max(0, 1 - (k.t - k.hold) / k.settle);
        off.addScaledVector(k.v, w);
      }
      for (let i = kicks.length - 1; i >= 0; i--) if (kicks[i].t > kicks[i].hold + kicks[i].settle) kicks.splice(i, 1);

      // the player's roll: an 8 degree tilt and a small dip over 0.6 s
      let roll = 0;
      const me = sim.state.fighters[0], R = def.cameraKick.roll;
      if (me.phase === 'roll') {
        const t = Math.min(1, me.age / 60 / R.duration), s = Math.sin(t * Math.PI);
        roll = (R.tiltDeg * Math.PI / 180) * s * (me.rollX * Math.cos(me.heading) - me.rollZ * Math.sin(me.heading) >= 0 ? 1 : -1);
        off.y -= R.dip * s;
      }
      if (dip > 0) dip--;
      if (hurtFlash > 0) hurtFlash -= dt;
      for (const b of body) {
        if (b.flinch) b.flinch.t += dt;
        if (b.block) b.block.t += dt;
      }
      return { offset: off, roll };
    },

    // after the clip pose: lean the spine away from the blow, nudge the root, roll on block or hurt
    applyPose(view, i, f) {
      const b = body[i], root = view.root;
      const fl = b.flinch;
      if (fl) {
        const w = fl.t < fl.hold ? 1 : Math.exp(-def.flinch.decay * (fl.t - fl.hold));
        if (w < 0.01) b.flinch = null;
        else {
          root.position.addScaledVector(fl.dir, fl.nudge * w);
          const axis = new THREE.Vector3().crossVectors(UP, fl.dir).normalize();
          const spine = view.spine;
          if (spine) spine.rotateOnWorldAxis(axis, fl.amt * w);
          else root.rotateOnWorldAxis(axis, fl.amt * w * 0.3);
        }
      }
      const bl = b.block, R = def.blockRecoil;
      if (bl) {
        const p = bl.t / R.duration;
        if (p >= 1) b.block = null;
        else {
          const s = Math.sin(p * Math.PI) * bl.k;
          root.position.addScaledVector(bl.dir, R.push * s);
          root.rotateOnWorldAxis(new THREE.Vector3().crossVectors(UP, bl.dir).normalize(), R.roll * s);
        }
      }
      if (f.phase === 'hurt' && f.hurtKind === 'hit') {
        const total = f.age + f.stun, p = f.age / Math.max(1, total);
        root.rotation.z += def.hurtRecoil.roll * Math.sin(p * Math.PI) * (i === 0 ? 1 : -1);
      }
    },

    // the blade trail: the last N blade positions while the swing passes through contact
    trail(view, f, sim) {
      const T = def.trail;
      if (!view.trail) {
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(T.samples * 2 * 3), 3));
        const idx = [];
        for (let s = 0; s < T.samples - 1; s++) { const a = s * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
        geo.setIndex(idx);
        view.trail = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: T.color, transparent: true, opacity: T.opacity, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
        view.trail.frustumCulled = false;
        view.trailPts = [];
        scene.add(view.trail);
      }
      let on = false;
      if (f.phase === 'attack' && view.sword) {
        const m = sim.moves[f.move], t = f.chained && m.chained ? { ...m, ...m.chained } : m;
        const total = t.windup + t.active + t.recovery, contact = t.windup / total, p = f.age / total;
        on = p >= contact * T.from && p <= contact + T.to;
      }
      if (!on) { view.trail.visible = false; view.trailPts.length = 0; return; }
      view.sword.updateWorldMatrix(true, false);
      const len = view.sword.geometry.parameters.height;
      view.trailPts.unshift([
        new THREE.Vector3(0, len / 2, 0).applyMatrix4(view.sword.matrixWorld),
        new THREE.Vector3(0, -len / 4, 0).applyMatrix4(view.sword.matrixWorld),
      ]);
      view.trailPts.length = Math.min(view.trailPts.length, T.samples);
      const pos = view.trail.geometry.attributes.position;
      for (let s = 0; s < T.samples; s++) {
        const [tip, mid] = view.trailPts[Math.min(s, view.trailPts.length - 1)];
        pos.setXYZ(s * 2, tip.x, tip.y, tip.z);
        pos.setXYZ(s * 2 + 1, mid.x, mid.y, mid.z);
      }
      pos.needsUpdate = true;
      view.trail.visible = view.trailPts.length > 1;
    },
  };
}
