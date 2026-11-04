/* Sleeve Press: procedural pattern library.
   Patterns.LIST  -> [{ id, name, family, busy }]   busy 0..1 = how loud it is at scale 100 / alpha 0.5
   Patterns.draw(ctx, W, H, id, o)
     o = { S, scale (percent), angle (deg), fg [r,g,b], fg2 [r,g,b], bg [r,g,b], alpha 0..1, seed,
           unclipped (true when ctx has no clip: lets a plain tiled pattern skip its layer) }
   Every pattern works in the sleeve's 3-colour world: fg, fg2 and (for knockouts) bg, tinted only by alpha.
   Each pattern is drawn once at full strength into an offscreen layer (cached on every input but alpha),
   then laid over the caller's canvas at `alpha`, so overlaps inside a pattern never double up. An unrotated
   pattern that is one tile fill skips the layer and lays its tile straight on (same pixels, see direct). */
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

/* ---------- memory ----------
   iOS Safari caps the total memory of all canvases on the page, and phones with little memory run out early, so
   there the caches are kept small and big canvases are let go as soon as a render is done. */
const LOW_MEMORY = (() => {
  try {
    const n = navigator, ios = /iP(hone|od|ad)/.test(n.userAgent) || (n.platform === "MacIntel" && n.maxTouchPoints > 1);
    return ios || (n.deviceMemory > 0 && n.deviceMemory <= 4);
  } catch (e) { return false; }
})();
/* Frees a canvas's pixels right away (Safari otherwise keeps them until the canvas is garbage collected). */
function release(c) { if (c && c.width) { c.width = 0; c.height = 0; } }

/* ---------- small LRU keyed by string, budgeted in pixels ----------
   The newest entry stays even when it alone is over budget (it is in use); trim() then lets it go too. */
function LRU(budget) {
  const m = new Map(); let used = 0;
  const px = (c) => c.width * c.height;
  const evict = (keep) => { while (used > budget && m.size > keep) { const [k0, v0] = m.entries().next().value; m.delete(k0); used -= px(v0); release(v0); } };
  return {
    get(k) { const v = m.get(k); if (v !== undefined) { m.delete(k); m.set(k, v); } return v; },
    set(k, v) {
      if (m.has(k)) { const old = m.get(k); used -= px(old); m.delete(k); if (old !== v) release(old); }
      m.set(k, v); used += px(v);
      evict(1);
    },
    trim() { evict(0); },
    clear() { for (const v of m.values()) release(v); m.clear(); used = 0; },
    get used() { return used; },
  };
}
// Layers are only cached for rotated or multi-pass patterns (see draw); tiles for every tiled pattern.
const layerCache = LRU(LOW_MEMORY ? 4e6 : 16e6);   // desktop: ~11 layers at 1200², 1 at 3000²
const tileCache = LRU(LOW_MEMORY ? 2e6 : 8e6);    // low: preview-sized tiles (<1 Mpx) stay, export-sized ones go

/* ---------- helpers ---------- */
/* A cached tile; fn(g, tw, th) draws it. fn may be a generator (a build in steps): run straight through here, or,
   while a pattern is being prepared in steps (P.later), handed back unbuilt and finished by steps(). */
function tile(P, name, tw, th, fn) {
  tw = Math.max(2, Math.round(tw)); th = Math.max(2, Math.round(th));
  const key = P.tkey + "|" + name + "|" + tw + "x" + th;
  let c = tileCache.get(key);
  if (!c) {
    c = makeCanvas(tw, th);
    const run = fn(c.getContext("2d"), tw, th);
    if (run && typeof run.next === "function") {
      if (P.later) { P.later.push({ key, c, run }); return c; }
      while (!run.next().done);
    }
    tileCache.set(key, c);
  }
  return c;
}
function fillTile(P, c, ox = 0, oy = 0) {
  if (P.fills) { P.fills.push([c, ox, oy]); return; }   // planning a direct fill (see draw)
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
    release(warp); release(weft); release(m);
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
   INK ROLES for the woven, camo and animal families.
   Each role is [r, g, b, alpha, knockout]. Everything is fg, fg2 or ground, or a blend of them:
     G ground (nothing)   A/a/h/q fg at full/mid/light/faint   B/b fg2 full/light   M fg+fg2 mixed
     D the darker of (fg2, ground)  L the lighter one  (a knockout when that is the ground itself)
     d/l halfway from A towards D/L.   T/U light/strong animal coat (stronger when D is a knockout).
   So a "black" bar on a dark sleeve is cut back to the ground, and on a light one it is printed in the dark ink.
   ====================================================================== */
function inks(P) {
  if (P._inks) return P._inks;
  const fg = P.fg, fg2 = P.fg2, bg = P.bg;
  const same = Math.abs(fg[0] - fg2[0]) + Math.abs(fg[1] - fg2[1]) + Math.abs(fg[2] - fg2[2]) < 48;
  const KO = [0, 0, 0, 0, 1], C = (c, a) => [c[0], c[1], c[2], a, 0];
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, 1, 0];
  const ref = same ? fg : fg2, darkG = lum(bg) <= lum(ref);
  const k = same ? 0.62 : 1;   // one ink only: keep fg itself for D/L and print the "main" colour as a tint
  const D = darkG ? KO : C(ref, 1), L = darkG ? C(ref, 1) : KO;
  return (P._inks = {
    G: [0, 0, 0, 0, 0], K: KO,
    A: C(fg, k), a: C(fg, k * 0.55), h: C(fg, k * 0.3), q: C(fg, k * 0.14),
    B: C(fg2, 1), b: C(fg2, same ? 0.42 : 0.5),
    M: same ? C(fg, 0.82) : mix(fg, fg2, 0.5),
    D, L,
    d: D[4] ? C(fg, k * 0.4) : mix(fg, D, 0.55),
    // animal coats: when the dark markings are cut back to a dark ground, the coat has to carry more ink
    T: D[4] ? C(fg, k * 0.62) : C(fg, k * 0.3), U: D[4] ? C(fg, k * 0.9) : C(fg, k * 0.55),
    e: D[4] ? [0, 0, 0, 0.45, 1] : mix(fg, D, 0.45),   // "a shade darker": a partial knockout on dark grounds (vector/field families only)
    l: L[4] ? C(fg, k * 0.4) : mix(fg, L, 0.55),
  });
}
/* fill a path in a role (knockouts cut the layer back to the ground) */
function inkFill(g, role, path) {
  g.save();
  if (role[4]) { g.globalCompositeOperation = "destination-out"; g.fillStyle = "#000"; g.globalAlpha = role[3] || 1; }
  else g.fillStyle = rgba(role, role[3]);
  g.fill(path); g.restore();
}

/* ======================================================================
   PLAID: a woven-sett engine.
   A sett is a threadcount ("A24 D4 A4 ...", role letter + threads). Warp threads run down, weft across;
   at every thread crossing the weave decides which one is on top (2/2 twill, or plain 1/1), so where a
   stripe crosses a different stripe the two colours interleave into the diagonal twill mix of real cloth.
   ====================================================================== */
function sett(P, name, o) {
  const R = inks(P);
  const parse = (s) => s.trim().split(/\s+/).map(tk => [tk[0], +tk.slice(1)]);
  const full = (s) => { const h = parse(s); return o.sym === false ? h : h.concat(h.slice(1, -1).reverse()); };
  const per = o.weave === "plain" ? 2 : 4;
  const target = P.s * (o.size || 0.36);
  const fit = (bands, t) => {
    if (o.exact) return bands.map(b => [b[0], b[1]]);
    const sum = bands.reduce((a, b) => a + b[1], 0), f = target / t / sum;
    const out = bands.map(([c, w]) => [c, Math.max(w <= 3 ? 1 : 2, Math.round(w * f))]);
    const tot = out.reduce((a, b) => a + b[1], 0);
    let big = 0; out.forEach((b, i) => { if (b[1] > out[big][1]) big = i; });
    out[big][1] += (per - tot % per) % per;
    return out;
  };
  let wa = full(o.sett), we = o.weft ? full(o.weft) : wa;
  const t = o.exact ? Math.max(1, Math.round(target / wa.reduce((a, b) => a + b[1], 0))) : Math.max(1, Math.round(P.S * 0.0022 * Math.sqrt(P.k)));
  wa = fit(wa, t); we = o.weft ? fit(we, t) : wa;
  const threads = (b) => { const r = []; for (const [c, w] of b) for (let i = 0; i < w; i++) r.push(c); return r; };
  const tw = threads(wa), tf = threads(we), W = tw.length * t, H = tf.length * t;
  const tex = o.tex == null ? 0.16 : o.tex, fz = o.fuzz || 0;
  const pack = (c, m) => { const a = Math.round(c[3] * m * 255); return a ? ((a << 24) | (Math.round(c[2]) << 16) | (Math.round(c[1]) << 8) | Math.round(c[0])) >>> 0 : 0; };
  const c = tile(P, name, W, H, (g) => {
    const img = g.createImageData(W, H), u32 = new Uint32Array(img.data.buffer);
    const col = (r) => { const c = R[r] || R.G; return c[4] ? R.G : c; };   // knockouts are simply bare ground in cloth
    const pw = tw.map(r => pack(col(r), 1)), pf = tf.map(r => pack(col(r), 1 - tex));
    const mask = per === 4 ? 3 : 1, lim = per === 4 ? 2 : 1;
    for (let y = 0; y < H; y++) {
      const j = (y / t) | 0, wf = pf[j], row = y * W;
      for (let x = 0; x < W; x++) { const i = (x / t) | 0; u32[row + x] = ((i + j) & mask) < lim ? pw[i] : wf; }
    }
    if (fz) {   // brushed flannel: thread-level speckle
      const d = img.data;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const p = (y * W + x) * 4 + 3; if (!d[p]) continue;
        d[p] = d[p] * (1 - fz * hash3(x, y, 77)) | 0;
      }
    }
    g.putImageData(img, 0, 0);
  });
  fillTile(P, c, -W / 2, -H / 2);
}
const PLAIDS = {
  buffalo: { sett: "A24 D24", sym: false, size: 0.3, tex: 0.1 },
  // B22 K2 B2 K2 B2 K16 G16 K2 G16 K16 B16 K2  (navy -> mixed, green -> mid, black -> dark)
  blackwatch: { sett: "d22 D3 d3 D3 d3 D16 b18 D3 b18 D16 d16 D3", size: 0.5 },
  // R72 B8 K12 Y2 K2 W2 K2 G16 R8 K2 R4 W2
  stewart: { sett: "A72 M8 D12 B2 D2 L2 D2 d16 A8 D2 A4 L2", size: 0.5 },
  dressgordon: { sett: "G26 D3 G3 D3 G3 D16 a18 B3 a18 D16 A18 D3", size: 0.42 },
  madras: { sett: "A10 G2 B6 M2 a8 G3 h10 B2 A3 G2 b8 M5 a3 G6 A2 h6", weft: "h8 A3 G2 M8 b3 A12 G2 B4 a6 G4 h3 M2 A6 b6", sym: false, size: 0.34, weave: "plain", tex: 0.22 },
  windowpane: { sett: "q46 A3", sym: false, size: 0.3, tex: 0.3 },
  tattersall: { sett: "G12 A2 G12 B2", sym: false, size: 0.2, tex: 0.1 },
  flannel: { sett: "A20 D4 A2 D4 A2 D14 L2 D14 d12", size: 0.36, fuzz: 0.35 },
  heritage: { sett: "h44 D6 h6 D6 h6 D6 h24 L4 h20 A3", size: 0.44 },
  shepherd: { sett: "D8 L8", sym: false, exact: true, size: 0.07 },
  glen: (() => {   // Prince of Wales: 4-and-4 blocks beside 2-and-2 blocks, with an overcheck
    const s = []; for (let i = 0; i < 6; i++) s.push("D4", "L4");
    for (let i = 0; i < 9; i++) s.push("D2", i === 4 ? "A2" : "L2");
    return { sett: s.join(" "), sym: false, exact: true, size: 0.5 };
  })(),
};
const plaid = (key) => (P) => sett(P, key, PLAIDS[key]);

/* ======================================================================
   FIELD TILES: periodic noise / distance fields on a grid, rasterised per pixel with
   analytic anti-aliasing (|gradient| gives each edge a 1px ramp), composited in ink roles.
   ====================================================================== */
function pnoise(seed) {
  const rnd = mulberry32(seed), perm = new Uint8Array(512), gx = new Float32Array(256), gy = new Float32Array(256);
  const a = new Uint8Array(256); for (let i = 0; i < 256; i++) a[i] = i;
  for (let i = 255; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; const t = a[i]; a[i] = a[j]; a[j] = t; }
  for (let i = 0; i < 512; i++) perm[i] = a[i & 255];
  for (let i = 0; i < 256; i++) { const t = rnd() * TAU; gx[i] = Math.cos(t); gy[i] = Math.sin(t); }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return function (x, y, px, py) {   // periodic in x with period px, y with py (integers)
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const X0 = ((xi % px) + px) % px, Y0 = ((yi % py) + py) % py, X1 = (X0 + 1) % px, Y1 = (Y0 + 1) % py;
    const h00 = perm[perm[X0] + Y0], h10 = perm[perm[X1] + Y0], h01 = perm[perm[X0] + Y1], h11 = perm[perm[X1] + Y1];
    const n00 = gx[h00] * xf + gy[h00] * yf, n10 = gx[h10] * (xf - 1) + gy[h10] * yf;
    const n01 = gx[h01] * xf + gy[h01] * (yf - 1), n11 = gx[h11] * (xf - 1) + gy[h11] * (yf - 1);
    const u = fade(xf), v = fade(yf), x1 = n00 + u * (n10 - n00), x2 = n01 + u * (n11 - n01);
    return (x1 + v * (x2 - x1)) * 1.3;
  };
}
/* fbm on an n×n periodic grid. o = { px, py (lattice periods across the tile), oct, gain, ridge, warp, wpx }.
   Each octave is evaluated at ~6 samples per lattice cell and upsampled, and the warp is a resample, so the
   cost hardly depends on n. */
function upsample(src, rx, ry, n, out, amp) {   // periodic bilinear, accumulates amp * src into out (n×n)
  // the column lookups are the same on every row: work them out once
  const X0 = new Int32Array(n), X1 = new Int32Array(n), FX = new Float64Array(n);
  for (let i = 0; i < n; i++) { const gx = i * rx / n, x0 = gx | 0; X0[i] = x0; X1[i] = (x0 + 1) % rx; FX[i] = gx - x0; }
  for (let j = 0; j < n; j++) {
    const gy = j * ry / n, y0 = gy | 0, fy = gy - y0, r0 = y0 * rx, r1 = ((y0 + 1) % ry) * rx, row = j * n;
    for (let i = 0; i < n; i++) {
      const x0 = X0[i], x1 = X1[i], fx = FX[i];
      const a = src[r0 + x0], b = src[r0 + x1], c = src[r1 + x0], d = src[r1 + x1];
      out[row + i] += amp * (a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy);
    }
  }
}
function noiseLayer(nz, fx, fy, n, per, ridge, ox = 0, oy = 0) {
  const rx = Math.min(n, Math.ceil(fx * per)), ry = Math.min(n, Math.ceil(fy * per)), g = new Float32Array(rx * ry);
  for (let j = 0; j < ry; j++) for (let i = 0; i < rx; i++) { let r = nz(i * fx / rx + ox, j * fy / ry + oy, fx, fy); if (ridge) r = 0.5 - Math.abs(r); g[j * rx + i] = r; }
  return [g, rx, ry];
}
function fbmGrid(n, seed, o) {
  const nz = pnoise(seed), F = new Float32Array(n * n);
  const oct = o.oct || 4, gain = o.gain || 0.5, per = o.ridge ? 7 : 5;
  let amp = 1, norm = 0, fx = o.px, fy = o.py || o.px;
  for (let k = 0; k < oct && (k < 2 || Math.max(fx, fy) * 2.5 <= n); k++) { const [g, rx, ry] = noiseLayer(nz, fx, fy, n, per, o.ridge, k * 13.7, k * 7.1); upsample(g, rx, ry, n, F, amp); norm += amp; amp *= gain; fx *= 2; fy *= 2; }
  for (let i = 0; i < F.length; i++) F[i] /= norm;
  if (!o.warp) return F;
  const nw = pnoise(seed ^ 0x5bd1e995), wp = o.wpx || 2, du = new Float32Array(n * n), dv = new Float32Array(n * n);
  { const [g, rx, ry] = noiseLayer(nw, wp, wp, n, 6, 0); upsample(g, rx, ry, n, du, o.warp * n); }
  { const [g, rx, ry] = noiseLayer(nw, wp, wp, n, 6, 0, 31.3, 7.7); upsample(g, rx, ry, n, dv, o.warp * n); }
  const W = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i, gx = i + du[k] + n * 4, gy = j + dv[k] + n * 4, x0 = Math.floor(gx), y0 = Math.floor(gy), fx2 = gx - x0, fy2 = gy - y0;
    const X0 = x0 % n, X1 = (x0 + 1) % n, Y0 = (y0 % n) * n, Y1 = ((y0 + 1) % n) * n;
    const a = F[Y0 + X0], b = F[Y0 + X1], c = F[Y1 + X0], d = F[Y1 + X1];
    W[k] = a + (b - a) * fx2 + (c - a) * fy2 + (a - b - c + d) * fx2 * fy2;
  }
  return W;
}
/* Path builder that writes SVG path data (integer tenths, cheap to format) and makes one Path2D at
   the end, for motifs built once and reused; draw the result scaled by 1/10. */
const f2 = (v) => Math.round(v * 10);
function PathStr() { this.d = []; }
PathStr.prototype.moveTo = function (x, y) { this.d.push("M" + f2(x) + " " + f2(y)); };
PathStr.prototype.lineTo = function (x, y) { this.d.push("L" + f2(x) + " " + f2(y)); };
PathStr.prototype.quadraticCurveTo = function (a, b, x, y) { this.d.push("Q" + f2(a) + " " + f2(b) + " " + f2(x) + " " + f2(y)); };
PathStr.prototype.closePath = function () { this.d.push("Z"); };
PathStr.prototype.done = function () { return new Path2D(this.d.join("")); };

/* Closed outlines of { F > th } for an n×n periodic grid over a T×T tile, as one smoothed Path2D.
   Oriented marching squares; the grid is read 2 nodes past each edge (wrapped) and walled off beyond
   that, so every loop closes outside the tile while everything inside it matches across the seam. */
function contour(F, n, T, th) {
  const E = 2, lo = -E - 1, hi = n + E + 1, w = hi - lo + 1, cs = T / n;
  const V = new Float32Array(w * w), wr = new Int32Array(w);
  for (let i = lo; i <= hi; i++) wr[i - lo] = ((i % n) + n) % n;
  for (let j = lo; j <= hi; j++) {
    const row = (j - lo) * w, src = wr[j - lo] * n, edge = j === lo || j === hi;
    for (let i = lo; i <= hi; i++) V[row + i - lo] = (edge || i === lo || i === hi) ? -1e9 : F[src + wr[i - lo]] - th;
  }
  const sx = [], sy = [], sk = [], ek = [], start = new Int32Array(w * w * 2).fill(-1), cx = [0, 0, 0, 0], cy = [0, 0, 0, 0], ck = [0, 0, 0, 0], ct = [0, 0, 0, 0];
  for (let j = 0; j < w - 1; j++) for (let i = 0; i < w - 1; i++) {
    const a = V[j * w + i], b = V[j * w + i + 1], c = V[(j + 1) * w + i + 1], d = V[(j + 1) * w + i];
    const m = (a > 0 ? 1 : 0) | (b > 0 ? 2 : 0) | (c > 0 ? 4 : 0) | (d > 0 ? 8 : 0);
    if (m === 0 || m === 15) continue;
    const x0 = (i + lo) * cs, y0 = (j + lo) * cs; let k = 0;
    // edges clockwise: top (a->b), right (b->c), bottom (c->d), left (d->a); crossing type 1 = leaving the inside
    if ((a > 0) !== (b > 0)) { const t = a / (a - b); cx[k] = x0 + t * cs; cy[k] = y0; ck[k] = (j * w + i) * 2; ct[k++] = a > 0; }
    if ((b > 0) !== (c > 0)) { const t = b / (b - c); cx[k] = x0 + cs; cy[k] = y0 + t * cs; ck[k] = (j * w + i + 1) * 2 + 1; ct[k++] = b > 0; }
    if ((c > 0) !== (d > 0)) { const t = c / (c - d); cx[k] = x0 + cs - t * cs; cy[k] = y0 + cs; ck[k] = ((j + 1) * w + i) * 2; ct[k++] = c > 0; }
    if ((d > 0) !== (a > 0)) { const t = d / (d - a); cx[k] = x0; cy[k] = y0 + cs - t * cs; ck[k] = (j * w + i) * 2 + 1; ct[k++] = d > 0; }
    const join = k === 4 && (a + b + c + d) > 0;
    for (let q = 0; q < k; q++) if (ct[q]) {
      const r = join || k === 2 ? (q + 1) % k : (q + k - 1) % k;
      start[ck[q]] = sx.length; sx.push(cx[q]); sy.push(cy[q]); sk.push(ck[q]); ek.push(ck[r]);
    }
  }
  const path = new Path2D(), seen = new Uint8Array(sx.length), xs = [], ys = [];
  for (let s0 = 0; s0 < sx.length; s0++) {
    if (seen[s0]) continue;
    xs.length = ys.length = 0; let s = s0;
    while (s >= 0 && !seen[s]) { seen[s] = 1; xs.push(sx[s]); ys.push(sy[s]); s = start[ek[s]]; }
    const L = xs.length; if (L < 3) continue;
    path.moveTo((xs[L - 1] + xs[0]) / 2, (ys[L - 1] + ys[0]) / 2);
    for (let q = 0; q < L; q++) { const r = q + 1 === L ? 0 : q + 1; path.quadraticCurveTo(xs[q], ys[q], (xs[q] + xs[r]) / 2, (ys[q] + ys[r]) / 2); }
    path.closePath();
  }
  return path;
}
/* A tile built from scalar fields on a periodic grid (gridStep px apart).
   build(n, R) -> { fields: [Float32Array n*n, or a function making one], layers: [{ f (-1 = solid), th, ink }] } ;
   after(g, T, R) draws extras on top. */
function fieldTile(P, name, T, gridStep, build, after) {
  T = Math.max(8, Math.round(T));
  const n = clamp(Math.round(T / gridStep), Math.min(48, T >> 1), 240);
  // built in steps (a field, or a layer, at a time) so a big render can pause in between; see tile()
  return tile(P, name, T, T, function* (g) {
    const R = inks(P), { fields, layers } = build(n, R);
    for (let i = 0; i < fields.length; i++) if (typeof fields[i] === "function") { fields[i] = fields[i](); yield; }
    for (const ly of layers) {
      if (ly.f < 0) { g.save(); if (ly.ink[4]) { g.globalCompositeOperation = "destination-out"; g.fillStyle = "#000"; } else g.fillStyle = rgba(ly.ink, ly.ink[3]); g.fillRect(0, 0, T, T); g.restore(); continue; }
      inkFill(g, ly.ink, contour(fields[ly.f], n, T, ly.th));
      yield;
    }
    if (after) after(g, T, R);
  });
}
/* stripes as a continuous field: >0 inside a stripe of width w (in phase units) centred on whole phases */
const stripeVal = (phase, w) => { const f = phase - Math.floor(phase); return w / 2 - Math.min(f, 1 - f); };
const seedOf = (P, k = 0) => (hashStr(P.id + ":" + k) ^ Math.imul(P.seed + 1, 2654435761)) >>> 0;

/* ---------- vector motifs on a tile ---------- */
/* emit fn(dx, dy) for each tile-wrapped copy of a motif of radius r at (x, y) that touches the tile */
function wrapAt(T, x, y, r, f) {
  for (const dy of [-T, 0, T]) { if (y + dy + r < 0 || y + dy - r > T) continue;
    for (const dx of [-T, 0, T]) { if (x + dx + r < 0 || x + dx - r > T) continue; f(dx, dy); } }
}
function blobPts(rnd, r, k, jit, sx = 1, sy = 1, rot = 0) {
  const pts = [], c = Math.cos(rot), s = Math.sin(rot);
  for (let i = 0; i < k; i++) {
    const a = (i + (rnd() - 0.5) * 0.5) * TAU / k, rr = r * (1 - jit / 2 + rnd() * jit), u = Math.cos(a) * rr * sx, v = Math.sin(a) * rr * sy;
    pts.push(u * c - v * s, u * s + v * c);
  }
  return pts;
}
/* smooth closed curve through midpoints */
function smoothPath(path, pts, x, y) {
  const n = pts.length;
  path.moveTo(x + (pts[n - 2] + pts[0]) / 2, y + (pts[n - 1] + pts[1]) / 2);
  for (let i = 0; i < n; i += 2) { const j = (i + 2) % n; path.quadraticCurveTo(x + pts[i], y + pts[i + 1], x + (pts[i] + pts[j]) / 2, y + (pts[i + 1] + pts[j + 1]) / 2); }
  path.closePath();
}
/* jittered points on an m×m periodic lattice of a T tile */
function jitter(m, T, seed, j = 0.8) {
  const pts = [], c = T / m;
  for (let y = 0; y < m; y++) for (let x = 0; x < m; x++)
    pts.push((x + 0.5 + (hash3(x, y, seed) - 0.5) * j) * c, (y + 0.5 + (hash3(x, y, seed + 1) - 0.5) * j) * c, hash3(x, y, seed + 2), hash3(x, y, seed + 3));
  return pts;   // x, y, u, v
}

/* ======================================================================
   CAMO
   ====================================================================== */
function camoWoodland(P) {
  const s0 = seedOf(P), T = P.s * 0.72;
  const c = fieldTile(P, "wood", T, 9, (n, R) => ({
    fields: [
      () => fbmGrid(n, s0, { px: 3, py: 4, oct: 4, warp: 0.08 }),
      () => fbmGrid(n, s0 + 1, { px: 3, py: 5, oct: 4, warp: 0.1 }),
      () => fbmGrid(n, s0 + 2, { px: 4, py: 6, oct: 4, warp: 0.12 }),
      () => fbmGrid(n, s0 + 3, { px: 4, py: 7, oct: 3, ridge: 1, warp: 0.15 }),
    ],
    layers: [{ f: 0, th: -0.05, ink: R.h }, { f: 1, th: 0.1, ink: R.a }, { f: 2, th: 0.16, ink: R.A }, { f: 3, th: 0.43, ink: R.D }],
  }));
  fillTile(P, c);
}
function camoDesert(P) {
  const s0 = seedOf(P), T = P.s * 0.8;
  const c = fieldTile(P, "desert", T, 10, (n, R) => ({
    fields: [() => fbmGrid(n, s0, { px: 2, py: 3, oct: 3, gain: 0.4, warp: 0.12 }), () => fbmGrid(n, s0 + 1, { px: 3, py: 4, oct: 3, gain: 0.4, warp: 0.12 })],
    layers: [{ f: 0, th: -0.08, ink: R.h }, { f: 1, th: 0.12, ink: R.a }],
  }), (g, T, R) => {   // chocolate-chip rocks: dark pebbles with a light chip beside each
    const pts = jitter(9, T, s0 + 9, 0.9), dark = new Path2D(), lite = new Path2D(), r0 = T * 0.012;
    for (let i = 0; i < pts.length; i += 4) {
      const rf = mulberry32(s0 + i), r = r0 * (0.7 + pts[i + 2] * 0.9), x = pts[i], y = pts[i + 1];
      const pd = blobPts(rf, r, 6, 0.5, 1.3, 0.85, rf() * TAU), pl = blobPts(rf, r * 0.7, 6, 0.5, 1.2, 0.8, rf() * TAU);
      const a = rf() * TAU, ox = Math.cos(a) * r * 1.6, oy = Math.sin(a) * r * 1.6;
      wrapAt(T, x, y, r * 3, (dx, dy) => { smoothPath(dark, pd, x + dx, y + dy); smoothPath(lite, pl, x + dx + ox, y + dy + oy); });
      if (pts[i + 3] < 0.45) { const pd2 = blobPts(rf, r * 0.6, 6, 0.5), x2 = x - ox * 0.9 + oy, y2 = y - oy * 0.9 - ox; wrapAt(T, x2, y2, r, (dx, dy) => smoothPath(dark, pd2, x2 + dx, y2 + dy)); }
    }
    inkFill(g, R.L, lite); inkFill(g, R.D, dark);
  });
  fillTile(P, c);
}
function camoDigital(P) {
  const s0 = seedOf(P), px = Math.max(2, Math.round(P.s * 0.011)), m = clamp(Math.round(P.s * 0.6 / px), 24, 200), T = m * px;
  const c = tile(P, "digi", T, T, (g) => {
    const R = inks(P), n = m;
    const f1 = fbmGrid(n, s0, { px: 3, py: 4, oct: 5, gain: 0.55, warp: 0.1 }), f2 = fbmGrid(n, s0 + 1, { px: 4, py: 5, oct: 5, gain: 0.55, warp: 0.1 }), f3 = fbmGrid(n, s0 + 2, { px: 5, py: 6, oct: 5, gain: 0.6 });
    const bins = [R.h, R.a, R.A, R.D], paths = bins.map(() => new Path2D());
    for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
      const k = j * m + i, dz = (hash3(i, j, s0) - 0.5) * 0.12;
      let b = -1;
      if (f1[k] + dz > -0.04) b = 0;
      if (f2[k] + dz > 0.08) b = 1;
      if (f1[k] - dz > 0.2) b = 2;
      if (f3[k] + dz > 0.24) b = 3;
      if (b >= 0) paths[b].rect(i * px, j * px, px, px);
    }
    bins.forEach((r, i) => { g.save(); if (r[4]) { g.globalCompositeOperation = "destination-out"; g.fillStyle = "#000"; } else g.fillStyle = rgba(r, 1); g.globalAlpha = r[4] ? 1 : r[3]; g.fill(paths[i]); g.restore(); });
  });
  fillTile(P, c);
}
function camoTiger(P) {
  const s0 = seedOf(P), T = P.s * 0.7;
  const c = fieldTile(P, "tigercamo", T, 7, (n, R) => ({
    fields: [() => fbmGrid(n, s0, { px: 2, py: 9, oct: 4, warp: 0.05, wpx: 3 }), () => fbmGrid(n, s0 + 1, { px: 3, py: 14, oct: 4, warp: 0.06, wpx: 3 })],
    layers: [{ f: 0, th: -0.02, ink: R.a }, { f: 1, th: 0.2, ink: R.D }, { f: 0, th: 0.42, ink: R.A }],
  }));
  fillTile(P, c);
}
function camoSplinter(P) {
  const s0 = seedOf(P), T = Math.round(P.s * 0.7);
  const c = tile(P, "splinter", T, T, (g) => {
    const R = inks(P), A = new Path2D(), B = new Path2D(), rain = new Path2D(), dir = -0.5 + (hash3(1, 2, s0) - 0.5) * 0.3;
    const shard = (path, m, seed, size, al) => {
      const pts = jitter(m, T, seed, 0.9);
      for (let i = 0; i < pts.length; i += 4) {
        if (pts[i + 2] > al) continue;
        const rf = mulberry32(seed + i * 31), x = pts[i], y = pts[i + 1], r = T / m * size * (0.8 + rf() * 0.5), k = 4 + ((rf() * 3) | 0), q = [];
        const a0 = dir + (rf() - 0.5) * 0.5, c0 = Math.cos(a0), s1 = Math.sin(a0);
        for (let v = 0; v < k; v++) { const a = (v + (rf() - 0.5) * 0.7) * TAU / k, rr = r * (0.35 + rf() * 0.75), u = Math.cos(a) * rr * 1.7, w = Math.sin(a) * rr * 0.7; q.push(u * c0 - w * s1, u * s1 + w * c0); }
        wrapAt(T, x, y, r * 1.8, (dx, dy) => { path.moveTo(x + dx + q[0], y + dy + q[1]); for (let v = 2; v < q.length; v += 2) path.lineTo(x + dx + q[v], y + dy + q[v + 1]); path.closePath(); });
      }
    };
    shard(A, 6, s0, 0.95, 0.85); shard(B, 7, s0 + 50, 0.7, 0.6);
    // rain: short vertical dashes, tight rows
    const dw = Math.max(1, Math.round(T * 0.004)), gap = Math.max(3, Math.round(T / 70)), dl = gap * 2.2;
    for (let x = 0; x < T; x += gap) for (let y0 = hash3(x, 0, s0) * dl * 2; y0 < T; y0 += dl * (1.6 + hash3(x, y0 | 0, s0) * 1.4)) rain.rect(x, y0, dw, Math.min(dl, T - y0));
    g.fillStyle = rgba(R.a, R.a[3]); g.fill(A);
    inkFill(g, R.A, B);
    inkFill(g, R.D, rain);
  });
  fillTile(P, c);
}
function camoUrban(P) {
  const s0 = seedOf(P), T = P.s * 0.66;
  const c = fieldTile(P, "urban", T, 8, (n, R) => ({
    fields: [() => fbmGrid(n, s0, { px: 3, py: 3, oct: 5, gain: 0.62 }), () => fbmGrid(n, s0 + 1, { px: 4, py: 4, oct: 5, gain: 0.62 }), () => fbmGrid(n, s0 + 2, { px: 5, py: 5, oct: 5, gain: 0.65 })],
    layers: [{ f: 0, th: -0.1, ink: R.q }, { f: 0, th: 0.05, ink: R.h }, { f: 1, th: 0.1, ink: R.a }, { f: 2, th: 0.22, ink: R.A }, { f: 1, th: 0.36, ink: R.L }],
  }));
  fillTile(P, c);
}
function camoMulti(P) {
  const s0 = seedOf(P), T = P.s * 0.8;
  const c = fieldTile(P, "multi", T, 10, (n, R) => ({
    fields: [() => fbmGrid(n, s0, { px: 2, py: 3, oct: 3, warp: 0.1 }), () => fbmGrid(n, s0 + 1, { px: 3, py: 4, oct: 3, warp: 0.1 }), () => fbmGrid(n, s0 + 2, { px: 8, py: 9, oct: 3, warp: 0.08 }), () => fbmGrid(n, s0 + 3, { px: 7, py: 10, oct: 3, ridge: 1 }), () => fbmGrid(n, s0 + 4, { px: 9, py: 8, oct: 3 })],
    layers: [{ f: 0, th: -0.16, ink: R.q }, { f: 0, th: -0.08, ink: R.q }, { f: 0, th: 0.0, ink: R.q }, { f: 0, th: 0.08, ink: R.q }, { f: 1, th: 0.06, ink: R.q }, { f: 1, th: 0.13, ink: R.h },
      { f: 2, th: 0.34, ink: R.A }, { f: 3, th: 0.45, ink: R.B }, { f: 4, th: 0.44, ink: R.L }],
  }));
  fillTile(P, c);
}

/* ======================================================================
   ANIMAL
   ====================================================================== */
