/* Sleeve Press: glyph library. Big background shapes and the small repeated marks of the motif row.
   Classic script, no dependencies. Everything is drawn as vector paths; seeded detail comes from `o.seed`,
   so the same inputs always give the same picture. Neither call leaves the canvas state changed.

   Glyphs.drawShape(ctx, id, cx, cy, r, o)      o = { color, color2, bg, alpha, seed, outline, lw, rot }
   Glyphs.drawMark(ctx, id, x, top, w, h, o)    o = { color, outline, lw, seed, i }

   Shapes other than the five originals are painted at full strength into a scratch layer (so cut-outs are
   real holes and overlapping parts don't double up), then laid down once at `alpha`. "Line" shapes draw their
   own line-art version; "silhouette" shapes get an inner outline band of width `lw` taken from the solid. */
(function () {
"use strict";
const TAU = Math.PI * 2, D2R = Math.PI / 180, R3 = Math.sqrt(3);

function mulberry32(a) {
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const rgba = (c, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/* ---------- path helpers ---------- */
function circ(g, x, y, r) { g.moveTo(x + r, y); g.arc(x, y, r, 0, TAU); }
function circRev(g, x, y, r) { g.moveTo(x + r, y); g.arc(x, y, r, 0, -TAU, true); }
function poly(g, pts) { g.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]); g.closePath(); }
function ngon(n, R, a0 = -Math.PI / 2, x = 0, y = 0) { const p = []; for (let k = 0; k < n; k++) { const a = a0 + k * TAU / n; p.push([x + Math.cos(a) * R, y + Math.sin(a) * R]); } return p; }
function starPts(n, R, ri, a0 = -Math.PI / 2) { const p = []; for (let k = 0; k < n * 2; k++) { const a = a0 + k * Math.PI / n, q = k % 2 ? ri : R; p.push([Math.cos(a) * q, Math.sin(a) * q]); } return p; }
function ell(g, x, y, rx, ry, rot) { g.moveTo(x + Math.cos(rot) * rx, y + Math.sin(rot) * rx); g.ellipse(x, y, rx, ry, rot, 0, TAU); }
function capsule(g, ang, R, t, x = 0, y = 0) {
  // a bar of half-length R and half-thickness t with round ends, through (x,y) at angle `ang`
  const c = Math.cos(ang), s = Math.sin(ang), P = (u, v) => [x + u * c - v * s, y + u * s + v * c];
  const a = P(-R + t, -t); g.moveTo(a[0], a[1]); const b = P(R - t, -t); g.lineTo(b[0], b[1]);
  const e = P(R - t, 0); g.arc(e[0], e[1], t, ang - Math.PI / 2, ang + Math.PI / 2);
  const d = P(-R + t, t); g.lineTo(d[0], d[1]); const f = P(-R + t, 0); g.arc(f[0], f[1], t, ang + Math.PI / 2, ang + Math.PI * 1.5); g.closePath();
}
function rrect(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function heartPts(k, n = 72) {
  // the classic parametric heart: x = 16 sin³t, y = 13cos t − 5cos 2t − 2cos 3t − cos 4t (flipped for canvas), centred
  const p = [];
  for (let i = 0; i < n; i++) { const t = i / n * TAU, s = Math.sin(t); p.push([16 * s * s * s * k, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * k - 2.6 * k]); }
  return p;
}
// Sutherland-Hodgman clip of a convex polygon to the half-plane closer to site a than site b
function clipHalf(pg, a, b) {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, nx = b[0] - a[0], ny = b[1] - a[1];
  const side = (p) => (p[0] - mx) * nx + (p[1] - my) * ny, out = [];
  for (let i = 0; i < pg.length; i++) {
    const p = pg[i], q = pg[(i + 1) % pg.length], sp = side(p), sq = side(q);
    if (sp <= 0) out.push(p);
    if ((sp < 0 && sq > 0) || (sp > 0 && sq < 0)) { const t = sp / (sp - sq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return out;
}
function voronoi(sites, box) {
  return sites.map((s, i) => { let pg = box; for (let j = 0; j < sites.length && pg.length; j++) if (j !== i) pg = clipHalf(pg, s, sites[j]); return pg; });
}
function centroid(pg) {
  let A = 0, x = 0, y = 0;
  for (let i = 0; i < pg.length; i++) { const p = pg[i], q = pg[(i + 1) % pg.length], c = p[0] * q[1] - q[0] * p[1]; A += c; x += (p[0] + q[0]) * c; y += (p[1] + q[1]) * c; }
  return Math.abs(A) < 1e-9 ? pg[0] : [x / (3 * A), y / (3 * A)];
}

/* ---------- scratch canvases ---------- */
const pool = {};
function scratch(name, w, h) {
  let c = pool[name];
  if (!c) c = pool[name] = document.createElement("canvas");
  if (c.width < w || c.height < h) { c.width = Math.max(c.width, w); c.height = Math.max(c.height, h); }
  const g = c.getContext("2d");
  g.restore(); g.save();
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = "source-over"; g.globalAlpha = 1;
  g.clearRect(0, 0, w, h);
  return g;
}
function dirs(d) { const n = d > 6 ? 16 : 12, out = []; for (let k = 0; k < n; k++) out.push([Math.cos(k * TAU / n) * d, Math.sin(k * TAU / n) * d]); return out; }
// keep only an inner band of width d (device px): solid minus its erosion
function erodeBand(g, w, h, d) {
  const b = scratch(g.canvas === pool.M ? "MB" : "B", w, h), src = g.canvas;
  b.beginPath(); b.rect(0, 0, w, h); b.clip();
  b.drawImage(src, 0, 0, w, h, 0, 0, w, h);
  b.globalCompositeOperation = "destination-in";
  for (const [dx, dy] of dirs(d)) b.drawImage(src, 0, 0, w, h, dx, dy, w, h);
  g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = "destination-out";
  g.drawImage(b.canvas, 0, 0, w, h, 0, 0, w, h); g.globalCompositeOperation = "source-over";
}
function deviceBox(T, x0, y0, x1, y1, W, H, pad) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
    const X = T.a * x + T.c * y + T.e, Y = T.b * x + T.d * y + T.f;
    a = Math.min(a, X); b = Math.min(b, Y); c = Math.max(c, X); d = Math.max(d, Y);
  }
  a = Math.max(Math.floor(a) - 2, -pad); b = Math.max(Math.floor(b) - 2, -pad);
  c = Math.min(Math.ceil(c) + 2, W + pad); d = Math.min(Math.ceil(d) + 2, H + pad);
  return c > a && d > b ? { x: a, y: b, w: c - a, h: d - b } : null;
}

/* ---------- painter: one shape description, three renderings ----------
   fill: the solid picture. line: every part as a line drawing in its own tone.
   sil:  the solid as a mask on `g`, while `e` collects a band of every edge (2·lw wide, centred);
         drawShape then keeps the mask only where the band is, which leaves an inner outline of width lw. */
function painter(g, mode, A, B, bg, lw, rnd, e) {
  const isLine = mode === "line", sil = mode === "sil";
  const col = (c) => rgba(sil ? A : c === "a" ? A : c === "b" ? B : c === "g" ? bg : c);
  const both = (fn) => { fn(g); if (e) fn(e); };
  const thin = (c) => { g.lineWidth = lw; g.lineJoin = "round"; g.lineCap = "round"; g.strokeStyle = col(c); g.stroke(); };
  const edge = (build, width, cap = "round") => { if (!e || !(width > 0)) return; e.beginPath(); build(e); e.lineWidth = width; e.lineCap = cap; e.lineJoin = "round"; e.stroke(); };
  const erase = (x, fn) => { x.save(); x.globalCompositeOperation = "destination-out"; fn(x); x.restore(); };
  return {
    g, mode, isLine, outline: mode !== "fill", lw, rnd, A, B, bg,
    fill(c, build, rule = "nonzero") {
      g.beginPath(); build(g);
      if (isLine) { thin(c); return; }
      g.fillStyle = col(c); g.fill(rule); edge(build, lw * 2);
    },
    cut(build, rule = "nonzero", c = "a") {
      g.beginPath(); build(g);
      if (isLine) { if (c) thin(c); return; }
      erase(g, (x) => x.fill(rule)); edge(build, lw * 2);
    },
    line(c, width, build, cap = "butt") {
      g.beginPath(); build(g);
      if (isLine) { thin(c); return; }
      g.lineWidth = width; g.lineCap = cap; g.lineJoin = "round"; g.strokeStyle = col(c); g.stroke();
      if (e) { edge(build, width, cap); if (width > lw * 2) erase(e, (x) => { x.beginPath(); build(x); x.lineWidth = width - lw * 2; x.lineCap = cap; x.lineJoin = "round"; x.stroke(); }); }
    },
    cutLine(width, build, cap = "butt") {
      if (isLine) return;
      erase(g, (x) => { x.beginPath(); build(x); x.lineWidth = width; x.lineCap = cap; x.lineJoin = "round"; x.stroke(); });
      edge(build, width + lw * 2, cap);
    },
    // a cut that leaves a gap of `gap` around the path (for overlapping parts)
    gap(build, gap) {
      if (isLine) return;
      erase(g, (x) => { x.beginPath(); build(x); x.fill(); x.lineWidth = gap * 2; x.lineJoin = "round"; x.stroke(); });
      edge(build, gap * 2 + lw * 2);
      if (e) erase(e, (x) => { x.beginPath(); build(x); x.fill(); });
    },
    clip(build, rule = "nonzero") { both((x) => { x.beginPath(); build(x); x.clip(rule); }); },
    rotate(a) { both((x) => x.rotate(a)); },
    save() { both((x) => x.save()); }, restore() { both((x) => x.restore()); },
  };
}
// alternating solid / gap / second-tone bands of one outline at shrinking sizes
function nested(p, build, scales) {
  scales.forEach((s, k) => {
    const last = k === scales.length - 1;
    if (k % 2) p.cut((g) => build(g, s));
    else p.fill(last && k > 0 ? "b" : "a", (g) => build(g, s));
  });
}

/* ---------- big shapes ---------- */
const BOLT = [[0.12, -1], [0.62, -1], [0.22, -0.18], [0.58, -0.18], [-0.3, 1], [-0.04, 0.1], [-0.42, 0.1]];
function cartridge(g, s) {
  // rifle-cartridge case, tip up, length 2s centred; the projectile is drawn separately
  const P = [[-0.14, -0.42], [0.14, -0.42], [0.14, -0.25], [0.21, -0.13], [0.215, 0.79], [0.17, 0.83], [0.17, 0.87], [0.21, 0.885], [0.21, 1], [-0.21, 1], [-0.21, 0.885], [-0.17, 0.87], [-0.17, 0.83], [-0.215, 0.79], [-0.21, -0.13], [-0.14, -0.25]];
  poly(g, P.map(([x, y]) => [x * s, y * s]));
}
function projectile(g, s) {
  g.moveTo(-0.128 * s, -0.36 * s); g.lineTo(-0.128 * s, -0.52 * s);
  g.bezierCurveTo(-0.128 * s, -0.78 * s, -0.07 * s, -0.94 * s, 0, -s);
  g.bezierCurveTo(0.07 * s, -0.94 * s, 0.128 * s, -0.78 * s, 0.128 * s, -0.52 * s);
  g.lineTo(0.128 * s, -0.36 * s); g.closePath();
}
function archPath(g, hw, top, bottom) { g.moveTo(-hw, bottom); g.lineTo(-hw, top + hw); g.arc(0, top + hw, hw, Math.PI, 0); g.lineTo(hw, bottom); g.closePath(); }
// parts meet edge to edge (no overlaps), so the line version has no seams
function swordBlade(g, r) { poly(g, [[0, -1.08 * r], [0.1 * r, -0.88 * r], [0.1 * r, 0.36 * r], [-0.1 * r, 0.36 * r], [-0.1 * r, -0.88 * r]]); }
function swordHilt(g, r) {
  rrect(g, -0.36 * r, 0.36 * r, 0.72 * r, 0.1 * r, 0.05 * r);
  g.rect(-0.06 * r, 0.46 * r, 0.12 * r, 0.36 * r); circ(g, 0, 0.9 * r, 0.08 * r);
}

const SHAPE_DEFS = [
  // the five originals (ported 1:1 from drawBackdrop)
  { id: "circle", name: "Circle", family: "basic", round: true, port: true },
  { id: "ring", name: "Ring", family: "basic", round: true, port: true },
  { id: "square", name: "Square", family: "basic", round: false, port: true },
  { id: "half", name: "Half", family: "basic", round: true, port: true },
  { id: "bars", name: "Bars", family: "basic", round: false, port: true },

  { id: "target", name: "Target", family: "target", round: true, ol: "line", draw(p, r) {
    const n = 7; for (let k = 0; k < n; k++) { const R = r * (1 - k / n); if (k % 2) p.cut((g) => circ(g, 0, 0, R)); else p.fill(k === n - 1 ? "b" : "a", (g) => circ(g, 0, 0, R)); }
  } },
  { id: "scope", name: "Scope", family: "target", round: true, ol: "line", ext: 1.2, draw(p, r) {
    const t = r * 0.06, D = [[1, 0], [0, 1], [-1, 0], [0, -1]];
    p.line("a", t, (g) => circ(g, 0, 0, r - t / 2));
    p.line("a", t * 0.32, (g) => circ(g, 0, 0, r * 0.52));
    p.line("a", t * 1.35, (g) => { for (const [x, y] of D) { g.moveTo(x * r * 1.16, y * r * 1.16); g.lineTo(x * r * 0.56, y * r * 0.56); } });
    p.line("a", t * 0.3, (g) => { for (const [x, y] of D) { g.moveTo(x * r * 0.56, y * r * 0.56); g.lineTo(x * r * 0.075, y * r * 0.075); } });
    p.line("a", t * 0.3, (g) => { for (const [x, y] of D) for (let k = 1; k <= 4; k++) { const d = r * (0.1 + k * 0.09), L = r * (k === 4 ? 0.06 : 0.035); g.moveTo(x * d - y * L, y * d - x * L); g.lineTo(x * d + y * L, y * d + x * L); } });
    p.fill("b", (g) => circ(g, 0, 0, r * 0.035));
  } },
  { id: "starburst", name: "Starburst", family: "burst", round: false, ol: "sil", draw(p, r) {
    const n = 12 + 2 * Math.floor(p.rnd() * 8), ri = n > 20 ? 0.8 : n > 15 ? 0.74 : 0.66;
    p.fill("a", (g) => poly(g, starPts(n, r, r * ri)));
  } },
  { id: "star", name: "Star", family: "burst", round: false, ol: "sil", draw(p, r) {
    p.fill("a", (g) => { g.translate(0, r * 0.1); poly(g, starPts(5, r, r * 0.4)); g.translate(0, -r * 0.1); });
  } },
  { id: "sun", name: "Sun", family: "burst", round: true, ol: "line", draw(p, r) {
    const n = [12, 16, 20][Math.floor(p.rnd() * 3)], hw = Math.PI / n * 0.62;
    p.fill("a", (g) => circ(g, 0, 0, r * 0.44));
    p.fill("a", (g) => { for (let k = 0; k < n; k++) { const a = k * TAU / n - Math.PI / 2, L = r * (k % 2 ? 0.8 : 1), r0 = r * 0.54; g.moveTo(Math.cos(a - hw) * r0, Math.sin(a - hw) * r0); g.lineTo(Math.cos(a) * L, Math.sin(a) * L); g.lineTo(Math.cos(a + hw) * r0, Math.sin(a + hw) * r0); g.closePath(); } });
  } },
  { id: "rays", name: "Rays", family: "burst", round: false, ol: "line", ext: Infinity, draw(p, r, L) {
    const n = [24, 28, 36][Math.floor(p.rnd() * 3)];
    p.fill("a", (g) => { for (let k = 0; k < n; k += 2) { const a = k * TAU / n, b = (k + 1) * TAU / n; g.moveTo(0, 0); g.lineTo(Math.cos(a) * L, Math.sin(a) * L); g.lineTo(Math.cos(b) * L, Math.sin(b) * L); g.closePath(); } });
    p.cut((g) => circ(g, 0, 0, r * 0.34), "nonzero", null);
    p.fill("b", (g) => circ(g, 0, 0, r * 0.24));
  } },
  { id: "blob", name: "Blob", family: "organic", round: true, ol: "sil", draw(p, r) {
    const ph = [0, 0, 0, 0].map(() => p.rnd() * TAU), N = 160, pts = [];
    let mx = 0;
    for (let i = 0; i < N; i++) { const a = i / N * TAU, q = 1 + 0.13 * Math.sin(2 * a + ph[0]) + 0.09 * Math.sin(3 * a + ph[1]) + 0.05 * Math.sin(4 * a + ph[2]) + 0.025 * Math.sin(6 * a + ph[3]); pts.push([a, q]); mx = Math.max(mx, q); }
    const P = (dx, dy, k) => pts.map(([a, q]) => [dx + Math.cos(a) * q / mx * r * k, dy + Math.sin(a) * q / mx * r * k]);
    if (!p.outline) p.fill("b", (g) => poly(g, P(r * 0.07, r * 0.06, 0.94)));
    p.fill("a", (g) => poly(g, P(-r * 0.03, -r * 0.03, 0.94)));
  } },
  { id: "arch", name: "Arch", family: "geometric", round: false, ol: "sil", draw(p, r) {
    const bands = p.rnd() < 0.5 ? 1 : 3, d = r * 0.2;
    nested(p, (g, k) => archPath(g, r * 0.7 - k * d, -r + k * d, r), bands === 1 ? [0] : [0, 1, 2]);
  } },
  { id: "triangle", name: "Triangle", family: "geometric", round: false, ol: "sil", draw(p, r) {
    const nest = p.rnd() < 0.5;
    nested(p, (g, s) => poly(g, ngon(3, r * s, -Math.PI / 2, 0, r * 0.12)), nest ? [1, 0.7, 0.48] : [1]);
  } },
  { id: "diamond", name: "Diamond", family: "geometric", round: false, ol: "sil", draw(p, r) {
    const nest = p.rnd() < 0.6;
    nested(p, (g, s) => poly(g, [[0, -r * s], [r * 0.72 * s, 0], [0, r * s], [-r * 0.72 * s, 0]]), nest ? [1, 0.72, 0.5, 0.26, 0.13] : [1]);
  } },
  { id: "hexagon", name: "Hexagon", family: "geometric", round: false, ol: "sil", draw(p, r) {
    const nest = p.rnd() < 0.4;
    nested(p, (g, s) => poly(g, ngon(6, r * s, 0)), nest ? [1, 0.78, 0.6] : [1]);
  } },
  { id: "cross", name: "Cross", family: "geometric", round: false, ol: "sil", draw(p, r) {
    const t = r * 0.25;
    p.fill("a", (g) => poly(g, [[-t, -r], [t, -r], [t, -t], [r, -t], [r, t], [t, t], [t, r], [-t, r], [-t, t], [-r, t], [-r, -t], [-t, -t]]));
  } },
  { id: "chevrons", name: "Chevrons", family: "geometric", round: false, ol: "sil", draw(p, r) {
    const W = r * 0.95, H = r * 0.72, th = r * 0.2, sp = r * 0.42;
    for (let k = 0; k < 4; k++) { const y0 = -r * 1.04 + k * sp; p.fill(k % 2 ? "b" : "a", (g) => poly(g, [[-W, y0 + H], [0, y0], [W, y0 + H], [W, y0 + H + th], [0, y0 + th], [-W, y0 + H + th]])); }
  } },
  { id: "squares", name: "Nested squares", family: "geometric", round: false, ol: "line", draw(p, r) {
    const tw = [0, 0, 7][Math.floor(p.rnd() * 3)] * D2R, n = 9;
    for (let k = 0; k < n; k++) { const s = r * 0.86 * (1 - k / n); const build = (g) => { g.rotate(tw * k); g.rect(-s, -s, s * 2, s * 2); g.rotate(-tw * k); }; if (k % 2) p.cut(build); else p.fill(k === n - 1 ? "b" : "a", build); }
  } },
  { id: "quatrefoil", name: "Quatrefoil", family: "ornament", round: false, ol: "sil", draw(p, r) {
    const foil = (g, k) => { const s = r * 0.5 * k; g.moveTo(s, -s); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; g.arc(Math.cos(a) * s, Math.sin(a) * s, s, a - Math.PI / 2, a + Math.PI / 2); } g.closePath(); };
    nested(p, foil, p.rnd() < 0.5 ? [1, 0.7, 0.5] : [1]);
  } },
  { id: "rosette", name: "Rosette", family: "ornament", round: true, ol: "line", draw(p, r) {
    const n = [8, 10, 12][Math.floor(p.rnd() * 3)], ry = Math.min(r * 0.52 * Math.sin(Math.PI / n) * 1.25, r * 0.24);
    p.fill("a", (g) => { for (let k = 0; k < n; k++) { const a = k * TAU / n - Math.PI / 2; ell(g, Math.cos(a) * r * 0.52, Math.sin(a) * r * 0.52, r * 0.48, ry, a); } });
    p.cut((g) => circ(g, 0, 0, r * 0.3));
    p.fill("b", (g) => { for (let k = 0; k < n; k++) { const a = (k + 0.5) * TAU / n - Math.PI / 2; ell(g, Math.cos(a) * r * 0.15, Math.sin(a) * r * 0.15, r * 0.13, ry * 0.42, a); } });
    p.cut((g) => circ(g, 0, 0, r * 0.07));
  } },
  { id: "spiral", name: "Spiral", family: "organic", round: true, ol: "line", draw(p, r) {
    const turns = 3 + Math.floor(p.rnd() * 2) * 0.5, T = turns * TAU, pitch = r / (turns + 0.4), N = 420, out = [], inn = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, th = t * T, rho = pitch * th / TAU, hw = pitch * 0.34 * Math.pow(t, 0.45) + r * 0.004;
      out.push([Math.cos(th) * (rho + hw), Math.sin(th) * (rho + hw)]); inn.push([Math.cos(th) * Math.max(0, rho - hw), Math.sin(th) * Math.max(0, rho - hw)]);
    }
    p.fill("a", (g) => poly(g, out.concat(inn.reverse())));
  } },
  { id: "wave", name: "Wave band", family: "organic", round: false, ol: "line", ext: Infinity, draw(p, r, L) {
    const A = r * 0.16, lam = r * 1.15, th = r * 0.24, sp = r * 0.44, ph = p.rnd() * TAU, step = lam / 28;
    for (let k = 0; k < 3; k++) {
      const y0 = (k - 1) * sp - th / 2, f = (x) => y0 + A * Math.sin(x / lam * TAU + ph);
      p.fill(k === 1 ? "b" : "a", (g) => { g.moveTo(-L, f(-L)); for (let x = -L; x <= L; x += step) g.lineTo(x, f(x)); for (let x = L; x >= -L; x -= step) g.lineTo(x, f(x) + th); g.closePath(); });
    }
  } },
  { id: "bolt", name: "Lightning", family: "symbol", round: false, ol: "sil", draw(p, r) {
    p.fill("a", (g) => poly(g, BOLT.map(([x, y]) => [(x - 0.08) * r, y * r])));
  } },
  { id: "moon", name: "Crescent", family: "symbol", round: true, ol: "sil", draw(p, r) {
    p.fill("a", (g) => circ(g, 0, 0, r));
    p.cut((g) => circ(g, r * 0.36, -r * 0.22, r * 0.84));
  } },
  { id: "eye", name: "Eye", family: "symbol", round: false, ol: "line", draw(p, r) {
    const s = r * 0.56, R = (r * r + s * s) / (2 * s), c = R - s;
    const almond = (g) => { g.moveTo(-r, 0); g.arc(0, c, R, Math.atan2(-c, -r), Math.atan2(-c, r)); g.arc(0, -c, R, Math.atan2(c, r), Math.atan2(c, -r)); g.closePath(); };
    p.fill("a", almond);
    p.save(); p.clip(almond);
    p.cut((g) => circ(g, 0, 0, r * 0.5), "nonzero", null);
    p.fill("b", (g) => circ(g, 0, 0, r * 0.43));
    p.cut((g) => circ(g, 0, 0, r * 0.19));
    p.fill("b", (g) => circ(g, r * 0.1, -r * 0.1, r * 0.055));
    p.restore();
  } },
  { id: "discs", name: "Stacked discs", family: "geometric", round: true, ol: "sil", draw(p, r) {
    const R = r * 0.6, C = [[-0.36, -0.14], [0, 0], [0.36, 0.14]];
    C.forEach(([x, y], k) => { const b = (g) => circ(g, x * r, y * r, R); if (k) p.gap(b, r * 0.035); p.fill(k === 1 ? "b" : "a", b); });
  } },
  { id: "honeycomb", name: "Honeycomb", family: "pattern", round: false, ol: "sil", draw(p, r) {
    const cr = r * 0.224, cells = [];
    for (let q = -2; q <= 2; q++) for (let s = -2; s <= 2; s++) { if (Math.abs(q + s) > 2) continue; cells.push([cr * R3 * (q + s / 2), cr * 1.5 * s, Math.max(Math.abs(q), Math.abs(s), Math.abs(q + s))]); }
    const pick = cells.map(() => p.rnd()), drop = cells.map((c, i) => c[2] === 2 && pick[i] < 0.18);
    p.fill("a", (g) => cells.forEach(([x, y], i) => { if (!drop[i] && pick[i] < 0.8) poly(g, ngon(6, cr * 0.9, -Math.PI / 2, x, y)); }));
    p.fill("b", (g) => cells.forEach(([x, y], i) => { if (!drop[i] && pick[i] >= 0.8) poly(g, ngon(6, cr * 0.9, -Math.PI / 2, x, y)); }));
  } },
  { id: "halftone", name: "Halftone disc", family: "pattern", round: true, ol: "line", draw(p, r) {
    const sp = r / 8, linear = p.rnd() < 0.5;
    p.fill("a", (g) => {
      for (let j = -9; j <= 9; j++) for (let i = -9; i <= 9; i++) {
        const x = (i + (j % 2 ? 0.5 : 0)) * sp, y = j * sp * R3 / 2, d = Math.hypot(x, y);
        if (d > r) continue;
        const f = linear ? (y / r + 1) / 2 : 1 - d / r, rr = sp * 0.56 * Math.pow(Math.max(0, f), linear ? 0.8 : 0.7);
        if (rr > sp * 0.04) circ(g, x, y, rr);
      }
    });
  } },
  { id: "sunset", name: "Sunset", family: "pattern", round: true, ol: "sil", draw(p, r) {
    p.fill("a", (g) => circ(g, 0, 0, r));
    let y = -r * 0.06;
    for (let k = 0; k < 7 && y < r * 0.8; k++) { const t = r * (0.028 + k * 0.022); const y0 = y; p.cut((g) => g.rect(-r * 1.1, y0, r * 2.2, t)); y += t + r * (0.13 - k * 0.012); }
  } },
  { id: "web", name: "Web", family: "nature", round: true, ol: "line", draw(p, r) {
    const n = 11 + Math.floor(p.rnd() * 4), ang = [], rings = 7;
    for (let k = 0; k < n; k++) ang.push((k + (p.rnd() - 0.5) * 0.35) * TAU / n);
    const t = r * 0.02;
    p.line("a", t, (g) => {
      for (const a of ang) { g.moveTo(0, 0); g.lineTo(Math.cos(a) * r * 1.02, Math.sin(a) * r * 1.02); }
      for (let m = 1; m <= rings; m++) {
        const R = r * (0.1 + 0.88 * Math.pow(m / rings, 1.1));
        for (let k = 0; k < n; k++) {
          const a = ang[k], b = ang[(k + 1) % n] + (k === n - 1 ? TAU : 0), mid = (a + b) / 2, sag = R * (0.86 - 0.04 * (b - a));
          g.moveTo(Math.cos(a) * R, Math.sin(a) * R); g.quadraticCurveTo(Math.cos(mid) * sag, Math.sin(mid) * sag, Math.cos(b) * R, Math.sin(b) * R);
        }
      }
    }, "round");
  } },
  { id: "snowflake", name: "Snowflake", family: "nature", round: false, ol: "sil", draw(p, r) {
    const t = r * 0.085;
    p.line("a", t, (g) => {
      for (let k = 0; k < 6; k++) {
        const a = k * TAU / 6 - Math.PI / 2, c = Math.cos(a), s = Math.sin(a), R = r - t / 2;
        g.moveTo(0, 0); g.lineTo(c * R, s * R);
        for (const [d, L] of [[0.42, 0.3], [0.68, 0.2]]) for (const sg of [-1, 1]) { const b = a + sg * Math.PI / 3; g.moveTo(c * r * d, s * r * d); g.lineTo(c * r * d + Math.cos(b) * r * L, s * r * d + Math.sin(b) * r * L); }
      }
    }, "round");
    p.cut((g) => poly(g, ngon(6, r * 0.13, 0)));
    p.fill("b", (g) => poly(g, ngon(6, r * 0.07, 0)));
  } },
  { id: "glass", name: "Stained glass", family: "ornament", round: false, ol: "line", draw(p, r) {
    const hw = r * 0.68, top = -r, bot = r, rnd = p.rnd, arch = (g) => archPath(g, hw, top, bot);
    const inArch = (x, y) => Math.abs(x) < hw && y < bot && (y > top + hw || Math.hypot(x, y - top - hw) < hw);
    let sites = [];
    while (sites.length < 22) { const x = (rnd() * 2 - 1) * hw, y = top + rnd() * (bot - top); if (inArch(x, y)) sites.push([x, y]); }
    const box = [[-hw, top], [hw, top], [hw, bot], [-hw, bot]];
    for (let it = 0; it < 2; it++) sites = voronoi(sites, box).map(centroid);
    const cells = voronoi(sites, box), A = p.A, B = p.B, G = p.bg;
    const tints = [A, B, mix(A, G, 0.45), mix(B, G, 0.35), mix(A, B, 0.5), A, mix(B, G, 0.6)];
    p.save(); p.clip(arch);
    cells.forEach((c) => { const t = tints[Math.floor(rnd() * tints.length)]; if (c.length > 2) p.fill(p.isLine ? "a" : t, (g) => poly(g, c)); });
    p.cutLine(r * 0.024, (g) => cells.forEach((c) => c.length > 2 && poly(g, c)));
    p.cutLine(r * 0.07, arch);
    p.restore();
    if (p.isLine) p.fill("a", arch);
  } },
  { id: "rosewindow", name: "Rose window", family: "ornament", round: true, ol: "line", draw(p, r) {
    const A = p.A, B = p.B, G = p.bg, n = [8, 10, 12][Math.floor(p.rnd() * 3)];
    const sector = (g, r0, r1, a0, a1) => { g.moveTo(Math.cos(a0) * r0, Math.sin(a0) * r0); g.arc(0, 0, r1, a0, a1); g.arc(0, 0, r0, a1, a0, true); g.closePath(); };
    p.fill(p.isLine ? "b" : mix(B, G, 0.3), (g) => circ(g, 0, 0, r * 0.2));
    const tA = p.isLine ? ["a", "a"] : [A, mix(A, G, 0.45)], tB = p.isLine ? ["b", "b", "b"] : [B, mix(A, B, 0.5), mix(B, G, 0.45)];
    for (let k = 0; k < n; k++) { const a0 = k * TAU / n - Math.PI / 2, a1 = a0 + TAU / n; p.fill(tA[k % 2], (g) => sector(g, r * 0.2, r * 0.52, a0, a1)); }
    for (let k = 0; k < n * 2; k++) { const a0 = k * TAU / n / 2 - Math.PI / 2, a1 = a0 + TAU / n / 2; p.fill(tB[k % 3], (g) => sector(g, r * 0.52, r * 0.8, a0, a1)); }
    p.fill("a", (g) => { circ(g, 0, 0, r); circRev(g, 0, 0, r * 0.8); });
    const lead = r * 0.024;
    p.cutLine(lead, (g) => {
      for (const R of [0.2, 0.52, 0.8]) circ(g, 0, 0, r * R);
      for (let k = 0; k < n; k++) { const a = k * TAU / n - Math.PI / 2; g.moveTo(Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2); g.lineTo(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8); }
      for (let k = 0; k < n; k++) { const a = (k + 0.5) * TAU / n - Math.PI / 2; g.moveTo(Math.cos(a) * r * 0.52, Math.sin(a) * r * 0.52); g.lineTo(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8); }
    });
    p.cut((g) => { for (let k = 0; k < n * 2; k++) { const a = (k + 0.5) * TAU / n / 2 - Math.PI / 2; circ(g, Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9, r * 0.045); } });
    if (p.isLine) p.fill("a", (g) => circ(g, 0, 0, r * 0.9));
  } },
  { id: "bullet", name: "Bullet", family: "arms", round: false, ol: "sil", draw(p, r) {
    p.rotate(35 * D2R);
    p.fill("a", (g) => cartridge(g, r));
    p.cut((g) => g.rect(-r * 0.2, -r * 0.43, r * 0.4, r * 0.03), "nonzero", null);
    p.fill("b", (g) => projectile(g, r));
    p.cutLine(r * 0.028, (g) => { g.moveTo(-r * 0.115, -r * 0.06); g.lineTo(-r * 0.115, r * 0.7); }, "round");
  } },
  { id: "shell", name: "Shotgun shell", family: "arms", round: false, ol: "sil", draw(p, r) {
    p.rotate(-25 * D2R);
    const hw = r * 0.3;
    p.fill("a", (g) => { g.moveTo(-hw, r * 0.3); g.lineTo(-hw, -r * 0.9); g.quadraticCurveTo(-hw, -r, -hw + r * 0.08, -r); g.lineTo(hw - r * 0.08, -r); g.quadraticCurveTo(hw, -r, hw, -r * 0.9); g.lineTo(hw, r * 0.3); g.closePath(); });
    p.cutLine(r * 0.022, (g) => { for (const x of [-0.15, 0, 0.15]) { g.moveTo(x * r, -r * 0.84); g.lineTo(x * r, r * 0.22); } }, "round");
    p.cutLine(r * 0.018, (g) => { for (const x of [-0.15, 0, 0.15]) { g.moveTo(x * r * 0.7, -r * 1.01); g.lineTo(x * r * 0.4, -r * 0.93); } }, "round");
    p.fill("b", (g) => { g.rect(-hw - r * 0.01, r * 0.33, hw * 2 + r * 0.02, r * 0.55); g.rect(-hw - r * 0.04, r * 0.905, hw * 2 + r * 0.08, r * 0.095); });
  } },
  { id: "shuriken", name: "Shuriken", family: "arms", round: false, ol: "sil", draw(p, r) {
    const n = p.rnd() < 0.6 ? 4 : 6, D = TAU / n;
    p.fill("a", (g) => {
      for (let k = 0; k < n; k++) {
        // each blade: one straight edge out to the tip, one hooked concave edge back in
        const a = k * D - Math.PI / 2, ip = [Math.cos(a + D * 0.45) * r * 0.24, Math.sin(a + D * 0.45) * r * 0.24];
        const nb = a + D, cp = [Math.cos(a + D * 0.8) * r * 0.64, Math.sin(a + D * 0.8) * r * 0.64];
        if (!k) g.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        g.lineTo(ip[0], ip[1]); g.quadraticCurveTo(cp[0], cp[1], Math.cos(nb) * r, Math.sin(nb) * r);
      }
      g.closePath();
    });
    p.cutLine(r * 0.022, (g) => circ(g, 0, 0, r * 0.19));
    p.cut((g) => circ(g, 0, 0, r * 0.09));
  } },
  { id: "swords", name: "Crossed swords", family: "arms", round: false, ol: "sil", draw(p, r) {
    const one = (ang, first) => {
      const blade = (g) => { g.rotate(ang); swordBlade(g, r); g.rotate(-ang); }, hilt = (g) => { g.rotate(ang); swordHilt(g, r); g.rotate(-ang); };
      if (!first) { p.gap(blade, r * 0.03); p.gap(hilt, r * 0.03); }
      p.fill("a", blade); p.fill("b", hilt);
      p.cutLine(r * 0.022, (g) => { g.rotate(ang); g.moveTo(0, -r * 0.8); g.lineTo(0, r * 0.3); g.rotate(-ang); }, "round");
    };
    one(-42 * D2R, true); one(42 * D2R, false);
  } },
];
const SHAPES_BY = {}; SHAPE_DEFS.forEach((s) => { SHAPES_BY[s.id] = s; });

function drawPort(ctx, id, cx, cy, r, o, col, a, rot) {
  ctx.save();
  if (rot) { ctx.translate(cx, cy); ctx.rotate(rot); ctx.translate(-cx, -cy); }
  ctx.fillStyle = rgba(col, a); ctx.strokeStyle = rgba(col, a);
  const lw = o.lw > 0 ? o.lw : Math.max(1, r * 0.02);
  ctx.beginPath();
  if (!o.outline) {
    if (id === "circle") { ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); }
    else if (id === "ring") { ctx.lineWidth = r * 0.16; ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2); ctx.stroke(); }
    else if (id === "square") { ctx.fillRect(cx - r, cy - r, r * 2, r * 2); }
    else if (id === "half") { ctx.arc(cx, cy, r, Math.PI, 0); ctx.closePath(); ctx.fill(); }
    else if (id === "bars") { const n = 7, bw = (r * 2) / (n * 2 - 1); for (let i = 0; i < n; i++) ctx.fillRect(cx - r + i * bw * 2, cy - r, bw, r * 2); }
  } else {
    ctx.lineWidth = lw; ctx.lineJoin = "round"; const h = lw / 2;
    if (id === "circle") { ctx.arc(cx, cy, r - h, 0, TAU); }
    else if (id === "ring") { circ(ctx, cx, cy, r - h); circ(ctx, cx, cy, r * 0.84 + h); }
    else if (id === "square") { ctx.rect(cx - r + h, cy - r + h, r * 2 - lw, r * 2 - lw); }
    else if (id === "half") { ctx.arc(cx, cy, r - h, Math.PI, 0); ctx.closePath(); }
    else if (id === "bars") { const n = 7, bw = (r * 2) / (n * 2 - 1); for (let i = 0; i < n; i++) ctx.rect(cx - r + i * bw * 2 + h, cy - r + h, bw - lw, r * 2 - lw); }
    ctx.stroke();
  }
  ctx.restore();
}

