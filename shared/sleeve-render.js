/* Sleeve Press: the front-sleeve renderer, shared by Sleeve, Tracklist, Palette Pull, Desk and Kit.
   flatten(db) merges the release record into the flat state the renderer reads.
   Defaults reproduce the original "Nine Night" sleeve; every position, face and layer is a setting. */
(function () {
"use strict";
const { hexToRgb, rgba, lum } = SP;

const SLEEVE_DEFAULTS = {
  // texture + border
  grain: 28, vignette: 55, frame: true, frameStyle: "hairline", frameInset: 4.5, frameWidth: 100, frameOpacity: 14, frameColor: "ink",
  // backdrop layers
  wash: "none", washAmt: 45, shape: "none", shapeAmt: 85, shapeSize: 55, shapeX: 70, shapeY: 38, shapeColor: "accent", shapeOutline: false, shapeRot: 0,
  // pattern layer (shared/patterns.js): where it sits, how loud, which colours
  pattern: "none", patternAmt: 35, patternScale: 100, patternAngle: 0, patternArea: "full", patternPos: 50, patternColor: "ink", patternSeed: 1,
  texture: "none", textureAmt: 45,
  // layout
  align: "left", margin: 11, artistY: 15.8, motifY: 20.6, footerY: 92.2, footerPos: "bottom",
  // motif
  motifKind: "bars", count: 9, missing: 9, missingStyle: "outline", motifSize: 100, motifPitch: 100,
  // type
  font: "Archivo", bodyFont: "", titleSize: 100, tracking: -1, leading: 88.5, titleCase: "upper", titlePos: "centre", titleDy: 0, titleAccent: false,
  artistSize: 100, artistTrack: 32, footerSize: 100, footerTrack: 25,
  // per-element type ("" follows the global value)
  titleAlign: "", titleX: 0, titleStyle: "solid", titleColor: "ink",
  artistFont: "", artistCase: "upper", artistColor: "ink", artistAlign: "", artistX: 0, artistRotate: "none", artistWeight: 700,
  footerAlign: "", footerX: 0, footerColor: "ink", footerOpacity: 58, footerCase: "upper",
  motifAlign: "", motifX: 0,
  // image
  imgMode: "bleed", imgTone: "ink", imgBoxX: 0, imgBoxY: 0, imgBoxSize: 100, dim: 60, zoom: 100, shiftX: 0, shiftY: 0, imgBlur: 0, imgContrast: 100, imgPosterize: 0,
  // record label mark (name from release.label, logo is a separate shared image)
  labelMark: "none", labelX: 86, labelY: 90.5, labelSize: 100, labelColor: "ink", labelOpacity: 85, logoMode: "tint",
  // catalogue
  plate: false, platePos: "tr", plateText: "", barcode: false, barcodeDigits: "", barcodeStyle: "box", barcodeSize: 100,
  exportSize: "3000",
};
const RELEASE_KEYS = ["artist", "title", "footer", "catalog", "year", "label"];
const PALETTE_KEYS = ["bg", "ink", "accent"];

function flatten(db) {
  const s = { ...SLEEVE_DEFAULTS };
  for (const k of Object.keys(SLEEVE_DEFAULTS)) if (k in db.sleeve && typeof db.sleeve[k] === typeof SLEEVE_DEFAULTS[k]) s[k] = db.sleeve[k];
  for (const k of RELEASE_KEYS) s[k] = db.release[k] ?? "";
  for (const k of PALETTE_KEYS) s[k] = db.palette[k];
  return s;
}
/* The look: everything but words, image placement and export size. */
const LOOK_KEYS = Object.keys(SLEEVE_DEFAULTS).filter(k => !["plateText", "barcodeDigits", "exportSize", "zoom", "shiftX", "shiftY"].includes(k));
/* The palette is part of a look too. */
const lookOf = (st) => { const o = {}; for (const k of LOOK_KEYS) o[k] = st[k]; o.bg = st.bg; o.ink = st.ink; o.accent = st.accent; if (st.paletteName) o.paletteName = st.paletteName; return o; };

/* ---------- fonts ---------- */
const fontReady = {};
const fontInfo = (face) => (window.Looks && Looks.FONT[face]) || { n: face, w: [600, 700] };
function loadFont(face) {
  if (!fontReady[face]) fontReady[face] = Promise.all(fontInfo(face).w.map(w => document.fonts.load(`${w} 100px "${face}"`))).catch(() => {});
  return fontReady[face];
}
const loadFonts = (st) => Promise.all([loadFont(st.font), loadFont(st.bodyFont || st.font), loadFont(st.artistFont || st.bodyFont || st.font)]);
/* Nearest weight the face actually has, so the browser never fakes a bold. */
function weightFor(face, want) {
  const ws = fontInfo(face).w; want = Number(want);
  return String(ws.reduce((a, b) => Math.abs(b - want) < Math.abs(a - want) ? b : a, ws[0]));
}
const faceStack = (f) => `"${f}", "Helvetica Neue", Arial, sans-serif`;

/* ---------- tracked text ---------- */
function drawTracked(ctx, text, x, y, trackEm, size, stroke) {
  const track = trackEm * size; let cx = x;
  for (const ch of text) { if (stroke) ctx.strokeText(ch, cx, y); else ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + track; }
  return cx - x - track;
}
function measureTracked(ctx, text, trackEm, size) {
  let w = 0, n = 0;
  for (const ch of text) { w += ctx.measureText(ch).width; n++; }
  return w + Math.max(0, n - 1) * trackEm * size;
}
function applyCase(t, mode) {
  if (mode === "asis") return t;
  if (mode === "lower") return t.toLowerCase();
  if (mode === "title") return t.toLowerCase().replace(/(^|[\s\-("'])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  return t.toUpperCase();
}

/* ---------- image toning ---------- */
const imageIds = new WeakMap(); let imageSeq = 0;
let tonedCache = { key: null, canvas: null };
function toned(image, state) {
  if (!image) return null;
  if (!imageIds.has(image)) imageIds.set(image, ++imageSeq);
  const blur = state.imgBlur || 0, con = state.imgContrast ?? 100, post = state.imgPosterize || 0;
  const key = [imageIds.get(image), state.imgTone, state.bg, state.ink, state.accent, blur, con, post].join("|");
  if (tonedCache.key === key) return tonedCache.canvas;
  const cap = 2400;
  const iw = image.naturalWidth || image.width, ih = image.naturalHeight || image.height;
  const s = Math.min(1, cap / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * s)), h = Math.max(1, Math.round(ih * s));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  const filters = [];
  if (blur > 0) filters.push(`blur(${(blur / 100) * Math.max(w, h) * 0.02}px)`);
  if (con !== 100) filters.push(`contrast(${con}%)`);
  if (filters.length && "filter" in g) g.filter = filters.join(" ");
  g.drawImage(image, 0, 0, w, h);
  g.filter = "none";
  const lv = post >= 2 ? post : 0;
  const q = (t) => lv ? Math.round(t * (lv - 1)) / (lv - 1) : t;
  if (state.imgTone !== "original" || lv) {
    const id = g.getImageData(0, 0, w, h); const d = id.data;
    if (state.imgTone !== "original") {
      const a = hexToRgb(state.bg), b = hexToRgb(state.imgTone === "accent" ? state.accent : state.ink);
      // Dark end is whichever of the two is darker, so a light sleeve tones correctly too.
      const [dark, light] = lum(a) <= lum(b) ? [a, b] : [b, a];
      for (let i = 0; i < d.length; i += 4) {
        let t = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        t = q(Math.min(1, Math.max(0, (t - 0.08) / 0.84)));
        d[i] = dark[0] + (light[0] - dark[0]) * t;
        d[i + 1] = dark[1] + (light[1] - dark[1]) * t;
        d[i + 2] = dark[2] + (light[2] - dark[2]) * t;
      }
    } else {
      for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) d[i + k] = q(d[i + k] / 255) * 255;
    }
    g.putImageData(id, 0, 0);
  }
  tonedCache = { key, canvas: c };
  return c;
}
/* Fills (x,y,w,h) with the image: zoom 100 covers the box, below 100 it floats smaller on the ground.
   shiftX/shiftY move it by a share of the box, so dragging feels the same at every zoom. */
function drawCover(ctx, img, x, y, w, h, state, clipPath) {
  const zoom = (state.zoom ?? 100) / 100;
  const scale = Math.max(w / img.width, h / img.height) * zoom;
  const dw = img.width * scale, dh = img.height * scale;
  const dx = x + (w - dw) / 2 + ((state.shiftX || 0) / 100) * w;
  const dy = y + (h - dh) / 2 + ((state.shiftY || 0) / 100) * h;
  ctx.save(); ctx.beginPath();
  if (clipPath) clipPath(ctx); else ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
}
/* Where the picture sits for each placement, in sleeve units. */
const IMG_MODES = ["bleed", "panel", "band", "circle", "split", "inset", "top", "arch"];
function imageBox(st, S) {
  const k = (st.imgBoxSize ?? 100) / 100, ox = S * (st.imgBoxX || 0) / 100, oy = S * (st.imgBoxY || 0) / 100;
  const box = (cx, cy, w, h, shape) => ({ x: cx - w * k / 2 + ox, y: cy - h * k / 2 + oy, w: w * k, h: h * k, shape });
  switch (st.imgMode) {
    case "panel": return box(S * 0.705, S * 0.295, S * 0.37, S * 0.37);
    case "band": return box(S * 0.5, S * 0.525, S * 1.0, S * 0.47);
    case "circle": return box(S * 0.5, S * 0.42, S * 0.56, S * 0.56, "circle");
    case "split": return box(S * 0.25, S * 0.5, S * 0.5, S * 1.0);
    case "inset": return box(S * 0.5, S * 0.42, S * 0.62, S * 0.62);
    case "top": return box(S * 0.5, S * 0.3, S * 1.0, S * 0.6);
    case "arch": return box(S * 0.5, S * 0.44, S * 0.52, S * 0.68, "arch");
    default: return box(S * 0.5, S * 0.5, S, S);
  }
}
function boxPath(b) {
  return (ctx) => {
    if (b.shape === "circle") ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
    else if (b.shape === "arch") { const r = b.w / 2; ctx.moveTo(b.x, b.y + b.h); ctx.lineTo(b.x, b.y + r); ctx.arc(b.x + r, b.y + r, r, Math.PI, 0); ctx.lineTo(b.x + b.w, b.y + b.h); ctx.closePath(); }
    else ctx.rect(b.x, b.y, b.w, b.h);
  };
}

/* ---------- EAN-13 ---------- */
const EAN_L = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
const EAN_G = ["0100111","0110011","0011011","0100001","0011101","0111001","0000101","0010001","0001001","0010111"];
const EAN_R = ["1110010","1100110","1101100","1000010","1011100","1001110","1010000","1000100","1001000","1110100"];
const EAN_PARITY = ["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"];
function eanCheck(d12) {
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(d12[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - s % 10) % 10);
}
function digitsFromText(text) {
  // Deterministic 12 digits from any string: UK-style 50 prefix plus ten hashed digits.
  let h1 = 5381, h2 = 52711;
  for (const ch of text) { const c = ch.codePointAt(0); h1 = (h1 * 33 ^ c) >>> 0; h2 = (h2 * 31 + c) >>> 0; }
  const s = String(h1).padStart(10, "0") + String(h2).padStart(10, "0");
  return "50" + s.slice(0, 10);
}
function eanDigits(state) {
  let d = (state.barcodeDigits || "").replace(/\D/g, "");
  if (d.length !== 12 && d.length !== 13) d = digitsFromText(state.catalog || state.title || state.artist || "sleeve");
  d = d.slice(0, 12);
  return d + eanCheck(d);
}
function eanModules(d13) {
  const parity = EAN_PARITY[Number(d13[0])];
  let bits = "101";
  for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === "L" ? EAN_L : EAN_G)[Number(d13[i])];
  bits += "01010";
  for (let i = 7; i <= 12; i++) bits += EAN_R[Number(d13[i])];
  return bits + "101"; // 95 modules
}
const barcodeWidth = (S, st) => (S * 0.00165 * 95 + S * 0.022 + S * 0.00165 * 9) * ((st && st.barcodeSize) || 100) / 100;
/* Barcode styles: box (dark bars on a light box), clear (ink bars straight on the ground),
   spot (spot-colour bars on the ground), spotbox (bars on a spot-colour box). Scanners want dark on light. */
function barcodeColours(style, bg, ink, spot) {
  const darker = (a, b) => lum(a) <= lum(b) ? a : b, lighter = (a, b) => lum(a) > lum(b) ? a : b;
  if (style === "clear") return [null, ink];
  if (style === "spot") return [null, spot];
  if (style === "spotbox") return [spot, SP.contrast(bg, spot) >= SP.contrast(ink, spot) ? bg : ink];
  return [lighter(ink, bg), darker(ink, bg)];
}
/* True when a style would print light bars on a darker ground (looks fine, may not scan). */
function barcodeReversed(st) {
  const bg = hexToRgb(st.bg), ink = hexToRgb(st.ink), spot = hexToRgb(st.accent);
  const [box, bar] = barcodeColours(st.barcodeStyle, bg, ink, spot);
  return lum(bar) > lum(box || bg) + 0.05;
}
// Draws the barcode block with its right edge at `right` and bottom edge at `bottom`; returns its top.
function drawBarcode(ctx, S0, right, bottom, face, bg, ink, state, spot) {
  const S = S0 * ((state.barcodeSize || 100) / 100);
  const d13 = eanDigits(state);
  const bits = eanModules(d13);
  const [box, bar] = barcodeColours(state.barcodeStyle, bg, ink, spot || ink);
  const module = S * 0.00165;
  const barW = module * 95;
  const barH = S * 0.058;
  const digitSize = S * 0.0135;
  const padX = S * 0.011, padY = S * 0.009;
  const w = barW + padX * 2 + module * 9;
  const h = barH + digitSize * 1.15 + padY * 2;
  const x0 = right - w, y0 = bottom - h;
  if (box) { ctx.fillStyle = rgba(box, 1); ctx.fillRect(x0, y0, w, h); }
  const bx = x0 + padX + module * 9, by = y0 + padY;
  ctx.fillStyle = rgba(bar, 1);
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] !== "1") continue;
    const guard = i < 3 || (i >= 45 && i < 50) || i >= 92;
    ctx.fillRect(bx + i * module, by, module, barH + (guard ? digitSize * 0.55 : 0));
  }
  const bf = state.bodyFont || state.font;
  ctx.font = `${weightFor(bf, "600")} ${digitSize}px ${face}`;
  ctx.textBaseline = "alphabetic";
  const ty = by + barH + digitSize * 1.0;
  ctx.fillText(d13[0], x0 + padX, ty);
  const groupW = module * 42;
  const drawGroup = (txt, gx) => {
    const gap = (groupW - measureTracked(ctx, txt, 0, digitSize)) / 5;
    let cx = gx + module * 0.5;
    for (const ch of txt) { ctx.fillText(ch, cx, ty); cx += ctx.measureText(ch).width + gap; }
  };
  drawGroup(d13.slice(1, 7), bx + module * 3);
  drawGroup(d13.slice(7, 13), bx + module * 50);
  return y0;
}
function drawPlate(ctx, S, right, anchorY, anchor, face, ink, state) {
  const text = ((state.plateText || "").trim() || state.catalog || "").toUpperCase();
  if (!text) return null;
  const fs = S * 0.016;
  ctx.font = `${weightFor(state.bodyFont || state.font, "600")} ${fs}px ${face}`;
  const tw = measureTracked(ctx, text, 0.22, fs);
  const padX = S * 0.012, padY = S * 0.0085;
  const w = tw + padX * 2, h = fs * 0.72 + padY * 2;
  const x0 = right - w;
  const y0 = anchor === "top" ? anchorY : anchorY - h;
  ctx.strokeStyle = rgba(ink, 0.5); ctx.lineWidth = Math.max(1, S * 0.00125);
  ctx.strokeRect(x0, y0, w, h);
  ctx.fillStyle = rgba(ink, 0.88);
  drawTracked(ctx, text, x0 + padX, y0 + padY + fs * 0.72, 0.22, fs);
  return { x: x0, y: y0, w, h };
}

