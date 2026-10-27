/* Sleeve Press: shared core.
   One release record lives in memory for the whole app and is written through to the browser.
   Pictures and the library live in IndexedDB; release.json / library backups carry them between machines. */
(function () {
"use strict";

const KEY = "sleevepress.release.v1";
const IMG_KEY = "sleevepress.image.v1";
const SCHEMA = "sleevepress.release/1";

/* The words a new release starts with. Built-ins below; the user's own (Settings → Defaults) win. */
const DEFAULTS_KEY = "sleevepress.defaults";
const BUILTIN_WORDS = {
  artist: "NIGHT SHIFT", title: "SLEEVE\nPRESS", catalog: "HPR-001", year: "2026",
  footer: "HPR-001 · 2026", format: "EP", label: "HOUSE PRESS RECORDS",
  date: "", cta: "OUT NOW", links: "Spotify · Apple Music · Bandcamp",
};
const WORD_KEYS = Object.keys(BUILTIN_WORDS);
function userDefaults() { try { const o = JSON.parse(localStorage.getItem(DEFAULTS_KEY) || "null"); return o && typeof o === "object" ? o : {}; } catch (e) { return {}; } }
function defaultWords() { const u = userDefaults(), o = { ...BUILTIN_WORDS }; for (const k of WORD_KEYS) if (typeof u[k] === "string") o[k] = u[k]; return o; }
function setDefaultWords(o) { const keep = {}; for (const k of WORD_KEYS) if (typeof o[k] === "string") keep[k] = o[k]; try { localStorage.setItem(DEFAULTS_KEY, JSON.stringify(keep)); return true; } catch (e) { return false; } }

const DEFAULT = () => ({
  schema: SCHEMA,
  release: defaultWords(),
  palette: { bg: "#15120f", ink: "#ece6da", accent: "#9b1b1e", name: "House", swatches: [], words: "" },
  tracks: [],      // [{ title, feat, bpm, key, length, side }]
  sleeve: {},      // Sleeve Press settings beyond the shared fields (merged over its own defaults)
  typeset: {},     // Tracklist settings
  style: {},       // Style Forge state + generated prompt/exclude/structure/batch
  names: { shortlist: [], seed: 1 },
  kit: { series: [], sizes: null },
  looks: [],       // flagged looks: [{ id, name, look: {sleeve look keys + bg/ink/accent}, ts }]
  print: {},       // Print settings
  promo: {},       // Export/promo settings
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

/* ---------- vault: IndexedDB key/value for images and the library, memory if the browser refuses ---------- */
const mem = new Map();
let idbP = null;
function idb() {
  if (idbP) return idbP;
  idbP = new Promise(res => {
    try {
      const r = indexedDB.open("sleevepress", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null);
    } catch (e) { res(null); }
  });
  return idbP;
}
const vault = {
  async get(k) {
    const d = await idb(); if (!d) return mem.get(k);
    return new Promise(res => { try { const q = d.transaction("kv").objectStore("kv").get(k); q.onsuccess = () => res(q.result ?? mem.get(k)); q.onerror = () => res(mem.get(k)); } catch (e) { res(mem.get(k)); } });
  },
  async set(k, v) {
    mem.set(k, v); const d = await idb(); if (!d) { setStatus("memory"); return false; }
    return new Promise(res => { try { const t = d.transaction("kv", "readwrite"); t.objectStore("kv").put(v, k); t.oncomplete = () => res(true); t.onerror = t.onabort = () => { setStatus("memory"); res(false); }; } catch (e) { setStatus("memory"); res(false); } });
  },
  async del(k) {
    mem.delete(k); const d = await idb(); if (!d) return;
    return new Promise(res => { try { const t = d.transaction("kv", "readwrite"); t.objectStore("kv").delete(k); t.oncomplete = () => res(); t.onerror = t.onabort = () => res(); } catch (e) { res(); } });
  },
};

/* Where work is being kept: "browser" (survives reloads) or "memory" (lost on reload; use Backup). */
let status = "browser";
const statusListeners = new Set();
function setStatus(s) { if (s === status) return; status = s; statusListeners.forEach(fn => fn(s)); }

/* ---------- the release record (one, in memory; written through to the browser) ---------- */
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
  if (typeof saved.libId === "string") d.libId = saved.libId;   // which saved release this came from
  if (typeof saved.saved === "number") d.saved = saved.saved;
  return d;
}
let fresh = false;   // nothing was stored: a first visit (or storage was cleared)
function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) { db = mergeDefaults(JSON.parse(raw)); fresh = false; return db; } } catch (e) { setStatus("memory"); }
  db = DEFAULT(); fresh = true; return db;
}
/* Writes are batched; `pending` marks a change that hasn't reached storage yet. */
let pending = false;
const persistSoon = (() => { let h; return () => { pending = true; clearTimeout(h); h = setTimeout(persist, 150); }; })();
function persist() {
  pending = false;
  if (!db || wiped) return;
  db.saved = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify(db)); vault.del("record"); }
  catch (e) { vault.set("record", clone(db)).then(ok => { if (!ok) setStatus("memory"); }); }
}
/* If localStorage was full or refused, the newest copy went to IndexedDB: prefer it when it is newer. */
async function recoverRecord() {
  const v = await vault.get("record");
  if (v && typeof v === "object" && (v.saved || 0) > ((db && db.saved) || 0)) { db = mergeDefaults(v); emit(true); }
}
function emit(external) { listeners.forEach(fn => { try { fn(db, external); } catch (e) { console.error(e); } }); }
const get = () => db || load();
function set(section, value) { get(); db[section] = value; persistSoon(); emit(false); }
function patch(section, p) { get(); db[section] = { ...db[section], ...p }; persistSoon(); emit(false); }
function replace(record) { db = mergeDefaults(record); persistSoon(); emit(false); }
function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
/* Fired when a different release is swapped in (open, import, start blank): undo history must not cross it. */
const switchFns = new Set();
const onSwitch = (fn) => { switchFns.add(fn); return () => switchFns.delete(fn); };
const switched = () => switchFns.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
window.addEventListener("storage", (e) => { if (e.key === KEY) { load(); emit(true); } });
// Only flush a change that is still waiting. Saving unconditionally here would write the old release straight back
// after someone clears the site's storage and reloads.
window.addEventListener("beforeunload", () => { if (db && pending && !wiped) persist(); });

