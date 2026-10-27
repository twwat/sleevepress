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
const LATER_KEYS = new Set(["imgEffect", "titleBleed", "titleRotate", "plates", "shapeOutline", "shapeRot", "pattern", "patternAmt", "patternScale", "patternAngle", "patternArea", "patternPos", "patternColor", "patternSeed"]);
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
  const id = await SP.library.save(c.toDataURL("image/jpeg", 0.82), asNew); markSaved();
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
  const navKey = FILE_VIEWS.includes(v) ? "files" : views[v].minor ? "more" : v;
  document.querySelectorAll("[data-go]").forEach(a => a.setAttribute("aria-current", a.dataset.go === navKey ? "page" : "false"));
  filesSwitch(v);
  document.body.dataset.view = v;
  if (d.show) d.show();
  window.scrollTo(0, 0);
}

/* ---------- dialogs and menus ---------- */
/* A modal: title, body (node or nodes), actions [{ label, primary, danger, onclick → false keeps it open }]. Esc / backdrop close it. */
function modal({ title, body, actions = [], wide }) {
  const close = () => { wrap.remove(); document.removeEventListener("keydown", esc); if (last && last.focus) last.focus(); };
  const esc = (e) => { if (e.key === "Escape") close(); };
  const last = document.activeElement;
  const box = h("div", { class: "dlg" + (wide ? " wide" : ""), role: "dialog", "aria-modal": "true", "aria-label": title },
    h("h2", {}, title), h("div", { class: "dlg-body" }, body),
    h("div", { class: "dlg-actions" }, ...actions.map(a => h("button", { type: "button", class: "btn" + (a.primary ? " primary" : "") + (a.danger ? " danger" : ""),
      onclick: async () => { const keep = a.onclick && (await a.onclick()) === false; if (!keep) close(); } }, a.label))));
  const wrap = h("div", { class: "dlg-wrap", onmousedown: (e) => { if (e.target === wrap) close(); } }, box);
  document.body.append(wrap); document.addEventListener("keydown", esc);
  const f = box.querySelector("input, textarea, button.primary, button"); if (f) f.focus();
  return { close, box };
}
/* A drop-down menu under a button. items: [{ label, sub, onclick } | "-"] or a function returning them. */
function menu(button, items) {
  let open = null;
  const shut = () => { if (open) { open.remove(); open = null; button.setAttribute("aria-expanded", "false"); document.removeEventListener("mousedown", away); document.removeEventListener("keydown", key); } };
  const away = (e) => { if (open && !open.contains(e.target) && e.target !== button && !button.contains(e.target)) shut(); };
  const key = (e) => { if (e.key === "Escape") { shut(); button.focus(); } };
  button.setAttribute("aria-haspopup", "menu"); button.setAttribute("aria-expanded", "false");
  button.addEventListener("click", async () => {
    if (open) return shut();
    const list = typeof items === "function" ? await items() : items;
    open = h("div", { class: "menu", role: "menu" }, ...list.map(it => it === "-" ? h("hr") : h("button", { type: "button", role: "menuitem", class: it.danger ? "danger" : null,
      onclick: () => { shut(); it.onclick(); } }, h("span", {}, it.label), it.sub ? h("small", {}, it.sub) : null)));
    document.body.append(open);
    const r = button.getBoundingClientRect(), w = Math.min(300, innerWidth - 16);
    Object.assign(open.style, { top: `${r.bottom + 6 + scrollY}px`, left: `${Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + scrollX}px`, width: `${w}px` });
    button.setAttribute("aria-expanded", "true");
    document.addEventListener("mousedown", away); document.addEventListener("keydown", key);
    const f = open.querySelector("button"); if (f) f.focus();
  });
  return shut;
}

/* ---------- "is this release saved in the library?" ---------- */
const sigOf = (rec) => { const r = SP.clone(rec); delete r.looks; delete r.libId; delete r.saved; delete r.exported; return JSON.stringify(r); };
let savedSig = null;
const statusFns = new Set();
function markSaved() { savedSig = sigOf(SP.get()); statusFns.forEach(fn => fn()); }
/* True when the current release has words or settings that aren't in the library. */
function unsaved() { return savedSig !== sigOf(SP.get()); }

