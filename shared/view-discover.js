/* Sleeve Press: Discover, the front page. An endless grid of sleeves rolled from seeds, all wearing the
   current release's words and picture. Flag the ones you like, open one in the editor, or ask for more like it. */
(function () {
"use strict";
const h = App.h, SR = SleeveRender;
const STORE = "sleevepress.discover", BATCH = 24, SIZE = 420;
const GROUP_LABEL = { colour: "Colours", type: "Type", layout: "Layout", motif: "Motif", border: "Border", backdrop: "Backdrop", picture: "Picture" };
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ---------- settings (kept per browser, out of the release record) ---------- */
function loadPrefs() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(STORE) || "{}") || {}; } catch (e) { p = {}; }
  return {
    mood: Looks.MOODS.includes(p.mood) ? p.mood : "any",
    feel: Looks.FEELS.includes(p.feel) ? p.feel : "any",
    locks: Object.fromEntries(Looks.GROUPS.map(g => [g, !!(p.locks && p.locks[g])])),
    base: Number.isFinite(p.base) ? p.base : newBase(),
  };
}
function newBase() { return (Math.floor(Math.random() * 9900) + 100) * 100; }
let prefs = null;
const savePrefs = () => { try { localStorage.setItem(STORE, JSON.stringify(prefs)); } catch (e) {} };

/* ---------- view state ---------- */
let root, grid, sentinel, flagChip, famBar, picPrompt, filterBar, countEl;
let visible = false, stale = false, gen = 0, count = 0, recordKey = "";
let mode = "all";            // "all" | "flagged"
let family = [];             // stack of { look, seed } for "More like this"
let lazy = null, more = null;
const enqueue = App.queue();
const work = document.createElement("canvas"); work.width = work.height = SIZE;
const cards = new Set();     // live card elements

/* What a card shows, rebuilt from its recipe so new words reach every card. */
function stateFor(card) {
  const base = App.state(), r = card._recipe, opts = { mood: prefs.mood, feel: prefs.feel };
  // dealt from shuffled decks, so neighbouring cards don't repeat the same shape, pattern, face or placement
  if (r.kind === "seed") return Looks.randomize(base, r.seed, prefs.locks, { ...opts, deal: { i: r.seed - prefs.base, base: prefs.base } });
  if (r.kind === "family") return Looks.mutate({ ...base, ...r.parent }, r.seed, prefs.locks, opts);
  return { ...base, ...Looks.keepMine(App.completeLook(r.look), base, prefs.locks) };   // flagged, wearing whatever "keep mine" holds
}

function makeCard(recipe, label) {
  const pic = h("button", { type: "button", class: "dc-pic", "aria-label": `Edit design ${label}`, title: "Open in the editor" });
  const img = h("img", { alt: "", width: SIZE, height: SIZE, decoding: "async" });
  pic.append(img);
  const heart = h("button", { type: "button", class: "iconbtn dc-heart", "aria-pressed": "false", "aria-label": "Flag for later", title: "Flag for later" }, "♥");
  const edit = h("button", { type: "button", class: "dc-act dc-edit" }, "Edit");
  const like = h("button", { type: "button", class: "dc-act dc-more", title: "More like this" }, "More like this");
  const card = h("article", { class: "tile dc-card loading" }, pic,
    h("span", { class: "dc-seed" }, label), heart, h("div", { class: "dc-bar" }, edit, like));
  card._recipe = recipe; card._img = img; card._heart = heart; card._ver = -1; card._label = label;
  const lookNow = () => card._look || SR.lookOf(stateFor(card));
  const shown = () => SR.lookOf(stateFor(card));   // what the card shows (a flag with "keep mine" laid over it)
  pic.addEventListener("click", () => openLook(shown()));
  edit.addEventListener("click", () => openLook(shown()));
  heart.addEventListener("click", () => {
    const on = App.toggleFlag(lookNow());
    heart.setAttribute("aria-pressed", String(on));
    if (!on && mode === "flagged") { card.remove(); cards.delete(card); if (!cards.size) showEmptyFlagged(); }
  });
  like.addEventListener("click", () => {
    family.push({ look: lookNow(), seed: recipe.seed || (SP.hashStr(card._look ? JSON.stringify(card._look) : label) % 100000), label });
    mode = "all"; restart(); window.scrollTo({ top: Math.max(0, root.offsetTop - 60) });
  });
  cards.add(card);
  return card;
}

function openLook(look) { App.applyLook(look); App.go("design"); }

