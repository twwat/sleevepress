/* Sleeve Press: procedural pattern library.
   Patterns.LIST  -> [{ id, name, family, busy }]   busy 0..1 = how loud it is at scale 100 / alpha 0.5
   Patterns.draw(ctx, W, H, id, o)
     o = { S, scale (percent), angle (deg), fg [r,g,b], fg2 [r,g,b], bg [r,g,b], alpha 0..1, seed }
   Every pattern works in the sleeve's 3-colour world: fg, fg2 and (for knockouts) bg, tinted only by alpha.
   Each pattern is drawn once at full strength into an offscreen layer (cached on every input but alpha),
   then laid over the caller's canvas at `alpha`, so overlaps inside a pattern never double up. */
(function () {
"use strict";

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
/* Position-keyed randomness: the same cell gets the same value whatever the canvas size. */
function hash3(i, j, s) {
  let h = Math.imul(i | 0, 374761393) ^ Math.imul(j | 0, 668265263) ^ Math.imul((s | 0) + 0x9E3779B9, 2246822519);
  h = Math.imul(h ^ h >>> 13, 1274126177); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
const rgba = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${Math.round(clamp(a, 0, 1) * 1000) / 1000})`;
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
function makeCanvas(w, h) { const c = document.createElement("canvas"); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }

/* ---------- small LRU keyed by string, budgeted in pixels ---------- */
const pool = [];   // evicted layer canvases, reused so big renders don't churn the GC
function LRU(budget, recycle) {
  const m = new Map(); let used = 0;
  const drop = (c) => { if (recycle) { pool.push(c); if (pool.length > 2) pool.shift(); } };
  const px = (c) => c.width * c.height;
  return {
    get(k) { const v = m.get(k); if (v !== undefined) { m.delete(k); m.set(k, v); } return v; },
    set(k, v) {
      if (m.has(k)) { used -= px(m.get(k)); m.delete(k); }
      m.set(k, v); used += px(v);
      while (used > budget && m.size > 1) { const [k0, v0] = m.entries().next().value; m.delete(k0); used -= px(v0); drop(v0); }
    },
    clear() { for (const v of m.values()) drop(v); m.clear(); used = 0; },
  };
}
const layerCache = LRU(16e6, true);   // ~11 layers at 1200², 1-2 at 3000²
const tileCache = LRU(8e6);

/* ---------- helpers ---------- */
function tile(P, name, tw, th, fn) {
  tw = Math.max(2, Math.round(tw)); th = Math.max(2, Math.round(th));
  const key = P.tkey + "|" + name + "|" + tw + "x" + th;
  let c = tileCache.get(key);
  if (!c) { c = makeCanvas(tw, th); fn(c.getContext("2d"), tw, th); tileCache.set(key, c); }
  return c;
}
function fillTile(P, c, ox = 0, oy = 0) {
  const g = P.g, pat = g.createPattern(c, "repeat");
  if ((ox || oy) && pat.setTransform) pat.setTransform(new DOMMatrix([1, 0, 0, 1, Math.round(ox), Math.round(oy)]));
  g.fillStyle = pat; g.fillRect(-P.R, -P.R, P.R * 2, P.R * 2);
}
/* Draw a motif and its 8 neighbours so anything crossing a tile edge wraps seamlessly. */
function wrap(tw, th, f) { for (const dy of [-th, 0, th]) for (const dx of [-tw, 0, tw]) f(dx, dy); }
function poly(g, pts) { g.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]); g.closePath(); }

/* Bridson poisson-disc points in [-RX,RX]×[-RY,RY], min distance d. */
function poisson(rnd, RX, RY, d, k = 18) {
  const cs = d / Math.SQRT2, nx = Math.ceil((2 * RX) / cs) + 1, ny = Math.ceil((2 * RY) / cs) + 1, grid = new Int32Array(nx * ny).fill(-1);
  const pts = [], active = [], d2 = d * d;
  const add = (x, y) => { const i = pts.length; pts.push(x, y); active.push(i); grid[((y + RY) / cs | 0) * nx + ((x + RX) / cs | 0)] = i; };
  add((rnd() - 0.5) * RX * 0.2, (rnd() - 0.5) * RY * 0.2);
  while (active.length) {
    const ai = (rnd() * active.length) | 0, i = active[ai], px = pts[i], py = pts[i + 1];
    let found = false;
    for (let t = 0; t < k; t++) {
      const a = rnd() * TAU, r = d * (1 + rnd()), x = px + Math.cos(a) * r, y = py + Math.sin(a) * r;
      if (x < -RX || y < -RY || x >= RX || y >= RY) continue;
      const gx = (x + RX) / cs | 0, gy = (y + RY) / cs | 0; let ok = true;
      for (let yy = Math.max(0, gy - 2); yy <= Math.min(ny - 1, gy + 2) && ok; yy++)
        for (let xx = Math.max(0, gx - 2); xx <= Math.min(nx - 1, gx + 2); xx++) {
          const j = grid[yy * nx + xx]; if (j < 0) continue;
          const dx = pts[j] - x, dy = pts[j + 1] - y; if (dx * dx + dy * dy < d2) { ok = false; break; }
        }
      if (ok) { add(x, y); found = true; break; }
    }
    if (!found) { active[ai] = active[active.length - 1]; active.pop(); }
  }
  return pts;
}

/* 2-D gradient noise (Perlin), seeded. */
function perlin(seed) {
  const rnd = mulberry32(seed), p = new Uint8Array(512), a = new Uint8Array(256);
  for (let i = 0; i < 256; i++) a[i] = i;
  for (let i = 255; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = a[i]; a[i] = a[j]; a[j] = t; }
  for (let i = 0; i < 512; i++) p[i] = a[i & 255];
  const gx = new Float64Array([1, -1, 1, -1, 1.4142, -1.4142, 0, 0]), gy = new Float64Array([1, 1, -1, -1, 0, 0, 1.4142, -1.4142]);
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return function (x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, X = xi & 255, Y = yi & 255;
    const aa = p[p[X] + Y] & 7, ab = p[p[X] + Y + 1] & 7, ba = p[p[X + 1] + Y] & 7, bb = p[p[X + 1] + Y + 1] & 7;
    const u = fade(xf), v = fade(yf);
    const naa = gx[aa] * xf + gy[aa] * yf, nba = gx[ba] * (xf - 1) + gy[ba] * yf;
    const nab = gx[ab] * xf + gy[ab] * (yf - 1), nbb = gx[bb] * (xf - 1) + gy[bb] * (yf - 1);
    const x1 = naa + u * (nba - naa), x2 = nab + u * (nbb - nab);
    return (x1 + v * (x2 - x1)) * 0.7071;
  };
}

/* Draw in screen space (identity transform) — for fields sampled per point (topo). */
function screen(P, fn) { const g = P.g; g.save(); g.setTransform(1, 0, 0, 1, 0, 0); fn(g); g.restore(); }

/* ======================================================================
   FABRIC
   ====================================================================== */
const SETTS = [
  [[1, 30], [0, 6], [2, 2], [0, 6], [1, 8], [0, 22]],
  [[1, 22], [3, 4], [1, 4], [0, 18], [2, 3], [0, 18]],
  [[0, 16], [1, 12], [0, 3], [1, 3], [0, 3], [1, 12], [0, 16], [2, 2]],
  [[3, 20], [1, 6], [0, 10], [2, 2], [0, 10], [1, 6]],
  [[1, 26], [0, 4], [1, 2], [0, 4], [3, 14], [2, 2], [3, 14]],
];
function tartan(P) {
  const t = Math.max(1, Math.round(P.S * 0.0024 * Math.sqrt(P.k)));
  const half = SETTS[(P.rnd() * SETTS.length) | 0];
  const full = half.concat(half.slice(1, -1).reverse());
  const sum = full.reduce((a, b) => a + b[1], 0), f = (P.s * 0.36 / t) / sum;
  const bands = full.map(([c, w]) => [c, Math.max(c === 2 ? 1 : 2, Math.round(w * f))]);
  let tot = bands.reduce((a, b) => a + b[1], 0);
  let big = 0; bands.forEach((b, i) => { if (b[1] > bands[big][1]) big = i; });
  bands[big][1] += (4 - tot % 4) % 4; tot = bands.reduce((a, b) => a + b[1], 0);
  const N = tot * t;
  const c = tile(P, "tartan", N, N, (g) => {
    const A = { 1: [P.fg, 0.7], 2: [P.fg2, 1], 3: [P.fg, 0.32] };
    const warp = makeCanvas(N, N), weft = makeCanvas(N, N), wg = warp.getContext("2d"), hg = weft.getContext("2d");
    let x = 0;
    for (const [ci, w] of bands) {
      if (ci) { const [cc, a] = A[ci]; wg.fillStyle = hg.fillStyle = rgba(cc, a); wg.fillRect(x * t, 0, w * t, N); hg.fillRect(0, x * t, N, w * t); }
      x += w;
    }
    // flat underlay so the setts read as solid tones, then the 2/2 twill on top
    g.globalAlpha = 0.5; g.drawImage(warp, 0, 0); g.drawImage(weft, 0, 0); g.globalAlpha = 1;
    const m = makeCanvas(4 * t, 4 * t), mg = m.getContext("2d"); mg.fillStyle = "#000";
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if ((i - j + 8) % 4 < 2) mg.fillRect(i * t, j * t, t, t);
    wg.globalCompositeOperation = "destination-in"; wg.fillStyle = wg.createPattern(m, "repeat"); wg.fillRect(0, 0, N, N);
    hg.globalCompositeOperation = "destination-out"; hg.fillStyle = hg.createPattern(m, "repeat"); hg.fillRect(0, 0, N, N);
    g.globalAlpha = 0.75; g.drawImage(warp, 0, 0); g.drawImage(weft, 0, 0);
  });
  fillTile(P, c, -N / 2, -N / 2);
}

function gingham(P) {
  const p = Math.max(4, Math.round(P.s * 0.052) * 2), h = p / 2;
  const c = tile(P, "gingham", p, p, (g) => {
    g.fillStyle = rgba(P.fg, 0.45); g.fillRect(0, 0, h, p);
    g.fillStyle = rgba(P.fg, 0.45); g.fillRect(0, 0, p, h);
    // a fine weave line through the light bands keeps it from looking like a flat grid
    const lw = Math.max(1, Math.round(P.S * 0.0011));
    g.fillStyle = rgba(P.fg2, 0.14);
    for (let y = h + lw * 2; y < p; y += lw * 3) g.fillRect(h, y, h, lw);
  });
  fillTile(P, c, -p / 4, -p / 4);
}

function houndstooth(P) {
  const u = Math.max(2, Math.round(P.s * 0.085 / 8)), N = u * 8;
  const c = tile(P, "hound", N, N, (g) => {
    g.fillStyle = rgba(P.fg);
    g.fillRect(0, 0, 4 * u, 4 * u);
    const bands = (x0, y0, off) => {
      g.save(); g.beginPath(); g.rect(x0 * u, y0 * u, 4 * u, 4 * u); g.clip(); g.beginPath();
      for (let a = off - 16; a < 20; a += 4) poly(g, [(a + 12) * u, -12 * u, (a - 12) * u, 12 * u, (a + 2 - 12) * u, 12 * u, (a + 2 + 12) * u, -12 * u]);
      g.fill(); g.restore();
    };
    bands(4, 0, 2.5); bands(0, 4, 0.5);
  });
  fillTile(P, c, -N / 2, -N / 2);
}

function herringbone(P) {
  const cw = Math.max(6, Math.round(P.s * 0.07)), q = Math.max(4, Math.round(cw * 0.36));
  const c = tile(P, "herring", cw * 2, q, (g, tw, th) => {
    for (let col = 0; col < 2; col++) {
      const x0 = col * cw, sl = col ? -1 : 1, ph = col ? cw + q * 0.12 : 0;
      g.save(); g.beginPath(); g.rect(x0, 0, cw, th); g.clip();
      g.fillStyle = rgba(P.fg, col ? 0.7 : 0.9);
      g.beginPath();
      for (let b = -3 * q - cw * 2; b < th + cw * 2 + 3 * q; b += q) {
        const y0 = b + ph;
        poly(g, [x0, y0, x0 + cw, y0 + sl * cw, x0 + cw, y0 + sl * cw + q * 0.5, x0, y0 + q * 0.5]);
      }
      g.fill(); g.restore();
    }
  });
  fillTile(P, c, -cw, 0);
}

function basketweave(P) {
  const b = Math.max(6, Math.round(P.s * 0.08)), n = 3, gap = Math.max(1, Math.round(b * 0.07)), th = (b - gap * n) / n;
  const c = tile(P, "basket", b * 2, b * 2, (g) => {
    const block = (x0, y0, horiz, col, a) => {
      g.fillStyle = rgba(col, a); g.beginPath();
      for (let k = 0; k < n; k++) {
        const o = gap / 2 + k * (th + gap);
        if (horiz) g.roundRect ? g.roundRect(x0 + gap / 2, y0 + o, b - gap, th, th * 0.18) : g.rect(x0 + gap / 2, y0 + o, b - gap, th);
        else g.roundRect ? g.roundRect(x0 + o, y0 + gap / 2, th, b - gap, th * 0.18) : g.rect(x0 + o, y0 + gap / 2, th, b - gap);
      }
      g.fill();
    };
    block(0, 0, true, P.fg, 0.9); block(b, b, true, P.fg, 0.9);
    block(b, 0, false, P.fg2, 0.55); block(0, b, false, P.fg2, 0.55);
  });
  fillTile(P, c, -b, -b);
}

/* ======================================================================
   CHECKS
   ====================================================================== */
function checker(P) {
  const q = Math.max(3, Math.round(P.s * 0.07));
  const c = tile(P, "checker", q * 2, q * 2, (g) => { g.fillStyle = rgba(P.fg); g.fillRect(0, 0, q, q); g.fillRect(q, q, q, q); });
  fillTile(P, c);
}

function warpcheck(P) {
  const g = P.g, rnd = P.rnd, c = P.s * 0.12, A = c * 0.3;
  const k1 = TAU / (c * (3.4 + rnd() * 1.4)), k2 = TAU / (c * (3.4 + rnd() * 1.4)), k3 = k1 * 0.37, k4 = k2 * 0.41;
  const p1 = rnd() * TAU, p2 = rnd() * TAU, p3 = rnd() * TAU, p4 = rnd() * TAU;
  const wx = (x, y) => x + A * Math.sin(y * k1 + p1) + A * 0.55 * Math.sin((x * 0.6 + y * 0.8) * k3 + p3);
  const wy = (x, y) => y + A * Math.sin(x * k2 + p2) + A * 0.55 * Math.sin((x * 0.8 - y * 0.6) * k4 + p4);
  const n = Math.ceil(P.R / c) + 2, m = 10;
  g.fillStyle = rgba(P.fg); g.beginPath();
  for (let j = -n; j < n; j++) for (let i = -n; i < n; i++) {
    if (((i + j) & 1) || !P.vis((i + 0.5) * c, (j + 0.5) * c, c * 2)) continue;
    const x0 = i * c, y0 = j * c, pts = [];
    for (let t = 0; t < m; t++) pts.push(x0 + c * t / m, y0);
    for (let t = 0; t < m; t++) pts.push(x0 + c, y0 + c * t / m);
    for (let t = 0; t < m; t++) pts.push(x0 + c - c * t / m, y0 + c);
    for (let t = 0; t < m; t++) pts.push(x0, y0 + c - c * t / m);
    for (let t = 0; t < pts.length; t += 2) { const x = pts[t], y = pts[t + 1]; pts[t] = wx(x, y); pts[t + 1] = wy(x, y); }
    poly(g, pts);
  }
  g.fill();
}

function harlequin(P) {
  const w = Math.max(6, Math.round(P.s * 0.08)), h = Math.round(w * 1.7);
  const c = tile(P, "harle", w, h, (g) => {
    g.fillStyle = rgba(P.fg2, 0.4); g.beginPath();
    wrap(w, h, (dx, dy) => poly(g, [dx, dy - h / 2, dx + w / 2, dy, dx, dy + h / 2, dx - w / 2, dy]));
    g.fill();
    g.fillStyle = rgba(P.fg); g.beginPath(); poly(g, [w / 2, 0, w, h / 2, w / 2, h, 0, h / 2]); g.fill();
  });
  fillTile(P, c, -w / 2, -h / 2);
}

function argyle(P) {
  const w = Math.max(8, Math.round(P.s * 0.13)), h = Math.round(w * 1.45);
  const c = tile(P, "argyle", w, h, (g) => {
    g.fillStyle = rgba(P.fg, 0.3); g.beginPath();
    wrap(w, h, (dx, dy) => poly(g, [dx, dy - h / 2, dx + w / 2, dy, dx, dy + h / 2, dx - w / 2, dy]));
    g.fill();
    g.fillStyle = rgba(P.fg, 0.78); g.beginPath(); poly(g, [w / 2, 0, w, h / 2, w / 2, h, 0, h / 2]); g.fill();
    const L = Math.hypot(w, h), seg = L / 7, lw = Math.max(1, P.S * 0.0018 * Math.sqrt(P.k));
    g.strokeStyle = rgba(P.fg2, 0.75); g.lineWidth = lw; g.lineCap = "butt";
        g.beginPath(); wrap(w, h, (dx, dy) => { g.moveTo(dx, dy); g.lineTo(dx + w, dy + h); }); g.stroke();
    g.beginPath(); wrap(w, h, (dx, dy) => { g.moveTo(dx + w, dy); g.lineTo(dx, dy + h); }); g.stroke();
  });
  fillTile(P, c, -w / 2, -h / 2);
}

/* ======================================================================
   DOTS
   ====================================================================== */
function polka(P) {
  const p = Math.max(6, Math.round(P.s * 0.08)), r = p * 0.15;
  const c = tile(P, "polka", p, p, (g) => {
    g.fillStyle = rgba(P.fg); g.beginPath();
    wrap(p, p, (dx, dy) => { g.moveTo(dx + r, dy); g.arc(dx, dy, r, 0, TAU); });
    g.fill();
    g.fillStyle = rgba(P.fg2, 0.75); g.beginPath(); g.arc(p / 2, p / 2, r, 0, TAU); g.fill();
  });
  fillTile(P, c, -p / 2, -p / 2);
}

function halftone(P) {
  const g = P.g, rnd = P.rnd, p = Math.max(3, P.s * 0.026), R = P.R;
  const radial = rnd() < 0.5;
  let val;
  if (radial) {
    const fx = (rnd() - 0.5) * P.W * 0.8, fy = (rnd() - 0.5) * P.H * 0.8, rr = P.S * (0.8 + rnd() * 0.35);
    val = (x, y) => 1 - Math.hypot(x - fx, y - fy) / rr;
  } else {
    const a = [Math.PI / 2, -Math.PI / 2, Math.PI / 4, Math.PI * 0.75, 0, Math.PI][(rnd() * 6) | 0] + (rnd() - 0.5) * 0.3;
    const dx = Math.cos(a), dy = Math.sin(a), span = P.S * 0.62;
    val = (x, y) => 0.5 + (x * dx + y * dy) / (2 * span);
  }
  // one path per radius step (dots quantised to 24 sizes), each built from a unit-disc template
  const q = p / Math.SQRT2, n = Math.ceil(R * Math.SQRT2 / p) + 1, rmax = p * 0.6, LV = 24, paths = [];
  for (let l = 0; l < LV; l++) paths.push(null);
  for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
    const x = (i - j) * q, y = (i + j) * q;
    if (!P.vis(x, y, p)) continue;
    const v = clamp(val(x, y), 0, 1), r = rmax * Math.pow(v, 0.85);
    if (r < p * 0.05) continue;
    const l = Math.min(LV - 1, Math.round(r / rmax * (LV - 1)));
    const pth = paths[l] || (paths[l] = new Path2D()), rr = rmax * l / (LV - 1) || r;
    pth.moveTo(x + rr, y); pth.arc(x, y, rr, 0, TAU);
  }
  g.fillStyle = rgba(P.fg);
  for (const pth of paths) if (pth) g.fill(pth);
}

function confetti(P) {
  const g = P.g, rnd = P.rnd, d = Math.max(6, P.s * 0.058);
  const pts = poisson(rnd, P.hx + d, P.hy + d, d);
  const lw = d * 0.13;
  const A = new Path2D(), B = new Path2D();
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i], y = pts[i + 1], t = rnd(), a = rnd() * TAU, path = rnd() < 0.62 ? A : B, L0 = rnd();
    if (!P.vis(x, y, d)) continue;
    if (t < 0.62) {          // strip
      const L = d * (0.3 + L0 * 0.16), c = Math.cos(a), s = Math.sin(a), hx = c * L / 2, hy = s * L / 2, nx = -s * lw / 2, ny = c * lw / 2;
      path.moveTo(x - hx + nx, y - hy + ny); path.lineTo(x + hx + nx, y + hy + ny); path.lineTo(x + hx - nx, y + hy - ny); path.lineTo(x - hx - nx, y - hy - ny); path.closePath();
    } else if (t < 0.88) {   // dot
      const r = d * 0.09; path.moveTo(x + r, y); path.arc(x, y, r, 0, TAU);
    } else {                 // small triangle
      const r = d * 0.13; for (let k = 0; k < 3; k++) { const b = a + k * TAU / 3; k ? path.lineTo(x + Math.cos(b) * r, y + Math.sin(b) * r) : path.moveTo(x + Math.cos(b) * r, y + Math.sin(b) * r); } path.closePath();
    }
  }
  g.fillStyle = rgba(P.fg); g.fill(A);
  g.fillStyle = rgba(P.fg2, 0.9); g.fill(B);
}

/* ======================================================================
   LINES
   ====================================================================== */
function pinstripe(P) {
  const p = Math.max(4, Math.round(P.s * 0.042)), lw = Math.max(1, Math.round(P.S * 0.0017));
  const c = tile(P, "pin", p * 2, 4, (g) => {
    g.fillStyle = rgba(P.fg); g.fillRect(0, 0, lw, 4); g.fillRect(p, 0, lw, 4);
    g.fillStyle = rgba(P.fg2, 0.85); g.fillRect(p + lw * 3, 0, Math.max(1, Math.round(lw * 0.6)), 4);
  });
  fillTile(P, c);
}

function diagonal(P) {
  const g = P.g, p = Math.max(4, Math.round(P.s * 0.06)), bw = Math.round(p * 0.42), lw = Math.max(1, Math.round(P.S * 0.0016)), R = P.R;
  g.rotate(-Math.PI / 4);
  const A = new Path2D(), B = new Path2D(), n = Math.ceil(R / p) + 1;
  for (let k = -n; k < n; k++) { A.rect(k * p, -R, bw, R * 2); B.rect(k * p + Math.round(bw + (p - bw) / 2 - lw / 2), -R, lw, R * 2); }
  g.fillStyle = rgba(P.fg); g.fill(A);
  g.fillStyle = rgba(P.fg2, 0.8); g.fill(B);
}

function chevron(P) {
  const w = Math.max(6, Math.round(P.s * 0.11)), b = Math.max(3, Math.round(P.s * 0.034)), a = w * 0.34;
  const c = tile(P, "chev", w, b * 2, (g, tw, th) => {
    const band = (y0, t, col, al) => {
      g.fillStyle = rgba(col, al); g.beginPath();
      for (const dy of [-th, 0, th]) poly(g, [0, dy + y0 + a, w / 2, dy + y0, w, dy + y0 + a, w, dy + y0 + a + t, w / 2, dy + y0 + t, 0, dy + y0 + a + t]);
      g.fill();
    };
    band(0, b * 0.6, P.fg, 1); band(b, b * 0.6, P.fg2, 0.5);
  });
  fillTile(P, c, -w / 2, 0);
}

function opwave(P) {
  const g = P.g, rnd = P.rnd, p = Math.max(4, P.s * 0.036), lam = P.s * (0.38 + rnd() * 0.14), R = P.R;
  const phi = (0.1 + rnd() * 0.16) * (rnd() < 0.5 ? -1 : 1), bx = (rnd() - 0.5) * P.S * 0.5, bw = P.s * 0.45, amp0 = p * 1.25;
  const amp = (x) => amp0 * (0.3 + 0.7 * Math.exp(-(((x - bx) / bw) ** 2)));
  const step = Math.max(3, lam / 30), xs = [];
  const hx = P.hx + step, hy = P.hy + amp0 + p;
  for (let x = -hx - step; x <= hx + step; x += step) xs.push(x);
  const yAt = (x, kk) => kk * p + amp(x) * Math.sin(TAU * x / lam + kk * phi);
  g.fillStyle = rgba(P.fg); g.beginPath();
  const n = Math.ceil(hy / p) + 1;
  for (let k = -n; k <= n; k++) {
    g.moveTo(xs[0], yAt(xs[0], k));
    for (let i = 1; i < xs.length; i++) g.lineTo(xs[i], yAt(xs[i], k));
    for (let i = xs.length - 1; i >= 0; i--) g.lineTo(xs[i], yAt(xs[i], k + 0.48));
    g.closePath();
  }
  g.fill();
}

function concentric(P) {
  const g = P.g, rnd = P.rnd, p = Math.max(4, P.s * 0.042), lw = Math.max(1, Math.round(P.S * 0.0035 * Math.sqrt(P.k)));
  const cx = Math.round((rnd() - 0.5) * P.W * 0.3), cy = Math.round((rnd() - 0.5) * P.H * 0.3);
  const max = P.R * 1.5 + Math.hypot(cx, cy), o = lw % 2 ? 0.5 : 0;
  const A = new Path2D(), B = new Path2D();
  let k = 0;
  for (let r = p * 0.5; r < max; r += p, k++) {
    const h = Math.round(r) + o; (k % 4 === 3 ? B : A).rect(cx - h, cy - h, h * 2, h * 2);
  }
  g.lineWidth = lw; g.strokeStyle = rgba(P.fg); g.stroke(A);
  g.strokeStyle = rgba(P.fg2); g.stroke(B);
}

function moire(P) {
  const g = P.g, rnd = P.rnd, p = Math.max(4, P.s * 0.026), lw = Math.max(1, P.S * 0.0021);
  const a = rnd() * TAU, d = p * (3.5 + rnd() * 3), cx = (rnd() - 0.5) * P.W * 0.3, cy = (rnd() - 0.5) * P.H * 0.3;
  const rings = (x, y, col, al) => {
    const max = P.R + Math.hypot(x, y) + p; g.beginPath();
    for (let r = p; r < max; r += p) { g.moveTo(x + r, y); g.arc(x, y, r, 0, TAU); }
    g.strokeStyle = rgba(col, al); g.lineWidth = lw; g.stroke();
  };
  rings(cx - Math.cos(a) * d / 2, cy - Math.sin(a) * d / 2, P.fg, 1);
  rings(cx + Math.cos(a) * d / 2, cy + Math.sin(a) * d / 2, P.fg2, 0.85);
}

/* ======================================================================
   RAYS
   ====================================================================== */
const ANCHORS = [[0.5, 0.5], [0.5, 1.06], [-0.04, -0.04], [1.05, 0.38], [0.28, 0.98], [0.62, 0.3], [-0.06, 0.66]];
function rayAnchor(P) {
  const [ax, ay] = ANCHORS[(P.rnd() * ANCHORS.length) | 0];
  return P.toFrame(P.W * ax + (P.rnd() - 0.5) * P.S * 0.06, P.H * ay + (P.rnd() - 0.5) * P.S * 0.06);
}
function sunburst(P) {
  const g = P.g, [x, y] = rayAnchor(P), n = clamp(Math.round(12 * 100 / P.scale), 5, 40) * 2, w = TAU / (n * 2), L = P.R * 4, a0 = P.rnd() * TAU;
  const A = new Path2D(), B = new Path2D();
  for (let i = 0; i < n; i++) {
    const a = a0 + i * 2 * w, path = i % 2 ? B : A;
    path.moveTo(x, y); path.lineTo(x + Math.cos(a) * L, y + Math.sin(a) * L); path.lineTo(x + Math.cos(a + w) * L, y + Math.sin(a + w) * L); path.closePath();
  }
  g.fillStyle = rgba(P.fg); g.fill(A);
  g.fillStyle = rgba(P.fg2, 0.5); g.fill(B);
}

function swirl(P) {
  const g = P.g, rnd = P.rnd, [x, y] = rayAnchor(P), n = clamp(Math.round(10 * 100 / P.scale), 4, 30), w = TAU / (n * 2), a0 = rnd() * TAU;
  const tw = (0.9 + rnd() * 0.8) * (rnd() < 0.5 ? -1 : 1), r0 = P.S * 0.01, r1 = P.R * 2.2, steps = 200;
  const rs = []; for (let i = 0; i <= steps; i++) rs.push(r0 * Math.pow(r1 / r0, i / steps));
  const A = new Path2D(), B = new Path2D();
  for (let i = 0; i < n; i++) {
    const a = a0 + i * 2 * w, path = i % 2 ? B : A;
    for (let k = 0; k <= steps; k++) { const t = a + tw * Math.log(rs[k] / r0); k ? path.lineTo(x + Math.cos(t) * rs[k], y + Math.sin(t) * rs[k]) : path.moveTo(x + Math.cos(t) * rs[k], y + Math.sin(t) * rs[k]); }
    for (let k = steps; k >= 0; k--) { const t = a + w + tw * Math.log(rs[k] / r0); path.lineTo(x + Math.cos(t) * rs[k], y + Math.sin(t) * rs[k]); }
    path.closePath();
  }
  g.fillStyle = rgba(P.fg); g.fill(A);
  g.fillStyle = rgba(P.fg2, 0.5); g.fill(B);
  g.beginPath(); g.arc(x, y, r0 * 1.6, 0, TAU); g.fillStyle = rgba(P.fg); g.fill();
}

/* ======================================================================
   TILES / WALLPAPER
   ====================================================================== */
/* Scales in overlapping rows (seigaiha, fans): rows R/2 apart, alternate rows shifted by R,
   each row knocks out what is under it, so every scale sits on top of the row above. */
function scaleRows(g, R0, tw, th, drawOne) {
  for (let j = -2; j <= Math.ceil(th / (R0 / 2)) + 2; j++) {
    const y = j * R0 / 2, off = (j & 1) ? R0 : 0;
    for (let x = off - 2 * R0; x <= tw + 2 * R0; x += 2 * R0) {
      g.save(); g.globalCompositeOperation = "destination-out"; g.beginPath(); g.arc(x, y, R0, 0, TAU); g.fill(); g.restore();
      drawOne(x, y);
    }
  }
}
function seigaiha(P) {
  const R0 = Math.max(6, Math.round(P.s * 0.085));
  const c = tile(P, "seig", R0 * 2, R0, (g, tw, th) => {
    const w = Math.max(1, R0 * 0.085);
    scaleRows(g, R0, tw, th, (x, y) => {
      const rings = [[1, P.fg, 1], [0.76, P.fg2, 0.8], [0.52, P.fg, 1], [0.28, P.fg2, 0.8]];
      for (const [f, col, a] of rings) { g.beginPath(); g.arc(x, y, R0 * f - w * 0.5 - (f === 1 ? w * 0.4 : 0), 0, TAU); g.lineWidth = w; g.strokeStyle = rgba(col, a); g.stroke(); }
    });
  });
  fillTile(P, c);
}

function decofan(P) {
  const R0 = Math.max(8, Math.round(P.s * 0.085));
  const c = tile(P, "fan", R0 * 2, R0, (g, tw, th) => {
    const lw = Math.max(1, P.S * 0.0024 * Math.sqrt(P.k));
    scaleRows(g, R0, tw, th, (x, y) => {
      g.lineWidth = lw; g.strokeStyle = rgba(P.fg);
      g.beginPath(); g.arc(x, y, R0 - lw * 1.6, 0, TAU); g.stroke();
      g.beginPath(); g.arc(x, y, R0 - lw * 3.6, 0, TAU); g.lineWidth = lw * 0.6; g.strokeStyle = rgba(P.fg2, 0.8); g.stroke();
      g.beginPath();
      for (let k = 0; k < 28; k++) { const a = (k + 0.5) * TAU / 28, c0 = Math.cos(a), s0 = Math.sin(a); g.moveTo(x + c0 * R0 * 0.2, y + s0 * R0 * 0.2); g.lineTo(x + c0 * (R0 - lw * 5), y + s0 * (R0 - lw * 5)); }
      g.lineWidth = lw * 0.8; g.strokeStyle = rgba(P.fg); g.stroke();
      g.beginPath(); g.arc(x, y, R0 * 0.2, 0, TAU); g.fillStyle = rgba(P.fg); g.fill();
    });
  });
  fillTile(P, c);
}

function quatrefoil(P) {
  const N = Math.max(12, Math.round(P.s * 0.12 / 2) * 2), d = N / 4;
  const c = tile(P, "quatre", N, N, (g) => {
    const lw = Math.max(1, P.S * 0.0026 * Math.sqrt(P.k)), dd = d * 0.98;
    const foil = (x, y, r) => { g.moveTo(x + r, y - r); g.arc(x + r, y, r, -Math.PI / 2, Math.PI / 2); g.arc(x, y + r, r, 0, Math.PI); g.arc(x - r, y, r, Math.PI / 2, Math.PI * 1.5); g.arc(x, y - r, r, Math.PI, TAU); g.closePath(); };
    g.beginPath(); wrap(N, N, (dx, dy) => foil(dx, dy, dd)); g.fillStyle = rgba(P.fg2, 0.13); g.fill();
    g.lineWidth = lw; g.strokeStyle = rgba(P.fg); g.stroke();
    g.beginPath(); wrap(N, N, (dx, dy) => foil(dx, dy, dd * 0.55)); g.lineWidth = lw * 0.7; g.stroke();
    const k = d * 0.36; g.beginPath(); poly(g, [N / 2, N / 2 - k, N / 2 + k, N / 2, N / 2, N / 2 + k, N / 2 - k, N / 2]); g.fillStyle = rgba(P.fg); g.fill();
  });
  fillTile(P, c, -N / 2, -N / 2);
}

function honeycomb(P) {
  const a = Math.max(4, P.s * 0.055), tw = Math.round(a * 3), th = Math.round(a * Math.sqrt(3));
  const c = tile(P, "hex", tw, th, (g) => {
    const ax = tw / 3, hy = th / 2, lw = Math.max(1, P.S * 0.0028 * Math.sqrt(P.k));
    const hex = (x, y, f) => poly(g, [x + ax * f, y, x + ax * f / 2, y + hy * f, x - ax * f / 2, y + hy * f, x - ax * f, y, x - ax * f / 2, y - hy * f, x + ax * f / 2, y - hy * f]);
    g.beginPath(); wrap(tw, th, (dx, dy) => { hex(dx, dy, 1); hex(dx + tw / 2, dy + hy, 1); });
    g.lineWidth = lw; g.lineJoin = "miter"; g.strokeStyle = rgba(P.fg); g.stroke();
    g.beginPath(); wrap(tw, th, (dx, dy) => hex(dx + tw / 2, dy + hy, 0.5)); g.fillStyle = rgba(P.fg2, 0.2); g.fill();
  });
  fillTile(P, c);
}

function triangles(P) {
  const g = P.g, h = Math.max(4, P.s * 0.085), e = h * 2 / Math.sqrt(3), R = P.R, inset = Math.max(0.5, P.S * 0.0012);
  const bins = [[null], [P.fg, 0.2], [P.fg, 0.45], [P.fg2, 0.45], [P.fg, 0.85]], cut = [0.34, 0.6, 0.8, 0.9, 1];
  const paths = bins.map(() => new Path2D());
  const nj = Math.ceil(R / h) + 1, ni = Math.ceil(R / (e / 2)) + 2;
  for (let j = -nj; j < nj; j++) for (let i = -ni; i < ni; i++) {
    const v = hash3(i, j, P.seed); let b = 0; while (v > cut[b]) b++;
    if (!b || !P.vis((i + 1) * e / 2, (j + 0.5) * h, h * 1.5)) continue;
    const up = ((i + j) & 1) === 0;
    const pts = up ? [i * e / 2, (j + 1) * h, (i + 2) * e / 2, (j + 1) * h, (i + 1) * e / 2, j * h]
                   : [i * e / 2, j * h, (i + 2) * e / 2, j * h, (i + 1) * e / 2, (j + 1) * h];
    const cx = (pts[0] + pts[2] + pts[4]) / 3, cy = (pts[1] + pts[3] + pts[5]) / 3, f = 1 - inset * 3 / h;
    for (let k = 0; k < 6; k += 2) { pts[k] = cx + (pts[k] - cx) * f; pts[k + 1] = cy + (pts[k + 1] - cy) * f; }
    const p = paths[b]; p.moveTo(pts[0], pts[1]); p.lineTo(pts[2], pts[3]); p.lineTo(pts[4], pts[5]); p.closePath();
  }
  for (let b = 1; b < bins.length; b++) { g.fillStyle = rgba(bins[b][0], bins[b][1]); g.fill(paths[b]); }
}

function brick(P) {
  const g = P.g, L = Math.max(8, Math.round(P.s * 0.12)), Hh = Math.max(4, Math.round(L * 0.4)), gap = Math.max(1, Math.round(P.S * 0.0035 * Math.sqrt(P.k)));
  const R = P.R, nj = Math.ceil(R / Hh) + 1, ni = Math.ceil(R / L) + 2;
  const tones = [new Path2D(), new Path2D(), new Path2D(), new Path2D()], al = [0.22, 0.38, 0.55];
  for (let j = -nj; j < nj; j++) for (let i = -ni; i < ni; i++) {
    const x = i * L + ((j & 1) ? Math.round(L / 2) : 0), y = j * Hh, v = hash3(i, j, P.seed);
    if (!P.vis(x + L / 2, y + Hh / 2, L)) continue;
    const t = v < 0.05 ? 3 : v < 0.45 ? 0 : v < 0.8 ? 1 : 2;
    tones[t].rect(x + gap / 2, y + gap / 2, L - gap, Hh - gap);
  }
  for (let t = 0; t < 3; t++) { g.fillStyle = rgba(P.fg, al[t]); g.fill(tones[t]); }
  g.fillStyle = rgba(P.fg, 0.78); g.fill(tones[3]);
}

function plus(P) {
  const p = Math.max(8, Math.round(P.s * 0.1)), a = p * 0.2, t = a * 0.58;
  const c = tile(P, "plus", p, p, (g) => {
    g.fillStyle = rgba(P.fg); g.beginPath();
    g.rect(p / 2 - a, p / 2 - t / 2, a * 2, t); g.rect(p / 2 - t / 2, p / 2 - a, t, a * 2); g.fill();
    const r = p * 0.035; g.fillStyle = rgba(P.fg2, 0.9); g.beginPath();
    wrap(p, p, (dx, dy) => { g.moveTo(dx + r, dy); g.arc(dx, dy, r, 0, TAU); }); g.fill();
  });
  fillTile(P, c, -p / 2, -p / 2);
}

function starPath(g, x, y, r, ri, rot = -Math.PI / 2) {
  for (let k = 0; k < 10; k++) { const rr = k & 1 ? ri : r, a = rot + k * Math.PI / 5; k ? g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  g.closePath();
}
function stars(P) {
  const p = Math.max(10, Math.round(P.s * 0.11));
  const c = tile(P, "stars", p, p, (g) => {
    g.fillStyle = rgba(P.fg); g.beginPath(); starPath(g, p / 2, p / 2 + p * 0.02, p * 0.21, p * 0.21 * 0.4); g.fill();
    g.fillStyle = rgba(P.fg2, 0.85); g.beginPath();
    wrap(p, p, (dx, dy) => starPath(g, dx, dy + p * 0.01, p * 0.085, p * 0.085 * 0.4)); g.fill();
  });
  fillTile(P, c, -p / 2, -p / 2);
}

function memphis(P) {
  const g = P.g, rnd = P.rnd, d = Math.max(10, P.s * 0.095), pts = poisson(rnd, P.hx + d, P.hy + d, d), lw = Math.max(1, P.S * 0.0042 * Math.sqrt(P.k)), z = d * 0.36;
  const A = new Path2D(), B = new Path2D(), F = new Path2D(), F2 = new Path2D();
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i], y = pts[i + 1], t = rnd(), a = rnd() * TAU, c = Math.cos(a), s = Math.sin(a), two = rnd() < 0.4;
    const S = two ? B : A, T = two ? F2 : F;
    if (!P.vis(x, y, d)) continue;
    const at = (u, v) => [x + c * u - s * v, y + s * u + c * v];
    if (t < 0.3) {            // zigzag
      for (let k = 0; k <= 5; k++) { const [px, py] = at(-z + k * z * 0.4, k & 1 ? z * 0.22 : -z * 0.22); k ? S.lineTo(px, py) : S.moveTo(px, py); }
    } else if (t < 0.5) {     // wave
      for (let k = 0; k <= 16; k++) { const u = -z + k * z / 8, [px, py] = at(u, Math.sin(k / 16 * TAU * 1.5) * z * 0.22); k ? S.lineTo(px, py) : S.moveTo(px, py); }
    } else if (t < 0.65) {    // ring
      const r = z * 0.42; S.moveTo(x + r, y); S.arc(x, y, r, 0, TAU);
    } else if (t < 0.78) {    // open triangle
      const r = z * 0.55; for (let k = 0; k < 3; k++) { const [px, py] = at(Math.cos(k * TAU / 3) * r, Math.sin(k * TAU / 3) * r); k ? S.lineTo(px, py) : S.moveTo(px, py); } S.closePath();
    } else if (t < 0.9) {     // dot
      const r = z * 0.2; T.moveTo(x + r, y); T.arc(x, y, r, 0, TAU);
    } else {                  // half disc
      const r = z * 0.38; T.moveTo(x + c * r, y + s * r); T.arc(x, y, r, a, a + Math.PI); T.closePath();
    }
  }
  g.lineWidth = lw; g.lineCap = "round"; g.lineJoin = "round";
  g.strokeStyle = rgba(P.fg); g.stroke(A); g.fillStyle = rgba(P.fg); g.fill(F);
  g.strokeStyle = rgba(P.fg2, 0.9); g.stroke(B); g.fillStyle = rgba(P.fg2, 0.9); g.fill(F2);
}

function terrazzo(P) {
  const g = P.g, rnd = P.rnd, d = Math.max(5, P.s * 0.042), pts = poisson(rnd, P.hx + d, P.hy + d, d, 14);
  const bins = [[P.fg, 0.9], [P.fg, 0.42], [P.fg2, 0.9]], paths = bins.map(() => new Path2D());
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i], y = pts[i + 1];
    if (!P.vis(x, y, d)) continue;
    const rr2 = mulberry32((P.seed * 7919 + i) >>> 0);
    const u = rr2(), r = d * (0.14 + 0.4 * u * u), n = 5 + ((rr2() * 4) | 0), a0 = rr2() * TAU;
    const v = rr2(), b = v < 0.45 ? 0 : v < 0.72 ? 1 : 2, p = paths[b], sq = 0.6 + rr2() * 0.4;
    for (let k = 0; k < n; k++) {
      const a = a0 + (k + (rr2() - 0.5) * 0.5) * TAU / n, rr = r * (0.62 + rr2() * 0.38), px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr * sq;
      k ? p.lineTo(px, py) : p.moveTo(px, py);
    }
    p.closePath();
  }
  bins.forEach(([col, a], i) => { g.fillStyle = rgba(col, a); g.fill(paths[i]); });
}

/* ======================================================================
   ORGANIC / GRAPHIC
   ====================================================================== */
function stainedglass(P) {
  const g = P.g, c = Math.max(8, P.s * 0.15), R = P.R, n = Math.ceil(R / c) + 1, m = n + 2;
  const site = (i, j) => [(i + 0.5 + (hash3(i, j, P.seed) - 0.5) * 0.85) * c, (j + 0.5 + (hash3(i, j, P.seed + 7) - 0.5) * 0.85) * c];
  const sites = new Map();
  const get = (i, j) => { const k = i * 4096 + j; let s = sites.get(k); if (!s) { s = site(i, j); sites.set(k, s); } return s; };
  const darkest = [P.fg, P.fg2, P.bg].reduce((a, b) => lum(b) < lum(a) ? b : a);
  const fills = [[P.fg, 0.85], [P.fg, 0.5], [P.fg, 0.25], [P.fg2, 0.85], [P.fg2, 0.45], [P.bg, 0.55]].filter(f => f[0] !== darkest || f[1] < 0.6);
  const paths = fills.map(() => new Path2D()), lead = new Path2D();
  for (let j = -n; j < n; j++) for (let i = -n; i < n; i++) {
    const [px, py] = get(i, j);
    if (!P.vis(px, py, c * 2)) continue;
    let pts = [px - 3 * c, py - 3 * c, px + 3 * c, py - 3 * c, px + 3 * c, py + 3 * c, px - 3 * c, py + 3 * c];
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      if (!di && !dj) continue;
      const [qx, qy] = get(i + di, j + dj), nx = qx - px, ny = qy - py, mx = (px + qx) / 2, my = (py + qy) / 2;
      const side = (x, y) => (x - mx) * nx + (y - my) * ny, out = [];
      for (let k = 0; k < pts.length; k += 2) {
        const ax = pts[k], ay = pts[k + 1], bx = pts[(k + 2) % pts.length], by = pts[(k + 3) % pts.length];
        const sa = side(ax, ay), sb = side(bx, by);
        if (sa <= 0) out.push(ax, ay);
        if ((sa <= 0) !== (sb <= 0)) { const t = sa / (sa - sb); out.push(ax + (bx - ax) * t, ay + (by - ay) * t); }
      }
      pts = out; if (pts.length < 6) break;
    }
    if (pts.length < 6) continue;
    const v = hash3(i, j, P.seed + 31), p = paths[(v * fills.length) | 0];
    p.moveTo(pts[0], pts[1]); for (let k = 2; k < pts.length; k += 2) p.lineTo(pts[k], pts[k + 1]); p.closePath();
    lead.moveTo(pts[0], pts[1]); for (let k = 2; k < pts.length; k += 2) lead.lineTo(pts[k], pts[k + 1]); lead.closePath();
  }
  fills.forEach(([col, a], i) => { g.fillStyle = rgba(col, a); g.fill(paths[i]); });
  g.lineWidth = Math.max(1.5, P.S * 0.0065 * Math.sqrt(P.k)); g.lineJoin = "round"; g.strokeStyle = rgba(darkest); g.stroke(lead);
}

function spiderweb(P) {
  const g = P.g, rnd = P.rnd, corner = (rnd() * 4) | 0;
  const [x, y] = P.toFrame(P.W * (corner & 1) + (corner & 1 ? -1 : 1) * P.S * (0.04 + rnd() * 0.1), P.H * (corner >> 1) + (corner >> 1 ? -1 : 1) * P.S * (0.04 + rnd() * 0.1));
  const N = 30, spokes = [];
  const a0 = rnd() * TAU;
  for (let i = 0; i < N; i++) spokes.push(a0 + (i + (rnd() - 0.5) * 0.5) * TAU / N);
  const max = Math.hypot(P.R, P.R) * 2.2, gap = Math.max(4, P.s * 0.045);
  g.lineCap = "round";
  g.beginPath();
  for (const a of spokes) { g.moveTo(x, y); g.lineTo(x + Math.cos(a) * max, y + Math.sin(a) * max); }
  g.strokeStyle = rgba(P.fg); g.lineWidth = Math.max(1, P.S * 0.0019); g.stroke();
  const rings = []; let r = gap * 0.8;
  while (r < max) { rings.push(r); r += gap * (0.82 + rnd() * 0.36) * (1 + r / (P.S * 2.5)); }
  const A = new Path2D(), B = new Path2D();
  rings.forEach((r0, k) => {
    const path = k % 7 === 6 ? B : A;
    for (let i = 0; i < N; i++) {
      if (rnd() < 0.025) continue;
      const a1 = spokes[i], a2 = spokes[(i + 1) % N] + (i === N - 1 ? TAU : 0), r1 = r0 * (1 + (hash3(k, i, P.seed) - 0.5) * 0.05), r2 = r0 * (1 + (hash3(k, i + 1 === N ? 0 : i + 1, P.seed) - 0.5) * 0.05);
      const am = (a1 + a2) / 2, rm = (r1 + r2) / 2 * Math.cos((a2 - a1) / 2) * 0.93;
      path.moveTo(x + Math.cos(a1) * r1, y + Math.sin(a1) * r1);
      path.quadraticCurveTo(x + Math.cos(am) * rm, y + Math.sin(am) * rm, x + Math.cos(a2) * r2, y + Math.sin(a2) * r2);
    }
  });
  g.lineWidth = Math.max(1, P.S * 0.0014); g.strokeStyle = rgba(P.fg, 0.9); g.stroke(A);
  g.strokeStyle = rgba(P.fg2, 0.9); g.stroke(B);
}

function flake(path, x, y, r, rot, rnd) {
  const nb = 2 + ((rnd() * 2) | 0), br = [];
  for (let k = 0; k < nb; k++) br.push([0.28 + (k + rnd() * 0.6) * 0.55 / nb, (0.22 + rnd() * 0.2) * (1 - k * 0.18)]);
  const hub = rnd() < 0.5 ? r * (0.12 + rnd() * 0.08) : 0, ang = Math.PI / 3 * (rnd() < 0.7 ? 1 : 0.75);
  for (let a = 0; a < 6; a++) {
    const t = rot + a * TAU / 6, c = Math.cos(t), s = Math.sin(t);
    path.moveTo(x + c * hub, y + s * hub); path.lineTo(x + c * r, y + s * r);
    for (const [f, l] of br) {
      const bx = x + c * r * f, by = y + s * r * f, L = l * r;
      path.moveTo(bx + Math.cos(t + ang) * L, by + Math.sin(t + ang) * L); path.lineTo(bx, by); path.lineTo(bx + Math.cos(t - ang) * L, by + Math.sin(t - ang) * L);
    }
  }
  if (hub) for (let a = 0; a <= 6; a++) { const t = rot + a * TAU / 6; a ? path.lineTo(x + Math.cos(t) * hub, y + Math.sin(t) * hub) : path.moveTo(x + Math.cos(t) * hub, y + Math.sin(t) * hub); }
}
function snowflakes(P) {
  const g = P.g, rnd = P.rnd, d = Math.max(10, P.s * 0.12), pts = poisson(rnd, P.hx + d, P.hy + d, d, 22);
  const big = new Path2D(), small = new Path2D(), dots = new Path2D();
  for (let i = 0; i < pts.length; i += 2) {
    const x = pts[i], y = pts[i + 1], u = rnd(), rf = mulberry32((P.seed * 7919 + i) >>> 0);
    if (!P.vis(x, y, d * 0.5)) continue;
    if (u < 0.22) { const r = d * 0.05; dots.moveTo(x + r, y); dots.arc(x, y, r, 0, TAU); continue; }
    const r = d * (u < 0.55 ? 0.2 + rf() * 0.06 : 0.3 + rf() * 0.14);
    flake(r > d * 0.29 ? big : small, x, y, r, rf() * TAU, rf);
  }
  const lw = Math.max(1, P.S * 0.0028 * Math.sqrt(P.k));
  g.lineCap = "butt"; g.lineJoin = "miter"; g.miterLimit = 3;
  g.lineWidth = lw; g.strokeStyle = rgba(P.fg); g.stroke(big);
  g.lineWidth = lw * 0.8; g.strokeStyle = rgba(P.fg2, 0.85); g.stroke(small);
  g.fillStyle = rgba(P.fg2, 0.85); g.fill(dots);
}

function topo(P) {
  screen(P, (g) => {
    const W = P.W, H = P.H, step = Math.max(3, P.S / 100), nx = Math.ceil(W / step) + 1, ny = Math.ceil(H / step) + 1;
    const noise = perlin(P.seed), fs = P.s * 0.42, ca = Math.cos(-P.ang), sa = Math.sin(-P.ang), cx = P.cx, cy = P.cy;
    const v = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const X = i * step - cx, Y = j * step - cy, x = (X * ca - Y * sa) / fs + 31.7, y = (X * sa + Y * ca) / fs + 17.3;
      v[j * nx + i] = noise(x, y) + 0.5 * noise(x * 2.03 + 5.1, y * 2.03 - 3.7) + 0.22 * noise(x * 4.1 - 9.3, y * 4.1 + 2.2);
    }
    // marching squares; each crossing is keyed by (level, grid edge) so segments can be stitched into
    // continuous polylines and drawn as smooth curves (far cheaper to stroke than loose segments)
    const dl = 0.085, E = nx * ny * 2, keys = [], pos = [], lev = [];
    const HE = (i, j) => (j * nx + i) * 2, VE = (i, j) => (j * nx + i) * 2 + 1;
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = v[j * nx + i], b = v[j * nx + i + 1], c = v[(j + 1) * nx + i + 1], d = v[(j + 1) * nx + i];
      const lo = Math.ceil(Math.min(a, b, c, d) / dl), hi = Math.floor(Math.max(a, b, c, d) / dl);
      if (lo > hi) continue;
      const x0 = i * step, y0 = j * step;
      for (let L = lo; L <= hi; L++) {
        const t = L * dl;
        const idx = (a > t ? 8 : 0) | (b > t ? 4 : 0) | (c > t ? 2 : 0) | (d > t ? 1 : 0);
        if (idx === 0 || idx === 15) continue;
        const base = (L + 1000) * E;
        const T = () => [base + HE(i, j), x0 + step * (t - a) / (b - a), y0], Rt = () => [base + VE(i + 1, j), x0 + step, y0 + step * (t - b) / (c - b)];
        const Bt = () => [base + HE(i, j + 1), x0 + step * (t - d) / (c - d), y0 + step], Lf = () => [base + VE(i, j), x0, y0 + step * (t - a) / (d - a)];
        const seg = (p, q) => { keys.push(p[0], q[0]); pos.push(p[1], p[2], q[1], q[2]); lev.push(L); };
        switch (idx) {
          case 1: case 14: seg(Lf(), Bt()); break;
          case 2: case 13: seg(Bt(), Rt()); break;
          case 3: case 12: seg(Lf(), Rt()); break;
          case 4: case 11: seg(T(), Rt()); break;
          case 6: case 9: seg(T(), Bt()); break;
          case 7: case 8: seg(Lf(), T()); break;
          case 5: seg(Lf(), T()); seg(Bt(), Rt()); break;
          case 10: seg(T(), Rt()); seg(Lf(), Bt()); break;
        }
      }
    }
    const n = lev.length, nbr = new Int32Array(n * 2).fill(-1), first = new Map(), seen = new Uint8Array(n);
    for (let k = 0; k < n * 2; k++) { const o = first.get(keys[k]); if (o === undefined) first.set(keys[k], k); else { nbr[k] = o; nbr[o] = k; } }
    const A = new Path2D(), B = new Path2D();
    for (let s0 = 0; s0 < n; s0++) {
      if (seen[s0]) continue;
      let cur = s0, out = 0, guard = n;
      while (guard--) { const sl = nbr[cur * 2 + out]; if (sl < 0 || (sl >> 1) === s0) break; cur = sl >> 1; out = 1 - (sl & 1); }
      const path = lev[s0] % 5 === 0 ? B : A, xs = [];
      let inE = out; const startSeg = cur;
      xs.push(pos[cur * 4 + inE * 2], pos[cur * 4 + inE * 2 + 1]);
      while (true) {
        seen[cur] = 1; const oe = 1 - inE;
        xs.push(pos[cur * 4 + oe * 2], pos[cur * 4 + oe * 2 + 1]);
        const sl = nbr[cur * 2 + oe]; if (sl < 0) break;
        const nx2 = sl >> 1; if (seen[nx2]) break;
        cur = nx2; inE = sl & 1;
      }
      const closed = nbr[startSeg * 2 + out] >= 0 && (nbr[startSeg * 2 + out] >> 1) === cur && xs.length > 6;
      const m = xs.length;
      if (closed) {
        path.moveTo((xs[0] + xs[2]) / 2, (xs[1] + xs[3]) / 2);
        for (let k = 2; k < m - 2; k += 2) path.quadraticCurveTo(xs[k], xs[k + 1], (xs[k] + xs[k + 2]) / 2, (xs[k + 1] + xs[k + 3]) / 2);
        path.closePath();
      } else {
        path.moveTo(xs[0], xs[1]);
        for (let k = 2; k < m - 2; k += 2) path.quadraticCurveTo(xs[k], xs[k + 1], (xs[k] + xs[k + 2]) / 2, (xs[k + 1] + xs[k + 3]) / 2);
        path.lineTo(xs[m - 2], xs[m - 1]);
      }
    }
    const lw = Math.max(1, P.S * 0.0017);
    g.lineCap = "butt"; g.lineJoin = "miter"; g.miterLimit = 2;   // round joins cost ~5x here
    g.lineWidth = lw; g.strokeStyle = rgba(P.fg); g.stroke(A);
    g.lineWidth = lw * 2; g.strokeStyle = rgba(P.fg2, 0.7); g.stroke(B);
  });
}

/* ======================================================================
   registry
   ====================================================================== */
const DEFS = [
  ["tartan", "Tartan", "fabric", 0.6, tartan],
  ["gingham", "Gingham", "fabric", 0.5, gingham],
  ["houndstooth", "Houndstooth", "fabric", 0.75, houndstooth],
  ["herringbone", "Herringbone", "fabric", 0.45, herringbone],
  ["basketweave", "Basketweave", "fabric", 0.7, basketweave],
  ["checker", "Checkerboard", "check", 0.75, checker],
  ["warpcheck", "Warped check", "check", 0.8, warpcheck],
  ["harlequin", "Harlequin", "check", 0.7, harlequin],
  ["argyle", "Argyle", "check", 0.55, argyle],
  ["polka", "Polka dots", "dots", 0.35, polka],
  ["halftone", "Halftone field", "dots", 0.45, halftone],
  ["confetti", "Confetti", "dots", 0.3, confetti],
  ["pinstripe", "Pinstripe", "lines", 0.2, pinstripe],
  ["diagonal", "Diagonal stripes", "lines", 0.6, diagonal],
  ["chevron", "Chevron", "lines", 0.65, chevron],
  ["opwave", "Op-art waves", "lines", 0.8, opwave],
  ["concentric", "Concentric squares", "lines", 0.4, concentric],
  ["moire", "Moiré rings", "lines", 0.6, moire],
  ["sunburst", "Sunburst", "rays", 0.75, sunburst],
  ["swirl", "Swirl", "rays", 0.8, swirl],
  ["seigaiha", "Seigaiha", "tile", 0.6, seigaiha],
  ["decofan", "Deco fans", "tile", 0.55, decofan],
  ["quatrefoil", "Quatrefoil trellis", "tile", 0.4, quatrefoil],
  ["honeycomb", "Honeycomb", "tile", 0.3, honeycomb],
  ["triangles", "Triangle mosaic", "tile", 0.6, triangles],
  ["brick", "Brick", "tile", 0.45, brick],
  ["plus", "Plus field", "tile", 0.3, plus],
  ["stars", "Star field", "tile", 0.3, stars],
  ["memphis", "Memphis", "tile", 0.35, memphis],
  ["terrazzo", "Terrazzo", "tile", 0.4, terrazzo],
  ["stainedglass", "Stained glass", "organic", 0.85, stainedglass],
  ["spiderweb", "Spiderweb", "organic", 0.3, spiderweb],
  ["snowflakes", "Snowflakes", "organic", 0.35, snowflakes],
  ["topo", "Contours", "organic", 0.35, topo],
];
const BY_ID = {}; const LIST = [];
for (const [id, name, family, busy, fn] of DEFS) { BY_ID[id] = fn; LIST.push({ id, name, family, busy }); }

const normCol = (c, d) => Array.isArray(c) && c.length >= 3 ? [c[0] | 0, c[1] | 0, c[2] | 0] : d;

function renderLayer(W, H, id, S, scale, angle, fg, fg2, bg, seed) {
  const pi = pool.findIndex(c => c.width === W && c.height === H);
  const layer = pi >= 0 ? pool.splice(pi, 1)[0] : makeCanvas(W, H), g = layer.getContext("2d");
  g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, W, H); g.globalAlpha = 1; g.globalCompositeOperation = "source-over";
  const cx = Math.round(W / 2), cy = Math.round(H / 2), ang = angle * Math.PI / 180;
  const R = Math.ceil(Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy))) + 2;
  const ca = Math.cos(-ang), sa = Math.sin(-ang), cb = Math.cos(ang), sb = Math.sin(ang);
  g.translate(cx, cy); if (ang) g.rotate(ang);
  const P = {
    hx: (W * Math.abs(cb) + H * Math.abs(sb)) / 2 + 2, hy: (W * Math.abs(sb) + H * Math.abs(cb)) / 2 + 2,
    g, W, H, S, scale, k: scale / 100, s: S * scale / 100, R, ang, cx, cy, fg, fg2, bg, seed, id,
    rnd: (() => { const r = mulberry32(hashStr(id + "#" + seed)); r(); r(); return r; })(),
    tkey: [id, S, scale, fg, fg2, bg, seed].join("|"),
    vis: (x, y, m) => { const X = x * cb - y * sb + cx, Y = x * sb + y * cb + cy; return X > -m && X < W + m && Y > -m && Y < H + m; },
    toFrame: (x, y) => { const dx = x - cx, dy = y - cy; return [dx * ca - dy * sa, dx * sa + dy * ca]; },
  };
  g.save(); BY_ID[id](P); g.restore();
  return layer;
}

function draw(ctx, W, H, id, o = {}) {
  if (!BY_ID[id]) return;
  W = Math.ceil(W); H = Math.ceil(H); if (!(W > 0 && H > 0)) return;
  const alpha = clamp(o.alpha == null ? 1 : +o.alpha, 0, 1); if (alpha <= 0) return;
  const S = +o.S > 0 ? +o.S : Math.min(W, H), scale = clamp(+o.scale || 100, 20, 400), angle = +o.angle || 0;
  const fg = normCol(o.fg, [0, 0, 0]), fg2 = normCol(o.fg2, fg), bg = normCol(o.bg, [255, 255, 255]), seed = (o.seed | 0) >>> 0;
  const key = [id, W, H, S, scale, angle, fg, fg2, bg, seed].join("|");
  let layer = layerCache.get(key);
  if (!layer) { layer = renderLayer(W, H, id, S, scale, angle, fg, fg2, bg, seed); layerCache.set(key, layer); }
  ctx.save(); ctx.globalAlpha = alpha; ctx.drawImage(layer, 0, 0, W, H); ctx.restore();
}

window.Patterns = { LIST, draw, FAMILIES: ["fabric", "check", "dots", "lines", "rays", "tile", "organic"], clearCache() { layerCache.clear(); tileCache.clear(); } };
})();
