// Boots the stage, the sim and the views. The sim steps at a fixed 60 Hz from an
// accumulator; the renderer interpolates nothing and only reads state.
import * as THREE from 'three';
import { createStage } from './stage.js';
import { createInput } from './input.js';
import { createFighterView, attachBody, drawFighter } from './render.js';
import { loadBody, loadClips } from './assets.js';
import { createSim } from '../sim/sim.js';
import { createBrain, think } from '../sim/brain.js';

const get = (f) => fetch(`./data/${f}.json`, { cache: 'no-cache' }).then((r) => r.json());
const [rules, moves, controls, stage, clips, camDef, hitStop, behaviours] = await Promise.all(
  ['rules', 'move-defs', 'controls', 'stage', 'clips', 'camera', 'hit-stop', 'behaviours'].map(get),
);
const params = new URLSearchParams(location.search);
const hitScale = params.has('hitstop') ? Number(params.get('hitstop')) : hitStop.scale;
const brainRow = behaviours.brains.find((b) => b.id === (params.get('brain') || 'easy'));
fetch('./build.txt').then((r) => (r.ok ? r.text() : '')).then((t) => { document.getElementById('build').textContent = t.slice(0, 7); }).catch(() => {});

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.prepend(renderer.domElement);
const scene = createStage(renderer, stage);
const camera = new THREE.PerspectiveCamera(camDef.fov, innerWidth / innerHeight, camDef.near, camDef.far);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

const data = { rules, moves };
let seed = Number(params.get('seed')) || 1;
let sim, brain, deadFor;
function newBout() {
  sim = createSim(data, seed);
  brain = createBrain(brainRow, seed * 7919 + 1);
  deadFor = 0;
  document.getElementById('msg').textContent = '';
  seed++;
}
newBout();

const views = [createFighterView(scene, 0xb08a5a), createFighterView(scene, 0x7a5aa0)];
const input = createInput(controls);
for (const [i, slot] of [[0, 'player'], [1, 'opponent']]) {
  loadBody(clips, slot)
    .then(async (body) => attachBody(views[i], body, await loadClips(clips, body), clips))
    .catch((e) => console.warn('body', slot, e));
}

// hit-stop: presentation only. The sim pauses stepping; the scale row is 0 by default
const stopMs = (events) => {
  let ms = 0;
  for (const e of events) {
    const row = (e.heavy && hitStop.heavy.find((r) => r.id === e.t)) || hitStop.stop.find((r) => r.id === e.t);
    if (row) ms = Math.max(ms, row.ms);
  }
  return ms * hitScale;
};

// V1 lock-on camera: behind the player, looking at the midpoint
const cam = { yaw: 0, pos: new THREE.Vector3(), look: new THREE.Vector3(), init: false };
function updateCamera(dt) {
  const [p, q] = sim.state.fighters;
  const gap = Math.max(camDef.gapFloor, Math.hypot(q.x - p.x, q.z - p.z));
  const back = Math.max(camDef.back.floor, camDef.back.perGap * gap + camDef.back.base) * camDef.fightBack;
  const up = Math.max(camDef.height.floor, camDef.height.perGap * gap) * camDef.fightBack;
  const yaw = Math.atan2(p.x - q.x, p.z - q.z);
  const k = cam.init ? 1 - Math.exp(-camDef.follow * dt) : 1;
  cam.yaw += Math.atan2(Math.sin(yaw - cam.yaw), Math.cos(yaw - cam.yaw)) * k;
  const sx = Math.sin(cam.yaw), sz = Math.cos(cam.yaw);
  // over the right shoulder, so the player never hides the foe
  const tPos = new THREE.Vector3(p.x + sx * back + sz * camDef.side, up, p.z + sz * back - sx * camDef.side);
  const tLook = new THREE.Vector3((p.x + q.x) / 2 + sx * camDef.lookShift, camDef.lookY, (p.z + q.z) / 2 + sz * camDef.lookShift);
  cam.pos.lerp(tPos, k);
  cam.look.lerp(tLook, k);
  cam.init = true;
  camera.position.copy(cam.pos);
  camera.lookAt(cam.look);
}

const bar = (id, v) => { document.getElementById(id).style.width = Math.max(0, Math.min(100, v)) + '%'; };
const STEP = 1000 / rules.tickHz;
let acc = 0, last = performance.now(), frozenUntil = 0;
function frame(t) {
  const dt = Math.min(0.1, (t - last) / 1000);
  last = t;
  const frozen = t < frozenUntil;
  if (!frozen) {
    acc += dt * 1000;
    while (acc >= STEP) {
      acc -= STEP;
      const me = sim.state.fighters[0];
      const events = sim.step([input.sample(cam.yaw, me), think(brain, sim, 1)]);
      const ms = stopMs(events);
      if (ms > 0) { frozenUntil = t + ms; acc = 0; break; }
      if (sim.state.over && ++deadFor >= rules.death) newBout();
    }
  }
  if (sim.state.over) {
    const won = sim.state.fighters[1].hp <= 0;
    document.getElementById('msg').textContent = won ? 'Victory' : 'Defeat';
  }
  sim.state.fighters.forEach((f, i) => {
    drawFighter(views[i], f, sim, clips, dt, frozen);
    bar('hp' + i, (f.hp / rules.health) * 100);
    bar('st' + i, (f.st / rules.stamina.max) * 100);
    bar('po' + i, (f.posture / rules.posture.max) * 100);
  });
  updateCamera(dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
