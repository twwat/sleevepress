/* Sleeve Press: the front-sleeve renderer, shared by Sleeve, Tracklist and Kit.
   flatten(db) merges the release record into the flat state the renderer reads. */
(function () {
"use strict";
const { hexToRgb, rgba, lum } = SP;

const SLEEVE_DEFAULTS = {
  grain: 28, vignette: 55, frame: true,
  motifKind: "bars", count: 9, missing: 9, missingStyle: "outline",
  font: "Archivo", titleSize: 100, tracking: -1, titlePos: "centre", titleAccent: false,
  imgMode: "bleed", imgTone: "ink", dim: 60, zoom: 100, shiftX: 0, shiftY: 0,
  plate: false, platePos: "tr", plateText: "", barcode: false, barcodeDigits: "",
  exportSize: "3000",
};
const RELEASE_KEYS = ["artist", "title", "footer", "catalog", "year"];
const PALETTE_KEYS = ["bg", "ink", "accent"];

function flatten(db) {
  const s = { ...SLEEVE_DEFAULTS };
  for (const k of Object.keys(SLEEVE_DEFAULTS)) if (k in db.sleeve && typeof db.sleeve[k] === typeof SLEEVE_DEFAULTS[k]) s[k] = db.sleeve[k];
  for (const k of RELEASE_KEYS) s[k] = db.release[k] ?? "";
  for (const k of PALETTE_KEYS) s[k] = db.palette[k];
  return s;
}

/* ---------- fonts ---------- */
const fontReady = {};
function loadFont(face) {
  if (!fontReady[face]) {
    const weights = face === "DM Serif Display" ? ["400"] : ["600", "700"];
    fontReady[face] = Promise.all(weights.map(w => document.fonts.load(`${w} 100px "${face}"`))).catch(() => {});
  }
  return fontReady[face];
}
const weightFor = (face, want) => face === "DM Serif Display" ? "400" : want;
const faceStack = (f) => `"${f}", "Helvetica Neue", Arial, sans-serif`;

/* ---------- tracked text ---------- */
function drawTracked(ctx, text, x, y, trackEm, size) {
  const track = trackEm * size; let cx = x;
  for (const ch of text) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + track; }
  return cx - x - track;
}
function measureTracked(ctx, text, trackEm, size) {
  let w = 0, n = 0;
  for (const ch of text) { w += ctx.measureText(ch).width; n++; }
  return w + Math.max(0, n - 1) * trackEm * size;
}

/* ---------- image toning ---------- */
const imageIds = new WeakMap(); let imageSeq = 0;
let tonedCache = { key: null, canvas: null };
function toned(image, state) {
  if (!image) return null;
  if (!imageIds.has(image)) imageIds.set(image, ++imageSeq);
  const key = [imageIds.get(image), state.imgTone, state.bg, state.ink, state.accent].join("|");
  if (tonedCache.key === key) return tonedCache.canvas;
  const cap = 2400;
  const s = Math.min(1, cap / Math.max(image.naturalWidth, image.naturalHeight));
  const w = Math.max(1, Math.round(image.naturalWidth * s)), h = Math.max(1, Math.round(image.naturalHeight * s));
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(image, 0, 0, w, h);
  if (state.imgTone !== "original") {
    const a = hexToRgb(state.bg), b = hexToRgb(state.imgTone === "accent" ? state.accent : state.ink);
    if (a && b) {
      // Dark end is whichever of the two is darker, so a light "Day Clean" sleeve tones correctly too.
      const [dark, light] = lum(a) <= lum(b) ? [a, b] : [b, a];
      const id = g.getImageData(0, 0, w, h); const d = id.data;
      for (let i = 0; i < d.length; i += 4) {
        let t = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
        t = Math.min(1, Math.max(0, (t - 0.08) / 0.84));
        d[i] = dark[0] + (light[0] - dark[0]) * t;
        d[i + 1] = dark[1] + (light[1] - dark[1]) * t;
        d[i + 2] = dark[2] + (light[2] - dark[2]) * t;
      }
      g.putImageData(id, 0, 0);
    }
  }
  tonedCache = { key, canvas: c };
  return c;
}
function drawCover(ctx, img, x, y, w, h, state) {
  const zoom = state.zoom / 100;
  const scale = Math.max(w / img.width, h / img.height) * zoom;
  const dw = img.width * scale, dh = img.height * scale;
  const slackX = dw - w, slackY = dh - h;
  const dx = x - slackX / 2 - (state.shiftX / 100) * slackX;
  const dy = y - slackY / 2 - (state.shiftY / 100) * slackY;
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.drawImage(img, dx, dy, dw, dh);
  ctx.restore();
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
const barcodeWidth = (S) => S * 0.00165 * 95 + S * 0.022 + S * 0.00165 * 9;
// Draws the barcode block with its right edge at `right` and bottom edge at `bottom`; returns its top.
function drawBarcode(ctx, S, right, bottom, face, bg, ink, state) {
  const d13 = eanDigits(state);
  const bits = eanModules(d13);
  const [box, bar] = lum(ink) >= lum(bg) ? [ink, bg] : [bg, ink]; // bars always dark on light
  const module = S * 0.00165;
  const barW = module * 95;
  const barH = S * 0.058;
  const digitSize = S * 0.0135;
  const padX = S * 0.011, padY = S * 0.009;
  const w = barW + padX * 2 + module * 9;
  const h = barH + digitSize * 1.15 + padY * 2;
  const x0 = right - w, y0 = bottom - h;
  ctx.fillStyle = rgba(box, 1);
  ctx.fillRect(x0, y0, w, h);
  const bx = x0 + padX + module * 9, by = y0 + padY;
  ctx.fillStyle = rgba(bar, 1);
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] !== "1") continue;
    const guard = i < 3 || (i >= 45 && i < 50) || i >= 92;
    ctx.fillRect(bx + i * module, by, module, barH + (guard ? digitSize * 0.55 : 0));
  }
  ctx.font = `${weightFor(state.font, "600")} ${digitSize}px ${face}`;
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
  ctx.font = `${weightFor(state.font, "600")} ${fs}px ${face}`;
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