/* ---------- the words form (first run, New release, Defaults) ---------- */
/* values pre-fill the fields; empty fields show an example in grey. */
function wordsForm(values, opts = {}) {
  const f = {}, field = (k, label, o = {}) => {
    const inp = o.area ? h("textarea", { rows: 2, class: "up", spellcheck: "false", placeholder: o.ph || "" }) : h("input", { type: "text", placeholder: o.ph || "", spellcheck: "false" });
    inp.value = values[k] || ""; f[k] = inp;
    return h("label", { class: "f" + (o.half ? " half" : "") }, h("span", {}, label), inp);
  };
  const el = h("div", { class: "wordsform" },
    h("div", { class: "row" }, field("artist", "Artist", { ph: "e.g. Night Shift" }), field("label", "Record label", { ph: "optional, e.g. House Press" })),
    field("title", "Title (one line per row)", { area: true, ph: "e.g. SLEEVE\nPRESS" }),
    h("div", { class: "row" }, field("catalog", "Catalogue no.", { ph: "made from the label if blank" }), field("year", "Year", { ph: String(new Date().getFullYear()) })),
    opts.footer !== false ? field("footer", "Footer line", { ph: "small print along the bottom (optional)" }) : null);
  return { el, f, values: () => Object.fromEntries(Object.entries(f).map(([k, i]) => [k, i.value.trim() ? i.value : ""])) };
}
/* Fills the gaps a person leaves: catalogue from the label's initials, this year, a footer from both. */
function completeWords(v) {
  const o = { ...v };
  if (!o.year) o.year = String(new Date().getFullYear());
  if (!o.catalog) { const ini = (o.label || o.artist || "").toUpperCase().replace(/[^A-Z0-9 ]/g, "").split(/\s+/).filter(Boolean).map(w => w[0]).join("").slice(0, 4); o.catalog = (ini || "CAT") + "-001"; }
  if (!o.footer) o.footer = [o.catalog, o.year].join(" · ");
  return o;
}
/* What the forms start with: only the person's own saved defaults, never the built-in demo words. */
function ownDefaults() { try { return JSON.parse(localStorage.getItem("sleevepress.defaults") || "{}") || {}; } catch (e) { return {}; } }
function pictureField() {
  const input = h("input", { type: "file", accept: "image/*", hidden: true });
  const txt = h("span", {}, "Add a picture (optional): drop it here or click");
  const drop = h("label", { class: "file-drop" }, input, txt);
  SP.bindDrop(SP.cover, { drop, input, onText: (im, m) => { txt.textContent = im ? `Picture: ${(m && m.name) || "added"} · drop another to replace` : "Add a picture (optional): drop it here or click"; } });
  return drop;
}

/* New release: ask about unsaved work, then a short form, then Discover. */
async function newRelease() {
  const go2 = () => {
    const form = wordsForm(ownDefaults());
    const keepLook = h("input", { type: "checkbox", checked: true });
    modal({ title: "New release", wide: true, body: [form.el, h("label", { class: "check" }, keepLook, "Keep the current look (colours, type, layout)"),
      h("p", { class: "hint" }, "To have fields filled in for you every time: ⚙ → Defaults for new releases.")],
      actions: [{ label: "Cancel" }, { label: "Start", primary: true, onclick: async () => {
        const v = form.values(); if (!v.artist.trim() && !v.title.trim()) { SP.toast("Type an artist or a title first"); return false; }
        await SP.reset({ ...completeWords(v), artist: v.artist, title: v.title }, { freshLook: !keepLook.checked }); clearHistory(); markSaved();
        go("discover"); SP.toast("New release started. Pick a design you like, or open Design.");
      } }] });
  };
  if (!unsaved()) return go2();
  modal({ title: "Keep this release?", body: h("p", {}, "This release isn't saved in your library yet. Save a copy before starting a new one?"),
    actions: [{ label: "Cancel" }, { label: "Don't save" , onclick: () => { setTimeout(go2, 0); } }, { label: "Save, then new", primary: true, onclick: async () => { await saveToLibrary(); setTimeout(go2, 0); } }] });
}
function openFile() {
  const inp = h("input", { type: "file", accept: ".json,application/json", hidden: true });
  inp.addEventListener("change", async () => { const f = inp.files[0]; inp.remove(); if (!f) return; const kind = await SP.importFile(f); if (kind === "release") { clearHistory(); markSaved(); go("design"); } else if (kind === "library") go("library"); });
  document.body.append(inp); inp.click();
}
async function openSaved(id) {
  const doOpen = async () => { if (await SP.library.open(id)) { markSaved(); go("design"); SP.toast("Opened"); } };
  if (!unsaved()) return doOpen();
  modal({ title: "Open another release?", body: h("p", {}, "The release you're on has changes that aren't in your library."),
    actions: [{ label: "Cancel" }, { label: "Open without saving", onclick: doOpen }, { label: "Save, then open", primary: true, onclick: async () => { await saveToLibrary(); await doOpen(); } }] });
}
function editDefaults() {
  const form = wordsForm(ownDefaults());
  modal({ title: "Defaults for new releases", wide: true, body: [h("p", { class: "hint" }, "New releases start with these filled in. Leave a field empty to type it each time. Kept in this browser."), form.el],
    actions: [{ label: "Cancel" },
      { label: "Copy from this release", onclick: () => { const r = SP.get().release; for (const k of ["artist", "label", "catalog", "year", "footer"]) form.f[k].value = r[k] || ""; SP.toast("Copied. Check them, then Save defaults"); return false; } },
      { label: "Save defaults", primary: true, onclick: () => { try { localStorage.setItem("sleevepress.defaults", JSON.stringify(form.values())); SP.toast("Defaults saved"); } catch (e) { SP.toast("This browser won't store settings"); } } }] });
}
function resetEverything() {
  modal({ title: "Reset everything?", body: [h("p", {}, "This deletes everything Sleeve Press keeps in this browser: the release you're on, your saved releases, flagged looks, logo and defaults. The page then reloads like a first visit."),
    h("p", { class: "hint" }, "Want to keep a copy? Cancel, then ⚙ → Back up everything.")],
    actions: [{ label: "Cancel" }, { label: "Delete everything", danger: true, onclick: async () => { await SP.wipeAll(); location.reload(); } }] });
}

