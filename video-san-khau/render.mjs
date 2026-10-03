// Xuất video: node render.mjs            -> video-le-thanh-hon-1080p.mp4
// Chụp thử vài khung: node render.mjs --stills 3,14,40 [--out thu-muc]
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import { once } from 'events';
import os from 'os';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const WORKERS = +opt('workers', Math.max(1, os.cpus().length));
const OUT = path.resolve(opt('out', path.join(ROOT, 'video-le-thanh-hon-1080p.mp4')));

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2', '.mp3': 'audio/mpeg' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, r));
const URL_ = `http://127.0.0.1:${server.address().port}/index.html`;

async function openPage() {
  const browser = await chromium.launch({ args: ['--disable-gpu-vsync', '--force-color-profile=srgb'] });
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  page.on('pageerror', e => console.error('page error:', e.message));
  await page.goto(URL_);
  await page.waitForFunction(() => window.READY === true, null, { timeout: 120000 });
  return { browser, page };
}
const dataToBuf = d => Buffer.from(d.slice(d.indexOf(',') + 1), 'base64');

if (opt('stills')) {
  const dir = path.resolve(opt('out', path.join(ROOT, 'stills')));
  fs.mkdirSync(dir, { recursive: true });
  const { browser, page } = await openPage();
  for (const t of opt('stills').split(',').map(Number)) {
    const t0 = Date.now();
    const d = await page.evaluate(f => window.renderFrame(f, 0.9), Math.round(t * 30));
    fs.writeFileSync(path.join(dir, `t${String(t).padStart(6, '0')}.jpg`), dataToBuf(d));
    console.log(`t=${t}s  ${Date.now() - t0}ms`);
  }
  await browser.close(); server.close(); process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vlth-'));
const probe = await openPage();
const TOTAL = +opt('frames', await probe.page.evaluate(() => window.TOTAL_FRAMES));
const FPS = await probe.page.evaluate(() => window.FPS);
const END = TOTAL / FPS;
await probe.browser.close();
console.log(`${TOTAL} khung hình, ${END.toFixed(1)}s, ${WORKERS} luồng`);

const per = Math.ceil(TOTAL / WORKERS);
let done = 0; const t0 = Date.now();
async function worker(w) {
  const a = w * per, b = Math.min(TOTAL, a + per);
  if (a >= b) return null;
  const seg = path.join(tmp, `seg${w}.mp4`);
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '10', '-pix_fmt', 'yuv420p', seg], { stdio: ['pipe', 'inherit', 'inherit'] });
  const { browser, page } = await openPage();
  for (let f = a; f < b; f++) {
    const d = await page.evaluate(i => window.renderFrame(i), f);
    if (!ff.stdin.write(dataToBuf(d))) await once(ff.stdin, 'drain');
    if (++done % 150 === 0) {
      const el = (Date.now() - t0) / 1000;
      console.log(`  ${done}/${TOTAL}  (${el.toFixed(0)}s, còn ~${(el / done * (TOTAL - done)).toFixed(0)}s)`);
    }
  }
  ff.stdin.end(); await once(ff, 'close'); await browser.close();
  return seg;
}
const segs = (await Promise.all([...Array(WORKERS).keys()].map(worker))).filter(Boolean);
server.close();

fs.writeFileSync(path.join(tmp, 'list.txt'), segs.map(s => `file '${s}'`).join('\n'));
console.log('Ghép hình + nhạc…');
const r = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'list.txt'),
  '-i', path.join(ROOT, 'nhac.mp3'), '-map', '0:v', '-map', '1:a',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', opt('crf', '19'), '-tune', 'film', '-pix_fmt', 'yuv420p',
  '-profile:v', 'high', '-level', '4.1', '-r', String(FPS),
  '-af', `afade=t=out:st=${(END - 3).toFixed(2)}:d=3`, '-c:a', 'aac', '-b:a', '256k',
  '-t', END.toFixed(3), '-movflags', '+faststart', OUT], { stdio: 'inherit' });
fs.rmSync(tmp, { recursive: true, force: true });
if (r.status) process.exit(r.status);
console.log('Xong:', OUT, `(${((Date.now() - t0) / 60000).toFixed(1)} phút)`);
