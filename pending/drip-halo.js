/* ======================================================================
   PSYCH (prototype): banded fields. A smooth field is sampled on a coarse grid, then every pixel reads it
   bilinearly and is coloured by which band of a "sett" it falls in, anti-aliased by its distance to the
   nearest band edge (field difference / field gradient). Crisp at any size, two inks on a clear ground.
   ====================================================================== */
/* sett: [[ink, width], ...] with ink 0 = ground (clear), 1 = fg, 2 = fg2. */
function bandField(P, field, sett, gridPx) {
  screen(P, (g) => {
    const W = P.W, H = P.H, step = Math.max(2, gridPx || P.S / 160), nx = Math.ceil(W / step) + 2, ny = Math.ceil(H / step) + 2;
    const ca = Math.cos(-P.ang), sa = Math.sin(-P.ang), cx = P.cx, cy = P.cy, u = P.s;
    const v = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const X = i * step - cx, Y = j * step - cy;
      v[j * nx + i] = field((X * ca - Y * sa) / u, (X * sa + Y * ca) / u);   // field works in pattern units
    }
    const tot = sett.reduce((a, s) => a + s[1], 0), cuts = [], inks = [];
    let acc = 0; for (const [k, w] of sett) { cuts.push(acc / tot); inks.push(k); acc += w; }
    const n = sett.length, col = [[0, 0, 0, 0], [...P.fg, 255], [...P.fg2, 255]];
    const im = g.createImageData(W, H), d = im.data;
    for (let y = 0; y < H; y++) {
      const gy = y / step, j = Math.min(ny - 2, gy | 0), fy = gy - j;
      for (let x = 0; x < W; x++) {
        const gx = x / step, i = Math.min(nx - 2, gx | 0), fx = gx - i, o = j * nx + i;
        const a = v[o], b = v[o + 1], c = v[o + nx + 1], e = v[o + nx];
        const t = a + (b - a) * fx + (e - a) * fy + (a - b - e + c) * fx * fy;
        const tx = ((b - a) + (a - b - e + c) * fy) / step, ty = ((e - a) + (a - b - e + c) * fx) / step;
        const grad = Math.hypot(tx, ty) + 1e-9;
        let f = t - Math.floor(t), s = n - 1; for (let q = 1; q < n; q++) if (f < cuts[q]) { s = q - 1; break; }
        // distance (px) to this band's lower and upper edges; blend toward the nearer neighbour
        const lo = (f - cuts[s]) / grad, hi = ((s + 1 < n ? cuts[s + 1] : 1) - f) / grad;
        const near = lo < hi ? (s + n - 1) % n : (s + 1) % n, dist = Math.min(lo, hi);
        const w = dist >= 0.5 ? 1 : 0.5 + dist, A = col[inks[s]], B = col[inks[near]];
        const aa = A[3] * w + B[3] * (1 - w), q4 = (y * W + x) * 4;
        if (aa <= 0) continue;
        d[q4] = (A[0] * A[3] * w + B[0] * B[3] * (1 - w)) / aa; d[q4 + 1] = (A[1] * A[3] * w + B[1] * B[3] * (1 - w)) / aa;
        d[q4 + 2] = (A[2] * A[3] * w + B[2] * B[3] * (1 - w)) / aa; d[q4 + 3] = aa;
      }
    }
    const c = makeCanvas(W, H); c.getContext("2d").putImageData(im, 0, 0); g.drawImage(c, 0, 0); release(c);
  });
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

/* Nested-field raster for drip and halo. fill(x, y, out, o) writes N field values for one grid point (pattern
   units) at out[o + j], non-increasing in j; a pixel's band is the first j whose field is below 0 (N if none),
   so band j lies between the zero lines of field j-1 and field j. Each field is read bilinearly and every edge is
   anti-aliased by its own field's value / gradient, so edges stay crisp even where bands pinch thin. */
