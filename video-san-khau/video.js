'use strict';
/*
 * Video trình chiếu Lễ Thành Hôn — Việt Anh & Lan Vi
 * Mỗi khung hình được vẽ theo thời gian t (giây) nên kết quả hoàn toàn xác định:
 * render.mjs gọi window.renderFrame(f) cho từng khung rồi ghép bằng ffmpeg.
 * Mở index.html?play qua một web server để xem thử trực tiếp kèm nhạc.
 */

const W = 1920, H = 1080, FPS = 30;
// Nhịp bài nhạc: ~95 BPM, phách đầu tiên ở 0.365s, mỗi ô nhịp 4 phách.
const BEAT = 0.6312, T0 = 0.365, BAR = BEAT * 4;
const bar = n => T0 + n * BAR;
const END = bar(70) + 31;

// ---------------------------------------------------------------- tiện ích
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => (t <= 0 ? 0 : t >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * t));
const easeOut = t => 1 - Math.pow(1 - clamp(t), 3);
const easeIn = t => Math.pow(clamp(t), 2);
const smooth = (a, b, x) => ease((x - a) / (b - a));
const fadeWin = (t, a, b, c, d) => smooth(a, b, t) * (1 - smooth(c, d, t));
// chuyển động máy quay: pha trộn tuyến tính + sine cho cảm giác trôi đều, không giật đầu/cuối
const cam = u => 0.45 * u + 0.55 * ease(u);

