// usage: node measure.mjs <repoDir> <clipFile> [<clipFile>...]  e.g. mixamo/clips/122340901-great-sword-slash.glb
// Loads the game's player body, fits each clip as the game does, and prints where the right hand is fastest (relative to the hips):
// start = first frame over 25 % of the peak speed, hit = the peak frame (data/clips.json's start / hit), plus the hips height series.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire('/Users/domininclynch/Developer/frankendom-deploy/');
const { chromium } = require('playwright');
const [repo, ...files] = process.argv.slice(2);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
const srv = http.createServer((q, r) => {
  let p = path.join(repo, decodeURIComponent(q.url.split('?')[0]));
  if (p.endsWith('/')) p += 'index.html';
  fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d); } });
}).listen(0);
const port = srv.address().port;
const exe = process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const b = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await b.newPage({ viewport: { width: 375, height: 667 } });
await pg.route(/opentrident\.org/, async (route) => {
  try { const res = await route.fetch(); await route.fulfill({ response: res, headers: { ...res.headers(), 'access-control-allow-origin': '*' } }); } catch { /* closing */ }
});
await pg.goto(`http://localhost:${port}/?ai=off`);
await pg.waitForTimeout(3000);
for (const file of files) {
  const res = await pg.evaluate(async (file) => {
    const THREE = await import('three');
    const A = await import('/src/client/assets.js');
    const def = await (await fetch('/data/clips.json')).json();
    const body = await A.loadBody(def, 'player');
    const clips = await A.loadClips({ ...def, roles: { X: { file } } }, body);
    const clip = clips.X;
    const mixer = new THREE.AnimationMixer(body), act = mixer.clipAction(clip); act.play();
    const hand = body.getObjectByName('mixamorigRightHand'), hips = body.getObjectByName('mixamorigHips'), foot = body.getObjectByName('mixamorigRightFoot');
    const N = 80, dur = clip.duration, rel = (o) => { const p = new THREE.Vector3(); o.getWorldPosition(p); const h = new THREE.Vector3(); hips.getWorldPosition(h); return p.sub(h); };
    const hs = [], ys = [], fs = [];
    for (let i = 0; i <= N; i++) { mixer.setTime((i / N) * dur); body.updateMatrixWorld(true); hs.push(rel(hand)); fs.push(rel(foot)); const h = new THREE.Vector3(); hips.getWorldPosition(h); ys.push(h.y); }
    const sp = (arr) => arr.slice(1).map((v, i) => v.distanceTo(arr[i]) / (dur / N));
    const sh = sp(hs), sf = sp(fs);
    const pk = (s) => { let m = 0; s.forEach((v, i) => { if (v > s[m]) m = i; }); return m; };
    const first = (s) => s.findIndex((v) => v > 0.25 * Math.max(...s));
    const ph = pk(sh), pf = pk(sf);
    return { file, dur, hand: { start: +(first(sh) / N).toFixed(3), hit: +((ph + 0.5) / N).toFixed(3), peak: +sh[ph].toFixed(2) }, foot: { start: +(first(sf) / N).toFixed(3), hit: +((pf + 0.5) / N).toFixed(3), peak: +sf[pf].toFixed(2) }, handX: hs.filter((_, i) => i % 8 === 0).map((v) => +v.x.toFixed(2)), hipsY: ys.filter((_, i) => i % 4 === 0).map((v) => +v.toFixed(2)) };
  }, file);
  console.log(JSON.stringify(res));
}
await b.close(); srv.close();