function dripRaster(P, N, fill, inks, gridPx) {
  screen(P, (g) => {
    const W = P.W, H = P.H, step = Math.max(1.5, gridPx || P.S / 200), nx = Math.ceil(W / step) + 2, ny = Math.ceil(H / step) + 2, nG = nx * ny;
    const ca = Math.cos(-P.ang), sa = Math.sin(-P.ang), cx = P.cx, cy = P.cy, u = P.s;
    const v = new Float32Array(nG * N), J = new Uint16Array(nG);
    for (let jy = 0; jy < ny; jy++) for (let ix = 0; ix < nx; ix++) {
      const X = ix * step - cx, Y = jy * step - cy, o = jy * nx + ix;
      fill((X * ca - Y * sa) / u, (X * sa + Y * ca) / u, v, o * N);
      let b = 0; while (b < N && v[o * N + b] >= 0) b++;
      J[o] = b;
    }
    const col = [[0, 0, 0, 0], [...P.fg, 255], [...P.fg2, 255]], im = g.createImageData(W, H), d = im.data;
    let fx = 0, fy = 0, o = 0, gx = 0, gy = 0;
    const at = (j) => {   // bilinear value of field j at the current pixel; leaves its gradient (per px) in gx, gy
      const q = o * N + j, a = v[q], b = v[q + N], e = v[q + nx * N], c = v[q + (nx + 1) * N], m = a - b - e + c;
      gx = ((b - a) + m * fy) / step; gy = ((e - a) + m * fx) / step;
      return a + (b - a) * fx + (e - a) * fy + m * fx * fy;
    };
    for (let y = 0; y < H; y++) {
      const ty = y / step, j0 = Math.min(ny - 2, ty | 0); fy = ty - j0;
      for (let x = 0; x < W; x++) {
        const tx = x / step, i0 = Math.min(nx - 2, tx | 0); fx = tx - i0; o = j0 * nx + i0;
        const A0 = J[o], A1 = J[o + 1], A2 = J[o + nx], A3 = J[o + nx + 1];
        const lo = Math.min(A0, A1, A2, A3), hi = Math.max(A0, A1, A2, A3);
        let b = hi; for (let j = lo; j < hi; j++) if (at(j) < 0) { b = j; break; }
        // distance (px) to the band's top edge (field b-1 = 0) and bottom edge (field b = 0)
        let dist = 1e9, nb = b;
        // (a field equal to its neighbour makes an empty band: blend across it to the next real one)
        if (b > 0) { const t = at(b - 1), dd = t / (Math.sqrt(gx * gx + gy * gy) + 1e-12); if (dd < dist) { dist = dd; nb = b - 1; while (nb > 0 && at(nb - 1) === t) nb--; } }
        if (b < N) { const t = at(b), dd = -t / (Math.sqrt(gx * gx + gy * gy) + 1e-12); if (dd < dist) { dist = dd; nb = b + 1; while (nb < N && at(nb) === t) nb++; } }
        const w = dist >= 0.5 ? 1 : 0.5 + Math.max(0, dist), A = col[inks(b)], B = col[inks(nb)];
        const aa = A[3] * w + B[3] * (1 - w), q4 = (y * W + x) * 4;
        if (aa <= 0) continue;
        d[q4] = (A[0] * A[3] * w + B[0] * B[3] * (1 - w)) / aa; d[q4 + 1] = (A[1] * A[3] * w + B[1] * B[3] * (1 - w)) / aa;
        d[q4 + 2] = (A[2] * A[3] * w + B[2] * B[3] * (1 - w)) / aa; d[q4 + 3] = aa;
      }
    }
    const c = makeCanvas(W, H); c.getContext("2d").putImageData(im, 0, 0); g.drawImage(c, 0, 0); release(c);
  });
}
/* polynomial smooth min: equals min(a, b) once they differ by k, never above it, rounds the join with radius ~k */
const dripSmin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };

/* Drip: stacked bands of paint, each running down in rounded drips. Layer j's paint is everything above its own
   wavy edge, plus its drips (capsules with a swollen tip, filleted into the edge), plus an echo of the paint
   above: that paint grown by a band and eased back toward layer j's own edge, and never less than a thin skin
   round it. So each band wraps the drips above it and the echoes soften into waves a few bands down, while new
   drips start (often in the same channel, so fingers nest). All distances and smooth mins: no creases or seams.
   For speed a drip is skipped where its echo must have faded below a quarter pixel (see D below). */
function drip(P) {
  const r = P.rnd, two = P.fg2.join() !== P.fg.join(), sc = 0.8 + r() * 0.5;
  const ink = (0.018 + r() * 0.014) * sc, gnd = ink * (0.7 + r() * 0.5);
  const cyc = two ? (r() < 0.5 ? [[1, ink], [0, gnd], [2, ink], [0, gnd]] : [[1, ink], [2, ink], [0, gnd * 1.3]]) : [[1, ink], [0, gnd]];
  const hold = 0.48, lam = 0.5 + r() * 0.22, density = 0.45 + r() * 0.5, longest = 0.25 + r() * 0.2, wob = 0.2 + r() * 0.5;
  const thMax = Math.max(...cyc.map((c) => c[1])), wa = (0.003 + r() * 0.006) * sc;
  // How far down a drip still shapes the bands below. Its lead over a band's plain edge shrinks each band: by
  // (1 - hold) × band while the skin carries it, then by the factor lam once the eased echo does. D(X) is the depth
  // by which a lead X has shrunk under eps (a quarter pixel), with 3 bands to spare; drips are skipped past it.
  const thMin = Math.min(...cyc.map((c) => c[1])), eps = 0.25 / P.s, dec = (1 - hold) * thMin, xc = dec / (1 - lam);
  const xc2 = (1 - hold) * thMax / (1 - lam);   // (the skin's loss over a depth is (1 - hold) × that depth, whatever the bands)
  const D = (X) => X <= eps ? 0 : Math.max(0, X - xc) / (1 - hold) + thMax * (Math.log(Math.min(X, xc2) / eps) / Math.log(1 / lam) + 3);
  // need[h] = h - (smallest lead that still reaches depth h)
  const HS = thMax / 4, Dmax = D(longest + 0.12), need = new Float64Array(Math.ceil(Dmax / HS) + 2);
  for (let i = 0; i < need.length; i++) { let lo = 0, hi = Dmax + 1; for (let t = 0; t < 40; t++) { const m = (lo + hi) / 2; if (D(m) >= i * HS) hi = m; else lo = m; } need[i] = i * HS - lo; }
  const ext = P.R / P.s + 0.1, top = -ext - Dmax - 0.1, layers = [];
  const N0 = perlin(P.seed + 5), N1 = perlin(P.seed + 6), ws = 0.6 + r() * 1.2;
  const BW = 0.06, nb = Math.ceil(2 * ext / BW) + 1, TS = 0.004, nt = Math.ceil(2 * ext / TS) + 2;
  // drips run in channels: a band often drips again right where the band above did, its drip reaching a little
  // further, so fingers nest inside fingers; channels stop at random and new ones start between them
  const rr = mulberry32((P.seed * 7919 + 13) | 0), wmin = 0.009 * sc, cont = 0.55 + r() * 0.35;
  let chans = [], trMax = 0, kfMax = 0, kfMin = 1;
  for (let y = top, j = 0; y < ext + 0.05; j++) {
    const [ik, th] = cyc[j % cyc.length];
    y += th;
    const bk = Array.from({ length: nb }, () => []), z = j * 0.37, ey = (x) => y + wa * N0(x * ws * 3, z);
    const edge = new Float32Array(nt); for (let i = 0; i < nt; i++) edge[i] = ey(i * TS - ext);
    const next = [], add = (x, w, L, tr) => {
      const e0 = ey(x) - w, e1 = e0 + L;
      const below = D(L + w + tr + 0.02), reach = tr + below;   // where it can still matter
      const dp = [x, e0, e1, w, tr, w * (1.2 + rr()), e1 + below];
      for (let q = Math.max(0, Math.floor((x - reach + ext) / BW)); q <= Math.min(nb - 1, Math.floor((x + reach + ext) / BW)); q++) bk[q].push(dp);
      next.push({ x, w, B: e1 + tr, tr });
    };
    for (const c of chans) {
      if (rr() > cont) continue;
      const x = c.x + (rr() - 0.5) * 0.01, w = Math.max(wmin, c.w * (0.8 + rr() * 0.35)), B = c.B + th * (0.4 + rr() * 0.9);
      const tr = w * (1 + rr() * 0.5), L = B - tr - (ey(x) - w);
      if (L > 0.02) add(x, w, L, tr);
    }
    for (let x = -ext - rr() * 0.12; x < ext; x += (0.05 + rr() * 0.22) / density) {
      if (rr() < 0.45 || next.some((c) => Math.abs(c.x - x) < c.w + 0.04)) continue;
      const w = wmin + rr() * rr() * 0.016 * sc + th * 0.1, L = 0.03 + Math.pow(rr(), 1.3) * longest * 0.75;
      add(x, w, L, w * (1 + rr() * 0.6));
    }
    chans = next;
    for (const ds of bk) for (const d of ds) { trMax = Math.max(trMax, d[4]); kfMax = Math.max(kfMax, d[5]); kfMin = Math.min(kfMin, d[5]); }
    const buckets = bk.map((ds) => (ds.sort((a, b) => a[0] - b[0]), { f: Float64Array.from(ds.flat()), hi: Math.max(-1e9, ...ds.map((d) => d[6])) }));
    layers.push({ y, th, gap: th * hold, k: th * 0.9, ik, buckets, edge, lo: y - wa - 0.05 });
  }
  // A layer no longer shapes a point once its edge is far above it (the soft-min's small offset from it has died
  // away) and none of its drips can reach the point. So a point's chain starts at the first layer that can:
  // per column, the deepest reach of the layers so far (non-decreasing, so a binary search finds it).
  const N = layers.length, far = 14 * thMax + 2 * wa + 0.01, ys = layers.map((l) => l.y);
  const reachTo = Array.from({ length: nb }, (_, q) => { let m = -1e9; return Float64Array.from(layers, (l) => (m = Math.max(m, l.buckets[q].hi, l.y + far))); });
  const inks = (b) => b === 0 ? 0 : layers[b - 1].ik;   // band b lies between edge b-1 and edge b
  // grid step: bilinear reading of a circle of radius r drifts by step² / 8r, so keep that near 0.3 px on the thinnest drip
  const grid = Math.max(1.5, Math.sqrt(2.4 * wmin * P.s)), stop = -Math.max(0.03, 4 * grid / P.s);   // well inside a paint: no grid neighbour reads further down
  dripRaster(P, N, (x0, y, out, o) => {
    const x = x0 + wob * 0.025 * sc * N1(x0 * 2, y * 5);
    const q = Math.max(0, Math.min(nb - 1, Math.floor((x + ext) / BW))), tx = Math.max(0, Math.min(nt - 1.001, (x + ext) / TS)), ti = tx | 0, tf = tx - ti;
    const RT = reachTo[q]; let s0 = 0, s1 = N; while (s0 < s1) { const m = (s0 + s1) >> 1; if (RT[m] <= y) s0 = m + 1; else s1 = m; }
    for (let j = 0; j < s0; j++) out[o + j] = y - ys[j];
    let prev = 0;
    for (let j = s0; j < N; j++) {
      const L = layers[j], h = y - (L.edge[ti] * (1 - tf) + L.edge[ti + 1] * tf), B = L.buckets[q];
      let dj = h;
      if (y > L.lo && y < B.hi) {
        // only drips within rx sideways can pass the test below; they are sorted by x, so find the first one
        const f = B.f, xm = h < 0 ? 0 : Math.max(0, h - need[Math.min(need.length - 1, Math.ceil(h / HS))]);
        const rx = trMax + Math.min(h + kfMax, Math.max(h - xm, h + kfMax - 2 * Math.sqrt(kfMax * xm), h + kfMin - 2 * Math.sqrt(kfMin * xm)));
        let i0 = 0, i1 = f.length / 7; while (i0 < i1) { const m = (i0 + i1) >> 1; if (f[m * 7] < x - rx) i0 = m + 1; else i1 = m; }
        for (let i = i0 * 7; i < f.length && f[i] <= x + rx; i += 7) {
          const e1 = f[i + 2], tr = f[i + 4], kf = f[i + 5], ax = Math.abs(x - f[i]), lb = (ax > y - e1 ? ax : y - e1) - tr;
          // skip it if it can't move this edge and its lead (counting the fillet's pull) is too small to reach below
          const g = h - lb; if (lb > dj + kf || (g >= 0 ? g < xm : (kf + g) * (kf + g) < 4 * kf * xm)) continue;
          const e0 = f[i + 1], w = f[i + 3], cy = y - Math.max(e0, Math.min(e1, y)), by = y - e1;
          dj = dripSmin(dj, dripSmin(Math.sqrt(ax * ax + cy * cy) - w, Math.sqrt(ax * ax + by * by) - tr, w * 0.8), kf);
        }
      }
      // the band wraps the paint above (grown by a full band, then eased back toward its own edge, so an echo
      // fades out over a few bands), and always holds at least a thin skin round it
      if (j > s0) {
        const e = dj + lam * (prev - L.th - dj), k = L.k, u = k - Math.abs(dj - e), a = u > 0 ? Math.min(dj, e) - u * u / (4 * k) : Math.min(dj, e);
        const b = prev - L.gap, kg = L.gap, v = kg - Math.abs(a - b);
        dj = v > 0 ? Math.min(a, b) - v * v / (4 * kg) : Math.min(a, b);
      }
      out[o + j] = prev = dj;
      if (dj < stop) { for (let m = j + 1; m < N; m++) out[o + m] = dj - (m - j); break; }
    }
  }, inks, grid);
}