function mk(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.ctx = c.getContext('2d');
  c.ctx.imageSmoothingQuality = 'high';
  return c;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- ảnh (fx, fy = vị trí gương mặt theo tỉ lệ ảnh)
const PHOTOS = {
  'chu-re': [0.50, 0.25], 'co-dau': [0.47, 0.17], 'them-5': [0.48, 0.30],
  'nguoi-linh-1': [0.50, 0.27], 'nguoi-linh-2': [0.55, 0.28], 'nguoi-linh-3': [0.55, 0.24],
  'trang-2': [0.50, 0.24], 'trang-3': [0.50, 0.33],
  'net-xua': [0.50, 0.33], 'them-3': [0.50, 0.33], 'them-2': [0.60, 0.42], 'them-4': [0.55, 0.32],
  'them-1': [0.55, 0.43],
  'vuon-1': [0.60, 0.52], 'vuon-2': [0.50, 0.53], 'vuon-3': [0.50, 0.53], 'nang-3': [0.55, 0.42],
  'them-6': [0.43, 0.28], 'them-7': [0.65, 0.55], 'them-8': [0.42, 0.31], 'them-9': [0.55, 0.38], 'them-10': [0.48, 0.29],
  'hero': [0.62, 0.33], 'hoang-hon-2': [0.62, 0.45], 'nang-1': [0.50, 0.47], 'nang-2': [0.72, 0.42],
};
const P = {};

// Vẽ ảnh phủ kín khung (rx,ry,rw,rh), lấy (cx,cy) làm tâm, không bao giờ để lộ mép trống.
function drawCover(ctx, ph, rx, ry, rw, rh, cx, cy, zoom = 1) {
  const iw = ph.img.naturalWidth, ih = ph.img.naturalHeight;
  const s = Math.max(rw / iw, rh / ih) * zoom;
  const vw = rw / s, vh = rh / s;
  const sx = clamp(cx * iw, vw / 2, iw - vw / 2), sy = clamp(cy * ih, vh / 2, ih - vh / 2);
  ctx.save();
  ctx.beginPath(); ctx.rect(rx, ry, rw, rh); ctx.clip();
  ctx.setTransform(s, 0, 0, s, rx + rw / 2 - sx * s, ry + rh / 2 - sy * s);
  ctx.drawImage(ph.img, 0, 0);
  ctx.restore();
}

// ---------------------------------------------------------------- chữ
const GOLD = ['#fff3d6', '#ecca8c', '#c99a58', '#f1d9a4'];
function textSprite(txt, o) {
  const size = o.size, font = `${o.style || 'normal'} ${o.weight || 400} ${size}px "${o.family}"`;
  const probe = mk(4, 4).ctx;
  probe.font = font; probe.letterSpacing = (o.spacing || 0) + 'px';
  const tw = Math.ceil(probe.measureText(txt).width);
  const padX = Math.ceil(size * (o.script ? 0.9 : 0.4)), hh = Math.ceil(size * (o.script ? 2.3 : 1.7));
  const c = mk(tw + padX * 2, hh);
  const x = c.ctx;
  x.font = font; x.letterSpacing = (o.spacing || 0) + 'px';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  const cx = c.width / 2 + (o.spacing || 0) / 2, cy = hh / 2;
  let fill = o.color || '#fff';
  if (o.gold) {
    const g = x.createLinearGradient(0, cy - size * 0.55, 0, cy + size * 0.45);
    g.addColorStop(0, GOLD[0]); g.addColorStop(0.45, GOLD[1]); g.addColorStop(0.8, GOLD[2]); g.addColorStop(1, GOLD[3]);
    fill = g;
  }
  if (o.glow) { // quầng sáng vàng nhẹ phía sau chữ
    x.shadowColor = 'rgba(255,205,140,0.55)'; x.shadowBlur = size * 0.35;
    x.fillStyle = fill; x.fillText(txt, cx, cy);
  }
  x.shadowColor = `rgba(0,0,0,${o.shadow ?? 0.55})`; x.shadowBlur = size * 0.18; x.shadowOffsetY = Math.max(1, size * 0.02);
  x.fillStyle = fill; x.fillText(txt, cx, cy);
  return c;
}
const eyebrow = (t, size = 26, sp = 12) => textSprite(t, { family: 'Montserrat', weight: 400, size, spacing: sp, color: '#efd8aa', shadow: 0.6 });
const script = (t, size) => textSprite(t, { family: 'Great Vibes', size, gold: true, glow: true, script: true });
const serif = (t, size = 50, style = 'italic') => textSprite(t, { family: 'Cormorant Garamond', style, weight: 500, size, spacing: 0.5, color: '#fbf4e8', shadow: 0.7 });

// Hiện chữ như đang viết tay: mặt nạ gradient quét từ trái sang phải.
function drawReveal(ctx, spr, cx, cy, prog, alpha = 1, soft = 0.22) {
  if (prog <= 0 || alpha <= 0) return;
  const x0 = cx - spr.width / 2, y0 = cy - spr.height / 2;
  ctx.globalAlpha = alpha;
  if (prog >= 1) { ctx.drawImage(spr, x0, y0); ctx.globalAlpha = 1; return; }
  const m = spr._m || (spr._m = mk(spr.width, spr.height)), x = m.ctx;
  x.globalCompositeOperation = 'copy'; x.drawImage(spr, 0, 0);
  x.globalCompositeOperation = 'destination-in';
  const sw = spr.width * soft, e = -sw + prog * (spr.width + sw);
  const g = x.createLinearGradient(e, 0, e + sw, 0);
  g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, m.width, m.height);
  x.globalCompositeOperation = 'source-over';
  ctx.drawImage(m, x0, y0); ctx.globalAlpha = 1;
}
// Hiện mờ dần kèm trôi nhẹ lên.
function drawFade(ctx, spr, cx, cy, a, rise = 14) {
  if (a <= 0) return;
  ctx.globalAlpha = clamp(a);
  ctx.drawImage(spr, cx - spr.width / 2, cy - spr.height / 2 + (1 - a) * rise);
  ctx.globalAlpha = 1;
}
// Đường chỉ vàng hai bên và hạt kim cương ở giữa.
function ornament(ctx, cx, cy, w, a) {
  if (a <= 0 || w <= 1) return;
  ctx.save(); ctx.globalAlpha = a;
  for (const dir of [-1, 1]) {
    const xa = cx + dir * 22, xb = cx + dir * (22 + w);
    const g = ctx.createLinearGradient(xa, 0, xb, 0);
    g.addColorStop(0, 'rgba(236,202,140,0.95)'); g.addColorStop(1, 'rgba(236,202,140,0)');
    ctx.fillStyle = g; ctx.fillRect(Math.min(xa, xb), cy - 0.75, Math.abs(xb - xa), 1.5);
  }
  ctx.translate(cx, cy); ctx.rotate(Math.PI / 4);
  ctx.fillStyle = '#ecca8c'; ctx.fillRect(-5, -5, 10, 10);
  ctx.restore();
}

