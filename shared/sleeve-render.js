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
  wash: "none", washAmt: 45, shape: "none", shapeAmt: 85, shapeSize: 55, shapeX: 70, shapeY: 38, shapeColor: "accent",
  texture: "none", textureAmt: 45,
  // layout
  align: "left", margin: 11, artistY: 15.8, motifY: 20.6, footerY: 92.2, footerPos: "bottom",
  // motif
  motifKind: "bars", count: 9, missing: 9, missingStyle: "outline", motifSize: 100, motifPitch: 100,
  // type
  font: "Archivo", bodyFont: "", titleSize: 100, tracking: -1, leading: 88.5, titleCase: "upper", titlePos: "centre", titleDy: 0, titleAccent: false,
  artistSize: 100, artistTrack: 32, footerSize: 100, footerTrack: 25,
  // image
  imgMode: "bleed", imgTone: "ink", dim: 60, zoom: 100, shiftX: 0, shiftY: 0, imgBlur: 0, imgContrast: 100, imgPosterize: 0,
  // catalogue
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
/* The look: everything but words, image placement and export size. */
const LOOK_KEYS = Object.keys(SLEEVE_DEFAULTS).filter(k => !["plateText", "barcodeDigits", "exportSize", "zoom", "shiftX", "shiftY"].includes(k));

/* ---------- fonts ---------- */
const fontReady = {};
const fontInfo = (face) => (window.Looks && Looks.FONT[face]) || { n: face, w: [600, 700] };
function loadFont(face) {
  if (!fontReady[face]) fontReady[face] = Promise.all(fontInfo(face).w.map(w => document.fonts.load(`${w} 100px "${face}"`))).catch(() => {});
  return fontReady[face];
}
const loadFonts = (st) => Promise.all([loadFont(st.font), loadFont(st.bodyFont || st.font)]);
/* Nearest weight the face actually has, so the browser never fakes a bold. */
function weightFor(face, want) {
  const ws = fontInfo(face).w; want = Number(want);
  return String(ws.reduce((a, b) => Math.abs(b - want) < Math.abs(a - want) ? b : a, ws[0]));
}
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
function applyCase(t, mode) {
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
  const s = Math.min(1, cap / Math.max(image.naturalWidth, image.naturalHeight));
  const w = Math.max(1, Math.round(image.naturalWidth * s)), h = Math.max(1, Math.round(image.naturalHeight * s));
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
  if (st.shape && st.shape !== "none" && st.shapeAmt > 0) {
    const col = st.shapeColor === "ink" ? ink : spot, a = (st.shapeAmt / 100) * k;
    const cx = W * st.shapeX / 100, cy = H * st.shapeY / 100, r = S * st.shapeSize / 200;
    ctx.save(); ctx.fillStyle = rgba(col, a); ctx.strokeStyle = rgba(col, a);
    ctx.beginPath();
    if (st.shape === "circle") { ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill(); }
    else if (st.shape === "ring") { ctx.lineWidth = r * 0.16; ctx.arc(cx, cy, r * 0.92, 0, Math.PI * 2); ctx.stroke(); }
    else if (st.shape === "square") { ctx.fillRect(cx - r, cy - r, r * 2, r * 2); }
    else if (st.shape === "half") { ctx.arc(cx, cy, r, Math.PI, 0); ctx.closePath(); ctx.fill(); }
    else if (st.shape === "bars") { const n = 7, bw = (r * 2) / (n * 2 - 1); for (let i = 0; i < n; i++) ctx.fillRect(cx - r + i * bw * 2, cy - r, bw, r * 2); }
    ctx.restore();
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
    default: box(0);
  }
  ctx.restore();
}