function drawShape(ctx, id, cx, cy, r, o) {
  o = o || {};
  const S = SHAPES_BY[id];
  if (!S || !(r > 0)) return;
  const col = o.color || [0, 0, 0], col2 = o.color2 || col, bg = o.bg || [255, 255, 255];
  const alpha = o.alpha == null ? 1 : +o.alpha, rot = (+o.rot || 0) * D2R;
  if (!(alpha > 0)) return;
  if (S.port) { drawPort(ctx, id, cx, cy, r, o, col, alpha, rot); return; }
  const lw = o.lw > 0 ? o.lw : Math.max(1, r * 0.02);
  const T = ctx.getTransform(), sc = Math.sqrt(Math.abs(T.a * T.d - T.b * T.c)) || 1;
  const W = ctx.canvas.width, H = ctx.canvas.height, pad = Math.ceil(lw * sc * 2 + 4);
  const ext = S.ext || 1.12, E = isFinite(ext) ? r * ext + lw * 2 : Infinity;
  const box = isFinite(E) ? deviceBox(T, cx - E, cy - E, cx + E, cy + E, W, H, pad) : { x: -pad, y: -pad, w: W + pad * 2, h: H + pad * 2 };
  if (!box) return;
  const g = scratch("L", box.w, box.h);
  g.setTransform(T.a, T.b, T.c, T.d, T.e - box.x, T.f - box.y);
  g.translate(cx, cy); if (rot) g.rotate(rot);
  const mode = o.outline ? (S.ol === "line" ? "line" : "sil") : "fill";
  let e = null;
  if (mode === "sil") { e = scratch("E", box.w, box.h); e.setTransform(g.getTransform()); e.strokeStyle = "#000"; }
  const p = painter(g, mode, col, col2, bg, lw, mulberry32((o.seed | 0) * 2654435761 ^ 0x9E3779B9), e);
  // the far reach of an unbounded shape (rays, wave), in local units
  const iT = T.inverse(); let L = r;
  for (const [X, Y] of [[-pad, -pad], [W + pad, -pad], [-pad, H + pad], [W + pad, H + pad]]) L = Math.max(L, Math.hypot(iT.a * X + iT.c * Y + iT.e - cx, iT.b * X + iT.d * Y + iT.f - cy));
  p.save(); S.draw(p, r, L); p.restore();
  if (e) { g.setTransform(1, 0, 0, 1, 0, 0); g.save(); g.beginPath(); g.rect(0, 0, box.w, box.h); g.clip(); g.globalCompositeOperation = "destination-in"; g.drawImage(e.canvas, 0, 0, box.w, box.h, 0, 0, box.w, box.h); g.restore(); }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha *= alpha;
  ctx.drawImage(g.canvas, 0, 0, box.w, box.h, box.x, box.y, box.w, box.h);
  ctx.restore();
}