// ---------------------------------------------------------------- lớp hiệu ứng dựng sẵn
let BLOOM, LEAK, VIGNETTE, BOTTOM, SPARK, BOKEH, GRAIN = [], INTRO_BG;
function buildFx() {
  BLOOM = mk(W, H);
  let g = BLOOM.ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.75);
  g.addColorStop(0, 'rgba(255,250,240,1)'); g.addColorStop(0.5, 'rgba(255,232,200,0.95)'); g.addColorStop(1, 'rgba(255,210,160,0.8)');
  BLOOM.ctx.fillStyle = g; BLOOM.ctx.fillRect(0, 0, W, H);

  LEAK = mk(800, 800);
  g = LEAK.ctx.createRadialGradient(400, 400, 0, 400, 400, 400);
  g.addColorStop(0, 'rgba(255,214,150,0.95)'); g.addColorStop(0.35, 'rgba(255,150,80,0.55)');
  g.addColorStop(0.7, 'rgba(230,90,60,0.18)'); g.addColorStop(1, 'rgba(200,60,40,0)');
  LEAK.ctx.fillStyle = g; LEAK.ctx.fillRect(0, 0, 800, 800);

  VIGNETTE = mk(W, H);
  g = VIGNETTE.ctx.createRadialGradient(W / 2, H / 2, H * 0.5, W / 2, H / 2, H * 1.15);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.5)');
  VIGNETTE.ctx.fillStyle = g; VIGNETTE.ctx.fillRect(0, 0, W, H);

  BOTTOM = mk(W, 460);
  g = BOTTOM.ctx.createLinearGradient(0, 0, 0, 460);
  g.addColorStop(0, 'rgba(8,5,3,0)'); g.addColorStop(1, 'rgba(8,5,3,0.62)');
  BOTTOM.ctx.fillStyle = g; BOTTOM.ctx.fillRect(0, 0, W, 460);

  SPARK = mk(64, 64);
  g = SPARK.ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,252,240,1)'); g.addColorStop(0.18, 'rgba(255,226,170,0.85)');
  g.addColorStop(0.5, 'rgba(255,200,120,0.18)'); g.addColorStop(1, 'rgba(255,190,110,0)');
  SPARK.ctx.fillStyle = g; SPARK.ctx.fillRect(0, 0, 64, 64);

  BOKEH = mk(128, 128);
  g = BOKEH.ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,225,175,0.55)'); g.addColorStop(0.8, 'rgba(255,215,160,0.7)');
  g.addColorStop(0.92, 'rgba(255,215,160,0.35)'); g.addColorStop(1, 'rgba(255,215,160,0)');
  BOKEH.ctx.fillStyle = g; BOKEH.ctx.fillRect(0, 0, 128, 128);

  const R = mulberry32(11);
  for (let k = 0; k < 4; k++) {
    const c = mk(256, 256), id = c.ctx.createImageData(256, 256);
    for (let i = 0; i < id.data.length; i += 4) {
      const v = 128 + (R() + R() + R() - 1.5) * 70;
      id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255;
    }
    c.ctx.putImageData(id, 0, 0);
    GRAIN.push(c);
  }

  INTRO_BG = mk(W, H);
  INTRO_BG.ctx.fillStyle = '#060403'; INTRO_BG.ctx.fillRect(0, 0, W, H);
  g = INTRO_BG.ctx.createRadialGradient(W / 2, H * 0.48, 0, W / 2, H * 0.48, W * 0.62);
  g.addColorStop(0, 'rgba(78,50,28,0.95)'); g.addColorStop(0.55, 'rgba(36,22,12,0.7)'); g.addColorStop(1, 'rgba(6,4,3,0)');
  INTRO_BG.ctx.fillStyle = g; INTRO_BG.ctx.fillRect(0, 0, W, H);
}

// Bụi vàng & bokeh trôi nhẹ
const DUST = [], BOKEHS = [];
(function () {
  const R = mulberry32(7);
  for (let i = 0; i < 130; i++) DUST.push({ x: R() * W, y: R() * H, vx: 5 + R() * 16, vy: -5 - R() * 14,
    s: 1.4 + Math.pow(R(), 3) * 8, a: 0.25 + R() * 0.65, f: 0.5 + R() * 1.8, ph: R() * 6.283, wob: 8 + R() * 26 });
  for (let i = 0; i < 16; i++) BOKEHS.push({ x: R() * W, y: R() * H, vx: 3 + R() * 7, vy: -2 - R() * 5,
    s: 40 + R() * 120, a: 0.05 + R() * 0.09, f: 0.2 + R() * 0.5, ph: R() * 6.283 });
})();
const wrap = (v, span) => ((v % span) + span) % span;
function drawDust(ctx, t, I) {
  if (I <= 0.01) return;
  ctx.globalCompositeOperation = 'screen';
  for (const b of BOKEHS) {
    const x = wrap(b.x + b.vx * t, W + 300) - 150, y = wrap(b.y + b.vy * t, H + 300) - 150;
    ctx.globalAlpha = I * b.a * (0.6 + 0.4 * Math.sin(t * b.f + b.ph));
    ctx.drawImage(BOKEH, x - b.s / 2, y - b.s / 2, b.s, b.s);
  }
  for (const d of DUST) {
    const x = wrap(d.x + d.vx * t, W + 100) - 50;
    const y = wrap(d.y + d.vy * t + d.wob * Math.sin(t * 0.45 + d.ph), H + 100) - 50;
    ctx.globalAlpha = I * d.a * (0.5 + 0.5 * Math.sin(t * d.f * 2 + d.ph));
    const s = d.s * 4;
    ctx.drawImage(SPARK, x - s / 2, y - s / 2, s, s);
  }
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
}

// Làm mờ rẻ: thu nhỏ 1/4 rồi blur, khi vẽ lại thì phóng to.
const BL = {};
function blurOf(src, px, slot) {
  const b = BL[slot] || (BL[slot] = [mk(480, 270), mk(480, 270)]);
  b[0].ctx.drawImage(src, 0, 0, 480, 270);
  const x = b[1].ctx;
  x.globalCompositeOperation = 'copy';
  x.filter = `blur(${px}px)`; x.drawImage(b[0], 0, 0); x.filter = 'none';
  x.globalCompositeOperation = 'source-over';
  return b[1];
}