/* ---------- motif marks ---------- */
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
    ctx.beginPath();
    switch (st.motifKind) {
      case "dots": ctx.arc(x + w / 2, cy, w * 0.62, 0, Math.PI * 2); break;
      case "squares": ctx.rect(x + (outline ? lw / 2 : 0), cy - w * 0.62 + (outline ? lw / 2 : 0), w * 1.24 - (outline ? lw : 0), w * 1.24 - (outline ? lw : 0)); break;
      case "rings": ctx.arc(x + w / 2, cy, w * 0.55, 0, Math.PI * 2); if (!isMark || !outline) { ctx.strokeStyle = isMark ? rgba(spot, 1) : rgba(ink, 1); ctx.lineWidth = w * 0.22; ctx.stroke(); ctx.lineWidth = lw; continue; } break;
      case "diamonds": ctx.moveTo(x + w / 2, cy - w * 0.8); ctx.lineTo(x + w * 1.15, cy); ctx.lineTo(x + w / 2, cy + w * 0.8); ctx.lineTo(x - w * 0.15, cy); ctx.closePath(); break;
      case "ticks": ctx.rect(x + w * 0.3, top, w * 0.4, h); break;
      case "wave": { const hh = h * (0.3 + 0.7 * r); ctx.rect(x, top + (h - hh) / 2, w, hh); break; }
      case "slants": ctx.moveTo(x + w * 0.6, top); ctx.lineTo(x + w * 1.6, top); ctx.lineTo(x + w, top + h); ctx.lineTo(x, top + h); ctx.closePath(); break;
      default: ctx.rect(x + (outline ? lw / 2 : 0), top + (outline ? lw / 2 : 0), w - (outline ? lw : 0), h - (outline ? lw : 0));
    }
    if (outline) ctx.stroke(); else ctx.fill();
  }
  ctx.restore();
}
function motifWidth(S, st) { const k = st.motifSize / 100; return (st.count - 1) * S * 0.0232 * st.motifPitch / 100 + S * 0.0105 * k * (st.motifKind === "slants" ? 1.6 : 1.2); }