function zebra(P) {
  const s0 = seedOf(P), T = P.s * 0.8, m = 8;
  const c = fieldTile(P, "zebra", T, 7, (n, R) => {
    const a = fbmGrid(n, s0, { px: 2, py: 2, oct: 3, warp: 0.1 }), b = fbmGrid(n, s0 + 1, { px: 4, py: 3, oct: 3 }), wv = fbmGrid(n, s0 + 2, { px: 3, py: 3, oct: 2 }), F = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = j * n + i; F[k] = stripeVal(m * i / n + a[k] * 3.2 + b[k] * 0.9 + Math.sin(TAU * j / n) * 0.6, 0.5 + wv[k] * 0.7); }
    return { fields: [F], layers: [{ f: 0, th: 0, ink: R.A }] };
  });
  fillTile(P, c);
}
function tiger(P) {
  const s0 = seedOf(P), T = P.s * 0.8, m = 9;
  const c = fieldTile(P, "tiger", T, 6, (n, R) => {
    const a = fbmGrid(n, s0, { px: 2, py: 2, oct: 3, warp: 0.1 }), b = fbmGrid(n, s0 + 1, { px: 4, py: 6, oct: 3 }), wv = fbmGrid(n, s0 + 2, { px: 3, py: 7, oct: 3 }), F = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = j * n + i; F[k] = stripeVal(m * i / n + a[k] * 1.1 + b[k] * 0.45 + Math.sin(TAU * j / n) * 0.4, 0.21 + wv[k] * 0.42); }
    return { fields: [F], layers: [{ f: -1, ink: R.U }, { f: 0, th: 0, ink: R.D }] };
  });
  fillTile(P, c);
}
function tabby(P) {
  const s0 = seedOf(P), T = P.s * 0.6, m = 15;
  const c = fieldTile(P, "tabby", T, 4.5, (n, R) => {
    const a = fbmGrid(n, s0, { px: 2, py: 2, oct: 3, warp: 0.1 }), fur = fbmGrid(n, s0 + 1, { px: 6, py: 40, oct: 2 });
    const wv = fbmGrid(n, s0 + 2, { px: 5, py: 9, oct: 3 }), F1 = new Float32Array(n * n), F2 = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const k = j * n + i, ph = m * i / n + a[k] * 1.6 + Math.sin(TAU * j / n) * 0.5 + fur[k] * 0.045; F1[k] = stripeVal(ph, 0.42 + wv[k] * 0.3); F2[k] = stripeVal(ph, 0.18 + wv[k] * 0.4 + fur[k] * 0.12); }
    return { fields: [F1, F2], layers: [{ f: -1, ink: R.U }, { f: 0, th: 0, ink: R.e }, { f: 1, th: 0, ink: R.D }] };
  });
  fillTile(P, c);
}
function giraffe(P) {
  const s0 = seedOf(P), T = P.s * 0.8, m = 5, cell = T / m;
  const c = fieldTile(P, "giraffe", T, 7, (n, R) => {
    const pts = []; for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) pts.push((i + 0.5 + (hash3(i, j, s0) - 0.5) * 0.65) * cell, (j + 0.5 + (hash3(i, j, s0 + 1) - 0.5) * 0.65) * cell);
    const rough = fbmGrid(n, s0 + 2, { px: 16, py: 16, oct: 2 }), D = new Float32Array(n * n), k = cell * 0.05;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = i * T / n, y = j * T / n, ci = Math.floor(x / cell), cj = Math.floor(y / cell), cand = [];   // jitter 0.65 keeps every relevant site in the 3×3 block
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = ci + di, jj = cj + dj, w = ((ii % m) + m) % m, h = ((jj % m) + m) % m;
        cand.push(pts[(h * m + w) * 2] + (ii - w) * cell, pts[(h * m + w) * 2 + 1] + (jj - h) * cell);
      }
      let best = 0, bd = Infinity;
      for (let q = 0; q < cand.length; q += 2) { const d = (cand[q] - x) ** 2 + (cand[q + 1] - y) ** 2; if (d < bd) { bd = d; best = q; } }
      const px = cand[best], py = cand[best + 1];
      let sm = 0;
      for (let q = 0; q < cand.length; q += 2) {
        if (q === best) continue;
        const nx = cand[q] - px, ny = cand[q + 1] - py, L = Math.hypot(nx, ny);
        const dist = -((x - (px + cand[q]) / 2) * nx + (y - (py + cand[q + 1]) / 2) * ny) / L;   // >0 inside
        if (dist < k * 12) sm += Math.exp(-dist / k);
      }
      D[j * n + i] = -k * Math.log(sm) + rough[j * n + i] * cell * 0.05;   // soft distance to the patch edge, px
    }
    const gap = cell * 0.06;
    return { fields: [D], layers: [{ f: 0, th: gap, ink: R.a }, { f: 0, th: gap + cell * 0.12, ink: R.A }] };
  });
  fillTile(P, c);
}
/* Spot prints: the motif geometry depends only on the seed, so it is built once in a 1000-unit tile,
   kept (as Path2Ds) per seed, and scaled into each tile.  build(T) -> [[role, Path2D | null (whole tile)], ...] */
const motifCache = new Map();
function spotsTile(P, name, T, build) {
  const key = name + "|" + P.seed;
  let layers = motifCache.get(key);
  if (!layers) { layers = build(1000); motifCache.set(key, layers); if (motifCache.size > 24) motifCache.delete(motifCache.keys().next().value); }
  const c = tile(P, name, T, T, (g, tw) => {
    const R = inks(P); g.scale(tw / 10000, tw / 10000);   // motif units are tenths (PathStr)
    for (const [role, path] of layers) {
      if (path) inkFill(g, R[role], path);
      else { g.fillStyle = rgba(R[role], R[role][3]); g.fillRect(0, 0, 10000, 10000); }
    }
  });
  fillTile(P, c);
}
function leopard(P) {
  const s0 = seedOf(P), T = Math.round(P.s * 0.57), m = 5;
  spotsTile(P, "leopard", T, (T) => {
    const ring = new PathStr(), mid = new PathStr(), dots = new PathStr(), cell = T / m;
    const pts = jitter(m, T, s0, 0.7);
    for (let i = 0; i < pts.length; i += 4) {
      const rf = mulberry32(s0 + i * 7), x = pts[i], y = pts[i + 1], r = cell * (0.3 + pts[i + 2] * 0.1), ex = 0.85 + rf() * 0.35, rot = rf() * TAU;
      const pc = blobPts(rf, r * 0.9, 7, 0.25, ex, 1 / ex, rot);
      const segs = 3 + ((rf() * 3) | 0), a0 = rf() * TAU, segPts = [];
      for (let sgi = 0; sgi < segs; sgi++) {
        const aa = a0 + sgi * TAU / segs + (rf() - 0.5) * 0.25, span = TAU / segs * (0.68 + rf() * 0.2), th = r * (0.34 + rf() * 0.18), q = [], N = 6;
        for (let t = 0; t <= N; t++) { const u = t / N, a = aa + span * u, w = th * Math.pow(Math.sin(Math.PI * u), 0.55) + th * 0.12, rr = r * (1 + (rf() - 0.5) * 0.08); q.push(a, rr + w * 0.6, rr - w * 0.6); }
        segPts.push(q);
      }
      const cr = Math.cos(rot), sr = Math.sin(rot), polys = segPts.map(q => {
        const out = [], at = (a, rr) => { const u = Math.cos(a) * rr * ex, v = Math.sin(a) * rr / ex; out.push(u * cr - v * sr, u * sr + v * cr); };
        for (let t = 0; t < q.length; t += 3) at(q[t], q[t + 1]);
        for (let t = q.length - 3; t >= 0; t -= 3) at(q[t], q[t + 2]);
        return out;
      });
      wrapAt(T, x, y, r * 1.5, (dx, dy) => {
        smoothPath(mid, pc, x + dx, y + dy);
        for (const o of polys) smoothPath(ring, o, x + dx, y + dy);
      });
    }
    const sp = jitter(m, T, s0 + 99, 0.6);   // small solid spots in between the rosettes
    for (let i = 0; i < sp.length; i += 4) {
      if (sp[i + 2] > 0.6) continue;
      const rf = mulberry32(s0 + 5000 + i), x = sp[i] + cell / 2, y = sp[i + 1] + cell / 2, r = cell * (0.06 + rf() * 0.06), pd = blobPts(rf, r, 6, 0.4, 1.2, 0.85, rf() * TAU);
      wrapAt(T, x, y, r * 1.5, (dx, dy) => smoothPath(dots, pd, x + dx, y + dy));
    }
    return [["T", null], ["e", mid.done()], ["D", ring.done()], ["D", dots.done()]];
  });
}
function cheetah(P) {
  const s0 = seedOf(P), T = Math.round(P.s * 0.6), m = 12;
  spotsTile(P, "cheetah", T, (T) => {
    const dots = new PathStr(), cell = T / m, pts = jitter(m, T, s0, 0.75);
    for (let i = 0; i < pts.length; i += 4) {
      const rf = mulberry32(s0 + i * 3), x = pts[i], y = pts[i + 1], r = cell * (0.17 + pts[i + 2] * 0.1), pd = blobPts(rf, r, 7, 0.28, 1.1, 0.9, rf() * TAU);
      wrapAt(T, x, y, r * 1.4, (dx, dy) => smoothPath(dots, pd, x + dx, y + dy));
    }
    return [["T", null], ["D", dots.done()]];
  });
}
function dalmatian(P) {
  const s0 = seedOf(P), T = Math.round(P.s * 0.7), m = 7;
  spotsTile(P, "dalmatian", T, (T) => {
    const dots = new PathStr(), cell = T / m, pts = jitter(m, T, s0, 0.95);
    for (let i = 0; i < pts.length; i += 4) {
      if (pts[i + 3] < 0.12) continue;
      const rf = mulberry32(s0 + i * 5), x = pts[i], y = pts[i + 1], u = pts[i + 2], r = cell * (0.08 + u * u * 0.22), pd = blobPts(rf, r, 8, 0.35, 1 + rf() * 0.3, 1, rf() * TAU);
      wrapAt(T, x, y, r * 1.5, (dx, dy) => smoothPath(dots, pd, x + dx, y + dy));
      if (rf() < 0.35) { const a = rf() * TAU, r2 = r * (0.35 + rf() * 0.3), x2 = x + Math.cos(a) * (r + r2) * 0.95, y2 = y + Math.sin(a) * (r + r2) * 0.95, p2 = blobPts(rf, r2, 7, 0.35); wrapAt(T, x2, y2, r2 * 1.5, (dx, dy) => smoothPath(dots, p2, x2 + dx, y2 + dy)); }
    }
    return [["A", dots.done()]];
  });
}
function cowhide(P) {
  const s0 = seedOf(P), T = P.s * 0.9;
  const c = fieldTile(P, "cow", T, 10, (n, R) => ({
    fields: [() => fbmGrid(n, s0, { px: 3, py: 3, oct: 5, gain: 0.5, warp: 0.12 })],
    layers: [{ f: 0, th: 0.12, ink: R.A }],
  }));
  fillTile(P, c);
}
function snakeskin(P) {
  const s0 = seedOf(P), cw = Math.max(6, Math.round(P.s * 0.034)), mx = clamp(Math.round(P.s * 0.6 / cw), 6, 48), T = mx * cw;
  const my = Math.max(2, Math.round(T / (cw * 0.5) / 2) * 2), rh = T / my;
  const c = tile(P, "snake", T, T, (g) => {
    const R = inks(P), nz = pnoise(s0), lw = Math.max(1, cw * 0.075);
    // opaque tints (ink pre-mixed over the ground) so overlapping rows simply paint over each other
    const solid = (r) => r[4] ? rgba(P.bg) : rgba([P.bg[0] + (r[0] - P.bg[0]) * r[3], P.bg[1] + (r[1] - P.bg[1]) * r[3], P.bg[2] + (r[2] - P.bg[2]) * r[3]]);
    const bins = [R.h, R.a, R.A, R.l].map(solid), edge = solid(R.D[4] ? R.K : [R.D[0], R.D[1], R.D[2], 0.55]);
    const field = (x, y) => nz(x / T * 3, y / T * 3, 3, 3) * 0.75 + nz(x / T * 6 + 9, y / T * 6, 6, 6) * 0.25;
    const hw = cw * 0.56, top = rh * 1.1, bot = rh * 1.25;
    // shield-shaped scales, pointed at the head end; each row laps over the one above, outlined in the ground
    const shape = (p, x, y) => { p.moveTo(x, y - top); p.quadraticCurveTo(x + hw * 0.7, y - top * 0.55, x + hw, y); p.bezierCurveTo(x + hw, y + bot * 0.7, x - hw, y + bot * 0.7, x - hw, y); p.quadraticCurveTo(x - hw * 0.7, y - top * 0.55, x, y - top); p.closePath(); };
    g.lineWidth = lw; g.lineJoin = "round";
    for (let j = -2; j <= my + 2; j++) {
      const all = new Path2D(), paths = bins.map(() => new Path2D());
      for (let i = -1; i <= mx; i++) {
        const x = (i + ((j & 1) ? 0.5 : 0)) * cw, y = j * rh, xm = ((x % T) + T) % T, ym = ((y % T) + T) % T;
        const jj = ((j % my) + my) % my, ii = ((Math.round(x / cw - ((j & 1) ? 0.5 : 0)) % mx) + mx) % mx;
        const v = field(xm, ym) + (hash3(ii, jj, s0) - 0.5) * 0.1;
        const b = v > 0.2 ? 2 : v > 0.1 ? 3 : v > -0.1 ? 1 : 0;
        shape(all, x, y); shape(paths[b], x, y);
      }
      bins.forEach((c, k) => { g.fillStyle = c; g.fill(paths[k]); });
      g.strokeStyle = edge; g.stroke(all);
    }
  });
  fillTile(P, c);
}

/* ======================================================================
   PSYCH: banded fields. A smooth field is sampled on a coarse grid, then every pixel reads it
   bilinearly and is coloured by which band of a "sett" it falls in, anti-aliased by its distance to the
   nearest band edge (field difference / field gradient). Crisp at any size, two inks on a clear ground.
   ====================================================================== */
/* sett: [[ink, width], ...] with ink 0 = ground (clear), 1 = fg, 2 = fg2. gridPx: grid step as a fraction of P.s. */
function bandField(P, field, sett, gridPx) {
  const W = P.W, H = P.H, step = Math.max(2, (gridPx || 1 / 160) * P.s);   // grid follows the pattern's own scale
  // built as a layer-sized canvas in screen pixels, in steps (a 3000 px sleeve is ~9 Mpx of per-pixel work)
  const c = tile(P, "band|" + Math.round(P.ang * 1e4), W, H, function* (g) {
    const nx = Math.ceil(W / step) + 2, ny = Math.ceil(H / step) + 2;
    const ca = Math.cos(-P.ang), sa = Math.sin(-P.ang), cx = P.cx, cy = P.cy, u = P.s;
    const v = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const X = i * step - cx, Y = j * step - cy;
      v[j * nx + i] = field((X * ca - Y * sa) / u, (X * sa + Y * ca) / u);   // field works in pattern units
    }
    yield;
    const tot = sett.reduce((a, s) => a + s[1], 0), cuts = [], inks = [];
    let acc = 0; for (const [k, w] of sett) { cuts.push(acc / tot); inks.push(k); acc += w; }
    const n = sett.length, col = [[0, 0, 0, 0], [...P.fg, 255], [...P.fg2, 255]];
    const rows = Math.max(1, Math.floor(400000 / W));
    for (let y0 = 0; y0 < H; y0 += rows) {
      const h = Math.min(rows, H - y0), im = g.createImageData(W, h), d = im.data;
      for (let y = y0; y < y0 + h; y++) {
        const gy = y / step, j = Math.min(ny - 2, gy | 0), fy = gy - j;
        for (let x = 0; x < W; x++) {
          const gx = x / step, i = Math.min(nx - 2, gx | 0), fx = gx - i, o = j * nx + i;
          const a = v[o], b = v[o + 1], c4 = v[o + nx + 1], e = v[o + nx];
          const t = a + (b - a) * fx + (e - a) * fy + (a - b - e + c4) * fx * fy;
          const tx = ((b - a) + (a - b - e + c4) * fy) / step, ty = ((e - a) + (a - b - e + c4) * fx) / step;
          const grad = Math.hypot(tx, ty) + 1e-9;
          let f = t - Math.floor(t), s = n - 1; for (let q = 1; q < n; q++) if (f < cuts[q]) { s = q - 1; break; }
          // distance (px) to this band's lower and upper edges; blend toward the nearer neighbour
          const lo = (f - cuts[s]) / grad, hi = ((s + 1 < n ? cuts[s + 1] : 1) - f) / grad;
          const near = lo < hi ? (s + n - 1) % n : (s + 1) % n, dist = Math.min(lo, hi);
          const w = dist >= 0.5 ? 1 : 0.5 + dist, A = col[inks[s]], B = col[inks[near]];
          const aa = A[3] * w + B[3] * (1 - w), q4 = ((y - y0) * W + x) * 4;
          if (aa <= 0) continue;
          d[q4] = (A[0] * A[3] * w + B[0] * B[3] * (1 - w)) / aa; d[q4 + 1] = (A[1] * A[3] * w + B[1] * B[3] * (1 - w)) / aa;
          d[q4 + 2] = (A[2] * A[3] * w + B[2] * B[3] * (1 - w)) / aa; d[q4 + 3] = aa;
        }
      }
      g.putImageData(im, 0, y0);
      yield;
    }
  });
  screen(P, (g) => g.drawImage(c, 0, 0));
}
/* warped-noise helpers in pattern units */
function flowNoise(seed) {
  const n1 = perlin(seed), n2 = perlin(seed + 101), n3 = perlin(seed + 202);
  return { n1, n2, n3, warp: (x, y, f) => [n2(x * f * 0.6 + 3.1, y * f * 0.6) * 0.35, n3(x * f * 0.6 + 7.7, y * f * 0.6) * 0.35] };
}
const vortex = (x, y, vs) => {
  for (const [cx, cy, R, turns] of vs) {
    const dx = x - cx, dy = y - cy, r2 = (dx * dx + dy * dy) / (R * R), a = turns * TAU * Math.exp(-r2), c = Math.cos(a), s = Math.sin(a);
    x = cx + dx * c - dy * s; y = cy + dx * s + dy * c;
  }
  return [x, y];
};
const SETT2 = [[[0, 1], [1, 0.75]], [[0, 1], [1, 1]], [[0, 1.4], [1, 0.4]]];
const SETT3 = [[[0, 1], [1, 0.42], [0, 0.55], [2, 0.38]], [[0, 1], [1, 0.5], [2, 0.5]], [[0, 0.7], [1, 0.3], [0, 0.3], [2, 0.7], [0, 0.3], [1, 0.3]]];
const pickSett = (P) => { const L = P.fg2 === P.fg || P.fg2.join() === P.fg.join() ? SETT2 : SETT3.concat(SETT2.slice(0, 1)); return L[(P.rnd() * L.length) | 0]; };

/* Flow: stripes bent by a slow current and a vortex or two (60s/70s liquid). */
function flow(P) {
  const r = P.rnd, N = flowNoise(P.seed), f = 0.9 + r() * 1.2, amp = 1 + r() * 2.5, per = 0.07 + r() * 0.05, an = 1.2 + r() * 1.4, swell = 0.3 + r() * 0.5;
  const vs = []; for (let k = 0, m = r() < 0.75 ? 1 + (r() < 0.4) : 0; k < m; k++) vs.push([(r() - 0.5) * 1.4, (r() - 0.5) * 1.4, 0.18 + r() * 0.22, (0.3 + r() * 0.35) * (r() < 0.5 ? -1 : 1)]);
  const sett = pickSett(P);
  bandField(P, (x0, y0) => {
    const [x, y] = vortex(x0, y0, vs), [wx, wy] = N.warp(x, y, f);
    const d = N.n1((x + wx) * f / an, (y + wy) * f) + 0.3 * N.n1(x * f * 2.7 / an + 9, y * f * 2.7);
    const sw = 1 + swell * N.n3(x * 1.6 + 17, y * 1.6);   // swelling: speeds the phase up and down
    return (y / per) * (0.85 + 0.15 * sw) + d * amp;
  }, sett);
}
/* Op melt: fine two-ink stripes, heavily warped, so they bunch tight and open wide (op-art). */
function opmelt(P) {
  const r = P.rnd, N = flowNoise(P.seed), f = 1.1 + r() * 0.8, amp = 4 + r() * 4, per = 0.025 + r() * 0.015;
  const vs = r() < 0.6 ? [[(r() - 0.5), (r() - 0.5), 0.2 + r() * 0.2, (0.25 + r() * 0.3) * (r() < 0.5 ? -1 : 1)]] : [];
  bandField(P, (x0, y0) => {
    const [x, y] = vortex(x0, y0, vs), [wx, wy] = N.warp(x, y, f);
    return y / per + amp * (N.n1((x + wx) * f / 1.5, (y + wy) * f) + 0.4 * N.n1(x * f * 2.3 + 5, y * f * 2.3));
  }, [[0, 1], [1, 1]], 1 / 220);
}
/* Bloom: concentric star rings out from a centre, the petals twisting as they grow (60s poster). */
function bloom(P) {
  const r = P.rnd, k = 5 + ((r() * 9) | 0), tw = (r() - 0.5) * 1.6, depth = 0.12 + r() * 0.2, per = 0.06 + r() * 0.05;
  const ox = (r() - 0.5) * 0.9, oy = (r() - 0.5) * 0.9, sett = pickSett(P);
  bandField(P, (x, y) => {
    const dx = x - ox, dy = y - oy, rr = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    return rr * (1 + depth * Math.cos(k * a + tw * rr * 6)) / per;
  }, sett);
}

/* ======================================================================
   CHARACTERS & FLOWER POWER: packed vector stickers (melting smileys, ghosts, 60s daisies).
   Every motif is a smooth closed shape (a field contoured per motif, or bezier petals) in one ink, with its
   features knocked out to the ground. Motifs are dart-packed over the visible area, biggest first, and each one
   cuts a thin ground-coloured gap around itself, so where they overlap they read as stacked stickers.
   Duo colour adds the second ink as offset shadows, whole motifs, or flower centres.
   ====================================================================== */
const smax = (a, b, k) => { const h = clamp(0.5 + 0.5 * (a - b) / k, 0, 1); return b + (a - b) * h + k * h * (1 - h); };
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const isDuo = (P) => Math.abs(P.fg[0] - P.fg2[0]) + Math.abs(P.fg[1] - P.fg2[1]) + Math.abs(P.fg[2] - P.fg2[2]) > 24;

/* Dart-throw packing over the visible area: radii from rmax down to rmin (each level ×decay), each dart kept when
   it stays `sp` × (sum of radii) away from everything already placed. Returns [{ x, y, r }], biggest first. */
function dartPack(P, rmax, rmin, o = {}) {
  const rnd = P.rnd, sp = o.sp ?? 0.95, decay = o.decay ?? 0.86, effort = o.effort ?? 1.4, out = [];
  const cell = rmax * 2, grid = new Map(), key = (i, j) => (i + 4096) * 8192 + j + 4096;
  const hx = P.hx, hy = P.hy;
  for (let r = rmax; r >= rmin * 0.999; r *= decay) {
    const tries = Math.ceil(4 * (hx + r) * (hy + r) / (r * r) * effort);
    for (let t = 0; t < tries; t++) {
      const rr = r * (0.9 + rnd() * 0.2), x = (rnd() * 2 - 1) * (hx + rr * 0.4), y = (rnd() * 2 - 1) * (hy + rr * 0.4);
      const gi = Math.floor(x / cell), gj = Math.floor(y / cell); let ok = true;
      for (let j = gj - 1; j <= gj + 1 && ok; j++) for (let i = gi - 1; i <= gi + 1 && ok; i++) {
        const L = grid.get(key(i, j)); if (!L) continue;
        for (const c of L) { const d = (rr + c.r) * sp; if ((c.x - x) ** 2 + (c.y - y) ** 2 < d * d) { ok = false; break; } }
      }
      if (!ok) continue;
      const c = { x, y, r: rr }; out.push(c);
      const k = key(gi, gj); (grid.get(k) || grid.set(k, []).get(k)).push(c);
    }
  }
  return out;
}

/* Closed smooth curve through a polygon's midpoints (quadratic), into path. */
function smoothPoly(path, pts) {
  const n = pts.length; if (n < 6) return;
  path.moveTo((pts[n - 2] + pts[0]) / 2, (pts[n - 1] + pts[1]) / 2);
  for (let i = 0; i < n; i += 2) { const j = (i + 2) % n; path.quadraticCurveTo(pts[i], pts[i + 1], (pts[i] + pts[j]) / 2, (pts[i + 1] + pts[j + 1]) / 2); }
  path.closePath();
}
/* A thick stroke along a centreline as a filled outline (round caps), so a feature can be warped and knocked out.
   line(t) -> [x, y] for t in 0..1, half(t) -> half width. */
function strokePts(line, half, n = 28) {
  const C = [], e = 1e-3;
  for (let i = 0; i <= n; i++) {
    const t = i / n, [x, y] = line(t), [ax, ay] = line(Math.max(0, t - e)), [bx, by] = line(Math.min(1, t + e));
    let tx = bx - ax, ty = by - ay; const d = Math.hypot(tx, ty) || 1; tx /= d; ty /= d;
    C.push([x, y, tx, ty, half(t)]);
  }
  const out = [];
  for (const [x, y, tx, ty, h] of C) out.push(x - ty * h, y + tx * h);   // left side, forwards
  { const [x, y, tx, ty, h] = C[n]; for (let k = 1; k < 8; k++) { const f = k / 8 * Math.PI, c = Math.cos(f), s = Math.sin(f); out.push(x + (-ty * c + tx * s) * h, y + (tx * c + ty * s) * h); } }
  for (let i = n; i >= 0; i--) { const [x, y, tx, ty, h] = C[i]; out.push(x + ty * h, y - tx * h); }   // right side, back
  { const [x, y, tx, ty, h] = C[0]; for (let k = 1; k < 8; k++) { const f = k / 8 * Math.PI, c = Math.cos(f), s = Math.sin(f); out.push(x + (ty * c - tx * s) * h, y + (-tx * c - ty * s) * h); } }
  return out;
}
const ellPts = (cx, cy, rx, ry, rot = 0, n = 22) => {
  const p = [], c = Math.cos(rot), s = Math.sin(rot);
  for (let i = 0; i < n; i++) { const a = i / n * TAU, u = Math.cos(a) * rx, v = Math.sin(a) * ry; p.push(cx + u * c - v * s, cy + u * s + v * c); }
  return p;
};

/* Closed loops of { V > 0 } on an n×n grid (spacing cs, origin 0), V negative all round its border.
   Marching squares; each crossing is keyed by its grid edge, and every edge inside joins exactly two cells. */
function isoLoops(V, n, cs) {
  const pt = new Map(), nb = new Map();
  const cross = (i0, j0, i1, j1) => {   // crossing on the edge between nodes (i0,j0)-(i1,j1)
    const k = (j0 * n + i0) * 2 + (i1 !== i0 ? 0 : 1);
    if (!pt.has(k)) { const a = V[j0 * n + i0], b = V[j1 * n + i1], t = a / (a - b); pt.set(k, [(i0 + (i1 - i0) * t) * cs, (j0 + (j1 - j0) * t) * cs]); }
    return k;
  };
  const link = (a, b) => { (nb.get(a) || nb.set(a, []).get(a)).push(b); (nb.get(b) || nb.set(b, []).get(b)).push(a); };
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = V[j * n + i], b = V[j * n + i + 1], c = V[(j + 1) * n + i + 1], d = V[(j + 1) * n + i];
    const m = (a > 0 ? 1 : 0) | (b > 0 ? 2 : 0) | (c > 0 ? 4 : 0) | (d > 0 ? 8 : 0);
    if (m === 0 || m === 15) continue;
    const T = () => cross(i, j, i + 1, j), R = () => cross(i + 1, j, i + 1, j + 1), B = () => cross(i, j + 1, i + 1, j + 1), L = () => cross(i, j, i, j + 1);
    switch (m) {
      case 1: case 14: link(L(), T()); break;
      case 2: case 13: link(T(), R()); break;
      case 3: case 12: link(L(), R()); break;
      case 4: case 11: link(R(), B()); break;
      case 6: case 9: link(T(), B()); break;
      case 7: case 8: link(L(), B()); break;
      case 5: case 10: {   // saddle: decide by the centre
        const ctr = (a + b + c + d) / 4 > 0;
        if ((m === 5) === ctr) { link(L(), B()); link(T(), R()); } else { link(L(), T()); link(R(), B()); }
      }
    }
  }
  const loops = [], seen = new Set();
  for (const k0 of nb.keys()) {
    if (seen.has(k0)) continue;
    const loop = []; let prev = -1, k = k0;
    while (k !== undefined && !seen.has(k)) {
      seen.add(k); const p = pt.get(k); loop.push(p[0], p[1]);
      const L = nb.get(k), nx = L[0] !== prev ? L[0] : L[1]; prev = k; k = nx;
    }
    if (loop.length >= 6) loops.push(loop);
  }
  return loops;
}
/* A motif body as a field contoured on a grid: F(x, y) > 0 inside, over the box x in [-B, B], y in [oy-B, oy+B]
   (unit motif space). Returns a Path2D in unit space. */
function fieldBody(F, B, oy, n) {
  const T = 2 * B, cs = T / n, V = new Float32Array(n * n);
  let a = 0, sx = 0, sy = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -B + i * cs, y = oy - B + j * cs, v = (i < 2 || j < 2 || i > n - 3 || j > n - 3) ? -1 : F(x, y);
    V[j * n + i] = v; if (v > 0) { a++; sx += x; sy += y; }
  }
  const out = new Path2D();
  for (const L of isoLoops(V, n, cs)) { for (let i = 0; i < L.length; i += 2) { L[i] -= B; L[i + 1] += oy - B; } smoothPoly(out, L); }
  return { path: out, cx: a ? sx / a : 0, cy: a ? sy / a : 0, rad: Math.sqrt(a * cs * cs / Math.PI) || 1 };
}

/* Draw packed stickers. Each item: { x, y, r, rot, body (unit Path2D), ink: 1|2, feats: [Path2D unit] (knocked out),
   over: [[Path2D, ink]] (printed after the knockouts), shadow: bool }. Gap in px; shadow offset in px (screen dir). */
function drawStickers(P, items, gap, shOff) {
  const g = P.g, inkOf = (k) => rgba(k === 2 ? P.fg2 : P.fg);
  g.lineJoin = "round";
  for (const it of items) {
    if (!P.vis(it.x, it.y, it.r * 3)) continue;
    g.save(); g.translate(it.x, it.y); g.rotate(it.rot); g.scale(it.r, it.r); g.translate(-(it.bx || 0), -(it.by || 0));
    const sx = shOff ? (shOff[0] * Math.cos(-it.rot) - shOff[1] * Math.sin(-it.rot)) / it.r : 0, sy = shOff ? (shOff[0] * Math.sin(-it.rot) + shOff[1] * Math.cos(-it.rot)) / it.r : 0;
    // the gap: cut the ground clear around the body (and its shadow)
    g.globalCompositeOperation = "destination-out"; g.fillStyle = "#000"; g.strokeStyle = "#000"; g.lineWidth = 2 * gap / it.r;
    g.fill(it.body, "evenodd"); g.stroke(it.body);
    if (it.shadow) { g.translate(sx, sy); g.fill(it.body, "evenodd"); g.stroke(it.body); g.translate(-sx, -sy); }
    g.globalCompositeOperation = "source-over";
    if (it.shadow) { g.fillStyle = inkOf(2); g.translate(sx, sy); g.fill(it.body, "evenodd"); g.translate(-sx, -sy); }
    g.fillStyle = inkOf(it.ink); g.fill(it.body, "evenodd");
    if (it.feats && it.feats.length) { g.globalCompositeOperation = "destination-out"; g.fillStyle = "#000"; for (const f of it.feats) g.fill(f); g.globalCompositeOperation = "source-over"; }
    if (it.over) for (const [f, k] of it.over) { g.fillStyle = inkOf(k); g.fill(f); }
    g.restore();
  }
}

/* small drops and blobs for the gaps between characters (world coords, one path per ink) */
function gapDrops(P, items, rmin, sp = 1.05, spd = 2.2) {
  const placed = items.map(it => ({ x: it.x, y: it.y, r: it.r * (it.reach || 1) }));
  const cell = Math.max(...placed.map(c => c.r), rmin) * 2, grid = new Map(), key = (i, j) => (i + 4096) * 8192 + j + 4096;
  for (const c of placed) { const k = key(Math.floor(c.x / cell), Math.floor(c.y / cell)); (grid.get(k) || grid.set(k, []).get(k)).push(c); }
  const rnd = P.rnd, out = [], hx = P.hx, hy = P.hy;
  for (let r = rmin; r >= rmin * 0.55; r *= 0.75) {
    const tries = Math.ceil(4 * hx * hy / (r * r) * 0.3);
    for (let t = 0; t < tries; t++) {
      const x = (rnd() * 2 - 1) * hx, y = (rnd() * 2 - 1) * hy, gi = Math.floor(x / cell), gj = Math.floor(y / cell); let ok = true;
      for (let j = gj - 1; j <= gj + 1 && ok; j++) for (let i = gi - 1; i <= gi + 1 && ok; i++) {
        const L = grid.get(key(i, j)); if (!L) continue;
        for (const c of L) { const d = (r + c.r) * (c.drop ? spd : sp); if ((c.x - x) ** 2 + (c.y - y) ** 2 < d * d) { ok = false; break; } }
      }
      if (!ok) continue;
      const c = { x, y, r, drop: 1 }; out.push(c); const k = key(gi, gj); (grid.get(k) || grid.set(k, []).get(k)).push(c);
    }
  }
  return out;
}

/* ---------- MELT: smiley faces that sag and drip ---------- */
function meltFace(rnd, N1, N2, melt, o) {
  const A = 0.05 + 0.2 * melt * o.warp, f = 0.9 + rnd() * 0.5, sag = 0.15 + 0.6 * melt * rnd() + 0.1;
  const twist = (rnd() - 0.5) * 0.5 * melt, ox = rnd() * 50, oy2 = rnd() * 50;
  const hm = [1, 2, 3].map(k => [(rnd() - 0.5) * 0.12 / k, rnd() * TAU]);
  // D: face space -> drawn offset (evaluated at the drawn point; the body is { q = p - D(p) inside the wobbly disc })
  const Dx = (x, y) => A * N1(x * f + ox, y * f + oy2) + twist * Math.max(0, y) ** 2, Dy = (x, y) => A * N2(x * f + ox, y * f + oy2) + sag * sstep(-0.3, 1.8, y);
  const fwd = (qx, qy) => { let px = qx, py = qy; for (let i = 0; i < 7; i++) { const nx = qx + Dx(px, py); py = qy + Dy(px, py); px = nx; } return [px, py]; };
  const bodyF = (x, y) => {
    const qx = x - Dx(x, y), qy = y - Dy(x, y), a = Math.atan2(qy, qx);
    let rad = 1; for (let k = 0; k < 3; k++) rad += hm[k][0] * Math.cos((k + 2) * a + hm[k][1]);
    return rad - Math.hypot(qx, qy);
  };
  // drips hang from the lower edge; their count and length grow with the melt
  const drips = [], nd = melt < 0.2 ? 0 : Math.round(1 + melt * 3 * rnd() + melt * 1.5);
  for (let i = 0; i < nd; i++) {
    const x0 = (rnd() * 2 - 1) * 0.72; let yb = 0;
    while (yb < 3 && bodyF(x0, yb) > 0) yb += 0.03;
    const w = 0.07 + rnd() * 0.09, L = (0.15 + rnd() * 0.9 * melt) * (1.15 - Math.abs(x0) * 0.5), ex = x0 + (rnd() - 0.5) * 0.15;
    drips.push([x0, yb - 0.25, ex, yb + L, w, rnd() < 0.35 * melt ? 0.12 + rnd() * 0.2 : 0]);
  }
  const F = (x, y) => {
    let v = bodyF(x, y);
    for (const [x0, y0, x1, y1, w, drop] of drips) {
      const vx = x1 - x0, vy = y1 - y0, t = clamp(((x - x0) * vx + (y - y0) * vy) / (vx * vx + vy * vy), 0, 1);
      const cap = w * (1 - 0.2 * t) - Math.hypot(x - x0 - vx * t, y - y0 - vy * t), bulb = w * 1.28 - Math.hypot(x - x1, y - y1 + w * 0.2);
      v = smax(v, Math.max(cap, bulb), 0.14);
      if (drop) v = Math.max(v, w * 0.95 - Math.hypot((x - x1) * 1.1, (y - y1 - w * 1.4 - drop - w) * 0.85));
    }
    return v;
  };
  let maxY = 1.4; for (const d of drips) maxY = Math.max(maxY, d[3] + d[4] * 1.3 + d[5] + d[4] * 3);
  const B = Math.max(1.75, (maxY + 1.35) / 2), oyB = maxY - B + 0.1;
  const fb = fieldBody(F, B, oyB, o.n), body = fb.path;
  // features in face space, pushed through the same melt
  const W = (pts) => { const out = []; for (let i = 0; i < pts.length; i += 2) { const [x, y] = fwd(pts[i], pts[i + 1]); out.push(x, y); } return out; };
  const feats = new Path2D(), es = 0.9 + rnd() * 0.25, ex = 0.34 + rnd() * 0.06, ey = -0.27 + (rnd() - 0.5) * 0.08;
  const wink = rnd() < 0.1, erx = (0.12 + rnd() * 0.03) * es, ery = (0.2 + rnd() * 0.07) * es;
  for (const sgn of [-1, 1]) {
    const cx = sgn * ex;
    if (wink && sgn > 0) smoothPoly(feats, W(strokePts((t) => [cx - 0.15 + 0.3 * t, ey + 0.04 - Math.sin(t * Math.PI) * 0.12], () => 0.06, 16)));
    else smoothPoly(feats, W(ellPts(cx, ey, erx * (0.9 + rnd() * 0.2), ery * (0.9 + rnd() * 0.2), (rnd() - 0.5) * 0.3)));
  }
  const mt = rnd(), mw = 0.52 + rnd() * 0.12, my = 0.0 + rnd() * 0.08, th = 0.065 + rnd() * 0.02, wav = mt < 0.25 ? 0.04 + rnd() * 0.04 : 0;
  const a0 = 0.22 + rnd() * 0.15, a1 = Math.PI - 0.22 - rnd() * 0.15;
  const mline = (t) => { const a = a0 + (a1 - a0) * t; return [Math.cos(a) * mw, my + Math.sin(a) * mw * 0.72 + wav * Math.sin(t * TAU * 2.5)]; };
  smoothPoly(feats, W(strokePts(mline, (t) => th * (0.8 + 0.3 * Math.sin(t * Math.PI)), 30)));
  if (mt > 0.75) for (const t of [0, 1]) {   // dimples at the corners
    const [x, y] = mline(t), s = t ? 1 : -1;
    smoothPoly(feats, W(strokePts((u) => [x + s * 0.03 * u, y - 0.09 + 0.18 * u], () => th * 0.75, 8)));
  }
  return { body, feats: [feats], bx: fb.cx, by: fb.cy, scale: 1 / fb.rad };
}
function melt(P) {
  const g = P.g; g.save();
  const rnd = P.rnd, duo = isDuo(P), rmax = P.s * (0.085 + rnd() * 0.035), rmin = rmax * (0.5 + rnd() * 0.12);
  const meltAll = 0.35 + rnd() * 0.65, spin = rnd() < 0.3 ? Math.PI : 0.45 + rnd() * 0.5, warp = 0.6 + rnd() * 0.7;
  const style = duo ? ["shadow", "mix", "shadow"][(rnd() * 3) | 0] : "solid", N1 = perlin(P.seed + 17), N2 = perlin(P.seed + 48);
  const spots = dartPack(P, rmax, rmin, { sp: 0.9 + rnd() * 0.08, effort: 2 });
  const items = spots.map((c, i) => {
    const m = clamp(meltAll * (0.25 + rnd() * 1.1), 0, 1);
    const n = clamp(Math.round(c.r * 0.55), 22, 80);
    const f = meltFace(rnd, N1, N2, m, { warp, n });
    return { ...f, x: c.x, y: c.y, r: c.r * f.scale, reach: 1 / f.scale, rot: (rnd() - 0.5) * 2 * spin, ink: style === "mix" && rnd() < 0.45 ? 2 : 1, shadow: style === "shadow" };
  });
  items.sort((a, b) => b.y - a.y);   // lower faces first, so drips run over the ones below
  // drops in the gaps
  const drops = gapDrops(P, items, rmin * 0.34, 1.15, 3.2), A = new Path2D(), B2 = new Path2D();
  for (const d of drops) {
    const k = 5 + ((rnd() * 3) | 0), pts = blobPts(rnd, d.r, k, 0.5, 1 + rnd() * 0.5, 1, rnd() * TAU), p = duo && rnd() < 0.5 ? B2 : A;
    for (let i = 0; i < pts.length; i += 2) { pts[i] += d.x; pts[i + 1] += d.y; }
    smoothPoly(p, pts);
  }
  g.fillStyle = rgba(P.fg); g.fill(A); g.fillStyle = rgba(P.fg2); g.fill(B2);
  const gap = Math.max(1, P.s * 0.007), sh = style === "shadow" ? [P.s * 0.012, P.s * 0.014] : null;
  drawStickers(P, items, gap, sh);
  g.restore();
}