// ---------------------------------------------------------------- kịch bản
const SC = [
  { type: 'intro', s: 0, e: 5 },
  { type: 'panels', ps: ['chu-re', 'co-dau'], s: 5, e: 9, tin: ['bloom', 2], chapter: ['CHƯƠNG I', 'Khởi đầu'] },
  { type: 'tilt', p: 'them-5', s: 9, e: 13, tin: ['softWipe', 2], cap: ['Ba năm trước, Việt Anh và Vi tìm thấy nhau'] },
  { type: 'panels', ps: ['nguoi-linh-1', 'nguoi-linh-2', 'nguoi-linh-3'], s: 13, e: 18, tin: ['blurDissolve', 2],
    cap: ['Có những ngày thật đẹp, và cả những ngày không vui'] },
  { type: 'panels', ps: ['trang-2', 'trang-3'], s: 18, e: 22, tin: ['push', 1.5], cap: ['…nhưng chúng mình chưa từng buông tay'] },
  { type: 'tilt', p: 'net-xua', s: 22, e: 26, tin: ['leak', 3], chapter: ['CHƯƠNG II', 'Nét xưa'] },
  { type: 'tilt', p: 'them-3', s: 26, e: 30, tin: ['zoomPush', 1.5], down: true },
  { type: 'tilt', p: 'them-2', s: 30, e: 34, tin: ['softWipe', 2], cap: ['Thuận vợ thuận chồng, tát biển Đông cũng cạn'] },
  { type: 'tilt', p: 'them-4', s: 34, e: 38, tin: ['iris', 2] },
  { type: 'kb', p: 'nang-1', s: 38, e: 42, tin: ['bloom', 2], chapter: ['CHƯƠNG III', 'Hẹn ước'],
    c0: [0.5, 0.52], c1: [0.5, 0.45], z0: 1.0, z1: 1.12 },
  { type: 'panels', ps: ['vuon-2', 'vuon-3'], s: 42, e: 46, tin: ['push', 1.5], cap: ['Cùng nhau học tập, cùng nhau trưởng thành'] },
  { type: 'tilt', p: 'vuon-1', s: 46, e: 49, tin: ['blurDissolve', 2] },
  { type: 'kb', p: 'nang-2', s: 49, e: 52, tin: ['leak', 2], c0: [0.55, 0.5], c1: [0.7, 0.42], z0: 1.04, z1: 1.18,
    cap: ['Yêu nhau tam tứ núi cũng trèo,', 'thất bát sông cũng lội, tam thập lục đèo cũng qua'] },
  { type: 'kb', p: 'hero', s: 52, e: 55, tin: ['softWipe', 2], c0: [0.55, 0.34], c1: [0.66, 0.32], z0: 1.16, z1: 1.28 },
  { type: 'kb', p: 'hoang-hon-2', s: 55, e: 59, tin: ['bloom', 2], chapter: ['CHƯƠNG IV', 'Mãi mãi'],
    c0: [0.5, 0.5], c1: [0.62, 0.47], z0: 1.0, z1: 1.15, cap: ['Để cả hai trở thành phiên bản tốt hơn của chính mình'], capAt: 4.2 },
  { type: 'montage', s: 59, e: 70, tin: ['zoomPush', 1], slots: [
    // [ảnh, số phách, tâm đầu x,y, zoom đầu, tâm cuối x,y, zoom cuối]  (zoom 1 = phủ kín khung)
    ['them-6', 2, 0.43, 0.38, 1.00, 0.43, 0.36, 1.06],
    ['them-6', 2, 0.43, 0.29, 1.45, 0.43, 0.28, 1.58],
    ['them-6', 2, 0.50, 0.50, 1.12, 0.50, 0.46, 1.22],
    ['them-6', 2, 0.55, 0.28, 1.50, 0.52, 0.28, 1.62],
    ['them-9', 2, 0.55, 0.38, 1.00, 0.55, 0.35, 1.07],
    ['them-9', 2, 0.72, 0.27, 1.50, 0.70, 0.27, 1.62],
    ['them-9', 2, 0.47, 0.38, 1.40, 0.50, 0.38, 1.52],
    ['them-9', 2, 0.58, 0.52, 1.12, 0.58, 0.48, 1.22],
    ['them-10', 2, 0.48, 0.37, 1.00, 0.48, 0.34, 1.06],
    ['them-10', 2, 0.48, 0.29, 1.42, 0.48, 0.29, 1.55],
    ['them-10', 4, 0.50, 0.46, 1.15, 0.50, 0.50, 1.28],
    ['them-8', 2, 0.42, 0.31, 1.50, 0.42, 0.31, 1.62],
    ['them-8', 2, 0.46, 0.46, 1.10, 0.46, 0.50, 1.20],
    ['them-8', 4, 0.50, 0.66, 1.00, 0.50, 0.60, 1.10],
    ['them-7', 4, 0.50, 0.50, 1.00, 0.60, 0.52, 1.12],
    ['them-7', 4, 0.64, 0.53, 1.55, 0.66, 0.52, 1.75],
    ['them-7', 4, 0.62, 0.52, 1.20, 0.50, 0.50, 1.00]] },
  { type: 'finale', p: 'them-1', s: 70, e: null, tin: ['bloom', 3] },
];
for (const s of SC) {
  s.t0 = bar(s.s); s.t1 = s.e == null ? END : bar(s.e);
  if (s.s === 0) s.t0 = 0;
  s.half = s.tin ? (s.tin[1] * BEAT) / 2 : 0;
}