/* ---------- shared pictures: the cover image and the label logo ---------- */
function asset(name, cap, mime) {
  let url = null, meta = null, ready = null, promise = null;
  const fns = new Set();
  const changed = () => { promise = null; fns.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); };
  const init = () => ready || (ready = (async () => {
    let v = await vault.get(name);
    if (!v && name === "image") {   // carry over a cover stored by the older multi-page version
      try { const old = localStorage.getItem(IMG_KEY); if (old) { v = { url: old, meta: JSON.parse(localStorage.getItem(IMG_KEY + ".meta") || "null") }; if (await vault.set(name, v)) { localStorage.removeItem(IMG_KEY); localStorage.removeItem(IMG_KEY + ".meta"); } } } catch (e) {}
    }
    if (v && v.url) { url = v.url; meta = v.meta || null; }
  })());
  const api = {
    async image() {
      await init(); if (promise) return promise;
      promise = !url ? Promise.resolve(null) : new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = url; });
      return promise;
    },
    async data() { await init(); return url; },
    meta: () => meta,
    async setSource(src, fname) {
      await init();
      const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
      const s = Math.min(1, cap / Math.max(im.naturalWidth, im.naturalHeight));
      const c = document.createElement("canvas"); c.width = Math.round(im.naturalWidth * s); c.height = Math.round(im.naturalHeight * s);
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
      url = mime === "image/png" ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.88);
      meta = { name: fname || name, w: im.naturalWidth, h: im.naturalHeight };
      await vault.set(name, { url, meta }); changed();
    },
    setFile(file) {
      if (!file || !file.type.startsWith("image/")) { toast("That isn't an image file."); return Promise.resolve(); }
      return new Promise(res => {
        const r = new FileReader();
        r.onload = () => api.setSource(r.result, file.name).then(res, () => { toast("Couldn't read that image."); res(); });
        r.readAsDataURL(file);
      });
    },
    async clear() { await init(); url = null; meta = null; await vault.del(name); changed(); },
    on(fn) { fns.add(fn); return () => fns.delete(fn); },
  };
  return api;
}
const cover = asset("image", 2400, "image/jpeg");
const logo = asset("logo", 900, "image/png");