/* ---------- the sleeve ---------- */
async function render(canvas, state, image) {
  const st = state, S = canvas.width;
  const ctx = canvas.getContext("2d");
  await loadFonts(st);

  const bg = hexToRgb(st.bg) || [21, 18, 15];
  const ink = hexToRgb(st.ink) || [236, 230, 218];
  const spot = hexToRgb(st.accent) || [155, 27, 30];
  const bodyFace = st.bodyFont || st.font;
  const face = faceStack(st.font), bface = faceStack(bodyFace);
  const k = fontInfo(st.font).k || 1;

  ctx.fillStyle = rgba(bg, 1); ctx.fillRect(0, 0, S, S);

  const timg = toned(image, st);
  const mode = st.imgMode;
  if (timg) {
    if (mode === "bleed") drawCover(ctx, timg, 0, 0, S, S, st);
    else if (mode === "panel") drawCover(ctx, timg, S * 0.52, S * 0.11, S * 0.37, S * 0.37, st);
    else if (mode === "band") drawCover(ctx, timg, 0, S * 0.29, S, S * 0.47, st);
    if (mode === "bleed") {
      ctx.fillStyle = rgba(bg, st.dim / 100); ctx.fillRect(0, 0, S, S);
    } else {
      ctx.fillStyle = rgba(bg, (st.dim / 100) * 0.5);
      if (mode === "panel") ctx.fillRect(S * 0.52, S * 0.11, S * 0.37, S * 0.37); else ctx.fillRect(0, S * 0.29, S, S * 0.47);
    }
  }

  drawBackdrop(ctx, S, S, st, bg, ink, spot);
  applyVignette(ctx, S, S, st, bg, ink);
  drawFrame(ctx, S, S, st, ink, spot);

  const X = S * st.margin / 100;
  const ax = (w) => st.align === "centre" ? (S - w) / 2 : st.align === "right" ? S - X - w : X;
  const inkMain = rgba(ink, 1);
  ctx.textBaseline = "alphabetic";

  // Artist (+ year)
  const artistY = S * st.artistY / 100;
  const artistSize = S * 0.0295 * st.artistSize / 100, aTrack = st.artistTrack / 100;
  const artistText = st.artist.toUpperCase();
  ctx.font = `${weightFor(bodyFace, "700")} ${artistSize}px ${bface}`; ctx.fillStyle = inkMain;
  const aw = measureTracked(ctx, artistText, aTrack, artistSize);
  if (artistText) drawTracked(ctx, artistText, ax(aw), artistY, aTrack, artistSize);
  if (st.year.trim()) {
    const ys = S * 0.016, yt = st.year.toUpperCase();
    ctx.font = `${weightFor(bodyFace, "600")} ${ys}px ${bface}`; ctx.fillStyle = rgba(ink, 0.6);
    const w = measureTracked(ctx, yt, 0.26, ys);
    if (st.align === "left") drawTracked(ctx, yt, S - X - w, artistY, 0.26, ys);
    else drawTracked(ctx, yt, st.align === "right" ? X : S - X - w, artistY, 0.26, ys);
  }

  // Motif
  const motifTop = S * st.motifY / 100, motifH = S * 0.05 * st.motifSize / 100;
  if (st.motifKind !== "none" && st.count > 0) drawMotif(ctx, S, st, ax(motifWidth(S, st)), motifTop, ink, spot, `${st.catalog}|${st.title}`);

  // Title: bottom baseline from the preset plus a nudge; shrinks to fit width and the room above it.
  const lines = st.title.split("\n").map(l => l.trim()).filter(Boolean).map(l => applyCase(l, st.titleCase));
  if (lines.length) {
    const maxW = S - X * 2;
    let size = S * 0.19 * (st.titleSize / 100) * k;
    const trackEm = st.tracking / 100, lead = st.leading / 100;
    const bottom = ({ centre: 0.68, lower: 0.815, upper: 0.56 }[st.titlePos] + st.titleDy / 100) * S;
    let topLimit = S * 0.08;
    if (artistText && artistY < bottom) topLimit = Math.max(topLimit, artistY + S * 0.102);
    if (st.motifKind !== "none" && motifTop < bottom) topLimit = Math.max(topLimit, motifTop + motifH + S * 0.054);
    ctx.font = `${weightFor(st.font, "700")} ${size}px ${face}`;
    const widest = Math.max(...lines.map(l => measureTracked(ctx, l, trackEm, size) / size));
    if (widest * size > maxW) size = maxW / widest;
    const blockH = size * lead * (lines.length - 1) + size * 0.72;
    if (bottom - blockH < topLimit) size *= Math.max(0.45, (bottom - topLimit) / blockH);
    ctx.font = `${weightFor(st.font, "700")} ${size}px ${face}`;
    const optical = size * 0.035;
    lines.forEach((l, i) => {
      const y = bottom - (lines.length - 1 - i) * size * lead;
      const last = i === lines.length - 1, w = measureTracked(ctx, l, trackEm, size);
      ctx.fillStyle = st.titleAccent && last ? rgba(spot, 1) : inkMain;
      const x = st.align === "left" ? X - optical : st.align === "right" ? S - X - w + optical : (S - w) / 2;
      drawTracked(ctx, l, x, y, trackEm, size);
    });
  }

  // Barcode and catalogue plate (bottom-right stack), plate top-right
  const right = S - X;
  let cornerTop = S * 0.935, barcodeLeft = right;
  if (st.barcode) { barcodeLeft = right - barcodeWidth(S); cornerTop = drawBarcode(ctx, S, right, cornerTop, bface, bg, ink, st); }
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
    ctx.fillStyle = rgba(ink, 0.58);
    let text = st.footer.toUpperCase().replace(/\s*·\s*/g, "  ·  ");
    let track = st.footerTrack / 100;
    ctx.font = `${weightFor(bodyFace, "600")} ${fs}px ${bface}`;
    if (measureTracked(ctx, text, track, fs) > avail) { text = st.footer.toUpperCase(); track = Math.min(track, 0.16); }
    const w = measureTracked(ctx, text, track, fs);
    if (w > avail) { fs *= avail / w; ctx.font = `${weightFor(bodyFace, "600")} ${fs}px ${bface}`; }
    const fw = measureTracked(ctx, text, track, fs);
    drawTracked(ctx, text, corner ? X : ax(fw), fy, track, fs);
  }

  applyGrain(ctx, S, S, st.grain, S);
}

function filename(state, size, tag) {
  const parts = [state.catalog, state.artist, "-", state.title.replace(/\n/g, " ")].filter(Boolean).map(SP.safeName).filter(Boolean);
  return `${parts.join("_")}${tag ? "_" + tag : ""}_${size}.png`;
}

window.SleeveRender = {
  SLEEVE_DEFAULTS, RELEASE_KEYS, PALETTE_KEYS, LOOK_KEYS, flatten, render, filename, toned, drawCover,
  loadFont, loadFonts, weightFor, faceStack, fontInfo, drawTracked, measureTracked, applyCase, drawBarcode, barcodeWidth, eanDigits,
  applyGrain, applyVignette, drawBackdrop, drawFrame,
};
})();