let SPR = {};
function buildText() {
  SPR.introEye = eyebrow('LỄ THÀNH HÔN', 28, 16);
  SPR.names = script('Việt Anh & Lan Vi', 176);
  SPR.date = textSprite('CHỦ NHẬT  ·  18 . 10 . 2026', { family: 'Montserrat', weight: 300, size: 34, spacing: 9, color: '#f3e3c3', shadow: 0.6 });
  SPR.lunar = serif('Tức ngày 09 tháng 09 năm Bính Ngọ', 36);
  SPR.endNames = script('Việt Anh & Lan Vi', 160);
  SPR.thanks = serif('Trân trọng cảm ơn quý vị đã đến chung vui cùng gia đình chúng tôi', 46);
  SPR.endDate = textSprite('18 . 10 . 2026', { family: 'Montserrat', weight: 300, size: 30, spacing: 10, color: '#f3e3c3', shadow: 0.6 });
  SPR.finaleCap = [serif('Và hôm nay, chúng mình về chung một nhà', 54)];
  for (const s of SC) {
    if (s.chapter) s.chSpr = [eyebrow(s.chapter[0], 26, 14), script(s.chapter[1], 150)];
    if (s.cap) s.capSpr = s.cap.map(l => serif(l, s.cap.length > 1 ? 46 : 52));
  }
}

// ---------------------------------------------------------------- cảnh
const motion = (lt, dur) => cam(clamp((lt + 1.2) / (dur + 2.4)));

function drawTilt(ctx, s, lt, dur) {
  const ph = P[s.p];
  let y1 = s.y1 ?? ph.fy + 0.08, y0 = s.y0 ?? y1 + 0.22;
  if (s.down) [y0, y1] = [ph.fy + 0.08, ph.fy + 0.26];
  const u = motion(lt, dur);
  drawCover(ctx, ph, 0, 0, W, H, ph.fx, lerp(y0, y1, u), lerp(1.0, 1.06, u));
}

function drawKB(ctx, s, lt, dur) {
  const ph = P[s.p], u = motion(lt, dur);
  drawCover(ctx, ph, 0, 0, W, H, lerp(s.c0[0], s.c1[0], u), lerp(s.c0[1], s.c1[1], u), lerp(s.z0, s.z1, u));
}

// Hai hoặc ba ảnh dọc đặt cạnh nhau, lần lượt trượt vào theo từng phách.
function drawPanels(ctx, s, lt, dur) {
  ctx.fillStyle = '#0d0a08'; ctx.fillRect(0, 0, W, H);
  const n = s.ps.length, g = 12, pw = (W - g * (n - 1)) / n, u = motion(lt, dur);
  s.ps.forEach((name, i) => {
    const ph = P[name];
    const a = easeOut((lt + 0.7 - i * BEAT) / 1.3);
    if (a <= 0) return;
    const dir = i % 2 ? 1 : -1, off = (1 - a) * dir * 110;
    ctx.globalAlpha = clamp(a * 1.3);
    const fy = ph.fy + 0.14 + dir * 0.05 * (u - 0.5);
    drawCover(ctx, ph, i * (pw + g), off, pw, H, ph.fx, fy, lerp(1.09, 1.0, u) + (1 - a) * 0.06);
    ctx.globalAlpha = 1;
  });
}

// Đoạn cao trào: cắt nhanh đúng phách, mỗi nhát cắt có cú "punch" zoom và loé sáng nhẹ.
function drawMontage(ctx, s, lt) {
  let acc = 0, k = 0;
  while (k < s.slots.length - 1 && lt >= acc + s.slots[k][1] * BEAT) { acc += s.slots[k][1] * BEAT; k++; }
  const [name, beats, x0, y0, z0, x1, y1, z1] = s.slots[k], len = beats * BEAT, ls = lt - acc;
  const u = clamp(ls / len), c = u * (2 - u) * 0.35 + u * 0.65; // đi đều, hơi chậm lại ở cuối
  const punch = 0.06 * Math.exp(-Math.max(0, ls) * 3.2);
  drawCover(ctx, P[name], 0, 0, W, H, lerp(x0, x1, c), lerp(y0, y1, c), lerp(z0, z1, c) + punch);
  if (k > 0 && ls >= 0) {
    const fl = (k % 2 ? 0.2 : 0.36) * Math.exp(-ls * 8);
    ctx.fillStyle = `rgba(255,247,232,${fl})`; ctx.fillRect(0, 0, W, H);
  }
}

