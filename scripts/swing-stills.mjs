// usage: node swing.mjs <repoDir> <outPrefix> [query]  -- idle, two light cuts (right then left), a stab, a roll: stills at the strike moments
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
const errs = [];
pg.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && !/GL Driver/.test(m.text()))) errs.push(m.text().slice(0, 200)); });
pg.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
await pg.route(/opentrident\.org/, async (route) => {
  try { const res = await route.fetch(); await route.fulfill({ response: res, headers: { ...res.headers(), 'access-control-allow-origin': '*' } }); } catch { /* closing */ }
});
await pg.goto(`http://localhost:${port}/?ai=off&seed=3&${query}`);
await pg.waitForTimeout(14000);
const shot = (n) => pg.screenshot({ path: `${out}-${n}.png` });
await shot('idle');
await pg.keyboard.press('KeyF'); await pg.waitForTimeout(230); await shot('cutR-a'); await pg.waitForTimeout(110); await shot('cutR-b');
await pg.waitForTimeout(1600);
await pg.keyboard.press('KeyF'); await pg.waitForTimeout(230); await shot('cutL-a'); await pg.waitForTimeout(110); await shot('cutL-b');
await pg.waitForTimeout(1600);
await pg.keyboard.press('KeyT'); await pg.waitForTimeout(200); await shot('stab-a'); await pg.waitForTimeout(150); await shot('stab-b');
await pg.waitForTimeout(1800);
await pg.keyboard.down('KeyS'); await pg.keyboard.press('KeyE'); await pg.waitForTimeout(150); await shot('roll-a'); await pg.waitForTimeout(200); await shot('roll-b'); await pg.waitForTimeout(200); await shot('roll-c');
await pg.keyboard.up('KeyS');
console.log('errors:', JSON.stringify(errs.filter((e) => !/404/.test(e))));
await b.close(); srv.close();