/* Render one card if it is behind the current words/picture. Runs on the serial queue. */
let ver = 0;   // bumps whenever words, picture or base look change
function renderCard(card) {
  const g = gen;
  enqueue(async () => {
    if (g !== gen || !card.isConnected || card._ver === ver || !visible) return;
    const v = ver, st = stateFor(card);
    card._look = card._recipe.kind === "flag" ? card._recipe.look : SR.lookOf(st);   // a flagged card stays that flag
    await App.thumb(work, st);
    if (g !== gen || !card.isConnected) return;
    const blob = await new Promise(res => work.toBlob(res, "image/jpeg", 0.86));
    if (!blob || g !== gen || !card.isConnected) return;
    if (card._url) URL.revokeObjectURL(card._url);
    card._url = URL.createObjectURL(blob); card._img.src = card._url; card._ver = v;
    card._img.alt = `${st.font} on ${st.paletteName || "colours"}`;
    card._heart.setAttribute("aria-pressed", String(App.isFlagged(card._look)));
    card.classList.remove("loading");
    if (window.__dcFirst && ++window.__dcFirst.n === 12) window.__dcFirst.t = performance.now() - window.__dcFirst.t0;
  });
}

function watchAll() {
  if (lazy && lazy.stop) lazy.stop();
  lazy = App.lazy(renderCard, "700px");
  cards.forEach(c => lazy.watch(c));
}

function clearGrid() {
  gen++;
  cards.forEach(c => { if (c._url) URL.revokeObjectURL(c._url); });
  cards.clear(); grid.textContent = ""; count = 0;
  if (lazy && lazy.stop) lazy.stop();
  lazy = App.lazy(renderCard, "700px");
}

function addBatch() {
  if (mode !== "all") return;
  const frag = document.createDocumentFragment(), fam = family[family.length - 1];
  for (let i = 0; i < BATCH; i++, count++) {
    const card = fam
      ? makeCard({ kind: "family", parent: fam.look, seed: fam.seed + count + 1 }, "#" + (fam.seed + count + 1))
      : makeCard({ kind: "seed", seed: prefs.base + count }, "#" + (prefs.base + count));
    frag.append(card);
  }
  const added = [...frag.children];
  grid.append(frag); added.forEach(c => lazy.watch(c));
  countEl.textContent = `${count} designs`;
  requestAnimationFrame(checkMore);
}
/* Keep loading while the bottom is near the screen (the observer only fires on change). */
function checkMore() {
  if (!visible || mode !== "all" || !sentinel.isConnected) return;
  const r = sentinel.getBoundingClientRect();
  if (r.top < innerHeight + 900) addBatch();
}

function showEmptyFlagged() {
  grid.append(h("p", { class: "empty dc-empty" }, "Nothing flagged yet. Tap ♥ on a design to keep it here."));
}

function restart() {
  window.__dcFirst = { n: 0, t0: performance.now(), t: null };
  clearGrid(); updateHead();
  if (mode === "flagged") {
    const all = App.flagged(), list = all.filter(matches);
    if (!all.length) showEmptyFlagged();
    else if (!list.length) grid.append(h("p", { class: "empty dc-empty" }, `None of your ${all.length} flagged looks match these filters.`));
    list.forEach((f, i) => { const c = makeCard({ kind: "flag", look: f.look }, f.name || "Look " + (i + 1)); c._look = f.look; grid.append(c); lazy.watch(c); });
    countEl.textContent = list.length === all.length ? `${all.length} flagged` : `${list.length} of ${all.length} flagged`;
    sentinel.hidden = true;
  } else { sentinel.hidden = false; addBatch(); }
}

/* ---------- header ---------- */
function chipRow(name, items, isOn, onClick, cls) {
  const row = h("div", { class: "dc-row", role: "group", "aria-label": name }, h("span", { class: "dc-lab" }, name));
  const chips = h("div", { class: "chips" });
  for (const [val, label] of items) {
    const b = h("button", { type: "button", class: "chip-b" + (cls ? " " + cls : ""), "aria-pressed": String(isOn(val)), "data-v": val }, label);
    b.addEventListener("click", () => { onClick(val); chips.querySelectorAll("button").forEach(x => x.setAttribute("aria-pressed", String(isOn(x.dataset.v)))); restart(); savePrefs(); });
    chips.append(b);
  }
  row.append(chips); return row;
}

function updateHead() {
  const n = App.flagged().length;
  flagChip.textContent = `♥ Flagged (${n})`;
  flagChip.setAttribute("aria-pressed", String(mode === "flagged"));
  const fam = family[family.length - 1];
  famBar.hidden = !fam || mode === "flagged";
  if (fam) {
    famBar.querySelector(".dc-famtitle").textContent = `More like ${fam.label}`;
    famBar.querySelector(".dc-up").hidden = family.length < 2;
  }
}
/* Flagged looks go through the same mood and type-feel filters as new designs. */
function matches(f) {
  const l = f.look || {};
  if (prefs.mood !== "any" && !(l.bg && Looks.moodsOf({ bg: l.bg, ink: l.ink, accent: l.accent }).includes(prefs.mood))) return false;
  if (prefs.feel !== "any" && !(Looks.FONT[l.font] && Looks.FONT[l.font].feel === prefs.feel)) return false;
  return true;
}