function drawIntro(ctx, s, lt) {
  ctx.fillStyle = '#050302'; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = smooth(0, 3.5, lt); ctx.drawImage(INTRO_BG, 0, 0); ctx.globalAlpha = 1;
  // vệt sáng trôi chậm phía sau
  ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = 0.32 * fadeWin(lt, 0.5, 4, 8, 12.5);
  ctx.drawImage(LEAK, lerp(-700, 900, lt / 13), -350, 1500, 1500);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';

  const out = 1 - smooth(10.3, 11.8, lt);
  const eyeA = smooth(0.6, 2.0, lt) * out;
  if (eyeA > 0) {
    const sc = lerp(1.06, 1, easeOut((lt - 0.6) / 2.4)), spr = SPR.introEye;
    ctx.save(); ctx.globalAlpha = eyeA; ctx.translate(W / 2, 355); ctx.scale(sc, sc);
    ctx.drawImage(spr, -spr.width / 2, -spr.height / 2); ctx.restore();
  }
  drawReveal(ctx, SPR.names, W / 2, 500, smooth(1.6, 4.8, lt), out);
  ornament(ctx, W / 2, 640, 280 * easeOut((lt - 4.3) / 1.4), out * smooth(4.3, 4.8, lt));
  drawFade(ctx, SPR.date, W / 2, 712, smooth(4.9, 6.0, lt) * out);
  drawFade(ctx, SPR.lunar, W / 2, 775, smooth(5.6, 6.7, lt) * out);
}

function drawFinale(ctx, buf, s, lt) {
  const ph = P[s.p], u = cam(clamp((lt + 1.5) / 20));
  drawCover(ctx, ph, 0, 0, W, H, ph.fx, lerp(0.68, 0.47, u), lerp(1.0, 1.1, cam(clamp((lt + 1.5) / 31))));
  const capA = fadeWin(lt, 2.0, 3.0, 10.0, 11.0);
  if (capA > 0) {
    ctx.globalAlpha = capA; ctx.drawImage(BOTTOM, 0, H - 460); ctx.globalAlpha = 1;
    drawFade(ctx, SPR.finaleCap[0], W / 2, 950, capA, 12);
  }
  const b = smooth(11.5, 14.2, lt);
  if (b > 0) {
    ctx.globalAlpha = b; ctx.drawImage(blurOf(buf, 9, 'fin'), 0, 0, W, H); ctx.globalAlpha = 1;
    ctx.fillStyle = `rgba(10,6,4,${0.52 * b})`; ctx.fillRect(0, 0, W, H);
  }
  drawReveal(ctx, SPR.endNames, W / 2, 470, smooth(13.2, 16.2, lt));
  ornament(ctx, W / 2, 598, 300 * easeOut((lt - 15.6) / 1.4), smooth(15.6, 16.1, lt));
  drawFade(ctx, SPR.thanks, W / 2, 670, smooth(16.0, 17.3, lt));
  drawFade(ctx, SPR.endDate, W / 2, 748, smooth(16.8, 18.0, lt));
}

// Tiêu đề chương: cảnh mở đầu chương bắt đầu nhoè & tối, chữ hiện lên rồi "kéo nét" về rõ.
function chapterOverlay(ctx, buf, s, lt, slot) {
  if (lt > 3.6) return;
  const b = 1 - smooth(1.9, 3.4, lt);
  if (b > 0.002) {
    ctx.globalAlpha = b; ctx.drawImage(blurOf(buf, 8, slot), 0, 0, W, H); ctx.globalAlpha = 1;
    ctx.fillStyle = `rgba(10,6,4,${0.45 * b})`; ctx.fillRect(0, 0, W, H);
  }
  const ta = 1 - smooth(2.3, 3.0, lt);
  drawFade(ctx, s.chSpr[0], W / 2, 430, smooth(0.0, 0.8, lt) * ta, 10);
  drawReveal(ctx, s.chSpr[1], W / 2, 548, smooth(0.3, 1.8, lt), ta);
  ornament(ctx, W / 2, 668, 170 * easeOut((lt - 1.0) / 1.0), ta * smooth(1.0, 1.4, lt));
}

