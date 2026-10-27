/* Sleeve Press: the app shell. One page, one release in memory, views swapped by the URL hash.
   Views register with App.view(name, { label, mount(el), show(), hide() }); mount runs once, on first visit. */
(function () {
"use strict";
const SR = SleeveRender, $ = SP.$;

const views = {}, order = [];
let current = null;

/* ---------- state helpers every view uses ---------- */
function state() { const d = SP.get(), s = SR.flatten(d); s.paletteName = d.palette.name; return s; }

/* Undo history of whole records. Changes within 700 ms of each other fold into one step. */
const past = [], future = []; let lastPush = 0;
function checkpoint(force) {
  const now = Date.now();
  if (force || now - lastPush > 700) { past.push(SP.clone(SP.get())); if (past.length > 80) past.shift(); future.length = 0; }
  lastPush = now; updateUndo();
}
/* Flags and the library link aren't edits: they stay as they are now whichever way you step. */
function restore(rec) { const cur = SP.get(), r = { ...rec, looks: cur.looks }; if (cur.libId) r.libId = cur.libId; else delete r.libId; SP.replace(r); }
function undo() { if (!past.length) return; future.push(SP.clone(SP.get())); restore(past.pop()); lastPush = 0; updateUndo(); }
function redo() { if (!future.length) return; past.push(SP.clone(SP.get())); restore(future.pop()); lastPush = 0; updateUndo(); }
function clearHistory() { past.length = 0; future.length = 0; lastPush = 0; updateUndo(); }
SP.onSwitch(clearHistory);
const undoFns = new Set();
function updateUndo() { undoFns.forEach(fn => fn(past.length, future.length)); }

/* Writes a flat sleeve state back into the record's release / palette / sleeve sections. */
function commit(st, opts = {}) {
  if (opts.undo !== false) checkpoint(opts.force);
  const d = SP.get();
  const sleeve = { ...d.sleeve }; for (const k of Object.keys(SR.SLEEVE_DEFAULTS)) if (k in st) sleeve[k] = st[k];
  const release = { ...d.release }; for (const k of SR.RELEASE_KEYS) if (k in st) release[k] = st[k];
  const palette = { ...d.palette }; let changed = false;
  for (const k of SR.PALETTE_KEYS) if (k in st && st[k] !== palette[k]) { palette[k] = st[k]; changed = true; }
  if (opts.paletteName) palette.name = opts.paletteName; else if (st.paletteName && changed) palette.name = st.paletteName; else if (changed) palette.name = "Custom";
  const next = { ...d, sleeve, release, palette };
  SP.replace(next);
}
/* Apply a look (sleeve look keys + colours) to the current release, keeping its words and image placement. */
function applyLook(look, opts = {}) {
  look = completeLook(look);
  const st = { ...state() };
  for (const k of SR.LOOK_KEYS) if (k in look) st[k] = look[k];
  for (const k of SR.PALETTE_KEYS) if (look[k]) st[k] = look[k];
  commit(st, { force: true, paletteName: look.paletteName || "Look", ...opts });
}

/* ---------- flagged looks ---------- */
/* Keys added after looks were first flagged: left out of the id while unused, so older flags keep their ids. */
const LATER_KEYS = new Set(["shapeOutline", "shapeRot", "pattern", "patternAmt", "patternScale", "patternAngle", "patternArea", "patternPos", "patternColor", "patternSeed"]);
function lookId(look) {
  const D = SR.SLEEVE_DEFAULTS, noPattern = !look.pattern || look.pattern === "none";
  const keys = SR.LOOK_KEYS.filter(k => !LATER_KEYS.has(k) || !(look[k] === undefined || look[k] === D[k] || (noPattern && k.startsWith("pattern"))));
  return "L" + SP.hashStr(JSON.stringify(keys.map(k => look[k])) + look.bg + look.ink + look.accent).toString(36);
}
/* A saved look with any settings it predates filled from the defaults. */
function completeLook(look) { const o = { ...look }; for (const k of SR.LOOK_KEYS) if (!(k in o)) o[k] = SR.SLEEVE_DEFAULTS[k]; return o; }
const sameLook = (l, id) => l.id === id || (l.look && lookId(l.look) === id);
function flagged() { return SP.get().looks; }
function isFlagged(look) { const id = lookId(look); return flagged().some(l => sameLook(l, id)); }
function flag(look, name) {
  const id = lookId(look); if (flagged().some(l => sameLook(l, id))) return id;
  SP.set("looks", [{ id, name: name || look.paletteName || "Look", look: { ...look }, ts: Date.now() }, ...flagged()]);
  return id;
}
function unflag(idOrLook) { if (!idOrLook) return; const id = typeof idOrLook === "string" ? idOrLook : lookId(idOrLook); SP.set("looks", flagged().filter(l => !sameLook(l, id))); }
function toggleFlag(look) { if (isFlagged(look)) { unflag(look); return false; } flag(look); return true; }

/* ---------- pictures ---------- */
let small = null, smallFor = null;
/* A ~600 px copy of the cover for thumbnails, so toning dozens of them stays quick. */
async function smallImage() {
  const im = await SP.cover.image(); if (!im) return null;
  if (smallFor === im) return small;
  const s = Math.min(1, 600 / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement("canvas");
  c.width = Math.round(im.naturalWidth * s); c.height = Math.round(im.naturalHeight * s); c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
  small = c; smallFor = im; return c;
}
/* Renders a look (or the current state) with the current words and picture into a canvas of `size`. */
async function thumb(canvasOrSize, st) {
  const c = typeof canvasOrSize === "number" ? Object.assign(document.createElement("canvas"), { width: canvasOrSize, height: canvasOrSize }) : canvasOrSize;
  await SR.render(c, st || state(), await smallImage(), await SP.logo.image());
  return c;
}
async function env() { return Makers.env(SP.get(), await SP.cover.image(), await SP.logo.image()); }

/* ---------- saving ---------- */
async function saveToLibrary(asNew) {
  const c = await thumb(320);
  const id = await SP.library.save(c.toDataURL("image/jpeg", 0.82), asNew);
  SP.toast(asNew ? "Saved as a new release in your library" : "Saved to your library");
  return id;
}
/* Starts the next release in a series: same look and label, next catalogue number, words cleared. */
function nextRelease() {
  clearHistory();
  const d = SP.clone(SP.get()), r = d.release;
  const m = /^(.*?)(\d+)(\D*)$/.exec(r.catalog || "");
  const nextCat = m ? m[1] + String(+m[2] + 1).padStart(m[2].length, "0") + m[3] : r.catalog;
  d.release = { ...r, title: "UNTITLED", catalog: nextCat, footer: (r.footer || "").split(r.catalog || "\u0000").join(nextCat), date: "" };
  d.tracks = []; d.style = { ...d.style, batch: [] }; d.names = { ...d.names, shortlist: [] }; delete d.libId;
  d.sleeve = { ...d.sleeve, plateText: "", barcodeDigits: "", lookSeed: d.sleeve.lookSeed };
  SP.replace(d); SP.cover.clear();
  SP.toast(`Started ${nextCat || "a new release"}: same look and label`);
}

/* ---------- views + routing ---------- */
function view(name, def) { views[name] = def; order.push(name); }
function go(name) { if (location.hash !== "#" + name) location.hash = name; else route(); }
function route() {
  const name = (location.hash.slice(1) || "discover").split("/")[0];
  const v = views[name] ? name : "discover";
  if (current === v) return;
  if (current && views[current].hide) views[current].hide();
  for (const [n, d] of Object.entries(views)) { if (d.el) d.el.hidden = n !== v; }
  const d = views[v];
  if (!d.el) {
    d.el = document.createElement("section"); d.el.className = "view view-" + v; d.el.setAttribute("aria-label", d.label);
    $("views").appendChild(d.el); d.mount(d.el);
  }
  d.el.hidden = false; current = v;
  document.querySelectorAll("[data-go]").forEach(a => a.setAttribute("aria-current", a.dataset.go === v ? "page" : "false"));
  document.body.dataset.view = v;
  if (d.show) d.show();
  window.scrollTo(0, 0);
}

/* ---------- top bar ---------- */
function mountBar() {
  const bar = $("bar");
  bar.innerHTML = `
    <a class="brand" href="#discover">Sleeve Press</a>
    <nav class="tabs" aria-label="Sections"></nav>
    <div class="bar-right">
      <button type="button" class="relchip" id="relchip" title="Edit the words on the cover"><i></i><b></b><span></span></button>
      <span class="status" id="status" title=""></span>
      <button type="button" class="btn small" id="undoBtn" title="Undo (Ctrl+Z)" aria-label="Undo" disabled>↶</button>
      <button type="button" class="btn small" id="redoBtn" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled>↷</button>
      <button type="button" class="btn small primary" id="saveBtn" title="Save this release to your library (Ctrl+S)">Save</button>
    </div>`;
  const nav = bar.querySelector(".tabs");
  for (const n of order) {
    const d = views[n]; if (d.hidden) continue;
    const a = document.createElement("a"); a.href = "#" + n; a.dataset.go = n; a.textContent = d.label;
    if (d.minor) a.className = "minor";
    nav.appendChild(a);
  }
  const chip = $("relchip");
  const refresh = () => {
    const d = SP.get(), r = d.release;
    chip.querySelector("i").style.background = `linear-gradient(90deg, ${d.palette.bg} 0 50%, ${d.palette.ink} 50% 80%, ${d.palette.accent} 80%)`;
    chip.querySelector("b").textContent = [r.artist, SP.titleLine(r)].filter(Boolean).join(" — ") || "Untitled release";
    chip.querySelector("span").textContent = [r.catalog, d.tracks.length ? `${d.tracks.length} tracks` : ""].filter(Boolean).join(" · ");
  };
  SP.on(refresh); refresh();
  chip.addEventListener("click", () => { go("design"); setTimeout(() => window.Design && Design.select && Design.select("title"), 30); });
  const st = $("status");
  const showStatus = (s) => {
    st.className = "status " + s;
    st.textContent = s === "browser" ? "Autosaved" : "Not saving";
    st.title = s === "browser" ? "Your work is kept in this browser. Save puts a copy in your library." : "This browser won't keep data for this page (private window or file:// restrictions). Use Library → Back up to keep your work.";
  };
  SP.onStatus(showStatus); showStatus(SP.status());
  $("saveBtn").addEventListener("click", () => saveToLibrary());
  $("undoBtn").addEventListener("click", undo); $("redoBtn").addEventListener("click", redo);
  undoFns.add((a, b) => { $("undoBtn").disabled = !a; $("redoBtn").disabled = !b; });
  document.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey; if (!mod) return;
    const a = document.activeElement;
    const typing = !!a && (a.tagName === "TEXTAREA" || a.isContentEditable || (a.tagName === "INPUT" && /^(text|search|number|email|url|tel|password)$/i.test(a.type)));
    if (e.key.toLowerCase() === "s") { e.preventDefault(); saveToLibrary(); }
    else if (e.key.toLowerCase() === "z" && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (e.key.toLowerCase() === "y" && !typing) { e.preventDefault(); redo(); }
  });
}

/* ---------- small DOM helpers shared by the views ---------- */
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v; else if (k === "html") el.innerHTML = v; else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v); else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  return el;
}
/* Watches elements and calls fn(el) the first time each scrolls near the viewport. */
function lazy(fn, margin = "600px") {
  if (!("IntersectionObserver" in window)) return { watch: (el) => fn(el) };
  const io = new IntersectionObserver((es) => es.forEach(e => { if (e.isIntersecting) { io.unobserve(e.target); fn(e.target); } }), { rootMargin: margin });
  return { watch: (el) => io.observe(el), stop: () => io.disconnect() };
}
/* Runs async jobs one at a time (keeps rendering from starving the page). */
function queue() {
  let chain = Promise.resolve();
  return (job) => (chain = chain.then(job).catch(e => console.error(e)));
}

/* Looks flagged by the older multi-page version were stored as { name, look } with no id. */
function migrateLooks() {
  const ls = SP.get().looks; if (ls.every(l => l && l.id && l.look)) return;
  SP.set("looks", ls.filter(l => l && l.look).map(l => l.id ? l : { ...l, id: lookId(l.look), ts: l.ts || Date.now() }));
}
function start() {
  migrateLooks(); SP.on(() => { if (SP.get().looks.some(l => !l || !l.id)) migrateLooks(); });
  mountBar(); window.addEventListener("hashchange", route); route();
}

window.App = { completeLook, state, commit, applyLook, checkpoint, undo, redo, view, go, start, lookId, flagged, isFlagged, flag, unflag, toggleFlag,
  smallImage, thumb, env, saveToLibrary, nextRelease, h, lazy, queue, current: () => current };
})();
