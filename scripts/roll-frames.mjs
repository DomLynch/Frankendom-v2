// usage: node roll-frames.mjs <repoDir> <outDir> [query]  -- films a roll (S + E, foe frozen) at 375 wide through the DevTools screencast and
// writes <outDir>/frame-NNN.jpg (the character crop, with its time since the press in times.txt) plus <outDir>/sheet.png (ffmpeg tile)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire('/Users/domininclynch/Developer/frankendom-deploy/');
const { chromium } = require('playwright');
const [repo, out, query = '', keys = 'KeyS+KeyE'] = process.argv.slice(2);   // keys: the held keys, then the pressed one: KeyS+KeyE = a roll, KeyD+KeyF... or just KeyF = a light cut
fs.mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.ogg': 'audio/ogg', '.png': 'image/png', '.webp': 'image/webp' };
const srv = http.createServer((q, r) => {
  let p = path.join(repo, decodeURIComponent(q.url.split('?')[0]));
  if (p.endsWith('/')) p += 'index.html';
  fs.readFile(p, (e, d) => { if (e) { r.writeHead(404); r.end(); } else { r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); r.end(d); } });
}).listen(0);
const port = srv.address().port;
const exe = process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const b = await chromium.launch({ executablePath: fs.existsSync(exe) ? exe : undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const ctx = await b.newContext({ viewport: { width: 375, height: 667 } });
const pg = await ctx.newPage();
await pg.route(/opentrident\.org/, async (route) => {
  try { const res = await route.fetch(); await route.fulfill({ response: res, headers: { ...res.headers(), 'access-control-allow-origin': '*' } }); } catch { /* closing */ }
});
await pg.goto(`http://localhost:${port}/?ai=off&seed=3&${query}`);
await pg.waitForTimeout(14000);
const cdp = await ctx.newCDPSession(pg);
const frames = [];
cdp.on('Page.screencastFrame', async (f) => {
  frames.push({ t: f.metadata.timestamp, data: f.data });
  await cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
});
await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, everyNthFrame: 1 });
await pg.waitForTimeout(300);
const press = Date.now() / 1000;
const seq = keys.split('+'), pressed = seq.pop();
for (const k of seq) await pg.keyboard.down(k);
await pg.keyboard.press(pressed);
for (const k of seq) await pg.keyboard.up(k);
await pg.waitForTimeout(3000);
await cdp.send('Page.stopScreencast');
await ctx.close(); await b.close(); srv.close();
const kept = frames.filter((f) => f.t >= press - 0.1);
const times = [];
kept.forEach((f, i) => {
  fs.writeFileSync(path.join(out, `frame-${String(i).padStart(3, '0')}.jpg`), Buffer.from(f.data, 'base64'));
  times.push(`${i} ${(f.t - press).toFixed(2)}s`);
});
fs.writeFileSync(path.join(out, 'times.txt'), times.join('\n') + '\n');
// every Nth frame so the sheet holds about 24
const step = Math.max(1, Math.floor(kept.length / 24));
execFileSync('ffmpeg', ['-y', '-v', 'error', '-framerate', '1', '-i', path.join(out, 'frame-%03d.jpg'), '-vf', `select='not(mod(n\\,${step}))',crop=250:330:60:150,tile=8x3`, '-frames:v', '1', '-vsync', '0', path.join(out, 'sheet.png')]);
console.log(kept.length, 'frames, sheet every', step);