function mount(el) {
  root = el; prefs = loadPrefs(); savePrefs();
  flagChip = h("button", { type: "button", class: "chip-b dc-flagchip", "aria-pressed": "false", title: "Show only the designs you flagged" });
  flagChip.addEventListener("click", () => { mode = mode === "flagged" ? "all" : "flagged"; restart(); });
  const shuffle = h("button", { type: "button", class: "btn primary dc-shuffle", title: "A fresh batch of designs" }, "↻ Shuffle all");
  shuffle.addEventListener("click", () => { prefs.base = newBase(); savePrefs(); family = []; mode = "all"; restart(); });
  countEl = h("span", { class: "dc-count" });

  const head = h("div", { class: "view-head" },
    h("div", {}, h("h1", {}, "Discover"), h("p", {}, "Sleeves made from your words and picture. ♥ to keep, tap one to edit.")),
    h("div", { class: "dc-actions" }, flagChip, shuffle));

  filterBar = h("div", { class: "dc-filters" },
    chipRow("Mood", Looks.MOODS.map(m => [m, cap(m)]), v => prefs.mood === v, v => { prefs.mood = v; }),
    chipRow("Type feel", Looks.FEELS.map(m => [m, cap(m)]), v => prefs.feel === v, v => { prefs.feel = v; }),
    chipRow("Keep mine", Looks.GROUPS.map(g => [g, GROUP_LABEL[g] || cap(g)]), v => prefs.locks[v], v => { prefs.locks[v] = !prefs.locks[v]; }, "dc-lock"));
  filterBar.querySelector(".dc-row:last-child").title = "Keep the current release's settings for these parts";

  /* picture prompt */
  const input = h("input", { type: "file", accept: "image/*", id: "dc-file", hidden: true });
  const choose = h("label", { class: "btn small", for: "dc-file" }, "Choose picture");
  picPrompt = h("div", { class: "dc-picprompt", hidden: true }, h("span", { class: "dc-picicon", "aria-hidden": "true" }, "▣"),
    h("span", {}, "Add a picture to see it in every design", h("small", {}, " · drop it here")), choose, input);
  SP.bindDrop(SP.cover, { drop: picPrompt, input });

  famBar = h("div", { class: "dc-fambar", hidden: true },
    h("button", { type: "button", class: "btn small dc-back" }, "← Back to all"),
    h("button", { type: "button", class: "btn small dc-up", hidden: true }, "↑ Up one"),
    h("b", { class: "dc-famtitle" }));
  famBar.querySelector(".dc-back").addEventListener("click", () => { family = []; restart(); });
  famBar.querySelector(".dc-up").addEventListener("click", () => { family.pop(); restart(); });

  grid = h("div", { class: "dc-grid", id: "dc-grid" });
  sentinel = h("div", { class: "dc-sentinel", "aria-hidden": "true" });
  more = new IntersectionObserver((es) => { if (es.some(e => e.isIntersecting)) addBatch(); }, { rootMargin: "900px" });
  more.observe(sentinel);

  el.append(head, filterBar, picPrompt, famBar, grid, sentinel, h("div", { class: "dc-foot" }, countEl));

  /* keep in step with the record */
  recordKey = keyOf();
  const refresh = SP.debounce(() => { if (visible) { stale = false; ver++; watchAll(); } }, 700);
  const changed = () => { stale = true; if (visible) refresh(); };
  let lastLooks = SP.get().looks;
  SP.on((d) => {
    if (d.looks !== lastLooks) { lastLooks = d.looks; syncHearts(); }
    const k = keyOf(); if (k !== recordKey) { recordKey = k; changed(); }
  });
  SP.cover.on(() => { updatePicPrompt(); changed(); });
  SP.logo.on(changed);
  updatePicPrompt();
  restart();
}

/* Everything outside the flags that changes what a card looks like. */
function keyOf() { const s = App.state(); delete s.paletteName; return JSON.stringify(s); }

function syncHearts() {
  updateHead();
  cards.forEach(c => { if (c._look) c._heart.setAttribute("aria-pressed", String(App.isFlagged(c._look))); });
}
async function updatePicPrompt() { picPrompt.hidden = !!(await SP.cover.image()); }

App.view("discover", {
  label: "Discover",
  mount,
  show() {
    visible = true; updateHead(); syncHearts();
    if (stale) { stale = false; ver++; }
    watchAll();
    requestAnimationFrame(checkMore);
  },
  hide() { visible = false; },
});
})();