/* Halo: rounded blobs (a few circles melted together), each ringed by 2–5 even outlines that end in clear ground
   before the next group. Inside a group the field is a soft-min of circle distances, so the blob is smooth and its
   rings keep one width; between groups it is a plain min, and groups are spaced so that seam lies in clear ground.
   Small groups dropped into the gaps get fewer rings: their outer cuts collapse onto their last ring. */
function halo(P) {
  const r = P.rnd, two = P.fg2.join() !== P.fg.join(), sc = 0.85 + r() * 0.4;
  const rings = 2 + ((r() * 4) | 0), rw = (0.009 + r() * 0.007) * sc, rg = rw * (0.6 + r() * 0.7);
  // bands outward from the blob edge: core, then [gap, ring] × rings, then ground; ringEnd[n] = cut index after ring n
  const cuts = [0], inks = [two && r() < 0.4 ? 2 : 1], ringEnd = [0], stack = two && r() < 0.35;
  for (let i = 0; i < rings; i++) {
    const ink = two ? (inks[0] === 1) === (i % 2 === 0) ? 2 : 1 : 1;
    if (!(stack && i % 2 === 1)) { inks.push(0); cuts.push(cuts[cuts.length - 1] + rg); }   // stacked pairs touch
    inks.push(ink); cuts.push(cuts[cuts.length - 1] + rw); ringEnd.push(cuts.length - 1);
  }
  inks.push(0);
  const N = cuts.length, Z = cuts[N - 1], ext = P.R / P.s + Z + 0.15, clear = rg * (0.6 + r() * 1.0) + 0.003;
  const groups = [], C = 0.2, cell = new Map(), key = (i, j) => i * 4096 + j;
  const rmax = (0.032 + r() * 0.035) * sc, rmin = 0.011 * sc, lobes = 1 + r() * 4;
  // dart-throw groups, big first, then smaller ones with fewer rings into the gaps; circles of different groups
  // must keep their ring zones (pad) plus a clear gap apart. Placed circles go in every hash cell they cover.
  const T = Math.round(16000 * ext * ext), M = 0.03 + 2 * Z, CC = 0.08, circ = new Map();
  const free = (x, y, rr, pad) => {
    const q = rr + pad + clear;
    for (let i = Math.floor((x - q) / CC); i <= Math.floor((x + q) / CC); i++) for (let j = Math.floor((y - q) / CC); j <= Math.floor((y + q) / CC); j++)
      for (const c of circ.get(key(i, j)) || []) { const m = rr + c[2] + pad + c[3] + clear; if ((x - c[0]) ** 2 + (y - c[1]) ** 2 < m * m) return false; }
    return true;
  };
  for (let t = 0; t < T; t++) {
    const f = t / T, r0 = rmax - (rmax - rmin) * Math.sqrt(f) * (0.7 + r() * 0.3), gx = (r() * 2 - 1) * ext, gy = (r() * 2 - 1) * ext;
    const nr = Math.max(2, Math.min(rings, f < 0.3 ? rings : Math.round(rings * (0.3 + r() * 0.7)))), zg = cuts[ringEnd[nr]];
    if (!free(gx, gy, r0, zg)) continue;   // cheap early out: the main circle alone
    const cs = [[gx, gy, r0]], n = r0 > rmin * 1.8 ? Math.round(lobes * (0.5 + r() * 0.7)) : 0;
    for (let s = 0, a = r() * TAU; s < n; s++, a += 1.2 + r() * 2.5) {
      const [bx, by, br] = cs[(r() * cs.length) | 0], rr = br * (0.45 + r() * 0.4), dd = br * (0.85 + r() * 0.55);
      cs.push([bx + Math.cos(a) * dd, by + Math.sin(a) * dd, rr]);
    }
    const k = Math.min(0.3 * r0, 0.4 * Z), pad = zg + k * Math.log(cs.length);
    if (!cs.every(([x, y, rr]) => free(x, y, rr, pad))) continue;
    let reach = 0;
    for (const [x, y, rr] of cs) {
      reach = Math.max(reach, Math.hypot(x - gx, y - gy) + rr + pad);
      const q = rr + pad, c = [x, y, rr, pad];
      for (let i = Math.floor((x - q) / CC); i <= Math.floor((x + q) / CC); i++) for (let j = Math.floor((y - q) / CC); j <= Math.floor((y + q) / CC); j++) {
        const kk = key(i, j); if (!circ.has(kk)) circ.set(kk, []); circ.get(kk).push(c);
      }
    }
    // registered in every cell its reach (plus a margin, so the plain-min seam is far from any edge) touches
    const G = { x: gx, y: gy, reach, cs, k, end: ringEnd[nr] }; groups.push(G);
    for (let i = Math.floor((gx - reach - M) / C); i <= Math.floor((gx + reach + M) / C); i++) for (let j = Math.floor((gy - reach - M) / C); j <= Math.floor((gy + reach + M) / C); j++) {
      const kk = key(i, j); if (!cell.has(kk)) cell.set(kk, []); cell.get(kk).push(G);
    }
  }
  const big = 1e3;
  // grid step: keeps bilinear drift on the smallest core (radius rmin) near 0.3 px
  dripRaster(P, N, (x, y, out, o) => {
    for (let i = 0; i < N; i++) out[o + i] = big - i;
    for (const G of cell.get(key(Math.floor(x / C), Math.floor(y / C))) || []) {
      const dx = G.x - x, dy = G.y - y; if (dx * dx + dy * dy > (G.reach + M) ** 2) continue;
      let s = 0; const k = G.k;
      for (const [px, py, rr] of G.cs) s += Math.exp(-(Math.sqrt((x - px) ** 2 + (y - py) ** 2) - rr) / k);
      const d = -k * Math.log(s);
      for (let i = 0; i < N; i++) { const v = d - cuts[Math.min(i, G.end)]; if (v < out[o + i]) out[o + i] = v; }
    }
  }, (b) => inks[b], Math.max(1.5, Math.sqrt(2.4 * rmin * P.s)));
}