/* First visit: a short start screen instead of somebody else's demo release. */
function welcome() {
  let welcomed = false; try { welcomed = !!localStorage.getItem("sleevepress.welcomed"); } catch (e) {}
  if (!SP.isFresh() || welcomed) return;
  const form = wordsForm(ownDefaults(), { footer: false });
  const asDefault = h("input", { type: "checkbox" });
  const done = () => { try { localStorage.setItem("sleevepress.welcomed", "1"); } catch (e) {} };
  modal({ title: "Start a release", wide: true, body: [
      h("p", {}, "Type your words and Sleeve Press makes endless cover designs from them. Everything stays in this browser."),
      form.el, pictureField(), h("label", { class: "check" }, asDefault, "Also use these as my defaults for new releases")],
    actions: [{ label: "Just show me an example", onclick: done },
      { label: "Show me designs", primary: true, onclick: async () => {
        const v = form.values(); if (!v.artist.trim() && !v.title.trim()) { SP.toast("Type an artist or a title first"); return false; }
        const w = completeWords(v);
        SP.replace({ ...SP.get(), release: { ...SP.get().release, ...w } }); clearHistory();
        if (asDefault.checked) { const { title, ...rest } = w; try { localStorage.setItem("sleevepress.defaults", JSON.stringify(rest)); } catch (e) {} }
        done(); go("discover");
      } }] });
}

