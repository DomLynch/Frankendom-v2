// Boots the stage, the sim and the views. The sim steps at a fixed 60 Hz from an
// accumulator; the renderer interpolates nothing and only reads state.
import * as THREE from 'three';
import { createStage } from './stage.js';
import { lockPageZoom, viewW, viewH } from './zoom-guard.js';
import { createInput } from './input.js';
import { createFighterView, attachBody, drawFighter, reactTo } from './render.js';
import { createFx } from './fx.js';
import { createSound } from './sound.js';
import { createBlood } from './blood.js';
import { loadBody, loadClips, loadSword } from './assets.js';
import { createSim } from '../sim/sim.js';
import { createBrain, think } from '../sim/brain.js';

const get = (f) => fetch(`./data/${f}.json`, { cache: 'no-cache' }).then((r) => r.json());
const [rules, moves, controls, stage, clips, camDef, hitStop, behaviours, specials, feelDef, soundDef, bloodDef, blades, anim] = await Promise.all(
  ['rules', 'move-defs', 'controls', 'stage', 'clips', 'camera', 'hit-stop', 'behaviours', 'specials', 'feel', 'sound', 'blood', 'blades', 'anim'].map(get),
);
const params = new URLSearchParams(location.search);
const hitScale = params.has('hitstop') ? Number(params.get('hitstop')) : hitStop.scale;
const brainRow = behaviours.brains.find((b) => b.id === (params.get('brain') || 'easy'));
const aiOff = params.get('ai') === 'off';   // off switch: the opponent stands still
fetch('./build.txt?v=' + Date.now(), { cache: 'no-store' }).then((r) => (r.ok ? r.text() : '')).then((t) => { document.getElementById('build').textContent = t.slice(0, 7); }).catch(() => {});

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
lockPageZoom();
// the stylesheet owns the canvas box (fixed, full screen); the renderer only sizes its drawing buffer to the layout viewport
renderer.setSize(viewW(), viewH(), false);
document.body.prepend(renderer.domElement);
const scene = createStage(renderer, stage);
const camera = new THREE.PerspectiveCamera(camDef.fov, viewW() / viewH(), camDef.near, camDef.far);
addEventListener('resize', () => {
  renderer.setSize(viewW(), viewH(), false);
  camera.aspect = viewW() / viewH();
  camera.updateProjectionMatrix();
});

const data = { rules, moves, specials, blades };
let seed = Number(params.get('seed')) || 1;
let sim, brain;
function newBout() {
  sim = createSim(data, seed);
  brain = createBrain(brainRow, seed * 7919 + 1);
  document.getElementById('msg').textContent = '';
  seed++;
}
newBout();

const views = [createFighterView(scene, 0xb08a5a), createFighterView(scene, 0x7a5aa0)];
const fx = createFx(scene, feelDef);
const sound = createSound(soundDef, specials);
const blood = createBlood(scene, bloodDef);
const input = createInput(controls);
// the fight starts once both bodies are in, or after bodyWaitMs on capsules
let loaded = 0;
const started = performance.now();
for (const [i, slot] of [[0, 'player'], [1, 'opponent']]) {
  loadBody(clips, slot, params.get('body') || clips.bodySet)
    .then(async (body) => {
      const [fitted, sword] = await Promise.all([loadClips(clips, body), loadSword(clips).catch((e) => (console.warn('sword', e), null))]);
      attachBody(views[i], body, fitted, clips, sword);
    })
    .catch((e) => console.warn('body', slot, e))
    .finally(() => loaded++);
}
const fightReady = () => loaded === 2 || performance.now() - started > clips.bodyWaitMs;

// hit-stop: presentation only. The sim pauses stepping; the scale row is 0 by default
const stopMs = (events) => {
  let ms = 0;
  for (const e of events) {
    const row = (e.heavy && hitStop.heavy.find((r) => r.id === e.t)) || hitStop.stop.find((r) => r.id === e.t);
    if (row) ms = Math.max(ms, row.ms);
  }
  return ms * hitScale;
};