/* ---------- marks ----------
   Local units: origin at the centre of the (x, top, w, h) box, u = w. The existing bars are w × h,
   dots are a circle of 1.24u, the pitch is about 2.2u; compact marks stay within ~1.9u wide. */
function cut(g, build) { g.save(); g.globalCompositeOperation = "destination-out"; g.beginPath(); build(); g.fill(); g.restore(); }
function cutLine(g, w, build) { g.save(); g.globalCompositeOperation = "destination-out"; g.beginPath(); build(); g.lineWidth = w; g.lineCap = "round"; g.stroke(); g.restore(); }
function fillP(g, build, rule) { g.beginPath(); build(); g.fill(rule || "nonzero"); }
function strokeP(g, w, build, cap = "round") { g.beginPath(); build(); g.lineWidth = w; g.lineCap = cap; g.lineJoin = "round"; g.stroke(); }

const MARK_DEFS = [
  { id: "star", name: "Stars", round: false, draw(g, u) { fillP(g, () => { g.translate(0, u * 0.08); poly(g, starPts(5, u * 0.95, u * 0.39)); g.translate(0, -u * 0.08); }); } },
  { id: "sparkle", name: "Sparkles", round: false, draw(g, u) {
    const V = u * 1.2, Hh = u * 0.86, c = u * 0.1;
    fillP(g, () => { g.moveTo(0, -V); g.quadraticCurveTo(c, -c, Hh, 0); g.quadraticCurveTo(c, c, 0, V); g.quadraticCurveTo(-c, c, -Hh, 0); g.quadraticCurveTo(-c, -c, 0, -V); g.closePath(); });
  } },
  { id: "asterisk", name: "Asterisks", round: false, ol: "self", draw(g, u, h, ol, i, lw) { const t = ol ? lw / 2 : u * 0.15; fillP(g, () => { for (const a of [90, 30, 150]) capsule(g, a * D2R, u * 0.88, t); }); } },
  { id: "saltire", name: "Crosses", round: false, olw: 0.1, draw(g, u) { fillP(g, () => { capsule(g, 45 * D2R, u * 0.9, u * 0.19); capsule(g, -45 * D2R, u * 0.9, u * 0.19); }); } },
  { id: "flower", name: "Flowers", round: true, draw(g, u) {
    fillP(g, () => { circ(g, 0, 0, u * 0.45); for (let k = 0; k < 5; k++) { const a = -Math.PI / 2 + k * TAU / 5; circ(g, Math.cos(a) * u * 0.5, Math.sin(a) * u * 0.5, u * 0.36); } });
    cut(g, () => circ(g, 0, 0, u * 0.15));
  } },
  { id: "heart", name: "Hearts", round: false, draw(g, u) { fillP(g, () => poly(g, heartPts(u * 0.92 / 16))); } },
  { id: "spade", name: "Spades", round: false, draw(g, u) {
    const k = u * 0.86 / 16;
    fillP(g, () => {
      poly(g, heartPts(k).map(([x, y]) => [x, -y - u * 0.22]));
      g.moveTo(-u * 0.16, u * 0.05); g.lineTo(u * 0.16, u * 0.05); g.quadraticCurveTo(u * 0.1, u * 0.75, u * 0.42, u * 0.98); g.lineTo(-u * 0.42, u * 0.98); g.quadraticCurveTo(-u * 0.1, u * 0.75, -u * 0.16, u * 0.05); g.closePath();
    });
  } },
  { id: "drop", name: "Drops", round: false, draw(g, u) {
    const R = u * 0.62, cy = u * 0.36, tip = -u * 1.0;
    fillP(g, () => { g.moveTo(0, tip); g.bezierCurveTo(u * 0.22, tip + u * 0.42, R, cy - u * 0.42, R, cy); g.arc(0, cy, R, 0, Math.PI); g.bezierCurveTo(-R, cy - u * 0.42, -u * 0.22, tip + u * 0.42, 0, tip); g.closePath(); });
  } },
  { id: "triangle", name: "Triangles", round: false, draw(g, u) { fillP(g, () => poly(g, ngon(3, u * 1.0, -Math.PI / 2, 0, u * 0.25))); } },
  { id: "arrow", name: "Arrows", round: false, draw(g, u, h) {
    const H = Math.min(h * 0.86, u * 4.4), y0 = -H / 2, hh = u * 1.05, hw = u * 0.78, sw = u * 0.21;
    fillP(g, () => poly(g, [[0, y0], [hw, y0 + hh], [sw, y0 + hh * 0.8], [sw, y0 + H], [-sw, y0 + H], [-sw, y0 + hh * 0.8], [-hw, y0 + hh]]));
  } },
  { id: "bolt", name: "Bolts", round: false, draw(g, u, h) {
    const sy = Math.min(h * 0.36, u * 1.5), sx = u * 1.15;
    fillP(g, () => poly(g, BOLT.map(([x, y]) => [(x - 0.1) * sx, y * sy])));
  } },
  { id: "bullet", name: "Bullets", round: false, draw(g, u, h) {
    const s = Math.min(h / 2, u * 2.45);
    fillP(g, () => cartridge(g, s));
    cut(g, () => g.rect(-s * 0.2, -s * 0.45, s * 0.4, s * 0.065));
    fillP(g, () => projectile(g, s));
  } },
  { id: "shell", name: "Shells", round: false, draw(g, u, h) {
    const s = Math.min(h / 2, u * 2.2), hw = Math.min(s * 0.25, u * 0.56);
    // plastic hull with a folded crimp at the mouth, brass head, rim
    fillP(g, () => { g.moveTo(-hw, s * 0.2); g.lineTo(-hw, -s * 0.9); g.lineTo(-hw * 0.7, -s); g.lineTo(-hw * 0.18, -s * 0.9); g.lineTo(0, -s * 0.94); g.lineTo(hw * 0.18, -s * 0.9); g.lineTo(hw * 0.7, -s); g.lineTo(hw, -s * 0.9); g.lineTo(hw, s * 0.2); g.closePath(); });
    fillP(g, () => { g.rect(-hw * 1.04, s * 0.28, hw * 2.08, s * 0.58); g.rect(-hw * 1.2, s * 0.9, hw * 2.4, s * 0.1); });
  } },
  { id: "crosshair", name: "Crosshairs", round: true, ol: "self", draw(g, u, h, ol, i, lw) {
    // the outline version is the same reticle in hairline with an open centre
    const t = ol ? lw : u * 0.2, R = u * 0.62;
    strokeP(g, t, () => circ(g, 0, 0, R - t / 2));
    strokeP(g, ol ? lw : u * 0.17, () => { for (const [x, y] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) { g.moveTo(x * u * 0.3, y * u * 0.3); g.lineTo(x * u * 0.86, y * u * 0.86); } }, "butt");
    if (ol) strokeP(g, lw, () => circ(g, 0, 0, u * 0.12)); else fillP(g, () => circ(g, 0, 0, u * 0.13));
  } },
  { id: "snowflake", name: "Snowflakes", round: false, ol: "self", draw(g, u, h, ol, i, lw) {
    const t = ol ? lw : u * 0.16, R = u * 0.92;
    strokeP(g, t, () => {
      for (let k = 0; k < 6; k++) { const a = k * TAU / 6 - Math.PI / 2, c = Math.cos(a), s = Math.sin(a); g.moveTo(0, 0); g.lineTo(c * R, s * R);
        for (const sg of [-1, 1]) { const b = a + sg * Math.PI / 3, d = R * 0.56; g.moveTo(c * d, s * d); g.lineTo(c * d + Math.cos(b) * R * 0.34, s * d + Math.sin(b) * R * 0.34); } }
    });
  } },
  { id: "moon", name: "Crescents", round: true, draw(g, u) {
    fillP(g, () => circ(g, 0, 0, u * 0.82));
    cut(g, () => circ(g, u * 0.36, -u * 0.22, u * 0.7));
  } },
  { id: "phases", name: "Moon phases", round: true, draw(g, u, h, ol, i) {
    const R = u * 0.7, ph = ((i || 0) % 8) / 8, s = ph <= 0.5 ? 1 : -1, cc = ph <= 0.5 ? 1 - 4 * ph : 4 * ph - 3, N = 36;
    strokeP(g, u * 0.11, () => circ(g, 0, 0, R - u * 0.055));
    fillP(g, () => {
      for (let k = 0; k <= N; k++) { const t = -Math.PI / 2 + k / N * Math.PI, x = s * R * Math.cos(t), y = R * Math.sin(t); k ? g.lineTo(x, y) : g.moveTo(x, y); }
      for (let k = N; k >= 0; k--) { const t = -Math.PI / 2 + k / N * Math.PI; g.lineTo(s * R * Math.cos(t) * cc, R * Math.sin(t)); }
      g.closePath();
    });
  } },
  { id: "note", name: "Notes", round: false, draw(g, u) {
    fillP(g, () => {
      ell(g, -u * 0.2, u * 1.05, u * 0.5, u * 0.35, -22 * D2R);
      g.rect(u * 0.14, -u * 1.45, u * 0.16, u * 2.45);
      g.moveTo(u * 0.3, -u * 1.45); g.bezierCurveTo(u * 0.36, -u * 0.95, u * 1.12, -u * 0.8, u * 0.8, -u * 0.02);
      g.bezierCurveTo(u * 0.88, -u * 0.62, u * 0.55, -u * 0.86, u * 0.3, -u * 0.92); g.closePath();
    });
  } },
  { id: "skull", name: "Skulls", round: false, draw(g, u) {
    fillP(g, () => { circ(g, 0, -u * 0.2, u * 0.72); rrect(g, -u * 0.42, u * 0.1, u * 0.84, u * 0.72, u * 0.14); });
    cut(g, () => { circ(g, -u * 0.27, -u * 0.12, u * 0.2); circ(g, u * 0.27, -u * 0.12, u * 0.2); poly(g, [[0, u * 0.14], [u * 0.1, u * 0.32], [-u * 0.1, u * 0.32]]); });
    cutLine(g, u * 0.08, () => { for (const x of [-0.14, 0, 0.14]) { g.moveTo(x * u, u * 0.56); g.lineTo(x * u, u * 0.86); } });
  } },
];
const MARKS_BY = {}; MARK_DEFS.forEach((m) => { MARKS_BY[m.id] = m; });