/* ---------- top bar ---------- */
const FILE_VIEWS = ["export", "print"];
function mountBar() {
  const bar = $("bar");
  bar.innerHTML = `
    <a class="brand" href="#discover">Sleeve Press</a>
    <nav class="tabs" aria-label="Sections"></nav>
    <div class="bar-right">
      <button type="button" class="relchip" id="relchip" title="Change the words on the cover"><i></i><b></b><span></span></button>
      <span class="status" id="status" title=""></span>
      <button type="button" class="btn small" id="undoBtn" title="Undo (Ctrl+Z)" aria-label="Undo" disabled>↶</button>
      <button type="button" class="btn small" id="redoBtn" title="Redo (Ctrl+Shift+Z)" aria-label="Redo" disabled>↷</button>
      <button type="button" class="btn small" id="newBtn" title="Start a new release">New</button>
      <button type="button" class="btn small" id="openBtn" title="Open a saved release or a file">Open ▾</button>
      <button type="button" class="btn small primary" id="saveBtn" title="Save this release to your library (Ctrl+S)">Save</button>
      <button type="button" class="btn small" id="gearBtn" title="Settings" aria-label="Settings">⚙</button>
    </div>`;
  const nav = bar.querySelector(".tabs");
  const tab = (href, label, go2, cls) => { const a = document.createElement("a"); a.href = href; a.dataset.go = go2; a.textContent = label; if (cls) a.className = cls; nav.appendChild(a); return a; };
  for (const n of order) {
    const d = views[n]; if (d.hidden || d.minor || n === "print") continue;
    if (n === "export") { tab("#export", "Get files", "files"); continue; }
    tab("#" + n, d.label, n);
  }
  const minor = order.filter(n => views[n].minor);
  if (minor.length) {
    const more = h("button", { type: "button", class: "tabbtn", "data-go": "more" }, "More ▾"); nav.appendChild(more);
    menu(more, minor.map(n => ({ label: views[n].label, sub: views[n].sub, onclick: () => go(n) })));
  }
  const chip = $("relchip");
  const refresh = () => {
    const d = SP.get(), r = d.release;
    chip.querySelector("i").style.background = `linear-gradient(90deg, ${d.palette.bg} 0 50%, ${d.palette.ink} 50% 80%, ${d.palette.accent} 80%)`;
    chip.querySelector("b").textContent = [r.artist, SP.titleLine(r)].filter(Boolean).join(" — ") || "Untitled release";
    chip.querySelector("span").textContent = [r.catalog, d.tracks.length ? `${d.tracks.length} tracks` : ""].filter(Boolean).join(" · ");
  };
  SP.on(refresh); refresh();
  chip.addEventListener("click", () => { go("design"); setTimeout(() => window.Design && Design.words && Design.words(), 30); });
  const st = $("status");
  // one plain sentence: is the work kept, and is it in the library
  const showStatus = () => {
    const mem = SP.status() !== "browser", lib = !unsaved();
    st.className = "status " + (mem ? "memory" : lib ? "browser" : "pending");
    st.textContent = mem ? "Not being kept" : lib ? "Saved in library" : "Not in library yet";
    st.title = mem ? "This browser won't keep data for this page (private window or file:// restrictions). Use ⚙ → Back up everything to keep your work."
      : lib ? "This release is in your library. Changes are kept in this browser as you go." : "Your changes are kept in this browser as you go. Press Save to put this release in your library.";
  };
  SP.onStatus(showStatus); SP.on(SP.debounce(showStatus, 300)); statusFns.add(showStatus); showStatus();
  $("saveBtn").addEventListener("click", () => saveToLibrary());
  $("newBtn").addEventListener("click", newRelease);
  menu($("openBtn"), async () => {
    const list = (await SP.library.list()).slice(0, 8);
    return [...list.map(e => ({ label: e.name, sub: [e.catalog, new Date(e.updated).toLocaleDateString()].filter(Boolean).join(" · "), onclick: () => openSaved(e.id) })),
      ...(list.length ? ["-"] : [{ label: "Nothing saved yet", sub: "Save puts the release you're on here", onclick: () => {} }, "-"]),
      { label: "All saved releases…", onclick: () => go("library") }, { label: "Open a file…", sub: "release.json or a backup", onclick: openFile }];
  });
  menu($("gearBtn"), [
    { label: "Defaults for new releases…", sub: "the words a new release starts with", onclick: editDefaults },
    { label: "Back up everything", sub: "one file: saved releases, looks, logo", onclick: () => SP.library.backup() },
    { label: "Restore from a backup…", onclick: openFile },
    "-",
    { label: "Reset everything…", sub: "delete all Sleeve Press data in this browser", danger: true, onclick: resetEverything },
  ]);
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
/* Get files = Export (digital) + Print, one tab with a switch at the top of each. */
function filesSwitch(v) {
  const d = views[v]; if (!FILE_VIEWS.includes(v) || !d.el || d.el.querySelector(".files-switch")) return;
  const sw = h("div", { class: "files-switch", role: "tablist", "aria-label": "Kind of files" },
    h("a", { href: "#export", role: "tab", "aria-selected": String(v === "export") }, h("b", {}, "Digital"), h("small", {}, "covers, promo images, text")),
    h("a", { href: "#print", role: "tab", "aria-selected": String(v === "print") }, h("b", {}, "Print"), h("small", {}, "CD inserts, vinyl labels, stickers")));
  d.el.prepend(sw);
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
/* The randomizer treats a full-bleed photo gently; it needs to know whether there is one. */
function trackPicture() { const upd = async () => { Looks.picture = !!(await SP.cover.image()); }; SP.cover.on(upd); upd(); }
function start() {
  trackPicture();
  if (SP.isFresh()) markSaved();   // the example release isn't "unsaved work"
  // whichever way a saved release gets opened (top bar, Library tab, a restore), compare against what's stored for it
  let lastLib;
  const syncSaved = async () => {
    const id = SP.get().libId; if (id === lastLib) return; lastLib = id; if (!id) return;
    const e = await SP.vault.get("lib." + id); if (e && SP.get().libId === id) { savedSig = sigOf(e.record); statusFns.forEach(fn => fn()); }
  };
  SP.on(syncSaved); syncSaved();
  migrateLooks(); SP.on(() => { if (SP.get().looks.some(l => !l || !l.id)) migrateLooks(); });
  mountBar(); window.addEventListener("hashchange", route); route();
  welcome();
}

window.App = { modal, menu, newRelease, openFile, openSaved, editDefaults, resetEverything, unsaved, markSaved, completeLook, state, commit, applyLook, checkpoint, undo, redo, view, go, start, lookId, flagged, isFlagged, flag, unflag, toggleFlag,
  smallImage, thumb, env, saveToLibrary, nextRelease, h, lazy, queue, current: () => current };
})();