// V1's live fight camera (data/camera.json): behind the player's heading, over the right shoulder, the gaze
// between "ahead of the player" and the fighters' midpoint, pulled back as the gap opens
const cam = { yaw: 0, pos: new THREE.Vector3(), look: new THREE.Vector3(), fit: 0, init: false };
function updateCamera(dt) {
  const [p, q] = sim.state.fighters;
  const c = viewW() < viewH() ? camDef.portrait : camDef.landscape;
  const gap = Math.hypot(q.x - p.x, q.z - p.z);
  const fitGoal = c.perSep * gap + c.perSize * Math.max(0, camDef.fighterSize - c.sizeFrom);
  cam.fit = cam.init ? cam.fit + Math.max(-c.fitRate * dt, Math.min(c.fitRate * dt, fitGoal - cam.fit)) : fitGoal;
  const raw = (c.back + cam.fit) * c.zoom, back = Math.min(c.maxBack, Math.max(c.minBack, raw));
  const up = (c.up + cam.fit * 0.5) * c.zoom + Math.max(0, raw - back) * 0.5;   // what the cap takes off the distance goes into height
  // V1 places the eye at hero - forward*back + (cos h, -sin h)*side (follow-camera.ts:80); with V2's heading that is the player's
  // left, which puts the player right of centre and the foe clear on the left, as in V1's frame
  const h = p.heading - camDef.orbit;
  const fx = Math.sin(h), fz = Math.cos(h), sx = fz, sz = -fx;
  const eye = new THREE.Vector3(p.x - fx * back + sx * c.side, up, p.z - fz * back + sz * c.side);
  const ax = p.x + fx * c.ahead, az = p.z + fz * c.ahead;
  const lookAt = new THREE.Vector3(ax + ((p.x + q.x) / 2 - ax) * c.mid, c.lookY, az + ((p.z + q.z) / 2 - az) * c.mid);
  // the kill: V1's plain dolly over the fallen (push in, slide, turn), looking at the body; nothing is written over it until it settles
  if (cam.kill) {
    const K = camDef.kill, f = sim.state.fighters[cam.kill.victim];
    cam.kill.t += dt;
    const e = Math.min(1, cam.kill.t / K.over), s = e * e * (3 - 2 * e);
    const v = new THREE.Vector3(f.x, 0, f.z), off = eye.clone().sub(v);
    off.applyAxisAngle(new THREE.Vector3(0, 1, 0), K.turn * s);
    const flat = new THREE.Vector3(off.x, 0, off.z), right = new THREE.Vector3(-flat.z, 0, flat.x).normalize();
    eye.copy(v).add(off.multiplyScalar(1 - K.push * s)).addScaledVector(right, K.slide * s);
    lookAt.lerp(new THREE.Vector3(f.x, K.lookY, f.z), s);
  }
  if (cam.init) cam.pos.lerp(eye, 1 - Math.exp(-camDef.follow * dt)); else cam.pos.copy(eye);
  cam.look.copy(lookAt);
  cam.init = true;
  camera.position.copy(cam.pos);
  camera.lookAt(cam.look);
  const d = cam.look.clone().sub(cam.pos);
  cam.yaw = Math.atan2(-d.x, -d.z);   // the stick is camera-relative: up on the stick = into the screen
  // the picture is lifted off the thumb buttons by shiftY of the screen height
  if (c.shiftY > 0) camera.setViewOffset(viewW(), viewH(), 0, Math.round(c.shiftY * viewH()), viewW(), viewH());
  else camera.clearViewOffset();
}

const bar = (id, v) => { document.getElementById(id).style.width = Math.max(0, Math.min(100, v)) + '%'; };
const STEP = 1000 / rules.tickHz;
let acc = 0, last = performance.now(), frozenUntil = 0;
function frame(t) {
  const dt = Math.min(0.1, (t - last) / 1000);
  last = t;
  const frozen = t < frozenUntil || !fightReady();
  if (!frozen) {
    acc += dt * 1000;
    while (acc >= STEP) {
      acc -= STEP;
      const me = sim.state.fighters[0], foe = sim.state.fighters[1];
      // the stick is relative to the foe, as in V1 (the lock-on keeps the hero's heading on the foe): up = at him, sideways = round him
      const yaw = Math.atan2(me.x - foe.x, me.z - foe.z);
      const events = sim.step([input.sample(yaw, me), aiOff ? {} : think(brain, sim, 1)]);
      fx.onEvents(events, sim);
      for (const e of events) if (e.t === 'Blocked' || e.t === 'Parried') reactTo(views[e.d], e.t === 'Blocked' ? 'blocked' : 'parried');
      blood.onEvents(events, sim);
      sound.onTick(events, sim);
      const killed = events.find((e) => e.t === 'Killed');
      if (killed) cam.kill = { victim: killed.f, t: 0 };
      const ms = stopMs(events);
      if (ms > 0) { frozenUntil = t + ms; acc = 0; break; }
      if (sim.state.over && cam.kill && cam.kill.t >= camDef.kill.nextBout) { newBout(); blood.clear(); cam.kill = null; }
    }
  }
  // the result card, once the kill camera has settled (V1: nothing over the body before that)
  const msg = document.getElementById('msg');
  if (sim.state.over && cam.kill && cam.kill.t >= camDef.kill.settle) {
    const [me, foe] = sim.state.fighters, won = foe.hp <= 0 && me.hp > 0;
    const next = Math.max(0, Math.ceil(camDef.kill.nextBout - cam.kill.t));
    msg.innerHTML = `<div>${won ? 'Victory' : me.hp <= 0 && foe.hp <= 0 ? 'Draw' : 'Defeat'}</div>`
      + `<small>dealt ${rules.health - foe.hp} · took ${rules.health - me.hp}<br>next bout in ${next}</small>`;
  }
  const feel = fx.update(dt, sim);
  blood.update(dt);
  sim.state.fighters.forEach((f, i) => {
    drawFighter(views[i], f, sim, clips, dt, frozen, anim);
    fx.applyPose(views[i], i, f);
    fx.trail(views[i], f, sim);
    bar('hp' + i, (f.hp / rules.health) * 100);
    bar('st' + i, (f.st / rules.stamina.max) * 100);
    bar('po' + i, (f.posture / rules.posture.max) * 100);
  });
  specials.slots.forEach((s, i) => {
    const me = sim.state.fighters[0];
    document.getElementById('pad-' + s.press)?.classList.toggle('cool', me.specialCd[i] > 0 || me.special > 0 || me.specialRecover > 0);
  });
  updateCamera(dt);
  camera.position.add(feel.offset);
  camera.rotateZ(feel.roll);
  renderer.toneMappingExposure = stage.light.exposure * (1 - fx.exposureDip);
  document.getElementById('hp0').parentElement.classList.toggle('flash', fx.hurtFlash);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