function drawMark(ctx, id, x, top, w, h, o) {
  o = o || {};
  const M = MARKS_BY[id];
  if (!M || !(w > 0) || !(h > 0)) return;
  const u = w, cx = x + w / 2, cy = top + h / 2, col = o.color || [0, 0, 0];
  const lw = o.lw > 0 ? o.lw : Math.max(1, u * 0.18), outline = !!o.outline;
  const T = ctx.getTransform(), sc = Math.sqrt(Math.abs(T.a * T.d - T.b * T.c)) || 1;
  const ew = u * 1.6 + lw * 2, eh = Math.max(h / 2, u * 1.6) + lw * 2;
  const box = deviceBox(T, cx - ew, cy - eh, cx + ew, cy + eh, ctx.canvas.width, ctx.canvas.height, 4);
  if (!box) return;
  const g = scratch("M", box.w, box.h);
  g.setTransform(T.a, T.b, T.c, T.d, T.e - box.x, T.f - box.y); g.translate(cx, cy);
  g.fillStyle = g.strokeStyle = rgba(col, 1);
  g.save(); M.draw(g, u, h, outline, o.i | 0, lw); g.restore();
  if (outline) {
    const d = Math.max(0.75, Math.min(lw, M.olw ? u * M.olw : lw) * sc);
    if (M.ol !== "self") erodeBand(g, box.w, box.h, d);
  }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(g.canvas, 0, 0, box.w, box.h, box.x, box.y, box.w, box.h);
  ctx.restore();
}

window.Glyphs = {
  SHAPES: SHAPE_DEFS.map(({ id, name, family, round }) => ({ id, name, family, round })),
  MARKS: MARK_DEFS.map(({ id, name, round }) => ({ id, name, round })),
  drawShape, drawMark,
};
})();
