// The OpenTrident viewer scene as the fight stage: grid floor, plain blue sky,
// height ruler, one sun. Every value comes from data/stage.json.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export function createStage(renderer, def) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(def.sky);
  scene.fog = new THREE.Fog(def.sky, def.fog.near, def.fog.far);

  const l = def.light;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = l.exposure;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = l.environment;
  scene.add(new THREE.HemisphereLight(l.hemi.sky, l.hemi.ground, l.hemi.intensity));

  const sun = new THREE.DirectionalLight(l.sun.color, l.sun.intensity);
  sun.position.set(...l.sun.position);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  const h = l.sun.shadowHalf;
  Object.assign(sun.shadow.camera, { left: -h, right: h, top: h, bottom: -h, near: 0.5, far: 20 });
  scene.add(sun);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(def.ground.size, def.ground.size),
    new THREE.MeshStandardMaterial({ color: def.ground.color, roughness: 1 }),
  );
  ground.receiveShadow = true;
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const g = def.grid;
  scene.add(new THREE.GridHelper(g.size, g.divisions, g.center, g.lines));

  const r = def.ruler;
  const ruler = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: r.color });
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.02, r.height, 0.02), mat);
  post.position.y = r.height / 2;
  ruler.add(post);
  const ticks = Math.round(r.height / r.tick);
  for (let i = 0; i <= ticks; i++) {
    const major = i % 5 === 0;
    const t = new THREE.Mesh(new THREE.BoxGeometry(major ? 0.2 : 0.1, 0.01, 0.01), mat);
    t.position.set(major ? 0.1 : 0.05, i * r.tick, 0);
    ruler.add(t);
  }
  ruler.position.x = r.x;
  ruler.visible = r.show !== false;   // the viewer's height ruler; hidden in a fight (Lead's playtest)
  scene.add(ruler);

  return scene;
}