/* ---------- grain: a seeded tile, so the same release renders identically every time ---------- */
let grainTile = null;
function grainCanvas() {
  if (grainTile) return grainTile;
  const rnd = SP.mulberry32(0x5EEDED);
  const n = 256, c = document.createElement("canvas"); c.width = c.height = n;
  const g = c.getContext("2d"); const id = g.createImageData(n, n); const d = id.data;
  for (let i = 0; i < d.length; i += 4) { const v = 128 + (rnd() - 0.5) * 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  g.putImageData(id, 0, 0); grainTile = c; return c;
}
function applyGrain(ctx, W, H, amount, S) {
  if (amount <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = (amount / 100) * 0.55;
  const tile = grainCanvas(); const n = Math.round(S / 6);
  for (let y = 0; y < H; y += n) for (let x = 0; x < W; x += n) ctx.drawImage(tile, x, y, n, n);
  ctx.restore();
}
function applyVignette(ctx, W, H, state, bg, ink) {
  if (state.vignette <= 0) return;
  const v = state.vignette / 100;
  const g = ctx.createRadialGradient(W * 0.5, H * 0.45, W * 0.1, W * 0.5, H * 0.5, Math.max(W, H) * 0.78);
  g.addColorStop(0, rgba(ink, 0.05 * v));
  g.addColorStop(0.55, rgba(bg, 0));
  g.addColorStop(1, `rgba(0,0,0,${0.42 * v})`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}

/* ---------- pattern layer ---------- */
/* Where the pattern is allowed: a path builder, or null for the whole sleeve. */
function patternClip(st, W, H) {
  const S = Math.min(W, H), p = (st.patternPos ?? 50) / 100;
  switch (st.patternArea) {
    case "band": { const h = H * 0.26; return (c) => c.rect(0, H * p - h / 2, W, h); }
    case "top": return (c) => c.rect(0, 0, W, H * p);
    case "bottom": return (c) => c.rect(0, H * p, W, H * (1 - p));
    case "left": return (c) => c.rect(0, 0, W * p, H);
    case "right": return (c) => c.rect(W * p, 0, W * (1 - p), H);
    case "edge": { const e = S * 0.07; return (c) => { c.rect(0, 0, W, H); c.rect(e, H - e, W - e * 2, -(H - e * 2)); }; }   // a border made of pattern (inner rect wound backwards)
    default: return null;
  }
}
function drawPattern(ctx, W, H, st, bg, ink, spot, k, clip, bgOverride) {
  const fg = st.patternColor === "accent" ? spot : ink, fg2 = st.patternColor === "duo" ? (fg === ink ? spot : ink) : fg;
  ctx.save();
  if (clip) { ctx.beginPath(); clip(ctx); ctx.clip("evenodd"); }
  try {
    Patterns.draw(ctx, W, H, st.pattern, { S: Math.min(W, H), scale: st.patternScale, angle: st.patternAngle, fg, fg2, bg: bgOverride || bg,
      alpha: Math.min(1, (st.patternAmt / 100) * k), seed: st.patternSeed || 1 });
  } catch (e) { console.error(e); }
  ctx.restore();
}
/* The big shape: the built-in five, or any of shared/glyphs.js's shapes. */
function drawShape(ctx, st, cx, cy, r, col, a, col2, bg, S) {
  const legacy = ["circle", "ring", "square", "half", "bars"].includes(st.shape);
  if (window.Glyphs && (!legacy || st.shapeOutline || st.shapeRot)) {
    try { Glyphs.drawShape(ctx, st.shape, cx, cy, r, { color: col, color2: col2, bg, alpha: a, seed: st.patternSeed || 1, outline: !!st.shapeOutline, lw: Math.max(1, S * 0.006), rot: st.shapeRot || 0 }); return; }
    catch (e) { if (!legacy) { console.error(e); return; } }
  }
  ctx.save(); ctx.fillStyle = rgba(col, a); ctx.strokeStyle = rgba(col, a);
  ctx.beginPath();
  if (st.shape === "circle") { ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); }
  else if (st.shape === "ring") { ctx.lineWidth = r * 0.16; ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2); ctx.stroke(); }
  else if (st.shape === "square") { ctx.fillRect(cx - r, cy - r, r * 2, r * 2); }
  else if (st.shape === "half") { ctx.arc(cx, cy, r, Math.PI, 0); ctx.closePath(); ctx.fill(); }
  else if (st.shape === "bars") { const n = 7, bw = (r * 2) / (n * 2 - 1); for (let i = 0; i < n; i++) ctx.fillRect(cx - r + i * bw * 2, cy - r, bw, r * 2); }
  ctx.restore();
}

/* ---------- backdrop: wash, big shape, texture. `k` scales strength (the back sleeve uses less). ---------- */
function drawBackdrop(ctx, W, H, st, bg, ink, spot, k = 1) {
  const S = Math.min(W, H);
  if (st.wash && st.wash !== "none" && st.washAmt > 0) {
    const a = (st.washAmt / 100) * 0.9 * k; let g;
    if (st.wash === "top") g = ctx.createLinearGradient(0, 0, 0, H);
    else if (st.wash === "bottom") g = ctx.createLinearGradient(0, H, 0, 0);
    else if (st.wash === "diagonal") g = ctx.createLinearGradient(W, 0, 0, H);
    else g = ctx.createRadialGradient(W * st.shapeX / 100, H * st.shapeY / 100, 0, W * st.shapeX / 100, H * st.shapeY / 100, Math.max(W, H) * 0.75);
    g.addColorStop(0, rgba(spot, a)); g.addColorStop(1, rgba(spot, 0));
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  const hasShape = st.shape && st.shape !== "none" && st.shapeAmt > 0;
  const hasPattern = st.pattern && st.pattern !== "none" && st.patternAmt > 0 && window.Patterns;
  if (hasPattern && st.patternArea !== "shape") drawPattern(ctx, W, H, st, bg, ink, spot, k, patternClip(st, W, H));
  if (hasShape) {
    const col = st.shapeColor === "ink" ? ink : spot, a = (st.shapeAmt / 100) * k;
    const cx = W * st.shapeX / 100, cy = H * st.shapeY / 100, r = S * st.shapeSize / 200;
    const shapeAt = (c, alpha, c2) => drawShape(ctx, st, cx, cy, r, c, alpha, c2 || (c === ink ? spot : ink), bg, S);
    if (hasPattern && st.patternArea === "shape") {
      // the pattern lives inside the shape's silhouette
      shapeAt(col, a);
      const m = document.createElement("canvas"); m.width = Math.ceil(W); m.height = Math.ceil(H);
      const mc = m.getContext("2d");
      drawShape(mc, { ...st, shapeOutline: false }, cx, cy, r, [0, 0, 0], 1, [0, 0, 0], bg, S);
      mc.globalCompositeOperation = "source-in";
      drawPattern(mc, W, H, st, bg, col === ink ? spot : ink, col === ink ? spot : ink, k / Math.max(0.2, st.patternAmt / 100) * 0.9, null, bg);
      ctx.save(); ctx.globalAlpha = Math.min(1, (st.patternAmt / 100) * 1.4); ctx.drawImage(m, 0, 0); ctx.restore();
    } else shapeAt(col, a);
  }
  if (st.texture && st.texture !== "none" && st.textureAmt > 0) {
    const a = (st.textureAmt / 100) * k; ctx.save();
    if (st.texture === "halftone") {
      const p = S * 0.014; ctx.fillStyle = rgba(ink, 0.22 * a);
      for (let y = p / 2, row = 0; y < H; y += p, row++) {
        const t = y / H, rr = p * 0.48 * Math.pow(t, 1.6);
        if (rr < 0.4) continue;
        for (let x = (row % 2 ? p : p / 2); x < W; x += p) { ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill(); }
      }
    } else {
      const p = S * (st.texture === "grid" ? 0.025 : 0.0065); ctx.strokeStyle = rgba(ink, 0.09 * a); ctx.lineWidth = Math.max(1, S * 0.0008);
      ctx.beginPath();
      for (let y = 0; y < H; y += p) { ctx.moveTo(0, y); ctx.lineTo(W, y); }
      if (st.texture === "grid") for (let x = 0; x < W; x += p) { ctx.moveTo(x, 0); ctx.lineTo(x, H); }
      ctx.stroke();
    }
    ctx.restore();
  }
}

/* ---------- border ---------- */
function drawFrame(ctx, W, H, st, ink, spot) {
  if (!st.frame) return;
  const S = Math.min(W, H), inset = S * st.frameInset / 100, col = st.frameColor === "accent" ? spot : ink;
  let lw = Math.max(1, S * 0.00125 * st.frameWidth / 100);
  ctx.save(); ctx.strokeStyle = rgba(col, st.frameOpacity / 100); ctx.lineWidth = lw;
  const box = (d) => ctx.strokeRect(inset + d, inset + d, W - (inset + d) * 2, H - (inset + d) * 2);
  switch (st.frameStyle) {
    case "double": box(0); box(lw * 4 + S * 0.004); break;
    case "thick": ctx.lineWidth = lw * 5; box(lw * 2.5); break;
    case "dashed": ctx.setLineDash([S * 0.012, S * 0.008]); box(0); break;
    case "inset": ctx.lineWidth = lw * 3; box(0); ctx.lineWidth = lw; box(S * 0.014); break;
    case "round": { ctx.beginPath(); const r = S * 0.035; if (ctx.roundRect) ctx.roundRect(inset, inset, W - inset * 2, H - inset * 2, r); else ctx.rect(inset, inset, W - inset * 2, H - inset * 2); ctx.stroke(); break; }
    case "corners": case "crop": {
      const L = S * 0.055, o = st.frameStyle === "crop" ? S * 0.012 : 0; ctx.lineWidth = lw * (st.frameStyle === "corners" ? 2 : 1);
      ctx.beginPath();
      for (const [x, y, dx, dy] of [[inset, inset, 1, 1], [W - inset, inset, -1, 1], [inset, H - inset, 1, -1], [W - inset, H - inset, -1, -1]]) {
        if (o) { ctx.moveTo(x - dx * o, y); ctx.lineTo(x - dx * (o + L), y); ctx.moveTo(x, y - dy * o); ctx.lineTo(x, y - dy * (o + L)); }
        else { ctx.moveTo(x, y + dy * L); ctx.lineTo(x, y); ctx.lineTo(x + dx * L, y); }
      }
      ctx.stroke(); break;
    }
    case "rules": { ctx.lineWidth = lw * 2; ctx.beginPath(); ctx.moveTo(inset, inset); ctx.lineTo(W - inset, inset); ctx.moveTo(inset, H - inset); ctx.lineTo(W - inset, H - inset); ctx.stroke(); break; }
    case "film": {
      // sprocket holes down both edges, like a contact sheet
      ctx.fillStyle = rgba(col, st.frameOpacity / 100); const hw = S * 0.016, hh = S * 0.011, pitch = S * 0.034;
      for (let y = inset; y < H - inset - hh; y += pitch) { ctx.fillRect(inset - hw, y, hw, hh); ctx.fillRect(W - inset, y, hw, hh); }
      ctx.beginPath(); ctx.moveTo(inset + lw, 0); ctx.lineTo(inset + lw, H); ctx.moveTo(W - inset - lw, 0); ctx.lineTo(W - inset - lw, H); ctx.stroke(); break;
    }
    default: box(0);
  }
  ctx.restore();
}

/* ---------- motif marks ---------- */
const BUILTIN_MARKS = new Set(["bars", "dots", "squares", "rings", "diamonds", "ticks", "wave", "slants", "plus", "chevrons"]);
function drawMotif(ctx, S, st, xStart, top, ink, spot, seedText) {
  const k = st.motifSize / 100, pitch = S * 0.0232 * st.motifPitch / 100, h = S * 0.05 * k, w = S * 0.0105 * k;
  const mark = st.missing >= 1 && st.missing <= st.count ? st.missing : 0;
  const rnd = SP.mulberry32(SP.hashStr(seedText || "wave"));
  ctx.save(); ctx.lineWidth = Math.max(1, S * 0.0019);
  for (let i = 1; i <= st.count; i++) {
    const x = xStart + (i - 1) * pitch, isMark = i === mark, cy = top + h / 2;
    const r = rnd();
    if (isMark && st.missingStyle === "gap") continue;
    const outline = isMark && st.missingStyle === "outline";
    ctx.fillStyle = isMark ? rgba(spot, 1) : rgba(ink, 1); ctx.strokeStyle = rgba(spot, 1);
    const lw = ctx.lineWidth;
    if (!BUILTIN_MARKS.has(st.motifKind) && window.Glyphs) {
      try { Glyphs.drawMark(ctx, st.motifKind, x, top, w, h, { color: isMark ? spot : ink, outline, lw, seed: SP.hashStr(seedText || "wave"), i: i - 1 }); } catch (e) { console.error(e); }
      continue;
    }
    ctx.beginPath();
    switch (st.motifKind) {
      case "dots": ctx.arc(x + w / 2, cy, w * 0.62, 0, Math.PI * 2); break;
      case "squares": ctx.rect(x + (outline ? lw / 2 : 0), cy - w * 0.62 + (outline ? lw / 2 : 0), w * 1.24 - (outline ? lw : 0), w * 1.24 - (outline ? lw : 0)); break;
      case "rings": ctx.arc(x + w / 2, cy, w * 0.55, 0, Math.PI * 2); if (!isMark || !outline) { ctx.strokeStyle = isMark ? rgba(spot, 1) : rgba(ink, 1); ctx.lineWidth = w * 0.22; ctx.stroke(); ctx.lineWidth = lw; continue; } break;
      case "diamonds": ctx.moveTo(x + w / 2, cy - w * 0.8); ctx.lineTo(x + w * 1.15, cy); ctx.lineTo(x + w / 2, cy + w * 0.8); ctx.lineTo(x - w * 0.15, cy); ctx.closePath(); break;
      case "ticks": ctx.rect(x + w * 0.3, top, w * 0.4, h); break;
      case "wave": { const hh = h * (0.3 + 0.7 * r); ctx.rect(x, top + (h - hh) / 2, w, hh); break; }
      case "plus": ctx.rect(x + w * 0.1, cy - w * 0.14, w * 1.1, w * 0.28); ctx.rect(x + w * 0.51, cy - w * 0.55, w * 0.28, w * 1.1); break;
      case "chevrons": ctx.moveTo(x, top); ctx.lineTo(x + w * 0.5, top); ctx.lineTo(x + w * 1.3, cy); ctx.lineTo(x + w * 0.5, top + h); ctx.lineTo(x, top + h); ctx.lineTo(x + w * 0.8, cy); ctx.closePath(); break;
      case "slants": ctx.moveTo(x + w * 0.6, top); ctx.lineTo(x + w * 1.6, top); ctx.lineTo(x + w, top + h); ctx.lineTo(x, top + h); ctx.closePath(); break;
      default: ctx.rect(x + (outline ? lw / 2 : 0), top + (outline ? lw / 2 : 0), w - (outline ? lw : 0), h - (outline ? lw : 0));
    }
    if (outline) ctx.stroke(); else ctx.fill();
  }
  ctx.restore();
}
function motifWidth(S, st) { const k = st.motifSize / 100; return (st.count - 1) * S * 0.0232 * st.motifPitch / 100 + S * 0.0105 * k * (st.motifKind === "slants" ? 1.6 : 1.2); }

/* ---------- record label mark ---------- */
const logoCache = new Map();
/* Recolours a logo: tint keeps its alpha and fills it with one colour; knockout turns a dark-on-white logo into colour on clear. */
function tintedLogo(logo, mode, rgb) {
  if (!logo) return null;
  if (mode === "original") return logo;
  if (!imageIds.has(logo)) imageIds.set(logo, ++imageSeq);
  const key = [imageIds.get(logo), mode, rgb.join(",")].join("|");
  if (logoCache.has(key)) return logoCache.get(key);
  const iw = logo.naturalWidth || logo.width, ih = logo.naturalHeight || logo.height, s = Math.min(1, 800 / Math.max(iw, ih));
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(iw * s)); c.height = Math.max(1, Math.round(ih * s));
  const g = c.getContext("2d", { willReadFrequently: true }); g.drawImage(logo, 0, 0, c.width, c.height);
  const id = g.getImageData(0, 0, c.width, c.height), d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = mode === "knockout" ? (1 - (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255) * d[i + 3] : d[i + 3];
    d[i] = rgb[0]; d[i + 1] = rgb[1]; d[i + 2] = rgb[2]; d[i + 3] = Math.min(255, mode === "knockout" ? a * 1.25 : a);
  }
  g.putImageData(id, 0, 0);
  if (logoCache.size > 12) logoCache.clear();
  logoCache.set(key, c); return c;
}
/* Draws the mark centred on (cx, cy); returns its box. */
function drawLabelMark(ctx, S, st, cx, cy, colour, faceName, logo) {
  const kind = st.labelMark, name = (st.label || "").trim();
  if (kind === "none" || (kind === "logo" ? !logo : !name)) return null;
  const k = st.labelSize / 100, a = st.labelOpacity / 100;
  ctx.save(); ctx.globalAlpha = a;
  let box;
  if (kind === "logo") {
    const t = tintedLogo(logo, st.logoMode, colour), h = S * 0.07 * k, w = h * (t.width / t.height);
    const sc = Math.min(1, S * 0.3 * k / w), dw = w * sc, dh = h * sc;
    ctx.drawImage(t, cx - dw / 2, cy - dh / 2, dw, dh); box = { x: cx - dw / 2, y: cy - dh / 2, w: dw, h: dh };
  } else {
    const fs = S * (kind === "stamp" ? 0.0105 : 0.0145) * k, f = faceStack(faceName), txt = name.toUpperCase();
    ctx.font = `${weightFor(faceName, "700")} ${fs}px ${f}`;
    ctx.fillStyle = rgba(colour, 1); ctx.strokeStyle = rgba(colour, 1); ctx.lineWidth = Math.max(1, S * 0.0014 * k);
    if (kind === "stamp") {
      // name set round a ring, a dot in the middle: the classic label roundel
      const r = S * 0.042 * k; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.12, 0, Math.PI * 2); ctx.fill();
      const ring = r * 0.72, chars = [...(txt + "  ·  ")];
      const total = chars.reduce((t, ch) => t + ctx.measureText(ch).width + fs * 0.12, 0), scale = Math.min(1, (Math.PI * 2 * ring) / total);
      let ang = -Math.PI / 2 - (total * scale) / ring / 2;
      for (const ch of chars) {
        const w = (ctx.measureText(ch).width + fs * 0.12) * scale;
        ctx.save(); ctx.translate(cx + Math.cos(ang + w / ring / 2) * ring, cy + Math.sin(ang + w / ring / 2) * ring); ctx.rotate(ang + w / ring / 2 + Math.PI / 2);
        ctx.fillText(ch, -ctx.measureText(ch).width / 2, fs * 0.35); ctx.restore(); ang += w / ring;
      }
      box = { x: cx - r, y: cy - r, w: r * 2, h: r * 2 };
    } else {
      const w = measureTracked(ctx, txt, 0.24, fs), pad = kind === "box" ? fs * 0.8 : 0;
      if (kind === "box") ctx.strokeRect(cx - w / 2 - pad, cy - fs * 0.5 - pad * 0.7, w + pad * 2, fs + pad * 1.4);
      drawTracked(ctx, txt, cx - w / 2, cy + fs * 0.36, 0.24, fs);
      box = { x: cx - w / 2 - pad, y: cy - fs * 0.5 - pad * 0.7, w: w + pad * 2, h: fs + pad * 1.4 };
    }
  }
  ctx.restore();
  return box;
}

