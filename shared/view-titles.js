/* Sleeve Press: Titles view (was title-lab.html). Release and track names from word banks and templates, not a model.
   Same seed and settings, same list. Reads and writes SP.get().names; "Use as title" writes the release title. */
(function () {
"use strict";

/* ---------- word banks ---------- */
const W = (s) => s.trim().split(/\s+/).map(x => x.replace(/_/g, " "));
const THEMES = {
  yard: { label: "Yard & sound", n: W("dubplate selector riddim version bassline speaker stack needle groove pressing cabinet voltage ginger rum candle gate drum bell hymn table lantern verandah rooster kettle fence shutter mango zinc rainfall libation wake duppy ledger rhythm echo reverb siren"), a: W("heavy low slow deep dry sweet bitter long warm hollow raw rolling bare"), g: W("burning rolling leaning calling waiting turning pressing counting"), p: W("the_Yard the_Gully the_Hill the_Corner the_Crossroads the_Bridge the_Harbour") },
  maritime: { label: "Maritime", n: W("harbour tide anchor lighthouse hull buoy rope sail salt wreck current ferry mast net ballast beacon gull shoal reef swell compass lantern rudder quay mooring chart"), a: W("salt grey slack open drifting outbound moored wide deep cold"), g: W("drifting mooring sounding trawling anchoring crossing"), p: W("the_Estuary the_Pier the_Narrows the_Sound the_Shallows the_Strait") },
  industrial: { label: "Industrial", n: W("furnace rivet girder foundry piston gantry conveyor circuit relay turbine concrete signal switch rail depot spark kiln press shift siren cable coil engine boiler"), a: W("iron steel grey dull cold heavy slow molten worn hard"), g: W("forging pressing turning grinding welding switching"), p: W("the_Works the_Yard the_Depot the_Line the_Plant the_Dock") },
  pastoral: { label: "Pastoral", n: W("meadow orchard hedgerow barn hay furrow brook shepherd harvest pasture fern thistle lane gate stile cider hollow ridge ploughshare dew fog bramble"), a: W("green soft low early quiet wild slow tender damp gold"), g: W("gleaning mowing wandering sowing resting grazing"), p: W("the_Valley the_Common the_Lane the_Meadow the_Green the_Ridge") },
  city: { label: "Night city", n: W("neon taxi elevator rooftop alley siren tunnel platform lamp pavement shutter diner skyline arcade crossing static turnstile fare parade headlight stairwell vending"), a: W("late blue electric empty last wet hollow yellow midnight orange"), g: W("passing waiting crossing circling idling flickering"), p: W("the_Underpass the_Terminal the_Boulevard the_Night_Bus the_Last_Stop 5th_Street") },
  desert: { label: "Desert", n: W("dune mirage canyon salt-flat cactus ember caravan ridge dust well horizon scorpion kiln wind bone ochre cairn mesa glare"), a: W("dry bare burnt pale wide still hot red cracked endless"), g: W("wandering baking drifting burning crossing"), p: W("the_Flats the_Wash the_Mesa the_Pass the_Salt_Road") },
  cosmic: { label: "Cosmic", n: W("orbit comet eclipse nebula aurora meridian zenith satellite static horizon pulsar signal probe vector lens tide halo flare void quasar apogee"), a: W("distant silent cold bright slow deep fixed binary lunar pale"), g: W("orbiting drifting dimming rising transmitting"), p: W("the_Outer_Ring the_Dark_Side the_Far_Field the_Terminator") },
  ritual: { label: "Ritual", n: W("altar vigil ember censer psalm veil offering pilgrim chapel candle bell oath relic salt ash threshold wake bread incense basin"), a: W("holy hushed ninth last sacred bare slow solemn burnt faithful"), g: W("keeping kneeling lighting gathering tending"), p: W("the_Threshold the_Chapel the_Gate the_Longest_Night") },
  weather: { label: "Weather", n: W("rain thunder drizzle squall monsoon fog frost heatwave hail drought gale rainbow puddle cloudburst barometer forecast front lightning"), a: W("wet grey heavy humid cold bright overcast still electric low"), g: W("raining clearing gathering breaking thawing"), p: W("the_Coast the_Lowlands the_Front_Line the_Eye_of_the_Storm") },
  gothic: { label: "Gothic", n: W("crypt raven lantern velvet thorn mirror candle chapel bell ghost veil wolf moth ivy portrait tomb hymn widow key"), a: W("black velvet hollow pale cold ancient silent crimson bitter dim"), g: W("haunting weeping fading kneeling burning"), p: W("the_Manor the_Moor the_Vault the_Old_House the_Graveyard") },
  tropic: { label: "Tropics", n: W("palm mango hibiscus lagoon coconut breeze hammock reef parrot sugarcane monsoon rum veranda sunset tide calypso"), a: W("sweet hot slow golden lazy salt green bright warm wild"), g: W("swaying drifting dancing ripening basking"), p: W("the_Island the_Bay the_Lagoon the_Cane_Field the_Beach_Road") },
  digital: { label: "Digital", n: W("signal pixel cache static cursor modem server glitch packet loop byte pulse terminal checksum firmware render ping"), a: W("dead low null soft lost blue silent analog bright broken"), g: W("loading buffering scanning looping rendering"), p: W("the_Network the_Mainframe the_Dark_Web the_Grid Sector_7") },
  street: { label: "Street", n: W("corner hustle sneaker blockparty boombox curb stoop chain mural cypher tag lamp-post bodega rooftop") , a: W("raw fresh heavy cold real loud late hard"), g: W("rolling cruising posting spitting"), p: W("the_Block the_Avenue the_Estate the_Corner_Shop South_Side") },
  tender: { label: "Lovers", n: W("honey ribbon letter promise postcard cassette kiss slow-dance telephone summer lace perfume sunday rose silk window ring"), a: W("sweet soft slow warm tender golden sleepy gentle late lazy"), g: W("holding dancing waiting whispering borrowing"), p: W("your_Place the_Back_Porch the_Corner_Shop the_Last_Dance") },
};
const COMMON_A = W("last long low late quiet blue open hollow pale bare");
const NUMBERS = W("One Two Three Four Five Seven Nine Ninth Twelve Thirteen Forty");
const STOP = new Set(["the", "of", "and", "&", "no", "for", "at", "after", "under", "to", "a", "my", "your", "in", "on", "dear", "return", "last", "season", "hours", "version", "songs", "club", "theory", "notes", "dub", "/"]);

const TEMPLATES = [
  ["{N}", "One word"], ["{A} {N}", "Adjective noun"], ["{N} {N2}", "Compound"], ["The {N} of {P}", "The … of …"],
  ["{N} & {N2}", "Noun & noun"], ["No {N}", "No …"], ["{G} {N}", "Gerund noun"], ["{N} Season", "… Season"],
  ["After {N}", "After …"], ["{A} {A2} {N}", "Two adjectives"], ["{N} for {N2}", "… for …"], ["{P}", "Place"],
  ["Last {N}", "Last …"], ["{NUM} {N}s", "Number + plural"], ["{N} at {P}", "… at …"], ["Under {N}", "Under …"],
  ["Return to {P}", "Return to …"], ["{N} Hours", "… Hours"], ["Dear {N}", "Dear …"], ["{N} Version", "… Version"],
  ["{N} / {N2}", "… / …"], ["Songs for {N}", "Songs for …"], ["{A} {N} Club", "… Club"], ["{N} Theory", "… Theory"],
  ["{N} in {P}", "… in …"], ["Notes on {N}", "Notes on …"], ["{N} (Dub)", "… (Dub)"], ["{G}", "Gerund alone"],
];

/* ---------- helpers ---------- */
function syllables(w) {
  w = w.toLowerCase().replace(/[^a-z]/g, ""); if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const m = w.match(/[aeiouy]{1,2}/g); return Math.max(1, m ? m.length : 1);
}
const words = (t) => t.split(/\s+/).filter(Boolean);
const content = (t) => words(t).map(x => x.toLowerCase().replace(/[^a-z0-9]/g, "")).filter(x => x && !STOP.has(x));
function plural(n) { return /[sxz]$|[cs]h$/.test(n) ? n + "es" : /[^aeiou]y$/.test(n) ? n.slice(0, -1) + "ies" : n + "s"; }
function casing(t, mode) {
  if (mode === "upper") return t.toUpperCase();
  if (mode === "lower") return t.toLowerCase();
  const small = new Set(["of", "and", "for", "at", "to", "the", "in", "on"]);
  return words(t).map((x, i) => (i && small.has(x.toLowerCase())) ? x.toLowerCase() : x.charAt(0).toUpperCase() + x.slice(1)).join(" ");
}

/* ---------- state (lives in SP.get().names) ---------- */
const DEFAULT_OPT = () => ({ themes: ["yard", "ritual"], tpls: TEMPLATES.map(t => t[0]), mine: "", learn: true, words: 3, syl: 7, chars: 24, count: 24, starts: "", alliter: false, fresh: true, casing: "title" });
let OPT = DEFAULT_OPT();
let seed = 1;
let shortlist = [];
let list = [];
let riffOn = null;     // when set, every candidate must reuse a word from this title
let writing = false, lastNames = "";

function loadNames(db) {
  const saved = db.names || {};
  OPT = Object.assign(DEFAULT_OPT(), saved.opts || {});
  // Templates added after a list was saved start switched on.
  if ((OPT.tplsVersion || 1) < 2) { const known = new Set(TEMPLATES.slice(0, 20).map(t => t[0])); OPT.tpls = [...OPT.tpls, ...TEMPLATES.map(t => t[0]).filter(k => !known.has(k) && !OPT.tpls.includes(k))]; OPT.tplsVersion = 2; }
  seed = saved.seed || 1;
  shortlist = Array.isArray(saved.shortlist) ? [...saved.shortlist] : [];
  lastNames = JSON.stringify(db.names);
}
function save() {
  const next = { ...SP.get().names, shortlist, seed, opts: OPT };
  if (JSON.stringify(next) === lastNames) return;
  writing = true;
  try { SP.patch("names", { shortlist, seed, opts: OPT }); } finally { writing = false; }
  lastNames = JSON.stringify(SP.get().names);
}

/* ---------- generation ---------- */
function pools() {
  const P = { n: [], a: [...COMMON_A], g: [], p: [] };
  OPT.themes.forEach(k => { const t = THEMES[k]; if (!t) return; P.n.push(...t.n); P.a.push(...t.a); P.g.push(...t.g); P.p.push(...t.p); });
  const mine = OPT.mine.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
  mine.forEach(w => { for (let i = 0; i < 3; i++) P.n.push(w); P.a.push(w); });
  if (riffOn) content(riffOn).forEach(w => { for (let i = 0; i < 8; i++) { P.n.push(w); P.a.push(w); } });
  if (OPT.learn && shortlist.length) {
    const learned = new Set(); shortlist.forEach(t => content(t).forEach(w => learned.add(w)));
    learned.forEach(w => { for (let i = 0; i < 2; i++) { P.n.push(w); P.a.push(w); } });
  }
  if (!P.n.length) P.n.push("signal"); if (!P.g.length) P.g.push("waiting"); if (!P.p.length) P.p.push("the Gate");
  return P;
}
function generate() {
  const rnd = SP.mulberry32(seed * 7919 + 13);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const P = pools();
  const tpls = OPT.tpls.length ? OPT.tpls : TEMPLATES.map(t => t[0]);
  const out = [], seen = new Set(), used = new Set();
  const starts = OPT.starts.trim().toLowerCase();
  let tries = 0;
  while (out.length < OPT.count && tries < OPT.count * 220) {
    tries++;
    const tpl = pick(tpls);
    const slots = { N: pick(P.n), N2: pick(P.n), A: pick(P.a), A2: pick(P.a), G: pick(P.g), P: pick(P.p), NUM: pick(NUMBERS) };
    let t = tpl.replace(/\{(\w+)\}s/g, (m, k) => plural(slots[k])).replace(/\{(\w+)\}/g, (m, k) => slots[k]);
    t = t.replace(/[-]/g, " ").replace(/\s+/g, " ").trim();
    const ws = words(t); if (ws.length > OPT.words) continue;
    if (t.length > OPT.chars) continue;
    const syl = ws.reduce((a, x) => a + syllables(x), 0); if (syl > OPT.syl) continue;
    const cw = content(t);
    if (new Set(cw).size < cw.length) continue;                      // "Salt Salt"
    if (starts && t[0].toLowerCase() !== starts) continue;
    if (OPT.alliter) { if (cw.length < 2 || !cw.every(x => x[0] === cw[0][0])) continue; }
    const key = t.toLowerCase(); if (seen.has(key)) continue;
    if (riffOn) { const rw = content(riffOn); if (!cw.some(x => rw.includes(x)) || key === riffOn.toLowerCase()) continue; }
    if (OPT.fresh && !riffOn && cw.some(x => used.has(x))) continue;
    seen.add(key); cw.forEach(x => used.add(x)); out.push({ text: casing(t, OPT.casing), syl, n: ws.length });
  }
  return out;
}

function titleLines(text) {
  const ws = text.toUpperCase().split(" ");
  if (ws.length < 2) return ws[0];
  let best = 1, bd = 1e9;
  for (let i = 1; i < ws.length; i++) { const d = Math.abs(ws.slice(0, i).join(" ").length - ws.slice(i).join(" ").length); if (d < bd) { bd = d; best = i; } }
  return ws.slice(0, best).join(" ") + "\n" + ws.slice(best).join(" ");
}

/* ---------- view ---------- */
let el = null, visible = false, dirty = true;
const q = (id) => el.querySelector("#tl-" + id);
const blank = (title) => ({ title, feat: "", bpm: "", key: "", length: "", side: "A" });

function useAsTitle(text) {
  App.checkpoint(true);
  SP.patch("release", { title: titleLines(text) });
  const n = q("now"); n.classList.remove("flash"); void n.offsetWidth; n.classList.add("flash");
  SP.toast(`Cover title: ${text}`);
}
function addTracks(titles) {
  App.checkpoint(true);
  SP.set("tracks", [...SP.get().tracks, ...titles.map(blank)]);
  SP.toast(titles.length === 1 ? `Added “${titles[0]}” as track ${SP.get().tracks.length}` : `Added ${titles.length} tracks`);
}
function actions(text) {
  return App.h("div", { class: "a" },
    App.h("button", { type: "button", class: "btn small", title: "Put this on the cover as the release title", onclick: () => useAsTitle(text) }, "Use as title"),
    App.h("button", { type: "button", class: "btn small", title: "Add to the end of the tracklist", onclick: () => addTracks([text]) }, "+ Track"));
}
function star(text) {
  const on = shortlist.includes(text);
  return App.h("button", { type: "button", class: "star", "aria-pressed": String(on), "aria-label": on ? `Unstar ${text}` : `Star ${text}`, title: on ? "Remove from shortlist" : "Keep on the shortlist", onclick: () => toggle(text) }, "★");
}

function renderNow() {
  const t = SP.titleLine(SP.get().release);
  q("nowT").textContent = t || "Untitled";
}
function render() {
  q("seed").textContent = seed;
  const g = q("grid"); g.textContent = "";
  for (const c of list) {
    const a = actions(c.text);
    a.prepend(star(c.text));
    g.append(App.h("div", { class: "cand" + (shortlist.includes(c.text) ? " starred" : "") },
      App.h("div", { class: "top" }, App.h("div", { class: "t" }, c.text), App.h("span", { class: "meta", title: "syllables" }, `${c.syl} syl`)), a));
  }
  const note = q("note"); note.textContent = "";
  if (riffOn) {
    note.append("Riffs on ", App.h("b", {}, riffOn), " ",
      App.h("button", { type: "button", class: "btn small", onclick: () => { riffOn = null; roll(seed); } }, "Back to the full list"));
  } else if (list.length < OPT.count) note.textContent = `Only ${list.length} names fit. Loosen the limits under Shape, or switch on more themes.`;
  note.hidden = !note.textContent;

  const s = q("short"); s.textContent = "";
  q("shortN").textContent = shortlist.length ? String(shortlist.length) : "";
  q("shortActs").hidden = !shortlist.length;
  if (!shortlist.length) s.append(App.h("p", { class: "hint" }, "Star names to keep them here. Stars also steer the next batch."));
  for (const text of shortlist) {
    const acts = actions(text);
    acts.prepend(App.h("button", { type: "button", class: "btn small", title: "More names that reuse its words", onclick: () => { riffOn = text; roll(seed); q("grid").scrollIntoView({ behavior: "smooth", block: "start" }); } }, "Riff"));
    s.append(App.h("div", { class: "it" }, App.h("span", { class: "t" }, text), acts,
      App.h("button", { type: "button", class: "star", "aria-label": `Remove ${text}`, title: "Remove", onclick: () => toggle(text) }, "×")));
  }
  renderNow();
}
function toggle(text) { shortlist = shortlist.includes(text) ? shortlist.filter(x => x !== text) : [...shortlist, text]; save(); render(); }
function roll(newSeed) { seed = newSeed; list = generate(); save(); render(); }

let segCase = () => {};
function reflect() {
  for (const b of q("themes").children) b.setAttribute("aria-pressed", String(OPT.themes.includes(b.dataset.k)));
  for (const b of q("tpls").children) b.setAttribute("aria-pressed", String(OPT.tpls.includes(b.dataset.k)));
  for (const k of RANGES) { q(k).value = OPT[k]; q(k + "Out").textContent = OPT[k]; }
  q("learn").checked = OPT.learn; q("alliter").checked = OPT.alliter; q("fresh").checked = OPT.fresh;
  if (document.activeElement !== q("mine")) q("mine").value = OPT.mine;
  if (document.activeElement !== q("starts")) q("starts").value = OPT.starts;
  q("shapeSum").textContent = `≤ ${OPT.words} words · ≤ ${OPT.syl} syl · ${OPT.count}`;
  q("tplSum").textContent = `${OPT.tpls.length || TEMPLATES.length} of ${TEMPLATES.length}`;
  segCase();
}
const RANGES = ["words", "syl", "chars", "count"];

function mount(root) {
  el = root;
  el.innerHTML = `
  <div class="view-head">
    <div><h1>Titles</h1><p>Name ideas from word banks and templates. Same seed, same list. Star the keepers.</p></div>
    <p class="now" id="tl-now">On the cover: <b id="tl-nowT"></b> <button type="button" class="btn small" id="tl-see">See it on the cover →</button></p>
  </div>
  <div class="studio words">
    <div class="main">
      <section class="panel" aria-label="Shortlist">
        <h2>Shortlist <small id="tl-shortN"></small></h2>
        <div class="short" id="tl-short"></div>
        <div class="btn-row" id="tl-shortActs">
          <button type="button" class="btn small" id="tl-shortTracks">Add all as tracks</button>
          <button type="button" class="btn small" id="tl-shortCopy">Copy all</button>
          <button type="button" class="btn small" id="tl-shortClear">Clear</button>
        </div>
      </section>
      <section class="panel" aria-label="Name ideas">
        <div class="seedbar">
          <h2>Ideas</h2>
          <span class="sp"></span>
          <button type="button" class="btn small" id="tl-surprise" title="Two random themes and a new list">Surprise</button>
          <button type="button" class="btn small" id="tl-prev" aria-label="Previous seed">←</button>
          <span class="seed">seed <b id="tl-seed"></b></span>
          <button type="button" class="btn small primary" id="tl-next">New names →</button>
        </div>
        <p class="hint" id="tl-note" hidden></p>
        <div class="grid" id="tl-grid"></div>
      </section>
    </div>
    <aside class="ticket" aria-label="Name settings">
      <section class="panel">
        <h2>Themes</h2>
        <div class="chips" id="tl-themes"></div>
        <label class="f"><span>Your own words</span><textarea class="mono" id="tl-mine" rows="2" placeholder="duppy, wake, nine"></textarea></label>
        <label class="check"><input type="checkbox" id="tl-learn"> Learn from my stars</label>
      </section>
      <details>
        <summary>Shape <small id="tl-shapeSum"></small></summary>
        <div class="fields">
          <div class="row">
            <label class="f"><span>Max words <output id="tl-wordsOut"></output></span><input type="range" id="tl-words" min="1" max="5" step="1"></label>
            <label class="f"><span>Max syllables <output id="tl-sylOut"></output></span><input type="range" id="tl-syl" min="2" max="12" step="1"></label>
          </div>
          <div class="row">
            <label class="f"><span>Max letters <output id="tl-charsOut"></output></span><input type="range" id="tl-chars" min="6" max="40" step="1"></label>
            <label class="f"><span>How many <output id="tl-countOut"></output></span><input type="range" id="tl-count" min="12" max="60" step="6"></label>
          </div>
          <label class="f"><span>Starts with</span><input type="text" id="tl-starts" maxlength="1" class="mono" placeholder="any letter"></label>
          <label class="check"><input type="checkbox" id="tl-alliter"> Alliteration only (“Nine Night”)</label>
          <label class="check"><input type="checkbox" id="tl-fresh"> No repeated words in the list</label>
          <div class="seg" id="tl-casing" role="group" aria-label="Case">
            <button type="button" data-v="title">Title Case</button>
            <button type="button" data-v="upper">UPPER</button>
            <button type="button" data-v="lower">lower</button>
          </div>
        </div>
      </details>
      <details>
        <summary>Templates <small id="tl-tplSum"></small></summary>
        <div class="fields">
          <div class="chips" id="tl-tpls"></div>
        </div>
      </details>
    </aside>
  </div>`;

  const themes = q("themes");
  Object.entries(THEMES).forEach(([k, t]) => themes.append(App.h("button", { type: "button", class: "chip-b", "data-k": k, onclick: () => {
    OPT.themes = OPT.themes.includes(k) ? OPT.themes.filter(x => x !== k) : [...OPT.themes, k]; if (!OPT.themes.length) OPT.themes = [k]; reflect(); roll(seed);
  } }, t.label)));
  const tpls = q("tpls");
  TEMPLATES.forEach(([k, label]) => tpls.append(App.h("button", { type: "button", class: "chip-b", "data-k": k, title: k, onclick: () => {
    OPT.tpls = OPT.tpls.includes(k) ? OPT.tpls.filter(x => x !== k) : [...OPT.tpls, k]; reflect(); roll(seed);
  } }, label)));
  for (const k of RANGES) q(k).addEventListener("input", e => { OPT[k] = +e.target.value; reflect(); roll(seed); });
  for (const k of ["learn", "alliter", "fresh"]) q(k).addEventListener("change", e => { OPT[k] = e.target.checked; roll(seed); });
  q("mine").addEventListener("input", SP.debounce(e => { OPT.mine = e.target.value; roll(seed); }, 250));
  q("starts").addEventListener("input", e => { OPT.starts = e.target.value.replace(/[^a-z]/gi, ""); roll(seed); });
  segCase = SP.bindSeg(q("casing"), () => OPT.casing, v => { OPT.casing = v; roll(seed); });
  q("next").addEventListener("click", () => roll(seed + 1));
  q("prev").addEventListener("click", () => roll(Math.max(1, seed - 1)));
  q("surprise").addEventListener("click", () => {
    const keys = Object.keys(THEMES), r = SP.mulberry32(seed * 31 + 7), a = keys[Math.floor(r() * keys.length)];
    let b = keys[Math.floor(r() * keys.length)]; if (b === a) b = keys[(keys.indexOf(a) + 3) % keys.length];
    OPT.themes = [a, b]; riffOn = null; reflect(); roll(seed + 1);
    SP.toast(`Themes: ${THEMES[a].label} + ${THEMES[b].label}`);
  });
  q("shortClear").addEventListener("click", () => { shortlist = []; save(); render(); });
  q("shortCopy").addEventListener("click", () => SP.copy(shortlist.join("\n"), "shortlist"));
  q("shortTracks").addEventListener("click", () => { if (shortlist.length) addTracks(shortlist); });
  q("see").addEventListener("click", () => App.go("design"));

  SP.on((db) => {
    if (writing) return;
    if (JSON.stringify(db.names) !== lastNames) { dirty = true; riffOn = null; }
    if (!visible) return;
    if (dirty) refresh(); else renderNow();
  });
}
function refresh() { dirty = false; loadNames(SP.get()); reflect(); roll(seed); }

App.view("titles", {
  label: "Titles", minor: true, mount,
  show() { visible = true; if (dirty) refresh(); else renderNow(); },
  hide() { visible = false; },
});
})();