function captionOverlay(ctx, s, lt, dur) {
  const at = s.capAt ?? 1.0;
  const a = fadeWin(lt, at, at + 0.9, dur - 1.3, dur - 0.4);
  if (a <= 0) return;
  ctx.globalAlpha = a; ctx.drawImage(BOTTOM, 0, H - 460); ctx.globalAlpha = 1;
  const L = s.capSpr, y0 = L.length > 1 ? 918 : 950;
  L.forEach((spr, i) => drawFade(ctx, spr, W / 2, y0 + i * 62, a, 12));
}

function renderScene(s, buf, t, slot) {
  const ctx = buf.ctx, lt = t - s.t0, dur = s.t1 - s.t0;
  switch (s.type) {
    case 'intro': drawIntro(ctx, s, lt); break;
    case 'tilt': drawTilt(ctx, s, lt, dur); break;
    case 'kb': drawKB(ctx, s, lt, dur); break;
    case 'panels': drawPanels(ctx, s, lt, dur); break;
    case 'montage': drawMontage(ctx, s, lt); break;
    case 'finale': drawFinale(ctx, buf, s, lt); break;
  }
  if (s.chapter) chapterOverlay(ctx, buf, s, lt, slot);
  if (s.capSpr) captionOverlay(ctx, s, lt, dur);
}

