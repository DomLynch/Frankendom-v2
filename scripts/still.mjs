// usage: node still.mjs <repoDir> <outPrefix> [query] [seconds...]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire('/Users/domininclynch/Developer/frankendom-deploy/');
const { chromium } = require('playwright');
const [repo, out, query = '', ...secs] = process.argv.slice(2);
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
pg.on('console', (m) => { if (['warning', 'error'].includes(m.type())) console.log('console', m.type(), m.text().slice(0, 200)); });
await pg.route(/opentrident\.org/, async (route) => {
  const res = await route.fetch();
  await route.fulfill({ response: res, headers: { ...res.headers(), 'access-control-allow-origin': '*' } });
});
if (process.env.HEALTH) await pg.route(/data\/rules\.json/, async (route) => {
  const res = await route.fetch(), j = await res.json(); j.health = Number(process.env.HEALTH);
  await route.fulfill({ response: res, body: JSON.stringify(j), headers: { ...res.headers(), 'content-type': 'application/json' } });
});
await pg.goto(`http://localhost:${port}/${query ? '?' + query : ''}`);
let t0 = 0;
for (const s of secs.length ? secs : ['8']) {
  await pg.waitForTimeout((Number(s) - t0) * 1000); t0 = Number(s);
  await pg.screenshot({ path: `${out}-${s}.png` });
}
await b.close(); srv.close();