/* ---------- the sleeve ---------- */
async function render(canvas, state, image, logo) {
  const st = state, S = canvas.width;
  const ctx = canvas.getContext("2d");
  await loadFonts(st);
  const boxes = {};

  const bg = hexToRgb(st.bg) || [21, 18, 15];
  const ink = hexToRgb(st.ink) || [236, 230, 218];
  const spot = hexToRgb(st.accent) || [155, 27, 30];
  const colourOf = (c) => c === "accent" ? spot : ink;
  const bodyFace = st.bodyFont || st.font, artistFace = st.artistFont || bodyFace;
  const face = faceStack(st.font), bface = faceStack(bodyFace);
  const k = fontInfo(st.font).k || 1;

  ctx.fillStyle = rgba(bg, 1); ctx.fillRect(0, 0, S, S);

  const timg = toned(image, st);
  if (timg) {
    const b = imageBox(st, S), path = boxPath(b);
    drawCover(ctx, timg, b.x, b.y, b.w, b.h, st, path);
    ctx.save(); ctx.beginPath(); path(ctx); ctx.clip();
    ctx.fillStyle = rgba(bg, (st.dim / 100) * (st.imgMode === "bleed" ? 1 : 0.5)); ctx.fillRect(0, 0, S, S);
    ctx.restore();
    boxes.image = { x: b.x, y: b.y, w: b.w, h: b.h };
  }

  drawBackdrop(ctx, S, S, st, bg, ink, spot);
  applyVignette(ctx, S, S, st, bg, ink);
  drawFrame(ctx, S, S, st, ink, spot);

  const X = S * st.margin / 100;
  const alignOf = (el) => st[el + "Align"] || st.align;
  const ax = (w, el) => { const al = alignOf(el), dx = S * (st[el + "X"] || 0) / 100; return (al === "centre" ? (S - w) / 2 : al === "right" ? S - X - w : X) + dx; };
  ctx.textBaseline = "alphabetic";

  // Artist (+ year)
  const artistY = S * st.artistY / 100;
  let artistSize = S * 0.0295 * st.artistSize / 100; const aTrack = st.artistTrack / 100;
  const artistText = applyCase(st.artist, st.artistCase || "upper");
  const rotated = st.artistRotate === "left" || st.artistRotate === "right";
  // Long names shrink to fit the sleeve, leaving room for the year when it shares the line.
  ctx.font = `${weightFor(bodyFace, "600")} ${S * 0.016}px ${bface}`;
  const yearW = st.year.trim() && !rotated ? measureTracked(ctx, st.year.toUpperCase(), 0.26, S * 0.016) + S * 0.025 : 0;
  const artistRoom = rotated ? S - X : S - X * 2 - yearW * (alignOf("artist") === "centre" ? 2 : 1);
  ctx.font = `${weightFor(artistFace, st.artistWeight || 700)} ${artistSize}px ${faceStack(artistFace)}`; ctx.fillStyle = rgba(colourOf(st.artistColor), 1);
  let aw = measureTracked(ctx, artistText, aTrack, artistSize);
  if (aw > artistRoom && aw > 0) {
    artistSize *= artistRoom / aw;
    ctx.font = `${weightFor(artistFace, st.artistWeight || 700)} ${artistSize}px ${faceStack(artistFace)}`;
    aw = measureTracked(ctx, artistText, aTrack, artistSize);
  }
  if (artistText && rotated) {
    // Runs up the left edge or down the right edge; artistY is where its middle sits.
    const left = st.artistRotate === "left", ex = left ? X * 0.62 + artistSize * 0.72 : S - X * 0.62 - artistSize * 0.72;
    const ey = Math.min(S - aw / 2 - X * 0.5, Math.max(aw / 2 + X * 0.5, artistY)) + S * (st.artistX || 0) / 100;
    ctx.save(); ctx.translate(ex, ey); ctx.rotate(left ? -Math.PI / 2 : Math.PI / 2);
    drawTracked(ctx, artistText, -aw / 2, 0, aTrack, artistSize); ctx.restore();
    boxes.artist = { x: left ? ex - artistSize * 0.8 : ex - artistSize * 0.2, y: ey - aw / 2, w: artistSize, h: aw };
  } else if (artistText) {
    const x = ax(aw, "artist");
    drawTracked(ctx, artistText, x, artistY, aTrack, artistSize);
    boxes.artist = { x, y: artistY - artistSize * 0.8, w: aw, h: artistSize };
  }
  if (st.year.trim()) {
    const ys = S * 0.016, yt = st.year.toUpperCase();
    ctx.font = `${weightFor(bodyFace, "600")} ${ys}px ${bface}`; ctx.fillStyle = rgba(ink, 0.6);
    const w = measureTracked(ctx, yt, 0.26, ys), al = rotated ? "centre" : alignOf("artist");
    drawTracked(ctx, yt, al === "right" ? X : S - X - w, rotated ? S * 0.07 : artistY, 0.26, ys);
  }

  // Motif
  const motifTop = S * st.motifY / 100, motifH = S * 0.05 * st.motifSize / 100;
  if (st.motifKind !== "none" && st.count > 0) {
    const mw = motifWidth(S, st), mx = ax(mw, "motif");
    drawMotif(ctx, S, st, mx, motifTop, ink, spot, `${st.catalog}|${st.title}`);
    boxes.motif = { x: mx, y: motifTop, w: mw, h: motifH };
  }

  // Title: bottom baseline from the preset plus a nudge; shrinks to fit width and the room above it.
  const lines = st.title.split("\n").map(l => l.trim()).filter(Boolean).map(l => applyCase(l, st.titleCase));
  if (lines.length) {
    const maxW = S - X * 2;
    let size = S * 0.19 * (st.titleSize / 100) * k;
    const trackEm = st.tracking / 100, lead = st.leading / 100;
    const bottom = ({ centre: 0.68, lower: 0.815, upper: 0.56 }[st.titlePos] + st.titleDy / 100) * S;
    let topLimit = S * 0.08;
    if (artistText && !rotated && artistY < bottom) topLimit = Math.max(topLimit, artistY + S * 0.102);
    if (st.motifKind !== "none" && motifTop < bottom) topLimit = Math.max(topLimit, motifTop + motifH + S * 0.054);
    ctx.font = `${weightFor(st.font, "700")} ${size}px ${face}`;
    const widest = Math.max(...lines.map(l => measureTracked(ctx, l, trackEm, size) / size));
    if (widest * size > maxW) size = maxW / widest;
    const blockH = size * lead * (lines.length - 1) + size * 0.72;
    if (bottom - blockH < topLimit) size *= Math.max(0.45, (bottom - topLimit) / blockH);
    ctx.font = `${weightFor(st.font, "700")} ${size}px ${face}`;
    const optical = size * 0.035, al = alignOf("title"), dx = S * (st.titleX || 0) / 100;
    const style = st.titleStyle || "solid", main = colourOf(st.titleColor);
    let bx0 = Infinity, bx1 = -Infinity;
    const placed = lines.map((l, i) => {
      const y = bottom - (lines.length - 1 - i) * size * lead, w = measureTracked(ctx, l, trackEm, size);
      const x = (al === "left" ? X - optical : al === "right" ? S - X - w + optical : (S - w) / 2) + dx;
      bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x + w);
      return { l, x, y, w, col: st.titleAccent && i === lines.length - 1 ? spot : main };
    });
    const lw = Math.max(1, size * 0.028);
    if (style === "block") {
      // Each line on a bar of spot colour; the text takes whichever of ground/ink reads best on it.
      const onSpot = SP.contrast(bg, spot) >= SP.contrast(ink, spot) ? bg : ink;
      placed.forEach(p => {
        const pad = size * 0.09;
        ctx.fillStyle = rgba(st.titleColor === "accent" ? ink : spot, 1);
        ctx.fillRect(p.x - pad, p.y - size * 0.74 - pad * 0.6, p.w + pad * 2, size * 0.74 + pad * 1.5);
        ctx.fillStyle = rgba(st.titleColor === "accent" ? (SP.contrast(bg, ink) >= SP.contrast(spot, ink) ? bg : spot) : onSpot, 1);
        drawTracked(ctx, p.l, p.x, p.y, trackEm, size);
      });
    } else {
      if (style === "echo") {
        ctx.lineWidth = lw * 0.8;
        for (let e = 3; e >= 1; e--) placed.forEach(p => { ctx.strokeStyle = rgba(e === 1 ? spot : p.col, 0.16 + 0.18 * (3 - e)); drawTracked(ctx, p.l, p.x, p.y - e * size * 0.16, trackEm, size, true); });
      }
      if (style === "shadow") placed.forEach(p => { ctx.fillStyle = rgba(st.titleColor === "accent" ? ink : spot, 1); drawTracked(ctx, p.l, p.x + size * 0.045, p.y + size * 0.045, trackEm, size); });
      placed.forEach(p => {
        if (style === "outline") { ctx.strokeStyle = rgba(p.col, 1); ctx.lineWidth = lw; ctx.lineJoin = "round"; drawTracked(ctx, p.l, p.x, p.y, trackEm, size, true); }
        else { ctx.fillStyle = rgba(p.col, 1); drawTracked(ctx, p.l, p.x, p.y, trackEm, size); }
      });
    }
    const th = size * lead * (lines.length - 1) + size * 0.74;
    boxes.title = { x: bx0, y: bottom - th, w: bx1 - bx0, h: th + size * 0.06 };
  }

  // Barcode and catalogue plate (bottom-right stack), plate top-right
  const right = S - X;
  let cornerTop = S * 0.935, barcodeLeft = right;
  if (st.barcode) {
    barcodeLeft = right - barcodeWidth(S, st); const bb = cornerTop;
    cornerTop = drawBarcode(ctx, S, right, cornerTop, bface, bg, ink, st, spot);
    boxes.barcode = { x: barcodeLeft, y: cornerTop, w: right - barcodeLeft, h: bb - cornerTop };
  }
  if (st.plate) {
    if (st.platePos === "br") drawPlate(ctx, S, right, cornerTop - (st.barcode ? S * 0.014 : 0), "bottom", bface, ink, st);
    else drawPlate(ctx, S, right, Math.max(S * 0.06, motifTop), "top", bface, ink, st);
  }

  // Footer: kept clear of the bottom-right corner when it sits at the bottom
  if (st.footer.trim()) {
    let fs = S * 0.0172 * st.footerSize / 100;
    const fy = S * st.footerY / 100;
    const corner = fy > S * 0.8 && (st.barcode || (st.plate && st.platePos === "br"));
    const avail = (corner ? Math.min(barcodeLeft, st.plate && st.platePos === "br" ? right - S * 0.12 : right) - S * 0.03 : right) - X;
    ctx.fillStyle = rgba(colourOf(st.footerColor), (st.footerOpacity ?? 58) / 100);
    const fc = (t) => applyCase(t, st.footerCase || "upper");
    let text = fc(st.footer).replace(/\s*·\s*/g, "  ·  ");
    let track = st.footerTrack / 100;
    ctx.font = `${weightFor(bodyFace, "600")} ${fs}px ${bface}`;
    if (measureTracked(ctx, text, track, fs) > avail) { text = fc(st.footer); track = Math.min(track, 0.16); }
    const w = measureTracked(ctx, text, track, fs);
    if (w > avail) { fs *= avail / w; ctx.font = `${weightFor(bodyFace, "600")} ${fs}px ${bface}`; }
    const fw = measureTracked(ctx, text, track, fs);
    const fx = corner && alignOf("footer") !== "left" ? X + S * (st.footerX || 0) / 100 : ax(fw, "footer");
    drawTracked(ctx, text, fx, fy, track, fs);
    boxes.footer = { x: fx, y: fy - fs * 0.9, w: fw, h: fs * 1.2 };
  }

  const lb = drawLabelMark(ctx, S, st, S * st.labelX / 100, S * st.labelY / 100, colourOf(st.labelColor), bodyFace, logo);
  if (lb) boxes.label = lb;

  applyGrain(ctx, S, S, st.grain, S);
  return boxes;
}

function filename(state, size, tag) {
  const parts = [state.catalog, state.artist, "-", state.title.replace(/\n/g, " ")].filter(Boolean).map(SP.safeName).filter(Boolean);
  return `${parts.join("_")}${tag ? "_" + tag : ""}_${size}.png`;
}

window.SleeveRender = {
  SLEEVE_DEFAULTS, RELEASE_KEYS, PALETTE_KEYS, LOOK_KEYS, IMG_MODES, lookOf, imageBox, boxPath, flatten, render, filename, toned, drawCover,
  loadFont, loadFonts, weightFor, faceStack, fontInfo, drawTracked, measureTracked, applyCase, drawBarcode, barcodeWidth, barcodeReversed, eanDigits,
  applyGrain, applyVignette, drawBackdrop, drawFrame, drawLabelMark, tintedLogo, drawMotif, motifWidth, drawShape, drawPattern, patternClip, BUILTIN_MARKS,
};
})();