// ---------------------------------------------------------------- chuyển cảnh
let MK;
// Vẽ một khung với hiệu ứng nhoè chuyển động (trung bình nhiều mẫu dịch chuyển).
function drawSamples(ctx, img, n, fn) {
  for (let j = 0; j < n; j++) {
    ctx.save(); ctx.globalAlpha *= 1 / (j + 1); fn(j / Math.max(1, n - 1) - 0.5); ctx.drawImage(img, 0, 0); ctx.restore();
  }
}
function composite(ctx, A, B, p, type) {
  const e = ease(p), k = Math.sin(Math.PI * clamp(p));
  const dissolve = (q = e) => { ctx.drawImage(A, 0, 0); ctx.globalAlpha = q; ctx.drawImage(B, 0, 0); ctx.globalAlpha = 1; };
  switch (type) {
    case 'bloom':
      dissolve();
      ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.78 * Math.pow(k, 1.6);
      ctx.drawImage(BLOOM, 0, 0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      break;
    case 'leak':
      dissolve();
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.95 * k; ctx.drawImage(LEAK, lerp(-1100, W - 300, e), -500, 1900, 1900);
      ctx.globalAlpha = 0.6 * k; ctx.drawImage(LEAK, lerp(W - 200, -900, e), 200, 1500, 1500);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      break;
    case 'blurDissolve': {
      dissolve();
      const bA = blurOf(A, 10, 'tA'), bB = blurOf(B, 10, 'tB');
      const m = BL.mix || (BL.mix = mk(480, 270));
      m.ctx.globalAlpha = 1; m.ctx.drawImage(bA, 0, 0); m.ctx.globalAlpha = e; m.ctx.drawImage(bB, 0, 0); m.ctx.globalAlpha = 1;
      ctx.globalAlpha = Math.pow(k, 0.7); ctx.drawImage(m, 0, 0, W, H); ctx.globalAlpha = 1;
      break;
    }
    case 'push': { // trượt ngang có nhoè chuyển động
      const off = e * W, blur = k * 46;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      drawSamples(ctx, A, 9, d => ctx.translate(-off + d * blur, 0));
      drawSamples(ctx, B, 9, d => ctx.translate(W - off + d * blur, 0));
      ctx.fillStyle = `rgba(0,0,0,${0.35 * k})`; ctx.fillRect(W - off - 6, 0, 12, H);
      break;
    }
    case 'zoomPush': { // lao vào khung cũ, khung mới lùi ra
      const sw = smooth(0.38, 0.62, p);
      const zA = 1 + 0.45 * easeIn(p / 0.62), zB = 1 + 0.3 * (1 - easeOut((p - 0.38) / 0.62));
      const spread = 0.028 * k;
      const zoomAt = z => { ctx.translate(W / 2, H / 2); ctx.scale(z, z); ctx.translate(-W / 2, -H / 2); };
      const zoomOn = (c, z) => { c.translate(W / 2, H / 2); c.scale(z, z); c.translate(-W / 2, -H / 2); };
      if (sw < 1) drawSamples(ctx, A, 8, d => zoomAt(zA + d * spread));
      if (sw > 0) {
        const x = MK.ctx; x.globalCompositeOperation = 'source-over';
        drawSamples(x, B, 8, d => zoomOn(x, zB + d * spread));
        ctx.globalAlpha = sw; ctx.drawImage(MK, 0, 0); ctx.globalAlpha = 1;
      }
      ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.35 * k; ctx.drawImage(BLOOM, 0, 0);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      break;
    }
    case 'softWipe': { // vệt quét chéo mềm
      ctx.drawImage(A, 0, 0);
      const x = MK.ctx; x.globalCompositeOperation = 'copy'; x.drawImage(B, 0, 0);
      x.globalCompositeOperation = 'destination-in';
      const ang = 0.35, cx = Math.cos(ang), sy = Math.sin(ang), L = W * cx + H * sy, soft = 520;
      const d = -soft + e * (L + soft);
      const g = x.createLinearGradient(d * cx, d * sy, (d + soft) * cx, (d + soft) * sy);
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(0, 0, W, H); x.globalCompositeOperation = 'source-over';
      ctx.drawImage(MK, 0, 0);
      break;
    }
    case 'iris': { // mở tròn từ tâm
      ctx.drawImage(A, 0, 0);
      const x = MK.ctx; x.globalCompositeOperation = 'copy'; x.drawImage(B, 0, 0);
      x.globalCompositeOperation = 'destination-in';
      const r = e * 1450, g = x.createRadialGradient(W / 2, H / 2, Math.max(0, r - 380), W / 2, H / 2, Math.max(1, r));
      g.addColorStop(0, 'rgba(0,0,0,1)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(0, 0, W, H); x.globalCompositeOperation = 'source-over';
      ctx.drawImage(MK, 0, 0);
      break;
    }
    default: dissolve();
  }
}

// ---------------------------------------------------------------- khung hình
const C = document.getElementById('c'), CTX = C.getContext('2d');
CTX.imageSmoothingQuality = 'high';
let BUF_A, BUF_B;

function dustLevel(t) {
  if (t < bar(5)) return 1.0;
  if (t >= bar(59) && t < bar(70)) return 0.3;
  if (t >= bar(70)) return lerp(0.45, 1.0, smooth(bar(70) + 11, bar(70) + 15, t));
  return 0.45;
}

function render(t) {
  const act = [];
  for (let i = 0; i < SC.length; i++) {
    const s = SC[i], nx = SC[i + 1];
    if (t >= s.t0 - s.half && t < s.t1 + (nx ? nx.half : 0)) act.push(i);
  }
  if (act.length === 1) {
    renderScene(SC[act[0]], BUF_A, t, 'a');
    CTX.drawImage(BUF_A, 0, 0);
  } else {
    const a = SC[act[0]], b = SC[act[1]];
    renderScene(a, BUF_A, t, 'a');
    renderScene(b, BUF_B, t, 'b');
    composite(CTX, BUF_A, BUF_B, (t - (b.t0 - b.half)) / (2 * b.half), b.tin[0]);
  }
  drawDust(CTX, t, dustLevel(t));
  CTX.drawImage(VIGNETTE, 0, 0);
  // hạt phim
  const gr = GRAIN[Math.floor(t * FPS / 2) % GRAIN.length];
  CTX.save();
  CTX.globalCompositeOperation = 'overlay'; CTX.globalAlpha = 0.07;
  CTX.fillStyle = CTX.createPattern(gr, 'repeat');
  const R = mulberry32(Math.floor(t * FPS / 2) + 1);
  CTX.translate(-Math.floor(R() * 256), -Math.floor(R() * 256));
  CTX.fillRect(0, 0, W + 256, H + 256);
  CTX.restore();
  // mở đầu & kết thúc
  const fb = Math.max(1 - smooth(0, 0.6, t), smooth(END - 3.2, END - 0.2, t));
  if (fb > 0) { CTX.fillStyle = `rgba(0,0,0,${fb})`; CTX.fillRect(0, 0, W, H); }
}

window.FPS = FPS; window.END = END;
window.TOTAL_FRAMES = Math.round(END * FPS);
window.renderFrame = function (f, q = 0.94) { render(f / FPS); return C.toDataURL('image/jpeg', q); };
window.renderAt = function (t) { render(t); };

async function init() {
  const sample = 'Việt Anh & Lan Vi — Chương Khởi đầu Nét xưa Hẹn ước Mãi mãi ỆẢỲ';
  await Promise.all([
    '176px "Great Vibes"', 'italic 500 50px "Cormorant Garamond"', '400 26px "Montserrat"', '300 30px "Montserrat"',
  ].map(f => document.fonts.load(f, sample)));
  await Promise.all(Object.entries(PHOTOS).map(async ([name, [fx, fy]]) => {
    const img = new Image(); img.src = `anh/${name}.jpg`; await img.decode();
    P[name] = { img, fx, fy };
  }));
  BUF_A = mk(W, H); BUF_B = mk(W, H); MK = mk(W, H);
  buildFx(); buildText();
  window.READY = true;
  const hint = document.getElementById('hint');
  if (location.search.includes('play')) {
    hint.textContent = 'Bấm vào màn hình để phát';
    const audio = new Audio('nhac.mp3');
    document.body.addEventListener('click', () => {
      hint.remove(); audio.currentTime = 0; audio.play();
      const loop = () => { render(Math.min(audio.currentTime, END)); if (audio.currentTime < END) requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    }, { once: true });
  } else {
    hint.remove(); render(bar(5) + 2);
  }
}
init();
