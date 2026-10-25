// V1's blood: a spray of heavy drops and mist on each flesh hit (more on a kill), a splash on the floor under the
// struck fighter that fades over 20 s, and a pool that spreads under a corpse and stays. Floor stains multiply onto
// the floor, so they darken it instead of painting over it (V1 finisher-blood.ts multiplyOnto). Numbers: data/blood.json.
import * as THREE from 'three';

const between = (r) => r[0] + Math.random() * (r[1] - r[0]);

export function createBlood(scene, def) {
  const S = def.spray, F = def.floor;
  const mat = new THREE.MeshBasicMaterial({ color: S.fresh, transparent: true, depthWrite: false });
  const drops = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 6, 4), mat, S.pool);
  drops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  drops.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(S.pool * 3), 3);
  drops.frustumCulled = false;
  drops.count = 0;
  scene.add(drops);
  let items = [];
  const tmp = new THREE.Object3D(), fresh = new THREE.Color(S.fresh), dark = new THREE.Color(S.dark), col = new THREE.Color();

  // floor decals: a ring of planes reused in turn
  const loader = new THREE.TextureLoader();
  const load = (urls) => urls.map((u) => { const t = loader.load(u); t.colorSpace = THREE.SRGBColorSpace; return t; });
  const maps = { pool: load(F.textures.pool), splash: load(F.textures.splash) };
  let next = 0;
  const decals = Array.from({ length: F.decals }, () => {
    const m = new THREE.MeshBasicMaterial({
      transparent: true, depthWrite: false, toneMapped: false, opacity: 0,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.OneMinusSrcAlphaFactor, premultipliedAlpha: true,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, life: 0, grow: 0, age: 0 };
  });

  function stain(x, z, pool) {
    const d = decals[next % decals.length], i = next++;
    const list = pool ? maps.pool : maps.splash;
    d.mesh.material.map = list[i % list.length];
    d.mesh.material.needsUpdate = true;
    d.mesh.position.set(x, 0.022 + (i % 12) * 0.0001, z);
    d.mesh.rotation.z = i * 2.4;
    d.age = 0;
    if (pool) {
      d.life = Infinity; d.grow = 1e-6;
      d.mesh.position.y = 0.03;
      d.mesh.scale.set(F.pool.from[0], F.pool.from[1], 1);
    } else {
      d.life = F.splashLife; d.grow = 0;
      d.mesh.scale.set(F.splash.x[0] + (i % F.splash.x[2]) * F.splash.x[1], F.splash.y[0] + (i % F.splash.y[2]) * F.splash.y[1], 1);
    }
  }

  function spray(at, dir, kill) {
    const n = S.count[kill ? 'kill' : 'hit'], heavy = S.drops[kill ? 'kill' : 'hit'];
    for (let i = 0; i < n && items.length < S.pool; i++) {
      const a = Math.random() * Math.PI * 2, r = i < heavy ? S.drop : S.mist;
      const v = i < heavy
        ? new THREE.Vector3(Math.cos(a) * between(r.spread) + dir.x * between(r.along), between(r.vy), Math.sin(a) * between(r.spread) + dir.z * between(r.along))
        : (() => { const sp = between(r.speed); return new THREE.Vector3(Math.cos(a) * sp * 0.6 + dir.x * between(r.along), between(r.vy), Math.sin(a) * sp * 0.6 + dir.z * between(r.along)); })();
      const life = between(r.life);
      items.push({ p: at.clone(), v, t: 0, life, size: between(r.size), stretch: between(r.stretch) });
    }
  }

  return {
    onEvents(events, sim) {
      const F0 = sim.state.fighters;
      for (const e of events) {
        if (e.t !== 'Hit' && e.t !== 'GuardBroken' && e.t !== 'SpecialLanded') continue;
        if (e.move === 'kick') continue;   // a kick is bloodless (V1 fx.ts bloodless colour)
        const a = F0[e.a], d = F0[e.d];
        const dx = d.x - a.x, dz = d.z - a.z, len = Math.hypot(dx, dz) || 1;
        const dir = new THREE.Vector3(dx / len, 0, dz / len);
        const kill = d.hp <= 0;
        spray(new THREE.Vector3(d.x - dir.x * 0.2, S.height, d.z - dir.z * 0.2), dir, kill);
        stain(d.x + dir.x * 0.15, d.z + dir.z * 0.15, false);
        if (kill) stain(d.x, d.z, true);
      }
    },

    update(dt) {
      items = items.filter((it) => (it.t += dt) < it.life);
      items.forEach((it, i) => {
        it.v.y -= S.gravity * dt;
        it.p.addScaledVector(it.v, dt);
        if (it.p.y < 0.01) { it.p.y = 0.01; it.v.set(0, 0, 0); }
        const k = it.t / it.life;
        tmp.position.copy(it.p);
        if (it.v.lengthSq() > 1e-6) tmp.lookAt(it.p.clone().add(it.v));
        tmp.scale.set(it.size, it.size, it.size * it.stretch);
        tmp.updateMatrix();
        drops.setMatrixAt(i, tmp.matrix);
        drops.setColorAt(i, col.copy(fresh).lerp(dark, k));
      });
      drops.count = items.length;
      drops.instanceMatrix.needsUpdate = true;
      if (drops.instanceColor) drops.instanceColor.needsUpdate = true;

      const dried = new THREE.Color(F.dried), wet = new THREE.Color(F.fresh);
      for (const d of decals) {
        d.life = Math.max(0, d.life - dt);
        d.mesh.visible = d.life > 0;
        if (!d.mesh.visible) continue;
        d.age += dt;
        if (d.life === Infinity) {
          d.grow = Math.min(1, d.grow + dt / F.poolSpread);
          d.mesh.scale.set(F.pool.from[0] + F.pool.grow[0] * d.grow, (F.pool.from[1] + F.pool.grow[1] * d.grow) * F.pool.squash, 1);
          d.mesh.material.opacity = d.grow;
        } else {
          d.mesh.material.opacity = Math.min(F.splashOpacity, d.life / F.fadeFrom);
        }
        d.mesh.material.color.copy(wet).lerp(dried, Math.min(1, d.age / F.dry));
      }
    },

    // a new bout: the floor is clean again
    clear() { for (const d of decals) { d.life = 0; d.mesh.visible = false; } items = []; },
  };
}