/* ---------- GHOSTS: comma-tailed wisps and sheet ghosts with a scalloped hem ---------- */
function ghostShape(rnd, seed, kind, o) {
  const N1 = perlin(seed), sway = (rnd() - 0.5) * 0.5;
  let F, maxY;
  const armL = rnd() < 0.7, arms = [[-0.82, 0.45, -1.3, 0.1 + (rnd() - 0.5) * 0.6], [0.82, 0.45, 1.3, 0.1 + (rnd() - 0.5) * 0.6]];
  const armF = (x, y, v) => {
    if (!armL) return v;
    for (const [x0, y0, x1, y1] of arms) {
      const vx = x1 - x0, vy = y1 - y0, t = clamp(((x - x0) * vx + (y - y0) * vy) / (vx * vx + vy * vy), 0, 1);
      v = smax(v, 0.17 * (1 - 0.25 * t) - Math.hypot(x - x0 - vx * t, y - y0 - vy * t), 0.2);
    }
    return v;
  };
  if (kind === "wisp") {
    // discs down a curving spine: a big head, the tail tapering into a curl
    const curl = (rnd() < 0.5 ? -1 : 1) * (0.9 + rnd() * 0.8), len = 1.7 + rnd() * 0.6, k = 14, cs = [];
    for (let i = 0; i <= k; i++) {
      const t = i / k, a = curl * t * t * 1.9, r = Math.pow(1 - t, 0.85) * (t < 0.25 ? 1 : 1 - (t - 0.25) * 0.3) + 0.04;
      cs.push([Math.sin(a) * len * t * 0.85, len * t * Math.cos(a * 0.7), r]);
    }
    maxY = Math.max(...cs.map(c => c[1] + c[2])) + 0.1;
    F = (x, y) => {
      let v = -9;   // tapered capsules between spine points
      for (let i = 0; i < k; i++) {
        const [ax, ay, ar] = cs[i], [bx, by, br] = cs[i + 1], vx = bx - ax, vy = by - ay;
        const t = clamp(((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy), 0, 1), d = ar + (br - ar) * t - Math.hypot(x - ax - vx * t, y - ay - vy * t);
        if (d > v) v = d;
      }
      return armF(x, y, v) + N1(x * 1.3, y * 1.3) * 0.04;
    };
  } else {
    // sheet ghost: a dome on straight sides that flare a little, the hem a row of round lobes
    const nb = 3 + ((rnd() * 3) | 0), hem = 1.0 + rnd() * 0.45, flare = 0.05 + rnd() * 0.2, lob = 1 / nb * (1.05 + rnd() * 0.2);
    maxY = hem + lob * 1.2 + 0.1;
    const lobes = []; for (let i = 0; i < nb; i++) lobes.push([-1 - flare + (2 + 2 * flare) * (i + 0.5) / nb, hem + (rnd() - 0.5) * 0.08]);
    F = (X, y) => {
      const x = X - sway * Math.max(0, y) ** 2;
      const half = 1 + flare * clamp(y / hem, 0, 1), side = half - Math.abs(x), dome = 1 - Math.hypot(x, Math.min(0, y));
      let v = Math.min(y > 0 ? side : dome, hem - y);
      for (const [lx, ly] of lobes) v = smax(v, lob - Math.hypot(x - lx, y - ly), 0.06);
      return armF(X, y, v) + N1(X * 1.3, y * 1.3) * 0.035;
    };
  }
  const B = Math.max(1.75, (maxY + 1.3) / 2), oyB = maxY - B + 0.15;
  const fb = fieldBody(F, B, oyB, o.n), body = fb.path;
  // face: big hollow eyes and a mouth, all knocked out to the ground
  const feats = new Path2D(), es = 0.9 + rnd() * 0.3, ey = -0.18 + (rnd() - 0.5) * 0.1, ex = 0.34 + rnd() * 0.06, et = rnd(), lean = (rnd() - 0.5) * 0.3;
  for (const sg of [-1, 1]) {
    if (et < 0.6) smoothPoly(feats, ellPts(sg * ex + lean * 0.3, ey, 0.13 * es, 0.21 * es, sg * 0.12));   // tall eyes
    else if (et < 0.85) smoothPoly(feats, ellPts(sg * ex + lean * 0.3, ey, 0.15 * es, 0.15 * es));      // round eyes
    else {                                                                                            // sleepy half-moons
      const p = []; for (let i = 0; i <= 12; i++) { const a = i / 12 * Math.PI; p.push(sg * ex + Math.cos(a) * 0.16 * es, ey - 0.03 + Math.sin(a) * 0.13 * es); }
      smoothPoly(feats, p);
    }
  }
  const mt = rnd(), my = 0.28 + rnd() * 0.1, mx = lean * 0.4;
  if (mt < 0.4) smoothPoly(feats, ellPts(mx, my + 0.04, 0.1 + rnd() * 0.05, 0.14 + rnd() * 0.08));   // "ooo"
  else if (mt < 0.7) {   // open grin: a half disc, flat side up
    const w = 0.24 + rnd() * 0.1, h = 0.18 + rnd() * 0.08, p = [];
    for (let i = 0; i <= 14; i++) { const a = i / 14 * Math.PI; p.push(mx + Math.cos(a) * w, my + Math.sin(a) * h); }
    p.push(mx - w * 0.5, my - 0.02, mx + w * 0.5, my - 0.02);
    smoothPoly(feats, p);
  } else {               // little smile
    const w = 0.2 + rnd() * 0.1;
    smoothPoly(feats, strokePts((t) => [mx - w + 2 * w * t, my + Math.sin(t * Math.PI) * w * 0.55], () => 0.05, 18));
  }
  return { body, feats: [feats], bx: fb.cx, by: fb.cy, scale: 1 / fb.rad };
}
function ghosts(P) {
  const g = P.g; g.save();
  const rnd = P.rnd, duo = isDuo(P), rmax = P.s * (0.08 + rnd() * 0.03), rmin = rmax * (0.45 + rnd() * 0.15);
  const wispy = rnd(), spin = 0.25 + rnd() * 0.7, style = duo ? (rnd() < 0.55 ? "mix" : "shadow") : "solid";
  const spots = dartPack(P, rmax, rmin, { sp: 0.86 + rnd() * 0.08, effort: 2 });
  const items = spots.map((c, i) => {
    const n = clamp(Math.round(c.r * 0.55), 22, 80), kind = rnd() < 0.15 + wispy * 0.7 ? "wisp" : "sheet";
    const f = ghostShape(rnd, (P.seed * 71 + i * 613) >>> 0, kind, { n });
    return { ...f, x: c.x, y: c.y, r: c.r * f.scale, rot: (rnd() - 0.5) * 2 * spin, ink: style === "mix" && rnd() < 0.5 ? 2 : 1, shadow: style === "shadow" };
  });
  for (let i = items.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [items[i], items[j]] = [items[j], items[i]]; }
  drawStickers(P, items, Math.max(1, P.s * 0.007), style === "shadow" ? [P.s * 0.012, P.s * 0.014] : null);
  g.restore();
}

/* ---------- EYES: packed almond eyes looking every which way ---------- */
function eyes(P) {
  const g = P.g; g.save();
  const rnd = P.rnd, duo = isDuo(P), rmax = P.s * (0.085 + rnd() * 0.035), rmin = rmax * (0.42 + rnd() * 0.15);
  const lashy = rnd(), spin = rnd() < 0.35 ? Math.PI : 0.2 + rnd() * 0.6, gaze = (rnd() - 0.5) * 2, focus = rnd();
  const spots = dartPack(P, rmax, rmin, { sp: 0.78 + rnd() * 0.08, effort: 2.5 });
  const gap = Math.max(1, P.s * 0.007), inkA = rgba(P.fg), inkB = rgba(duo ? P.fg2 : P.fg), hollow = duo && rnd() < 0.4;
  for (let i = spots.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [spots[i], spots[j]] = [spots[j], spots[i]]; }
  for (const c of spots) {
    const h = 0.5 + rnd() * 0.22, lo = 0.75 + rnd() * 0.35, rot = (rnd() - 0.5) * 2 * spin;
    const ir = 0.42 + rnd() * 0.1, ga = focus < 0.5 ? gaze * 1.3 + (rnd() - 0.5) * 0.6 : rnd() * TAU, gd = rnd() * 0.32;
    const icx = Math.cos(ga) * gd, icy = Math.sin(ga) * gd * 0.45, lashes = rnd() < lashy ? 5 + ((rnd() * 3) | 0) : 0;
    if (!P.vis(c.x, c.y, c.r * 1.6)) continue;
    const k = 1.33, top = -h * k, bot = h * k * lo;
    const eye = new Path2D(); eye.moveTo(-1, 0); eye.bezierCurveTo(-0.45, top, 0.45, top, 1, 0); eye.bezierCurveTo(0.45, bot, -0.45, bot, -1, 0); eye.closePath();
    const body = new Path2D(eye);
    // lashes: tapered spikes off the upper lid
    if (lashes) for (let q = 0; q < lashes; q++) {
      const t = 0.2 + 0.6 * q / (lashes - 1), u = 1 - t, x = u ** 3 * -1 + 3 * u * u * t * -0.45 + 3 * u * t * t * 0.45 + t ** 3, y = 3 * u * u * t * top + 3 * u * t * t * top;
      const dx = 3 * u * u * 0.55 + 6 * u * t * 0.9 + 3 * t * t * 0.55, dy = 3 * u * u * top - 3 * t * t * top, d = Math.hypot(dx, dy), nx = dy / d, ny = -dx / d;
      const L = 0.28 + 0.1 * Math.sin(t * Math.PI), w = 0.07, tx = dx / d, ty = dy / d, lean = (t - 0.5) * 0.9;
      const ex = x + (nx + tx * lean) * L, ey = y + (ny + ty * lean) * L;
      body.moveTo(x - tx * w, y - ty * w); body.quadraticCurveTo(x + nx * L * 0.5 - tx * w * 0.5, y + ny * L * 0.5 - ty * w * 0.5, ex, ey);
      body.quadraticCurveTo(x + nx * L * 0.5 + tx * w * 0.5, y + ny * L * 0.5 + ty * w * 0.5, x + tx * w, y + ty * w); body.closePath();
    }
    const R = c.r * 1.12;
    g.save(); g.translate(c.x, c.y); g.rotate(rot); g.scale(R, R);
    g.lineJoin = "round"; g.globalCompositeOperation = "destination-out"; g.fillStyle = "#000"; g.strokeStyle = "#000"; g.lineWidth = 2 * gap / R;
    g.fill(body); g.stroke(body);
    g.globalCompositeOperation = "source-over"; g.fillStyle = inkA; g.fill(body);
    // inside the eye: the white is cut to the ground, then iris, pupil, glint
    g.save(); g.clip(eye);
    const cut = Math.max(0.06, gap * 1.5 / R);
    g.globalCompositeOperation = "destination-out";
    if (hollow) { g.save(); g.scale(1 - cut * 1.4, 1 - cut * 1.4 / h); g.fill(eye); g.restore(); }   // the white cut away, a rim left
    else { g.beginPath(); g.arc(icx, icy, ir + cut, 0, TAU); g.fill(); }                          // a ground ring round the iris
    g.globalCompositeOperation = "source-over";
    const iris = new Path2D(); iris.arc(icx, icy, ir, 0, TAU);
    g.fillStyle = inkB; g.fill(iris);
    if (!duo) { g.globalCompositeOperation = "destination-out"; g.lineWidth = ir * 0.14; g.beginPath(); g.arc(icx, icy, ir * 0.7, 0, TAU); g.stroke(); g.globalCompositeOperation = "source-over"; }
    g.globalCompositeOperation = "destination-out"; g.beginPath(); g.arc(icx, icy, ir * 0.42, 0, TAU); g.fill();
    g.globalCompositeOperation = "source-over"; g.fillStyle = inkA; g.beginPath(); g.ellipse(icx + ir * 0.22, icy - ir * 0.22, ir * 0.13, ir * 0.11, 0, 0, TAU); g.fill();
    g.restore();
    g.restore();
  }
  g.restore();
}

/* ---------- DAISY: 60s flower power ---------- */
/* n petals of length R from radius r0, half width w, into path (all petals wound the same way, so they union) */
function petals(path, n, r0, R, w, a0, pinch = 1.25, tip = 0.8) {
  for (let i = 0; i < n; i++) {
    const a = a0 + i * TAU / n, c = Math.cos(a), s = Math.sin(a), at = (u, v) => [u * c - v * s, u * s + v * c];
    const L = R - r0, P0 = at(r0, 0), P1 = at(r0 + L * 0.3, -w * pinch), P2 = at(R, -w * tip), P3 = at(R, 0), P4 = at(R, w * tip), P5 = at(r0 + L * 0.3, w * pinch);
    path.moveTo(P0[0], P0[1]); path.bezierCurveTo(P1[0], P1[1], P2[0], P2[1], P3[0], P3[1]); path.bezierCurveTo(P4[0], P4[1], P5[0], P5[1], P0[0], P0[1]); path.closePath();
  }
}
function daisyFlower(rnd, kind, duo) {
  const body = new Path2D(), feats = [], over = [], a0 = rnd() * TAU;
  let n, rc;
  if (kind === "power") {        // five or six fat round petals
    n = 5 + (rnd() < 0.4); rc = 0.28 + rnd() * 0.06;
    petals(body, n, 0, 1, Math.sin(Math.PI / n) * (0.62 + rnd() * 0.12), a0, 1.15, 0.95);
  } else if (kind === "daisy") { // many slim petals
    n = 11 + ((rnd() * 7) | 0); rc = 0.24 + rnd() * 0.06;
    petals(body, n, 0.12, 1, Math.sin(Math.PI / n) * (0.75 + rnd() * 0.15), a0, 1.1, 0.85);
  } else {                       // pointed: seven to nine almond petals
    n = 7 + ((rnd() * 3) | 0); rc = 0.26 + rnd() * 0.05;
    petals(body, n, 0.05, 1, Math.sin(Math.PI / n) * 0.75, a0, 1.25, 0.25);
  }
  body.moveTo(rc * 1.1, 0); body.arc(0, 0, rc * 1.1, 0, TAU);
  const inner = rnd() < 0.4 && kind !== "daisy";
  // the centre: a ring cut to the ground, then a disc (the other ink in duo)
  const ring = new Path2D(), disc = new Path2D(), r1 = inner ? 0.6 : rc;
  if (inner) {
    const ip = new Path2D(), ri = new Path2D(); petals(ip, n, 0, 0.62, Math.sin(Math.PI / n) * 0.45, a0 + Math.PI / n, 1.1, 0.9);
    // inner petals outlined by a cut, printed in the second ink (or the first, separated by the cut)
    feats.push(ip); over.push([ip, 2, 0.06]);
    ring.moveTo(rc * 0.8 + 0.06, 0); ring.arc(0, 0, rc * 0.8 + 0.06, 0, TAU); disc.moveTo(rc * 0.8, 0); disc.arc(0, 0, rc * 0.8, 0, TAU);
    over.push([ring, 0], [disc, 1]);
    return { body, feats, over, inner: true };
  }
  ring.moveTo(rc + 0.07, 0); ring.arc(0, 0, rc + 0.07, 0, TAU); disc.moveTo(rc, 0); disc.arc(0, 0, rc, 0, TAU);
  feats.push(ring); over.push([disc, 2]);
  if (rnd() < 0.35) { const d2 = new Path2D(); d2.moveTo(rc * 0.38, 0); d2.arc(0, 0, rc * 0.38, 0, TAU); over.push([d2, 0]); }
  return { body, feats, over };
}
function daisy(P) {
  const g = P.g; g.save();
  const rnd = P.rnd, duo = isDuo(P), rmax = P.s * (0.13 + rnd() * 0.06), rmin = P.s * (0.028 + rnd() * 0.012);
  const mixK = rnd(), kinds = mixK < 0.35 ? ["power"] : mixK < 0.55 ? ["daisy"] : mixK < 0.7 ? ["power", "daisy"] : ["power", "daisy", "pointed"];
  const spots = dartPack(P, rmax, rmin, { sp: 0.86 + rnd() * 0.1, decay: 0.8 });
  const gap = Math.max(1, P.s * 0.0065), swap = duo && rnd() < 0.5;
  const ink = (k) => (k === 0 ? 0 : swap ? 3 - k : k);
  for (let i = spots.length - 1; i >= 0; i--) {   // smallest on top: they settle into the gaps over the big ones' petal tips
    const c = spots[i]; if (!P.vis(c.x, c.y, c.r * 1.2)) { rnd(); continue; }
    const kind = c.r < rmax * 0.4 ? "power" : kinds[(rnd() * kinds.length) | 0];
    const f = daisyFlower(rnd, kind, duo), rot = rnd() * TAU;
    g.save(); g.translate(c.x, c.y); g.rotate(rot); g.scale(c.r, c.r);
    g.globalCompositeOperation = "destination-out"; g.fillStyle = "#000"; g.strokeStyle = "#000"; g.lineJoin = "round"; g.lineWidth = 2 * gap / c.r;
    g.fill(f.body); g.stroke(f.body);
    g.globalCompositeOperation = "source-over"; g.fillStyle = rgba(ink(1) === 2 ? P.fg2 : P.fg); g.fill(f.body);
    for (const ft of f.feats) {   // cut: a feature path widened by its own stroke
      g.globalCompositeOperation = "destination-out"; g.fillStyle = "#000"; g.fill(ft); g.lineWidth = 2 * gap / c.r; g.stroke(ft);
    }
    g.globalCompositeOperation = "source-over";
    for (const [p, k] of f.over) {
      if (k === 0) { g.globalCompositeOperation = "destination-out"; g.fillStyle = "#000"; g.fill(p); g.globalCompositeOperation = "source-over"; continue; }
      g.fillStyle = rgba(ink(k) === 2 ? P.fg2 : P.fg); g.fill(p);
    }
    g.restore();
  }
  g.restore();
}

/* ======================================================================
   HARDWARE: perforated grille, wire mesh, carbon twill, tread plate. Still two inks on a clear ground: the
   material is all in the ink's alpha (bevels, tube highlights, a spotlight or a sheen band), never a new colour.
   Relief turns with the palette: where the ink is lighter than the ground a highlight is more ink, where it is
   darker a highlight is less ink, so the same light reads in any palette. Tiles are shaded per pixel, supersampled.
   ====================================================================== */
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/* A tile shaded per pixel: f(x, y, o) sets o[0] = tone 0..1 (ink alpha) and o[1] = ink (1 = fg, 2 = fg2) at a point
   in tile pixels. One sample per pixel first; wherever that jumps between neighbours (an edge) the pixel is
   supersampled, so edges come out anti-aliased however the shader cuts them, and smooth shading stays cheap. */
function shadeTile(P, name, tw, th, f) {
  tw = Math.max(2, Math.round(tw)); th = Math.max(2, Math.round(th));
  // a generator: a big render builds the tile in steps (see tile), a small one straight through
  return tile(P, name, tw, th, function* (g) {
    const n = tw * th > 150000 ? 3 : 4, nn = n * n, im = g.createImageData(tw, th), d = im.data, o = [0, 1], C = [null, P.fg, P.fg2];
    const N = tw * th, T1 = new Float32Array(N), K1 = new Uint8Array(N), rows = Math.max(1, Math.floor(60000 / tw));
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) { o[0] = 0; o[1] = 1; f(x + 0.5, y + 0.5, o); const i = y * tw + x; T1[i] = o[0] > 0 ? o[0] : 0; K1[i] = o[1]; }
      if (y % rows === rows - 1) yield;
    }
    const jump = (i, j) => Math.abs(T1[i] - T1[j]) > 0.06 || (K1[i] !== K1[j] && T1[i] + T1[j] > 0);
    for (let y = 0; y < th; y++) {
      if (y && y % rows === 0) yield;
      for (let x = 0; x < tw; x++) {
        const i = y * tw + x, xl = y * tw + (x + tw - 1) % tw, xr = y * tw + (x + 1) % tw, yu = ((y + th - 1) % th) * tw + x, yd = ((y + 1) % th) * tw + x;
        let r, gr, b, a;
        if (jump(i, xl) || jump(i, xr) || jump(i, yu) || jump(i, yd)) {
          r = gr = b = a = 0;
          for (let jj = 0; jj < n; jj++) for (let ii = 0; ii < n; ii++) {
            o[0] = 0; o[1] = 1; f(x + (ii + 0.5) / n, y + (jj + 0.5) / n, o);
            const t = o[0]; if (!(t > 0)) continue;
            const c = C[o[1]] || P.fg; r += c[0] * t; gr += c[1] * t; b += c[2] * t; a += t;
          }
          a /= nn; if (a <= 0) continue; const k = 1 / (a * nn); r *= k; gr *= k; b *= k;
        } else {
          a = T1[i]; if (a <= 0) continue; const c = C[K1[i]] || P.fg; r = c[0]; gr = c[1]; b = c[2];
        }
        const q = i * 4; d[q] = r; d[q + 1] = gr; d[q + 2] = b; d[q + 3] = Math.min(1, a) * 255;
      }
    }
    g.putImageData(im, 0, 0);
  });
}
/* +1 when the ink is the light side of this palette, -1 when it is the dark side. */
const hwSign = (P) => lum(P.fg) >= lum(P.bg) ? 1 : -1;
/* The direction the light comes from, in tile space: from the upper left, give or take. */
function hwLight(r) { const a = -Math.PI * 0.72 + (r() - 0.5) * 0.7; return [Math.cos(a), Math.sin(a)]; }

/* Where the light falls, as an alpha mask in pattern space: a soft spot or a sheen band across the sleeve. */
function hwSpot(P) {
  const r = P.rnd, S = P.S, x = (r() - 0.5) * S * 0.7, y = (r() - 0.5) * S * 0.5 - S * 0.12, R = S * (0.5 + r() * 0.4);
  return (g) => {
    const G = g.createRadialGradient(x, y, 0, x, y, R);
    for (let i = 0; i <= 10; i++) G.addColorStop(i / 10, `rgba(0,0,0,${(1 - smooth(0, 1, i / 10)).toFixed(3)})`);
    return G;
  };
}
function hwBand(P) {
  const r = P.rnd, S = P.S, a = (r() < 0.5 ? -1 : 1) * (0.45 + r() * 0.6), off = (r() - 0.5) * S * 0.5, w = S * (0.28 + r() * 0.3);
  const dx = Math.cos(a), dy = Math.sin(a);
  return (g) => {
    const G = g.createLinearGradient(dx * (off - w), dy * (off - w), dx * (off + w), dy * (off + w));
    for (let i = 0; i <= 12; i++) G.addColorStop(i / 12, `rgba(0,0,0,${(1 - smooth(0, 1, Math.abs(i / 6 - 1))).toFixed(3)})`);
    return G;
  };
}
/* Lays tile `dim` everywhere and tile `lit` where the light mask m is: dim·(1−m) + lit·m, an exact blend
   ("lighter" adds premultiplied colour), so the light changes the relief, not just the strength. */
function hwLit(P, dim, lit, ox, oy, mask) {
  fillTile(P, dim, ox, oy);
  if (P.fills) { fillTile(P, lit, ox, oy); return; }   // two fills: drawn in a layer
  const g = P.g, R = P.R, L = makeCanvas(P.W, P.H), lg = L.getContext("2d");
  g.save(); g.globalCompositeOperation = "destination-out"; g.fillStyle = mask(g); g.fillRect(-R, -R, 2 * R, 2 * R); g.restore();
  lg.setTransform(g.getTransform());
  const pat = lg.createPattern(lit, "repeat");
  if ((ox || oy) && pat.setTransform) pat.setTransform(new DOMMatrix([1, 0, 0, 1, Math.round(ox), Math.round(oy)]));
  lg.fillStyle = pat; lg.fillRect(-R, -R, 2 * R, 2 * R);
  lg.globalCompositeOperation = "destination-in"; lg.fillStyle = mask(lg); lg.fillRect(-R, -R, 2 * R, 2 * R);
  screen(P, (sg) => { sg.globalCompositeOperation = "lighter"; sg.drawImage(L, 0, 0); });
  release(L);
}

/* Grille: a perforated sheet (round, hex, square or slotted holes); the holes are clear ground. Each hole has a
   pressed rim and a wall, lit on one side and shaded on the other, and a spotlight or sheen band lifts the metal. */
function grille(P) {
  const r = P.rnd, sg = hwSign(P), [Lx, Ly] = hwLight(r);
  const kind = ["round", "round", "round", "hex", "hex", "square", "slot"][(r() * 7) | 0];
  const p = Math.max(6, P.s * (0.024 + r() * 0.03));
  let tw, th, cs, sd, rad;
  if (kind === "round" || kind === "hex") {
    // staggered rows (60°): every hole has six equal neighbours
    tw = Math.round(p); th = Math.round(p * Math.sqrt(3)); cs = [[0, 0], [tw / 2, th / 2]];
    rad = tw * (kind === "hex" ? 0.3 + r() * 0.16 : 0.26 + r() * 0.15);
    if (kind === "round") sd = (x, y) => Math.hypot(x, y) - rad;
    else sd = (x, y) => {   // hexagon with flat sides facing the neighbours left and right; rad = apothem
      let px = Math.abs(y), py = Math.abs(x); const kx = -0.866025404, ky = 0.5, kz = 0.577350269;
      const m = 2 * Math.min(kx * px + ky * py, 0); px -= m * kx; py -= m * ky;
      px -= clamp(px, -kz * rad, kz * rad); py -= rad;
      return Math.hypot(px, py) * Math.sign(py);
    };
  } else if (kind === "square") {
    // a square grid, the holes sometimes turned to diamonds
    tw = th = Math.round(p * 0.9); cs = [[tw / 2, th / 2]];
    const turn = r() < 0.5, b = tw * (turn ? 0.26 + r() * 0.07 : 0.3 + r() * 0.1), rr = b * (0.15 + r() * 0.35);
    rad = b;
    sd = (x, y) => {
      if (turn) { const u = (x + y) * Math.SQRT1_2, v = (x - y) * Math.SQRT1_2; x = u; y = v; }
      const qx = Math.abs(x) - (b - rr), qy = Math.abs(y) - (b - rr);
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rr;
    };
  } else {
    // slots in brick rows
    const c = p * (0.17 + r() * 0.08), a = p * (0.5 + r() * 0.5), wb = p * (0.16 + r() * 0.1);
    tw = Math.round(2 * (a + c) + wb); th = Math.round(2 * (2 * c + wb)); cs = [[tw / 2, th / 4], [0, th * 0.75]];
    rad = c;
    sd = (x, y) => Math.hypot(Math.max(Math.abs(x) - a, 0), y) - c;
  }
  // every centre and its copies in the neighbouring tiles
  const all = []; for (const [x, y] of cs) for (const dy of [-th, 0, th]) for (const dx of [-tw, 0, tw]) all.push(x + dx, y + dy);
  const web = Math.max(1, Math.min(tw, th) * 0.5 - rad);
  const bw = Math.min(web * 0.9, rad * (0.4 + r() * 0.3)), ww = rad * (0.12 + r() * 0.12), e = 0.25;
  const shade = (T0, rel, wallT) => (x, y, o) => {
    let best = 1e9, cx = 0, cy = 0;
    for (let i = 0; i < all.length; i += 2) { const d = sd(x - all[i], y - all[i + 1]); if (d < best) { best = d; cx = all[i]; cy = all[i + 1]; } }
    if (best < -ww) return;   // through the hole: ground
    let nx = sd(x - cx + e, y - cy) - sd(x - cx - e, y - cy), ny = sd(x - cx, y - cy + e) - sd(x - cx, y - cy - e);
    const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
    const face = -(nx * Lx + ny * Ly);   // > 0: this side of the hole faces the light
    if (best < 0) {   // the hole's wall, seen at the edge: only the side that stands out from the ground
      const t = Math.max(0, sg * face) * wallT * smooth(-ww, -ww * 0.3, best);
      o[0] = t; o[1] = face > 0.3 ? 2 : 1; return;
    }
    const slope = 1 - smooth(0, bw, best);
    o[0] = clamp(T0 + sg * rel * slope * slope * face, 0, 1); o[1] = face * slope > 0.35 ? 2 : 1;
  };
  const dim = shadeTile(P, "grille", tw, th, shade(0.5, 0.5, 0.6));
  const lit = shadeTile(P, "grille-lit", tw, th, shade(0.74, 0.6, 0.95));
  hwLit(P, dim, lit, -tw / 2, -th / 2, r() < 0.65 ? hwSpot(P) : hwBand(P));
}

/* Mesh: woven wire, diamond chain-link or square cloth. Round wires with a highlight, each one over at one
   crossing and under at the next; the under wire stops short of the over wire and sits in its shadow. */
function mesh(P) {
  const r = P.rnd, sg = hwSign(P), [Lx, Ly] = hwLight(r), sq = r() < 0.3;
  const lz = 0.9, ln = Math.hypot(Lx, Ly, lz), L3 = [Lx / ln, Ly / ln, lz / ln], hn = Math.hypot(L3[0], L3[1], L3[2] + 1), H3 = [L3[0] / hn, L3[1] / hn, (L3[2] + 1) / hn];
  let tw, th, coords, t;
  if (sq) {
    const c = Math.max(4, Math.round(P.s * (0.026 + r() * 0.022))); tw = th = 2 * c; t = c * (0.3 + r() * 0.25);
    coords = (x, y) => [x / c, y / c, c, 1, 0, c, 0, 1];   // a, b, px per unit of a, its unit normal; same for b
  } else {
    tw = Math.max(6, Math.round(P.s * (0.05 + r() * 0.04))); th = Math.round(tw * (1 + r() * 0.6));
    t = Math.min(tw, th) * (0.13 + r() * 0.09);
    const gl = Math.hypot(1 / tw, 1 / th), sc = 1 / gl, nax = 1 / tw / gl, nay = -1 / th / gl, nbx = 1 / tw / gl, nby = 1 / th / gl;
    coords = (x, y) => [x / tw - y / th, x / tw + y / th, sc, nax, nay, sc, nbx, nby];
  }
  const half = t / 2, gap = Math.max(0.6, t * 0.18);
  const shade = (T0, rel, sp) => (x, y, o) => {
    const [a, b, sa, nax, nay, sb, nbx, nby] = coords(x, y), ka = Math.round(a), kb = Math.round(b);
    const da = (a - ka) * sa, db = (b - kb) * sb, ga = Math.abs(da) - half, gb = Math.abs(db) - half;
    if (ga > 0 && gb > 0) return;
    const odd = (ka + kb) & 1, hA = (odd ? 1 : -1) * Math.cos(Math.PI * (b - kb)), hB = (odd ? -1 : 1) * Math.cos(Math.PI * (a - ka));
    let w = 0, gOver = 1e9;
    if (hA >= hB) { if (ga < 0) w = 1; else if (gb < 0 && ga > gap) { w = 2; gOver = ga; } }
    else { if (gb < 0) w = 2; else if (ga < 0 && gb > gap) { w = 1; gOver = gb; } }
    if (!w) return;
    // round wire: the normal swings across its width; Blinn highlight
    const ev = clamp((w === 1 ? da : db) / half, -1, 1), nx = w === 1 ? nax : nbx, ny = w === 1 ? nay : nby, nz = Math.sqrt(1 - ev * ev);
    const N0 = ev * nx, N1 = ev * ny, dif = Math.max(0, N0 * L3[0] + N1 * L3[1] + nz * L3[2]);
    const spec = Math.pow(Math.max(0, N0 * H3[0] + N1 * H3[1] + nz * H3[2]), 18);
    const h = w === 1 ? hA : hB, shadow = gOver < 1e9 ? 0.72 + 0.28 * smooth(gap, gap + t, gOver) : 1;
    const bright = (0.2 + 0.65 * dif + sp * spec) * (0.9 + 0.1 * h) * shadow;   // ~0.5 is a mid tone
    o[0] = clamp(T0 + sg * rel * (bright - 0.5), 0.12, 1); o[1] = w;
  };
  const dim = shadeTile(P, "mesh", tw, th, shade(0.62, 0.9, 0.45));
  const lit = shadeTile(P, "mesh-lit", tw, th, shade(0.8, 1.2, 0.8));
  hwLit(P, dim, lit, -tw / 2, -th / 2, r() < 0.7 ? hwSpot(P) : hwBand(P));
}

/* Carbon: 2×2 twill. Tows float over two and under two, stepping one across each row; warp and weft catch the
   light differently, and inside the sheen band the two swap (the way carbon flips as it turns). */
function carbon(P) {
  const r = P.rnd, sg = hwSign(P), c = Math.max(3, Math.round(P.s * (0.014 + r() * 0.014))), T = c * 4;
  const side = 0.03 + r() * 0.03, duo = P.fg2.join() !== P.fg.join(), fib = c >= 14 ? Math.max(3, Math.round(c / 4)) : 0, streak = (r() - 0.5) * 0.8;
  const shade = (warpT, weftT, glint) => (x, y, o) => {
    const i = Math.floor(x / c), j = Math.floor(y / c), fx = x / c - i, fy = y / c - j, k = ((i - j) % 4 + 4) % 4, warp = k < 2;
    const e = warp ? fx * 2 - 1 : fy * 2 - 1, a = warp ? (k === 1 ? fy : 1 + fy) / 2 : (k === 2 ? fx : 1 + fx) / 2;
    const ae = Math.min(a, 1 - a), base = warp ? warpT : weftT;
    // the crease between tows: a dark line in the cloth (the far side of the relief), not a gap
    if (Math.abs(e) > 1 - side * 2 || ae < side) { o[0] = clamp(base - sg * base * 0.55, 0, 1); return; }
    const en = smooth(0, 0.2, ae), pr = Math.sqrt(1 - e * e * 0.85);
    const gl = Math.exp(-(((e - streak) / 0.2) ** 2)) * en;
    let s = (0.5 + 0.5 * pr) * (0.6 + 0.4 * en) + 0.2 * gl;
    if (fib) s *= 0.9 + 0.1 * Math.cos(e * Math.PI * fib);
    o[0] = clamp(base + sg * base * (s - 1), 0, 1); o[1] = glint && base > 0.8 && gl > 0.55 ? 2 : 1;
  };
  // the light swaps which way of the cloth is bright; with two inks, the glint it brings is the second
  const flipT = r() < 0.5;
  const dim = shadeTile(P, "carbon", T, T, flipT ? shade(0.42, 0.72, false) : shade(0.72, 0.42, false));
  const lit = shadeTile(P, "carbon-lit", T, T, flipT ? shade(0.95, 0.5, duo) : shade(0.5, 0.95, duo));
  hwLit(P, dim, lit, -T / 2, -T / 2, r() < 0.7 ? hwBand(P) : hwSpot(P));
}

