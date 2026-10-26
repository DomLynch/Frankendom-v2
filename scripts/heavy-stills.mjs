// usage: node heavy-stills.mjs <repoDir> <outPrefix> [query]  -- the directional heavies at the fight camera, foe frozen:
// G + D = heavy right cut, G + A = heavy left cut, G + W = heavy stab; a still while it charges (held) and one after release
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire('/Users/domininclynch/Developer/frankendom-deploy/');
const { chromium } = require('playwright');
const [repo, out, query = ''] = process.argv.slice(2);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.ogg': 'audio/ogg', '.png': 'image/png', '.webp': 'image/webp' };
const srv = http.createServer((q, r) => {
  let p = path.join(repo, decodeURIComponent(q.url.split('?')[0]));
  if (p.endsWith('/')) p += 'index.html';
  fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d); } });
}).listen(0);
const port = srv.address().port;
const exe = process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const b = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const pg = await b.newPage({ viewport: { width: 375, height: 667 }, deviceScaleFactor: 2 });
await pg.route(/opentrident\.org/, async (route) => {
  try { const res = await route.fetch(); await route.fulfill({ response: res, headers: { ...res.headers(), 'access-control-allow-origin': '*' } }); } catch { /* closing */ }
});
await pg.goto(`http://localhost:${port}/?ai=off&seed=3&${query}`);
await pg.waitForTimeout(14000);
for (const [name, dir] of [['right', 'KeyD'], ['left', 'KeyA'], ['stab', 'KeyW']]) {
  await pg.keyboard.down(dir); await pg.keyboard.down('KeyG');
  await pg.waitForTimeout(450); await pg.screenshot({ path: `${out}-${name}-charge.png` });
  await pg.keyboard.up('KeyG'); await pg.keyboard.up(dir);
  await pg.waitForTimeout(450); await pg.screenshot({ path: `${out}-${name}-strike.png` });
  await pg.waitForTimeout(2600);
}
await b.close(); srv.close();