/* Wire a drop zone + file input to a shared picture. */
function bindDrop(target, { drop, input, onText }) {
  if (input) input.addEventListener("change", e => target.setFile(e.target.files[0]).then(() => { input.value = ""; }));
  ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", e => { const f = e.dataTransfer.files[0]; if (f) target.setFile(f); });
  if (onText) { const refresh = async () => onText(await target.image(), target.meta()); target.on(refresh); refresh(); }
}

/* ---------- import / export ---------- */
async function exportObject(withImage = true) {
  const o = clone(get()); o.schema = SCHEMA; o.exported = new Date().toISOString();
  if (withImage) {
    const u = await cover.data(); if (u) o.image = { dataUrl: u, ...(cover.meta() || {}) };
    const l = await logo.data(); if (l) o.logo = { dataUrl: l, ...(logo.meta() || {}) };
  }
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
  const looks = get().looks; switched();
  db = mergeDefaults(o); db.looks = [...looks, ...db.looks.filter(l => l && l.id && !looks.some(k => k.id === l.id))]; persist();
  if (o.image && o.image.dataUrl) await cover.setSource(o.image.dataUrl, o.image.name); else await cover.clear();
  if (o.logo && o.logo.dataUrl) await logo.setSource(o.logo.dataUrl, o.logo.name);
  emit(false);
}
function readJSON(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => { try { res(JSON.parse(r.result)); } catch (e) { rej(e); } }; r.onerror = rej; r.readAsText(file); });
}
async function importFile(file) {
  try {
    const o = await readJSON(file);
    if (o && o.schema === LIB_SCHEMA) { const n = await library.restore(o); toast(`Restored ${n} saved release${n === 1 ? "" : "s"} and your flagged looks`); return "library"; }
    await importObject(o); toast("Release loaded"); return "release";
  } catch (e) { toast("That isn't a Sleeve Press file."); return null; }
}
/* A new release: the default words (or `words`), the current look kept unless `freshLook`, no picture, no tracks. */
async function reset(words, opts = {}) {
  switched(); const keep = get(); db = DEFAULT();
  if (!opts.freshLook) { db.sleeve = { ...keep.sleeve }; db.palette = { ...keep.palette }; db.typeset = { ...keep.typeset }; }
  db.looks = keep.looks;
  if (words) for (const k of WORD_KEYS) if (typeof words[k] === "string") db.release[k] = words[k];
  persist(); await cover.clear(); emit(false);
}
/* Settings → Reset everything: every trace of the app in this browser, then a reload. */
async function wipeAll() {
  pending = false; db = null;
  try { Object.keys(localStorage).filter(k => k.startsWith("sleevepress")).forEach(k => localStorage.removeItem(k)); } catch (e) {}
  mem.clear();
  await new Promise(res => { try { const d = idbP; idbP = null; Promise.resolve(d).then(x => { try { x && x.close(); } catch (e) {} const r = indexedDB.deleteDatabase("sleevepress"); r.onsuccess = r.onerror = r.onblocked = () => res(); }); } catch (e) { res(); } });
  wiped = true;
}
let wiped = false;