/* Tread plate: raised lozenges, each turned across its neighbours, standing up off a faint plate. Domed bars
   with a highlight and a cast shadow; the spotlight brings up the plate and the glints. */
function tread(P) {
  const r = P.rnd, sg = hwSign(P), [Lx, Ly] = hwLight(r);
  const lz = 0.75, ln = Math.hypot(Lx, Ly, lz), L3 = [Lx / ln, Ly / ln, lz / ln], hn = Math.hypot(L3[0], L3[1], L3[2] + 1), H3 = [L3[0] / hn, L3[1] / hn, (L3[2] + 1) / hn];
  const q = Math.max(8, Math.round(P.s * (0.045 + r() * 0.035))), T = 2 * q;
  const A = q * (0.46 + r() * 0.08), C = q * (0.11 + r() * 0.04), rr = C * 0.4, A1 = A - rr, C1 = C - rr;
  const vr = (A1 * A1 / C1 + C1) / 2, vd = (A1 * A1 / C1 - C1) / 2;   // a vesica: two arcs radius vr, centres ±vd across
  const R2 = Math.SQRT1_2;
  const sd = (x, y) => {   // distance to the lozenge of the cell (x, y) is in, in tile pixels
    const i = Math.floor(x / q), j = Math.floor(y / q), lx = x - (i + 0.5) * q, ly = y - (j + 0.5) * q, s = (i + j) & 1 ? -1 : 1;
    const al = Math.abs((lx + s * ly) * R2), ac = Math.abs((s * lx - ly) * R2);
    return ((al - A1) * vd > ac * A1 ? Math.hypot(ac, al - A1) : Math.hypot(ac + vd, al) - vr) - rr;
  };
  const sh = C * (0.7 + r() * 0.5), e = 0.3;
  const shade = (plate, bar, rel, sp) => (x, y, o) => {
    const d = sd(x, y);
    if (d >= 0) {   // the plate, darkened where a bar stands between it and the light
      const inSh = sd(x + Lx * sh, y + Ly * sh) < 0 ? 1 : 0;
      o[0] = clamp(plate - sg * plate * 0.6 * inSh, 0, 1); return;
    }
    const tt = Math.min(1, -d / C), slope = Math.min(2.5, (1 - tt) / Math.sqrt(Math.max(1e-3, 1 - (1 - tt) ** 2))) * 0.7;
    let nx = sd(x + e, y) - sd(x - e, y), ny = sd(x, y + e) - sd(x, y - e); const nl = Math.hypot(nx, ny) || 1; nx = nx / nl * slope; ny = ny / nl * slope;
    const N = Math.hypot(nx, ny, 1), dif = Math.max(0, (nx * L3[0] + ny * L3[1] + L3[2]) / N);
    const spec = Math.pow(Math.max(0, (nx * H3[0] + ny * H3[1] + H3[2]) / N), 24);
    const bright = 0.15 + 0.75 * dif + sp * spec;
    o[0] = clamp(bar + sg * rel * (bright - 0.6), 0.1, 1); o[1] = spec > 0.35 ? 2 : 1;
  };
  const dim = shadeTile(P, "tread", T, T, shade(0.16, 0.62, 0.75, 0.4));
  const lit = shadeTile(P, "tread-lit", T, T, shade(0.3, 0.8, 1.0, 0.8));
  hwLit(P, dim, lit, -q / 2, -q / 2, r() < 0.7 ? hwSpot(P) : hwBand(P));
}

/* ======================================================================
   MICROBES: microscopic life as packed all-over repeats (amoebae, virions, tissue, molecules).
   Motifs are built once per seed as unit-space Path2D stacks (a library of variants, its own seeded stream, cached)
   and stamped over the visible area. Each stamp cuts a ground gap round its silhouette, so overlaps read as
   stacked; inner structure is cut to the ground and printed in the second ink with a ground keyline, so it holds
   in one ink as well as in two. Needs patterns-characters.js (dartPack, gapDrops, smax, isoLoops, smoothPoly...).
   ====================================================================== */
const bioCache = new Map();
function bioCached(key, build) {
  let v = bioCache.get(key);
  if (!v) { if (bioCache.size > 32) bioCache.clear(); v = build(); bioCache.set(key, v); }
  return v;
}
const bioRng = (P, tag) => mulberry32(hashStr("bio:" + tag + "#" + P.seed));
/* Shared paths here hold thousands of subpaths, and in Chromium closePath() and a rotated ellipse() each cost time
   in proportion to the whole path (building one goes quadratic), so shapes close with a lineTo back to the start
   and ellipses are drawn as eight quadratic arcs. */
const bioDisc = (p, x, y, r) => { p.moveTo(x + r, y); p.arc(x, y, r, 0, TAU); return p; };
const BIO_Q = 1 / Math.cos(Math.PI / 8);
function bioEll(p, x, y, rx, ry, rot = 0) {
  const c = Math.cos(rot), s = Math.sin(rot), at = (a, k) => { const u = Math.cos(a) * rx * k, v = Math.sin(a) * ry * k; return [x + u * c - v * s, y + u * s + v * c]; };
  const p0 = at(0, 1); p.moveTo(p0[0], p0[1]);
  for (let i = 0; i < 8; i++) { const q = at((i + 0.5) * Math.PI / 4, BIO_Q), e = at((i + 1) * Math.PI / 4, 1); p.quadraticCurveTo(q[0], q[1], e[0], e[1]); }
  return p;
}
const bioLine = (p, pts) => { p.moveTo(pts[0], pts[1]); for (let i = 2; i < pts.length; i += 2) p.lineTo(pts[i], pts[i + 1]); return p; };
const bioPoly = (p, pts) => { bioLine(p, pts); p.lineTo(pts[0], pts[1]); return p; };
/* A field sampled once on an n×n grid over [-B, B]²; iso(thr) contours { F > thr } into a smoothed Path2D. */
function bioField(F, B, n) {
  const cs = 2 * B / n, V = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) V[j * n + i] = (i < 2 || j < 2 || i > n - 3 || j > n - 3) ? -9 : F(-B + i * cs, -B + j * cs);
  return {
    V, n, B, cs,
    at: (x, y) => { const i = Math.round((x + B) / cs), j = Math.round((y + B) / cs); return i < 0 || j < 0 || i >= n || j >= n ? -9 : V[j * n + i]; },
    iso(thr) {
      const W = thr ? V.map(v => v - thr) : V, out = new Path2D();
      for (const L of isoLoops(W, n, cs)) {   // thinned to about one point per 1.6 cells: smooth enough, half the path
        const K = []; let lx = 1e9, ly = 1e9;
        for (let i = 0; i < L.length; i += 2) { const x = L[i] - B, y = L[i + 1] - B; if ((x - lx) ** 2 + (y - ly) ** 2 >= (cs * 1.6) ** 2) { K.push(x, y); lx = x; ly = y; } }
        if (K.length >= 8) smoothPoly(out, K);
      }
      return out;
    },
  };
}
/* Stamp motifs. A motif: { R (extent radius), sil: [[path, lw]] (lw 0 = fill) for the ground gap,
   ops: [[op, path, ink, lw]] with op "f" fill / "s" stroke / "xf" "xs" the same cut to the ground }.
   Item: { x, y, r (on-screen radius), rot, flip, swap (inks 1 and 2 exchanged), m }. */
function bioStamp(P, items, gap) {
  const g = P.g, ink = [null, rgba(P.fg), rgba(P.fg2)];
  g.save(); g.lineJoin = "round"; g.lineCap = "round";
  for (const it of items) {
    const m = it.m;
    if (!P.vis(it.x, it.y, it.r + gap * 2)) continue;
    const sc = it.r / m.R, gu = gap / sc;
    g.save(); g.translate(it.x, it.y); g.rotate(it.rot); g.scale(it.flip ? -sc : sc, sc);
    g.globalCompositeOperation = "destination-out"; g.fillStyle = g.strokeStyle = "#000";
    for (const [p, lw] of m.sil) { g.lineWidth = lw + 2 * gu; if (!lw) g.fill(p); g.stroke(p); }
    for (const [op, p, k, lw] of m.ops) {
      if (op[0] === "x") { g.globalCompositeOperation = "destination-out"; g.fillStyle = g.strokeStyle = "#000"; }
      else { g.globalCompositeOperation = "source-over"; g.fillStyle = g.strokeStyle = ink[it.swap ? 3 - k : k]; }
      if (op === "f" || op === "xf") g.fill(p); else { g.lineWidth = lw; g.stroke(p); }
    }
    g.restore();
  }
  g.restore();
}
/* random point inside a field region { V > thr }, by rejection over the box */
function bioInside(r, fld, thr, tries = 60) {
  for (let t = 0; t < tries; t++) { const x = (r() * 2 - 1) * fld.B, y = (r() * 2 - 1) * fld.B; if (fld.at(x, y) > thr) return [x, y]; }
  return null;
}
const bioShuffle = (r, a) => { for (let i = a.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

/* ---------- small fry for the gaps: cysts, rods, diplococci, spirilla, free capsids ---------- */
function bioSmall(r, kind) {
  const ops = [], sil = [];
  if (kind === "cyst") {                       // double-walled resting cell
    const b = bioDisc(new Path2D(), 0, 0, 1); sil.push([b, 0]); ops.push(["f", b, 1]);
    ops.push(["xs", bioDisc(new Path2D(), 0, 0, 0.74), 0, 0.12]);
    ops.push(["f", bioDisc(new Path2D(), 0.1, -0.05, 0.3), 2]);
  } else if (kind === "rod") {                 // a bacillus, maybe dividing
    const L = 0.75 + r() * 0.25, w = 0.28 + r() * 0.08, b = new Path2D();
    b.moveTo(-L + w, -w); b.lineTo(L - w, -w); b.arc(L - w, 0, w, -Math.PI / 2, Math.PI / 2); b.lineTo(-L + w, w); b.arc(-L + w, 0, w, Math.PI / 2, Math.PI * 1.5); b.closePath();
    sil.push([b, 0]); ops.push(["f", b, 2]);
    const c = new Path2D(); c.moveTo(-L + w * 1.2, 0); c.lineTo(L - w * 1.2, 0); ops.push(["xs", c, 0, w * 0.55]);
    if (r() < 0.5) { const d = new Path2D(); d.moveTo(0, -w * 1.2); d.lineTo(0, w * 1.2); ops.push(["xs", d, 0, 0.09]); }
  } else if (kind === "cocci") {               // diplococci / a short chain
    const n = 2 + ((r() * 2) | 0), cr = 0.95 / n, b = new Path2D();
    for (let i = 0; i < n; i++) bioEll(b, (i - (n - 1) / 2) * cr * 1.9, 0, cr, cr * 1.08, 0);
    sil.push([b, 0]); ops.push(["f", b, 1]);
    const k = new Path2D(); for (let i = 0; i < n; i++) bioDisc(k, (i - (n - 1) / 2) * cr * 1.9, 0, cr * 0.38); ops.push(["xf", k, 0]);
  } else if (kind === "spiril") {              // a spirillum: a wavy rod
    const turns = 1.5 + r(), A = 0.22 + r() * 0.08, pts = [];
    for (let i = 0; i <= 40; i++) { const t = i / 40; pts.push(-0.95 + 1.9 * t, Math.sin(t * turns * TAU) * A); }
    const b = bioLine(new Path2D(), pts); sil.push([b, 0.24]); ops.push(["s", b, 2, 0.24]);
  } else {                                     // a free capsid: a hexagon with its facets cut
    const h = new Path2D(), pts = []; for (let i = 0; i < 6; i++) { const a = i * TAU / 6 + Math.PI / 6; pts.push(Math.cos(a), Math.sin(a)); }
    bioPoly(h, pts); sil.push([h, 0]); ops.push(["f", h, 1]);
    const e = new Path2D(); for (let i = 0; i < 6; i++) { e.moveTo(0, 0); e.lineTo(pts[i * 2] * 0.7, pts[i * 2 + 1] * 0.7); }
    ops.push(["xs", e, 0, 0.11], ["xf", bioDisc(new Path2D(), 0, 0, 0.24), 0]);
  }
  return { R: 1.05, sil, ops };
}
/* fill the gaps between big items with small fry; kinds weighted by repetition in the list */
function bioFry(P, items, rmin, kinds, duo, rnd) {
  const lib = bioCached("fry|" + P.id + "|" + P.seed, () => { const r = bioRng(P, "fry"); return kinds.map(k => bioSmall(r, k)); });
  const drops = gapDrops(P, items.map(it => ({ x: it.x, y: it.y, r: it.r * (it.m.core ? it.m.core / it.m.R * 1.6 : 0.9) })), rmin, 1.2, 2.6);
  return drops.map(d => ({ x: d.x, y: d.y, r: d.r, rot: rnd() * TAU, flip: false, swap: duo && rnd() < 0.3, m: lib[(rnd() * lib.length) | 0] }));
}

/* ---------- AMOEBA: lobed cells with flowing pseudopods; membrane, clear ectoplasm, granular endoplasm ---------- */
function bioAmoebaShape(r) {
  const N = perlin((r() * 1e9) | 0);
  const core = 0.62 + r() * 0.16, ecc = 0.8 + r() * 0.4, cr = r() * TAU, cc = Math.cos(cr), cs = Math.sin(cr);
  const np = 2 + ((r() * 5) | 0), pods = [], a0 = r() * TAU, lazy = r();
  for (let i = 0; i < np; i++) {
    const a = a0 + (i + (r() - 0.5) * 0.7) * TAU / np, L = (0.35 + r() * 1.05) * (lazy < 0.25 ? 0.6 : 1);
    const w0 = 0.3 + r() * 0.16, w1 = 0.12 + r() * 0.09, bend = (r() - 0.5) * 1.6, pts = [];
    for (let k = 0; k <= 5; k++) { const t = k / 5, aa = a + bend * t * t, d = core * 0.4 + (L + core * 0.6) * t; pts.push([Math.cos(aa) * d, Math.sin(aa) * d, w0 + (w1 - w0) * Math.pow(t, 0.8) + 0.05 * Math.sin(t * 7 + i)]); }
    pods.push(pts);
    if (L > 0.85 && r() < 0.55) {   // a fork near the tip
      const k = 2 + ((r() * 2) | 0), [bx, by, bw] = pts[k], ab = a + bend * (k / 5) ** 2 + (r() < 0.5 ? -1 : 1) * (0.7 + r() * 0.5), Lb = 0.25 + r() * 0.45;
      pods.push([[bx, by, bw * 0.8], [bx + Math.cos(ab) * Lb * 0.55, by + Math.sin(ab) * Lb * 0.55, bw * 0.55 + w1 * 0.3], [bx + Math.cos(ab + bend * 0.4) * Lb, by + Math.sin(ab + bend * 0.4) * Lb, w1 * 0.9]]);
    }
  }
  // each pod as flat segment records [ax, ay, vx, vy, 1/|v|², aw, bw - aw], with a bounding circle to skip it when far
  const segs = pods.map(pts => {
    const S = []; let mx = 0, my = 0, rad = 0;
    for (const p of pts) { mx += p[0] / pts.length; my += p[1] / pts.length; }
    for (const p of pts) rad = Math.max(rad, Math.hypot(p[0] - mx, p[1] - my) + p[2]);
    for (let i = 0; i + 1 < pts.length; i++) { const [ax, ay, aw] = pts[i], [bx, by, bw] = pts[i + 1], vx = bx - ax, vy = by - ay; S.push(ax, ay, vx, vy, 1 / (vx * vx + vy * vy || 1), aw, bw - aw); }
    return { S, mx, my, rad };
  });
  const se = Math.sqrt(ecc);
  const F = (x, y) => {
    const u = (x * cc + y * cs) / ecc, v = (-x * cs + y * cc) * se;
    let f = core - Math.sqrt(u * u + v * v);
    for (const { S, mx, my, rad } of segs) {
      if (rad - Math.sqrt((x - mx) ** 2 + (y - my) ** 2) < f - 0.27) continue;   // too far to change the smooth union
      let d = -9;
      for (let i = 0; i < S.length; i += 7) {
        const px = x - S[i], py = y - S[i + 1], t = clamp((px * S[i + 2] + py * S[i + 3]) * S[i + 4], 0, 1), ex = px - S[i + 2] * t, ey = py - S[i + 3] * t;
        const q = S[i + 5] + S[i + 6] * t - Math.sqrt(ex * ex + ey * ey); if (q > d) d = q;
      }
      f = smax(f, d, 0.26);
    }
    return f + 0.03 * N(x * 2.4, y * 2.4);
  };
  const B = 2.75, fld = bioField(F, B, 104);
  const mem = 0.05, ecto = 0.055 + r() * 0.04;                  // membrane line, clear ectoplasm band
  const outer = fld.iso(0), inner = fld.iso(mem), endo = fld.iso(mem + ecto);
  const ops = [["f", outer, 2], ["xf", inner, 0], ["f", endo, 1]];
  const deep = mem + ecto, taken = [];
  const free = (x, y, rr) => taken.every(([a, b, c]) => Math.hypot(x - a, y - b) > rr + c + 0.05);
  // nucleus: the deepest point, a ground disc with its envelope and nucleolus
  let nx = 0, ny = 0, best = -9;
  for (let t = 0; t < 400; t++) { const x = (r() * 2 - 1) * 1.2, y = (r() * 2 - 1) * 1.2, v = fld.at(x, y); if (v > best) { best = v; nx = x; ny = y; } }
  const rN = clamp(best - deep - 0.08, 0.15, 0.26), nE = 0.75 + r() * 0.2, nA = r() * TAU;
  ops.push(["xf", bioEll(new Path2D(), nx, ny, rN + 0.05, rN * nE + 0.05, nA), 0]);
  ops.push(["f", bioEll(new Path2D(), nx, ny, rN, rN * nE, nA), 2]);
  const chr = new Path2D(); for (let k = 0; k < 9; k++) { const a = r() * TAU, d = Math.sqrt(r()) * rN * 0.7; bioDisc(chr, nx + Math.cos(a) * d, ny + Math.sin(a) * d * nE, rN * (0.07 + r() * 0.05)); }
  const ncx = nx + Math.cos(nA + 1) * rN * 0.3, ncy = ny + Math.sin(nA + 1) * rN * 0.3;
  ops.push(["xf", chr, 0], ["xf", bioDisc(new Path2D(), ncx, ncy, rN * 0.36), 0], ["f", bioDisc(new Path2D(), ncx, ncy, rN * 0.24), 2]);
  taken.push([nx, ny, rN]);
  // food vacuoles with something in them
  const nv = 1 + ((r() * 4) | 0), vac = new Path2D(), prey = new Path2D();
  for (let i = 0; i < nv; i++) {
    const rv = 0.08 + r() * 0.1, p = bioInside(r, fld, deep + rv + 0.05);
    if (!p || !free(p[0], p[1], rv)) continue;
    taken.push([p[0], p[1], rv]); bioDisc(vac, p[0], p[1], rv);
    if (r() < 0.8) bioEll(prey, p[0] + (r() - 0.5) * rv * 0.3, p[1] + (r() - 0.5) * rv * 0.3, rv * (0.45 + r() * 0.15), rv * (0.3 + r() * 0.15), r() * TAU);
  }
  // a contractile vacuole and its ring of feeder vesicles
  if (r() < 0.75) {
    const rc = 0.11 + r() * 0.05, p = bioInside(r, fld, deep + rc * 1.7 + 0.04);
    if (p && free(p[0], p[1], rc * 1.7)) {
      taken.push([p[0], p[1], rc * 1.7]); bioDisc(vac, p[0], p[1], rc);
      for (let k = 0, m = 7 + ((r() * 3) | 0); k < m; k++) { const a = k * TAU / m; bioDisc(vac, p[0] + Math.cos(a) * rc * 1.5, p[1] + Math.sin(a) * rc * 1.5, rc * 0.24); }
    }
  }
  ops.push(["xf", vac, 0], ["f", prey, 2]);
  // granules: cut dots through the endoplasm
  const gr = new Path2D(), ng = 30 + ((r() * 40) | 0), gs = 0.028 + r() * 0.018;
  for (let i = 0; i < ng; i++) { const p = bioInside(r, fld, deep + 0.06, 20); if (p && free(p[0], p[1], gs)) bioDisc(gr, p[0], p[1], gs * (0.7 + r() * 0.6)); }
  ops.push(["xf", gr, 0]);
  let R = 0; for (let j = 0; j < fld.n; j++) for (let i = 0; i < fld.n; i++) if (fld.V[j * fld.n + i] > 0) R = Math.max(R, Math.hypot(-B + i * fld.cs, -B + j * fld.cs));
  return { R: R + 0.05, core: core * Math.sqrt(ecc), sil: [[outer, 0]], ops };
}
function bioAmoeba(P) {
  const rnd = P.rnd, duo = isDuo(P);
  const lib = bioCached("amoeba|" + P.seed, () => { const r = bioRng(P, "amoeba"); return Array.from({ length: 8 }, () => bioAmoebaShape(r)); });
  const rmax = P.s * (0.1 + rnd() * 0.04), rmin = rmax * (0.42 + rnd() * 0.15);
  const spots = dartPack(P, rmax, rmin, { sp: 0.66 + rnd() * 0.1, effort: 2 }), swapK = duo ? rnd() * 0.5 : 0;
  const items = spots.map(c => { const m = lib[(rnd() * lib.length) | 0]; return { x: c.x, y: c.y, r: c.r * 1.25, rot: rnd() * TAU, flip: rnd() < 0.5, swap: rnd() < swapK, m }; });
  const fry = bioFry(P, items, rmin * 0.3, ["cyst", "rod", "rod", "cocci", "spiril"], duo, rnd);
  const gap = Math.max(1, P.s * 0.006);
  bioStamp(P, fry, gap * 0.8);
  bioStamp(P, items, gap);
}

/* ---------- VIRUS: icosahedral capsids, enveloped virions with spikes, rods and filaments, phages ---------- */
const BIO_PHI = (1 + Math.sqrt(5)) / 2;
function bioIcosa(r) {   // the 12 vertices and 20 faces of an icosahedron, turned at random, radius 1
  const V = [];
  for (const a of [-1, 1]) for (const b of [-1, 1]) V.push([0, a, b * BIO_PHI], [a, b * BIO_PHI, 0], [b * BIO_PHI, 0, a]);
  const F = [];
  for (let i = 0; i < 12; i++) for (let j = i + 1; j < 12; j++) for (let k = j + 1; k < 12; k++) {
    const d = (p, q) => Math.hypot(V[p][0] - V[q][0], V[p][1] - V[q][1], V[p][2] - V[q][2]);
    if (Math.abs(d(i, j) - 2) < 1e-6 && Math.abs(d(j, k) - 2) < 1e-6 && Math.abs(d(i, k) - 2) < 1e-6) F.push([i, j, k]);
  }
  const a = r() * TAU, b = r() * TAU, c = r() * TAU, s = 1 / Math.hypot(1, BIO_PHI);
  const rot = ([x, y, z]) => {
    let t = x * Math.cos(a) - y * Math.sin(a); y = x * Math.sin(a) + y * Math.cos(a); x = t;
    t = y * Math.cos(b) - z * Math.sin(b); z = y * Math.sin(b) + z * Math.cos(b); y = t;
    t = x * Math.cos(c) - z * Math.sin(c); z = x * Math.sin(c) + z * Math.cos(c); x = t;
    return [x * s, y * s, z * s];
  };
  return { V: V.map(rot), F };
}
function bioHull(pts) {   // convex hull of [[x, y]], counter-clockwise
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length > 1 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
/* an icosahedral capsid (adenovirus-like when fibred): faces, pentons at the front vertices, capsomeres */
function bioCapsid(r, fibres) {
  const { V, F } = bioIcosa(r), ops = [], sil = [];
  const hull = bioHull(V.map(v => [v[0], v[1]])), body = bioPoly(new Path2D(), hull.flat());
  let R = 1;
  if (fibres) {   // a fibre from every vertex on or near the rim, ending in a knob
    const fl = 0.38 + r() * 0.25, st = new Path2D(), kn = new Path2D();
    for (const [x, y, z] of V) {
      if (Math.abs(z) > 0.55) continue;
      const d = Math.hypot(x, y), ux = x / d, uy = y / d, L = fl * (0.55 + 0.45 * Math.sqrt(1 - z * z));
      st.moveTo(x, y); st.lineTo(x + ux * L, y + uy * L); bioDisc(kn, x + ux * (L + 0.06), y + uy * (L + 0.06), 0.085);
      R = Math.max(R, d + L + 0.15);
    }
    sil.push([st, 0.05], [kn, 0]); ops.push(["s", st, 2, 0.05], ["f", kn, 2]);
  }
  sil.push([body, 0]); ops.push(["f", body, 1]);
  const ed = new Path2D(), cap = new Path2D(), pen = new Path2D(), ring = new Path2D(), seen = new Set();
  for (const f of F) {
    const c = [0, 1, 2].map(q => (V[f[0]][q] + V[f[1]][q] + V[f[2]][q]) / 3);
    if (c[2] <= 0) continue;
    for (let q = 0; q < 3; q++) {
      const i = f[q], j = f[(q + 1) % 3], key = Math.min(i, j) * 16 + Math.max(i, j);
      if (seen.has(key)) continue; seen.add(key);
      ed.moveTo(V[i][0], V[i][1]); ed.lineTo(V[j][0], V[j][1]);
    }
    const nz = Math.sqrt(c[2] / Math.hypot(...c));   // capsomeres: three per face, shrunk as the face turns away
    if (nz > 0.55) for (let q = 0; q < 3; q++) { const v = V[f[q]]; bioDisc(cap, c[0] * 0.55 + v[0] * 0.45 * 0.6 + c[0] * 0.45 * 0.4, c[1] * 0.55 + v[1] * 0.45 * 0.6 + c[1] * 0.45 * 0.4, 0.05 * nz); }
  }
  for (const v of V) if (v[2] > 0.05) { bioDisc(ring, v[0], v[1], 0.11); bioDisc(pen, v[0], v[1], 0.075); }
  ops.push(["xs", ed, 0, 0.045], ["xf", cap, 0], ["s", body, 1, 0.07], ["xf", ring, 0], ["f", pen, 2]);
  return { R, sil, ops };
}
/* an enveloped virion: membrane, a crown of spike proteins (stalk + head), and what it carries */
function bioEnveloped(r) {
  const ops = [], sil = [], re = 0.6 + r() * 0.06, head = (r() * 4) | 0, ns = 14 + ((r() * 14) | 0), sl = 0.2 + r() * 0.1;
  const st = new Path2D(), hd = new Path2D();
  for (let i = 0; i < ns; i++) {
    if (r() < 0.08) continue;
    const a = (i + (r() - 0.5) * 0.4) / ns * TAU, L = sl * (0.85 + r() * 0.3), c = Math.cos(a), s = Math.sin(a), e = re + L;
    st.moveTo(c * (re - 0.02), s * (re - 0.02)); st.lineTo(c * e, s * e);
    if (head === 0) bioDisc(hd, c * (e + 0.05), s * (e + 0.05), 0.075);                                   // ball
    else if (head === 1) bioEll(hd, c * (e + 0.06), s * (e + 0.06), 0.1, 0.065, a);                       // club
    else if (head === 2) { const p = []; for (const [u, v] of [[-0.02, -0.11], [0.09, -0.08], [0.09, 0.08], [-0.02, 0.11]]) p.push(c * (e + u) - s * v, s * (e + u) + c * v); bioPoly(hd, p); }   // T-bar
    else for (let q = -1; q <= 1; q++) { const b = a + q * 0.11; bioDisc(hd, Math.cos(b) * (e + 0.04 + (q ? 0 : 0.05)), Math.sin(b) * (e + 0.04 + (q ? 0 : 0.05)), 0.045); }   // trimer
  }
  const env = bioDisc(new Path2D(), 0, 0, re);
  sil.push([env, 0], [st, 0.045], [hd, 0]);
  ops.push(["s", st, 2, 0.045], ["f", hd, 2], ["f", env, 1], ["xf", bioDisc(new Path2D(), 0, 0, re - 0.1), 0]);
  const inside = (r() * 3) | 0, ri = re - 0.16;
  if (inside === 0) {        // segmented genome: seven round the one, seen end on
    const g = new Path2D(), h = new Path2D(), rr = ri * 0.27;
    bioDisc(g, 0, 0, rr); bioDisc(h, 0, 0, rr * 0.38);
    for (let k = 0; k < 7; k++) { const a = k * TAU / 7; bioDisc(g, Math.cos(a) * rr * 2.15, Math.sin(a) * rr * 2.15, rr); bioDisc(h, Math.cos(a) * rr * 2.15, Math.sin(a) * rr * 2.15, rr * 0.38); }
    ops.push(["f", g, 1], ["xf", h, 0]);
  } else if (inside === 1) { // a coiled nucleocapsid strand
    const k = 9 + ((r() * 6) | 0), A = ri * (0.16 + r() * 0.08), R0 = ri * 0.62, line = new Path2D();
    for (let i = 0; i <= 360; i++) { const t = i / 360 * TAU, x = R0 * Math.cos(t) + A * Math.cos(k * t), y = R0 * Math.sin(t) + A * Math.sin(k * t); i ? line.lineTo(x, y) : line.moveTo(x, y); }
    ops.push(["s", line, 1, 0.032], ["f", bioDisc(new Path2D(), 0, 0, ri * 0.22), 1]);
  } else {                   // a dense core: a capsid inside, faceted
    const k = 5 + ((r() * 2) | 0), p = [], e = new Path2D(), a0 = r() * TAU;
    for (let i = 0; i < k; i++) { const a = a0 + i * TAU / k; p.push(Math.cos(a) * ri * 0.78, Math.sin(a) * ri * 0.78); e.moveTo(0, 0); e.lineTo(Math.cos(a) * ri * 0.78, Math.sin(a) * ri * 0.78); }
    ops.push(["f", bioPoly(new Path2D(), p), 1], ["xs", e, 0, 0.04], ["xf", bioDisc(new Path2D(), 0, 0, ri * 0.16), 0]);
  }
  return { R: re + sl * 1.15 + 0.13, sil, ops };
}
/* a rod (tobacco-mosaic-like) or a filament with a shepherd's-crook end: helical striations, the core in ink 2 */
function bioRod(r, bent) {
  const ops = [], sil = [], hw = bent ? 0.075 + r() * 0.02 : 0.15 + r() * 0.05;
  let line;
  if (!bent) line = (t) => [-1 + 2 * t, 0];
  else {   // a filament: heading integrated from a wavering curvature, the end often curling into a hook or a coil
    const L = 2.2 + r() * 0.8, k1 = (r() - 0.5) * 2.4, f1 = 2 + r() * 3, ph = r() * TAU, s0 = 0.6 + r() * 0.15, curl = r() < 0.75 ? (r() < 0.5 ? -1 : 1) * (14 + r() * 18) : 0;
    const M = 200, P2 = [[0, 0]]; let a = 0, x = 0, y = 0;
    for (let i = 1; i <= M; i++) { const u = i / M; a += (k1 * Math.sin(u * f1 + ph) + (u > s0 ? curl * (u - s0) ** 1.2 : 0)) * L / M; x += Math.cos(a) * L / M; y += Math.sin(a) * L / M; P2.push([x, y]); }
    let mx = 0, my = 0, ex = 0; for (const [px, py] of P2) { mx += px / P2.length; my += py / P2.length; }
    for (const p of P2) { p[0] -= mx; p[1] -= my; ex = Math.max(ex, Math.hypot(p[0], p[1])); }
    for (const p of P2) { p[0] /= ex; p[1] /= ex; }
    line = (t) => { const q = t * M, i = Math.min(M - 1, q | 0), f = q - i; return [P2[i][0] + (P2[i + 1][0] - P2[i][0]) * f, P2[i][1] + (P2[i + 1][1] - P2[i][1]) * f]; };
  }
  const N = bent ? 160 : 4, pts = strokePts(line, () => hw, N), body = bioPoly(new Path2D(), pts);
  sil.push([body, 0]); ops.push(["f", body, 1]);
  const cl = new Path2D(), stri = new Path2D(), slant = 0.35 * (r() < 0.5 ? -1 : 1), stp = hw * (0.5 + r() * 0.15);
  const cpts = []; for (let i = 0; i <= 60; i++) cpts.push(...line(i / 60));
  // striations: short cuts across the rod every stp along its length
  let acc = 0, last = line(0);
  for (let i = 1; i <= 240; i++) {
    const t = i / 240, p = line(t); acc += Math.hypot(p[0] - last[0], p[1] - last[1]); last = p;
    if (acc < stp || t > 0.985 || t < 0.015) continue; acc = 0;
    const q = line(Math.min(1, t + 0.002)), dx = q[0] - p[0], dy = q[1] - p[1], d = Math.hypot(dx, dy), nx = -dy / d, ny = dx / d, tx = dx / d, ty = dy / d, h = hw * 0.78;
    stri.moveTo(p[0] - nx * h - tx * h * slant, p[1] - ny * h - ty * h * slant); stri.lineTo(p[0] + nx * h + tx * h * slant, p[1] + ny * h + ty * h * slant);
  }
  ops.push(["xs", stri, 0, hw * 0.2]);
  bioLine(cl, cpts);
  ops.push(["xs", cl, 0, hw * 0.55], ["s", cl, 2, hw * 0.22]);
  let R = 0; for (let i = 0; i < pts.length; i += 2) R = Math.max(R, Math.hypot(pts[i], pts[i + 1]));
  return { R: R + 0.02, sil, ops };
}
/* a tailed phage: faceted head, collar, ringed sheath, baseplate and jointed tail fibres */
function bioPhage(r) {
  const ops = [], sil = [], hw = 0.24 + r() * 0.07, hh = hw * (1.2 + r() * 0.5), contracted = r() < 0.25;
  const tl = contracted ? 0.32 : 0.5 + r() * 0.25, tw = contracted ? 0.11 : 0.07, top = -0.9;
  const hy = top + hh, spin = r() * TAU, tilt = (r() - 0.5) * 0.5, cap = hw * 0.62;
  // vertices: apex, a ring of five, (a second ring of five offset 36°), apex
  const V3 = [[0, -hh, 0]], ring = (y, off) => { for (let i = 0; i < 5; i++) { const a = spin + off + i * TAU / 5; V3.push([Math.cos(a) * hw, y, Math.sin(a) * hw]); } };
  ring(-hh + cap, 0); ring(hh - cap, Math.PI / 5); V3.push([0, hh, 0]);
  const PV = V3.map(([x, y, z]) => [x, y * Math.cos(tilt) - z * Math.sin(tilt), y * Math.sin(tilt) + z * Math.cos(tilt)]);
  const FS = [];
  for (let i = 0; i < 5; i++) { const j = (i + 1) % 5; FS.push([0, 1 + i, 1 + j], [1 + i, 1 + j, 6 + i], [1 + j, 6 + j, 6 + i], [11, 6 + i, 6 + j]); }
  const hd = bioPoly(new Path2D(), bioHull(PV.map(v => [v[0], v[1] + hy])).flat()), fc = new Path2D(), seenE = new Set();
  for (const f of FS) {
    const a = PV[f[0]], b = PV[f[1]], c = PV[f[2]];
    const cz = (a[2] + b[2] + c[2]) / 3; if (cz < 0) continue;
    for (let q = 0; q < 3; q++) { const i = f[q], j = f[(q + 1) % 3], key = Math.min(i, j) * 16 + Math.max(i, j); if (seenE.has(key)) continue; seenE.add(key); fc.moveTo(PV[i][0], PV[i][1] + hy); fc.lineTo(PV[j][0], PV[j][1] + hy); }
  }
  const cy0 = hy + hh * Math.cos(tilt), col = bioPoly(new Path2D(), [-hw * 0.45, cy0 - 0.01, hw * 0.45, cy0 - 0.01, hw * 0.35, cy0 + 0.06, -hw * 0.35, cy0 + 0.06]);
  const t0 = cy0 + 0.06, t1 = t0 + tl, sh = new Path2D(); sh.rect(-tw, t0, 2 * tw, tl);
  const rings = new Path2D(); for (let y = t0 + 0.045; y < t1 - 0.02; y += contracted ? 0.05 : 0.055) { rings.moveTo(-tw * 0.7, y); rings.lineTo(tw * 0.7, y); }
  let core = null, b0 = t1;
  if (contracted) { core = new Path2D(); core.rect(-0.025, t1, 0.05, 0.22); b0 = t1 + 0.22; }
  const bp = bioPoly(new Path2D(), [-0.15, b0, 0.15, b0, 0.11, b0 + 0.06, -0.11, b0 + 0.06]);
  const legs = new Path2D(), spread = 0.75 + r() * 0.4, nl = r() < 0.7 ? 2 : 3;
  let maxY = b0 + 0.06;
  for (let i = 0; i < nl; i++) for (const sg of [-1, 1]) {
    const kx = sg * (0.17 + 0.1 * i) * (0.8 + 0.2 * spread), ky = b0 - 0.15 + 0.07 * i, fx = sg * (0.4 + 0.15 * i) * spread, fy = b0 + 0.33 - 0.05 * i;
    legs.moveTo(sg * 0.1, b0 + 0.04); legs.lineTo(kx, ky); legs.lineTo(fx, fy); maxY = Math.max(maxY, fy);
  }
  const pins = new Path2D(); for (const x of [-0.08, 0, 0.08]) { pins.moveTo(x, b0 + 0.06); pins.lineTo(x * 1.3, b0 + 0.13); }
  sil.push([hd, 0], [col, 0], [sh, 0], [bp, 0], [legs, 0.04], [pins, 0.03]); if (core) sil.push([core, 0]);
  ops.push(["s", legs, 1, 0.04], ["s", pins, 1, 0.03], ["f", sh, 1], ["xs", rings, 0, 0.02]);
  if (core) ops.push(["f", core, 1]);
  ops.push(["f", bp, 1], ["f", col, 1], ["xs", hd, 0, 0.07], ["f", hd, 2], ["xs", fc, 0, 0.03], ["s", hd, 2, 0.04]);
  // centre the whole thing on its bounding box
  const cy = (top + maxY) / 2, R = Math.hypot(Math.max(hw, 0.6), (maxY - top) / 2) * 0.92;
  return { R, sil, ops, oy: cy };
}
function bioVirus(P) {
  const rnd = P.rnd, duo = isDuo(P);
  const cast = bioCached("virus|" + P.seed, () => {
    const r = bioRng(P, "virus"), kinds = ["capsid", "fibre", "env", "env", "rod", "fil", "phage"], pick = bioShuffle(r, kinds.slice()).slice(0, 2 + ((r() * 3) | 0));
    if (!pick.some(k => k === "env" || k === "capsid" || k === "fibre")) pick.push(r() < 0.5 ? "env" : "fibre");
    const lib = [];
    for (const k of pick) for (let v = 0; v < 2 + (k === "env"); v++) {
      const m = k === "capsid" ? bioCapsid(r, false) : k === "fibre" ? bioCapsid(r, true) : k === "env" ? bioEnveloped(r) : k === "rod" ? bioRod(r, false) : k === "fil" ? bioRod(r, true) : bioPhage(r);
      m.kind = k; lib.push(m);
    }
    return lib;
  });
  const rmax = P.s * (0.085 + rnd() * 0.035), rmin = rmax * (0.38 + rnd() * 0.15);
  const spots = dartPack(P, rmax, rmin, { sp: 0.86 + rnd() * 0.08, effort: 2 }), swapK = duo ? 0.15 + rnd() * 0.3 : 0;
  const items = spots.map(c => {
    const m = cast[(rnd() * cast.length) | 0], long = m.kind === "rod" || m.kind === "fil" || m.kind === "phage";
    return { x: c.x, y: c.y, r: c.r * (long ? 1.18 : 1.02), rot: rnd() * TAU, flip: rnd() < 0.5, swap: rnd() < swapK, m };
  });
  // phages are built off-centre: shift their stamp so the box centre sits on the spot
  for (const it of items) if (it.m.oy) { const sc = it.r / it.m.R; it.x -= -Math.sin(it.rot) * it.m.oy * sc; it.y -= Math.cos(it.rot) * it.m.oy * sc; }
  const fry = bioFry(P, items, rmin * 0.24, ["capsid", "capsid", "cocci", "cyst"], duo, rnd);
  const gap = Math.max(1, P.s * 0.006);
  bioStamp(P, fry, gap * 0.8);
  bioStamp(P, items, gap);
}

/* ---------- CELLS: tissue under the microscope (packed cells sharing walls), plant cells, or blood ---------- */
/* Voronoi cells of jittered, relaxed sites over the visible area, in pattern space (each a convex polygon [x, y, ...]). */
function bioTissue(P, c, ax, ay, jit, warpA, rnd) {
  const ex = P.hx / ax + 1.5 * c + warpA * 1.3, ey = P.hy / ay + 1.5 * c + warpA * 1.3, sites = [], rowH = c * 0.866;
  for (let j = 0, y = -ey; y <= ey; y += rowH, j++) for (let x = -ex + (j & 1) * c / 2; x <= ex; x += c) sites.push([x + (rnd() - 0.5) * 2 * jit * c, y + (rnd() - 0.5) * 2 * jit * c]);
  const grid = new Map(), key = (i, j) => (i + 4096) * 8192 + j + 4096;
  const cells = () => {
    grid.clear(); sites.forEach((p, n) => { const k = key(Math.floor(p[0] / c), Math.floor(p[1] / c)); (grid.get(k) || grid.set(k, []).get(k)).push(n); });
    return sites.map(([px, py], n) => {
      let poly = [[px - 2.5 * c, py - 2.5 * c], [px + 2.5 * c, py - 2.5 * c], [px + 2.5 * c, py + 2.5 * c], [px - 2.5 * c, py + 2.5 * c]];
      const gi = Math.floor(px / c), gj = Math.floor(py / c), near = [];
      for (let j = gj - 2; j <= gj + 2; j++) for (let i = gi - 2; i <= gi + 2; i++) for (const m of grid.get(key(i, j)) || []) if (m !== n) near.push([(sites[m][0] - px) ** 2 + (sites[m][1] - py) ** 2, m]);
      near.sort((a, b) => a[0] - b[0]);
      for (const [d2, m] of near) {
        // nearest first; a site more than twice the cell's reach away can't cut it
        let reach = 0; for (const [x, y] of poly) reach = Math.max(reach, (x - px) ** 2 + (y - py) ** 2);
        if (d2 > 4 * reach) break;
        const [qx, qy] = sites[m], nx = qx - px, ny = qy - py, mx = (px + qx) / 2, my = (py + qy) / 2, side = (x, y) => (x - mx) * nx + (y - my) * ny;
        const out = [];
        for (let k = 0; k < poly.length; k++) {
          const a = poly[k], b = poly[(k + 1) % poly.length], sa = side(a[0], a[1]), sb = side(b[0], b[1]);
          if (sa <= 0) out.push(a);
          if ((sa <= 0) !== (sb <= 0)) { const t = sa / (sa - sb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
        }
        poly = out; if (poly.length < 3) break;
      }
      return poly;
    });
  };
  return cells().filter(p => p.length > 2);
}
/* a convex polygon pushed in by d (edges moved along their normals), short edges merged first; null if it vanishes */
function bioInset(poly, d) {
  let p = poly.slice();
  for (let pass = 0; pass < 3; pass++) {
    const q = []; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; if (Math.hypot(b[0] - a[0], b[1] - a[1]) > d * 1.2 || p.length - (p.length - q.length) < 4) q.push(a); }
    if (q.length < 3 || q.length === p.length) break; p = q;
  }
  let area = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; area += a[0] * b[1] - b[0] * a[1]; }
  const sg = area > 0 ? 1 : -1, L = [];
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l * sg, ny = dx / l * sg;
    L.push([a[0] + nx * d, a[1] + ny * d, dx, dy]);
  }
  const out = [];
  for (let i = 0; i < L.length; i++) {
    const [ax, ay, adx, ady] = L[(i + L.length - 1) % L.length], [bx, by, bdx, bdy] = L[i], den = adx * bdy - ady * bdx;
    if (Math.abs(den) < 1e-9) return null;
    const t = ((bx - ax) * bdy - (by - ay) * bdx) / den; out.push([ax + adx * t, ay + ady * t]);
  }
  let a2 = 0; for (let i = 0; i < out.length; i++) { const a = out[i], b = out[(i + 1) % out.length]; a2 += a[0] * b[1] - b[0] * a[1]; }
  return a2 * area > 0 && Math.abs(a2) > Math.abs(area) * 0.04 ? out : null;
}
/* a polygon with rounded corners into path */
function bioRound(path, poly, rc) {
  const n = poly.length, mid = (i) => { const a = poly[i % n], b = poly[(i + 1) % n]; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; };
  const m0 = mid(n - 1); path.moveTo(m0[0], m0[1]);
  for (let i = 0; i < n; i++) {
    const a = poly[(i + n - 1) % n], v = poly[i], b = poly[(i + 1) % n], m = mid(i);
    const r = Math.min(rc, Math.hypot(v[0] - a[0], v[1] - a[1]) * 0.42, Math.hypot(b[0] - v[0], b[1] - v[1]) * 0.42);
    path.arcTo(v[0], v[1], m[0], m[1], Math.max(0.01, r));
  }
}
const bioCentroid = (poly) => { let sx = 0, sy = 0; for (const [x, y] of poly) { sx += x; sy += y; } return [sx / poly.length, sy / poly.length]; };
/* distance from a point inside a convex polygon to its nearest edge */
function bioEdgeDist(poly, x, y) {
  let d = 1e18;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n], vx = b[0] - a[0], vy = b[1] - a[1], t = clamp(((x - a[0]) * vx + (y - a[1]) * vy) / (vx * vx + vy * vy || 1), 0, 1);
    const ex = x - a[0] - vx * t, ey = y - a[1] - vy * t, q = ex * ex + ey * ey; if (q < d) d = q;
  }
  return Math.sqrt(d);
}
const bioInPoly = (poly, x, y) => { let s = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length], c = (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]); if (c !== 0) { if (s && Math.sign(c) !== s) return false; s = Math.sign(c); } } return true; };
/* a mitochondrion: capsule outline (for the keyline), body, and a zigzag of cristae */
function bioMito(body, key, cri, x, y, L, w, a, k) {
  const c = Math.cos(a), s = Math.sin(a), pts = [];
  for (let i = 0; i <= 16; i++) { const t = i / 16 * Math.PI; pts.push([-L + w - Math.sin(t) * w, -Math.cos(t) * w]); }
  for (let i = 0; i <= 16; i++) { const t = i / 16 * Math.PI; pts.push([L - w + Math.sin(t) * w, Math.cos(t) * w]); }
  const tr = (u, v) => [x + u * c - v * s, y + u * s + v * c];
  const f = pts.map(([u, v]) => tr(u, v)).flat(), kp = pts.map(([u, v]) => tr(u * (1 + k / L), v * (1 + k / w))).flat();
  bioPoly(body, f); bioPoly(key, kp);
  const n = Math.max(2, Math.round(L / w * 2.2));
  for (let i = 0; i <= n; i++) { const [px, py] = tr(-L + w * 0.7 + (2 * L - w * 1.4) * i / n, (i & 1 ? 1 : -1) * w * 0.55); i ? cri.lineTo(px, py) : cri.moveTo(px, py); }
}
function bioCellTissue(P, rnd, duo, plant) {
  const g = P.g, N = perlin(P.seed + 77), N2 = perlin(P.seed + 78);
  const c = P.s * (plant ? 0.11 + rnd() * 0.045 : 0.075 + rnd() * 0.04), el = plant ? 1.5 + rnd() * 0.9 : 1 + rnd() * rnd() * 0.6;
  const ax = Math.sqrt(el), ay = 1 / Math.sqrt(el), jit = 0.2 + rnd() * 0.17, warpA = c * (0.3 + rnd() * 1.2), wf = 1 / (c * (4 + rnd() * 6));
  const raw = bioTissue(P, c, ax, ay, jit, warpA, rnd);
  const warp = (x, y) => [x * ax + N(x * wf, y * wf) * warpA, y * ay + N2(x * wf + 9, y * wf) * warpA];
  const wall = c * (plant ? 0.05 + rnd() * 0.03 : 0.05 + rnd() * 0.06), rc = c * (0.12 + rnd() * 0.3);
  const nucStyle = rnd() < 0.55 ? "solid" : "open", orgK = rnd(), stainK = rnd() < 0.5 ? 0 : 0.08 + rnd() * 0.2, stained = new Path2D(), gap = Math.max(0.8, c * 0.022);
  const bodies = new Path2D(), nucKey = new Path2D(), nuc = new Path2D(), nucCut = new Path2D(), mBody = new Path2D(), mKey = new Path2D(), mCri = new Path2D(), ves = new Path2D(), walls = new Path2D(), chl = new Path2D(), gra = new Path2D(), chlKey = new Path2D();
  for (const poly0 of raw) {
    const poly = poly0.map(([x, y]) => warp(x, y)), [cx, cy] = bioCentroid(poly);
    if (!P.vis(cx, cy, c * 1.4)) continue;
    const ins = bioInset(poly, wall / 2); if (!ins) continue;
    const ed = bioEdgeDist(ins, cx, cy); if (ed < c * 0.12) continue;
    bioRound(plant ? walls : duo && rnd() < stainK ? stained : bodies, ins, rc);
    if (plant) {
      // chloroplasts lining the wall, the nucleus pressed against one side
      const inner = bioInset(ins, wall / 2 + gap) || ins, n = inner.length, rr = c * (0.07 + orgK * 0.04);
      let per = 0; for (let i = 0; i < n; i++) per += Math.hypot(inner[(i + 1) % n][0] - inner[i][0], inner[(i + 1) % n][1] - inner[i][1]);
      const k = Math.floor(per / (rr * 2.9)), off = rnd() * per;
      for (let q = 0; q < k; q++) {
        if (rnd() < 0.22) continue;
        let t = (off + q * per / k) % per, i = 0;
        for (; i < n; i++) { const l = Math.hypot(inner[(i + 1) % n][0] - inner[i][0], inner[(i + 1) % n][1] - inner[i][1]); if (t <= l) break; t -= l; }
        const a = inner[i % n], b = inner[(i + 1) % n], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / l, uy = (b[1] - a[1]) / l;
        const x = a[0] + ux * t, y = a[1] + uy * t, toC = Math.sign((cx - x) * -uy + (cy - y) * ux) || 1, px = x - uy * toC * rr * 0.75, py = y + ux * toC * rr * 0.75;
        if (bioEdgeDist(ins, px, py) < rr * 0.6 || Math.hypot(px - cx, py - cy) < rr * 1.5) continue;
        const ang = Math.atan2(uy, ux) + (rnd() - 0.5) * 0.4;
        bioEll(chl, px, py, rr * 1.15, rr * 0.68, ang); bioEll(chlKey, px, py, rr * 1.15 + gap, rr * 0.68 + gap, ang);
        const cs = Math.cos(ang), sn = Math.sin(ang);
        if (rr > 2.5) for (const u of [-0.5, 0, 0.5]) { gra.moveTo(px + cs * u * rr - sn * -rr * 0.35, py + sn * u * rr + cs * -rr * 0.35); gra.lineTo(px + cs * u * rr - sn * rr * 0.35, py + sn * u * rr + cs * rr * 0.35); }
      }
      // the nucleus: a lens pressed against the wall, a small nucleolus off centre
      const na = rnd() * TAU, nr = Math.min(ed * 0.45, c * 0.19), nd = Math.max(0, ed - nr * 0.6 - wall - gap * 3), nx = cx + Math.cos(na) * nd * 0.85, ny = cy + Math.sin(na) * nd * 0.85;
      bioEll(nuc, nx, ny, nr, nr * 0.62, na + Math.PI / 2); bioEll(nucKey, nx, ny, nr + gap, nr * 0.62 + gap, na + Math.PI / 2);
      for (let k = 0; k < 7; k++) { const b = rnd() * TAU, d = Math.sqrt(rnd()) * nr * 0.6; bioDisc(nucCut, nx + Math.cos(b) * d, ny + Math.sin(b) * d * 0.6, nr * (0.07 + rnd() * 0.06)); }
      continue;
    }
    // animal tissue: the nucleus near the middle, mitochondria and vesicles round it
    const nr = Math.min(ed * 0.5, c * (0.17 + orgK * 0.06)), e = 0.75 + rnd() * 0.25, a = rnd() * TAU;
    const nx = cx + (rnd() - 0.5) * (ed - nr) * 0.5, ny = cy + (rnd() - 0.5) * (ed - nr) * 0.5;
    bioEll(nucKey, nx, ny, nr + gap * 1.2, nr * e + gap * 1.2, a); bioEll(nuc, nx, ny, nr, nr * e, a);
    if (nucStyle === "solid") for (let k = 0; k < 8; k++) { const b = rnd() * TAU, d = Math.sqrt(rnd()) * nr * 0.62; bioDisc(nucCut, nx + Math.cos(b) * d, ny + Math.sin(b) * d * e, nr * (0.07 + rnd() * 0.07)); }
    else for (let k = 0; k < 6; k++) { const b = rnd() * TAU, d = Math.sqrt(rnd()) * nr * 0.55; bioDisc(nucCut, nx + Math.cos(b) * d, ny + Math.sin(b) * d * e, nr * (0.12 + rnd() * 0.08)); }
    const nm = Math.round(1 + orgK * 3 + rnd() * 1.5);
    for (let k = 0; k < nm; k++) {
      const b = rnd() * TAU, d = nr * 1.25 + rnd() * (ed - nr * 1.25), x = nx + Math.cos(b) * d, y = ny + Math.sin(b) * d, L = c * (0.06 + rnd() * 0.05), w = c * 0.03;
      if (!bioInPoly(ins, x, y) || bioEdgeDist(ins, x, y) < L + gap * 2) continue;
      bioMito(mBody, mKey, mCri, x, y, L, w, b + Math.PI / 2 + (rnd() - 0.5), gap);
    }
    for (let k = 0; k < 3 + orgK * 6; k++) {
      const b = rnd() * TAU, d = nr * 1.3 + rnd() * (ed - nr * 1.3), x = nx + Math.cos(b) * d, y = ny + Math.sin(b) * d, vr = c * (0.012 + rnd() * 0.018);
      if (bioInPoly(ins, x, y) && bioEdgeDist(ins, x, y) > vr * 2.5) bioDisc(ves, x, y, vr);
    }
  }
  const ink1 = rgba(P.fg), ink2 = rgba(P.fg2), cut = (p, lw) => { g.globalCompositeOperation = "destination-out"; g.fillStyle = g.strokeStyle = "#000"; if (lw) { g.lineWidth = lw; g.stroke(p); } else g.fill(p); g.globalCompositeOperation = "source-over"; };
  g.save(); g.lineJoin = "round"; g.lineCap = "round";
  if (plant) {
    g.strokeStyle = ink1; g.lineWidth = wall * 0.9; g.stroke(walls);
    cut(chlKey); g.fillStyle = ink2; g.fill(chl); cut(gra, Math.max(0.6, c * 0.012));
    cut(nucKey); g.fillStyle = duo ? ink2 : ink1; g.fill(nuc); cut(nucCut);
  } else {
    g.fillStyle = ink1; g.fill(bodies); g.fillStyle = ink2; g.fill(stained);
    cut(nucKey);
    if (nucStyle === "solid") { g.fillStyle = ink2; g.fill(nuc); cut(nucCut); }
    else { g.strokeStyle = ink2; g.lineWidth = gap * 1.4; g.stroke(nuc); g.fillStyle = ink2; g.fill(nucCut); }
    cut(mKey); g.fillStyle = ink2; g.fill(mBody); cut(mCri, Math.max(0.6, c * 0.01)); cut(ves);
  }
  g.restore();
}
/* blood: red cells face on (the biconcave dimple as a ring and a shaded crescent) and edge on (a waisted bar),
   stacked into rouleaux here and there, with the odd white cell (lobed nucleus, granules) and platelets */