/* ---------- the sleeve ---------- */
async function render(canvas, state, image) {
  const S = canvas.width;
  const ctx = canvas.getContext("2d");
  await loadFont(state.font);

  const bg = hexToRgb(state.bg) || [21, 18, 15];
  const ink = hexToRgb(state.ink) || [236, 230, 218];
  const spot = hexToRgb(state.accent) || [155, 27, 30];
  const face = faceStack(state.font);
  const condensed = state.font === "Barlow Condensed" || state.font === "Oswald";
  const serif = state.font === "DM Serif Display";

  ctx.fillStyle = rgba(bg, 1); ctx.fillRect(0, 0, S, S);

  const timg = toned(image, state);
  const mode = state.imgMode;
  if (timg) {
    if (mode === "bleed") drawCover(ctx, timg, 0, 0, S, S, state);
    else if (mode === "panel") drawCover(ctx, timg, S * 0.52, S * 0.11, S * 0.37, S * 0.37, state);
    else if (mode === "band") drawCover(ctx, timg, 0, S * 0.29, S, S * 0.47, state);
    if (mode === "bleed") {
      ctx.fillStyle = rgba(bg, state.dim / 100); ctx.fillRect(0, 0, S, S);
    } else {
      ctx.fillStyle = rgba(bg, (state.dim / 100) * 0.5);
      if (mode === "panel") ctx.fillRect(S * 0.52, S * 0.11, S * 0.37, S * 0.37); else ctx.fillRect(0, S * 0.29, S, S * 0.47);
    }
  }

  applyVignette(ctx, S, S, state, bg, ink);

  const X = S * 0.11;
  const inkMain = rgba(ink, 1);

  if (state.frame) {
    const inset = S * 0.045;
    ctx.strokeStyle = rgba(ink, 0.14); ctx.lineWidth = Math.max(1, S * 0.00125);
    ctx.strokeRect(inset, inset, S - inset * 2, S - inset * 2);
  }

  const artistSize = S * 0.0295;
  ctx.font = `${weightFor(state.font, "700")} ${artistSize}px ${face}`;
  ctx.textBaseline = "alphabetic"; ctx.fillStyle = inkMain;
  drawTracked(ctx, state.artist.toUpperCase(), X, S * 0.158, 0.32, artistSize);

  if (state.year.trim()) {
    const ys = S * 0.016;
    ctx.font = `${weightFor(state.font, "600")} ${ys}px ${face}`;
    ctx.fillStyle = rgba(ink, 0.6);
    const w = measureTracked(ctx, state.year.toUpperCase(), 0.26, ys);
    drawTracked(ctx, state.year.toUpperCase(), S - X - w, S * 0.158, 0.26, ys);
  }

  if (state.motifKind !== "none") {
    const pitch = S * 0.0232, top = S * 0.206, h = S * 0.05, w = S * 0.0105;
    const mark = state.missing >= 1 && state.missing <= state.count ? state.missing : 0;
    for (let i = 1; i <= state.count; i++) {
      const x = X + (i - 1) * pitch;
      const isMark = i === mark;
      if (isMark && state.missingStyle === "gap") continue;
      ctx.fillStyle = isMark ? rgba(spot, 1) : inkMain;
      ctx.strokeStyle = rgba(spot, 1); ctx.lineWidth = Math.max(1, S * 0.0019);
      if (state.motifKind === "bars") {
        if (isMark && state.missingStyle === "outline") ctx.strokeRect(x + ctx.lineWidth / 2, top + ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
        else ctx.fillRect(x, top, w, h);
      } else {
        const r = w * 0.62, cy = top + h / 2;
        ctx.beginPath(); ctx.arc(x + w / 2, cy, r, 0, Math.PI * 2);
        if (isMark && state.missingStyle === "outline") ctx.stroke(); else ctx.fill();
      }
    }
  }

  const lines = state.title.split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length) {
    const maxW = S - X * 2;
    let size = S * 0.19 * (state.titleSize / 100) * (condensed ? 1.18 : 1) * (serif ? 1.02 : 1);
    const trackEm = state.tracking / 100;
    const bottom = { centre: 0.68, lower: 0.815, upper: 0.56 }[state.titlePos] * S;
    const topLimit = S * (state.motifKind === "none" ? 0.26 : 0.31);
    ctx.font = `${weightFor(state.font, "700")} ${size}px ${face}`;
    const widest = Math.max(...lines.map(l => measureTracked(ctx, l.toUpperCase(), trackEm, size) / size));
    if (widest * size > maxW) size = maxW / widest;
    const pitch = size * 0.885;
    const blockH = pitch * (lines.length - 1) + size * 0.72;
    if (bottom - blockH < topLimit) { const f = (bottom - topLimit) / blockH; size *= f; }
    const pitch2 = size * 0.885;
    ctx.font = `${weightFor(state.font, "700")} ${size}px ${face}`;
    lines.forEach((l, i) => {
      const y = bottom - (lines.length - 1 - i) * pitch2;
      const last = i === lines.length - 1;
      ctx.fillStyle = state.titleAccent && last ? rgba(spot, 1) : inkMain;
      drawTracked(ctx, l.toUpperCase(), X - size * 0.035, y, trackEm, size);
    });
  }

  const right = S - X;
  let cornerTop = S * 0.935;
  let barcodeLeft = right;
  if (state.barcode) {
    barcodeLeft = right - barcodeWidth(S);
    cornerTop = drawBarcode(ctx, S, right, cornerTop, face, bg, ink, state);
  }
  if (state.plate) {
    if (state.platePos === "br") drawPlate(ctx, S, right, cornerTop - (state.barcode ? S * 0.014 : 0), "bottom", face, ink, state);
    else drawPlate(ctx, S, right, S * 0.206, "top", face, ink, state);
  }

  if (state.footer.trim()) {
    let fs = S * 0.0172;
    const avail = (state.barcode || (state.plate && state.platePos === "br") ? Math.min(barcodeLeft, state.plate && state.platePos === "br" ? right - S * 0.12 : right) - S * 0.03 : right) - X;
    ctx.fillStyle = rgba(ink, 0.58);
    let text = state.footer.toUpperCase().replace(/\s*·\s*/g, "  ·  ");
    let track = 0.25;
    ctx.font = `${weightFor(state.font, "600")} ${fs}px ${face}`;
    if (measureTracked(ctx, text, track, fs) > avail) { text = state.footer.toUpperCase(); track = 0.16; }
    const w = measureTracked(ctx, text, track, fs);
    if (w > avail) { fs *= avail / w; ctx.font = `${weightFor(state.font, "600")} ${fs}px ${face}`; }
    drawTracked(ctx, text, X, S * 0.922, track, fs);
  }

  applyGrain(ctx, S, S, state.grain, S);
}

function filename(state, size, tag) {
  const parts = [state.catalog, state.artist, "-", state.title.replace(/\n/g, " ")].filter(Boolean).map(SP.safeName).filter(Boolean);
  return `${parts.join("_")}${tag ? "_" + tag : ""}_${size}.png`;
}

window.SleeveRender = {
  SLEEVE_DEFAULTS, RELEASE_KEYS, PALETTE_KEYS, flatten, render, filename, toned, drawCover,
  loadFont, weightFor, faceStack, drawTracked, measureTracked, drawBarcode, barcodeWidth, eanDigits,
  applyGrain, applyVignette,
};
})();