/* ---------- the library: saved releases (with their pictures) ---------- */
const LIB_SCHEMA = "sleevepress.library/1";
const libListeners = new Set();
const library = {
  async list() { return (await vault.get("lib.index")) || []; },
  on(fn) { libListeners.add(fn); return () => libListeners.delete(fn); },
  changed() { libListeners.forEach(fn => fn()); },
  /* Saves the current release. Same id as the one it was opened from = overwrite. */
  async save(thumbUrl, asNew) {
    const rec = clone(get()); let id = !asNew && rec.libId;
    const idx = await library.list(), prev = id && idx.find(e => e.id === id);
    if (!id || !idx.some(e => e.id === id)) { id = "r" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }
    rec.libId = id; db.libId = id; persistSoon();
    const auto = [rec.release.artist, titleLine(rec.release)].filter(Boolean).join(" — ") || "Untitled";
    const entry = { id, name: prev && prev.custom ? prev.name : auto, custom: !!(prev && prev.custom), catalog: rec.release.catalog, updated: Date.now(), thumb: thumbUrl || null };
    await vault.set("lib." + id, { record: rec, image: await cover.data(), imageMeta: cover.meta() });
    const next = [entry, ...idx.filter(e => e.id !== id)];
    await vault.set("lib.index", next); library.changed();
    return id;
  },
  async open(id) {
    const e = await vault.get("lib." + id); if (!e) return false;
    switched();
    const looks = get().looks; db = mergeDefaults(e.record); db.looks = looks; db.libId = id; persist();
    if (e.image) await cover.setSource(e.image, e.imageMeta && e.imageMeta.name); else await cover.clear();
    emit(false); return true;
  },
  async remove(id) { await vault.del("lib." + id); await vault.set("lib.index", (await library.list()).filter(e => e.id !== id)); library.changed(); },
  async rename(id, name) { await vault.set("lib.index", (await library.list()).map(e => e.id === id ? { ...e, name, custom: true } : e)); library.changed(); },
  async records() { const out = []; for (const e of await library.list()) { const r = await vault.get("lib." + e.id); if (r) out.push({ entry: e, ...r }); } return out; },
  async backup() {
    const o = { schema: LIB_SCHEMA, exported: new Date().toISOString(), looks: get().looks, label: get().release.label, logo: await logo.data(), releases: await library.records() };
    download(JSON.stringify(o), `sleevepress_library_${new Date().toISOString().slice(0, 10)}.json`, "application/json");
  },
  async restore(o) {
    const idx = await library.list(); let n = 0;
    for (const r of o.releases || []) {
      if (!r.entry || !r.record) continue;
      await vault.set("lib." + r.entry.id, { record: r.record, image: r.image || null, imageMeta: r.imageMeta || null });
      idx.splice(0, idx.length, ...[r.entry, ...idx.filter(e => e.id !== r.entry.id)]); n++;
    }
    await vault.set("lib.index", idx);
    const have = new Set(get().looks.map(l => l.id));
    set("looks", [...get().looks, ...(o.looks || []).filter(l => !have.has(l.id))]);
    if (o.logo) await logo.setSource(o.logo, "logo");
    library.changed(); return n;
  },
};

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

function titleLine(r) { return (r.title || "").replace(/\s*\n\s*/g, " ").trim(); }

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
  KEY, SCHEMA, WORD_KEYS, defaultWords, setDefaultWords, wipeAll, isFresh: () => fresh, FONTS, PRESETS, DEMO_TRACKS, $, vault, library, cover, logo, bindDrop, replace, readJSON, onSwitch,
  status: () => status, onStatus: (fn) => { statusListeners.add(fn); return () => statusListeners.delete(fn); },
  hexToRgb, rgbToHex, rgba, lum, relLum, contrast, rgbToHsl, hslToRgb, rgbToLab, labDist,
  safeName, mulberry32, hashStr, clone, toast, download, copy, canvasBlob, debounce, rafOnce, bindSeg,
  get, set, patch, on, reset,
  exportObject, downloadRelease, importFile, importObject,
  parseTracks, tracksToText, secs, fmtTime, runtime, titleLine,
};
load(); recoverRecord();
})();