function bioBloodLib(r, duo) {
  const face = [], side = [], white = [], plate = [];
  for (let v = 0; v < 7; v++) {   // face on or tilted (an ellipse): the dimple's shadowed edge as an arc, its floor stippled (or in ink 2)
    const e = v < 4 ? 0.9 + r() * 0.1 : 0.38 + r() * 0.3, body = bioEll(new Path2D(), 0, 0, 1, e, 0), rd = 0.5 + r() * 0.08, ops = [["f", body, 1]];
    const arc = new Path2D(), a0 = 0.15 * Math.PI + (r() - 0.5) * 0.4, a1 = a0 + Math.PI * (0.9 + r() * 0.3);
    arc.moveTo(Math.cos(a0) * rd, Math.sin(a0) * rd * e); arc.ellipse(0, 0, rd, rd * e, 0, a0, a1);
    if (duo) {
      ops.push(["xf", bioEll(new Path2D(), -0.03, -0.03, rd + 0.04, (rd + 0.04) * e, 0), 0], ["f", bioEll(new Path2D(), -0.05, -0.05, rd - 0.03, (rd - 0.03) * e, 0), 2]);
      ops.push(["xs", arc, 0, 0.06]);
    } else {
      const st = new Path2D();
      for (let i = 0; i < 46; i++) { const q = r() * TAU, d = Math.pow(r(), 0.75) * (rd - 0.08); bioDisc(st, Math.cos(q) * d - 0.04, Math.sin(q) * d * e - 0.04, 0.034 * (1 - d / rd * 0.55)); }
      ops.push(["xs", arc, 0, 0.075], ["xf", st, 0]);
    }
    (v < 4 ? face : side).push({ R: 1, sil: [[body, 0]], ops, th: e });
  }
  for (let v = 0; v < 2; v++) {   // white cell: ruffled membrane, granules, a lobed nucleus
    const pts = [], k = 9 + ((r() * 6) | 0), ph = r() * TAU;
    for (let i = 0; i < 64; i++) { const a = i / 64 * TAU, rr = 1 + 0.045 * Math.sin(k * a + ph) + 0.03 * Math.sin(3 * a); pts.push(Math.cos(a) * rr, Math.sin(a) * rr); }
    const body = new Path2D(); smoothPoly(body, pts);
    const lobes = 2 + ((r() * 3) | 0), lk = new Path2D(), lb = new Path2D(), a0 = r() * TAU, gr = new Path2D();
    for (let i = 0; i < lobes; i++) { const a = a0 + (i - (lobes - 1) / 2) * 1.05, x = Math.cos(a) * 0.36, y = Math.sin(a) * 0.36, rr = 0.24 + r() * 0.05; bioDisc(lk, x, y, rr + 0.06); bioDisc(lb, x, y, rr); }
    for (let i = 0; i < 40; i++) { const a = r() * TAU, d = 0.2 + Math.sqrt(r()) * 0.68; bioDisc(gr, Math.cos(a) * d, Math.sin(a) * d, 0.035 + r() * 0.02); }
    const mem = new Path2D(); smoothPoly(mem, pts.map(v => v * 0.9));
    white.push({ R: 1.08, sil: [[body, 0]], ops: [["f", body, 1], ["xs", mem, 0, 0.04], ["xf", gr, 0], ["xf", lk, 0], ["f", lb, 2]] });
  }
  for (let v = 0; v < 2; v++) {
    const pts = []; for (let i = 0; i < 10; i++) { const a = i / 10 * TAU, rr = 0.75 + r() * 0.35; pts.push(Math.cos(a) * rr, Math.sin(a) * rr * 0.75); }
    const body = new Path2D(); smoothPoly(body, pts); const d = new Path2D(); for (let i = 0; i < 3; i++) bioDisc(d, (r() - 0.5) * 0.7, (r() - 0.5) * 0.5, 0.13);
    plate.push({ R: 1, sil: [[body, 0]], ops: [["f", body, 2], ["xf", d, 0]] });
  }
  return { face, side, white, plate };
}
function bioBlood(P, rnd, duo) {
  const lib = bioCached("blood|" + duo + "|" + P.seed, () => bioBloodLib(bioRng(P, "blood"), duo));
  const rb = P.s * (0.04 + rnd() * 0.022), sideK = 0.15 + rnd() * 0.3, stackK = 0.15 + rnd() * 0.4, whiteK = 0.02 + rnd() * 0.05, swapK = duo ? rnd() * 0.25 : 0;
  const spots = dartPack(P, rb * 1.7, rb * 0.82, { sp: 0.8 + rnd() * 0.1, decay: 0.82, effort: 2.5 }), items = [];
  for (const c of spots) {
    const rot = rnd() * TAU, swap = rnd() < swapK;
    if (c.r > rb * 1.25) {   // big spots: white cells, or a stack of red cells edge on
      if (rnd() < whiteK * 6) { items.push({ x: c.x, y: c.y, r: c.r, rot, swap, m: lib.white[(rnd() * 2) | 0] }); continue; }
      if (rnd() < stackK * 2) {
        const m = lib.side.reduce((a, b) => a.th < b.th ? a : b), n = 3 + ((rnd() * 5) | 0), step = rb * m.th * 0.95, bend = (rnd() - 0.5) * 0.25, ca = Math.cos(rot), sa = Math.sin(rot);
        for (let k = 0; k < n; k++) { const o = (k - (n - 1) / 2) * step; items.push({ x: c.x - sa * o + ca * o * bend, y: c.y + ca * o + sa * o * bend, r: rb * (0.95 + rnd() * 0.08), rot: rot + bend * (k - n / 2) * 0.3, swap, m }); }
        continue;
      }
    }
    if (rnd() < sideK) items.push({ x: c.x, y: c.y, r: rb * (0.92 + rnd() * 0.12), rot, swap, m: lib.side[(rnd() * lib.side.length) | 0] });
    else items.push({ x: c.x, y: c.y, r: rb * (0.92 + rnd() * 0.12), rot, swap, m: lib.face[(rnd() * lib.face.length) | 0] });
  }
  const fry = gapDrops(P, items.map(it => ({ x: it.x, y: it.y, r: it.r })), rb * 0.3, 1.2, 3).map(d => ({ x: d.x, y: d.y, r: d.r, rot: rnd() * TAU, swap: false, m: lib.plate[(rnd() * 2) | 0] }));
  const gap = Math.max(1, P.s * 0.005);
  bioStamp(P, fry, gap * 0.7);
  bioStamp(P, items, gap);
}
function bioCells(P) {
  const rnd = P.rnd, duo = isDuo(P), mode = rnd();
  if (mode < 0.3) bioBlood(P, rnd, duo);
  else bioCellTissue(P, rnd, duo, mode < 0.58);
}

/* ---------- MOLECULES: ball-and-stick models, skeletal formulas, or DNA double helices ---------- */
/* A molecule grown on the honeycomb lattice (bond length 1, every bond angle 120°): a ring core (one to three fused
   hexagons) or a zigzag chain, with branches, heteroatoms at the ends, a second ring hung off a single bond now and
   then. Atoms { x, y, z, el, ring }, bonds { a, b, o (order), sub (a branch bond) }, rings [[atom indices], cx, cy]. */
