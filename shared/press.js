/* Sleeve Press: shared core.
   One release record (release.json) lives in localStorage and is read/written by every tool.
   Export/import it from any page to carry a release between browsers or machines. */
(function () {
"use strict";

const KEY = "sleevepress.release.v1";
const IMG_KEY = "sleevepress.image.v1";
const SCHEMA = "sleevepress.release/1";

const TOOLS = [
  ["index.html", "Desk"],
  ["sleeve-press.html", "Sleeve"],
  ["tracklist.html", "Tracklist"],
  ["style-forge.html", "Style"],
  ["title-lab.html", "Titles"],
  ["palette-pull.html", "Palette"],
  ["release-kit.html", "Kit"],
];

const DEFAULT = () => ({
  schema: SCHEMA,
  release: {
    artist: "DUPPY WIRE", title: "NINE\nNIGHT", catalog: "DPWR-001", year: "",
    footer: "DUPPY WIRE SOUND · KGN — N17 · DPWR-001", format: "EP",
  },
  palette: { bg: "#15120f", ink: "#ece6da", accent: "#9b1b1e", name: "Nine Night", swatches: [], words: "" },
  tracks: [],      // [{ title, feat, bpm, key, length, side }]
  sleeve: {},      // Sleeve Press settings beyond the shared fields (merged over its own defaults)
  typeset: {},     // Tracklist settings
  style: {},       // Style Forge state + generated prompt/exclude/structure/batch
  names: { shortlist: [], seed: 1 },
  kit: { series: [], sizes: null },
});

/* ---------- utils ---------- */
const $ = (id) => document.getElementById(id);
function hexToRgb(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(h).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}
const rgbToHex = (c) => "#" + c.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
const rgba = (rgb, a) => `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
const lum = (rgb) => (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
function relLum(rgb) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}
function contrast(a, b) {
  const la = relLum(a), lb = relLum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60;
  }
  return [h, s, l];
}
function hslToRgb([h, s, l]) {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
function rgbToLab([r, g, b]) {
  const f = (v) => { v /= 255; return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92; };
  const R = f(r), G = f(g), B = f(b);
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, y = R * 0.2126 + G * 0.7152 + B * 0.0722, z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const g2 = (t) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  x = g2(x); y = g2(y); z = g2(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const labDist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function safeName(s) { return String(s).replace(/[^\w\-]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, ""); }
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function hashStr(s) { let h = 2166136261; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const clone = (o) => JSON.parse(JSON.stringify(o));

function toast(msg) {
  let t = $("toast");
  if (!t) { t = document.createElement("div"); t.id = "toast"; t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false;
  clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 2600);
}
function download(data, filename, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime || "text/plain" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function copy(text, label) {
  try { await navigator.clipboard.writeText(text); }
  catch (e) {
    const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); } catch (e2) { toast("Couldn't copy."); ta.remove(); return; }
    ta.remove();
  }
  toast(label ? `Copied ${label}` : "Copied");
}
const canvasBlob = (c, type = "image/png", q) => new Promise(res => c.toBlob(res, type, q));

/* ---------- the release record ---------- */
let db = null;
const listeners = new Set();
function mergeDefaults(saved) {
  const d = DEFAULT();
  if (!saved || typeof saved !== "object") return d;
  for (const k of Object.keys(d)) {
    if (!(k in saved)) continue;
    if (Array.isArray(d[k])) { if (Array.isArray(saved[k])) d[k] = saved[k]; }
    else if (d[k] && typeof d[k] === "object") { if (saved[k] && typeof saved[k] === "object") d[k] = { ...d[k], ...saved[k] }; }
    else if (typeof saved[k] === typeof d[k]) d[k] = saved[k];
  }
  return d;
}
function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) { db = mergeDefaults(JSON.parse(raw)); return db; } } catch (e) {}
  db = DEFAULT(); return db;
}
function persist() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { toast("Couldn't save to this browser; export release.json to keep your work."); } }
function emit(external) { listeners.forEach(fn => { try { fn(db, external); } catch (e) { console.error(e); } }); updateRelBar(); }
const get = () => db || load();
function set(section, value) { get(); db[section] = value; persist(); emit(false); }
function patch(section, p) { get(); db[section] = { ...db[section], ...p }; persist(); emit(false); }
function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
window.addEventListener("storage", (e) => {
  if (e.key === KEY) { load(); emit(true); }
  if (e.key === IMG_KEY) { imgPromise = null; imgListeners.forEach(fn => fn()); }
});

/* ---------- the cover image (shared, stored downscaled) ---------- */
let imgPromise = null, memImage = null;
const imgListeners = new Set();
const onImage = (fn) => { imgListeners.add(fn); return () => imgListeners.delete(fn); };
function imageData() { return memImage || (() => { try { return localStorage.getItem(IMG_KEY); } catch (e) { return null; } })(); }
function image() {
  if (imgPromise) return imgPromise;
  const url = imageData();
  imgPromise = !url ? Promise.resolve(null) : new Promise(res => {
    const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = url;
  });
  return imgPromise;
}
async function setImageSource(src, name) {
  const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
  const store = (cap, q) => {
    const s = Math.min(1, cap / Math.max(im.naturalWidth, im.naturalHeight));
    const c = document.createElement("canvas"); c.width = Math.round(im.naturalWidth * s); c.height = Math.round(im.naturalHeight * s);
    c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", q);
  };
  let url = store(2000, 0.86); memImage = null;
  const meta = { name: name || "image", w: im.naturalWidth, h: im.naturalHeight };
  try { localStorage.setItem(IMG_KEY, url); }
  catch (e) {
    try { url = store(1200, 0.8); localStorage.setItem(IMG_KEY, url); toast("Image stored smaller so it fits this browser."); }
    catch (e2) { memImage = url; toast("Image is too large to share between tools in this browser; it will only last on this page."); }
  }
  try { localStorage.setItem(IMG_KEY + ".meta", JSON.stringify(meta)); } catch (e) {}
  imgPromise = null; imgListeners.forEach(fn => fn());
}
function setImageFile(file) {
  if (!file || !file.type.startsWith("image/")) { toast("That isn't an image file."); return Promise.resolve(); }
  return new Promise(res => {
    const r = new FileReader();
    r.onload = () => setImageSource(r.result, file.name).then(res, () => { toast("Couldn't read that image."); res(); });
    r.readAsDataURL(file);
  });
}
function clearImage() {
  memImage = null;
  try { localStorage.removeItem(IMG_KEY); localStorage.removeItem(IMG_KEY + ".meta"); } catch (e) {}
  imgPromise = null; imgListeners.forEach(fn => fn());
}
function imageMeta() { try { return JSON.parse(localStorage.getItem(IMG_KEY + ".meta")) || null; } catch (e) { return null; } }

/* Wire a drop zone + file input + info line to the shared image. */
function bindImageDrop({ drop, input, text, meta, info, clear }) {
  const label = "Drop an image here, or tap to choose";
  const refresh = async () => {
    const im = await image(); const m = imageMeta();
    if (meta) meta.hidden = !im;
    if (info && im) info.textContent = `${(m && m.name) || "image"} · ${im.naturalWidth}×${im.naturalHeight}`;
    if (text) text.textContent = im ? "Drop another image to replace it" : label;
  };
  input.addEventListener("change", e => setImageFile(e.target.files[0]).then(() => { input.value = ""; }));
  ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", e => setImageFile(e.dataTransfer.files[0]));
  if (clear) clear.addEventListener("click", clearImage);
  onImage(refresh); refresh();
}

/* ---------- import / export ---------- */
async function exportObject(withImage = true) {
  const o = clone(get()); o.schema = SCHEMA; o.exported = new Date().toISOString();
  if (withImage) { const url = imageData(); if (url) o.image = { dataUrl: url, ...(imageMeta() || {}) }; }
  return o;
}
async function downloadRelease() {
  const o = await exportObject(true); const r = o.release;
  download(JSON.stringify(o, null, 2), `${safeName(r.catalog || "release")}_release.json`, "application/json");
  toast("Saved release.json");
}
async function importObject(o) {
  if (!o || typeof o !== "object" || typeof o.schema !== "string" || !o.schema.startsWith("sleevepress.release/"))
    throw new Error("not a release file");
  db = mergeDefaults(o); persist();
  if (o.image && o.image.dataUrl) { await setImageSource(o.image.dataUrl, o.image.name); } else { clearImage(); }
  emit(false);
}
function importFile(file) {
  return new Promise((res) => {
    const r = new FileReader();
    r.onload = async () => {
      try { await importObject(JSON.parse(r.result)); toast("Release loaded"); }
      catch (e) { toast("That isn't a release.json from Sleeve Press."); }
      res();
    };
    r.readAsText(file);
  });
}
function reset() { db = DEFAULT(); persist(); clearImage(); emit(false); }

/* ---------- tracks ---------- */
const KEY_RE = /^[A-G][#b♯♭]?\s?(m|min|minor|maj|major|dim|aug)?$/i;
const TIME_RE = /^\d{1,3}:\d{2}$/;
const BPM_RE = /^(\d{2,3})(\.\d+)?\s*(bpm)?$/i;
const FEAT_RE = /^\(?\s*(feat\.?|ft\.?|featuring|with)\s+(.+?)\s*\)?$/i;
/* Forgiving: "01. Title | feat. X | 140 | Am | 3:45", in any order after the title, split by | or tab.
   A line that is only "--" or "--- B" starts side B. */
function parseTracks(text) {
  const out = []; let side = "A";
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    const mk = /^[-–—=]{2,}\s*(?:side\s*)?([A-D])?\s*[-–—=]*$/i.exec(line);
    if (mk) { side = (mk[1] || String.fromCharCode(side.charCodeAt(0) + 1)).toUpperCase(); continue; }
    const parts = line.split(/\s*[|\t]\s*/).map(s => s.trim()).filter(Boolean);
    // Leading numbering: "1.", "01)", "01 ", "A1 ", "3 - ". A bare "99 Problems" keeps its number.
    parts[0] = parts[0].replace(/^(?:\d{1,3}\s*[.)]\s*|\d{1,3}\s+[-–]\s+|0\d\s+|[A-D]\d{1,2}\s*[.)\-–:]?\s+)/, "");
    const t = { title: "", feat: "", bpm: "", key: "", length: "", side };
    for (const p of parts) {
      let m;
      if (TIME_RE.test(p)) t.length = p;
      else if ((m = FEAT_RE.exec(p))) t.feat = m[2];
      else if (t.title && (m = BPM_RE.exec(p)) && +m[1] >= 40 && +m[1] <= 300) t.bpm = m[1];
      else if (t.title && KEY_RE.test(p)) t.key = p.replace(/\s+/g, "").replace(/^([A-G])b/, "$1♭").replace(/^([A-G])#/, "$1♯");
      else if (!t.title) {
        const inline = /^(.*?)\s*[(\[]\s*(?:feat\.?|ft\.?|featuring)\s+([^)\]]+)[)\]]\s*$/i.exec(p);
        if (inline) { t.title = inline[1]; t.feat = inline[2]; } else t.title = p;
      } else t.title += " " + p;
    }
    if (t.title) out.push(t);
  }
  return out;
}
function tracksToText(tracks) {
  let side = null, lines = [];
  tracks.forEach((t, i) => {
    if (side && t.side !== side) lines.push(`--- ${t.side}`);
    side = t.side || "A";
    const bits = [t.title + (t.feat ? ` (feat. ${t.feat})` : "")];
    if (t.bpm) bits.push(t.bpm); if (t.key) bits.push(t.key); if (t.length) bits.push(t.length);
    lines.push(bits.join(" | "));
  });
  return lines.join("\n");
}
function secs(len) { const m = /^(\d+):(\d{2})$/.exec(len || ""); return m ? (+m[1]) * 60 + (+m[2]) : 0; }
function fmtTime(s) {
  s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}
const runtime = (tracks) => tracks.reduce((a, t) => a + secs(t.length), 0);

/* ---------- nav + release bar ---------- */
let navMounted = false;
function titleLine(r) { return (r.title || "").replace(/\s*\n\s*/g, " ").trim(); }
function updateRelBar() {
  const el = $("sp-relid"); if (!el) return;
  const d = get(), r = d.release;
  el.innerHTML = "";
  const dot = document.createElement("span"); dot.className = "dot"; dot.style.background = d.palette.bg; dot.style.boxShadow = `inset 0 -4px 0 ${d.palette.ink}, inset -4px 0 0 ${d.palette.accent}`;
  const b = document.createElement("b"); b.textContent = [r.artist, titleLine(r)].filter(Boolean).join(" — ") || "Untitled release";
  const s = document.createElement("span");
  s.textContent = [r.catalog, r.format, d.tracks.length ? `${d.tracks.length} track${d.tracks.length === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
  el.append(dot, b, s);
}
function mountNav(current) {
  const host = $("sp-nav"); if (!host || navMounted) return; navMounted = true;
  host.innerHTML = `
    <header class="deck">
      <a class="brand" href="index.html">Sleeve Press</a>
      <nav aria-label="Tools"></nav>
    </header>
    <div class="relbar">
      <div class="rel-id" id="sp-relid"></div>
      <div class="btn-row">
        <button type="button" class="btn" id="sp-export">Export release.json</button>
        <label class="btn" for="sp-import">Import<input type="file" id="sp-import" accept=".json,application/json" style="display:none"></label>
      </div>
    </div>`;
  const nav = host.querySelector("nav");
  for (const [href, label] of TOOLS) {
    const a = document.createElement("a"); a.href = href; a.textContent = label;
    if (href === current) a.setAttribute("aria-current", "page");
    nav.appendChild(a);
  }
  $("sp-export").addEventListener("click", downloadRelease);
  $("sp-import").addEventListener("change", async (e) => { const f = e.target.files[0]; if (f) await importFile(f); e.target.value = ""; });
  updateRelBar();
}

/* ---------- UI helpers ---------- */
function bindSeg(el, getVal, onPick) {
  const refresh = () => { for (const b of el.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.v === String(getVal()))); };
  el.addEventListener("click", e => { const b = e.target.closest("button"); if (b) { onPick(b.dataset.v); refresh(); } });
  refresh(); return refresh;
}
function debounce(fn, ms = 120) { let h; return (...a) => { clearTimeout(h); h = setTimeout(() => fn(...a), ms); }; }
function rafOnce(fn) { let q = false; return () => { if (q) return; q = true; requestAnimationFrame(() => { q = false; fn(); }); }; }

const FONTS = ["Archivo", "Inter Tight", "Barlow Condensed", "Oswald", "DM Serif Display"];
const PRESETS = [
  { name: "Nine Night", bg: "#15120f", ink: "#ece6da", accent: "#9b1b1e" },
  { name: "Foreign", bg: "#0f1316", ink: "#d7dde1", accent: "#6f8796" },
  { name: "Day Clean", bg: "#e8e2d4", ink: "#17130f", accent: "#9b1b1e" },
  { name: "Golden Hour", bg: "#2a1a0f", ink: "#f2dfb6", accent: "#d9a23a" },
  { name: "Dubplate", bg: "#0a0a0a", ink: "#bfbfbf", accent: "#ffffff" },
  { name: "Scandal Bag", bg: "#101a14", ink: "#dbe6d6", accent: "#e8c23a" },
];
const DEMO_TRACKS = [
  "Candle at the Gate | 72 | Dm | 3:41",
  "Yard Morning | feat. Mama Bright | 74 | Gm | 4:05",
  "White Rum Libation | 70 | Am | 3:28",
  "Ninth Night | 72 | Dm | 5:12",
  "Long Table | 68 | Cm | 3:55",
  "Roll Call | 140 | Em | 3:17",
  "Wake Dub | 70 | Dm | 6:02",
  "Sunrise Version | 72 | F | 4:30",
  "Nine Bars | 144 | Am | 2:49",
].join("\n");

window.SP = {
  KEY, SCHEMA, TOOLS, FONTS, PRESETS, DEMO_TRACKS, $,
  hexToRgb, rgbToHex, rgba, lum, relLum, contrast, rgbToHsl, hslToRgb, rgbToLab, labDist,
  safeName, mulberry32, hashStr, clone, toast, download, copy, canvasBlob, debounce, rafOnce, bindSeg,
  get, set, patch, on, reset,
  image, setImageFile, setImageSource, clearImage, imageMeta, onImage, bindImageDrop,
  exportObject, downloadRelease, importFile, importObject,
  parseTracks, tracksToText, secs, fmtTime, runtime, titleLine,
  mountNav,
};
load();
})();
