// Bodies and clips from the OpenTrident library (data/clips.json), read at runtime.
// Clips are retargeted onto a body by bone name. The Hips rotation is converted
// between the clip's armature frame and the body's. Hips travel in X/Z is dropped,
// because the sim owns position. Hips height is scaled to the body.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const HIPS = 'mixamorigHips';
const LIB_HIPS_Y = 1.0427;   // hips height of the library's source skeleton (clips/index.json hips_y)
const XBOT_HIPS_REST = new THREE.Quaternion(-0.70252526, 0, 0, 0.7116589);
const NECK_LIMITS = { mixamorigHead: 25, mixamorigNeck: 20 };   // degrees off the parent; the library's clips throw the head back

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const cache = new Map();
const once = (url) => {
  if (!cache.has(url)) cache.set(url, loader.loadAsync(url));
  return cache.get(url);
};

export async function loadBody(def, slot, set = def.bodySet) {
  // the one-mold rule: only 106-joint bodies; anything else (or an unknown name) falls back to the default set
  const pick = def.bodySets[set]?.rig === 106 ? def.bodySets[set] : def.bodySets[def.bodySet];
  if (pick !== def.bodySets[set]) console.warn(`body set "${set}" is not on the 106-joint rig; using "${def.bodySet}"`);
  const g = await once(def.base + pick[slot]);
  const root = cloneSkinned(g.scene);
  const hide = new RegExp(def.hideMeshes);
  root.traverse((o) => {
    if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; o.visible = !hide.test(o.name); }
  });
  root.updateMatrixWorld(true);
  return root;
}

// the library sword (data/clips.json sword): a group whose origin is the hand, +Y toward the tip
export async function loadSword(def) {
  const g = await once(def.sword.file.startsWith('./') ? def.sword.file : def.base + def.sword.file);
  const model = g.scene.clone(true);
  model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
  const box = new THREE.Box3().setFromObject(model);
  model.position.y = -(box.min.y + def.sword.grip);
  const group = new THREE.Group();
  group.add(model);
  return group;
}

async function loadClipSource(url) {
  const g = await once(url);
  let arm = null, hips = null;
  g.scene.traverse((o) => {
    if (o.name === 'Armature' && !arm) arm = o;
    if (o.name === HIPS) hips = o;
  });
  return {
    clip: g.animations[0],
    armQ: arm ? arm.quaternion.clone() : new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2),
    hipsRestQ: hips ? hips.quaternion.clone() : XBOT_HIPS_REST.clone(),
  };
}

function fitClip(src, root, name) {
  root.updateMatrixWorld(true);
  const hips = root.getObjectByName(HIPS);
  const parentQ = hips.parent.getWorldQuaternion(new THREE.Quaternion());
  const ps = hips.parent.getWorldScale(new THREE.Vector3()).y || 1;
  const rest = hips.position.clone().multiplyScalar(ps).applyQuaternion(parentQ);
  const T = parentQ.clone().invert().multiply(src.armQ), Ti = T.clone().invert();
  const restInv = src.hipsRestQ.clone().invert(), parentInv = parentQ.clone().invert();
  const ratio = Math.min(3, Math.max(0.33, rest.y / LIB_HIPS_Y));
  const have = new Set();
  root.traverse((o) => o.name && have.add(o.name));

  const tracks = [];
  for (const t of src.clip.tracks) {
    const dot = t.name.lastIndexOf('.');
    const node = t.name.slice(0, dot), prop = t.name.slice(dot + 1);
    if (!have.has(node)) continue;
    if (node === HIPS && prop === 'quaternion') {
      const v = new Float32Array(t.values.length), q = new THREE.Quaternion();
      for (let i = 0; i < v.length; i += 4) {
        q.fromArray(t.values, i).premultiply(T).multiply(restInv).multiply(Ti).multiply(hips.quaternion).normalize().toArray(v, i);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(t.name, t.times, v));
    } else if (node === HIPS && prop === 'position') {
      const v = new Float32Array(t.values.length), p = new THREE.Vector3();
      for (let i = 0; i < v.length; i += 3) {
        p.fromArray(t.values, i).applyQuaternion(src.armQ);
        p.set(rest.x, p.y * ratio, rest.z).applyQuaternion(parentInv).multiplyScalar(1 / ps).toArray(v, i);
      }
      tracks.push(new THREE.VectorKeyframeTrack(t.name, t.times, v));
    } else if (prop === 'position' || prop === 'scale') {
      continue;
    } else if (prop === 'quaternion' && NECK_LIMITS[node]) {
      const lim = NECK_LIMITS[node] * Math.PI / 180, v = new Float32Array(t.values.length);
      const q = new THREE.Quaternion(), id = new THREE.Quaternion();
      for (let i = 0; i < v.length; i += 4) {
        q.fromArray(t.values, i);
        if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
        const ang = 2 * Math.acos(Math.min(1, q.w));
        if (ang > lim) q.copy(id).slerp(q, lim / ang);
        q.normalize().toArray(v, i);
      }
      tracks.push(new THREE.QuaternionKeyframeTrack(t.name, t.times, v));
    } else {
      tracks.push(t.clone());
    }
  }
  return new THREE.AnimationClip(name, src.clip.duration, tracks);
}

// role name -> AnimationClip fitted to this body; a role that fails to load is left out
// the same motion on the other side of the body: left and right bones swap, and a rotation turns about the body's up axis
// (x, -y, -z, w), the hips' sideways travel flips. A role with `mirror: true` plays its file mirrored (one slash serves both cuts).
function mirrorClip(clip) {
  const swap = (n) => n.replace(/^mixamorig(Left|Right)/, (m, s) => 'mixamorig' + (s === 'Left' ? 'Right' : 'Left'));
  const tracks = clip.tracks.map((t) => {
    const dot = t.name.lastIndexOf('.'), node = swap(t.name.slice(0, dot)), prop = t.name.slice(dot + 1), v = t.values.slice();
    if (prop === 'quaternion') for (let i = 0; i < v.length; i += 4) { v[i + 1] = -v[i + 1]; v[i + 2] = -v[i + 2]; }
    else if (prop === 'position') for (let i = 0; i < v.length; i += 3) v[i] = -v[i];
    return new t.constructor(node + '.' + prop, t.times, v);
  });
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

export async function loadClips(def, root) {
  const out = {};
  await Promise.all(Object.entries(def.roles).map(async ([role, row]) => {
    try {
      const fitted = fitClip(await loadClipSource(def.base + row.file), root, role);
      out[role] = row.mirror ? mirrorClip(fitted) : fitted;
    } catch (e) {
      console.warn('clip', role, e);
    }
  }));
  return out;
}