const BIO_DIRS = [[30, 150, 270], [90, 210, 330]].map(L => L.map(d => [Math.cos(d * Math.PI / 180), Math.sin(d * Math.PI / 180)]));
function bioMolGraph(r, size) {
  const atoms = [], bonds = [], rings = [], at = new Map(), key = (x, y) => Math.round(x * 64) + "," + Math.round(y * 64);
  const add = (x, y, t, el = "C", ring = false) => { const k = key(x, y); if (at.has(k)) return at.get(k); atoms.push({ x, y, z: 0, t, el, ring, deg: 0 }); at.set(k, atoms.length - 1); return atoms.length - 1; };
  const bonded = (a, b) => bonds.some(q => (q.a === a && q.b === b) || (q.a === b && q.b === a));
  const bond = (a, b, o = 1, sub = false) => { if (a === b || bonded(a, b)) return; bonds.push({ a, b, o, sub }); atoms[a].deg++; atoms[b].deg++; };
  const nbrs = (i) => BIO_DIRS[atoms[i].t].map(([dx, dy]) => [atoms[i].x + dx, atoms[i].y + dy]);
  const freeAt = (x, y, from) => !at.has(key(x, y)) && [0, 1].every(t => BIO_DIRS[t].every(([dx, dy]) => { const k = at.get(key(x + dx, y + dy)); return k === undefined || k === from; }));
  const ringAt = (cx, cy, check) => {   // the hexagon round (cx, cy): vertices at 30° + 60k
    const vs = []; for (let k = 0; k < 6; k++) { const a = (30 + 60 * k) * Math.PI / 180; vs.push([cx + Math.cos(a), cy + Math.sin(a), k & 1]); }
    if (check && !vs.every(([x, y]) => !at.has(key(x, y)) || check.includes(at.get(key(x, y))))) return null;
    const ids = vs.map(([x, y, t]) => add(x, y, t, "C", true)); ids.forEach(i => { atoms[i].ring = true; });
    for (let k = 0; k < 6; k++) bond(ids[k], ids[(k + 1) % 6]);
    rings.push([ids, cx, cy]); return ids;
  };
  const core = r();
  if (core < 0.62) {   // fused rings: linear or angular
    const n = core < 0.3 ? 1 : core < 0.5 ? 2 : 3, cs = [[0, 0]];
    for (let i = 1; i < n; i++) { const a = (r() < 0.6 ? 0 : 60 * (1 + ((r() * 4) | 0))) * Math.PI / 180, [px, py] = cs[cs.length - 1], c = [px + Math.cos(a) * Math.sqrt(3), py + Math.sin(a) * Math.sqrt(3)]; if (!cs.some(q => Math.hypot(q[0] - c[0], q[1] - c[1]) < 0.5)) cs.push(c); }
    for (const [cx, cy] of cs) ringAt(cx, cy);
  } else {             // a chain
    let i = add(0, 0, 0);
    for (let s = 0, L = 3 + ((r() * size * 4) | 0); s < L; s++) {
      const opts = nbrs(i).filter(([x, y]) => freeAt(x, y, i)); if (!opts.length) break;
      const [x, y] = opts[(r() * opts.length) | 0], j = add(x, y, 1 - atoms[i].t); bond(i, j); i = j;
    }
  }
  // branches
  for (let b = 0, nb = 1 + ((r() * (2 + size * 3)) | 0); b < nb; b++) {
    const cand = atoms.map((a, i) => i).filter(i => atoms[i].deg < 3 && atoms[i].el === "C"); if (!cand.length) break;
    let i = cand[(r() * cand.length) | 0];
    const len = 1 + ((r() * 3) | 0), first = i;
    if (atoms[i].ring && r() < 0.18) {   // a second ring on a single bond
      const o = nbrs(i).find(([x, y]) => freeAt(x, y, i)); if (!o) continue;
      const j = add(o[0], o[1], 1 - atoms[i].t), dx = o[0] - atoms[i].x, dy = o[1] - atoms[i].y;
      const ids = ringAt(o[0] + dx, o[1] + dy, [j]);
      if (!ids) { atoms.pop(); continue; }
      bond(i, j, 1, true); continue;
    }
    let s = 0;
    for (; s < len; s++) {
      const opts = nbrs(i).filter(([x, y]) => freeAt(x, y, i)); if (!opts.length) break;
      const [x, y] = opts[(r() * opts.length) | 0], j = add(x, y, 1 - atoms[i].t); bond(i, j, 1, i === first); i = j;
    }
    if (s && i !== first) {   // what the branch ends in
      const e = r(), last = bonds[bonds.length - 1];
      if (e < 0.32) { atoms[i].el = "O"; if (s === 1 && !atoms[first].ring && r() < 0.6 && atoms[first].deg <= 3) last.o = 2; }
      else if (e < 0.52) atoms[i].el = "N";
      else if (e < 0.6) atoms[i].el = "Cl";
      else if (e < 0.64) atoms[i].el = "S";
    }
  }
  // a nitrogen in a ring now and then; Kekulé double bonds round the rings; a double bond or two in chains
  for (const [ids] of rings) if (r() < 0.2) { const i = ids[(r() * 6) | 0]; if (atoms[i].deg === 2) atoms[i].el = "N"; }
  const dbl = new Set(), hasD = (i) => dbl.has(i);
  for (const q of bonds) if (q.o === 2) { dbl.add(q.a); dbl.add(q.b); }
  for (const [ids] of rings) {
    const s0 = (r() * 2) | 0;
    for (let k = s0; k < 6; k += 2) { const a = ids[k], b = ids[(k + 1) % 6], q = bonds.find(q => (q.a === a && q.b === b) || (q.a === b && q.b === a)); if (q && !hasD(a) && !hasD(b)) { q.o = 2; dbl.add(a); dbl.add(b); } }
  }
  for (const q of bonds) if (q.o === 1 && !atoms[q.a].ring && !atoms[q.b].ring && atoms[q.a].el === "C" && atoms[q.b].el === "C" && !hasD(q.a) && !hasD(q.b) && r() < 0.18) { q.o = 2; dbl.add(q.a); dbl.add(q.b); }
  let cx = 0, cy = 0; for (const a of atoms) { cx += a.x / atoms.length; cy += a.y / atoms.length; }
  for (const a of atoms) { a.x -= cx; a.y -= cy; }
  for (const q of rings) { q[1] -= cx; q[2] -= cy; }
  return { atoms, bonds, rings };
}
const BIO_RAD = { C: 0.36, O: 0.33, N: 0.34, Cl: 0.45, S: 0.44, H: 0.21 };
/* ball-and-stick: hydrogens filled in (in the plane, or above and below it on saturated carbons), tilted in 3D */
function bioBallStick(r, size, hyd) {
  const M = bioMolGraph(r, size), { atoms, bonds } = M;
  if (hyd) for (let i = 0, n = atoms.length; i < n; i++) {
    const a = atoms[i]; if (a.el === "Cl" || a.el === "S") continue;
    const used = bonds.filter(q => q.a === i || q.b === i).map(q => { const o = atoms[q.a === i ? q.b : q.a]; return [o.x - a.x, o.y - a.y]; });
    const order = bonds.filter(q => q.a === i || q.b === i).reduce((s, q) => s + q.o, 0), valence = { C: 4, N: 3, O: 2 }[a.el] || 0;
    let need = valence - order; if (need <= 0) continue;
    const free = BIO_DIRS[a.t].filter(([dx, dy]) => !used.some(([ux, uy]) => Math.abs(ux - dx) + Math.abs(uy - dy) < 0.2));
    const L = 0.78;
    if (need >= 2 && free.length === 1 && !a.ring) {   // saturated: two hydrogens out of the plane, tetrahedral
      const [dx, dy] = free[0];
      for (const sz of [-1, 1]) { atoms.push({ x: a.x + dx * L * 0.55, y: a.y + dy * L * 0.55, z: sz * L * 0.82, el: "H" }); bonds.push({ a: i, b: atoms.length - 1, o: 1 }); }
      need -= 2;
    }
    for (const [dx, dy] of free) { if (need <= 0) break; atoms.push({ x: a.x + dx * L, y: a.y + dy * L, z: 0, el: "H" }); bonds.push({ a: i, b: atoms.length - 1, o: 1 }); need--; }
  }
  // a little pucker, then a turn in depth about an axis in the plane
  for (const a of atoms) if (a.el !== "H" && !a.ring) a.z += (r() - 0.5) * 0.5;
  const ta = r() * TAU, tilt = (0.25 + r() * 0.75) * (r() < 0.5 ? -1 : 1), ux = Math.cos(ta), uy = Math.sin(ta), c = Math.cos(tilt), s = Math.sin(tilt);
  for (const a of atoms) {   // rotate about the axis (ux, uy, 0)
    const d = a.x * ux + a.y * uy, px = a.x - ux * d, py = a.y - uy * d, pz = a.z, n = Math.hypot(px, py) * Math.sign(-px * uy + py * ux) || 0;
    const qn = n * c - pz * s, qz = n * s + pz * c, nx = -uy, ny = ux;
    a.x = ux * d + nx * qn; a.y = uy * d + ny * qn; a.z = qz;
  }
  let R = 0; for (const a of atoms) R = Math.max(R, Math.hypot(a.x, a.y) + BIO_RAD[a.el] * 1.2);
  return { atoms, bonds, R, kind: "ball" };
}
/* little molecules for the gaps: water, carbon dioxide, methane, ammonia (true angles, turned in 3D) */
function bioSmallMol(r, k) {
  const atoms = [], bonds = [], a = (el, x, y, z) => { atoms.push({ x, y, z, el }); return atoms.length - 1; };
  if (k === 0) { const o = a("O", 0, 0, 0), h = 104.5 / 2 * Math.PI / 180; bonds.push({ a: o, b: a("H", Math.sin(h) * 0.75, Math.cos(h) * 0.75, 0), o: 1 }, { a: o, b: a("H", -Math.sin(h) * 0.75, Math.cos(h) * 0.75, 0), o: 1 }); }
  else if (k === 1) { const c = a("C", 0, 0, 0); bonds.push({ a: c, b: a("O", 1.05, 0, 0), o: 2 }, { a: c, b: a("O", -1.05, 0, 0), o: 2 }); }
  else {   // tetrahedral: CH4, or NH3 with the lone pair empty
    const ctr = a(k === 2 ? "C" : "N", 0, 0, 0), T = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
    for (let i = 0; i < (k === 2 ? 4 : 3); i++) { const [x, y, z] = T[i].map(v => v * 0.8 / Math.sqrt(3)); bonds.push({ a: ctr, b: a("H", x, y, z), o: 1 }); }
  }
  const t1 = r() * TAU, t2 = r() * TAU;
  for (const p of atoms) {
    let { x, y, z } = p; [y, z] = [y * Math.cos(t1) - z * Math.sin(t1), y * Math.sin(t1) + z * Math.cos(t1)]; [x, z] = [x * Math.cos(t2) - z * Math.sin(t2), x * Math.sin(t2) + z * Math.cos(t2)];
    p.x = x; p.y = y; p.z = z;
  }
  let R = 0; for (const p of atoms) R = Math.max(R, Math.hypot(p.x, p.y) + BIO_RAD[p.el] * 1.2);
  return { atoms, bonds, R, kind: "ball" };
}
function bioDrawBall(P, it, inkOf, duo, scheme, gap) {
  const g = P.g, m = it.m, sc = it.r / m.R, gu = gap / sc, A = m.atoms;
  g.save(); g.translate(it.x, it.y); g.rotate(it.rot); g.scale(it.flip ? -sc : sc, sc);
  const la = -P.ang - it.rot, lx0 = -0.62, ly0 = -0.78, lx = (lx0 * Math.cos(la) - ly0 * Math.sin(la)) * (it.flip ? -1 : 1), ly = lx0 * Math.sin(la) + ly0 * Math.cos(la);
  const prims = [];
  for (const q of m.bonds) prims.push([(A[q.a].z + A[q.b].z) / 2 - 0.01, 0, q]);
  A.forEach((a, i) => prims.push([a.z, 1, a]));
  prims.sort((p, q) => p[0] - q[0]);
  const cut = () => { g.globalCompositeOperation = "destination-out"; g.fillStyle = g.strokeStyle = "#000"; };
  const ink = (k) => { g.globalCompositeOperation = "source-over"; g.fillStyle = g.strokeStyle = inkOf(k); };
  const bondInk = scheme === "bonds" ? 2 : 1, wid = 0.13;
  g.lineCap = "butt";
  for (const [z, kind, o] of prims) {
    const pz = 1 + z * 0.12;
    if (kind === 0) {
      // the visible stick: from the rim of one ball to the rim of the other
      const a = A[o.a], b = A[o.b], dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1, nx = -dy / d, ny = dx / d;
      const ra = BIO_RAD[a.el] * (1 + a.z * 0.12) * 0.8, rb = BIO_RAD[b.el] * (1 + b.z * 0.12) * 0.8;
      if (ra + rb >= d * 0.98) continue;
      const offs = o.o === 2 ? [-0.075, 0.075] : [0], w = (o.o === 2 ? 0.065 : wid) * pz * (b.el === "H" || a.el === "H" ? 0.75 : 1);
      const path = new Path2D(); for (const f of offs) { path.moveTo(a.x + dx / d * ra + nx * f, a.y + dy / d * ra + ny * f); path.lineTo(b.x - dx / d * rb + nx * f, b.y - dy / d * rb + ny * f); }
      cut(); g.lineWidth = w + 2 * gu; g.stroke(path); ink(bondInk); g.lineWidth = w; g.stroke(path);
    } else {
      const rr = BIO_RAD[o.el] * pz, het = o.el !== "C" && o.el !== "H";
      cut(); g.beginPath(); g.arc(o.x, o.y, rr + gu, 0, TAU); g.fill();
      const k = (scheme === "het" && het) || (scheme !== "mono" && o.el === "H") ? 2 : 1;
      ink(k); g.beginPath(); g.arc(o.x, o.y, rr, 0, TAU); g.fill();
      if (het && !(duo && scheme === "het")) {   // engraved shading on the heteroatoms: cut lines across the lower part
        g.save(); g.beginPath(); g.arc(o.x, o.y, rr, 0, TAU); g.clip(); cut();
        for (let h = 0; h < 4; h++) {   // lines across the shadow side, heavier toward the rim
          const t = 0.12 + h * 0.24, cx = o.x - lx * rr * t, cy = o.y - ly * rr * t;
          g.lineWidth = rr * (0.05 + h * 0.035); g.beginPath(); g.moveTo(cx + ly * rr, cy - lx * rr); g.lineTo(cx - ly * rr, cy + lx * rr); g.stroke();
        }
        g.restore();
      }
      cut(); g.beginPath(); g.ellipse(o.x + lx * rr * 0.42, o.y + ly * rr * 0.42, rr * 0.3, rr * 0.18, Math.atan2(ly, lx) + Math.PI / 2, 0, TAU); g.fill();
      if (o.el !== "H") { g.beginPath(); g.arc(o.x + lx * rr * 0.12, o.y + ly * rr * 0.12, rr * 0.07, 0, TAU); g.fill(); }
    }
  }
  g.restore();
}
/* skeletal formula: lines, inner second lines or aromatic circles, wedges, heteroatom labels */
function bioSkeletal(r, size) {
  const M = bioMolGraph(r, size), { atoms, bonds, rings } = M, aro = r() < 0.4, lab = new Set();
  atoms.forEach((a, i) => { if (a.el !== "C") lab.add(i); });
  let R = 0; for (const a of atoms) R = Math.max(R, Math.hypot(a.x, a.y) + (a.el !== "C" ? 0.7 : 0.15));
  for (const q of bonds) if (q.sub && q.o === 1 && r() < 0.3) q.wedge = r() < 0.5 ? 1 : 2;
  return { atoms, bonds, rings, aro, lab, R, kind: "skel" };
}
function bioDrawSkel(P, it, inkOf, gap) {
  const g = P.g, m = it.m, sc = it.r / m.R, gu = gap / sc, A = m.atoms, lw = 0.1, lr = 0.36;
  g.save(); g.translate(it.x, it.y); g.rotate(it.rot); g.scale(it.flip ? -sc : sc, sc);
  g.lineCap = "round"; g.lineJoin = "round";
  const lines = new Path2D(), inner = new Path2D(), wedges = new Path2D(), hashes = new Path2D(), circ = new Path2D();
  const end = (i, j, f) => { const a = A[i], b = A[j], t = m.lab.has(i) ? lr / 1 : 0; return [a.x + (b.x - a.x) * (t + f), a.y + (b.y - a.y) * (t + f)]; };
  const ringOf = (q) => m.rings.find(([ids]) => ids.includes(q.a) && ids.includes(q.b));
  for (const q of m.bonds) {
    const [x0, y0] = end(q.a, q.b, 0), [x1, y1] = end(q.b, q.a, 0);
    if (q.wedge === 1) { const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy), nx = -dy / d * 0.13, ny = dx / d * 0.13; bioPoly(wedges, [x0, y0, x1 + nx, y1 + ny, x1 - nx, y1 - ny]); continue; }
    if (q.wedge === 2) { for (let k = 1; k <= 5; k++) { const t = k / 6, w = 0.13 * t, dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy), nx = -dy / d * w, ny = dx / d * w, px = x0 + dx * t, py = y0 + dy * t; hashes.moveTo(px - nx, py - ny); hashes.lineTo(px + nx, py + ny); } continue; }
    lines.moveTo(x0, y0); lines.lineTo(x1, y1);
    if (q.o !== 2) continue;
    const rg = ringOf(q);
    if (rg && m.aro) continue;
    const dx = x1 - x0, dy = y1 - y0, d = Math.hypot(dx, dy); let nx = -dy / d * 0.2, ny = dx / d * 0.2;
    if (rg) { const mx = (x0 + x1) / 2, my = (y0 + y1) / 2; if ((rg[1] - mx) * nx + (rg[2] - my) * ny < 0) { nx = -nx; ny = -ny; } }
    else if (!m.lab.has(q.a) && !m.lab.has(q.b)) { nx *= -0.5; ny *= -0.5; lines.moveTo(x0 - nx * 2 + dx * 0.0, y0 - ny * 2); lines.lineTo(x1 - nx * 2, y1 - ny * 2); continue; }
    const sh = rg ? 0.16 : 0.05; inner.moveTo(x0 + nx + dx * sh, y0 + ny + dy * sh); inner.lineTo(x1 + nx - dx * sh, y1 + ny - dy * sh);
  }
  if (m.aro) for (const [, cx, cy] of m.rings) bioDisc(circ, cx, cy, 0.52);
  // the ground gap round everything, then the ink
  g.globalCompositeOperation = "destination-out"; g.strokeStyle = g.fillStyle = "#000"; g.lineWidth = lw + 2 * gu;
  g.stroke(lines); g.stroke(inner); g.stroke(wedges); g.fill(wedges); g.stroke(hashes);
  for (const i of m.lab) { g.beginPath(); g.arc(A[i].x, A[i].y, lr + gu, 0, TAU); g.fill(); }
  g.globalCompositeOperation = "source-over"; g.strokeStyle = g.fillStyle = inkOf(1); g.lineWidth = lw;
  g.stroke(lines); g.fill(wedges); g.stroke(wedges); g.lineWidth = lw * 0.8; g.stroke(hashes);
  g.strokeStyle = inkOf(2); g.lineWidth = lw; g.stroke(inner); g.stroke(circ);
  // labels, drawn in pixels so the type is hinted at its real size
  g.fillStyle = inkOf(2);
  const T = g.getTransform();
  for (const i of m.lab) {
    const a = A[i], deg = m.bonds.filter(q => q.a === i || q.b === i).length, ord = m.bonds.filter(q => q.a === i || q.b === i).reduce((s, q) => s + q.o, 0);
    const h = { O: 2, N: 3, S: 2, Cl: 1 }[a.el] - ord, txt = a.el + (h > 0 && deg <= 1 ? "H" + (h > 1 ? "₂" : "") : "");
    const p = T.transformPoint(new DOMPoint(a.x, a.y)), px = sc * 0.62;
    if (px < 6.5) { g.beginPath(); g.arc(a.x, a.y, 0.24, 0, TAU); g.fill(); continue; }   // too small to read: an atom dot
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.font = `700 ${px.toFixed(2)}px "Helvetica Neue", Arial, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
    const w = g.measureText(txt).width, tx = p.x + (txt.length > 1 ? w / 2 - g.measureText(a.el).width / 2 : 0);
    g.globalCompositeOperation = "destination-out"; g.fillStyle = "#000"; g.beginPath(); g.ellipse(tx, p.y, w / 2 + px * 0.12 + gap, px * 0.55 + gap, 0, 0, TAU); g.fill();
    g.globalCompositeOperation = "source-over"; g.fillStyle = inkOf(2); g.fillText(txt, tx, p.y + px * 0.04);
    g.restore();
  }
  g.restore();
}
/* DNA: long double helices laid across the area, the strands passing over and under, base pairs as split rungs */
function bioDNA(P, rnd, duo) {
  const g = P.g, lam = P.s * (0.26 + rnd() * 0.14), A = lam * (0.17 + rnd() * 0.05), lw = lam * (0.045 + rnd() * 0.02), gap = Math.max(1, P.s * 0.006);
  const sp = A * 2 * (1.35 + rnd() * 0.6), phi = Math.PI * (0.62 + rnd() * 0.2), bp = 10, wob = A * (0.3 + rnd() * 1.4), wl = lam * (2 + rnd() * 3);
  const wp0 = rnd() * TAU, beads = rnd() < 0.6, inkA = rgba(P.fg), inkB = rgba(P.fg2), x0 = -P.hx - lam, x1 = P.hx + lam;
  g.save(); g.lineJoin = "round";
  for (let y0 = -P.hy - sp + (rnd() * sp) % sp, row = 0; y0 < P.hy + sp; y0 += sp, row++) {
    const ph = rnd() * TAU, wp = wp0 + row * 0.25, cy = (x) => y0 + Math.sin(x / wl * TAU + wp) * wob;   // rows wave together, never touching
    const st = (x, k) => { const t = x / lam * TAU + ph + k * phi; return [cy(x) + A * Math.sin(t), Math.cos(t)]; };
    // rungs: one per base pair, each half in its own ink, a nick between
    const r1 = new Path2D(), r2 = new Path2D(), step = lam / bp;
    for (let x = Math.ceil(x0 / step) * step; x < x1; x += step) {
      const [ya] = st(x, 0), [yb] = st(x, 1), ym = (ya + yb) / 2, nick = Math.min(lw * 0.35, Math.abs(yb - ya) * 0.2) * Math.sign(yb - ya);
      if (Math.abs(yb - ya) < lw * 1.2) continue;
      const sw = rnd() < 0.5; (sw ? r2 : r1).moveTo(x, ya); (sw ? r2 : r1).lineTo(x, ym - nick); (sw ? r1 : r2).moveTo(x, ym + nick); (sw ? r1 : r2).lineTo(x, yb);
    }
    g.lineCap = "butt"; g.lineWidth = lw * 0.55; g.strokeStyle = inkA; g.stroke(r1); g.strokeStyle = inkB; g.stroke(r2);
    // the strands: what is behind first, then what is in front, each with its ground keyline
    const back = [new Path2D(), new Path2D()], front = [new Path2D(), new Path2D()], dx = lam / 48, bd = [new Path2D(), new Path2D()];
    for (const k of [0, 1]) {
      let prev = null;
      for (let x = x0; x <= x1 + dx; x += dx) {
        const [y, z] = st(x, k), cur = [x, y, z];
        if (prev) { const p = (prev[2] + z) / 2 >= 0 ? front[k] : back[k]; p.moveTo(prev[0], prev[1]); p.lineTo(x, y); }
        prev = cur;
      }
      if (beads) for (let x = Math.ceil(x0 / step) * step + step / 2; x < x1; x += step) { const [y, z] = st(x, k); if (z > -0.2) bioDisc(bd[k], x, y, lw * 0.2); }
    }
    for (const L of [back, front]) for (const k of [0, 1]) {
      g.globalCompositeOperation = "destination-out"; g.strokeStyle = "#000"; g.lineWidth = lw + 2 * gap; g.stroke(L[k]);
      g.globalCompositeOperation = "source-over"; g.strokeStyle = k && duo ? inkB : inkA; g.lineWidth = lw; g.stroke(L[k]);
      if (L === front) { g.globalCompositeOperation = "destination-out"; g.fillStyle = "#000"; g.fill(bd[k]); g.globalCompositeOperation = "source-over"; }
    }
  }
  g.restore();
}
function bioMolecules(P) {
  const rnd = P.rnd, duo = isDuo(P), mode = rnd();
  if (mode < 0.22) { bioDNA(P, rnd, duo); return; }
  const skel = mode > 0.62, hyd = rnd() < 0.6, scheme = duo ? (rnd() < 0.55 ? "het" : "bonds") : "mono";
  const lib = bioCached("mol|" + skel + hyd + "|" + P.seed, () => {
    const r = bioRng(P, "mol"), out = [];
    for (let v = 0; v < 10; v++) out.push(skel ? bioSkeletal(r, 0.2 + (v % 5) * 0.2) : bioBallStick(r, 0.15 + (v % 5) * 0.18, hyd));
    return out;
  });
  const rmax = P.s * (skel ? 0.15 + rnd() * 0.05 : 0.17 + rnd() * 0.06), rmin = rmax * (0.45 + rnd() * 0.15);
  const spots = dartPack(P, rmax, rmin, { sp: skel ? 0.9 : 0.72 + rnd() * 0.1, effort: 2 });
  const items = spots.map(c => {
    // bigger molecules to the bigger spots
    const order = lib.slice().sort((a, b) => a.atoms.length - b.atoms.length), f = clamp((c.r - rmin) / (rmax - rmin + 1e-9), 0, 1);
    const m = order[clamp(Math.round(f * (order.length - 1) + (rnd() - 0.5) * 4), 0, order.length - 1)];
    return { x: c.x, y: c.y, r: c.r * 1.08, rot: skel ? (((rnd() * 6) | 0) * Math.PI / 3 + (rnd() - 0.5) * 0.3) : rnd() * TAU, flip: rnd() < 0.5, m };
  });
  const inkOf = (k) => rgba(k === 2 ? P.fg2 : P.fg), gap = Math.max(1, P.s * 0.005);
  // the gaps: small molecules (skeletal: the smallest of the set)
  const small = skel ? lib.slice().sort((a, b) => a.atoms.length - b.atoms.length).slice(0, 3) : bioCached("molfry|" + P.seed, () => { const r = bioRng(P, "molfry"); return [0, 1, 2, 3, 0, 2].map(k => bioSmallMol(r, k)); });
  for (const d of gapDrops(P, items.map(it => ({ x: it.x, y: it.y, r: it.r * 0.82 })), rmin * (skel ? 0.6 : 0.36), 1.1, 2.4)) items.push({ x: d.x, y: d.y, r: d.r, rot: skel ? ((rnd() * 6) | 0) * Math.PI / 3 : rnd() * TAU, flip: rnd() < 0.5, m: small[(rnd() * small.length) | 0] });
  for (const it of items) {
    if (!P.vis(it.x, it.y, it.r + gap * 2)) continue;
    if (skel) bioDrawSkel(P, it, inkOf, gap); else bioDrawBall(P, it, inkOf, duo, scheme, gap);
  }
}

/* ======================================================================
   BONES: anatomical skulls, Día de Muertos candy skulls, a bone-yard pile and X-ray plates.
   Each motif is built once per seed as unit-space Path2Ds (an outline, knocked-out cavities, tapered line work, inner
   ornament) and stamped many times, turned, mirrored and sized, so a 3000 px cover stays quick. The skull is drawn
   from a front template with a little yaw: every point is pushed round a cylinder, so a turned skull foreshortens
   its far side the way a real one does. Needs patterns-characters.js (smoothPoly, strokePts, dartPack, isDuo, smax).
   ====================================================================== */
const BONE_D = Math.PI / 180;
/* closed Catmull-Rom through [[x, y], ...], n samples per span, as a flat point list */
function boneLoop(cp, n = 5) {
  const out = [], m = cp.length;
  for (let i = 0; i < m; i++) {
    const p0 = cp[(i - 1 + m) % m], p1 = cp[i], p2 = cp[(i + 1) % m], p3 = cp[(i + 2) % m];
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      for (let d = 0; d < 2; d++) out.push(0.5 * (2 * p1[d] + (p2[d] - p0[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2 + (3 * p1[d] - p0[d] - 3 * p2[d] + p3[d]) * t3));
    }
  }
  return out;
}
/* open Catmull-Rom through [[x, y], ...] as a function of t in 0..1 (by span) */
function boneCurve(cp) {
  const m = cp.length - 1;
  return (t) => {
    const u = clamp(t, 0, 1) * m, i = Math.min(m - 1, Math.floor(u)), f = u - i;
    const p0 = cp[Math.max(0, i - 1)], p1 = cp[i], p2 = cp[i + 1], p3 = cp[Math.min(m, i + 2)], f2 = f * f, f3 = f2 * f, o = [0, 0];
    for (let d = 0; d < 2; d++) o[d] = 0.5 * (2 * p1[d] + (p2[d] - p0[d]) * f + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * f2 + (3 * p1[d] - p0[d] - 3 * p2[d] + p3[d]) * f3);
    return o;
  };
}
const boneArea = (p) => { let a = 0; for (let i = 0; i < p.length; i += 2) { const j = (i + 2) % p.length; a += p[i] * p[j + 1] - p[j] * p[i + 1]; } return a / 2; };
/* the same winding for every outline, so overlapping parts of one body union under "nonzero" */
function boneWind(p) {
  if (boneArea(p) >= 0) return p;
  const q = []; for (let i = p.length - 2; i >= 0; i -= 2) q.push(p[i], p[i + 1]); return q;
}
const bonePoly = (path, p) => { path.moveTo(p[0], p[1]); for (let i = 2; i < p.length; i += 2) path.lineTo(p[i], p[i + 1]); path.closePath(); };
const boneAdd = (path, p) => smoothPoly(path, boneWind(p));
/* tapered line through control points; w = half width; taper 0..1 how much the ends thin */
function boneLine(path, cp, w, taper = 0.85, n) {
  const f = boneCurve(cp);
  boneAdd(path, strokePts(f, (t) => w * (1 - taper + taper * Math.pow(Math.sin(Math.PI * t), 0.6)), n || Math.max(10, cp.length * 6)));
}
/* a sawtooth-wiggled line (a suture) along control points */
function boneSuture(path, cp, w, amp, k, rnd) {
  const f = boneCurve(cp), pts = [], n = k * 2;
  for (let i = 0; i <= n; i++) {
    const t = i / n, [x, y] = f(t), [ax, ay] = f(Math.max(0, t - 0.01)), [bx, by] = f(Math.min(1, t + 0.01)), d = Math.hypot(bx - ax, by - ay) || 1;
    const a = (i % 2 ? 1 : -1) * amp * (0.5 + rnd() * 0.8) * Math.sin(Math.PI * t) ** 0.5;
    pts.push([x - (by - ay) / d * a, y + (bx - ax) / d * a]);
  }
  boneLine(path, pts, w, 0.7, n * 3);
}
const boneEll = (path, x, y, rx, ry, rot = 0) => boneAdd(path, ellPts(x, y, rx, ry, rot, 18));

/* Closed loops of { V > 0 } on an nx×ny grid (spacing cs), V negative all round the border (isoLoops, rectangular). */
function boneIso(V, nx, ny, cs) {
  const pt = new Map(), nb = new Map();
  const cross = (i0, j0, i1, j1) => {
    const k = (j0 * nx + i0) * 2 + (i1 !== i0 ? 0 : 1);
    if (!pt.has(k)) { const a = V[j0 * nx + i0], b = V[j1 * nx + i1], t = a / (a - b); pt.set(k, [(i0 + (i1 - i0) * t) * cs, (j0 + (j1 - j0) * t) * cs]); }
    return k;
  };
  const link = (a, b) => { (nb.get(a) || nb.set(a, []).get(a)).push(b); (nb.get(b) || nb.set(b, []).get(b)).push(a); };
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = V[j * nx + i], b = V[j * nx + i + 1], c = V[(j + 1) * nx + i + 1], d = V[(j + 1) * nx + i];
    const m = (a > 0 ? 1 : 0) | (b > 0 ? 2 : 0) | (c > 0 ? 4 : 0) | (d > 0 ? 8 : 0);
    if (m === 0 || m === 15) continue;
    const T = () => cross(i, j, i + 1, j), R = () => cross(i + 1, j, i + 1, j + 1), B = () => cross(i, j + 1, i + 1, j + 1), L = () => cross(i, j, i, j + 1);
    switch (m) {
      case 1: case 14: link(L(), T()); break;
      case 2: case 13: link(T(), R()); break;
      case 3: case 12: link(L(), R()); break;
      case 4: case 11: link(R(), B()); break;
      case 6: case 9: link(T(), B()); break;
      case 7: case 8: link(L(), B()); break;
      case 5: case 10: {
        const ctr = (a + b + c + d) / 4 > 0;
        if ((m === 5) === ctr) { link(L(), B()); link(T(), R()); } else { link(L(), T()); link(R(), B()); }
      }
    }
  }
  const loops = [], seen = new Set();
  for (const k0 of nb.keys()) {
    if (seen.has(k0)) continue;
    const loop = []; let prev = -1, k = k0;
    while (k !== undefined && !seen.has(k)) {
      seen.add(k); const p = pt.get(k); loop.push(p[0], p[1]);
      const L = nb.get(k), nx2 = L[0] !== prev ? L[0] : L[1]; prev = k; k = nx2;
    }
    if (loop.length >= 6) loops.push(loop);
  }
  return loops;
}
/* F > 0 inside, contoured over [x0, x1]×[y0, y1] at step cs, into path (holes by "evenodd"). levels: contour F > l
   for each l into its own path, from one sampling of F (returns the paths). */
function boneField(path, F, x0, y0, x1, y1, cs, levels) {
  const nx = Math.ceil((x1 - x0) / cs) + 5, ny = Math.ceil((y1 - y0) / cs) + 5, ox = x0 - 2 * cs, oy = y0 - 2 * cs, V = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) V[j * nx + i] = (i < 1 || j < 1 || i > nx - 2 || j > ny - 2) ? -9 : F(ox + i * cs, oy + j * cs);
  // every other crossing is plenty for the smoothing quadratics (half the segments to fill and stroke)
  const one = (p, V) => { for (const L0 of boneIso(V, nx, ny, cs)) { const L = []; const st = L0.length > 48 ? 4 : 2; for (let i = 0; i < L0.length; i += st) L.push(L0[i] + ox, L0[i + 1] + oy); smoothPoly(p, L); } return p; };
  if (!levels) return one(path, V);
  return levels.map((l) => one(new Path2D(), V.map((v) => v - l)));
}
/* distance-ish primitives (positive inside) */
const boneCap = (x, y, ax, ay, bx, by, ra, rb = ra) => {
  const vx = bx - ax, vy = by - ay, t = clamp(((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1), 0, 1), dx = x - ax - vx * t, dy = y - ay - vy * t;
  return ra + (rb - ra) * t - Math.sqrt(dx * dx + dy * dy);
};
const boneDisc = (x, y, cx, cy, r) => r - Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
const boneOval = (x, y, cx, cy, rx, ry) => { const u = (x - cx) / rx, v = (y - cy) / ry; return (1 - Math.sqrt(u * u + v * v)) * (rx < ry ? rx : ry); };

/* ---------- stamping ----------
   A shape is { body: Path2D, ops: [[Path2D, op]], box: [x0, y0, x1, y1] } in unit space; op "cut" knocks out to the
   ground, "body" prints in the item's ink, "alt" in the other ink, "ring" cuts the path's outline (width w).
   Items { x, y, r, rot, flip, shape, ink: 1|2, shadow }. Every item first clears a gap round itself, so overlaps read
   as stacked stickers and cavities show the ground, not the motif below.
   Small items (a preview) are stamped from sprites: each shape drawn once, at twice the largest size it is used at,
   and laid with drawImage; a path with hundreds of segments costs about the same to fill at 20 px as at 200 px. */
const BONE_SPRITE_PX = 64;
function boneOps(g, S, col, ink, gapU) {
  g.fillStyle = col(ink); g.fill(S.body, S.rule || "nonzero");
  for (const [p, op, w] of S.ops) {
    if (op === "cut") { g.globalCompositeOperation = "destination-out"; g.fillStyle = "#000"; g.fill(p); g.globalCompositeOperation = "source-over"; }
    else if (op === "ring") { g.globalCompositeOperation = "destination-out"; g.strokeStyle = "#000"; g.lineWidth = 2 * (w || gapU); g.stroke(p); g.fill(p); g.globalCompositeOperation = "source-over"; }
    else { g.fillStyle = col(op === "alt" ? 3 - ink : ink); g.fill(p); }
  }
}
/* Sprites for the small items, all in one atlas canvas (one canvas, not dozens). kind "art" (the motif in ink),
   "gap" (its silhouette grown by the gap, to clear with), "sil" (the silhouette in the other ink, for shadows) and
   "holes" (its cavities, cut through the shadow as the vector path does). */
function boneAtlas(items, gap, col) {
  const need = new Map(), R = new Map();
  for (const it of items) if (it.r <= BONE_SPRITE_PX) R.set(it.shape, Math.max(R.get(it.shape) || 0, it.r));
  for (const it of items) {
    if (it.r > BONE_SPRITE_PX) continue;
    const keys = [["gap", 0], ["art", it.ink]]; if (it.shadow) keys.push(["sil", 3 - it.ink], ["holes", 0]);
    for (const [kind, ink] of keys) {
      const S = it.shape, key = kind + ink; let m = need.get(S); if (!m) need.set(S, m = new Map());
      if (!m.has(key)) {
        const [x0, y0, x1, y1] = S.box || [-2, -2, 2, 2], k = R.get(S) * 2, pad = Math.ceil(gap * 2 + 3);
        m.set(key, { kind, ink, k, pad, x0, y0, w: Math.ceil((x1 - x0) * k + 2 * pad), h: Math.ceil((y1 - y0) * k + 2 * pad) });
      }
    }
  }
  const all = []; for (const m of need.values()) for (const e of m.values()) all.push(e);
  if (!all.length) return null;
  all.sort((a, b) => b.h - a.h);
  const W = Math.max(1024, ...all.map(e => e.w)); let x = 0, y = 0, rowH = 0;
  for (const e of all) { if (x + e.w > W) { x = 0; y += rowH; rowH = 0; } e.ax = x; e.ay = y; x += e.w; rowH = Math.max(rowH, e.h); }
  const c = makeCanvas(W, y + rowH), g = c.getContext("2d");
  for (const [S, m] of need) for (const e of m.values()) {
    g.save(); g.beginPath(); g.rect(e.ax, e.ay, e.w, e.h); g.clip();
    g.translate(e.ax + e.pad - e.x0 * e.k, e.ay + e.pad - e.y0 * e.k); g.scale(e.k, e.k); g.lineJoin = "round";
    if (e.kind === "art") boneOps(g, S, col, e.ink, gap / (e.k / 2));
    else if (e.kind === "holes") { g.fillStyle = "#000"; for (const [p, op] of S.ops) if (op === "cut") g.fill(p); }
    else { g.fillStyle = e.kind === "gap" ? "#000" : col(e.ink); g.fill(S.body, S.rule || "nonzero"); if (e.kind === "gap") { g.strokeStyle = "#000"; g.lineWidth = 4 * gap / e.k; g.stroke(S.body); } }
    g.restore();
  }
  return { c, get: (S, kind, ink) => need.get(S).get(kind + ink) };
}
function boneStamp(P, items, gap, shOff) {
  const g = P.g, col = (k) => rgba(k === 2 ? P.fg2 : P.fg);
  g.lineJoin = "round";
  const vis = items.filter(it => P.vis(it.x, it.y, it.r * (it.reach || 2))), atlas = boneAtlas(vis, gap, col);
  for (const it of vis) {
    const S = it.shape, r = it.r, fl = it.flip ? -1 : 1;
    let sx = 0, sy = 0;
    if (it.shadow && shOff) { const c = Math.cos(-it.rot), s = Math.sin(-it.rot); sx = (shOff[0] * c - shOff[1] * s) / r * fl; sy = (shOff[0] * s + shOff[1] * c) / r; }
    g.save(); g.translate(it.x, it.y); g.rotate(it.rot); g.scale(r * fl, r);
    if (r <= BONE_SPRITE_PX) {
      const lay = (e, dx = 0, dy = 0) => g.drawImage(atlas.c, e.ax, e.ay, e.w, e.h, e.x0 - e.pad / e.k + dx, e.y0 - e.pad / e.k + dy, e.w / e.k, e.h / e.k);
      const gp = atlas.get(S, "gap", 0);
      g.globalCompositeOperation = "destination-out"; lay(gp); if (it.shadow) lay(gp, sx, sy);
      g.globalCompositeOperation = "source-over";
      if (it.shadow) { lay(atlas.get(S, "sil", 3 - it.ink), sx, sy); g.globalCompositeOperation = "destination-out"; lay(atlas.get(S, "holes", 0)); g.globalCompositeOperation = "source-over"; }
      lay(atlas.get(S, "art", it.ink));
      g.restore(); continue;
    }
    const rule = S.rule || "nonzero";
    g.globalCompositeOperation = "destination-out"; g.fillStyle = "#000"; g.strokeStyle = "#000"; g.lineWidth = 2 * gap / r;
    g.fill(S.body, rule); g.stroke(S.body);
    if (it.shadow) { g.translate(sx, sy); g.fill(S.body, rule); g.stroke(S.body); g.translate(-sx, -sy); }
    g.globalCompositeOperation = "source-over";
    if (it.shadow) { g.fillStyle = col(3 - it.ink); g.translate(sx, sy); g.fill(S.body, rule); g.translate(-sx, -sy); }
    boneOps(g, S, col, it.ink, gap / r);
    g.restore();
  }
  if (atlas) release(atlas.c);
}
const boneShuffle = (rnd, a) => { for (let i = a.length - 1; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

/* ---------- SKULL: a front template, turned a little ---------- */
/* o: { yaw, sugar, open (jaw drop), lw (line half width), shade (+1/-1 side in shadow), detail 0..1 }.
   Returns { body, holes, lines, teeth, septum, eyes: [[cx, cy, rx, ry]], mouth, pts } (unit space, ~ -1.4..1.6 high) */
function boneSkullParts(rnd, o) {
  const yaw = o.yaw || 0, c = Math.cos(yaw), s = Math.sin(yaw), sugar = !!o.sugar, lw = o.lw, sh = o.shade || 1;
  const zf = (x) => 0.9 * Math.sqrt(Math.max(0, 1 - (x / 1.15) ** 2));
  const pr = (x, y, k = 1) => [x * c + zf(x) * k * s, y];
  const prl = (L, k) => L.map(([x, y]) => pr(x, y, k));
  const flat = (L) => L.flat();
  // genes
  const crH = (sugar ? 1.02 : 0.92) + rnd() * 0.12, cyc = -0.3, crW = sugar ? 1.04 : 1;
  const cheek = (sugar ? 0.92 : 0.86) + rnd() * 0.07, temple = cheek - 0.06 - rnd() * 0.04;
  const alv = 0.8, bite = 0.98, lalv = 1.12, jawW = (sugar ? 0.5 : 0.6) + rnd() * 0.08, chinW = 0.16 + rnd() * 0.14, chinY = (sugar ? 1.34 : 1.42) + rnd() * 0.1;
  const open = o.open || 0;
  const jawY = (y) => y + open * clamp((y - 0.5) / 0.8, 0, 1.2);
  // upper skull: dome, temple, cheekbone, maxilla, down to the upper alveolar line
  const R = [];
  for (const a of [-62, -32, -6, 14]) R.push([Math.cos(a * BONE_D) * crW, cyc + Math.sin(a * BONE_D) * crH, 0.15]);
  R.push([temple, 0.12, 0.35], [cheek, 0.33, 0.45], [cheek - 0.16, 0.5, 0.7], [0.52, 0.66, 0.9], [0.42, alv - 0.02, 1], [0.16, alv + 0.02, 1]);
  const up = [[0, cyc - crH * crW * 0.99]];
  for (const [x, y, k] of R) up.push(pr(x, y, k));
  up.push(pr(0, alv + 0.03, 1));
  for (let i = R.length - 1; i >= 0; i--) { const [x, y, k] = R[i]; up.push(pr(-x, y, k)); }
  // the dome turns about its own centre, so pull dome points back to a circle-ish outline
  const body = new Path2D(), upPts = boneLoop(up, 6); boneAdd(body, upPts);
  // mandible: a U, ramus up each side, the body round the chin, the inner edge along the lower teeth
  const mo = [[0.64, 0.4], [0.74, 0.6], [jawW + 0.1, 0.94], [jawW, 1.16], [(jawW + chinW) / 2 + 0.04, chinY - 0.1], [chinW, chinY], [0, chinY + 0.04]];
  const mi = [[0, lalv], [0.3, lalv - 0.02], [0.45, lalv - 0.1], [0.54, 0.74], [0.56, 0.46]];
  const mand = [];
  for (const [x, y] of mo) mand.push(pr(x, jawY(y), 0.8));
  for (let i = mo.length - 2; i >= 0; i--) { const [x, y] = mo[i]; mand.push(pr(-x, jawY(y), 0.8)); }
  for (let i = mi.length - 1; i >= 0; i--) { const [x, y] = mi[i]; mand.push(pr(-x, jawY(y), 0.95)); }
  for (let i = 1; i < mi.length; i++) { const [x, y] = mi[i]; mand.push(pr(x, jawY(y), 0.95)); }
  boneAdd(body, boneLoop(mand, 5));
  // teeth: rounded-ended blocks along an arch, upper hanging from the maxilla, lower standing in the jaw
  const teeth = new Path2D(), nT = 5 + (rnd() < 0.5 ? 1 : 0), tw = 0.44, gapT = 0.014, miss = sugar ? 0 : rnd() * 0.2;
  const widths = []; let acc = 0;
  for (let i = 0; i < nT; i++) { const w = [0.09, 0.075, 0.072, 0.066, 0.064, 0.06][i] * (0.94 + rnd() * 0.12); widths.push(w); acc += w + gapT; }
  const sc = tw / acc, arch = (x) => 0.07 * (x / tw) ** 2;
  const tooth = (x0, x1, ya, yb, roundBottom) => {   // ya: rooted end, yb: free end
    const L = [], rr = (x1 - x0) * 0.42, dir = roundBottom ? 1 : -1;
    L.push([x0, ya], [x1, ya]);
    for (let k = 0; k <= 6; k++) { const a = k / 6 * Math.PI / 2; L.push([x1 - rr + rr * Math.cos(a), yb - dir * rr + dir * rr * Math.sin(a)]); }
    for (let k = 0; k <= 6; k++) { const a = Math.PI / 2 + k / 6 * Math.PI / 2; L.push([x0 + rr + rr * Math.cos(a), yb - dir * rr + dir * rr * Math.sin(a)]); }
    const q = []; for (const [x, y] of L) q.push(...pr(x, y, 1.05)); bonePoly(teeth, boneWind(q));
  };
  for (const sg of [-1, 1]) {
    let x = gapT / 2 * sc;
    for (let i = 0; i < nT; i++) {
      const w = widths[i] * sc, xa = sg > 0 ? x : -x - w, xb = sg > 0 ? x + w : -x, xm = (xa + xb) / 2, ar = arch(xm);
      const long = i === 2 ? 0.025 : 0, upLen = (bite - alv) - ar * 0.6 + long - (i > 2 ? 0.02 : 0), loLen = (lalv - bite) - ar * 0.4 + long * 0.6;
      if (!(i > 0 && rnd() < miss)) tooth(xa, xb, alv - 0.05 - ar, alv - ar + upLen * (rnd() < miss * 0.5 ? 0.6 : 1), true);
      if (!(i > 0 && rnd() < miss)) tooth(xa, xb, jawY(lalv + 0.05 - ar * 0.4), jawY(lalv - ar * 0.4 - loLen + 0.012), false);
      x += w + gapT * sc;
    }
  }
  body.addPath(teeth);
  // the band the teeth stand in (cut it, then print the teeth, to show them on a solid face)
  const mouth = new Path2D(); {
    const L = [], e = tw + 0.03;
    for (let i = 0; i <= 10; i++) { const x = -e + 2 * e * i / 10; L.push(pr(x, alv - arch(x), 1.05)); }
    for (let i = 10; i >= 0; i--) { const x = -e + 2 * e * i / 10; L.push(pr(x, jawY(lalv - arch(x) * 0.4), 1.05)); }
    boneAdd(mouth, L.flat());
    if (o.block) body.addPath(mouth);
  }
  // cavities: eye sockets, the nasal aperture, little foramina
  const holes = new Path2D(), eyes = [];
  const ex = (sugar ? 0.4 : 0.37) + rnd() * 0.04, ey = (sugar ? 0.06 : 0.1) + rnd() * 0.05;
  const ow = (sugar ? 0.26 : 0.215) + rnd() * 0.05, oh = (sugar ? 0.25 : 0.19) + rnd() * 0.05, oe = sugar ? 2.1 + rnd() * 0.5 : 2.4 + rnd() * 1.6;
  const droop = (rnd() - 0.35) * 0.1, brow = 0.75 + rnd() * 0.2, rimL = [];
  for (const sg of [-1, 1]) {
    const L = [];
    for (let i = 0; i < 26; i++) {
      const a = i / 26 * TAU, ca = Math.cos(a), sa = Math.sin(a);
      const u = Math.sign(ca) * Math.abs(ca) ** (2 / oe), v = Math.sign(sa) * Math.abs(sa) ** (2 / oe);
      const x = ex + ow * u, y = ey + oh * v * (v < 0 ? brow : 1) + droop * u + (u < 0 && v > 0 ? 0.03 * -u * v : 0);
      L.push(pr(sg * x, y, 1));
    }
    boneAdd(holes, flat(L));
    const [cx] = pr(sg * ex, ey, 1), [x0] = pr(sg * (ex - ow), ey), [x1] = pr(sg * (ex + ow), ey);
    eyes.push([cx, ey, Math.abs(x1 - x0) / 2, oh, flat(L)]);
    rimL.push(sg);
  }
  // nasal aperture: an inverted heart with a spine at the bottom
  const nW = (sugar ? 0.15 : 0.12) + rnd() * 0.03, nTop = (sugar ? 0.36 : 0.32) + rnd() * 0.04, nBot = (sugar ? 0.6 : 0.68) + rnd() * 0.04;
  const nose = [[0, nTop], [nW * 0.45, nTop + 0.1], [nW * 0.95, nBot - 0.14], [nW, nBot - 0.05], [nW * 0.6, nBot], [nW * 0.15, nBot - 0.015], [0, nBot - 0.06]];
  { const L = []; for (const [x, y] of nose) L.push(pr(x, y)); for (let i = nose.length - 2; i > 0; i--) { const [x, y] = nose[i]; L.push(pr(-x, y)); } boneAdd(holes, boneLoop(L, 4)); }
  if (!sugar) for (const sg of [-1, 1]) {
    boneEll(holes, ...pr(sg * (ex - 0.06), ey - oh * brow - 0.05), 0.02, 0.014);   // supraorbital notch
    boneEll(holes, ...pr(sg * (ex - 0.04), ey + oh + 0.13), 0.022, 0.016);         // infraorbital foramen
    boneEll(holes, ...pr(sg * 0.3, jawY(1.25)), 0.02, 0.015);                    // mental foramen
  }
  // line work: sutures, the temporal line, the cheekbone, the brow ridge, nasal bones, chin; then hatching
  const lines = new Path2D(), L1 = lw, L2 = lw * 0.75;
  if (!sugar) {
    const cs = [], ys = cyc - crH * (0.62 + rnd() * 0.1);
    for (let i = 0; i <= 6; i++) { const t = i / 6, x = -0.82 + 1.64 * t; cs.push(pr(x, ys + (1 - Math.cos((t - 0.5) * Math.PI)) * 0.0 + Math.abs(x) ** 2 * 0.42, 0.25)); }
    boneSuture(lines, cs, L2, 0.022, 26, rnd);
    if (rnd() < 0.6) { const yb = ys - 0.05; boneSuture(lines, [pr(0, yb), pr(0.01, yb - 0.12), pr(-0.01, cyc - crH * 0.95)], L2 * 0.9, 0.018, 6, rnd); }
    for (const sg of [-1, 1]) {
      boneLine(lines, [pr(sg * (ex + ow * 0.9), ey - oh * 0.6), pr(sg * 0.82, -0.18, 0.3), pr(sg * 0.8, -0.62, 0.2), pr(sg * 0.6, -0.95, 0.2)], L1 * 0.9);   // temporal line
      boneLine(lines, [pr(sg * (ex + ow * 0.1), ey + oh + 0.2), pr(sg * (cheek - 0.2), 0.42), pr(sg * (cheek - 0.1), 0.36, 0.45)], L1);   // under the cheekbone
      boneLine(lines, [pr(sg * (ex - ow * 0.7), ey - oh * brow - 0.035), pr(sg * ex, ey - oh * brow - 0.06), pr(sg * (ex + ow * 0.85), ey - oh * brow * 0.6 + droop * 0.8)], L1);   // brow ridge
      boneLine(lines, [pr(sg * 0.04, ey - 0.02), pr(sg * 0.06, nTop - 0.04)], L2);   // nasal bone
      boneLine(lines, [pr(sg * (nW + 0.05), nBot - 0.02), pr(sg * (nW + 0.08), alv - 0.06)], L2);   // canine ridge
      boneLine(lines, [pr(sg * 0.12, jawY(chinY - 0.05)), pr(sg * 0.2, jawY(chinY - 0.2)), pr(sg * 0.12, jawY(chinY - 0.32))], L2);   // chin
      boneSuture(lines, [pr(sg * (temple - 0.06), 0.02, 0.35), pr(sg * (temple - 0.02), -0.18, 0.3), pr(sg * (temple + 0.05), -0.32, 0.2)], L2 * 0.8, 0.014, 7, rnd);   // temple suture
    }
    // hatching on the shadow side: contour strokes inside the cranium edge, under the cheekbone, down the jaw
    const nh = 3 + ((rnd() * 3) | 0);
    for (let k = 1; k <= nh; k++) {
      const f = 1 - k * 0.055, a0 = -80 + k * 8, a1 = 8 - k * 7, cp = [];
      for (let q = 0; q <= 5; q++) { const a = a0 + (a1 - a0) * q / 5; cp.push(pr(sh * Math.cos(a * BONE_D) * crW * f, cyc + Math.sin(a * BONE_D) * crH * f, 0.15)); }
      boneLine(lines, cp, L2 * (1.15 - k * 0.12));
    }
    for (let k = 0; k < 3; k++) boneLine(lines, [pr(sh * (cheek - 0.16 - k * 0.07), 0.5 + k * 0.035, 0.7), pr(sh * (cheek - 0.2 - k * 0.07), 0.6 + k * 0.03, 0.75)], L2 * 0.8);
    for (let k = 0; k < 2; k++) boneLine(lines, [pr(sh * (jawW + 0.04 - k * 0.07), jawY(0.98 + k * 0.04), 0.8), pr(sh * (jawW - 0.08 - k * 0.07), jawY(1.24 + k * 0.03), 0.8)], L2 * 0.8);
  }
  const septum = new Path2D();
  boneLine(septum, [pr(0, nTop + 0.07), pr(0.01, (nTop + nBot) / 2), pr(0, nBot - 0.08)], lw * (sugar ? 0.9 : 1.1), 0.6);
  return { body, holes, lines, teeth, mouth, septum, eyes, nose: [nW, nTop, nBot], pr, jawY, alv, bite, lalv, ex, ey, ow, oh, cyc, crH, cheek, chinY };
}

/* a skull shape for the stamp, by ink style */
function boneSkullShape(rnd, o) {
  const k = boneSkullParts(rnd, o), ops = [[k.holes, "cut"]];
  if (o.style === "engrave") ops.push([k.lines, "alt"]); else ops.push([k.lines, "cut"]);
  ops.push([k.septum, "body"]);
  if (o.style === "eyes") for (const [cx, cy, rx, ry, pts] of k.eyes) {   // lit sockets: the socket's own shape, inset, in the other ink
    let mx = 0, my = 0; for (let i = 0; i < pts.length; i += 2) { mx += pts[i]; my += pts[i + 1]; } mx /= pts.length / 2; my /= pts.length / 2;
    const f = 0.7, q = pts.map((v, i) => (i & 1 ? my + 0.03 + (v - my) * f : mx + (v - mx) * f)), p = new Path2D(); boneAdd(p, q); ops.push([p, "alt"]);
    const c = new Path2D(); boneEll(c, mx, my + 0.03, rx * 0.16, ry * 0.2); ops.push([c, "cut"]);
  }
  return { body: k.body, ops, box: [-1.35, -1.55, 1.35, 1.75] };
}

function boneSkulls(P) {
  const g = P.g; g.save();
  const rnd = P.rnd, duo = isDuo(P), rmax = P.s * (0.09 + rnd() * 0.05), rmin = rmax * (0.38 + rnd() * 0.2);
  const spin = rnd() < 0.3 ? Math.PI : 0.25 + rnd() * 0.6, yawMax = 0.15 + rnd() * 0.3, shade = rnd() < 0.5 ? -1 : 1;
  const style = duo ? ["engrave", "eyes", "shadow", "mix"][(rnd() * 4) | 0] : "solid";
  const lw = Math.max(0.016, 0.55 / rmin), nv = 6;
  const shapes = [];
  for (let v = 0; v < nv; v++) {
    const yaw = (v / (nv - 1) * 2 - 1) * yawMax + (rnd() - 0.5) * 0.06;
    shapes.push(boneSkullShape(rnd, { yaw, lw, shade, open: rnd() < 0.3 ? 0.05 + rnd() * 0.12 : 0, style }));
  }
  const spots = dartPack(P, rmax, rmin, { sp: 0.7 + rnd() * 0.08, effort: 2 });
  const items = spots.map((c) => ({ x: c.x, y: c.y + c.r * 0.05, r: c.r * 0.72, reach: 2.2, rot: (rnd() - 0.5) * 2 * spin, flip: rnd() < 0.5, shape: shapes[(rnd() * nv) | 0],
    ink: style === "mix" && rnd() < 0.5 ? 2 : 1, shadow: style === "shadow" }));
  boneShuffle(rnd, items);
  boneStamp(P, items, Math.max(1, P.s * 0.006), style === "shadow" ? [P.s * 0.01, P.s * 0.012] : null);
  g.restore();
}

/* ---------- SUGAR SKULL: the skull as a candy blank, dressed in ornament ---------- */
const boneAt = (dst, src, x, y, sc = 1, rot = 0) => { const c = Math.cos(rot) * sc, s = Math.sin(rot) * sc; dst.addPath(src, new DOMMatrix([c, s, -s, c, x, y])); };
function boneHeart(path, x, y, r, rot = 0) {
  const L = [], c = Math.cos(rot), s = Math.sin(rot);
  for (let i = 0; i < 30; i++) {
    const t = i / 30 * TAU, u = 16 * Math.sin(t) ** 3 / 17 * r, v = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 17 * r + r * 0.15;
    L.push(x + u * c - v * s, y + u * s + v * c);
  }
  boneAdd(path, L);
}
function boneSpiral(path, x, y, r, turns, a0, dir, w) {
  const cp = [];
  for (let i = 0; i <= 14; i++) { const t = i / 14, rr = r * (0.12 + 0.88 * t), a = a0 + dir * (1 - t) * turns * TAU; cp.push([x + Math.cos(a) * rr, y + Math.sin(a) * rr]); }
  boneLine(path, cp, w, 0.9, 40);
}
function bonePetalRing(path, x, y, r0, r1, n, a0, fat) {
  const pp = new Path2D(); petals(pp, n, r0, r1, Math.sin(Math.PI / n) * r1 * fat, a0, 1.15, 0.9); boneAt(path, pp, x, y);
}
/* One candy skull: { body, ops } with its ornament in fills (outlined in mono, the other ink in duo) and lines. */
function boneSugarShape(rnd, o) {
  const k = boneSkullParts(rnd, { sugar: true, yaw: o.yaw, lw: o.lw, block: true }), pr = k.pr, lw = o.lw, duo = o.duo, kit = o.kit;
  const fills = new Path2D(), fills2 = new Path2D(), lines = new Path2D(), dots = new Path2D(), eyeIn = [];
  const pick = (a) => a[(rnd() * a.length) | 0];
  const er = Math.min(k.ow, k.oh), eyeK = pick(kit.eye), rim = pick(kit.rim);
  // round the eyes: petals, a scalloped lace, a ring of dots or spikes
  for (const sg of [-1, 1]) {
    const [cx, cy] = pr(sg * k.ex, k.ey), a0 = rnd() * TAU;
    if (rim === "petals") bonePetalRing(fills, cx, cy, er * 0.8, er * 1.5, 9 + ((rnd() * 4) | 0), a0, 0.75);
    else if (rim === "lace") {
      const n = 12 + ((rnd() * 4) | 0);
      for (let i = 0; i < n; i++) { const a = a0 + i / n * TAU; boneEll(fills, cx + Math.cos(a) * er * 1.18, cy + Math.sin(a) * er * 1.18, er * 0.24, er * 0.24); }
      // dots outside the scallops
      for (let i = 0; i < n; i++) { const a = a0 + (i + 0.5) / n * TAU; boneEll(dots, cx + Math.cos(a) * er * 1.5, cy + Math.sin(a) * er * 1.5, er * 0.065, er * 0.065); }
    } else if (rim === "spikes") {
      const n = 14 + ((rnd() * 6) | 0);
      for (let i = 0; i < n; i++) { const a = a0 + i / n * TAU, c = Math.cos(a), s2 = Math.sin(a), L = er * (1.35 + (i % 2) * 0.18); boneLine(lines, [[cx + c * er * 1.06, cy + s2 * er * 1.06], [cx + c * L, cy + s2 * L]], lw * 1.1, 0.5); }
    } else {   // dotted ring
      const n = 11 + ((rnd() * 4) | 0);
      for (let i = 0; i < n; i++) { const a = a0 + i / n * TAU; boneEll(fills, cx + Math.cos(a) * er * 1.3, cy + Math.sin(a) * er * 1.3, er * 0.13, er * 0.13); }
    }
    eyeIn.push([cx, cy]);
  }
  // the forehead: a flower, a sacred heart, a web or a diamond, flanked by leaves or curls, under an arc of dots
  const fx = pr(0, -0.62)[0], fy = k.cyc - k.crH * 0.36, fr = 0.2 + rnd() * 0.06, fk = pick(kit.brow);
  if (fk === "flower") {
    const n = 5 + ((rnd() * 4) | 0); bonePetalRing(fills, fx, fy, 0, fr * 1.3, n, rnd() * TAU, 0.8);
    boneEll(fills2, fx, fy, fr * 0.36, fr * 0.36); boneEll(dots, fx, fy, fr * 0.14, fr * 0.14);
  } else if (fk === "heart") {
    boneHeart(fills, fx, fy + fr * 0.2, fr * 1.15);
    boneHeart(fills2, fx, fy + fr * 0.28, fr * 0.5);
    for (let i = -2; i <= 2; i++) boneLine(lines, [[fx + i * fr * 0.22, fy - fr * 0.95], [fx + i * fr * 0.36, fy - fr * (1.45 - Math.abs(i) * 0.12)]], lw * 1.1, 0.6);   // rays
  } else if (fk === "web") {
    const n = 7, R2 = fr * 1.7, cx = fx, cy = fy + fr * 0.9;
    for (let i = 0; i < n; i++) { const a = Math.PI + (i + 0.5) / n * Math.PI; boneLine(lines, [[cx, cy], [cx + Math.cos(a) * R2, cy + Math.sin(a) * R2]], lw * 0.9, 0.3); }
    for (const f of [0.38, 0.66, 0.94]) {
      for (let i = 0; i < n - 1; i++) {
        const a = Math.PI + (i + 0.5) / n * Math.PI, b = a + Math.PI / n, m = (a + b) / 2, rr = R2 * f;
        boneLine(lines, [[cx + Math.cos(a) * rr, cy + Math.sin(a) * rr], [cx + Math.cos(m) * rr * 0.86, cy + Math.sin(m) * rr * 0.86], [cx + Math.cos(b) * rr, cy + Math.sin(b) * rr]], lw * 0.8, 0.3);
      }
    }
  } else {   // diamond with dots
    const d = fr * 1.25, dia = (sc) => { const L = []; for (let q = 0; q < 4; q++) for (let i = 0; i < 6; i++) {   // a diamond with drawn-in sides
      const a = q * Math.PI / 2, b = a + Math.PI / 2, t = i / 6, ax = Math.sin(a) * 0.8, ay = -Math.cos(a) * 1.25, bx = Math.sin(b) * 0.8, by = -Math.cos(b) * 1.25, m = 0.16 * Math.sin(Math.PI * t);
      L.push(fx + d * sc * (ax + (bx - ax) * t - (ax + bx) * m), fy + d * sc * (ay + (by - ay) * t - (ay + by) * m)); } return L; };
    bonePoly(fills, boneWind(dia(1))); bonePoly(fills2, boneWind(dia(0.45)));
    for (const [ax, ay] of [[0, -1.6], [1.15, 0], [0, 1.6], [-1.15, 0]]) boneEll(dots, fx + ax * d, fy + ay * d, d * 0.12, d * 0.12);
  }
  const flank = pick(kit.flank);
  for (const sg of [-1, 1]) {
    if (flank === "leaves") for (let i = 0; i < 2; i++) {
      const a = sg > 0 ? -0.35 - i * 0.55 : Math.PI + 0.35 + i * 0.55, d = fr * (1.65 + i * 0.25), x = fx + Math.cos(a) * d, y = fy + Math.sin(a) * d + fr * 0.35;
      boneEll(fills, x, y, fr * 0.42, fr * 0.17, a);
    } else if (flank === "curls") boneSpiral(lines, fx + sg * fr * 1.9, fy + fr * 0.25, fr * 0.6, 1.15, sg > 0 ? Math.PI : 0, sg, lw * 1.2);
    else for (let i = 0; i < 3; i++) boneEll(dots, fx + sg * fr * (1.6 + i * 0.45), fy + fr * (0.3 - i * 0.18), fr * (0.16 - i * 0.03), fr * (0.16 - i * 0.03));
  }
  if (rnd() < 0.75) {   // an arc of scallops or dots across the crown
    const n = 7 + ((rnd() * 4) | 0), R2 = k.crH * 0.98, cy = k.cyc + 0.05, sc = rnd() < 0.5;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.17, x = pr(0, 0, 0.15)[0] + Math.cos(a) * R2 * 0.86, y = cy + Math.sin(a) * R2 * 0.86;
      if (sc) { const b = a - 0.085, e = a + 0.085, rr = R2 * 0.86;
        boneLine(lines, [[Math.cos(b) * rr + x - Math.cos(a) * rr, Math.sin(b) * rr + y - Math.sin(a) * rr], [x + Math.cos(a) * 0.06, y + Math.sin(a) * 0.06], [Math.cos(e) * rr + x - Math.cos(a) * rr, Math.sin(e) * rr + y - Math.sin(a) * rr]], lw * 0.9, 0.3);
        boneEll(dots, x - Math.cos(a) * 0.035, y - Math.sin(a) * 0.035, 0.022, 0.022);
      } else boneEll(dots, x, y, 0.03 + (i % 2) * 0.012, 0.03 + (i % 2) * 0.012);
    }
  }
  // cheeks: curls, a little flower, or a leaf spray
  const ck = pick(kit.cheek);
  for (const sg of [-1, 1]) {
    const [cx, cy] = pr(sg * (k.cheek - 0.3), 0.47, 0.5);
    if (ck === "curl") { boneSpiral(lines, cx, cy, 0.17, 1.35, sg > 0 ? 0 : Math.PI, sg, lw * 1.2); for (let i = 0; i < 3; i++) boneEll(dots, cx - sg * (0.0 + i * 0.07), cy + 0.22 + i * 0.045, 0.03 - i * 0.006, 0.03 - i * 0.006); }
    else if (ck === "flower") { bonePetalRing(fills, cx, cy, 0, 0.16, 5 + (rnd() < 0.5 ? 1 : 0), rnd() * TAU, 0.85); boneEll(dots, cx, cy, 0.038, 0.038); for (let i = 0; i < 3; i++) { const a = Math.PI * (0.15 + i * 0.35); boneEll(dots, cx + Math.cos(a) * 0.24 * sg, cy + Math.sin(a) * 0.2, 0.022, 0.022); } }
    else { for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + (i - 1) * 0.75; boneEll(fills, cx + Math.cos(a) * 0.12, cy + 0.05 + Math.sin(a) * 0.12, 0.1, 0.042, a); } boneEll(dots, cx, cy + 0.1, 0.032, 0.032); }
  }
  if (rnd() < 0.6) for (const sg of [-1, 1]) for (let i = 0; i < 3; i++) {   // a run of shrinking dots down each temple
    const a = (sg > 0 ? 0 : Math.PI) + sg * (-0.55 + i * 0.22), rr = 0.045 - i * 0.009, R2 = 0.84;
    boneEll(dots, pr(0, 0, 0.15)[0] + Math.cos(a) * R2, k.cyc + Math.sin(a) * R2 * k.crH, rr, rr);
  }
  // the mouth: teeth on a stitched line, or stitches alone
  const ops = [];
  const mouthK = pick(kit.mouth), by = k.bite - 0.02;
  if (mouthK === "stitch") {
    const cp = []; for (let i = 0; i <= 6; i++) { const x = -0.55 + 1.1 * i / 6; cp.push(pr(x, by - 0.06 * (x / 0.55) ** 2 + 0.02 * Math.sin(i), 1)); }
    boneLine(lines, cp, lw * 1.2, 0.4);
    const n = 9 + ((rnd() * 4) | 0);
    for (let i = 0; i < n; i++) { const x = -0.48 + 0.96 * i / (n - 1), y = by - 0.06 * (x / 0.55) ** 2; boneLine(lines, [pr(x - 0.01, y - 0.075), pr(x + 0.01, y + 0.075)], lw * 1.05, 0.4); }
  } else {
    ops.push([k.mouth, "cut"], [k.teeth, "body"]);
    if (mouthK === "teethstitch") { const cp = []; for (let i = 0; i <= 6; i++) { const x = -0.62 + 1.24 * i / 6; cp.push(pr(x, k.bite - 0.01 - 0.07 * (x / 0.5) ** 2, 1)); } boneLine(lines, cp, lw * 1.0, 0.6); }
  }
  // chin: a little flower, three dots, or a scalloped lace along the jaw
  const chin = rnd(), [chx] = pr(0, k.chinY - 0.15), chy = k.chinY - 0.15;
  if (chin < 0.3) bonePetalRing(fills, chx, chy, 0, 0.1, 4, Math.PI / 4, 0.8);
  else if (chin < 0.55) for (let i = -1; i <= 1; i++) boneEll(dots, chx + i * 0.08, chy + Math.abs(i) * -0.03, 0.026, 0.026);
  else if (chin < 0.9) {
    const n = 5;
    for (let i = 0; i < n; i++) {
      const x0 = -0.3 + 0.6 * i / n, x1 = x0 + 0.6 / n, xm = (x0 + x1) / 2, yb = (x) => chy + 0.02 - 0.09 * (x / 0.32) ** 2;
      boneLine(lines, [pr(x0, yb(x0)), pr(xm, yb(xm) + 0.06), pr(x1, yb(x1))], lw * 0.85, 0.25);
      boneEll(dots, ...pr(xm, yb(xm) + 0.015), 0.018, 0.018);
    }
  }
  // assemble: ornament (outlined in mono, the other ink in duo), then the cavities, then what sits in the eyes
  const ow = Math.max(lw * 1.1, 0.018);
  if (duo) ops.push([fills, "ring", ow], [fills, "alt"], [fills2, "ring", ow], [fills2, "body"], [lines, "alt"], [dots, "alt"]);
  else ops.push([fills, "ring", ow], [fills, "body"], [fills2, "cut"], [lines, "cut"], [dots, "cut"]);
  ops.push([k.holes, "cut"]);
  for (const [cx, cy] of eyeIn) {
    const r = er * 0.98;
    if (eyeK === "rings") { const a = new Path2D(), b = new Path2D(), c = new Path2D(); boneEll(a, cx, cy, r * 0.72, r * 0.72); boneEll(b, cx, cy, r * 0.5, r * 0.5); boneEll(c, cx, cy, r * 0.26, r * 0.26); ops.push([a, "alt"], [b, "cut"], [c, "body"]); }
    else if (eyeK === "flower") { const a = new Path2D(); bonePetalRing(a, cx, cy, 0, r * 0.7, 6, 0.3, 0.85); const c = new Path2D(); boneEll(c, cx, cy, r * 0.17, r * 0.17); ops.push([a, "alt"], [c, "cut"]); }
    else if (eyeK === "heart") { const a = new Path2D(); boneHeart(a, cx, cy, r * 0.55); ops.push([a, "alt"]); }
  }
  // nose: an inverted heart (the aperture), sometimes a dot pair under it
  return { body: k.body, ops, box: [-1.35, -1.55, 1.35, 1.75] };
}
function boneSugar(P) {
  const g = P.g; g.save();
  const rnd = P.rnd, duo = isDuo(P), grid = rnd() < 0.4, rmax = P.s * (grid ? 0.12 : 0.105 + rnd() * 0.04), rmin = grid ? rmax : rmax * (0.6 + rnd() * 0.15);
  const spin = grid ? (rnd() < 0.5 ? 0 : 0.2) : rnd() < 0.25 ? Math.PI : 0.15 + rnd() * 0.5;
  const lw = Math.max(0.018, 0.6 / rmin), nv = 6;
  const all = { eye: ["none", "rings", "flower", "heart"], rim: ["petals", "lace", "spikes", "dots"], brow: ["flower", "heart", "web", "diamond"], flank: ["leaves", "curls", "dots"], cheek: ["curl", "flower", "spray"], mouth: ["stitch", "teeth", "teethstitch"] };
  const kit = {}; for (const key in all) { const a = boneShuffle(rnd, all[key].slice()); kit[key] = a.slice(0, 2 + ((rnd() * (a.length - 1)) | 0)); }
  const shapes = []; for (let v = 0; v < nv; v++) shapes.push(boneSugarShape(rnd, { yaw: (rnd() - 0.5) * 0.3, lw, duo, kit }));
  let spots;
  if (grid) {
    spots = []; const dx = rmax * 2.15, dy = rmax * 2.3, nx = Math.ceil(P.hx / dx) + 1, ny = Math.ceil(P.hy / dy) + 1;
    for (let j = -ny; j <= ny; j++) for (let i = -nx; i <= nx; i++) spots.push({ x: (i + (j & 1) * 0.5) * dx, y: j * dy, r: rmax });
  } else spots = dartPack(P, rmax, rmin, { sp: 0.74 + rnd() * 0.08, effort: 2 });
  const items = spots.map((c, i) => ({ x: c.x, y: c.y + c.r * 0.05, r: c.r * 0.7, reach: 2.2, rot: grid ? (spin ? ((i & 1) * 2 - 1) * spin : 0) : (rnd() - 0.5) * 2 * spin,
    flip: rnd() < 0.5, shape: shapes[(rnd() * nv) | 0], ink: 1 }));
  if (!grid) boneShuffle(rnd, items);
  // in the gaps: marigolds, curls and confetti dots
  const fill1 = new Path2D(), fill2 = new Path2D(), cut = new Path2D();
  for (const d of gapDrops(P, items.map(it => ({ x: it.x, y: it.y, r: it.r * 1.25 })), rmin * 0.22, 1.0, 1.6)) {
    if (!P.vis(d.x, d.y, d.r * 2)) continue;
    const t = rnd();
    if (d.r > rmin * 0.16 && t < 0.45) { const pp = new Path2D(); petals(pp, 7 + ((rnd() * 5) | 0), 0, d.r * 1.25, d.r * 0.42, rnd() * TAU, 1.15, 0.9); boneAt(fill2, pp, d.x, d.y); boneEll(cut, d.x, d.y, d.r * 0.32, d.r * 0.32); }
    else if (t < 0.7) boneSpiral(fill1, d.x, d.y, d.r * 1.1, 1.1, rnd() * TAU, rnd() < 0.5 ? 1 : -1, Math.max(0.7, d.r * 0.16));
    else boneEll(rnd() < 0.5 ? fill1 : fill2, d.x, d.y, d.r * 0.35, d.r * 0.35);
  }
  g.fillStyle = rgba(P.fg); g.fill(fill1); g.fillStyle = rgba(P.fg2); g.fill(fill2);
  g.globalCompositeOperation = "destination-out"; g.fill(cut); g.globalCompositeOperation = "source-over";
  boneStamp(P, items, Math.max(1, P.s * 0.006), null);
  g.restore();
}

/* ---------- BONE YARD: long bones with real ends, vertebrae, ribs, hands, crossed and piled ---------- */
/* A long bone along x in [-1, 1]: field primitives for each kind. Returns F(x, y) > 0 inside. */
const boneD = (cx, cy, r) => (x, y) => boneDisc(x, y, cx, cy, r);
function boneLongF(kind, rnd) {
  const w = 0.075 + rnd() * 0.02, wm = w * (0.8 + rnd() * 0.08), J = (a) => a * (0.92 + rnd() * 0.16), k = 0.045;
  const shaft = (x, y) => Math.max(boneCap(x, y, -0.72, 0, 0, 0.012, w, wm), boneCap(x, y, 0, 0.012, 0.72, 0, wm, w));
  let parts;
  if (kind === "femur") parts = [
    (x, y) => boneCap(x, y, -0.7, 0, -0.88, -0.15, 0.07, 0.065), boneD(-0.92, -0.18, J(0.12)),
    boneD(-0.84, 0.08, J(0.085)), (x, y) => boneDisc(x, y, -0.63, 0.085, 0.045),
    (x, y) => boneCap(x, y, 0.55, 0, 0.84, -0.08, w, 0.11), (x, y) => boneCap(x, y, 0.55, 0, 0.84, 0.09, w, 0.11),
    boneD(0.88, -0.1, J(0.115)), boneD(0.88, 0.11, J(0.11))];
  else if (kind === "humerus") parts = [
    boneD(-0.87, -0.03, J(0.15)), boneD(-0.8, 0.1, J(0.08)),
    (x, y) => boneCap(x, y, 0.6, 0, 0.86, -0.13, w, 0.06), (x, y) => boneCap(x, y, 0.6, 0, 0.86, 0.13, w, 0.06),
    boneD(0.9, -0.06, J(0.085)), boneD(0.92, 0.07, J(0.08)),
    (x, y) => boneDisc(x, y, 0.86, -0.17, 0.05), (x, y) => boneDisc(x, y, 0.85, 0.18, 0.045)];
  else if (kind === "tibia") parts = [
    (x, y) => boneCap(x, y, -0.62, 0, -0.88, -0.1, w, 0.11), (x, y) => boneCap(x, y, -0.62, 0, -0.88, 0.1, w, 0.11),
    boneD(-0.9, -0.11, J(0.11)), boneD(-0.9, 0.11, J(0.11)), (x, y) => boneDisc(x, y, -0.76, 0.02, 0.07),
    (x, y) => boneCap(x, y, 0.7, 0, 0.9, -0.03, w, 0.085), boneD(0.95, 0.07, J(0.06))];
  else parts = [   // the crossbones bone: two round knobs at each end
    boneD(-0.88, -0.09, J(0.12)), boneD(-0.88, 0.1, J(0.12)),
    boneD(0.88, -0.1, J(0.12)), boneD(0.88, 0.09, J(0.12))];
  const notch = kind === "femur" ? (x, y) => boneDisc(x, y, 1.0, 0.005, 0.05) : kind === "plain" ? (x, y) => Math.max(boneDisc(x, y, 1.0, 0, 0.045), boneDisc(x, y, -1.0, 0, 0.045)) : null;
  return (x, y) => { let v = shaft(x, y); for (const f of parts) v = smax(v, f(x, y), k); return notch ? Math.min(v, -notch(x, y)) : v; };
}
function boneLongShape(rnd, kind, o) {
  const F = boneLongF(kind, rnd), body = boneField(new Path2D(), F, -1.12, -0.36, 1.12, 0.36, o.cs(1)), lines = new Path2D(), lw = o.lw, sd = rnd() < 0.5 ? 1 : -1;
  // shading down the shaft, the growth lines at each end, hatching near the knobs
  boneLine(lines, [[-0.55, sd * 0.035], [-0.1, sd * 0.042], [0.35, sd * 0.03], [0.6, sd * 0.04]], lw);
  boneLine(lines, [[-0.3, -sd * 0.045], [0.05, -sd * 0.05]], lw * 0.8);
  for (const e of [-1, 1]) {
    const x0 = e * (0.74 + rnd() * 0.06);
    boneLine(lines, [[x0, -0.07], [x0 + e * 0.025, 0], [x0, 0.07]], lw * 0.8, 0.7);
    for (let i = 0; i < 3; i++) boneLine(lines, [[e * (0.5 + i * 0.06), sd * 0.03], [e * (0.54 + i * 0.065), sd * (0.055 + i * 0.006)]], lw * 0.7, 0.8);
  }
  boneEll(lines, 0.15 * sd, -sd * 0.02, 0.012, 0.009);
  return { body, rule: "evenodd", box: [-1.2, -0.4, 1.2, 0.4], ops: [[lines, o.engrave ? "alt" : "cut"]], circ: [-0.85, -0.6, -0.3, 0, 0.3, 0.6, 0.85].map(x => [x, 0, Math.abs(x) > 0.7 ? 0.17 : 0.12]) };
}
function boneVertebraShape(rnd, o) {
  const J = (a) => a * (0.9 + rnd() * 0.2), tw = J(0.85), sp = J(1.0), bw = J(0.5);
  const F = (x, y) => {
    let v = boneOval(x, y, 0, 0.35, bw, 0.36);
    v = smax(v, boneOval(x, y, 0, -0.22, 0.42, 0.38), 0.06);
    v = smax(v, boneCap(x, y, 0, -0.45, 0, -sp, 0.11, 0.06), 0.08);
    for (const sg of [-1, 1]) {
      v = smax(v, boneCap(x, y, sg * 0.25, -0.22, sg * tw, -0.42, 0.1, 0.075), 0.07);
      v = smax(v, boneDisc(x, y, sg * tw, -0.42, 0.09), 0.04);
      v = smax(v, boneDisc(x, y, sg * 0.3, -0.38, 0.12), 0.05);
    }
    return Math.min(v, -boneOval(x, y, 0, -0.2, 0.25, 0.2));
  };
  const body = boneField(new Path2D(), F, -1.05, -1.12, 1.05, 0.78, o.cs(0.32)), lines = new Path2D();
  { const cp = []; for (let i = 0; i <= 8; i++) { const a = (-15 + i * 210 / 8) * BONE_D; cp.push([Math.cos(a) * (bw - 0.07), 0.35 + Math.sin(a) * 0.29]); } boneLine(lines, cp, o.lw * 0.9, 0.9); }
  for (const sg of [-1, 1]) boneLine(lines, [[sg * 0.2, 0.06], [sg * 0.3, 0.14]], o.lw * 0.8);
  for (const sg of [-1, 1]) boneLine(lines, [[sg * 0.4, -0.28], [sg * 0.62, -0.4]], o.lw * 0.8);
  boneLine(lines, [[0, -0.55], [0, -0.85]], o.lw * 0.8);
  return { body, rule: "evenodd", box: [-1.1, -1.15, 1.1, 0.8], ops: [[lines, o.engrave ? "alt" : "cut"]], circ: [[0, 0.3, 0.5], [0, -0.3, 0.45], [0, -0.8, 0.2], [-0.7, -0.4, 0.2], [0.7, -0.4, 0.2]] };
}
function boneRibShape(rnd, o) {
  const bend = 0.25 + rnd() * 0.2, cp = [[-1, 0.12], [-0.8, -0.02], [-0.45, -bend * 0.6], [0, -bend], [0.5, -bend * 0.75], [0.95, -0.05]];
  const f = boneCurve(cp), segs = []; for (let i = 0; i <= 16; i++) segs.push(f(i / 16));
  const F = (x, y) => {
    let v = boneDisc(x, y, -0.98, 0.12, 0.085);
    for (let i = 0; i < 16; i++) { const [ax, ay] = segs[i], [bx, by] = segs[i + 1], t = i / 16; v = Math.max(v, boneCap(x, y, ax, ay, bx, by, 0.05 + 0.03 * Math.sin(Math.PI * t * 0.9), 0.05 + 0.03 * Math.sin(Math.PI * (t + 1 / 16) * 0.9))); }
    return smax(v, boneDisc(x, y, -0.72, 0.0, 0.06), 0.03);
  };
  const body = boneField(new Path2D(), F, -1.12, -bend - 0.15, 1.05, 0.25, o.cs(0.55)), lines = new Path2D();
  const g = []; for (let i = 3; i <= 13; i++) { const [x, y] = segs[i]; g.push([x, y + 0.025]); }
  boneLine(lines, g, o.lw * 0.9);
  return { body, rule: "evenodd", box: [-1.15, -0.7, 1.1, 0.35], ops: [[lines, o.engrave ? "alt" : "cut"]], circ: segs.filter((_, i) => i % 3 === 0).map(([x, y]) => [x, y, 0.1]) };
}
/* a skeletal hand, wrist down, fingers up; ~2 units long */
function boneHandF(rnd, spread) {
  const bones = [], add = (ax, ay, bx, by, w) => bones.push([ax, ay, bx, by, w]);
  // carpals: a tight cluster of pebbles in two rows
  const carp = [];
  for (let i = 0; i < 4; i++) carp.push([-0.27 + i * 0.18 + (rnd() - 0.5) * 0.02, 0.76 + (rnd() - 0.5) * 0.04, 0.095 + rnd() * 0.02, 0.08 + rnd() * 0.015]);
  for (let i = 0; i < 4; i++) carp.push([-0.26 + i * 0.172 + (rnd() - 0.5) * 0.02, 0.57 + (rnd() - 0.5) * 0.03, 0.085 + rnd() * 0.012, 0.08]);
  const gapJ = 0.07, fing = [[-0.25, 0.95, 0.36, 0.23, 0.17, 0.074], [-0.083, 1.05, 0.4, 0.26, 0.18, 0.074], [0.083, 1.0, 0.38, 0.25, 0.17, 0.068], [0.25, 0.86, 0.3, 0.19, 0.15, 0.06]];
  fing.forEach(([x0, ml, p1, p2, p3, w0], i) => {
    let a = -Math.PI / 2 + (i - 1.5) * spread * 0.15 + (rnd() - 0.5) * 0.06, x = x0, y = 0.46;
    const L = [ml * 0.5, p1, p2, p3], W = [w0, w0 * 0.92, w0 * 0.8, w0 * 0.7], curl = (rnd() - 0.3) * 0.18;
    for (let k = 0; k < 4; k++) {
      const ex = x + Math.cos(a) * L[k], ey = y + Math.sin(a) * L[k]; add(x, y, ex, ey, W[k]);
      x = ex + Math.cos(a) * gapJ; y = ey + Math.sin(a) * gapJ; a += curl * (k > 0 ? 1 : 0.3) * (i < 2 ? -1 : 1);
    }
  });
  { // thumb
    let a = -Math.PI / 2 - 0.5 - spread * 0.22, x = -0.36, y = 0.6;
    for (const [L, W] of [[0.34, 0.075], [0.27, 0.068], [0.2, 0.056]]) { const ex = x + Math.cos(a) * L, ey = y + Math.sin(a) * L; add(x, y, ex, ey, W); x = ex + Math.cos(a) * gapJ; y = ey + Math.sin(a) * gapJ; a += 0.18; }
  }
  // per bone: its box, axis and the discs at its ends, worked out once
  const pre = bones.map(([ax, ay, bx, by, w]) => {
    const dx = bx - ax, dy = by - ay, L = Math.sqrt(dx * dx + dy * dy), nx = -dy / L, ny = dx / L;
    return [Math.min(ax, bx) - 0.15, Math.max(ax, bx) + 0.15, Math.min(ay, by) - 0.15, Math.max(ay, by) + 0.15, ax + dx * 0.08, ay + dy * 0.08, bx, by, w,
      ax + dx * 0.11, ay + dy * 0.11, bx - dx * 0.04 + nx * w * 0.4, by - dy * 0.04 + ny * w * 0.4, bx - dx * 0.04 - nx * w * 0.4, by - dy * 0.04 - ny * w * 0.4];
  });
  const F = (x, y) => {
    let v = -9;
    for (let i = 0; i < carp.length; i++) { const c = carp[i], e = boneOval(x, y, c[0], c[1], c[2], c[3]); if (e > v) v = e; }
    for (let i = 0; i < pre.length; i++) {
      const q = pre[i]; if (x < q[0] || x > q[1] || y < q[2] || y > q[3]) continue;
      const w = q[8];
      let b = boneCap(x, y, q[4], q[5], q[6], q[7], w * 0.8, w * 0.55);
      b = smax(b, boneDisc(x, y, q[9], q[10], w * 0.95), 0.03);
      const h1 = boneDisc(x, y, q[11], q[12], w * 0.62), h2 = boneDisc(x, y, q[13], q[14], w * 0.62);
      b = smax(b, h1 > h2 ? h1 : h2, 0.02);
      if (b > v) v = b;
    }
    return v;
  };
  return { F, bones, carp };
}
function boneHandShape(rnd, o) {
  const h = boneHandF(rnd, 0.5 + rnd() * 0.9), body = boneField(new Path2D(), h.F, -1.15, -1.35, 0.85, 0.95, o.cs(0.5) * 0.8), lines = new Path2D();
  for (const [ax, ay, bx, by, w] of h.bones) { const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy); if (L > 0.25) boneLine(lines, [[ax + dx * 0.3 - dy / L * w * 0.35, ay + dy * 0.3 + dx / L * w * 0.35], [ax + dx * 0.7 - dy / L * w * 0.3, ay + dy * 0.7 + dx / L * w * 0.3]], o.lw * 0.7); }
  return { body, rule: "evenodd", box: [-1.2, -1.4, 0.9, 1.0], ops: [[lines, o.engrave ? "alt" : "cut"]], circ: [[0, 0.6, 0.35], [-0.05, 0.05, 0.4], [-0.05, -0.6, 0.45], [-0.6, -0.1, 0.25]] };
}
/* Dart-throw items given as collision circles (unit space): each candidate { shape, r (px per unit), rot } is kept
   when its circles stay sp × (sum of radii) clear of everything placed. */
function bonePack(P, list, grid, cell) {
  const key = (i, j) => (i + 4096) * 8192 + j + 4096, out = [];
  for (const L of list) {
    const tries = L.tries, rnd = P.rnd;
    for (let t = 0; t < tries; t++) {
      const S = L.pick(), r = L.r * (0.85 + rnd() * 0.3), rot = L.rot(), x = (rnd() * 2 - 1) * (P.hx + r * 0.5), y = (rnd() * 2 - 1) * (P.hy + r * 0.5);
      const c = Math.cos(rot), s = Math.sin(rot), flip = rnd() < 0.5, cs = [];
      for (const [u0, v, cr] of S.circ) { const u = flip ? -u0 : u0; cs.push([x + (u * c - v * s) * r, y + (u * s + v * c) * r, cr * r]); }
      let ok = true;
      for (const [px, py, pr] of cs) {
        const gi = Math.floor(px / cell), gj = Math.floor(py / cell);
        for (let j = gj - 1; j <= gj + 1 && ok; j++) for (let i = gi - 1; i <= gi + 1 && ok; i++) {
          const G = grid.get(key(i, j)); if (!G) continue;
          for (const q of G) { const d = (pr + q[2]) * L.sp; if ((q[0] - px) ** 2 + (q[1] - py) ** 2 < d * d) { ok = false; break; } }
        }
        if (!ok) break;
      }
      if (!ok) continue;
      for (const q of cs) { const k2 = key(Math.floor(q[0] / cell), Math.floor(q[1] / cell)); (grid.get(k2) || grid.set(k2, []).get(k2)).push(q); }
      out.push({ x, y, r, rot, flip, shape: S, reach: 1.3, level: L.level });
      if (L.cross && rnd() < L.cross) { const a = (0.55 + rnd() * 0.35) * (rnd() < 0.5 ? 1 : -1); out.push({ x, y, r: r * (0.92 + rnd() * 0.12), rot: rot + a, flip: !flip, shape: L.pick(), reach: 1.3, level: L.level }); }
    }
  }
  return out;
}
function boneYard(P) {
  const g = P.g; g.save();
  const rnd = P.rnd, duo = isDuo(P), L0 = P.s * (0.16 + rnd() * 0.05), style = duo ? ["mix", "shadow", "engrave"][(rnd() * 3) | 0] : "solid";
  const lw = Math.max(0.014, 0.5 / (L0 * 0.6)), o = { lw, cs: (f) => clamp(4.5 / (L0 * f), 0.008, 0.035), engrave: style === "engrave" };
  const kinds = boneShuffle(rnd, ["femur", "humerus", "tibia", "plain"]), plainy = rnd() < 0.5;
  const longs = []; for (let i = 0; i < 6; i++) longs.push(boneLongShape(rnd, i < 2 && plainy ? "plain" : kinds[i % 4], o));
  const verts = [boneVertebraShape(rnd, o), boneVertebraShape(rnd, o)], ribs = [boneRibShape(rnd, o), boneRibShape(rnd, o)], hands = [boneHandShape(rnd, o)];
  const pick = (a) => () => a[(rnd() * a.length) | 0], spin = rnd() < 0.7 ? () => rnd() * TAU : (() => { const a0 = rnd() * TAU; return () => a0 + (rnd() < 0.5 ? 0 : Math.PI / 2) + (rnd() - 0.5) * 0.5; })();
  const area = 4 * P.hx * P.hy, n = (r) => Math.ceil(area / (r * r) * 1.2);
  const grid = new Map(), cell = L0 * 0.5;
  const items = bonePack(P, [
    { pick: pick(longs), r: L0, rot: spin, sp: 0.8, tries: n(L0) * 2, cross: 0.45, level: 0 },
    { pick: pick(hands), r: L0 * 0.5, rot: spin, sp: 0.8, tries: n(L0) * 0.4, level: 1 },
    { pick: pick(verts), r: L0 * 0.32, rot: spin, sp: 0.8, tries: n(L0 * 0.5), level: 1 },
    { pick: pick(ribs), r: L0 * 0.55, rot: spin, sp: 0.75, tries: n(L0 * 0.5), level: 1 },
    { pick: pick(longs), r: L0 * 0.5, rot: spin, sp: 0.85, tries: n(L0 * 0.5), level: 2 },
    { pick: pick(verts), r: L0 * 0.24, rot: spin, sp: 0.85, tries: n(L0 * 0.4), level: 2 },
  ], grid, cell);
  const lv0 = items.filter(it => it.level === 0), rest = items.filter(it => it.level === 1), small = items.filter(it => it.level === 2);
  const mixed = boneShuffle(rnd, lv0.concat(rest));
  for (const it of mixed.concat(small)) { it.ink = style === "mix" && rnd() < 0.5 ? 2 : 1; it.shadow = style === "shadow"; }
  boneStamp(P, mixed.concat(small), Math.max(1, P.s * 0.005), style === "shadow" ? [P.s * 0.008, P.s * 0.01] : null);
  g.restore();
}

/* ---------- X-RAY: plates of hands, chests, skulls and knees in ink density ----------
   Soft tissue is a faint veil (the second ink in duo); bone is denser, and denser again towards its edges, the way
   cortical bone shows on a film: each bone is filled thin, then stroked inside its own outline in a few widening,
   fading bands. Overlapping parts add up. On a light ground the "glow" is simply dark. */
/* a bone group: { path, rule, holes? } drawn with density d (0..1) */
function boneDensity(g, col, b, d, k, lite) {
  g.save(); g.clip(b.path, b.rule || "nonzero");
  if (b.holes) g.clip(b.holes, "evenodd");
  g.fillStyle = col(d * 0.42); g.fill(b.path, b.rule || "nonzero");
  for (const [w, a] of lite ? [[0.12, 0.2], [0.03, 0.5]] : [[0.18, 0.12], [0.08, 0.2], [0.035, 0.35], [0.012, 0.7]]) {
    g.lineWidth = w * k; g.strokeStyle = col(a * d); g.stroke(b.path); if (b.holes && b.edgeHoles) g.stroke(b.edgeHoles);
  }
  g.restore();
}
function boneRibPts(x0, y0, sg, len, drop, w) {
  const cp = [[x0, y0], [x0 + 0.28 * len, y0 - 0.1 * len], [x0 + 0.62 * len, y0 + 0.02 * len], [x0 + 0.82 * len, y0 + drop * 0.55], [x0 + 0.78 * len, y0 + drop]].map(([x, y]) => [sg * x, y]);
  return strokePts(boneCurve(cp), (t) => w * (1.25 - 0.45 * t), 30);
}
function boneXrayChest(rnd, o) {
  const spine = new Path2D(), ribsP = new Path2D(), clav = new Path2D(), lw = 0.012;
  const torso = (x, y) => smax(smax(boneOval(x, y, 0, 0.12, 0.92, 1.05), boneCap(x, y, -0.88, -0.72, 0.88, -0.72, 0.26), 0.25), boneCap(x, y, 0, -0.9, 0, -1.4, 0.22), 0.2);
  const lungs = (x, y) => Math.min(Math.max(boneOval(x, y, -0.43, 0.02, 0.32, 0.72), boneOval(x, y, 0.43, 0.02, 0.31, 0.7) - Math.max(0, y + 0.5) * 0), -boneOval(x, y, 0.12, 0.42, 0.3, 0.3));
  const tissueL = boneLevels((x, y) => Math.min(torso(x, y), -lungs(x, y)), -1.3, -1.75, 1.3, 1.3, o.cs(1.25) * 1.6, 3, 0.05);
  // the spine: stacked bodies with the pedicles as rings
  const n = 13, top = -1.2, step = 2.15 / n;
  for (let i = 0; i < n; i++) { const y = top + i * step, w = 0.075 + i * 0.004; const q = []; for (const [u, v] of [[-w, 0], [w, 0], [w, step * 0.78], [-w, step * 0.78]]) q.push(u, y + v); smoothPoly(spine, boneWind(boneLoop([[-w, y], [w, y], [w * 1.05, y + step * 0.39], [w, y + step * 0.78], [-w, y + step * 0.78], [-w * 1.05, y + step * 0.39]], 3))); }
  // ribs: ten pairs, each from the spine out and round
  const nr = 10;
  for (let i = 0; i < nr; i++) for (const sg of [-1, 1]) {
    const y = -0.95 + i * 0.16, len = 0.55 + Math.sin((i + 1) / (nr + 1) * Math.PI) * 0.45, drop = 0.3 + i * 0.03;
    boneAdd(ribsP, boneRibPts(0.08, y, sg, len, drop, 0.03));
  }
  for (const sg of [-1, 1]) boneAdd(clav, strokePts(boneCurve([[sg * 0.1, -1.0], [sg * 0.35, -1.05], [sg * 0.6, -1.0], [sg * 0.82, -1.08]]), (t) => 0.035 + 0.01 * Math.sin(t * TAU), 20));
  return { tissue: tissueL, groups: [{ path: ribsP }, { path: spine }, { path: clav }], circ: 1.25 };
}
function boneXrayHand(rnd, o) {
  const h = boneHandF(rnd, 0.6 + rnd() * 0.8), bones = new Path2D(), cs = o.cs(1.4);
  const arm = (x, y) => Math.max(smax(boneCap(x, y, -0.16, 1.62, -0.15, 1.0, 0.075, 0.09), boneOval(x, y, -0.13, 0.95, 0.17, 0.09), 0.05), smax(boneCap(x, y, 0.18, 1.62, 0.2, 1.02, 0.055, 0.06), boneDisc(x, y, 0.2, 0.98, 0.075), 0.04));
  boneField(bones, (x, y) => Math.max(h.F(x, y), arm(x, y)), -1.15, -1.35, 0.85, 1.6, cs);
  const tb = h.bones.map(([ax, ay, bx, by, w]) => { const m = w + 0.075 + 0.13; return [Math.min(ax, bx) - m, Math.max(ax, bx) + m, Math.min(ay, by) - m, Math.max(ay, by) + m, ax, ay, bx, by, w]; });
  const T = (x, y) => {
    let v = smax(boneOval(x, y, 0, 0.45, 0.48, 0.5), boneCap(x, y, 0, 0.9, 0, 1.55, 0.42, 0.44), 0.1);
    for (let i = 0; i < tb.length; i++) {
      const q = tb[i]; if (x < q[0] || x > q[1] || y < q[2] || y > q[3]) continue;   // too far to reach v
      v = smax(v, boneCap(x, y, q[4], q[5], q[6], q[7], q[8] + 0.075, q[8] + 0.06), 0.12);
    }
    return v;
  };
  return { tissue: boneLevels(T, -1.3, -1.5, 1.0, 2.1, cs * 2, 3, 0.035), groups: [{ path: bones, rule: "evenodd" }], circ: 1.4 };
}
function boneXraySkull(rnd, o) {
  const k = boneSkullParts(rnd, { yaw: (rnd() - 0.5) * 0.4, lw: 0.012, open: rnd() < 0.3 ? 0.08 : 0 });
  const inv = new Path2D(); inv.rect(-5, -5, 10, 10); inv.addPath(k.holes);
  const tissue = boneLevels((x, y) => smax(boneOval(x, y, 0, -0.3, 1.12, 1.2), smax(boneOval(x, y, 0, 0.75, 0.82, 0.85), boneCap(x, y, 0, 1.2, 0, 1.75, 0.5), 0.2), 0.2), -1.4, -1.7, 1.4, 2.4, o.cs(1.5) * 2, 3, 0.05);
  return { tissue, groups: [{ path: k.body, holes: inv, edgeHoles: k.holes, d: 0.8 }, { path: k.teeth, d: 1.3 }], lines: k.lines, circ: 1.5 };
}
function boneXrayKnee(rnd, o) {
  const cs = o.cs(1.6);
  const fem = new Path2D(), tib = new Path2D(), pat = new Path2D(), J = (v) => v * (0.92 + rnd() * 0.16), cw = J(0.2), tw = J(0.33), gap = J(0.07);
  boneField(fem, (x, y) => {
    let v = boneCap(x, y, 0, -1.8, 0, -0.5, 0.13, 0.16);
    for (const sg of [-1, 1]) { v = smax(v, boneCap(x, y, 0, -0.7, sg * cw, -0.2, 0.15, 0.17), 0.08); v = smax(v, boneDisc(x, y, sg * cw, -0.14, J(0.19)), 0.05); }
    return Math.min(v, -boneDisc(x, y, 0, 0.0, 0.08));
  }, -0.5, -2.0, 0.5, 0.1, cs);
  boneField(tib, (x, y) => {
    let v = boneCap(x, y, 0, 0.5, 0.02, 1.8, 0.16, 0.12);
    v = smax(v, boneCap(x, y, -tw, 0.1 + gap, tw, 0.1 + gap, 0.075), 0.03);
    for (const sg of [-1, 1]) v = smax(v, boneCap(x, y, 0, 0.62, sg * (tw - 0.06), 0.17 + gap, 0.13, 0.11), 0.08);
    v = smax(v, boneOval(x, y, 0, 0.3 + gap, tw * 0.8, 0.18), 0.05);
    v = smax(v, Math.max(boneDisc(x, y, -0.05, 0.05 + gap, 0.04), boneDisc(x, y, 0.05, 0.05 + gap, 0.04)), 0.03);
    return Math.max(v, smax(boneDisc(x, y, tw + 0.06, 0.36 + gap, 0.085), boneCap(x, y, tw + 0.06, 0.4 + gap, tw, 1.8, 0.05, 0.04), 0.04));
  }, -0.5, -0.05, 0.6, 2.0, cs);
  boneField(pat, (x, y) => boneOval(x, y, -0.04, -0.42, 0.17, 0.22), -0.3, -0.7, 0.2, -0.15, cs);
  const tissue = (x, y) => smax(boneCap(x, y, 0, -1.75, 0, 1.75, 0.66, 0.5), boneOval(x, y, -0.05, -0.3, 0.6, 0.5), 0.2);
  return { tissue: boneLevels(tissue, -0.75, -2.5, 0.75, 2.5, cs * 2.5), groups: [{ path: fem, rule: "evenodd" }, { path: tib, rule: "evenodd" }, { path: pat }], circ: 1.6 };
}
/* nested contours of a tissue field (F > 0, > a, > 2a ...): filled one over another they step the density up
   towards the middle, so the soft tissue is thin at its edges and fuller inside, every edge still crisp */
function boneLevels(F, x0, y0, x1, y1, cs, n = 3, a = 0.06) {
  const L = []; for (let i = 0; i < n; i++) L.push(i * a);
  return boneField(null, F, x0, y0, x1, y1, cs, L);
}
function boneXray(P) {
  const g = P.g; g.save();
  const rnd = P.rnd, duo = isDuo(P), rmax = P.s * (0.16 + rnd() * 0.06), rmin = rmax * (0.6 + rnd() * 0.15);
  const spin = rnd() < 0.5 ? 0.25 : rnd() < 0.5 ? Math.PI : 0.8, px = rmax * 0.85, o = { cs: (f) => clamp(4.5 / (px / f), 0.008, 0.04) };
  const all = ["hand", "chest", "skull", "knee"], kinds = rnd() < 0.3 ? [all[(rnd() * 4) | 0], "hand"] : all;
  const make = { hand: () => boneXrayHand(rnd, o), chest: () => boneXrayChest(rnd, o), skull: () => boneXraySkull(rnd, o), knee: () => boneXrayKnee(rnd, o) };
  const vars = []; for (const k of kinds) { vars.push(make[k]()); if (k === "hand") vars.push(make[k]()); }
  const spots = dartPack(P, rmax, rmin, { sp: 0.72 + rnd() * 0.1, effort: 2 });
  const inkB = (a) => rgba(P.fg, a), inkT = (a) => rgba(duo ? P.fg2 : P.fg, a), tissueA = duo ? 0.42 : 0.2, dens = 1;
  for (const c of spots) {
    const v = vars[(rnd() * vars.length) | 0], rot = (rnd() - 0.5) * 2 * spin, flip = rnd() < 0.5, r = c.r / v.circ * 1.25;
    if (!P.vis(c.x, c.y, c.r * 2.2)) continue;
    g.save(); g.translate(c.x, c.y); g.rotate(rot); g.scale(flip ? -r : r, r);
    g.fillStyle = inkT(tissueA / v.tissue.length); for (const t of v.tissue) g.fill(t, "evenodd");
    for (const b of v.groups) boneDensity(g, inkB, b, dens * (b.d || 1), 1, r < 70);
    if (v.lines) { g.fillStyle = inkB(0.4); g.fill(v.lines); }
    g.restore();
  }
  g.restore();
}

/* ======================================================================
   registry
   ====================================================================== */
const DEFS = [
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
  ["tartan", "Tartan", "plaid", 0.6, tartan],
  ["buffalo", "Buffalo check", "plaid", 0.8, plaid("buffalo")],
  ["blackwatch", "Black Watch", "plaid", 0.7, plaid("blackwatch")],
  ["stewart", "Royal Stewart", "plaid", 0.8, plaid("stewart")],
  ["dressgordon", "Dress Gordon", "plaid", 0.7, plaid("dressgordon")],
  ["madras", "Madras", "plaid", 0.8, plaid("madras")],
  ["glencheck", "Glen check", "plaid", 0.7, plaid("glen")],
  ["windowpane", "Windowpane", "plaid", 0.3, plaid("windowpane")],
  ["tattersall", "Tattersall", "plaid", 0.35, plaid("tattersall")],
  ["flannel", "Flannel", "plaid", 0.75, plaid("flannel")],
  ["heritage", "Heritage check", "plaid", 0.55, plaid("heritage")],
  ["shepherd", "Shepherd's check", "plaid", 0.75, plaid("shepherd")],
  ["woodland", "Woodland camo", "camo", 0.75, camoWoodland],
  ["desertcamo", "Desert camo", "camo", 0.55, camoDesert],
  ["digicamo", "Digital camo", "camo", 0.75, camoDigital],
  ["tigercamo", "Tiger stripe camo", "camo", 0.7, camoTiger],
  ["splinter", "Splinter camo", "camo", 0.75, camoSplinter],
  ["urbancamo", "Urban camo", "camo", 0.7, camoUrban],
  ["multicam", "Multi-terrain camo", "camo", 0.6, camoMulti],
  ["zebra", "Zebra", "animal", 0.85, zebra],
  ["giraffe", "Giraffe", "animal", 0.7, giraffe],
  ["leopard", "Leopard", "animal", 0.65, leopard],
  ["cheetah", "Cheetah", "animal", 0.55, cheetah],
  ["tabby", "Tabby", "animal", 0.6, tabby],
  ["tiger", "Tiger", "animal", 0.7, tiger],
  ["snakeskin", "Snakeskin", "animal", 0.65, snakeskin],
  ["cowhide", "Cowhide", "animal", 0.55, cowhide],
  ["dalmatian", "Dalmatian", "animal", 0.4, dalmatian],
  ["flow", "Flow", "psych", 0.65, flow],
  ["opmelt", "Op melt", "psych", 0.85, opmelt],
  ["bloom", "Bloom", "psych", 0.7, bloom],
  ["melt", "Melting smileys", "characters", 0.75, melt],
  ["ghosts", "Ghosts", "characters", 0.7, ghosts],
  ["eyes", "Eyes", "characters", 0.75, eyes],
  ["daisy", "Flower power", "floral", 0.7, daisy],
  ["grille", "Grille", "hardware", 0.55, grille],
  ["mesh", "Wire mesh", "hardware", 0.45, mesh],
  ["carbon", "Carbon fibre", "hardware", 0.7, carbon],
  ["tread", "Tread plate", "hardware", 0.45, tread],
  ["amoeba", "Amoebae", "microbes", 0.7, bioAmoeba],
  ["virus", "Viruses", "microbes", 0.7, bioVirus],
  ["cells", "Cells", "microbes", 0.75, bioCells],
  ["molecules", "Molecules", "microbes", 0.6, bioMolecules],
  ["skulls", "Skulls", "bones", 0.75, boneSkulls],
  ["sugarskull", "Sugar skulls", "bones", 0.8, boneSugar],
  ["bones", "Bone yard", "bones", 0.75, boneYard],
  ["xray", "X-ray", "bones", 0.6, boneXray],
];
const BY_ID = {}; const LIST = [];
for (const [id, name, family, busy, fn] of DEFS) { BY_ID[id] = fn; LIST.push({ id, name, family, busy }); }

const normCol = (c, d) => Array.isArray(c) && c.length >= 3 ? [c[0] | 0, c[1] | 0, c[2] | 0] : d;

/* The drawing state a pattern function gets. With `fills` set, nothing is drawn: fillTile only notes what it
   would fill, and any other drawing touches the missing context and throws (see plan). */
function makeP(g, W, H, id, S, scale, angle, fg, fg2, bg, seed, fills, later) {
  const cx = Math.round(W / 2), cy = Math.round(H / 2), ang = angle * Math.PI / 180;
  const R = Math.ceil(Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy))) + 2;
  const ca = Math.cos(-ang), sa = Math.sin(-ang), cb = Math.cos(ang), sb = Math.sin(ang);
  return {
    hx: (W * Math.abs(cb) + H * Math.abs(sb)) / 2 + 2, hy: (W * Math.abs(sb) + H * Math.abs(cb)) / 2 + 2,
    g, W, H, S, scale, k: scale / 100, s: S * scale / 100, R, ang, cx, cy, fg, fg2, bg, seed, id, fills, later,
    rnd: (() => { const r = mulberry32(hashStr(id + "#" + seed)); r(); r(); return r; })(),
    tkey: [id, S, scale, fg, fg2, bg, seed].join("|"),
    vis: (x, y, m) => { const X = x * cb - y * sb + cx, Y = x * sb + y * cb + cy; return X > -m && X < W + m && Y > -m && Y < H + m; },
    toFrame: (x, y) => { const dx = x - cx, dy = y - cy; return [dx * ca - dy * sa, dx * sa + dy * ca]; },
  };
}
function renderLayer(W, H, id, S, scale, angle, fg, fg2, bg, seed) {
  const layer = makeCanvas(W, H), g = layer.getContext("2d"), P = makeP(g, W, H, id, S, scale, angle, fg, fg2, bg, seed, null);
  g.translate(P.cx, P.cy); if (P.ang) g.rotate(P.ang);
  g.save(); BY_ID[id](P); g.restore();
  return layer;
}
/* A pattern that is a single tile fill, unrotated, needs no full-size layer: the tile is filled straight onto the
   target at `alpha`. A layer holds exactly the tile's pixels in that case, so the result is the same, minus a
   sleeve-sized canvas and two passes over it. Returns the fill [tile, ox, oy], or null when the pattern needs a layer. */
const needsLayer = new Set();   // pattern ids that draw more than one tile fill
function plan(W, H, id, S, scale, fg, fg2, bg, seed, later, angle = 0) {
  if (needsLayer.has(id) && !later) return null;
  const fills = [];
  try { BY_ID[id](makeP(null, W, H, id, S, scale, angle, fg, fg2, bg, seed, fills, later)); }
  catch (e) { needsLayer.add(id); return null; }
  if (fills.length !== 1) { needsLayer.add(id); return null; }
  return fills[0];
}
/* Only where the target maps user space onto whole device pixels, so tile pixels land exactly as a layer's would. */
const pixelAligned = (ctx) => { const t = ctx.getTransform(); return t.a === 1 && t.b === 0 && t.c === 0 && t.d === 1 && Number.isInteger(t.e) && Number.isInteger(t.f); };
const MAX_COPIES = 400;
/* Draws a single-fill pattern without a layer; false when it can't (the caller then uses a layer).
   Normal drawing lays whole copies of the tile with drawImage, the same operation (and so the same rounding) as
   laying the layer itself; a pattern fill blends a shade differently there, and so do many small draws under a
   clip, which is why callers only ask for this (o.unclipped) when they haven't clipped. Masking ("source-in", the
   pattern inside a shape) needs one operation covering everything, and there a pattern fill matches the layer. */
function direct(ctx, W, H, id, S, scale, fg, fg2, bg, seed, alpha) {
  const op = ctx.globalCompositeOperation;
  if (op !== "source-over" && op !== "source-in") return false;
  const f = plan(W, H, id, S, scale, fg, fg2, bg, seed); if (!f) return false;
  const [c, ox, oy] = f, tw = c.width, th = c.height;
  // the tile's origin sits where it would in the layer: (cx + ox, cy + oy)
  const x0 = Math.round(W / 2) + Math.round(ox), y0 = Math.round(H / 2) + Math.round(oy);
  if (op === "source-in") {
    const pat = ctx.createPattern(c, "repeat"); if (!pat.setTransform) return false;
    pat.setTransform(new DOMMatrix([1, 0, 0, 1, x0, y0]));
    ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = pat; ctx.fillRect(0, 0, W, H); ctx.restore();
    return true;
  }
  const mx = ((x0 % tw) + tw) % tw, my = ((y0 % th) + th) % th, sx = mx ? mx - tw : 0, sy = my ? my - th : 0;   // the first copy, at or left of / above 0
  if (Math.ceil((W - sx) / tw) * Math.ceil((H - sy) / th) > MAX_COPIES) return false;
  ctx.save(); ctx.globalAlpha = alpha;
  // Whole copies only (a part-tile source rectangle samples differently); clipped to the layer's area when the
  // target reaches past it. A whole-pixel rectangle clip changes nothing else.
  const t = ctx.getTransform();
  if (t.e < 0 || t.f < 0 || t.e + W < ctx.canvas.width || t.f + H < ctx.canvas.height) { ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip(); }
  for (let y = sy; y < H; y += th) for (let x = sx; x < W; x += tw) ctx.drawImage(c, x, y);
  ctx.restore();
  return true;
}

/* draw's inputs, normalised; null when there is nothing to draw. */
function inputs(W, H, id, o) {
  if (!BY_ID[id]) return null;
  W = Math.ceil(W); H = Math.ceil(H); if (!(W > 0 && H > 0)) return null;
  const alpha = clamp(o.alpha == null ? 1 : +o.alpha, 0, 1); if (alpha <= 0) return null;
  const S = +o.S > 0 ? +o.S : Math.min(W, H), scale = clamp(+o.scale || 100, 20, 400), angle = +o.angle || 0;
  const fg = normCol(o.fg, [0, 0, 0]), fg2 = normCol(o.fg2, fg), bg = normCol(o.bg, [255, 255, 255]), seed = (o.seed | 0) >>> 0;
  return { W, H, alpha, S, scale, angle, fg, fg2, bg, seed, key: [id, W, H, S, scale, angle, fg, fg2, bg, seed].join("|") };
}
/* Does the slow part of draw(ctx, W, H, id, o) ahead of time, in steps: a caller that wants to stay responsive
   pauses at each one, then draws. Builds the pattern's tile a field or layer at a time (tiles don't depend on the
   angle), then the layer if draw will need one. Same work, same order as draw would do it, so the same pixels. */
function* steps(W, H, id, o = {}) {
  const I = inputs(W, H, id, o); if (!I || layerCache.get(I.key)) return;
  const later = [], f = plan(I.W, I.H, id, I.S, I.scale, I.fg, I.fg2, I.bg, I.seed, later, I.angle);
  for (const job of later) {
    yield;
    while (!job.run.next().done) yield;
    if (tileCache.get(job.key)) release(job.c);   // built meanwhile by someone who couldn't wait
    else tileCache.set(job.key, job.c);
  }
  if (f) { yield; paint(f[0]); }
  if (f && o.unclipped && !I.angle) return;   // draw lays the tile straight on
  yield;
  const layer = renderLayer(I.W, I.H, id, I.S, I.scale, I.angle, I.fg, I.fg2, I.bg, I.seed);
  layerCache.set(I.key, layer);
  yield; paint(layer);
}
/* The browser only turns a canvas's drawing into pixels when the canvas is first used; using one pixel of it here
   does that now, in its own step, rather than in the middle of the draw. */
let painter = null;
function paint(c) {
  if (!c.width || !c.height) return;
  if (!painter) painter = makeCanvas(1, 1).getContext("2d");
  painter.drawImage(c, 0, 0, 1, 1, 0, 0, 1, 1);
}
function prepare(W, H, id, o) { for (const _ of steps(W, H, id, o)); }
function draw(ctx, W0, H0, id, o = {}) {
  const I = inputs(W0, H0, id, o); if (!I) return;
  const { W, H, alpha, S, scale, angle, fg, fg2, bg, seed, key } = I;
  let layer = layerCache.get(key);
  if (!layer && o.unclipped && !angle && pixelAligned(ctx) && direct(ctx, W, H, id, S, scale, fg, fg2, bg, seed, alpha)) return;
  if (!layer) { layer = renderLayer(W, H, id, S, scale, angle, fg, fg2, bg, seed); layerCache.set(key, layer); }
  ctx.save(); ctx.globalAlpha = alpha; ctx.drawImage(layer, 0, 0, W, H); ctx.restore();
}

window.Patterns = {
  LIST, draw, prepare, steps, FAMILIES: ["fabric", "plaid", "check", "dots", "lines", "rays", "tile", "organic", "camo", "animal", "psych", "characters", "floral", "hardware", "microbes", "bones"], LOW_MEMORY, release,
  clearCache() { layerCache.clear(); tileCache.clear(); motifCache.clear(); bioCache.clear(); },
  /* Lets go of cached canvases beyond the cache budgets (after a big render). */
  trim() { layerCache.trim(); tileCache.trim(); },
  /* Pixels held by the caches, for tests. */
  cached() { return { layers: layerCache.used, tiles: tileCache.used }; },
};
})();
